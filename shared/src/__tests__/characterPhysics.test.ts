import { describe, it, expect } from 'vitest';
import {
  isSolid,
  surfaceAhead,
  groundDistance,
  isGrounded,
  ejectUp,
  walkStep,
  computeTilt,
  pointInBody,
  Body,
  WalkResult,
} from '../characterPhysics';
import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  STEP_UP_LIMIT,
  STEP_DOWN_LIMIT,
  EJECT_UP_LIMIT,
  TILT_OFFSET_X,
} from '../types';

const W = 200;
const H = 400;

/**
 * Rasterise a mask from a per-column ground height. `heights[x]` is the y of
 * the first solid pixel in that column; everything below is solid. A height of
 * `Infinity` (or >= H) means the column is empty — a hole all the way down.
 *
 * `ceilings[x]`, when given, makes every row STRICTLY ABOVE that y solid too
 * (a roof hanging over the column).
 */
function makeMask(heights: number[], ceilings?: number[]): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    const ground = heights[x] ?? Infinity;
    for (let y = 0; y < H; y++) {
      const solid = y >= ground || (ceilings ? y < (ceilings[x] ?? -1) : false);
      if (solid) mask[y * W + x] = 1;
    }
  }
  return mask;
}

/** Flat ground at `y`, everywhere. */
function flat(y: number): number[] {
  return new Array(W).fill(y);
}

/** Flat ground at `y`, stepping to `y - rise` from column `at` rightward. */
function lip(y: number, at: number, rise: number): number[] {
  return Array.from({ length: W }, (_, x) => (x >= at ? y - rise : y));
}

/**
 * A constant-gradient slope rising to the RIGHT from column `at`, expressed as
 * rise-per-pixel — the same unit `STEP_UP_LIMIT` is in, so the tests read in
 * the units the model is actually defined in. Not clamped: callers pick a base
 * and a run that keep the slope inside the map, because a slope that hits the
 * ceiling silently becomes a plateau and asserts nothing.
 */
function slope(y: number, at: number, gradient: number): number[] {
  return Array.from({ length: W }, (_, x) => (x >= at ? Math.round(y - gradient * (x - at)) : y));
}

/**
 * Walk a body along a mask exactly the way the server's physics loop does —
 * eject, then step — and report how far it actually got. This pairing is the
 * thing under test: each half is fine alone, and it was their interaction that
 * pinned characters to the bottom of every hill under the old box model.
 */
function walkRun(
  mask: Uint8Array,
  b: Body,
  dir: number,
  steps: number
): { advanced: number; result: WalkResult } {
  const startX = b.x;
  let result: WalkResult = 'moved';
  for (let i = 0; i < steps; i++) {
    ejectUp(mask, W, H, b);
    result = walkStep(mask, W, H, b, dir);
    if (result !== 'moved') break;
  }
  return { advanced: Math.abs(b.x - startX), result };
}

const body = (x: number, y: number): Body => ({ x, y });

/**
 * A body standing at column `x`. Terrain contact is a POINT, so this is simply
 * the surface of that one column — no foot line, no highest-ground-wins.
 */
function standOn(heights: number[], x: number): Body {
  return { x, y: heights[x] };
}

describe('isSolid', () => {
  const mask = makeMask(flat(100));

  it('reads a solid pixel', () => {
    expect(isSolid(mask, W, H, 50, 100)).toBe(true);
    expect(isSolid(mask, W, H, 50, H - 1)).toBe(true);
  });

  it('reads an empty pixel', () => {
    expect(isSolid(mask, W, H, 50, 99)).toBe(false);
  });

  it('floors fractional coordinates', () => {
    expect(isSolid(mask, W, H, 50.9, 99.9)).toBe(false);
    expect(isSolid(mask, W, H, 50.9, 100.1)).toBe(true);
  });

  it('treats out-of-bounds as empty', () => {
    expect(isSolid(mask, W, H, -1, 100)).toBe(false);
    expect(isSolid(mask, W, H, 50, -1)).toBe(false);
    expect(isSolid(mask, W, H, W, 100)).toBe(false);
    expect(isSolid(mask, W, H, 50, H)).toBe(false);
    expect(isSolid(mask, W, H, -5, -5)).toBe(false);
  });
});

