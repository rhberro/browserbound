import { describe, it, expect } from 'vitest';
import { worldFiringAngle, clampAimDeg, degToRad } from '../aim';
import { AIM_MIN_DEG, AIM_MAX_DEG } from '../types';

/** Angles are compared modulo 2π and to within a hair of floating-point noise. */
function expectAngle(actual: number, expected: number) {
  const diff = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
  expect(Math.abs(diff)).toBeLessThan(1e-9);
}

const deg = (d: number) => (d * Math.PI) / 180;

describe('clampAimDeg', () => {
  it('passes an in-range angle through', () => {
    expect(clampAimDeg(45)).toBe(45);
  });

  it('clamps to the permitted range rather than rejecting', () => {
    // ADR 0003: firing is never blocked, the barrel just stops moving.
    expect(clampAimDeg(999)).toBe(AIM_MAX_DEG);
    expect(clampAimDeg(-999)).toBe(AIM_MIN_DEG);
  });

  it('allows the twenty degrees below the horizontal the range permits', () => {
    expect(clampAimDeg(-20)).toBe(-20);
  });

  it('resolves a non-finite angle to the middle of the range rather than NaN', () => {
    expect(clampAimDeg(NaN)).toBe(0);
    expect(clampAimDeg(Infinity)).toBe(0);
    expect(clampAimDeg(undefined as never)).toBe(0);
  });
});

describe('worldFiringAngle', () => {
  describe('on level ground', () => {
    it('fires at the aim angle when facing right', () => {
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: deg(45), facing: 1 }), deg(45));
    });

    it('mirrors about the vertical when facing left', () => {
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: deg(45), facing: -1 }), deg(135));
    });

    it('fires level at zero aim, both ways', () => {
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: 0, facing: 1 }), 0);
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: 0, facing: -1 }), Math.PI);
    });

    it('fires straight up at the top of the range, both ways', () => {
      const up = deg(AIM_MAX_DEG);
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: up, facing: 1 }), deg(90));
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: up, facing: -1 }), deg(90));
    });

    it('fires below the horizontal at the bottom of the range, both ways', () => {
      const down = deg(AIM_MIN_DEG);
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: down, facing: 1 }), deg(-20));
      expectAngle(worldFiringAngle({ tilt: 0, aimAngle: down, facing: -1 }), deg(200));
    });
  });

  describe('on sloped ground', () => {
    // computeTilt is measured in SCREEN space, where y grows downward, so
    // ground rising to the right is a NEGATIVE tilt. The firing frame is
    // y-up. The chassis rotation in the firing frame is therefore -tilt, and
    // getting that sign wrong is invisible on level ground and wrong
    // everywhere else.
    const risingRight = deg(-30);
    const risingLeft = deg(30);

    it('steepens a downhill-facing shot on ground rising to the right', () => {
      // Facing right is facing UP the slope: the chassis leans back, so a
      // barrel 45 degrees off the chassis leaves 30 degrees higher.
      expectAngle(worldFiringAngle({ tilt: risingRight, aimAngle: deg(45), facing: 1 }), deg(75));
    });

    it('flattens a shot fired down the same slope', () => {
      // Facing left on ground rising to the right is facing downhill: the same
      // chassis rotation carries the mirrored barrel the other way.
      expectAngle(worldFiringAngle({ tilt: risingRight, aimAngle: deg(45), facing: -1 }), deg(165));
    });

    it('is the mirror image on the opposite slope', () => {
      expectAngle(worldFiringAngle({ tilt: risingLeft, aimAngle: deg(45), facing: 1 }), deg(15));
      expectAngle(worldFiringAngle({ tilt: risingLeft, aimAngle: deg(45), facing: -1 }), deg(105));
    });

    it('rotates the chassis rather than adding tilt to the barrel', () => {
      // The convention this function replaces added tilt to the aim angle and
      // then mirrored the SUM for facing. That is wrong in a way designed to
      // survive review: the mirror negates the tilt term as a side effect, so
      // the two conventions AGREE exactly for a left-facing character and
      // disagree by twice the tilt for a right-facing one. Half the cases
      // looked fine, which is why it lasted.
      const aim = deg(45);
      const naive = (tilt: number, facing: number) =>
        facing === -1 ? Math.PI - (tilt + aim) : tilt + aim;

      expectAngle(worldFiringAngle({ tilt: risingRight, aimAngle: aim, facing: -1 }), naive(risingRight, -1));

      const correctRight = worldFiringAngle({ tilt: risingRight, aimAngle: aim, facing: 1 });
      expect(correctRight - naive(risingRight, 1)).toBeCloseTo(-2 * risingRight, 9);
    });

    it('keeps the chassis-relative measurement constant as tilt changes', () => {
      // The whole point of ADR 0003: walking onto different ground moves the
      // real-world firing direction and leaves the dialled-in angle alone.
      const aim = deg(45);
      const flat = worldFiringAngle({ tilt: 0, aimAngle: aim, facing: 1 });
      const sloped = worldFiringAngle({ tilt: deg(-10), aimAngle: aim, facing: 1 });
      expectAngle(sloped - flat, deg(10));
    });
  });

  it('treats a non-finite input as level and unaimed rather than producing NaN', () => {
    expect(Number.isFinite(worldFiringAngle({ tilt: NaN, aimAngle: deg(45), facing: 1 }))).toBe(
      true
    );
    expect(Number.isFinite(worldFiringAngle({ tilt: 0, aimAngle: NaN, facing: 1 }))).toBe(true);
  });
});

describe('degToRad', () => {
  it('converts', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(degToRad(AIM_MIN_DEG)).toBeCloseTo(-Math.PI / 9, 12);
  });
});
