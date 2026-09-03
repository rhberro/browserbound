import { describe, it, expect } from 'vitest';
import { advanceTimer, windupElapsed, fallDelayElapsed, nextFallSpeed } from '../gait';
import {
  WALK_WINDUP_MS,
  FALL_DELAY_MS,
  FALL_INITIAL_SPEED,
  FALL_ACCEL,
  TERMINAL_VELOCITY,
  MOVE_STEPS,
  WALK_STEP_PX,
} from '@browserbond/shared';

/** The server's fixed simulation tick. */
const TICK = 16;

describe('walk wind-up', () => {
  it('takes no step on the first tick a direction is held', () => {
    expect(windupElapsed(advanceTimer(0, TICK))).toBe(false);
  });

  it('takes its first step once WALK_WINDUP_MS has passed', () => {
    let held = 0;
    let ticks = 0;
    while (!windupElapsed(held)) {
      held = advanceTimer(held, TICK);
      ticks++;
    }
    expect(ticks).toBe(Math.ceil(WALK_WINDUP_MS / TICK));
  });

  it('steps on EVERY tick after the first, because the timer is never reset by a step', () => {
    // The failure this guards: resetting the accumulator per step turns the
    // wind-up into a per-step delay and the character into a 10px/s crawler.
    let held = 0;
    const TICKS = 60;
    let steps = 0;
    for (let i = 0; i < TICKS; i++) {
      held = advanceTimer(held, TICK);
      if (windupElapsed(held)) steps++;
    }
    const windupTicks = Math.ceil(WALK_WINDUP_MS / TICK);
    expect(steps).toBe(TICKS - windupTicks + 1);
  });

  it('walks close to 60px/s once wound up, in whole pixels', () => {
    // Integer steps are the point: a fractional px/tick rate emits a
    // 2,2,2,1 pattern that reads as jitter under 20Hz patching.
    const pxPerSecond = (1000 / TICK) * WALK_STEP_PX;
    expect(Number.isInteger(WALK_STEP_PX)).toBe(true);
    expect(pxPerSecond).toBeGreaterThan(55);
    expect(pxPerSecond).toBeLessThan(70);
  });

  it('spends a whole turn of budget in a bounded, sane number of seconds', () => {
    const seconds = (MOVE_STEPS * TICK) / 1000;
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(5);
  });
});

describe('fall delay', () => {
  it('hangs before gravity engages', () => {
    expect(fallDelayElapsed(0)).toBe(false);
    expect(fallDelayElapsed(advanceTimer(0, TICK))).toBe(false);
  });

  it('engages once FALL_DELAY_MS has passed', () => {
    let hung = 0;
    let ticks = 0;
    while (!fallDelayElapsed(hung)) {
      hung = advanceTimer(hung, TICK);
      ticks++;
    }
    expect(ticks).toBe(Math.ceil(FALL_DELAY_MS / TICK));
  });
});

describe('fall speed', () => {
  it('starts at FALL_INITIAL_SPEED rather than creeping up from zero', () => {
    expect(nextFallSpeed(0)).toBe(FALL_INITIAL_SPEED);
  });

  it('treats a cleared velocity as a fresh fall', () => {
    // Landing and knockback both zero vy; the next fall must start at speed.
    expect(nextFallSpeed(0)).toBe(FALL_INITIAL_SPEED);
    expect(nextFallSpeed(-2)).toBe(FALL_INITIAL_SPEED);
  });

  it('accelerates by FALL_ACCEL per tick', () => {
    expect(nextFallSpeed(FALL_INITIAL_SPEED)).toBeCloseTo(FALL_INITIAL_SPEED + FALL_ACCEL, 10);
  });

  it('clamps at TERMINAL_VELOCITY', () => {
    let vy = FALL_INITIAL_SPEED;
    for (let i = 0; i < 500; i++) vy = nextFallSpeed(vy);
    expect(vy).toBe(TERMINAL_VELOCITY);
  });
});
