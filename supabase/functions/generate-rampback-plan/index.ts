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
        // Sonnet 5 has adaptive thinking on by default, which consumes part
        // of this budget invisibly before any output text is generated.
        // With 5 lifts worth of reasoning this was truncating mid-JSON at
        // 1536 — bumped well above what thinking + a full response needs.
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
    }

    const data = await response.json();

    // Surface truncation explicitly rather than letting JSON.parse fail
    // with a confusing error further down.
    if (data.stop_reason === 'max_tokens') {
      throw new Error('Response was cut off (max_tokens reached) before completing — try again');
    }

    // Sonnet 5 adaptive thinking means content[0] may not be text — find the text block
    const textBlock = data.content?.find((c: any) => c.type === 'text');
    if (!textBlock || !textBlock.text) {
      throw new Error('No text content found in Claude response');
    }

    const text = textBlock.text.trim();
    const jsonStr = extractJson(text);
    let plan = JSON.parse(jsonStr);

    // Snap all recommended weights to minIncrement in code
    if (plan.recommendations) {
      plan.recommendations = plan.recommendations.map((r: any) => {
        r.weight = Math.max(roundToIncrement(r.weight, minIncrement), minIncrement);
        r.sets = Math.max(1, Math.min(5, Math.round(r.sets)));
        return r;
      });
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
