/**
 * Compaction for the terrain operation log.
 *
 * Every crater and every collapsed lip is appended to a log that is replayed in
 * full to each joining client. Nothing ever removed anything from it, so a long
 * match handed a late joiner an ever-growing payload — and lip collapse is the
 * worst contributor, because it walks the affected columns and emits a NARROW
 * OP PER COLUMN, so one collapse can add dozens of ops describing what is
 * really a couple of rectangles.
 *
 * WHY THIS IS DELIBERATELY TIMID. It is tempting to also drop ops whose area a
 * later one covers — a small crater inside a bigger one contributes nothing.
 * That reasoning needs terrain to be write-once, and it is not: `TerrainOp` has
 * three variants and `rect` ADDS terrain (`applyOpToBitmap` fills for `rect`
 * and clears for the others), which `collapseLips` emits to seal hairline
 * slivers. With both polarities in one log the ORDER is the meaning, and an op
 * "covered" by a neighbour of the opposite polarity is doing the opposite job.
 * Dropping it silently changes the terrain a late joiner rebuilds.
 *
 * So the only rewrite here is one that provably cannot change the result:
 * merging CONSECUTIVE ops of the SAME TYPE that are adjacent columns of equal
 * vertical extent. Two such ops applied in sequence write exactly the same
 * pixels as the single rectangle spanning both, whatever came before or after,
 * because nothing can be interleaved between two ops that are already
 * neighbours.
 *
 * This is compaction, not a hard bound: a match that keeps digging genuinely
 * new ground still grows the log. Bounding it absolutely would mean replacing
 * the log with a mask snapshot, which the client cannot consume today.
 */

import { TerrainOp } from './terrain';

/** An op with a rectangular footprint. Explosions are excluded by type. */
type RectOp = Extract<TerrainOp, { width: number; height: number }>;

function isRect(op: TerrainOp): op is RectOp {
  return op.type !== 'explosion';
}

/**
 * Merge two ops into one if doing so provably cannot change the result.
 *
 * Requires the SAME TYPE — so the same fill polarity — plus the same vertical
 * span and touching horizontal extents. Returns null when they cannot be
 * merged, which is the common case and the safe default.
 */
export function mergeAdjacent(a: TerrainOp, b: TerrainOp): TerrainOp | null {
  if (!isRect(a) || !isRect(b)) return null;
  if (a.type !== b.type) return null;
  if (a.y !== b.y || a.height !== b.height) return null;

  if (a.x + a.width === b.x) return { ...a, width: a.width + b.width };
  if (b.x + b.width === a.x) return { ...a, x: b.x, width: a.width + b.width };
  return null;
}

/**
 * Append an op to the log, merging it into the previous entry where that is
 * provably equivalent.
 *
 * Only the LAST entry is considered, which is what keeps this safe: merging
 * with an earlier one would reorder it past everything in between, and with
 * mixed polarities that changes the terrain.
 */
export function appendOp(log: TerrainOp[], op: TerrainOp): TerrainOp[] {
  const last = log[log.length - 1];
  if (last) {
    const merged = mergeAdjacent(last, op);
    if (merged) {
      const next = log.slice();
      next[next.length - 1] = merged;
      return next;
    }
  }
  return [...log, op];
}
