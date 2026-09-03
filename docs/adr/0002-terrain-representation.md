# ADR 0002: Terrain is a pixel mask, authored as PNG, transmitted as ops

## Status

Accepted — 2026-09-02

## Context

Terrain must be destructible, and destruction must be legible: players aim at the ground to
reshape it, and reshaping it must change what characters can and cannot do. The representation we
pick decides what destruction *can* mean, and it is the hardest thing in the project to change
later, because collision, rendering, map authoring and the wire format all sit on top of it.

Three representations were live options:

- **Per-column heightmap.** One ground height per column. Collision is O(1), the steep-slope rule
  is a trivial subtraction, and terrain collapse ("dirt falls") is per-column settling. This is
  what Scorched Earth used.
- **Polygon / signed distance.** Smooth edges at any zoom, cheap to store, but boolean subtraction
  of craters is fiddly and degenerate cases (slivers, self-intersection) are a permanent tax.
- **Pixel mask.** One bit of solidity per world pixel. This is what Worms Armageddon, Hedgewars and
  GunBound all use.

We already had a `Uint8Array` mask, so the decision was really whether to keep it.

## Decision

Terrain is a **pixel mask**: one byte per world pixel, solid or not.

Maps are **authored as PNG images** and rasterised into the mask on room creation. A pixel is
solid unless transparent. The client loads the same PNG as its terrain texture.

Destruction is transmitted as **`TerrainOp`s** — `rect` (add) and `explosion` (erase) — never as
mask contents. The server applies ops to its mask; the client applies the same ops by erasing into
a render texture. A late-joining client replays the op log.

**Detached terrain hangs in the air.** We do not detect or collapse disconnected chunks.

## Consequences

**What we gain.** Caves, overhangs and tunnels are expressible, so a shot can hollow out a hill
rather than only lower it. Craters are exact and cheap: erase a disc, no geometry to repair. Maps
are authorable in any image editor by someone who does not touch the codebase. And because server
mask and client texture are rasterised from the same PNG, they cannot drift apart — a class of bug
that would otherwise be invisible until a shot passed through what a player saw as solid ground.

**What we give up.** The heightmap's O(1) collision, and with it the trivial slope test — we pay
for overhangs with a per-pixel probe. And "dirt falls" is off the table: with no column structure,
collapse means connected-component labelling over 2.4M pixels per explosion. We accept this
readily; none of Worms, Hedgewars or GunBound collapse terrain either, so floating islands are a
convention players already read as normal rather than as a bug.

**What we must remember.** Solidity queries are the hottest path in the simulation and every one
of them rounds to integer pixels. Anything that samples terrain — walking, tilt, projectile
sweeps — must be written against the mask, not against the visual copy, and the visual copy must
never feed back into the simulation. Hedgewars keeps these as two separate arrays for exactly this
reason, and we follow that split.

## References

- Worms Armageddon colour map (transparent index = free space): https://worms2d.info/Colour_map
- Hedgewars `uLandGraphics.pas` — span-filled Bresenham crater, `Despeckle`
- Scorched Earth, the heightmap counterexample: https://en.wikipedia.org/wiki/Scorched_Earth_(video_game)
