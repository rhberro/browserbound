import { describe, it, expect } from 'vitest';
import { appendOp, opContains } from '../terrainLog';
import { TerrainOp } from '../terrain';
import { applyOpToBitmap } from '../terrain';

const boom = (x: number, y: number, radius: number): TerrainOp => ({ type: 'explosion', x, y, radius });
const clear = (x: number, y: number, width: number, height: number): TerrainOp => ({
  type: 'clear',
  x,
  y,
  width,
  height,
});

describe('opContains', () => {
  it('sees a small crater inside a bigger one at the same place', () => {
    expect(opContains(boom(100, 100, 50), boom(100, 100, 20))).toBe(true);
  });

  it('sees an offset crater still fully inside', () => {
    expect(opContains(boom(100, 100, 50), boom(110, 100, 20))).toBe(true);
  });

  it('does not claim containment when the inner crater pokes out', () => {
    expect(opContains(boom(100, 100, 50), boom(140, 100, 20))).toBe(false);
  });

  it('does not claim containment for a bigger crater', () => {
    expect(opContains(boom(100, 100, 20), boom(100, 100, 50))).toBe(false);
  });

  it('sees a rect inside a rect', () => {
    expect(opContains(clear(0, 0, 100, 100), clear(10, 10, 10, 10))).toBe(true);
    expect(opContains(clear(0, 0, 100, 100), clear(90, 90, 20, 20))).toBe(false);
  });

  it('requires a rect corners to be inside a crater, not just its centre', () => {
    // Corners at distance hypot(25,25) = 35.4 from the centre, outside r=30,
    // even though the rect's own centre sits exactly on the circle's. Claiming
    // containment here would silently lose terrain destruction.
    expect(opContains(boom(100, 100, 30), clear(75, 75, 50, 50))).toBe(false);
    // Corners at 28.3, inside r=30. A circle is convex, so all four corners
    // being inside means the whole rect is.
    expect(opContains(boom(100, 100, 30), clear(80, 80, 40, 40))).toBe(true);
  });
});

describe('appendOp', () => {
  it('keeps an op that destroys new ground', () => {
    const log = appendOp([], boom(100, 100, 50));
    expect(log).toHaveLength(1);
  });

  it('drops an op already covered by an earlier one', () => {
    let log = appendOp([], boom(100, 100, 50));
    log = appendOp(log, boom(100, 100, 10));
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(boom(100, 100, 50));
  });

  it('drops earlier ops swallowed by a new bigger one', () => {
    let log = appendOp([], boom(100, 100, 10));
    log = appendOp(log, boom(120, 100, 10));
    expect(log).toHaveLength(2);
    log = appendOp(log, boom(110, 100, 60));
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(boom(110, 100, 60));
  });

  // The stated cause: lip collapse emits a narrow clear per column.
  it('merges contiguous single-column clears into one rectangle', () => {
    let log: TerrainOp[] = [];
    for (let x = 0; x < 40; x++) {
      log = appendOp(log, clear(100 + x, 200, 1, 30));
    }
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(clear(100, 200, 40, 30));
  });

  it('merges columns arriving right-to-left as well', () => {
    let log: TerrainOp[] = [];
    for (let x = 39; x >= 0; x--) {
      log = appendOp(log, clear(100 + x, 200, 1, 30));
    }
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(clear(100, 200, 40, 30));
  });

  it('does not merge columns at different heights', () => {
    let log = appendOp([], clear(100, 200, 1, 30));
    log = appendOp(log, clear(101, 260, 1, 30));
    expect(log).toHaveLength(2);
  });

  it('does not merge columns that are not adjacent', () => {
    let log = appendOp([], clear(100, 200, 1, 30));
    log = appendOp(log, clear(140, 200, 1, 30));
    expect(log).toHaveLength(2);
  });

  // The property that makes all of the above safe.
  it('produces the same terrain as the uncompacted log', () => {
    const W = 400;
    const H = 300;
    const ops: TerrainOp[] = [];
    for (let i = 0; i < 30; i++) {
      ops.push(boom(80 + i * 3, 150, 10 + (i % 7) * 4));
    }
    for (let x = 0; x < 50; x++) {
      ops.push(clear(120 + x, 100, 1, 12));
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
