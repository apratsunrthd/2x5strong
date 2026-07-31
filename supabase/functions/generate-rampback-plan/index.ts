import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function roundToIncrement(weight: number, increment: number): number {
  return Math.round(weight / increment) * increment;
}

// Extract the outermost {...} JSON object from a string, ignoring any
// preamble or trailing text Claude might add despite instructions not to.
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in response');
  }
  return text.slice(start, end + 1);
}

// Validate each recommendation against real numbers instead of blindly
// trusting Claude's output. A malformed/missing weight for one lift was
// previously falling through to `minIncrement` (5lb) — nonsense for a
// barbell lift — with sets similarly floored to 1. Now any recommendation
// that fails a sanity check gets replaced with a safe, clearly-marked
// fallback instead of silently passing through garbage.
function validateRecommendations(
  recommendations: any[],
  minIncrement: number,
  currentWeights: Record<string, number>,
  lastFullWeights: Record<string, number>
): any[] {
  return recommendations.map((r: any) => {
    const current = currentWeights[r.liftId];
    const lastFull = lastFullWeights[r.liftId];
    // Best available reference point for this lift, in priority order
    const reference = lastFull || current;

    let weight = Number(r.weight);
    let sets = Math.round(Number(r.sets));
    let flagged = false;

    // A recommendation is "broken" if it's not a usable number, or if it's
    // wildly outside any plausible range relative to what we know about
    // this lift (below 40% or above 120% of the best reference weight).
    const weightIsBroken =
      !Number.isFinite(weight) ||
      weight <= 0 ||
      (reference && (weight < reference * 0.4 || weight > reference * 1.2));

    const setsIsBroken = !Number.isFinite(sets) || sets < 1;

    if (weightIsBroken) {
      flagged = true;
      // Fall back to a conservative, sane default: 85% of the best
      // reference weight, rounded to increment — never below the
      // increment itself, never a number that ignores real data.
      weight = reference
        ? Math.max(roundToIncrement(reference * 0.85, minIncrement), minIncrement)
        : minIncrement * 9; // last-resort floor if we have zero reference data
    } else {
      weight = Math.max(roundToIncrement(weight, minIncrement), minIncrement);
    }

    if (setsIsBroken) {
      flagged = true;
      sets = 3; // reasonable safe middle ground, never a bare 0/1 default
    } else {
      sets = Math.max(1, Math.min(5, sets));
    }

    if (flagged) {
      console.warn(`Ramp back: corrected malformed recommendation for ${r.liftId}`, r);
      r.note = `(Adjusted — original AI recommendation was out of expected range) ${r.note || ''}`.trim();
    }

    r.weight = weight;
    r.sets = sets;
    return r;
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const prompt = body.prompt;
    const minIncrement = body.minIncrement || 5;
    const currentWeights = body.currentWeights || {};
    const lastFullWeights = body.lastFullWeights || {};

    if (!prompt) {
      throw new Error('No prompt provided');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Sonnet 5 has adaptive thinking on by default, which consumes part
        // of this budget invisibly before any output text is generated.
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
    }

    const data = await response.json();

    if (data.stop_reason === 'max_tokens') {
      throw new Error('Response was cut off (max_tokens reached) before completing — try again');
    }

    const textBlock = data.content?.find((c: any) => c.type === 'text');
    if (!textBlock || !textBlock.text) {
      throw new Error('No text content found in Claude response');
    }

    const text = textBlock.text.trim();
    const jsonStr = extractJson(text);
    let plan = JSON.parse(jsonStr);

    if (plan.recommendations) {
      plan.recommendations = validateRecommendations(
        plan.recommendations,
        minIncrement,
        currentWeights,
        lastFullWeights
      );
    }

    return new Response(JSON.stringify(plan), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Failed to generate ramp-back plan' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
