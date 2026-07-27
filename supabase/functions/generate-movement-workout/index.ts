import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function roundToIncrement(weight: number, increment: number): number {
  return Math.round(weight / increment) * increment;
}

function snapWeights(workout: any, minIncrement: number, weights: any): any {
  if (!workout.exercises) return workout;
  workout.exercises = workout.exercises.map((ex: any) => {
    if (ex.bodyweight || !ex.weight) return ex;
    // Snap to nearest minIncrement, minimum barWeight-equivalent (15lb)
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
    const prompt = body.prompt || buildPrompt(body);
    const minIncrement = body.minIncrement || 5;
    const weights = body.weights || {};

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

    // Snap all weights to minIncrement in code — don't trust Claude's math
    workout = snapWeights(workout, minIncrement, weights);

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

function buildPrompt(body: any): string {
  const { weights, recentSessions, minIncrement, lockedExercises = [] } = body;
  const lockedSection = lockedExercises.length > 0
    ? `The following exercises are already locked in and MUST NOT be replaced or duplicated: ${lockedExercises.join(', ')}.`
    : '';
  const remainingCount = 3 - lockedExercises.length;

  return `You are a strength and conditioning coach designing a "movement day" workout for an athlete who trains 2 days per week with barbell strength work and does cycling, running, and swimming on other days.

The athlete is having a low-energy day and needs a lighter session. Their current working weights are:
- Squat: ${weights.squat}lb
- Bench Press: ${weights.bench}lb
- Barbell Row: ${weights.row}lb
- Overhead Press: ${weights.press}lb
- Deadlift: ${weights.deadlift}lb

Recent sessions: ${recentSessions || 'No recent data'}.
${lockedSection}

Generate exactly ${remainingCount} exercise${remainingCount !== 1 ? 's' : ''} to complement the locked ones. Together the full workout must include at least one PUSH, one PULL, and one HIP HINGE.

Rules:
1. Loads should be 40-60% of their working weights, or bodyweight/light dumbbell/kettlebell alternatives
2. Rep scheme should be higher reps given as a range like "10-12"
3. May use barbells, dumbbells, kettlebells, or bodyweight
4. For each exercise include: name, sets, reps (as a range string e.g. "10-12"), suggested weight, and a one-line coaching note

Respond ONLY with valid JSON, no preamble, no markdown fences:
{
  "title": "Movement Day",
  "tagline": "short motivational line",
  "exercises": [
    {
      "name": "Exercise Name",
      "category": "Push|Pull|Hinge|Core",
      "sets": 3,
      "reps": "10-12",
      "weight": 95,
      "bodyweight": false,
      "note": "one-line coaching cue"
    }
  ]
}

If bodyweight, set bodyweight to true and weight to 0.`;
}
