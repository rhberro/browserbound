import { describe, it, expect } from 'vitest';
import {
  isSolid,
  testCollisionX,
  testCollisionY,
  pushOutOfWall,
  footGroundHeight,
  walkStep,
  isEmbedded,
  computeTilt,
  settle,
  airborneHorizontal,
  pointInBody,
  Body,
  WalkResult,
} from '../characterPhysics';
import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  STEP_LIMIT,
  CLIMB_LIMIT,
  MAX_CLIMB_ANGLE_DEG,
  TILT_OFFSET_X,
  AIRBORNE_CLIMB_MAX,
  AIRBORNE_CLIMB_DAMP,
  WALL_ELASTICITY,
} from '../types';

/**
 * Geometry is DERIVED, never hardcoded: these tests must keep meaning when the
 * body is resized. `LEAD` is the column the leading-edge probe reads when a
 * body centred on x = 100 steps right — put terrain there to make it react.
 */
const HALF_W = PLAYER_WIDTH / 2;
const LEAD = 100 + HALF_W;

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
 * an angle rather than a rise-over-run so the tests read in the same units as
 * `MAX_CLIMB_ANGLE_DEG`.
 */
function slope(y: number, at: number, degrees: number): number[] {
  const gradient = Math.tan((degrees * Math.PI) / 180);
  return Array.from({ length: W }, (_, x) =>
    x >= at ? Math.max(1, Math.round(y - gradient * (x - at))) : y
  );
}

/**
 * Walk a body along a mask the way the server's physics loop does — eject, then
 * step — and report how far it actually got. This pairing is the thing under
 * test: each half is fine alone, and it was their interaction that pinned
 * characters to the bottom of every hill.
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
    pushOutOfWall(mask, W, H, b);
    result = walkStep(mask, W, H, b, dir);
    if (result !== 'moved') break;
  }
  return { advanced: Math.abs(b.x - startX), result };
}

const body = (x: number, y: number): Body => ({ x, y });

/**
 * A body resting on `heights` at column `x` — the feet on the highest ground
 * under the foot line, which is where `footGroundHeight` puts them. Slope tests
 * must start from the resting position: dropping a body at the slope's BASE
 * height buries it by the full rise across the map, which no climb budget is
 * meant to recover from and which tests the wrong thing entirely.
 */
