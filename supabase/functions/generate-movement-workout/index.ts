import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { weights, recentSessions, minIncrement } = await req.json();

    const prompt = `You are a strength and conditioning coach designing a "movement day" workout for an athlete who trains 2 days per week with barbell strength work and does cycling, running, and swimming on other days.

The athlete is having a low-energy day and needs a lighter session. Their current working weights are:
- Squat: ${weights.squat}lb
- Bench Press: ${weights.bench}lb
- Barbell Row: ${weights.row}lb
- Overhead Press: ${weights.press}lb
- Deadlift: ${weights.deadlift}lb

Their minimum weight increment is ${minIncrement}lb.

Recent sessions: ${recentSessions || 'No recent data'}.

Design a movement day workout with these rules:
1. Must include one PUSH, one PULL, and one HIP HINGE movement
2. Loads should be 40-60% of their working weights, or bodyweight/light dumbbell/kettlebell alternatives
3. Rep scheme should be higher reps (8-15) at lower intensity — this is about moving well, not grinding
4. May use barbells, dumbbells, kettlebells, or bodyweight — choose what makes sense for the movement
5. Keep it to 3-4 exercises total, no more
6. For each exercise include: name, sets, reps, suggested weight (if applicable), and a one-line coaching note

Respond ONLY with a valid JSON object in exactly this format, no preamble, no markdown:
{
  "title": "Movement Day",
  "tagline": "short motivational line about moving well today",
  "exercises": [
    {
      "name": "Exercise Name",
      "category": "Push|Pull|Hinge|Core",
      "sets": 3,
      "reps": "10-12",
      "weight": 95,
      "weightLabel": "lb",
      "bodyweight": false,
      "note": "one-line coaching cue"
    }
  ]
}

If the exercise is bodyweight, set bodyweight to true and weight to 0.
If it's a kettlebell/dumbbell, use a reasonable weight based on their barbell numbers.
Round all weights to the nearest ${minIncrement}lb.`;

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

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    // Strip any accidental markdown fences
    const clean = text.replace(/```json|```/g, '').trim();
    const workout = JSON.parse(clean);

    return new Response(JSON.stringify(workout), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Failed to generate workout' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
