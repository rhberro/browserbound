/**
 * The walk cadence and the fall cadence — when a held direction produces a
 * step, and when a fall starts moving.
 *
 * Extracted from the simulation loop for the same reason `turnLoop` was: both
 * rules read as one line, both are accumulator rules whose reset condition is
 * the entire behaviour, and both are invisible to inspection when wrong. The
 * wind-up in particular has a failure mode that looks like a working game —
 * reset it in the wrong place and characters walk at a sixth of their speed,
 * which reads as "movement feels sluggish" rather than as a bug.
 */

import { WALK_WINDUP_MS, FALL_DELAY_MS, FALL_INITIAL_SPEED, FALL_ACCEL, TERMINAL_VELOCITY } from '@browserbond/shared';

/**
 * One tick's worth of elapsed time added to an accumulator. Shared by the walk
 * wind-up and the fall hang, which are the same shape: time accrues, a
 * threshold opens the gate, and WHERE THE ACCUMULATOR IS CLEARED is the entire
 * behaviour.
 *
 * For the wind-up that clearing is deliberately NOT on taking a step. GunBound
 * accumulates `sidewaysDelayTimer` and clears it only when the key comes up, so
 * the delay is a one-time hesitation on key-down followed by a steady 1px/tick
 * crawl. Clearing it per step instead turns a 60px/s character into a 10px/s
 * one — the same code, the same constant, a sixth of the speed.
 */
export function advanceTimer(heldMs: number, tickMs: number): number {
  return heldMs + tickMs;
}

/** Has a held direction earned its first step yet? */
export function windupElapsed(heldMs: number): boolean {
  return heldMs >= WALK_WINDUP_MS;
}

/**
 * Has an unsupported character hung long enough for gravity to engage?
 *
 * The hang is what makes ground collapsing underfoot read as a beat rather than
 * a snap. It is per contiguous fall: landing clears it, and so does a fresh
 * blast, so a character shot off a ledge gets the same beat as one whose ground
 * vanished.
 */
export function fallDelayElapsed(hungMs: number): boolean {
  return hungMs >= FALL_DELAY_MS;
}

/**
 * Fall speed for the next tick, in pixels.
 *
 * A fall STARTS at `FALL_INITIAL_SPEED` rather than accelerating up from zero,
 * so the drop is immediately legible instead of creeping into motion. From
 * there it gains `FALL_ACCEL` per tick, clamped — GunBound has no terminal
 * velocity, but an unbounded fall speed is a tunnelling risk we would rather
 * not carry for the sake of exactness on a value no player can perceive.
 */
export function nextFallSpeed(vy: number): number {
  if (vy <= 0) return FALL_INITIAL_SPEED;
  return Math.min(vy + FALL_ACCEL, TERMINAL_VELOCITY);
}