describe('isGrounded', () => {
  it('is true when the contact pixel is solid', () => {
    expect(isGrounded(makeMask(flat(100)), W, H, body(100, 100))).toBe(true);
  });

  it('is false one pixel above the surface', () => {
    expect(isGrounded(makeMask(flat(100)), W, H, body(100, 99))).toBe(false);
  });

  it('is false over a hole', () => {
    const heights = Array.from({ length: W }, (_, x) => (x === 100 ? Infinity : 100));
    expect(isGrounded(makeMask(heights), W, H, body(100, 100))).toBe(false);
  });
});

describe('surfaceAhead', () => {
  it('finds level ground', () => {
    const mask = makeMask(flat(100));
    expect(surfaceAhead(mask, W, H, 100, 100, 1)).toEqual({ kind: 'surface', y: 100 });
    expect(surfaceAhead(mask, W, H, 100, 100, -1)).toEqual({ kind: 'surface', y: 100 });
  });

  it('climbs any rise up to STEP_UP_LIMIT', () => {
    for (let rise = 1; rise <= STEP_UP_LIMIT; rise++) {
      const mask = makeMask(lip(100, 101, rise));
      expect({ rise, probe: surfaceAhead(mask, W, H, 100, 100, 1) }).toEqual({
        rise,
        probe: { kind: 'surface', y: 100 - rise },
      });
    }
  });

  it('refuses a rise one pixel past STEP_UP_LIMIT', () => {
    const mask = makeMask(lip(100, 101, STEP_UP_LIMIT + 1));
    expect(surfaceAhead(mask, W, H, 100, 100, 1)).toEqual({ kind: 'wall' });
  });

  it('descends any drop up to STEP_DOWN_LIMIT', () => {
    for (let drop = 1; drop <= STEP_DOWN_LIMIT; drop++) {
      const mask = makeMask(lip(100, 101, -drop));
      expect({ drop, probe: surfaceAhead(mask, W, H, 100, 100, 1) }).toEqual({
        drop,
        probe: { kind: 'surface', y: 100 + drop },
      });
    }
  });

  it('reads a drop past STEP_DOWN_LIMIT as a cliff, not a wall', () => {
    const mask = makeMask(lip(100, 101, -(STEP_DOWN_LIMIT + 1)));
    expect(surfaceAhead(mask, W, H, 100, 100, 1)).toEqual({ kind: 'cliff' });
  });

  it('reads a bottomless hole as a cliff', () => {
    const heights = Array.from({ length: W }, (_, x) => (x >= 101 ? Infinity : 100));
    expect(surfaceAhead(makeMask(heights), W, H, 100, 100, 1)).toEqual({ kind: 'cliff' });
  });

  it('reads a column solid to the top of the window as a wall', () => {
    const heights = Array.from({ length: W }, (_, x) => (x >= 101 ? 0 : 100));
    expect(surfaceAhead(makeMask(heights), W, H, 100, 100, 1)).toEqual({ kind: 'wall' });
  });

  it('takes the first solid pixel BELOW open sky, not one buried in a wall', () => {
    // A shelf at 96 with solid rock continuing below it. The surface is 96, and
    // a probe that returned any deeper pixel would sink the character.
    const mask = makeMask(lip(100, 101, 4));
    expect(surfaceAhead(mask, W, H, 100, 100, 1)).toEqual({ kind: 'surface', y: 96 });
  });

  it('ignores a roof over the ground it is reading', () => {
    // A crater blown into a hillside leaves exactly this: a walkable floor with
    // rock overhead. Under the old box model the roof was measured AS the
    // surface and the whole hill above it counted as the rise, which stopped a
    // character dead on open, flat ground.
    const mask = makeMask(flat(100), new Array(W).fill(55));
    expect(surfaceAhead(mask, W, H, 100, 100, 1)).toEqual({ kind: 'surface', y: 100 });
  });
});

describe('groundDistance', () => {
  it('is 0 when standing on the surface', () => {
    expect(groundDistance(makeMask(flat(100)), W, H, 100, 100, 20)).toBe(0);
  });

  it('measures the gap to the surface', () => {
    expect(groundDistance(makeMask(flat(100)), W, H, 100, 90, 20)).toBe(10);
  });

  it('never reports past the surface, so a fall cannot overshoot', () => {
    const mask = makeMask(flat(100));
    // A fast fall asking for 50px of travel from 10px up gets 10.
    expect(groundDistance(mask, W, H, 100, 90, 50)).toBe(10);
  });

  it('returns the cap over a bottomless column', () => {
    const heights = Array.from({ length: W }, (_, x) => (x === 100 ? Infinity : 100));
    expect(groundDistance(makeMask(heights), W, H, 100, 90, 12)).toBe(12);
  });
});

