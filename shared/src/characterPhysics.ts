/**
 * Character body physics against the terrain mask.
 *
 * Every function here is PURE: it reads a `Uint8Array` mask (1 = solid, indexed
 * `y * mapWidth + x`) and, where it moves a body, mutates only the body object
 * it was handed. No Colyseus, no rendering, no hidden state.
 *
 * TERRAIN CONTACT IS A POINT (ADR 0004). `body.(x, y)` is the pixel the
 * character stands on: `y` is the topmost solid row of the ground beneath it,
 * so "grounded" is simply "the pixel at (x, y) is solid". Nothing in this
 * module sweeps a box against terrain.
 *
 * The box still exists — it is what the character is DRAWN as and what
 * projectiles are tested against (`pointInBody`) — but it is no longer what the
 * simulation moves. That distinction is the whole point of this module's
 * shape. A swept AABB needs a lookahead secant to tell a slope from a step,
 * a trailing-half-only ceiling probe so its shoulders do not catch on the face
 * it is climbing, an eject routine because a box on any incline always has its
 * uphill flank inside terrain, and a multi-probe foot line because it straddles
 * gaps. A point needs none of them, and all of them are gone.
 *
 * References: GunBound, via OpenBound's `Movement.MoveSideways`, `ApplyGravity`
 * and `UpdateAngle` (`GameComponents/MobileAction/Motion/Movement.cs`), and
 * `Topography.CheckCollision`, which reads exactly one pixel. See
 * docs/agents/implementation-plan-point-contact-movement.md.
 */

import {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  STEP_UP_LIMIT,
  STEP_DOWN_LIMIT,
  WALK_STEP_PX,
  EJECT_UP_LIMIT,
  TILT_OFFSET_X,
  TILT_WINDOW_Y,
} from './types';
import { MAP_WIDTH, MAP_HEIGHT } from './terrain';

/** A character body. `(x, y)` is the ground-contact point. */
export interface Body {
  x: number;
  y: number;
}

/** Outcome of a single walk attempt. */
export type WalkResult = 'moved' | 'blocked' | 'fell';

/**
 * What the column one pixel ahead offers.
 *
 * `wall` and `cliff` are deliberately NOT one outcome. A wall refuses the move
 * and is the `unableToMove` bark; a cliff lets the character walk off the edge
 * and fall. Collapsing them either pins characters to the tops of hills or
 * lets them stroll into thin air.
 */
export type SurfaceProbe =
  | { kind: 'surface'; y: number }
  | { kind: 'cliff' }
  | { kind: 'wall' };

/** Convenience for callers that use the default map size. */
export const DEFAULT_MAP_SIZE = { width: MAP_WIDTH, height: MAP_HEIGHT } as const;

/** Half the drawn body's width; used only by `pointInBody`. */
const HALF_WIDTH = PLAYER_WIDTH / 2;

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
 * What the character would find one pixel in `dir` (+1 right, -1 left).
 *
 * The entire locomotion model, transliterated from GunBound's
 * `Movement.MoveSideways`: scan the column ahead from above the feet to below
 * them, and take the first solid pixel that FOLLOWS an empty one. That "follows
 * an empty one" clause is what makes the surface a surface rather than a pixel
 * buried inside a wall, and it is why a column that is solid all the way up is
 * a wall rather than a very tall step.
 *
 * The scan starts one row ABOVE the tallest climbable rise, because that row
 * has to be empty for anything below it to read as a surface. GunBound starts
 * at the limit itself, which quietly makes its advertised 6px step a 5px one;
 * starting a row higher costs a pixel of fidelity and buys a constant that
 * means what it says.
 */
export function surfaceAhead(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
  dir: number
): SurfaceProbe {
  const col = Math.floor(x) + (Math.sign(dir) || 1);
  const top = Math.floor(y) - STEP_UP_LIMIT - 1;
  const bottom = Math.floor(y) + STEP_DOWN_LIMIT;

  let seenEmpty = false;
  for (let probeY = top; probeY <= bottom; probeY++) {
    if (isSolid(mask, mapWidth, mapHeight, col, probeY)) {
      if (seenEmpty) return { kind: 'surface', y: probeY };
    } else {
      seenEmpty = true;
    }
  }

  // Never found solid ground under open sky: the floor drops away further than
  // the window reaches. Walking off it is a fall, not a refusal.
  if (seenEmpty) return { kind: 'cliff' };

  // Solid from top to bottom of the window — a face taller than a character
  // can step onto.
  return { kind: 'wall' };
}

