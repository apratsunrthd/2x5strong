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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    // Client sends pre-built prompt — use it directly
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    const data = await response.json();
    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    let workout = JSON.parse(clean);

    // Snap weights to minIncrement in code — don't trust Claude's math
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
