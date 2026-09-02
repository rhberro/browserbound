export type TerrainOp =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'explosion'; x: number; y: number; radius: number };

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1200;
export const DEFAULT_CRATER_RADIUS = 50;
export const PLAYER_RADIUS = 20;

export function applyOpToBitmap(
  bitmap: Uint8Array,
  op: TerrainOp,
  mapWidth: number,
  mapHeight: number
): void {
  if (op.type === 'rect') {
    const x0 = Math.max(0, Math.floor(op.x));
    const y0 = Math.max(0, Math.floor(op.y));
    const x1 = Math.min(mapWidth, Math.ceil(op.x + op.width));
    const y1 = Math.min(mapHeight, Math.ceil(op.y + op.height));
    for (let y = y0; y < y1; y++) {
      const row = y * mapWidth;
      for (let x = x0; x < x1; x++) bitmap[row + x] = 1;
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
        if (dx * dx + dy * dy <= rSq) bitmap[row + x] = 0;
      }
    }
  }
}