/**
 * Free pixels directly below (x, y), up to `max`. 0 means grounded.
 *
 * This is what lets gravity move by `min(vy, groundDistance(...))` and land
 * EXACTLY on the surface — it cannot overshoot into terrain, so there is no
 * settle step and no per-pixel descent loop anywhere in the integrator.
 */
export function groundDistance(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
  max: number
): number {
  const limit = Math.max(0, Math.floor(max));
  for (let d = 0; d <= limit; d++) {
    if (isSolid(mask, mapWidth, mapHeight, x, y + d)) return d;
  }
  return limit;
}

/** Is the character standing on solid ground? */
export function isGrounded(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body
): boolean {
  return isSolid(mask, mapWidth, mapHeight, body.x, body.y);
}

/**
 * Lift a contact point out of terrain drawn over it — possible when a `rect` op
 * is drawn across a character, or when a map loads one inside a hill.
 *
 * The whole of what `pushOutOfWall` used to do, in six lines, because a point
 * can only ever be buried straight down. There is no sideways eject, no
 * embedded-vs-standing ambiguity, and no way for this to fight `walkStep` for
 * the same pixel — which is what the box version did on every gradient above
 * about 5 degrees, walking characters in place until their budget ran out.
 */
export function ejectUp(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body
): void {
  if (!isSolid(mask, mapWidth, mapHeight, body.x, body.y)) return;

  for (let lift = 1; lift <= EJECT_UP_LIMIT; lift++) {
    if (!isSolid(mask, mapWidth, mapHeight, body.x, body.y - lift)) {
      // Stand on the last solid pixel, not in the first empty one.
      body.y -= lift - 1;
      return;
    }
  }
  // Buried deeper than the budget. Leave it: the next terrain op or the kill
  // boundary will resolve it, and teleporting a character is worse.
}

/**
 * Advance the body one step horizontally. Mutates `body` in place.
 *
 * - `'moved'`   — x advanced, y follows the surface.
 * - `'blocked'` — nothing changed at all. A wall.
 * - `'fell'`    — x advanced and y dropped by `STEP_DOWN_LIMIT`; the ground ran
 *                 out. The caller takes it from there; gravity needs no help.
 */
export function walkStep(
  mask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  body: Body,
  dir: number
): WalkResult {
  const step = (Math.sign(dir) || 1) * WALK_STEP_PX;
  const probe = surfaceAhead(mask, mapWidth, mapHeight, body.x, body.y, dir);

  if (probe.kind === 'wall') return 'blocked';

  body.x += step;

  if (probe.kind === 'cliff') {
    body.y += STEP_DOWN_LIMIT;
    return 'fell';
  }

  body.y = probe.y;
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
 *
 * This is GunBound's `UpdateAngle` down to the constants, and unlike everything
 * else in this module it needed no change — tilt was always a two-point read of
 * the surface, never a question about a box.
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
 * Is a point inside a character's DRAWN body?
 *
 * The box is `PLAYER_WIDTH` wide, centred horizontally on `body.x`, and
 * `PLAYER_HEIGHT` tall standing ON `body.y` — so it spans
 * `[y - PLAYER_HEIGHT, y]`. `body.y` is the contact point, and therefore the
 * bottom edge.
 *
 * This is the ONE place the box survives, and it is GunBound's `CollisionOffset`
 * — a per-mobile hit radius that likewise never touches terrain. Projectiles
 * used to be tested against a circle of radius 20 centred on the feet, which is
 * wrong at both ends: a shot at head height falls outside it and misses a
 * character it visually struck, while a shot passing below the feet — inside
 * the ground — falls within it and hits.
 */
export function pointInBody(px: number, py: number, body: Body): boolean {
  return (
    px >= body.x - HALF_WIDTH &&
    px <= body.x + HALF_WIDTH &&
    py >= body.y - PLAYER_HEIGHT &&
    py <= body.y
  );
}
