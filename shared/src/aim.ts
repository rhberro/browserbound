/**
 * The one conversion from a chassis-relative aim angle to a world firing
 * direction.
 *
 * ADR 0003 makes aim a measurement against the tilted body rather than against
 * the world, and warns that a facing flip and a chassis rotation are different
 * transforms which agree only on level ground — they disagree everywhere else,
 * quietly. That is exactly the kind of thing that gets hand-written twice and
 * drifts, so it lives here, once, and both the server's fire path and the
 * client's aim line go through it.
 */

import { AIM_MIN_DEG, AIM_MAX_DEG } from './types';

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Confine a chassis-relative aim angle, in degrees, to the permitted range.
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
   * Chassis tilt in radians as `computeTilt` measures it — SCREEN space, where
   * y grows downward, so ground rising to the right is negative.
   */
  tilt: number;
  /** Aim in radians, measured relative to the chassis, in the facing direction. */
  aimAngle: number;
  /** 1 = facing right, -1 = facing left. */
  facing: number;
}

/**
 * World firing direction in radians, in the y-UP frame the projectile
 * emitter uses (`vx = speed * cos a`, `vy = -speed * sin a`).
 *
 * Two sign traps live here, and both are invisible on flat ground:
 *
 * 1. Tilt is measured with y growing downward but firing angles are measured
 *    with y growing upward, so the chassis rotation in the firing frame is
 *    `-tilt`, not `+tilt`.
 * 2. Facing is a mirror of the BARREL within the chassis frame, applied before
 *    the chassis rotation. Mirroring the finished world angle instead — the
 *    tempting `PI - (tilt + aim)` — negates the tilt term as a side effect, so
 *    a left-facing character on a slope leans the wrong way by twice the tilt.
 */
export function worldFiringAngle(frame: AimFrame): number {
  const tilt = Number.isFinite(frame.tilt) ? frame.tilt : 0;
  const aim = Number.isFinite(frame.aimAngle) ? frame.aimAngle : 0;

  // Mirror the barrel inside the chassis frame first...
  const barrel = frame.facing === -1 ? Math.PI - aim : aim;
  // ...then rotate the whole chassis into the world.
  return barrel - tilt;
}

/**
 * The aim angle the HUD shows, in degrees: the barrel's elevation above the
 * horizontal, in the direction the character faces.
 *
 * Aim is stored chassis-relative (ADR 0003), so a tilted chassis shifts the
 * world elevation by its tilt — `aim - tilt` facing right, `aim + tilt` facing
 * left — because tilt is measured in screen space (y down) while elevation is
 * measured in the world. On a steep enough slope the result can leave
 * [AIM_MIN_DEG, AIM_MAX_DEG]; that is correct: the number reports where the
 * barrel actually points, not the dial position.
 */
export function worldAimDeg(aimDeg: number, tiltRad: number, facing: number): number {
  const tiltDeg = (Number.isFinite(tiltRad) ? tiltRad : 0) * (180 / Math.PI);
  return (Number.isFinite(aimDeg) ? aimDeg : 0) - facing * tiltDeg;
}
