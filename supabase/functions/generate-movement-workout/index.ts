import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function roundToIncrement(weight: number, increment: number): number {
  return Math.round(weight / increment) * increment;
}

function snapWeights(workout: any, minIncrement: number): any {
  if (!workout.exercises) return workout;
  workout.exercises = workout.exercises.map((ex: any) => {
    if (ex.bodyweight || !ex.weight) return ex;
    ex.weight = Math.max(roundToIncrement(ex.weight, minIncrement), minIncrement);
    return ex;
  });
  return workout;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const prompt = body.prompt;
    const minIncrement = body.minIncrement || 5;

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
        // Sonnet 5's adaptive thinking consumes part of this budget
        // invisibly before any output text — bumped up to leave headroom
        // for a full workout (up to 5 exercises + optional MetCon) on top.
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

    // Sonnet 5 has adaptive thinking on by default, so content[0] may be a
    // "thinking" block rather than "text" — find the actual text block instead
    // of assuming position.
    const textBlock = data.content?.find((c: any) => c.type === 'text');
    if (!textBlock || !textBlock.text) {
      throw new Error('No text content found in Claude response');
    }

    const text = textBlock.text.trim();
    const jsonStr = extractJson(text);
    let workout = JSON.parse(jsonStr);

    workout = snapWeights(workout, minIncrement);

    return new Response(JSON.stringify(workout), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Failed to generate workout' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
