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
 * Scorch is baked straight into the terrain texture with a CUSTOM blend mode
 * (SCORCH_BLEND below): the disc multiplies the RGB of the terrain that
 * survives while preserving destination alpha, so a burn cannot touch pixels
 * that are not solid. The stock `multiply` blend cannot do this — it drove
 * every transparent texel the disc crossed (sky, a previous crater's hollow)
 * to opaque black, the ring artifact behind #40/#42.
 *
 * Swapping the placeholder fill for an authored map is a one-call change:
 * call `loadMapImage(mapId)` instead of letting the `rect` ops paint the
 * ground (see Phase 1 of the movement/physics plan).
 */

import * as PIXI from 'pixi.js';
import { MAP_WIDTH, MAP_HEIGHT, TerrainOp } from '@browserbond/shared';
import { scorchDiscFor, SCORCH_BRIGHTNESS } from './scorch';

/** Placeholder ground colour, used until maps are authored as PNGs. */
export const TERRAIN_COLOR = 0x8b7355;

/**
 * Gray whose channel value equals SCORCH_BRIGHTNESS, used for the baked scorch.
 * Drawn with the SCORCH_BLEND below, an opaque disc of this color scales a
 * pixel's RGB toward that fraction; at 0.4 it darkens a single impact to 40%
 * and accumulates (a second overlapping impact to 0.16), which is the intended
 * burn.
 */
const SCORCH_TINT = (() => {
  const c = Math.round(SCORCH_BRIGHTNESS * 255);
  return (c << 16) | (c << 8) | c;
})();

/**
 * Blend mode id for the scorch bake: `multiply`'s RGB blend with destination
 * alpha preserved.
 *
 * Pixi's stock `multiply` maps to `blendFuncSeparate(DST_COLOR,
 * ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`: RGB scales by the disc's
 * colour, but ALPHA comes out as `src.a + dst.a*(1-src.a)` — 1 wherever the
 * disc is opaque, whatever was there before. Baking a scorch disc over
 * transparent texels (sky, a previous crater's hollow) therefore paints
 * opaque black; multiplied over the frame it reads as black rings around
 * craters (#40/#42).
 *
 * This mode drops the alpha channel from the multiply: `blendFuncSeparate(
 * DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)` — RGB darkens exactly like
 * `multiply`, alpha is the destination's own. Where the terrain is
 * transparent the disc multiplies (0,0,0) and alpha stays 0: the clip to
 * terrain is inherent in the blend math, with no mask and no second texture.
 */
const SCORCH_BLEND = 'scorch-multiply';

/**
 * Register the SCORCH_BLEND blend mode with Pixi's WebGL state system.
 *
 * Pixi has no built-in blend for "multiply RGB, keep destination alpha", and
 * there is no public API for adding one, so this writes the same map the
 * state system reads at draw time. That map is REBUILT whenever the GL
 * context changes (context restore), so callers must re-register before each
 * scorch pass rather than once at startup — if the key is missing, Pixi
 * draws with 'normal' and the burn becomes flat grey discs.
 *
 * Returns whether the registration took effect. WebGL only: the WebGPU
 * renderer is not used by this app, and its blend state lives elsewhere.
 */
function registerScorchBlend(renderer: PIXI.Renderer): boolean {
  if (!(renderer instanceof PIXI.WebGLRenderer)) return false;
  const blendModesMap = (renderer.state as unknown as { blendModesMap?: Record<string, unknown> })
    .blendModesMap;
  if (!blendModesMap) return false;
  blendModesMap[SCORCH_BLEND] = [
    renderer.gl.DST_COLOR,
    renderer.gl.ONE_MINUS_SRC_ALPHA,
    renderer.gl.ZERO,
    renderer.gl.ONE,
  ];
  return true;
}

export class TerrainSurface {
  private renderer: PIXI.Renderer;
  private texture: PIXI.RenderTexture;
  private sprite: PIXI.Sprite;

  /**
   * The blend mode the scorch pass paints with: the custom `SCORCH_BLEND`
   * when it is registered on this renderer, the stock `multiply` otherwise.
   */
  private scorchBlend: PIXI.BLEND_MODES = 'multiply';

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
    this.ensureScorchBlend();

    // 2000x1200 RGBA = ~9.6MB of GPU memory, well inside any WebGL budget.
    // No antialias: an MSAA target would have to resolve on every pass, and we
    // accumulate into this texture rather than redrawing it.
    this.texture = PIXI.RenderTexture.create({
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      antialias: false,
      resolution: 1,
    });
    // Nearest sampling. The camera eases toward a target and almost always
    // lands on a fractional position, and with the default linear filter the
    // high-contrast terrain/sky boundary is interpolated against the sky — a
    // soft, shimmering edge that reads as the terrain "going invisible" as the
    // camera moves. Nearest snaps to a texel, keeping the edge crisp.
    this.texture.source.scaleMode = 'nearest';

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

  /**
   * (Re-)register the scorch blend and adopt it when it takes effect.
   *
   * Idempotent and cheap — a map write — so it runs in the constructor and
   * again before every scorch pass (the map is rebuilt on GL context
   * changes). When the renderer cannot host the custom blend (not WebGL), the
   * scorch pass keeps the stock `multiply`: the old black rings rather than
   * flat discs, and WebGPU is not used by this app anyway.
   */
  private ensureScorchBlend(): void {
    if (registerScorchBlend(this.renderer)) {
      this.scorchBlend = SCORCH_BLEND as PIXI.BLEND_MODES;
    }
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

  /** Paint one run of same-kind ops. */
  private paintRun(ops: TerrainOp[]): void {
    const g = this.scratch;

    if (ops[0].type === 'rect') {
      g.clear();
      for (const op of ops) {
        if (op.type !== 'rect') continue;
        g.rect(op.x, op.y, op.width, op.height);
      }
      g.fill(TERRAIN_COLOR);
      g.blendMode = 'normal';
      this.renderer.render({
        container: this.paintRoot,
        target: this.texture,
        clear: false,
      });
    } else {
      // Scorch pass: explosions multiply in a disc a little wider than the
      // crater they are about to carve, darkening the terrain that will
      // survive. The blend preserves destination alpha, so the disc only
      // touches texels that are solid terrain — it cannot punch through a
      // previous crater's hollow or the sky. The crater is erased out of the
      // disc below, so what remains is a darkened ring hugging the crater.
      let hasScorch = false;
      g.clear();
      for (const op of ops) {
        if (op.type !== 'explosion') continue;
        const disc = scorchDiscFor(op);
        if (!disc) continue;
        g.circle(disc.x, disc.y, disc.radius);
        hasScorch = true;
      }
      if (hasScorch) {
        // Re-registered per pass: Pixi rebuilds its blend-mode map when the GL
        // context changes, and a missing key would draw this pass with the
        // 'normal' blend — flat grey discs.
        this.ensureScorchBlend();
        g.fill({ color: SCORCH_TINT, alpha: 1 });
        g.blendMode = this.scorchBlend;
        this.renderer.render({
          container: this.paintRoot,
          target: this.texture,
          clear: false,
        });
      }

      // Erase pass: the crater itself plus any collapsed lips. 'erase' maps to
      // blendFunc(ZERO, ONE_MINUS_SRC_ALPHA): the destination is multiplied by
      // (1 - srcAlpha), so an opaque disc drives colour AND alpha to zero.
      g.clear();
      for (const op of ops) {
        // Both erasing kinds share this pass: 'explosion' carves a crater,
        // 'clear' removes a collapsed overhanging lip (see collapseLips).
        if (op.type === 'explosion') g.circle(op.x, op.y, op.radius);
        else if (op.type === 'clear') g.rect(op.x, op.y, op.width, op.height);
      }
      g.fill({ color: 0xffffff, alpha: 1 });
      g.blendMode = 'erase';
      this.renderer.render({
        container: this.paintRoot,
        target: this.texture,
        clear: false,
      });
    }

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
