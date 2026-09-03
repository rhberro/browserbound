/**
 * Compaction for the terrain operation log.
 *
 * Every crater and every collapsed lip is appended to a log that is replayed in
 * full to each joining client. Nothing ever removed anything from it, so a long
 * match handed a late joiner an ever-growing payload — and lip collapse is the
 * worst contributor, because it emits a narrow `clear` PER COLUMN, so one
 * collapse can add dozens of ops describing a single rectangle.
 *
 * Two facts make compaction safe. Terrain is only ever REMOVED, never restored,
 * so the accumulated mask is the union of every op and their ORDER does not
 * matter. And union is idempotent, so an op whose area is already covered by
 * another contributes nothing and can be dropped.
 *
 * This is compaction, not a hard bound: a match that keeps digging genuinely
 * new ground still grows the log. Bounding it absolutely would mean replacing
 * the log with a mask snapshot, which the client cannot currently consume.
 */

import { TerrainOp } from './terrain';

/** Axis-aligned bounds of an op, for the cheap containment pre-test. */
function bounds(op: TerrainOp): { x0: number; y0: number; x1: number; y1: number } {
  if (op.type === 'explosion') {
    return { x0: op.x - op.radius, y0: op.y - op.radius, x1: op.x + op.radius, y1: op.y + op.radius };
  }
  return { x0: op.x, y0: op.y, x1: op.x + op.width, y1: op.y + op.height };
}

/**
 * Is `inner` entirely inside `outer`?
 *
 * Conservative on purpose: it returns true only where containment is certain,
 * so a false answer costs a redundant op while a wrong true answer would lose
 * terrain destruction. The circle-in-circle case is exact; everything else
 * falls back to bounding boxes, which for a rect inside a circle means the
 * rect's CORNERS are what must be inside, and that is what is tested.
 */
export function opContains(outer: TerrainOp, inner: TerrainOp): boolean {
  if (outer.type === 'explosion' && inner.type === 'explosion') {
    const d = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    return d + inner.radius <= outer.radius;
  }

  if (outer.type === 'explosion') {
    const b = bounds(inner);
    const corners: Array<[number, number]> = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x0, b.y1],
      [b.x1, b.y1],
    ];
    return corners.every(([x, y]) => Math.hypot(x - outer.x, y - outer.y) <= outer.radius);
  }

  if (inner.type === 'explosion') {
    // A circle inside a rect: its bounding box inside the rect is exact.
    const o = bounds(outer);
    const i = bounds(inner);
    return i.x0 >= o.x0 && i.y0 >= o.y0 && i.x1 <= o.x1 && i.y1 <= o.y1;
  }

  const o = bounds(outer);
  const i = bounds(inner);
  return i.x0 >= o.x0 && i.y0 >= o.y0 && i.x1 <= o.x1 && i.y1 <= o.y1;
}

/**
 * Merge two rectangles into one if they are adjacent columns of equal extent.
 *
 * This is the lip-collapse case specifically: contiguous single-column clears
 * at the same height collapse into one rectangle, turning dozens of ops into
 * one without changing a single pixel of the result.
 */
function mergeRects(a: TerrainOp, b: TerrainOp): TerrainOp | null {
  if (a.type === 'explosion' || b.type === 'explosion') return null;
  if (a.type !== b.type) return null;
  if (a.y !== b.y || a.height !== b.height) return null;
  if (a.x + a.width === b.x) return { ...a, width: a.width + b.width };
  if (b.x + b.width === a.x) return { ...a, x: b.x, width: a.width + b.width };
  return null;
}

/**
 * Append an op to the log, compacting as it goes.
 *
 * Returns the new log. Order is irrelevant to the result (union), so merging
 * with any earlier entry is safe, not just the most recent one — but only the
 * tail is scanned for merges, because lip collapse emits its columns
 * consecutively and scanning the whole log per append would be quadratic.
 */
export function appendOp(log: TerrainOp[], op: TerrainOp, mergeWindow = 64): TerrainOp[] {
  // Already covered by something in the log: contributes nothing.
  for (const existing of log) {
    if (opContains(existing, op)) return log;
  }

  const start = Math.max(0, log.length - mergeWindow);
  for (let i = log.length - 1; i >= start; i--) {
    const merged = mergeRects(log[i], op);
    if (merged) {
      const next = log.slice();
      next[i] = merged;
      return next;
    }
  }

  // The new op may swallow earlier ones — a large crater over old damage.
  const kept = log.filter((existing) => !opContains(op, existing));
  kept.push(op);
  return kept;
}
