export type TerrainOp =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'explosion'; x: number; y: number; radius: number }
  /** Erase a rectangle. Used to collapse thin overhanging lips — see collapseLips. */
  | { type: 'clear'; x: number; y: number; width: number; height: number };

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1200;
export const DEFAULT_CRATER_RADIUS = 50;

/**
 * Apply an op to the bitmap, and report how many pixels it actually changed.
 *
 * The count is what `rect` added (0→1) or what `explosion`/`clear` removed
 * (1→0) — pixels already at the target value do not count. `destroyTerrain`
 * uses the explosion return as the debris budget: a shot into open ground
 * reports a large number, the same shot into an existing crater reports almost
 * none, because there is nothing left to remove.
 */
export function applyOpToBitmap(
  bitmap: Uint8Array,
  op: TerrainOp,
  mapWidth: number,
  mapHeight: number
): number {
  let changed = 0;
  if (op.type === 'rect' || op.type === 'clear') {
    const fill = op.type === 'rect' ? 1 : 0;
    const x0 = Math.max(0, Math.floor(op.x));
    const y0 = Math.max(0, Math.floor(op.y));
    const x1 = Math.min(mapWidth, Math.ceil(op.x + op.width));
    const y1 = Math.min(mapHeight, Math.ceil(op.y + op.height));
    for (let y = y0; y < y1; y++) {
      const row = y * mapWidth;
      for (let x = x0; x < x1; x++) {
        if (bitmap[row + x] !== fill) {
          bitmap[row + x] = fill;
          changed++;
        }
      }
    }
  } else {
    const { x: cx, y: cy, radius: r } = op;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(mapWidth - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(mapHeight - 1, Math.ceil(cy + r));
    const rSq = r * r;
    for (let y = y0; y <= y1; y++) {
      const row = y * mapWidth;
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= rSq && bitmap[row + x] !== 0) {
          bitmap[row + x] = 0;
          changed++;
        }
      }
    }
  }
  return changed;
}


/**
 * Thickest overhanging lip an explosion is allowed to leave behind.
 *
 * A shot landing inside an existing crater carves a disc centred BELOW the
 * surface, which leaves a thin roof with a shallow void under it. A character
 * taller than that void is wedged: it cannot climb (the roof is in the way) and
 * cannot pass (the gap is too short). No climb limit fixes that.
 */
export const LIP_MAX_THICKNESS = 28;

/**
 * Air gaps thinner than this are filled in rather than left.
 *
 * Overlapping discs leave 1-2px slivers of air between them — not passages,
 * just noise, and noise a leading-edge probe can catch on. Hedgewars removes
 * the equivalent artifact with `Despeckle`. Kept small so it can never seal a
 * real cave mouth.
 */
export const SLIVER_MAX_GAP = 3;

/**
 * Find thin roofs that an explosion left over impassable gaps, and return the
 * ops that remove them.
 *
 * The test is deliberately narrow — a solid run is collapsed only when it is
 * BOTH thin AND sits over a void too short to walk through. A thick roof, or a
 * thin roof over a gap tall enough to stand in, is a real cave and survives:
 * overhangs are the reason the terrain is a pixel mask at all (ADR 0002), so
 * this must not quietly erode them all away.
 *
 * Returns `clear` ops rather than mutating, because the client has no mask and
 * must be told exactly what changed. Adjacent columns sharing a run are merged
 * so one crater costs a handful of ops, not one per column.
 */
export function collapseLips(
  bitmap: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  mapWidth: number,
  mapHeight: number,
  minPassableGap: number
): TerrainOp[] {
  const x0 = Math.max(0, Math.floor(cx - radius - 2));
  const x1 = Math.min(mapWidth - 1, Math.ceil(cx + radius + 2));

  // Per column, the single run to remove (if any).
  const runs = new Map<number, { top: number; bottom: number }>();
  const slivers: TerrainOp[] = [];

  for (let x = x0; x <= x1; x++) {
    let y = 0;
    while (y < mapHeight) {
      if (bitmap[y * mapWidth + x] !== 1) { y++; continue; }
      const top = y;
      while (y < mapHeight && bitmap[y * mapWidth + x] === 1) y++;
      const bottom = y - 1;

      // Air above is required: a run reaching y=0 is not a lip.
      if (top === 0) continue;

      // Measure the void directly beneath this run.
      let gapEnd = bottom + 1;
      while (gapEnd < mapHeight && bitmap[gapEnd * mapWidth + x] !== 1) gapEnd++;
      const gap = gapEnd - (bottom + 1);

      // A hairline gap is an artifact of overlapping discs, not a passage.
      // Fill it and keep the wall. Checked BEFORE thickness on purpose: a
      // sliver is a property of the GAP, and slivers under thick rock are the
      // common case (three shots in one spot leave them between the discs).
      if (gap > 0 && gap <= SLIVER_MAX_GAP) {
        slivers.push({ type: 'rect', x, y: bottom + 1, width: 1, height: gap });
        continue;
      }

      const thickness = bottom - top + 1;
      if (thickness > LIP_MAX_THICKNESS) continue;

      // A gap you can walk through is a cave, not a trap. Leave it alone.
      if (gap === 0 || gap >= minPassableGap) continue;

      runs.set(x, { top, bottom });
      break; // one lip per column is enough
    }
  }

  // Merge adjacent columns that share the same run into rectangles.
  const ops: TerrainOp[] = [];
  let startX: number | null = null;
  let prev: { top: number; bottom: number } | null = null;
  for (let x = x0; x <= x1 + 1; x++) {
    const run = runs.get(x);
    const same = run && prev && run.top === prev.top && run.bottom === prev.bottom;
    if (!same) {
      if (startX !== null && prev) {
        ops.push({
          type: 'clear',
          x: startX,
          y: prev.top,
          width: x - startX,
          height: prev.bottom - prev.top + 1,
        });
      }
      startX = run ? x : null;
      prev = run ?? null;
    }
  }
  return [...slivers, ...ops];
}
