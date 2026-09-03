/**
 * The one conversion from a world-absolute aim angle to a world firing
 * direction.
 *
 * Aim is measured from the horizontal, in the direction the character faces:
 * 0 is level, positive is up, and the same 45° means the same 45° whatever the
 * slope under the character. That was not always true — ADR 0003 originally
 * measured aim against the tilted chassis, then amended itself when that made
 * the displayed number lie about where the shot would go.
 *
 * The only transform left is the facing mirror, and a facing flip is exactly
 * the kind of thing that gets hand-written twice and drifts — so it lives here,
 * once, and both the server's fire path and the client's aim line go through
 * it.
 */

import { AIM_MIN_DEG, AIM_MAX_DEG } from './types';

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Confine a world-absolute aim angle, in degrees, to the permitted range.
 *
 * Out-of-range aim is CLAMPED, never rejected: ADR 0003 rules out a fire button
 * that silently does nothing, so the barrel stops moving instead.
 *
 * A non-finite angle resolves to zero — the horizontal — rather than
 * propagating NaN, which `Math.max`/`Math.min` would otherwise pass straight
 * through. Zero, not the arithmetic midpoint of the range: the point is to land
 * somewhere a player can recognise and correct from, and level is the only
 * angle in the range that means something on its own.
 */
export function clampAimDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(AIM_MIN_DEG, Math.min(AIM_MAX_DEG, deg));
}

export interface AimFrame {
  /**
   * Aim in radians, measured from the horizontal in the facing direction:
   * 0 is level, positive is upward, negative is downward.
   */
  aimAngle: number;
  /** 1 = facing right, -1 = facing left. */
  facing: number;
}

/**
 * World firing direction in radians, in the y-UP frame the projectile
 * emitter uses (`vx = speed * cos a`, `vy = -speed * sin a`).
 *
 * The only transform is the facing mirror: a right-facing character fires at
 * `aim` (0 = right, π/2 = up), a left-facing one at `π - aim`, so the same
 * dialled 45° leaves up-left instead of up-right.
 */
export function worldFiringAngle(frame: AimFrame): number {
  const aim = Number.isFinite(frame.aimAngle) ? frame.aimAngle : 0;
  return frame.facing === -1 ? Math.PI - aim : aim;
}
