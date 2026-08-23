// ============================================================
// lib.js — Pure logic helpers (no DOM, no Supabase — safe to unit test)
// ============================================================

// ── Deadlift progression rules ───────────────────────────────
// Under 225lb: 5×5, +10lb per session
// 225lb and over: 1×5, +5lb per session
export const DEADLIFT_HEAVY_THRESHOLD = 225;

export function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function roundToIncrement(weight, minIncrement) {
  return Math.round(weight / minIncrement) * minIncrement;
}

// Effective increment for a lift: natural increment floored up to minIncrement
export function effectiveIncrement(naturalIncrement, minIncrement) {
  return Math.max(naturalIncrement, minIncrement);
}

export function deadliftSetsCount(weight) {
  return weight >= DEADLIFT_HEAVY_THRESHOLD ? 1 : 5;
}

export function deadliftIncrement(weight) {
  return weight >= DEADLIFT_HEAVY_THRESHOLD ? 5 : 10;
}

// ── Rep counting helpers ──────────────────────────────────────

// A set is "failed" if it was recorded and got fewer than 5 reps
export function setFailed(val) { return val !== null && val < 5; }
export function setDone(val)   { return val === 5; }

// Count consecutive failed sets from the end of recorded sets
export function consecutiveFails(sets) {
  let count = 0;
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i] === null) break;      // unrecorded — stop
    if (setFailed(sets[i])) count++;
    else break;                        // a passing set breaks the streak
  }
  return count;
}

// Parse the max reps from a range string like "10-12" → 12, or "10" → 10.
// Falls back to 10 when nothing parses (e.g. "amrap", "") — Math.max() on an
// empty array is -Infinity, which is truthy, so `|| 10` alone doesn't catch it,
// and Number('') is 0 (not NaN), so an empty string needs its own guard.
export function parseMaxReps(repsStr) {
  const str = String(repsStr).trim();
  if (!str) return 10;
  const parts = str.split('-').map(Number).filter(n => !isNaN(n));
  return parts.length ? Math.max(...parts) : 10;
}

// Cycle: null → maxReps → maxReps-1 → ... → 0 → null
export function cycleMovementRep(current, maxReps) {
  if (current === null) return maxReps;
  if (current === 0)    return null;
  return current - 1;
}
