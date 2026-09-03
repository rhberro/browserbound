import { describe, it, expect } from 'vitest';
import { appendOp, mergeAdjacent } from '../terrainLog';
import { TerrainOp, applyOpToBitmap } from '../terrain';

const boom = (x: number, y: number, radius: number): TerrainOp => ({
  type: 'explosion',
  x,
  y,
  radius,
});
const clear = (x: number, y: number, width: number, height: number): TerrainOp => ({
  type: 'clear',
  x,
  y,
  width,
  height,
});
const fill = (x: number, y: number, width: number, height: number): TerrainOp => ({
  type: 'rect',
  x,
  y,
  width,
  height,
});

describe('mergeAdjacent', () => {
  it('merges two touching columns of the same type', () => {
    expect(mergeAdjacent(clear(10, 5, 1, 3), clear(11, 5, 1, 3))).toEqual(clear(10, 5, 2, 3));
  });

  it('merges right-to-left too', () => {
    expect(mergeAdjacent(clear(11, 5, 1, 3), clear(10, 5, 1, 3))).toEqual(clear(10, 5, 2, 3));
  });

  // The defect this file was rewritten to remove. `rect` FILLS terrain and
  // `clear` erases it, so merging across types would write the wrong pixels.
  it('refuses to merge across types, because they have opposite effects', () => {
    expect(mergeAdjacent(clear(10, 5, 1, 3), fill(11, 5, 1, 3))).toBeNull();
    expect(mergeAdjacent(fill(10, 5, 1, 3), clear(11, 5, 1, 3))).toBeNull();
  });

  it('refuses to merge explosions, which are not rectangles', () => {
    expect(mergeAdjacent(boom(10, 10, 5), boom(11, 10, 5))).toBeNull();
    expect(mergeAdjacent(clear(10, 5, 1, 3), boom(11, 5, 5))).toBeNull();
  });

  it('refuses columns at different heights or thicknesses', () => {
    expect(mergeAdjacent(clear(10, 5, 1, 3), clear(11, 9, 1, 3))).toBeNull();
    expect(mergeAdjacent(clear(10, 5, 1, 3), clear(11, 5, 1, 4))).toBeNull();
  });

  it('refuses columns that do not touch', () => {
    expect(mergeAdjacent(clear(10, 5, 1, 3), clear(20, 5, 1, 3))).toBeNull();
  });
});

describe('appendOp', () => {
  it('keeps an op that cannot merge', () => {
    expect(appendOp([], boom(100, 100, 50))).toHaveLength(1);
  });

  // The stated cause: lip collapse walks columns and emits one narrow op each.
  it('collapses a run of single-column clears into one rectangle', () => {
    let log: TerrainOp[] = [];
    for (let x = 0; x < 40; x++) log = appendOp(log, clear(100 + x, 200, 1, 30));
    expect(log).toEqual([clear(100, 200, 40, 30)]);
  });

  it('collapses a run of sliver fills the same way', () => {
    let log: TerrainOp[] = [];
    for (let x = 0; x < 12; x++) log = appendOp(log, fill(50 + x, 80, 1, 2));
    expect(log).toEqual([fill(50, 80, 12, 2)]);
  });

  it('only ever merges with the LAST entry, never reaching back past another op', () => {
    // Reaching back would reorder an op past whatever sits between, and with
    // mixed polarities that changes the terrain.
    let log = appendOp([], clear(10, 5, 1, 3));
    log = appendOp(log, boom(500, 500, 10));
    log = appendOp(log, clear(11, 5, 1, 3));
    expect(log).toHaveLength(3);
  });

  it('never drops an op, however redundant it looks', () => {
    // A small crater inside a bigger one LOOKS droppable, but that reasoning
    // needs terrain to be write-once and `rect` refills it.
    let log = appendOp([], boom(100, 100, 50));
    log = appendOp(log, boom(100, 100, 5));
    expect(log).toHaveLength(2);
  });

  // The property that makes the whole thing safe, exercised with BOTH
  // polarities interleaved, which is what the real lip-collapse path produces.
  it('produces exactly the same terrain as the uncompacted log', () => {
    const W = 400;
    const H = 300;
    const ops: TerrainOp[] = [];
    for (let i = 0; i < 20; i++) {
      ops.push(boom(80 + i * 5, 150, 10 + (i % 5) * 4));
      // A collapse pass: a run of clears, then a run of sliver fills.
      for (let x = 0; x < 8; x++) ops.push(clear(60 + i + x, 120, 1, 6));
      for (let x = 0; x < 4; x++) ops.push(fill(70 + i + x, 140, 1, 3));
    }

    const full = new Uint8Array(W * H).fill(1);
    for (const op of ops) applyOpToBitmap(full, op, W, H);

    let log: TerrainOp[] = [];
    for (const op of ops) log = appendOp(log, op);

    const compacted = new Uint8Array(W * H).fill(1);
    for (const op of log) applyOpToBitmap(compacted, op, W, H);

    expect(log.length).toBeLessThan(ops.length);
    expect(Array.from(compacted)).toEqual(Array.from(full));
  });
});
