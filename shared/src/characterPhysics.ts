/**
 * Character body physics against the terrain mask.
 *
 * Every function here is PURE: it reads a `Uint8Array` mask (1 = solid, indexed
 * `y * mapWidth + x`) and, where it moves a body, mutates only the body object
 * it was handed. No Colyseus, no rendering, no hidden state.
 *
 * Body convention (matching the existing `Player` schema): `x` is the
 * horizontal CENTRE, `y` is the FEET — the bottom edge. The body occupies the
 * closed box
 *
 *     [x - PLAYER_WIDTH / 2, x + PLAYER_WIDTH / 2] x [y - PLAYER_HEIGHT, y]
 *
 * and collisions are tested on the *boundary line* of that box in the direction
 * of travel, never as a full mask-vs-mask overlap.
 *
 * References: Hedgewars `TestCollisionX/Y`, `moveHedgehogOutOfWall`,
 * `MakeHedgehogsStep`; see docs/agents/implementation-plan-movement-physics.md.
 */

import {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  STEP_LIMIT,
  CLIMB_LIMIT,
  FOOT_SAMPLES,
  TILT_OFFSET_X,
  TILT_WINDOW_Y,
  AIRBORNE_CLIMB_MAX,
  AIRBORNE_CLIMB_DAMP,
  WALL_ELASTICITY,
} from './types';
import { MAP_WIDTH, MAP_HEIGHT } from './terrain';

/** A character body. `x` is the centre, `y` is the feet (bottom edge). */
export interface Body {
  x: number;
  y: number;
}

/** Outcome of a single one-pixel walk attempt. */
export type WalkResult = 'moved' | 'blocked' | 'fell';

/** Convenience for callers that use the default map size. */
export const DEFAULT_MAP_SIZE = { width: MAP_WIDTH, height: MAP_HEIGHT } as const;

/** Half the body width; the body extends this far each side of `x`. */
const HALF_WIDTH = PLAYER_WIDTH / 2;


/**
 * Hard bound on `pushOutOfWall` iterations. One body width is more than enough
 * to clear any wall a body can be embedded in; past that it is wedged.
 */
const MAX_PUSH_ITERATIONS = PLAYER_WIDTH;

/**
 * Is the world pixel containing (x, y) solid? Coordinates are floored to
 * integers; anything outside the map is empty.
 */
export function isSolid(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number
): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mapWidth || py >= mapHeight) return false;
  return mask[py * mapWidth + px] !== 0;
}

/**
 * Would the body collide moving horizontally by `dir` (+1 right, -1 left)?
 *
 * Scans the LEADING VERTICAL EDGE of the AABB, top to bottom, inset 1px at each
 * end. The inset is load-bearing: without it a body catches on its own bottom
 * corner as it slides along a wall or a floor it is already resting on.
 */
export function testCollisionX(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  dir: number
): boolean {
  const col = Math.floor(body.x + Math.sign(dir) * HALF_WIDTH);
  const top = Math.floor(body.y - PLAYER_HEIGHT) + 1;
  const bottom = Math.floor(body.y) - 1;
  for (let y = top; y <= bottom; y++) {
    if (isSolid(mask, mapWidth, mapHeight, col, y)) return true;
  }
  return false;
}

/**
 * Would the body collide moving vertically by `dir` (+1 down, -1 up)?
 *
 * The transpose of `testCollisionX`: the leading horizontal edge, inset 1px at
 * each end. `testCollisionY(+1)` is also the grounded test.
 */
export function testCollisionY(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  dir: number
): boolean {
  const row = Math.floor(dir > 0 ? body.y : body.y - PLAYER_HEIGHT);
  const left = Math.floor(body.x - HALF_WIDTH) + 1;
  const right = Math.floor(body.x + HALF_WIDTH) - 1;
  for (let x = left; x <= right; x++) {
    if (isSolid(mask, mapWidth, mapHeight, x, row)) return true;
  }
  return false;
}

/**
 * Resolve a body embedded in terrain — possible when a `rect` op is drawn over
 * it, or when a map loads with a body inside a hill.
 *
 * Probes 1px to each side and ejects toward whichever side is free. If BOTH
 * sides are blocked, or NEITHER is, the body is either genuinely wedged or
 * already fine: bail out rather than teleport it. Iterations are bounded so a
 * pathological mask cannot hang the simulation.
 */
