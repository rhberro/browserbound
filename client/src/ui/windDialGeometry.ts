/**
 * How a wind heading becomes a needle rotation.
 *
 * Pulled out of the signal it feeds so it can be tested against the physics it
 * is supposed to describe. A wind dial that points the wrong way is worse than
 * no dial at all — a player trusts it and aims into the drift — and the failure
 * is invisible in a screenshot, because a mirrored needle looks exactly as
 * plausible as a correct one.
 */

/**
 * Needle rotation in CSS degrees for a wind heading in radians.
 *
 * The identity conversion, deliberately: wind pushes a projectile by
 * `vx += magnitude * cos(angle)` and `vy += magnitude * sin(angle)` in a frame
 * where y grows DOWNWARD, and a CSS rotation is measured clockwise from
 * pointing right in that same frame. Heading zero is therefore a needle
 * pointing right and a shot drifting right, with no correction term. Any
 * negation or quarter-turn offset added here mirrors the dial against the drift
 * it reports.
 */
export function windRotationDeg(angleRadians: number): number {
  if (!Number.isFinite(angleRadians)) return 0;
  return (angleRadians * 180) / Math.PI;
}

/**
 * Unit vector the needle visually points along, in screen space (y down).
 * Exists so a test can compare where the needle points against where a
 * projectile actually drifts, rather than comparing one formula with itself.
 */
export function needleDirection(rotationDeg: number): { x: number; y: number } {
  const radians = (rotationDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}
