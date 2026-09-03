import { describe, it, expect } from 'vitest';
import {
  applyOpToBitmap,
  collapseLips,
  LIP_MAX_THICKNESS,
  SLIVER_MAX_GAP,
  TerrainOp,
} from '../terrain';

const W = 120;
const H = 200;

/** Solid ground from `groundY` down. */
function ground(groundY: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = groundY; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 1;
  return m;
}

const solid = (m: Uint8Array, x: number, y: number) => m[y * W + x] === 1;

/** Solid runs in a column, as [top, bottom] pairs. */
function runs(m: Uint8Array, x: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let y = 0;
  while (y < H) {
    if (!solid(m, x, y)) { y++; continue; }
    const top = y;
    while (y < H && solid(m, x, y)) y++;
    out.push([top, y - 1]);
  }
  return out;
}

function apply(m: Uint8Array, ops: TerrainOp[]) {
  for (const op of ops) applyOpToBitmap(m, op, W, H);
}

describe('clear op', () => {
  it('erases a rectangle, where rect fills one', () => {
    const m = ground(100);
    applyOpToBitmap(m, { type: 'clear', x: 10, y: 100, width: 5, height: 20 }, W, H);
    expect(solid(m, 12, 110)).toBe(false);
    expect(solid(m, 12, 121)).toBe(true);
    applyOpToBitmap(m, { type: 'rect', x: 10, y: 100, width: 5, height: 20 }, W, H);
    expect(solid(m, 12, 110)).toBe(true);
  });
});

describe('collapseLips', () => {
  it('removes a thin roof over a gap too short to stand in', () => {
    const m = ground(100);
    // Carve below the surface: leaves a thin lip with a shallow void beneath.
    applyOpToBitmap(m, { type: 'explosion', x: 60, y: 120, radius: 30 }, W, H);
    // x = 88 sits near the rim, where the void under the lip is ~22px — too
    // short for a 36px body to stand in, so it is a trap rather than a cave.
    expect(runs(m, 88).length).toBeGreaterThan(1); // an overhang exists

    apply(m, collapseLips(m, 60, 120, 30, W, H, 36));
    expect(runs(m, 88).length).toBe(1); // collapsed to open sky
  });

  it('leaves a cave with headroom alone', () => {
    const m = ground(40);
    // A thin roof, but a 60px void underneath — walkable, so a real cave.
    applyOpToBitmap(m, { type: 'clear', x: 40, y: 60, width: 40, height: 60 }, W, H);
    const before = runs(m, 60);
    const ops = collapseLips(m, 60, 90, 40, W, H, 36);
    apply(m, ops);
    expect(runs(m, 60)).toEqual(before); // untouched
  });

  it('leaves a thick roof alone even over a short gap', () => {
    const m = ground(20);
    const thick = LIP_MAX_THICKNESS + 20;
    applyOpToBitmap(m, { type: 'clear', x: 40, y: 20 + thick, width: 40, height: 10 }, W, H);
    const before = runs(m, 60);
    apply(m, collapseLips(m, 60, 20 + thick, 40, W, H, 36));
    expect(runs(m, 60)).toEqual(before); // thick rock survives
  });

  it('fills hairline slivers rather than removing the roof above them', () => {
    const m = ground(100);
    applyOpToBitmap(m, { type: 'clear', x: 50, y: 130, width: 20, height: SLIVER_MAX_GAP }, W, H);
    expect(runs(m, 60).length).toBe(2);
    apply(m, collapseLips(m, 60, 130, 30, W, H, 36));
    const after = runs(m, 60);
    expect(after.length).toBe(1);
    expect(after[0][0]).toBe(100); // the roof stayed; the gap was filled
  });

  it('merges adjacent columns into rectangles rather than one op per column', () => {
    const m = ground(100);
    applyOpToBitmap(m, { type: 'explosion', x: 60, y: 120, radius: 30 }, W, H);
    const ops = collapseLips(m, 60, 120, 30, W, H, 36);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.length).toBeLessThan(30); // not one per column
  });
});