export function pushOutOfWall(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body
): void {
  let iterations = 0;
  while (
    testCollisionY(mask, mapWidth, mapHeight, body, 1) &&
    iterations < MAX_PUSH_ITERATIONS
  ) {
    const leftBlocked = testCollisionX(mask, mapWidth, mapHeight, body, -1);
    const rightBlocked = testCollisionX(mask, mapWidth, mapHeight, body, 1);

    // Symmetric: wedged solid, or resting normally. Either way, do not move.
    if (leftBlocked === rightBlocked) break;

    body.x += leftBlocked ? 1 : -1;
    iterations++;
  }
}

/**
 * Highest ground under the foot line, or `null` if no probe finds ground within
 * `STEP_LIMIT`. `FOOT_SAMPLES` probes are spread evenly across the body width
 * and scan downward from the feet; the smallest y (highest ground) wins, so a
 * body straddling a gap stands on the higher lip rather than sinking.
 */
export function footGroundHeight(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body
): number | null {
  const startY = Math.floor(body.y);
  const spacing = FOOT_SAMPLES > 1 ? PLAYER_WIDTH / (FOOT_SAMPLES - 1) : 0;
  let best: number | null = null;

  for (let i = 0; i < FOOT_SAMPLES; i++) {
    const sampleX =
      FOOT_SAMPLES > 1 ? body.x - HALF_WIDTH + i * spacing : body.x;
    for (let dy = 0; dy <= STEP_LIMIT; dy++) {
      const y = startY + dy;
      if (isSolid(mask, mapWidth, mapHeight, sampleX, y)) {
        if (best === null || y < best) best = y;
        break;
      }
    }
  }

  return best;
}


/**
 * Is there a roof directly over the body, blocking a lift?
 *
 * Deliberately NOT `testCollisionY(body, -1)`. That spans the whole body,
 * including the leading side — which is where the slope being climbed lives. A
 * body approaching a wall taller than itself has its shoulder inside that wall
 * horizontally, so a full-width test reports a "ceiling" and aborts the climb,
 * and the body is stuck at the foot of anything head-height or taller. That is
 * what made deep craters inescapable regardless of the climb limit.
 *
 * The climb's question is "do I have headroom HERE", so this spans only the
 * trailing half plus the centre. Terrain ahead is the horizontal probe's
 * business, and it is already tested every iteration of the climb loop.
 */
function ceilingBlocked(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  dir: number
): boolean {
  const row = Math.floor(body.y - PLAYER_HEIGHT);
  const left = dir > 0 ? Math.floor(body.x - HALF_WIDTH) + 1 : Math.floor(body.x);
  const right = dir > 0 ? Math.floor(body.x) : Math.floor(body.x + HALF_WIDTH) - 1;
  for (let x = left; x <= right; x++) {
    if (isSolid(mask, mapWidth, mapHeight, x, row)) return true;
  }
  return false;
}

/**
 * Advance the body EXACTLY ONE PIXEL horizontally, climbing within
 * `CLIMB_LIMIT` and descending within `STEP_LIMIT`. Mutates `body` in place.
 *
 * The two limits are different on purpose: climbing is bounded by the body's
 * geometry against a slope (see MAX_CLIMB_ANGLE_DEG), stepping down is a
 * gameplay choice about when a ledge becomes a fall.
 *
 * - `'moved'`   — x advanced by `dir`, y adjusted to follow the ground.
 * - `'blocked'` — nothing changed at all. The entire lift is undone; leaving it
 *                 in place is what produced the old 60px-hover bug.
 * - `'fell'`    — x advanced, but there is no ground within `STEP_LIMIT`; the
 *                 drop is undone and the caller should go airborne.
 */
export function walkStep(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  dir: number
): WalkResult {
  const step = Math.sign(dir) || 1;

  let climbed = 0;
  while (
    testCollisionX(mask, mapWidth, mapHeight, body, step) &&
    climbed < CLIMB_LIMIT
  ) {
    // Ceiling — cannot lift any further.
    if (ceilingBlocked(mask, mapWidth, mapHeight, body, step)) break;
    body.y -= 1;
    climbed++;
  }

  if (testCollisionX(mask, mapWidth, mapHeight, body, step)) {
    body.y += climbed; // undo the ENTIRE lift
    return 'blocked'; // x unchanged
  }

  body.x += step; // commit exactly 1px

  let dropped = 0;
  while (
    !testCollisionY(mask, mapWidth, mapHeight, body, 1) &&
    dropped < STEP_LIMIT
  ) {
    body.y += 1;
    dropped++;
  }

  if (dropped === STEP_LIMIT && !testCollisionY(mask, mapWidth, mapHeight, body, 1)) {
    body.y -= STEP_LIMIT; // undo the drop; the caller sets vy = 0, airborne
    return 'fell';
  }

  return 'moved';
}

/**
 * Surface height of a single tilt track column, or `null` if the column finds
 * no surface anywhere in the window (a hole under that track).
 */
