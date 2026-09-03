import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHoldRepeat,
  repeatIntervalMs,
  HOLD_REPEAT_DELAY_MS,
  FLAT_REPEAT_INTERVAL_MS,
  RAMP_INITIAL_INTERVAL_MS,
  RAMP_DECREMENT_MS,
  RAMP_MIN_INTERVAL_MS,
} from '../useHoldRepeat';

describe('repeatIntervalMs', () => {
  it('holds a flat interval when not accelerating', () => {
    for (const index of [0, 1, 5, 500]) {
      expect(repeatIntervalMs(index, false)).toBe(FLAT_REPEAT_INTERVAL_MS);
    }
  });

  it('starts at the initial interval and reduces by one decrement per repeat', () => {
    expect(repeatIntervalMs(0, true)).toBe(RAMP_INITIAL_INTERVAL_MS);
    expect(repeatIntervalMs(1, true)).toBe(RAMP_INITIAL_INTERVAL_MS - RAMP_DECREMENT_MS);
    expect(repeatIntervalMs(2, true)).toBe(RAMP_INITIAL_INTERVAL_MS - 2 * RAMP_DECREMENT_MS);
  });

  it('floors at the minimum interval and never goes below it', () => {
    const stepsToFloor = Math.ceil(
      (RAMP_INITIAL_INTERVAL_MS - RAMP_MIN_INTERVAL_MS) / RAMP_DECREMENT_MS
    );
    expect(repeatIntervalMs(stepsToFloor, true)).toBe(RAMP_MIN_INTERVAL_MS);
    expect(repeatIntervalMs(stepsToFloor + 1, true)).toBe(RAMP_MIN_INTERVAL_MS);
    expect(repeatIntervalMs(10_000, true)).toBe(RAMP_MIN_INTERVAL_MS);
  });

  it('is monotonically non-increasing, so a hold never slows down', () => {
    let previous = Infinity;
    for (let i = 0; i < 60; i++) {
      const interval = repeatIntervalMs(i, true);
      expect(interval).toBeLessThanOrEqual(previous);
      previous = interval;
    }
  });
});

describe('createHoldRepeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('steps exactly once for a tap, however short', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    expect(step).toHaveBeenCalledTimes(1);

    repeat.stop();
    vi.advanceTimersByTime(10_000);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('waits out the hold delay before the first auto-repeat', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS - 1);
    expect(step).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('accelerates along the ramp schedule while held', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(step).toHaveBeenCalledTimes(2);

    // Each subsequent repeat must land exactly on its scheduled interval.
    for (let i = 1; i < 8; i++) {
      const interval = repeatIntervalMs(i - 1, true);
      vi.advanceTimersByTime(interval - 1);
      expect(step).toHaveBeenCalledTimes(1 + i);
      vi.advanceTimersByTime(1);
      expect(step).toHaveBeenCalledTimes(2 + i);
    }
  });

  it('reaches the floor and keeps firing at it', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    // Long enough to exhaust the ramp entirely.
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + 5_000);

    const atFloor = step.mock.calls.length;
    vi.advanceTimersByTime(RAMP_MIN_INTERVAL_MS * 10);
    expect(step.mock.calls.length - atFloor).toBe(10);
  });

  it('resets the ramp on release, so a re-press starts slow again', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + 5_000);
    repeat.stop();

    step.mockClear();
    repeat.start();
    expect(step).toHaveBeenCalledTimes(1);

    // Back at the top of the ramp: the slow initial interval, not the floor.
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RAMP_INITIAL_INTERVAL_MS - 1);
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it('keeps the flat cadence when the ramp is not opted into', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step());

    repeat.start();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(step).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(FLAT_REPEAT_INTERVAL_MS);
    }
    expect(step).toHaveBeenCalledTimes(22);
  });

  it('does not stack repeats when start is called twice without a stop', () => {
    const step = vi.fn();
    const repeat = createHoldRepeat(() => step(), { accelerate: true });

    repeat.start();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + 500);
    step.mockClear();

    repeat.start();
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('reads the latest step callback, not the one captured at construction', () => {
    let latest = vi.fn();
    const repeat = createHoldRepeat(() => latest(), { accelerate: true });

    const second = vi.fn();
    repeat.start();
    latest = second;
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
