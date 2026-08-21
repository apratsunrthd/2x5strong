import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Rate limit / spend cap ──────────────────────────────────────
// This function is a public link target (see The Assignment in
// docs/designs/graduate-from-stronglifts-positioning.md) — anyone who
// finds the link can hit it, so it needs its own cap independent of the
// Anthropic API key's account-level limits (that key is shared with
// generate-movement-workout, so a key-level cap would throttle both).
//
// $1/day is deliberately tight — this is a tripwire, not just a safety
// net: if real usage blows through it regularly, that's the signal to
// revisit monetization/mobile, not just raise the number.
const DAILY_REQUEST_LIMIT_PER_USER = 5;
const DAILY_SPEND_CAP_USD = 1.0;
// Standard (non-intro) Sonnet 5 pricing per million tokens — deliberately
// not the discounted intro rate, so this cap doesn't quietly loosen when
// the intro pricing window ends.
const INPUT_PRICE_PER_MTOK = 3.0;
const OUTPUT_PRICE_PER_MTOK = 15.0;

// Service-role client — bypasses RLS. This is required: the rate-limit
// tables have zero client-facing policies on purpose (see the migration),
// so only this key can read/write them.
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function capResponse(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

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
    // Identity comes from the JWT we verify ourselves — never from a
    // client-supplied field, which would be trivially spoofable. The
    // platform-level verify_jwt gate (supabase/config.toml) only checks
    // that the token is well-formed; it doesn't hand us a trustworthy
    // user id, so we ask Supabase Auth directly.
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const userId = authData.user.id;
    const day = todayUTC();

    // Per-user daily request count — read-then-write, not a single atomic
    // upsert. At this app's traffic volume a race between two concurrent
    // requests from the same user is an acceptable, deliberate simplification;
    // revisit with a proper atomic RPC if that stops being true.
    const { data: countRow } = await supabaseAdmin
      .from('rampback_request_counts')
      .select('count')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle();
    const priorCount = countRow?.count ?? 0;
    if (priorCount >= DAILY_REQUEST_LIMIT_PER_USER) {
      return capResponse('Daily ramp-back limit reached for your account — try again tomorrow.');
    }

    // Global daily spend cap — checked before spending anything more today.
    const { data: spendRow } = await supabaseAdmin
      .from('rampback_daily_spend')
      .select('spend_usd')
      .eq('day', day)
      .maybeSingle();
    const priorSpend = Number(spendRow?.spend_usd ?? 0);
    if (priorSpend >= DAILY_SPEND_CAP_USD) {
      return capResponse('Daily ramp-back budget reached — try again tomorrow.');
    }

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

    // Record spend/count as soon as we know the call happened and was
    // billed — a truncated or unparseable response still cost money, so
    // this must not be skipped by a later throw.
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const costUsd =
      (inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK +
      (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK;

    await supabaseAdmin
      .from('rampback_request_counts')
      .upsert({ user_id: userId, day, count: priorCount + 1 }, { onConflict: 'user_id,day' });
    await supabaseAdmin
      .from('rampback_daily_spend')
      .upsert({ day, spend_usd: priorSpend + costUsd }, { onConflict: 'day' });

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