describe('ejectUp', () => {
  it('leaves a character standing on the surface alone', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 100);
    ejectUp(mask, W, H, b);
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('leaves a character in mid-air alone', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 80);
    ejectUp(mask, W, H, b);
    expect(b).toEqual({ x: 100, y: 80 });
  });

  it('lifts a buried character onto the surface', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 110);
    ejectUp(mask, W, H, b);
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('lifts to the top of the run, not into the middle of it', () => {
    // Terrain drawn over the character: solid from 70 down.
    const mask = makeMask(flat(70));
    const b = body(100, 95);
    ejectUp(mask, W, H, b);
    expect(b.y).toBe(70);
  });

  it('gives up rather than teleporting a character buried past the budget', () => {
    const mask = makeMask(flat(0));
    const b = body(100, 100);
    ejectUp(mask, W, H, b);
    // Deeper than EJECT_UP_LIMIT allows: unchanged.
    expect(100 - 0).toBeGreaterThan(EJECT_UP_LIMIT);
    expect(b).toEqual({ x: 100, y: 100 });
  });
});

describe('walkStep', () => {
  it('advances one pixel and follows the surface', () => {
    const mask = makeMask(lip(100, 101, 3));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('moved');
    expect(b).toEqual({ x: 101, y: 97 });
  });

  it('walks left as readily as right', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, -1)).toBe('moved');
    expect(b).toEqual({ x: 99, y: 100 });
  });

  it('changes nothing at all when blocked', () => {
    const heights = Array.from({ length: W }, (_, x) => (x >= 101 ? 0 : 100));
    const mask = makeMask(heights);
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('blocked');
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('walks off a cliff rather than refusing it', () => {
    const heights = Array.from({ length: W }, (_, x) => (x >= 101 ? Infinity : 100));
    const mask = makeMask(heights);
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('fell');
    // Advanced, and dropped by the window, leaving the fall to gravity.
    expect(b).toEqual({ x: 101, y: 100 + STEP_DOWN_LIMIT });
  });
});

describe('walking over terrain', () => {
  it('crosses flat ground without ever stalling', () => {
    const mask = makeMask(flat(100));
    const b = body(50, 100);
    expect(walkRun(mask, b, 1, 100)).toEqual({ advanced: 100, result: 'moved' });
  });

  it('walks every gradient up to STEP_UP_LIMIT and refuses the one past it', () => {
    // Base and run chosen so even the steepest slope stays inside the map: an
    // 8 px/px slope over 20 steps rises 160px from y=380. A slope that clips
    // the top of the map silently becomes a plateau and asserts nothing.
    const RUN = 20;
    for (let gradient = 1; gradient <= STEP_UP_LIMIT + 2; gradient++) {
      const heights = slope(380, 50, gradient);
      const b = standOn(heights, 50);
      const { advanced } = walkRun(makeMask(heights), b, 1, RUN);
      expect({ gradient, advanced }).toEqual({
        gradient,
        advanced: gradient <= STEP_UP_LIMIT ? RUN : 0,
      });
    }
  });

  it('descends a slope as far as it climbs one', () => {
    const heights = slope(100, 50, -STEP_DOWN_LIMIT);
    const b = standOn(heights, 50);
    expect(walkRun(makeMask(heights), b, 1, 20)).toEqual({ advanced: 20, result: 'moved' });
  });

  it('reaches the pixel adjacent to a wall before refusing', () => {
    // The old box model refused a full body-width early — 24px of clear, flat,
    // walkable ground left untraversed, with an `unableToMove` broadcast while
    // the character stood in the open. A point stops where the wall is.
    const heights = Array.from({ length: W }, (_, x) => (x >= 150 ? 0 : 100));
    const mask = makeMask(heights);
    const b = body(100, 100);
    const { result } = walkRun(mask, b, 1, 100);
    expect({ x: b.x, result }).toEqual({ x: 149, result: 'blocked' });
  });

  it('walks under an overhang on open ground', () => {
    // The old model read the roof as the surface and stopped after 26px of a
    // 120px run. A 45px-high tunnel is walkable ground and nothing else.
    const mask = makeMask(flat(100), new Array(W).fill(55));
    const b = body(30, 100);
    expect(walkRun(mask, b, 1, 120)).toEqual({ advanced: 120, result: 'moved' });
  });

  it('climbs out of a crater it fell into', () => {
    // A bowl 30px deep with walls at the climb limit: reachable on the way in
    // and on the way out.
    const heights = Array.from({ length: W }, (_, x) => {
      const d = Math.abs(x - 100);
      return d >= 30 ? 100 : 100 + (30 - d);
    });
    const mask = makeMask(heights);
    const b = standOn(heights, 100);
    expect(walkRun(mask, b, 1, 40)).toEqual({ advanced: 40, result: 'moved' });
    expect(b.y).toBe(100);
  });
});

