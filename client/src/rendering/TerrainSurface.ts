/**
 * TerrainSurface: the client's visual copy of the terrain.
 *
 * Terrain lives in a single persistent `RenderTexture` the size of the map
 * (ADR 0002 — the mask is authoritative, this is only the picture of it).
 * Destruction is applied by rendering a disc with the `erase` blend mode into
 * that texture, which zeroes its alpha: the crater becomes genuinely
 * transparent and whatever sits behind the terrain shows through, rather than
 * being painted over with a sky-coloured disc.
 *
 * Cost is O(1) per crater — one small render pass into an existing texture —
 * instead of replaying the whole op log as vector geometry on every explosion.
 *
 * Swapping the placeholder fill for an authored map is a one-call change:
 * call `loadMapImage(mapId)` instead of letting the `rect` ops paint the
 * ground (see Phase 1 of the movement/physics plan).
 */

import * as PIXI from 'pixi.js';
import { MAP_WIDTH, MAP_HEIGHT, TerrainOp } from '@browserbond/shared';

/** Placeholder ground colour, used until maps are authored as PNGs. */
export const TERRAIN_COLOR = 0x8b7355;

export class TerrainSurface {
  private renderer: PIXI.Renderer;
  private texture: PIXI.RenderTexture;
  private sprite: PIXI.Sprite;

  /**
   * Scratch graphics reused for every paint pass, plus the wrapper actually
   * handed to `renderer.render`. The wrapper is load-bearing: the root
   * container of a render pass becomes a render-group root, and a render-group
   * root's own `blendMode` is ignored. The blend only takes effect on a child.
   */
  private scratch: PIXI.Graphics;
  private paintRoot: PIXI.Container;

  /**
   * Ops observed but not yet painted. Ops arrive on websocket callbacks, which
   * can land at any point relative to the frame; draining them from the game
   * loop keeps every render-target switch inside the ticker and lets a burst
   * (a `terrainSync` replay on join) collapse into a couple of passes.
   */
  private pending: TerrainOp[] = [];

  /**
   * False while a map PNG is in flight. `loadMapImage` blits with `clear: true`
   * *after* an await, so any op painted during that window would be wiped by
   * the arriving map. Holding the queue instead means a `terrainSync` — which
   * carries a map id and its accumulated destruction together — replays its
   * craters on top of the map rather than under it. Defaults to true so a
   * client that never loads a map (placeholder `rect` ops) still paints.
   */
  private mapReady = true;

  constructor(renderer: PIXI.Renderer) {
    this.renderer = renderer;

    // 2000x1200 RGBA = ~9.6MB of GPU memory, well inside any WebGL budget.
    // No antialias: an MSAA target would have to resolve on every pass, and we
    // accumulate into this texture rather than redrawing it.
    this.texture = PIXI.RenderTexture.create({
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      antialias: false,
      resolution: 1,
    });

    // A freshly created render texture has undefined contents — clear it once
    // to fully transparent so erasing is meaningful from the first frame.
    this.scratch = new PIXI.Graphics();
    this.paintRoot = new PIXI.Container();
    this.paintRoot.addChild(this.scratch);

    this.renderer.render({
      container: this.paintRoot,
      target: this.texture,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });

    this.sprite = new PIXI.Sprite(this.texture);
    this.sprite.x = 0;
    this.sprite.y = 0;
  }

  /** The display object to place in the scene where terrain belongs. */
  get view(): PIXI.Container {
    return this.sprite;
  }

  /** Queue a terrain op. Painted on the next `flush()`. */
  applyOp(op: TerrainOp): void {
    this.pending.push(op);
  }

  /**
   * Paint every queued op into the terrain texture.
   *
   * Ops are grouped into runs of the same blend kind so a replay of the op log
   * costs a handful of render passes rather than one per op, while preserving
   * order between adds and erases (a rect drawn after a crater must refill it).
   */
  flush(): void {
    if (!this.mapReady || this.pending.length === 0) return;

    const ops = this.pending;
    this.pending = [];

    let runStart = 0;
    for (let i = 1; i <= ops.length; i++) {
      // 'explosion' and 'clear' both erase, so they batch into one pass;
      // 'rect' adds terrain and must stay ordered against them.
      const kind = (op: TerrainOp) => (op.type === 'rect' ? 'add' : 'erase');
      const sameKind = i < ops.length && kind(ops[i]) === kind(ops[runStart]);
      if (sameKind) continue;
      this.paintRun(ops.slice(runStart, i));
      runStart = i;
    }
  }

  /** Paint one run of same-kind ops in a single render pass. */
  private paintRun(ops: TerrainOp[]): void {
    const g = this.scratch;
    g.clear();

    if (ops[0].type === 'rect') {
      for (const op of ops) {
        if (op.type !== 'rect') continue;
        g.rect(op.x, op.y, op.width, op.height);
      }
      g.fill(TERRAIN_COLOR);
      g.blendMode = 'normal';
    } else {
      for (const op of ops) {
        // Both erasing kinds share this pass: 'explosion' carves a crater,
        // 'clear' removes a collapsed overhanging lip (see collapseLips).
        if (op.type === 'explosion') g.circle(op.x, op.y, op.radius);
        else if (op.type === 'clear') g.rect(op.x, op.y, op.width, op.height);
      }
      // 'erase' maps to blendFunc(ZERO, ONE_MINUS_SRC_ALPHA): the destination
      // is multiplied by (1 - srcAlpha), so an opaque disc drives colour AND
      // alpha to zero. The colour we fill with is irrelevant — only its alpha
      // matters — but it must be opaque for a full-strength erase.
      g.fill({ color: 0xffffff, alpha: 1 });
      g.blendMode = 'erase';
    }

    this.renderer.render({
      container: this.paintRoot,
      target: this.texture,
      clear: false,
    });

    // Leave the scratch in a neutral state so a stray render can't erase.
    g.blendMode = 'normal';
  }

  /**
   * Replace the terrain with an authored map PNG (alpha > 0 means solid).
   *
   * Phase 1 of the movement/physics plan swaps the placeholder `rect` fill for
   * this; the server rasterises the same file into its mask so the two cannot
   * drift apart. Nothing else in this class changes.
   */
  async loadMapImage(mapId: string): Promise<void> {
    this.mapReady = false;
    try {
      const texture = await PIXI.Assets.load<PIXI.Texture>(`/maps/${mapId}.png`);
      const mapSprite = new PIXI.Sprite(texture);
      mapSprite.x = 0;
      mapSprite.y = 0;
      const root = new PIXI.Container();
      root.addChild(mapSprite);

      this.renderer.render({
        container: root,
        target: this.texture,
        clear: true,
        clearColor: [0, 0, 0, 0],
      });

      root.destroy({ children: true });
    } finally {
      // Released even on failure: a map that will not load must not wedge the
      // op queue shut forever, leaving craters permanently unpainted.
      this.mapReady = true;
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.paintRoot.destroy({ children: true });
    this.texture.destroy(true);
  }
}