function trackSurface(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number
): number | null {
  for (let h = -TILT_WINDOW_Y; h <= TILT_WINDOW_Y; h++) {
    if (isSolid(mask, mapWidth, mapHeight, x, y + h)) return y + h;
  }
  return null;
}

/**
 * Chassis tilt in radians, as a TWO-SAMPLE SECANT across the track length —
 * deliberately not a per-pixel gradient, which is single-pixel-noise sensitive.
 *
 * Each track column scans `±TILT_WINDOW_Y` around `y` for the surface. Hole
 * fallback: a column that finds no surface at all (it overhangs a crater) takes
 * the other column's surface instead, which reads as level rather than letting
 * the body flip to a garbage angle. If neither column finds ground, tilt is 0.
 *
 * Positive is nose-up-to-the-left in screen space (y grows downward): ground
 * rising to the right yields a negative angle.
 */
export function computeTilt(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number
): number {
  let left = trackSurface(mask, mapWidth, mapHeight, x - TILT_OFFSET_X, y);
  let right = trackSurface(mask, mapWidth, mapHeight, x + TILT_OFFSET_X, y);

  if (left === null && right === null) return 0;
  if (left === null) left = right as number;
  if (right === null) right = left as number;

  return Math.atan2(right - left, TILT_OFFSET_X * 2);
}

/**
 * Snap the body down onto the surface, at most `STEP_LIMIT`. A body with no
 * ground within that distance is left where it is — it is falling, and that is
 * the caller's business.
 */
export function settle(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body
): void {
  const ground = footGroundHeight(mask, mapWidth, mapHeight, body);
  if (ground === null) return;
  if (ground > body.y) body.y = ground;
}

/**
 * Airborne horizontal movement with wall interaction: lift within AIRBORNE_CLIMB_MAX,
 * apply damping per step, or bounce.
 *
 * Mutates the body and velocity in place. Returns the updated velocity (may be
 * negated if bounced, may be zeroed if settled).
 *
 * - If movement succeeds: advances body.x by the sign of vx, may have lifted body.y
 * - If blocked: tries lifting up to AIRBORNE_CLIMB_MAX; applies damping on each success
 * - If all lifts fail: negates and scales vx by WALL_ELASTICITY (bounce)
 * - If vx becomes negligible (< 0.01): zeroes it and settles the body
 */
export function airborneHorizontal(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  vx: number
): number {
  const step = Math.sign(vx) || 0;
  if (step === 0) return vx; // No horizontal velocity

  // Try to move by the sign direction. If blocked, try climbing.
  if (testCollisionX(mask, mapWidth, mapHeight, body, step)) {
    // Wall hit: try graduated climb, lifting incrementally
    const originalY = body.y;
    for (let climb = 1; climb <= AIRBORNE_CLIMB_MAX; climb++) {
      body.y -= 1; // Lift 1px more (accumulates across iterations)

      if (!testCollisionX(mask, mapWidth, mapHeight, body, step)) {
        // Climb succeeded at this height; apply damping and move forward
        vx *= AIRBORNE_CLIMB_DAMP[climb - 1];
        body.x += step;
        return vx;
      }
      // If still blocked, body.y stays at this height and we try the next level
    }

    // All climbs failed: restore original height and bounce
    body.y = originalY;
    vx = -WALL_ELASTICITY * vx;
  } else {
    // Free path: move forward
    body.x += step;
  }

  // Below a negligible threshold, stop and settle
  if (Math.abs(vx) < 0.01) {
    vx = 0;
    settle(mask, mapWidth, mapHeight, body);
  }

  return vx;
}

/**
 * Is a point inside a character's body?
 *
 * The body is the AABB the physics actually simulates: `PLAYER_WIDTH` wide,
 * centred horizontally on `body.x`, and `PLAYER_HEIGHT` tall standing ON
 * `body.y` — so it spans `[y - PLAYER_HEIGHT, y]`. `body.y` is the FEET.
 *
 * Projectiles used to be tested against a circle of radius 20 centred on the
 * feet, which is wrong at both ends: a shot at head height falls outside it and
 * misses a character it visually struck, while a shot passing below the feet —
 * inside the ground — falls within it and hits. Axis-aligned, deliberately:
 * this must agree with the body `testCollisionY` and `walkStep` move, and those
 * are axis-aligned regardless of how the chassis is drawn.
 */
export function pointInBody(px: number, py: number, body: Body): boolean {
  return (
    px >= body.x - HALF_WIDTH &&
    px <= body.x + HALF_WIDTH &&
    py >= body.y - PLAYER_HEIGHT &&
    py <= body.y
  );
}