describe('computeTilt', () => {
  it('is zero on flat ground', () => {
    const mask = makeMask(flat(100));
    expect(computeTilt(mask, W, H, 100, 100)).toBe(0);
  });

  it('is negative on ground rising to the right', () => {
    const heights = Array.from({ length: W }, (_, x) => 100 - Math.floor(x / 4));
    const mask = makeMask(heights);
    const tilt = computeTilt(mask, W, H, 100, heights[100]);
    expect(tilt).toBeLessThan(0);
    expect(Math.abs(tilt)).toBeLessThan(Math.PI / 2);
  });

  it('is positive on ground falling to the right, and symmetric', () => {
    const up = Array.from({ length: W }, (_, x) => 100 - Math.floor(x / 4));
    const down = Array.from({ length: W }, (_, x) => 100 + Math.floor(x / 4));
    const tiltUp = computeTilt(makeMask(up), W, H, 100, up[100]);
    const tiltDown = computeTilt(makeMask(down), W, H, 100, down[100]);
    expect(tiltDown).toBeGreaterThan(0);
    expect(tiltDown).toBeCloseTo(-tiltUp, 5);
  });

  it('uses the hole fallback when one track overhangs a crater', () => {
    // Ground vanishes just right of the body: the right track finds nothing.
    const heights = Array.from({ length: W }, (_, x) => (x < 105 ? 100 : Infinity));
    const mask = makeMask(heights);
    const tilt = computeTilt(mask, W, H, 100, 100);
    expect(tilt).toBe(0); // mirrors the good track instead of flipping
  });

  it('returns 0 when neither track finds ground', () => {
    const mask = makeMask(new Array(W).fill(Infinity));
    expect(computeTilt(mask, W, H, 100, 100)).toBe(0);
  });

  it('reads terrain steeper than the character could walk', () => {
    // A rise well past STEP_UP_LIMIT is still tilted over, by design: tilt
    // reads the ground far more generously than walking does.
    const heights = Array.from({ length: W }, (_, x) => (x >= 100 ? 80 : 100));
    const mask = makeMask(heights);
    const tilt = computeTilt(mask, W, H, 100, 100);
    expect(tilt).toBeCloseTo(Math.atan2(80 - 100, TILT_OFFSET_X * 2), 6);
  });
});

describe('pointInBody', () => {
  // body.y is the CONTACT POINT and therefore the bottom edge, so the drawn box
  // spans [y - PLAYER_HEIGHT, y] vertically and PLAYER_WIDTH centred on x.
  const feet = body(100, 100);

  it('hits at head height', () => {
    expect(pointInBody(100, 66, feet)).toBe(true);
  });

  it('hits at mid-body', () => {
    expect(pointInBody(100, 82, feet)).toBe(true);
  });

  it('misses below the feet, inside the ground', () => {
    expect(pointInBody(100, 110, feet)).toBe(false);
  });

  it('misses above the head', () => {
    expect(pointInBody(100, 63, feet)).toBe(false);
  });

  it('includes the horizontal edges', () => {
    expect(pointInBody(88, 100, feet)).toBe(true);
    expect(pointInBody(112, 100, feet)).toBe(true);
    expect(pointInBody(88, 64, feet)).toBe(true);
    expect(pointInBody(112, 64, feet)).toBe(true);
  });

  it('misses just outside the horizontal edges', () => {
    expect(pointInBody(87.9, 82, feet)).toBe(false);
    expect(pointInBody(112.1, 82, feet)).toBe(false);
  });

  it('is derived from the drawn body, not hardcoded', () => {
    expect(pointInBody(feet.x - PLAYER_WIDTH / 2, feet.y, feet)).toBe(true);
    expect(pointInBody(feet.x, feet.y - PLAYER_HEIGHT, feet)).toBe(true);
    expect(pointInBody(feet.x, feet.y - PLAYER_HEIGHT - 0.1, feet)).toBe(false);
  });
});