function standOn(heights: number[], x: number): Body {
  let y = Infinity;
  // Inset to match `footGroundHeight`, which this mirrors.
  for (let i = x - HALF_W + 1; i <= x + HALF_W - 1; i++) y = Math.min(y, heights[i] ?? Infinity);
  return { x, y };
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

describe('testCollisionY', () => {
  it('reports ground under the feet on a flat floor', () => {
    const mask = makeMask(flat(100));
    expect(testCollisionY(mask, W, H, body(100, 100), 1)).toBe(true);
  });

  it('reports no ground when the floor is below the feet', () => {
    const mask = makeMask(flat(101));
    expect(testCollisionY(mask, W, H, body(100, 100), 1)).toBe(false);
  });

  it('reports a ceiling above the head', () => {
    const mask = makeMask(flat(100), new Array(W).fill(100 - PLAYER_HEIGHT + 1));
    expect(testCollisionY(mask, W, H, body(100, 100), -1)).toBe(true);
  });

  it('reports no ceiling in open air', () => {
    const mask = makeMask(flat(100));
    expect(testCollisionY(mask, W, H, body(100, 100), -1)).toBe(false);
  });
});

describe('testCollisionX', () => {
  it('does not catch on the floor it is standing on (bottom inset)', () => {
    const mask = makeMask(flat(100));
    expect(testCollisionX(mask, W, H, body(100, 100), 1)).toBe(false);
    expect(testCollisionX(mask, W, H, body(100, 100), -1)).toBe(false);
  });

  it('detects a vertical wall ahead', () => {
    const mask = makeMask(lip(100, LEAD, 100)); // solid to the top from the leading column
    expect(testCollisionX(mask, W, H, body(100, 100), 1)).toBe(true);
    expect(testCollisionX(mask, W, H, body(100, 100), -1)).toBe(false);
  });
});

describe('footGroundHeight', () => {
  it('finds a flat floor directly underfoot', () => {
    const mask = makeMask(flat(100));
    expect(footGroundHeight(mask, W, H, body(100, 100))).toBe(100);
  });

  it('returns the highest ground of all samples', () => {
    const mask = makeMask(lip(105, 110, 5)); // right half is 5px higher
    expect(footGroundHeight(mask, W, H, body(100, 100))).toBe(100);
  });

  it('returns null when nothing is within STEP_LIMIT', () => {
    const mask = makeMask(flat(100 + STEP_LIMIT + 1));
    expect(footGroundHeight(mask, W, H, body(100, 100))).toBeNull();
  });

  it('finds ground exactly at STEP_LIMIT', () => {
    const mask = makeMask(flat(100 + STEP_LIMIT));
    expect(footGroundHeight(mask, W, H, body(100, 100))).toBe(100 + STEP_LIMIT);
  });
});

describe('walkStep', () => {
  it('moves one pixel along a flat floor', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('moved');
    expect(b).toEqual({ x: 101, y: 100 });

    expect(walkStep(mask, W, H, b, -1)).toBe('moved');
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('climbs a 1px lip', () => {
    const mask = makeMask(lip(100, LEAD, 1));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('moved');
    expect(b.x).toBe(101);
    expect(b.y).toBe(99);
  });

  it('climbs a rise of exactly CLIMB_LIMIT', () => {
    const mask = makeMask(lip(100, LEAD, CLIMB_LIMIT));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('moved');
    expect(b.x).toBe(101);
    expect(b.y).toBe(100 - CLIMB_LIMIT);
  });

  it('is blocked by a rise of CLIMB_LIMIT + 1, and undoes the ENTIRE lift', () => {
    const mask = makeMask(lip(100, LEAD, CLIMB_LIMIT + 1));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('blocked');
    expect(b.x).toBe(100); // x unchanged
    expect(b.y).toBe(100); // no residual hover
  });

  it('is blocked by a vertical wall', () => {
    const mask = makeMask(lip(100, LEAD, 100));
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('blocked');
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('is blocked when a low ceiling prevents the climb', () => {
    // A 10px rise the body could normally climb, under a roof that stops it.
    // The roof deliberately stops short of the leading column , so
    // only the ceiling check — not the horizontal probe — can catch it.
    const heights = lip(100, LEAD, 10);
    const ceilings = Array.from({ length: W }, (_, x) =>
      x >= 100 - HALF_W + 1 && x < LEAD ? 100 - PLAYER_HEIGHT - 4 : -1
    );
    const mask = makeMask(heights, ceilings);
    const b = body(100, 100);
    expect(walkStep(mask, W, H, b, 1)).toBe('blocked');
    expect(b).toEqual({ x: 100, y: 100 });

    // Without the roof the same rise is walkable.
    const open = makeMask(heights);
    const b2 = body(100, 100);
    expect(walkStep(open, W, H, b2, 1)).toBe('moved');
    expect(b2.y).toBe(90);
  });

  it('walks down a drop within STEP_LIMIT', () => {
    const mask = makeMask(lip(100, LEAD, -STEP_LIMIT));
    const b = body(100, 100);
    let result: string = 'moved';
    while (result === 'moved' && b.y === 100) {
      result = walkStep(mask, W, H, b, 1);
    }
    expect(result).toBe('moved');
    expect(b.y).toBe(100 + STEP_LIMIT);
  });

  it("returns 'fell' walking off a ledge, and undoes the drop", () => {
    const heights = Array.from({ length: W }, (_, x) => (x < 130 ? 100 : Infinity));
    const mask = makeMask(heights);
    const b = body(100, 100);

    let result: string = 'moved';
    let guard = 0;
    while (result === 'moved' && guard++ < 200) {
      result = walkStep(mask, W, H, b, 1);
    }

    expect(result).toBe('fell');
    expect(b.y).toBe(100); // the drop was undone, not left half-applied
    expect(b.x).toBeGreaterThan(100);
  });
});

describe('slope walking', () => {
  /**
   * The headline requirement: the angle a character can actually walk up must
   * be the angle `MAX_CLIMB_ANGLE_DEG` advertises. Everything else in this
   * block exists so a regression names the gradient it broke at.
   */
  it('climbs every gradient up to MAX_CLIMB_ANGLE_DEG', () => {
    for (let degrees = 5; degrees <= MAX_CLIMB_ANGLE_DEG - 2; degrees += 5) {
      const heights = slope(300, 0, degrees);
      const b = standOn(heights, 50);
      const { advanced, result } = walkRun(makeMask(heights), b, 1, 100);
      expect({ degrees, advanced, result }).toEqual({
        degrees,
        advanced: 100,
        result: 'moved',
      });
    }
  });

  /**
   * The boundary, from both sides. A slope test must approach the face over
   * flat ground: a body dropped onto a near-vertical incline is buried by the
   * whole rise of the map, which is a different question with a different
   * answer.
   */
  it('stops at the foot of a slope steeper than MAX_CLIMB_ANGLE_DEG', () => {
    const heights = slope(300, 100, MAX_CLIMB_ANGLE_DEG + 5);
    const { result } = walkRun(makeMask(heights), body(50, 300), 1, 60);
    expect(result).toBe('blocked');
  });

  it('walks a slope just under MAX_CLIMB_ANGLE_DEG', () => {
    const heights = slope(300, 100, MAX_CLIMB_ANGLE_DEG - 2);
    const { advanced, result } = walkRun(makeMask(heights), body(50, 300), 1, 40);
    expect({ advanced, result }).toEqual({ advanced: 40, result: 'moved' });
  });

  it('makes net progress on a gentle slope instead of walking in place', () => {
    // A ~9 degree rise: the shallowest hill on the shipped maps, and the one
    // that stalled outright. One walk step forward, one eject step back, budget
    // draining the whole time.
    const heights = slope(300, 0, 9);
    expect(walkRun(makeMask(heights), standOn(heights, 50), 1, 60).advanced).toBe(60);
  });

  it('climbs a slope in either direction', () => {
    const heights = slope(300, 0, 35);
    const mask = makeMask(heights);
    expect(walkRun(mask, standOn(heights, 50), 1, 40).advanced).toBe(40);

    // The mirror case: walking left is downhill here, and must not stall either.
    expect(walkRun(mask, standOn(heights, 150), -1, 40).advanced).toBe(40);
  });

  it('keeps the body on the surface as it climbs, neither sunk nor hovering', () => {
    const heights = slope(300, 0, 30);
    const mask = makeMask(heights);
    const b = standOn(heights, 50);

    for (let i = 0; i < 80; i++) {
      pushOutOfWall(mask, W, H, b);
      expect(walkStep(mask, W, H, b, 1)).toBe('moved');

      // The feet track the highest ground under the foot line. On a rising
      // slope that is the leading edge, so the body rides HALF_W * gradient
      // above the ground at its own centre — the documented crest hover, and
      // the most it may ever be off the surface.
      const surface = heights[Math.round(b.x)];
      const lead = heights[Math.round(b.x) + HALF_W];
      expect(b.y).toBeLessThanOrEqual(surface);
      expect(b.y).toBeGreaterThanOrEqual(lead - 1);
    }
  });

  it('stays both settled and grounded on every walkable gradient', () => {
    // The invariant that `settle` and `testCollisionY` must agree on. When
    // `footGroundHeight` sampled the body's corner columns and
    // `testCollisionY` did not, a body on a slope was settled AND falling at
    // the same time: the integrator flipped it airborne every other frame, so
    // it walked at half speed with a visibly jittering sprite while never
    // failing any single-function test.
    for (const degrees of [5, 15, 30, 45, 60, 70]) {
      const heights = slope(300, 0, degrees);
      const mask = makeMask(heights);
      const b = standOn(heights, 50);

      for (let i = 0; i < 40; i++) {
        pushOutOfWall(mask, W, H, b);
        expect({ degrees, i, grounded: testCollisionY(mask, W, H, b, 1) }).toEqual({
          degrees,
          i,
          grounded: true,
        });
        expect(walkStep(mask, W, H, b, 1)).toBe('moved');
      }
    }
  });
});

describe('pushOutOfWall', () => {
  it('leaves a body standing on flat ground alone', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 100);
    pushOutOfWall(mask, W, H, b);
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('ejects toward the free side when only one side is blocked', () => {
    // Solid block filling everything left of x = 100, plus a floor.
    const mask = makeMask(Array.from({ length: W }, (_, x) => (x < 100 ? 0 : 100)));
    const b = body(95, 100);
    pushOutOfWall(mask, W, H, b);
    expect(b.x).toBeGreaterThan(95); // pushed right, out of the block
    expect(b.y).toBe(100); // never lifted: solid rock all the way up
    expect(isEmbedded(mask, W, H, b)).toBe(false);

    // Ejected means free to walk, not merely nudged. It ends up flush against
    // the face of the block, which is as far right as it should go.
    expect(walkStep(mask, W, H, b, 1)).toBe('moved');
  });

  it('bails out on a body fully buried in rock rather than teleporting it', () => {
    const mask = makeMask(new Array(W).fill(0)); // everything is solid
    const b = body(100, 100);
    pushOutOfWall(mask, W, H, b);
    expect(b).toEqual({ x: 100, y: 100 });
  });

  it('terminates on a mask with no free side anywhere', () => {
    const mask = makeMask(new Array(W).fill(0));
    const b = body(0, 0);
    pushOutOfWall(mask, W, H, b); // must return, not hang
    expect(b).toEqual({ x: 0, y: 0 });
  });

  it('does not shove a body sideways for standing on a slope', () => {
    // The regression that pinned characters to the foot of every hill. An AABB
    // resting on ANY incline has its uphill corner inside the terrain, which
    // the old grounded-based guard read as a wall to eject from — so every
    // frame shoved the body one pixel downhill, cancelling its walk step.
    const heights = slope(100, 0, 20);
    const mask = makeMask(heights);
    const b = standOn(heights, 100);
    const before = { ...b };
    pushOutOfWall(mask, W, H, b);
    expect(b.x).toBe(before.x);
  });

  it('lifts a body out of a slope it has sunk into rather than ejecting it', () => {
    const heights = slope(100, 0, 30);
    const mask = makeMask(heights);
    const b = standOn(heights, 100);
    b.y += 10; // sunk into the hillside
    pushOutOfWall(mask, W, H, b);
    expect(b.x).toBe(100); // never shoved sideways
    expect(isEmbedded(mask, W, H, b)).toBe(false);
  });
});

describe('isEmbedded', () => {
  it('is false for a body resting on flat ground', () => {
    const mask = makeMask(flat(100));
    expect(isEmbedded(mask, W, H, body(100, 100))).toBe(false);
  });

  it('is false for a body settled on a slope', () => {
    for (const degrees of [10, 20, 30, 45, 60]) {
      const heights = slope(100, 0, degrees);
      const mask = makeMask(heights);
      const b = standOn(heights, 100);
      pushOutOfWall(mask, W, H, b);
      expect(isEmbedded(mask, W, H, b)).toBe(false);
    }
  });

  it('is true for a body with terrain drawn through its middle', () => {
    const mask = makeMask(flat(100 - PLAYER_HEIGHT / 2));
    expect(isEmbedded(mask, W, H, body(100, 100))).toBe(true);
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

  it('reads terrain steeper than the body could walk', () => {
    // A rise well past STEP_LIMIT is still tilted over, by design.
    const heights = Array.from({ length: W }, (_, x) => (x >= 100 ? 80 : 100));
    const mask = makeMask(heights);
    const tilt = computeTilt(mask, W, H, 100, 100);
    expect(tilt).toBeCloseTo(Math.atan2(80 - 100, TILT_OFFSET_X * 2), 6);
  });
});

describe('settle', () => {
  it('snaps down onto the surface', () => {
    const mask = makeMask(flat(105));
    const b = body(100, 100);
    settle(mask, W, H, b);
    expect(b.y).toBe(105);
  });

  it('does nothing when already resting on the surface', () => {
    const mask = makeMask(flat(100));
    const b = body(100, 100);
    settle(mask, W, H, b);
    expect(b.y).toBe(100);
  });

  it('does not snap further than STEP_LIMIT', () => {
    const mask = makeMask(flat(100 + STEP_LIMIT + 1));
    const b = body(100, 100);
    settle(mask, W, H, b);
    expect(b.y).toBe(100);
  });
});

describe('airborneHorizontal', () => {
  it('moves forward on an open path', () => {
    const mask = makeMask(flat(200));
    const b = body(100, 50);
    const vx = airborneHorizontal(mask, W, H, b, 2.5);
    expect(b.x).toBe(101); // Moved 1 pixel right
    expect(vx).toBe(2.5); // Velocity unchanged
  });

  it('bounces off a wall', () => {
    // Wall at column 101 (LEAD); body at x=100 trying to go right
    const heights = Array(W).fill(200);
    heights[Math.floor(LEAD)] = 50; // Wall in the leading column
    const mask = makeMask(heights);
    const b = body(100, 100);
    const vx = airborneHorizontal(mask, W, H, b, 3.0);
    expect(b.x).toBe(100); // Did not move
    expect(vx).toBeLessThan(0); // Bounced (negative)
    expect(Math.abs(vx)).toBeCloseTo(3.0 * WALL_ELASTICITY, 6);
  });

  it('climbs and applies damping on successful lift', () => {
    // Low wall that can be climbed
    const heights = Array(W).fill(200);
    heights[Math.floor(LEAD)] = 100 - 2; // 2px high wall
    const mask = makeMask(heights);
    const b = body(100, 100);
    const vx = airborneHorizontal(mask, W, H, b, 2.5);
    expect(b.x).toBe(101); // Moved forward after climbing
    expect(vx).toBeCloseTo(2.5 * AIRBORNE_CLIMB_DAMP[1], 6); // Damped (climbed 2px = damp[1])
  });

  it('clears velocity below threshold and settles', () => {
    const mask = makeMask(flat(110));
    const b = body(100, 100);
    // Very small velocity (will be damped multiple times to negligible)
    let vx = 0.004;
    for (let i = 0; i < 5; i++) {
      vx = airborneHorizontal(mask, W, H, b, vx);
    }
    expect(vx).toBe(0); // Velocity cleared
    expect(b.y).toBeCloseTo(110, 1); // Settled
  });

  it('handles negative velocity (left)', () => {
    const mask = makeMask(flat(200));
    const b = body(100, 50);
    const vx = airborneHorizontal(mask, W, H, b, -2.5);
    expect(b.x).toBe(99); // Moved 1 pixel left
    expect(vx).toBe(-2.5); // Velocity unchanged
  });

  it('returns zero velocity when vx is zero', () => {
    const mask = makeMask(flat(200));
    const b = body(100, 50);
    const vx = airborneHorizontal(mask, W, H, b, 0);
    expect(b.x).toBe(100); // Did not move
    expect(vx).toBe(0); // Velocity remains zero
  });
});

describe('pointInBody', () => {
  // body.y is the FEET, so the box spans [y - PLAYER_HEIGHT, y] vertically and
  // is centred on x. At 24x36 with feet at (100, 100) that is
  // x in [88, 112], y in [64, 100].
  const feet = { x: 100, y: 100 };

  it('registers a hit at head height', () => {
    // The defect this replaces: a circle of radius 20 centred on the feet does
    // not reach the head, so a shot that visually struck the character missed.
    expect(pointInBody(100, 66, feet)).toBe(true);
  });

  it('registers a hit at the centre of mass', () => {
    expect(pointInBody(100, 82, feet)).toBe(true);
  });

  it('does not register below the feet, inside the terrain', () => {
    // The same circle DID reach here, so a shot buried in the ground under a
    // character counted as a hit.
    expect(pointInBody(100, 110, feet)).toBe(false);
  });

  it('does not register above the head', () => {
    expect(pointInBody(100, 63, feet)).toBe(false);
  });

  it('registers on every edge of the box', () => {
    expect(pointInBody(88, 100, feet)).toBe(true);
    expect(pointInBody(112, 100, feet)).toBe(true);
    expect(pointInBody(88, 64, feet)).toBe(true);
    expect(pointInBody(112, 64, feet)).toBe(true);
  });

  it('does not register just outside either side', () => {
    expect(pointInBody(87.9, 82, feet)).toBe(false);
    expect(pointInBody(112.1, 82, feet)).toBe(false);
  });

  it('matches the dimensions the physics simulates', () => {
    // Guards against the box and the constants drifting apart.
    expect(pointInBody(feet.x - PLAYER_WIDTH / 2, feet.y, feet)).toBe(true);
    expect(pointInBody(feet.x, feet.y - PLAYER_HEIGHT, feet)).toBe(true);
    expect(pointInBody(feet.x, feet.y - PLAYER_HEIGHT - 0.1, feet)).toBe(false);
  });
});
