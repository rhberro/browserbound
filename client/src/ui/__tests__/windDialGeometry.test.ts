import { describe, it, expect } from 'vitest';
import { windRotationDeg, needleDirection } from '../windDialGeometry';
import { GRAVITY, WIND_INTEGRATION } from '@browserbond/shared';
import { PhysicsAdapter } from '@browserbond/shared/src/adapters/PhysicsAdapter';

/** The drift one frame of wind alone puts on a projectile at rest. */
function drift(angle: number): { x: number; y: number } {
  const physics = new PhysicsAdapter({ gravity: GRAVITY, windIntegration: WIND_INTEGRATION });
  const proj = { x: 0, y: 0, vx: 0, vy: 0 };
  physics.updateAllProjectiles([proj], { magnitude: 0.5, angle });
  // Gravity acts on the same frame and is not the wind's doing; remove it so
  // what is left is the push the dial claims to be showing.
  return { x: proj.x, y: proj.y - GRAVITY };
}

describe('wind dial needle', () => {
  it('points where the shot actually drifts', () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 5.5]) {
      const needle = needleDirection(windRotationDeg(angle));
      const push = drift(angle);
      const length = Math.hypot(push.x, push.y);

      expect(needle.x).toBeCloseTo(push.x / length, 6);
      expect(needle.y).toBeCloseTo(push.y / length, 6);
    }
  });

  it('points right for wind blowing right', () => {
    expect(needleDirection(windRotationDeg(0))).toEqual({ x: 1, y: expect.closeTo(0, 6) });
    expect(drift(0).x).toBeGreaterThan(0);
  });

  it('points left for wind blowing left', () => {
    const needle = needleDirection(windRotationDeg(Math.PI));
    expect(needle.x).toBeCloseTo(-1, 6);
    expect(drift(Math.PI).x).toBeLessThan(0);
  });

  it('survives a non-finite heading rather than rotating to NaN', () => {
    expect(windRotationDeg(Number.NaN)).toBe(0);
  });
});
