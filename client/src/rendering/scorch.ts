/**
 * Blast scorch: the burn a crater leaves on the terrain it did NOT remove.
 *
 * GunBound's `Topography.CreateErosion` darkens a thin band a few pixels
 * beyond the radius it erases (`BlastBlackmaskRadius`, and a colour factor of
 * roughly 40%) instead of removing it. The band is what makes an impact read
 * as a burn rather than a clean bite; without it a battlefield of old craters
 * looks punched.
 *
 * WHERE THIS LIVES, AND WHY IT IS CLIENT-ONLY. ADR 0002 splits the terrain in
 * two: the server's mask is the authority on solidity, and the client's render
 * texture is only a picture of it. A scorch is entirely on the picture side,
 * so it is derived on each client from the `explosion` ops it already receives,
 * and never transmitted:
 *
 *   - It cannot change what is solid, because it never touches the mask and
 *     there is no channel by which it could. Walking, Chassis Tilt and
 *     projectile collision read the mask and are structurally unable to see it.
 *   - A late joiner replaying the Terrain Op Log derives the same scorches in
 *     the same order as everyone else, so the battlefield matches.
 *   - It adds nothing to the op log, so it cannot grow replay cost in a long
 *     match.
 *
 * This module holds the GEOMETRY — which pixels darken and by how much.
 * `TerrainSurface` paints it into a separate layer that is composited over the
 * terrain with a multiply blend and clipped by the terrain's alpha, so a burn
 * only shows where terrain actually is. The disc covers the crater as well as
 * the band; the crater is erased out of the terrain underneath it.
 */

import { TerrainOp } from '@browserbond/shared';

/**
 * How far beyond the erased radius the burn reaches, in pixels.
 *
 * TUNE. GunBound's `BlastBlackmaskRadius` is 3. Wider reads as soot rather
 * than a burn and starts to hide the crater edge, which players aim against.
 */
export const SCORCH_BAND_WIDTH = 3;

/**
 * Brightness a single impact leaves behind, as a fraction of the terrain's
 * own colour. 0.4 is GunBound's `BlastBlackmaskExplosionRadiusColorFactor`.
 *
 * TUNE. This is applied multiplicatively, so it is also the accumulation rate:
 * a second overlapping impact lands at 0.16, a third at 0.064. Raising it
 * makes repeat shelling darken more gradually.
 */
export const SCORCH_BRIGHTNESS = 0.4;

/** The disc of terrain one impact burns, before its crater is erased. */
export interface ScorchDisc {
  x: number;
  y: number;
  /** Erased radius plus the band — the crater's own area is erased after. */
  radius: number;
}

/**
 * The scorch an op leaves, or null for ops that do not burn.
 *
 * Only `explosion` scorches. `clear` removes a collapsed lip — structural
 * cleanup rather than an impact, and marking it would draw burns along the
 * rectangle edges of a roof that fell in, nowhere near a blast.
 *
 * The disc covers the crater as well as the band. Painting the full disc and
 * letting the crater erase out of it afterwards avoids an annulus seam: an
 * annulus drawn edge-to-edge with the crater leaves a ring of half-covered
 * pixels along the shared boundary.
 */
export function scorchDiscFor(op: TerrainOp): ScorchDisc | null {
  if (op.type !== 'explosion') return null;
  return {
    x: op.x,
    y: op.y,
    radius: op.radius + SCORCH_BAND_WIDTH,
  };
}
