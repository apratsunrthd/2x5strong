import { describe, it, expect } from 'vitest';
import {
  DEADLIFT_HEAVY_THRESHOLD, formatTime, roundToIncrement, effectiveIncrement,
  deadliftSetsCount, deadliftIncrement, setFailed, setDone, consecutiveFails,
  parseMaxReps, cycleMovementRep,
} from '../js/lib.js';

describe('formatTime', () => {
  it('pads minutes and seconds to two digits', () => {
    expect(formatTime(65)).toBe('01:05');
  });
  it('handles zero', () => {
    expect(formatTime(0)).toBe('00:00');
  });
  it('rolls over past an hour without a wraparound bug', () => {
    // 3661s = 61m 1s -> formatTime doesn't cap minutes at 60, it just keeps counting
    expect(formatTime(3661)).toBe('61:01');
  });
});

describe('roundToIncrement', () => {
  it('rounds to the nearest plate increment', () => {
    expect(roundToIncrement(103, 5)).toBe(105);
    expect(roundToIncrement(102, 5)).toBe(100);
  });
  it('is a no-op when already on-increment', () => {
    expect(roundToIncrement(100, 5)).toBe(100);
  });
});

describe('effectiveIncrement', () => {
  it('uses the lift increment when it already clears the minimum', () => {
    expect(effectiveIncrement(10, 5)).toBe(10);
  });
  it('floors up to the minimum increment when the lift increment is smaller', () => {
    expect(effectiveIncrement(2.5, 5)).toBe(5);
  });
});

describe('deadliftSetsCount / deadliftIncrement', () => {
  it('uses 5x5 / +10lb below the heavy threshold', () => {
    expect(deadliftSetsCount(DEADLIFT_HEAVY_THRESHOLD - 1)).toBe(5);
    expect(deadliftIncrement(DEADLIFT_HEAVY_THRESHOLD - 1)).toBe(10);
  });
  it('switches to 1x5 / +5lb at and above the heavy threshold', () => {
    expect(deadliftSetsCount(DEADLIFT_HEAVY_THRESHOLD)).toBe(1);
    expect(deadliftIncrement(DEADLIFT_HEAVY_THRESHOLD)).toBe(5);
  });
});

describe('setFailed / setDone', () => {
  it('treats an unrecorded set (null) as neither failed nor done', () => {
    expect(setFailed(null)).toBe(false);
    expect(setDone(null)).toBe(false);
  });
  it('treats fewer than 5 reps as failed', () => {
    expect(setFailed(4)).toBe(true);
    expect(setFailed(0)).toBe(true);
  });
  it('treats exactly 5 reps as done, not failed', () => {
    expect(setFailed(5)).toBe(false);
    expect(setDone(5)).toBe(true);
  });
});

describe('consecutiveFails', () => {
  it('counts failed sets back from the end until a pass or gap', () => {
    expect(consecutiveFails([5, 3, 2, 1])).toBe(3);
  });
  it('stops counting at the first passing set from the end', () => {
    expect(consecutiveFails([2, 3, 5])).toBe(0);
  });
  it('stops at the first unrecorded (null) set walking backwards', () => {
    expect(consecutiveFails([5, 3, null, 2])).toBe(1);
  });
  it('returns 0 for an all-null (untouched) session', () => {
    expect(consecutiveFails([null, null, null])).toBe(0);
  });
  it('returns 0 for an empty sets array', () => {
    expect(consecutiveFails([])).toBe(0);
  });
});

describe('parseMaxReps', () => {
  it('takes the top of a rep range', () => {
    expect(parseMaxReps('10-12')).toBe(12);
  });
  it('handles a single rep count', () => {
    expect(parseMaxReps('8')).toBe(8);
  });
  it('falls back to 10 when nothing parses', () => {
    expect(parseMaxReps('amrap')).toBe(10);
  });
  it('falls back to 10 for an empty or whitespace-only string', () => {
    expect(parseMaxReps('')).toBe(10);
    expect(parseMaxReps('  ')).toBe(10);
  });
});

describe('cycleMovementRep', () => {
  it('starts a null (untouched) set at the max reps', () => {
    expect(cycleMovementRep(null, 10)).toBe(10);
  });
  it('counts down by one each cycle', () => {
    expect(cycleMovementRep(10, 10)).toBe(9);
    expect(cycleMovementRep(1, 10)).toBe(0);
  });
  it('wraps 0 back around to null (untouched)', () => {
    expect(cycleMovementRep(0, 10)).toBe(null);
  });
});
