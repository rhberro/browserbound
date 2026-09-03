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
 *
 * Scanning top-down means the HIGHEST surface in the window wins, so a shelf a
 * few pixels above the floor is stepped onto rather than walked under. That is
 * deliberate and is what "step up" means — a gap shorter than the step window
 * is not space a character could use anyway — and it is what GunBound does.
 * Only a roof high enough to stand under is walked beneath, which is the case
 * the old lookahead secant got wrong.
 *
 * A column outside the map is a WALL, not a cliff. The mask reads
 * out-of-bounds as empty, so without this the map edge is a ledge: a character
 * walks off it, falls past the Kill Boundary and dies on its own turn, having
 * paid a step for the privilege.
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
  if (col < 0 || col >= mapWidth) return { kind: 'wall' };

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
  // Exactly one pixel, and not a tunable. `surfaceAhead` reads a single column,
  // so a longer stride would land the body somewhere other than the column its
  // new surface came from — and step through anything narrower than the stride.
  const step = Math.sign(dir) || 1;
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
 * A drawn body: a contact point plus the lean of the chassis standing on it.
 * `tilt` is optional and defaults to 0, which is also what an airborne
 * character has.
 */
export interface TiltedBody extends Body {
  tilt?: number;
}

/**
 * Is a point inside a character's DRAWN body?
 *
 * An ORIENTED box: `PLAYER_WIDTH` by `PLAYER_HEIGHT`, standing on `body.y`, and
 * rotated with the chassis about that contact point — the same point PixiJS
 * rotates the sprite about, so the test and the drawing are the same rectangle.
 *
 * This is the ONE place the box survives, and it is GunBound's `CollisionBox`
 * — a per-mobile hit shape that likewise rotates with the mobile and likewise
 * never touches terrain.
 *
 * It is oriented rather than axis-aligned because ADR 0004 left it exactly one
 * job: being the thing players aim at. While the box was also the physics body
 * there was a real argument for axis-alignment, since an oriented box has to be
 * swept against the terrain mask; once terrain contact became a point, the only
 * question left was whether the hit target agrees with the picture. A static
 * box does not: at 10 degrees of tilt the drawn head is already 6px outside it,
 * and at 20 degrees 11.6px — most of a half-width — so characters were shot in
 * a box their sprite had visibly left, and shots that struck the head passed
 * through it.
 *
 * The transform is the standard one: rotate the query point by MINUS the tilt
 * about the contact point, which puts it in the body's own frame, then run the
 * axis-aligned test there. At tilt 0 it is exactly the old test.
 *
 * Projectiles were once tested against a circle of radius 20 centred on the
 * feet, which is wrong at both ends: a shot at head height falls outside it and
 * misses a character it visually struck, while a shot passing below the feet —
 * inside the ground — falls within it and hits.
 */
export function pointInBody(px: number, py: number, body: TiltedBody): boolean {
  const tilt = body.tilt ?? 0;
  const dx = px - body.x;
  const dy = py - body.y;

  // Rotate by -tilt into body space. Sin is negated rather than the angle,
  // which is the same rotation with one fewer trig call.
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;

  return (
    lx >= -HALF_WIDTH && lx <= HALF_WIDTH && ly >= -PLAYER_HEIGHT && ly <= 0
  );
}
