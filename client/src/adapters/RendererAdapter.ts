/**
 * RendererAdapter: Handles all PIXI rendering.
 *
 * Manages:
 * - Player sprites and health bars
 * - Terrain rendering
 * - Projectile graphics
 * - Aim line and explosion animations
 * - UI text display
 */

import * as PIXI from 'pixi.js';
import {
  TerrainOp,
  PlayerView,
  worldFiringAngle,
  degToRad,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
} from '@browserbond/shared';
import type { GameState } from '../gameState';
import { TerrainSurface } from '../rendering/TerrainSurface';
import { PlayerMotion } from '../rendering/PlayerMotion';
import type { AimState } from './InputAdapter';

/** Health bar geometry, in pixels, measured from the top of the body. */
const HEALTH_BAR_WIDTH = 40;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_GAP = 8;

/** Radius the impact flash reaches at the end of its animation, in pixels. */
const EXPLOSION_MAX_RADIUS = 40;

/** Length of the on-character aim arrow, in pixels. */
const AIM_ARROW_LENGTH = 35;

/**
 * Draw an arrow of fixed length pointing along +x, from the origin.
 *
 * Called ONCE per indicator. Direction and position are then transforms on the
 * resulting object, so the geometry is never re-triangulated.
 */
function buildArrow(graphics: PIXI.Graphics, length: number, width: number, color: number): void {
  graphics.moveTo(0, 0);
  graphics.lineTo(length, 0);
  graphics.stroke({ width, color });

  const head = 8;
  const spread = (Math.PI * 5) / 6;
  for (const a of [spread, -spread]) {
    graphics.moveTo(length, 0);
    graphics.lineTo(length + Math.cos(a) * head, -Math.sin(a) * head);
  }
  graphics.stroke({ width, color });
}

/** The scene-graph objects belonging to one character. */
interface PlayerSprite {
  /** Root, positioned at the character's FEET. */
  root: PIXI.Container;
  /** The body. The only part that rotates with chassis tilt. */
  chassis: PIXI.Graphics;
  /** Health fill. Redrawn only when `health` below changes. */
  healthBar: PIXI.Graphics;
  /** Health the bar was last drawn at, so unchanged bars are not rebuilt. */
  health: number;
  /** Aim arrow, present only while this character holds the turn. */
  angleIndicator: PIXI.Graphics | null;
}

interface DeathExplosion {
  graphics: PIXI.Graphics;
  x: number;
  y: number;
  start: number;
  duration: number;
  shards: { angle: number; speed: number; size: number }[];
}

export class RendererAdapter {
  private container: PIXI.Container;
  /**
   * Everything owned per character, in ONE record.
   *
   * These were three parallel playerId-keyed maps that had to be inserted into
   * and deleted from in lockstep, and the lockstep was already broken once —
   * the aim arrow was detached without being destroyed on the removal path
   * while the identical object was destroyed on the other. A record cannot
   * drift from itself, and `releaseSprite` is the single teardown.
   */
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private terrain: TerrainSurface;
  private motion: PlayerMotion = new PlayerMotion();
  /**
   * Separate track set for projectiles. Same interpolation, but its own
   * instance so a projectile id can never collide with a session id, and so
   * clearing one does not disturb the other.
   */
  private projectileMotion: PlayerMotion = new PlayerMotion();
  private lastProjectileFrameTime: number = performance.now();
  private lastFrameTime: number = performance.now();
  private localPlayerId: string | null = null;
  private aimLine: PIXI.Graphics | null = null;
  private projectileGraphicsMap: Map<string, PIXI.Graphics> = new Map();
  private explosionGraphics: PIXI.Graphics | null = null;
  private explosionDuration: number = 500;
  private deathExplosions: DeathExplosion[] = [];

  constructor(app: PIXI.Application, container: PIXI.Container) {
    this.container = container;

    this.terrain = new TerrainSurface(app.renderer);
    this.container.addChildAt(this.terrain.view, 0);
  }

  /**
   * Apply a terrain operation.
   *
   * Ops are queued and painted into the persistent terrain texture on the next
   * frame — O(1) per crater, and craters erase the texture rather than being
   * overpainted with a sky-coloured disc.
   */
  applyTerrainOp(op: TerrainOp): void {
    this.terrain.applyOp(op);
  }

  /**
   * Replace the placeholder terrain with an authored map PNG.
   *
   * Not wired up yet — Phase 1 of the movement/physics plan calls this instead
   * of relying on the server's `rect` op to paint the ground.
   */
  loadMap(mapId: string): Promise<void> {
    return this.terrain.loadMapImage(mapId);
  }

  /**
   * Update all player sprites and health bars.
   */
  updatePlayers(gameState: GameState, aimState?: AimState): void {
    const now = performance.now();
    // Clamped so a backgrounded tab doesn't produce one enormous smoothing step.
    const dtMs = Math.min(100, Math.max(0, now - this.lastFrameTime));
    this.lastFrameTime = now;

    // Terrain ops arrive on websocket callbacks; paint them from the frame loop
    // so every render-target switch happens at a well-defined point.
    this.terrain.flush();

    this.localPlayerId = gameState.getRoomSessionId();

    // Remove sprites for players that no longer exist
    for (const playerId of [...this.playerSprites.keys()]) {
      if (!gameState.players.has(playerId)) {
        this.releaseSprite(playerId);
      }
    }

    // Create or update player sprites
    for (const [playerId, player] of gameState.players) {
      let sprite = this.playerSprites.get(playerId);

      if (!sprite) {
        sprite = this.createPlayerSprite(playerId, gameState);
        this.playerSprites.set(playerId, sprite);
      }
      const root = sprite.root;

      // Update position: the local player is smoothed with no delay, remote
      // players are interpolated ~2 patches in the past (see PlayerMotion).
      const isLocal = playerId === this.localPlayerId;
      const pos = this.motion.update(playerId, player.x, player.y, isLocal, dtMs, now);
      root.x = pos.x;
      root.y = pos.y;

      // A character whose player is mid-reconnect must not read as idle. It
      // stays on the field — the server is still holding its turn and budget —
      // but pulses translucent so the opponent can tell the difference between
      // someone thinking and someone whose connection dropped.
      root.alpha = player.connected === false ? 0.35 + 0.25 * Math.sin(now / 200) : 1;

      // ADR 0003 rejected cosmetic tilt in the other direction too: a chassis
      // that does not visibly lean while the shot obeys the slope is just as
      // much a lie as a shot that ignores a visible lean. Only the chassis
      // rotates — the health bars stay level.
      sprite.chassis.rotation = player.tilt;

      this.updateHealthBar(sprite, player.health);

      // Draw angle indicator for current player
      this.updateAngleIndicator(playerId, player, gameState, aimState);
    }
  }

  /**
   * Create a player sprite with health bar.
   */
  private createPlayerSprite(playerId: string, gameState: GameState): PlayerSprite {
    const root = new PIXI.Container();
    root.label = `player_${playerId}`;

    // The chassis, drawn as the body the physics actually simulates: the
    // container's origin is the FEET, matching player.y, so the box rises from
    // y=0 to y=-PLAYER_HEIGHT and is centred on x. It used to be a circle of
    // radius 20 centred on the feet — half of it below ground, wider than the
    // real body, and with the health bar buried inside it.
    const chassis = new PIXI.Graphics();
    chassis.rect(-PLAYER_WIDTH / 2, -PLAYER_HEIGHT, PLAYER_WIDTH, PLAYER_HEIGHT);
    chassis.fill(playerId === gameState.getRoomSessionId() ? 0xff0000 : 0x0000ff);
    root.addChild(chassis);

    // Health bars ride ABOVE the body and outside the rotating chassis, so
    // they stay level and readable however far the character leans.
    const bars = new PIXI.Container();
    bars.y = -PLAYER_HEIGHT - HEALTH_BAR_GAP;

    const healthBg = new PIXI.Graphics();
    healthBg.rect(-HEALTH_BAR_WIDTH / 2, -HEALTH_BAR_HEIGHT, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
    healthBg.fill(0x333333);
    bars.addChild(healthBg);

    const healthBar = new PIXI.Graphics();
    bars.addChild(healthBar);

    root.addChild(bars);
    this.container.addChild(root);

    // health starts at NaN so the first updateHealthBar always draws.
    return { root, chassis, healthBar, health: NaN, angleIndicator: null };
  }

  /**
   * Tear down everything belonging to one character.
   *
   * The single teardown path, so no part of a departing character can be
   * detached-but-not-destroyed while a sibling is destroyed correctly.
   */
  private releaseSprite(playerId: string): void {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    this.container.removeChild(sprite.root);
    sprite.root.destroy({ children: true });

    if (sprite.angleIndicator) {
      this.container.removeChild(sprite.angleIndicator);
      sprite.angleIndicator.destroy();
    }

    this.playerSprites.delete(playerId);
    this.motion.remove(playerId);
  }

  /**
   * Update aim angle indicator arrow for current player.
   */
  private updateAngleIndicator(
    playerId: string,
    player: PlayerView,
    gameState: GameState,
    aimState?: AimState
  ): void {
    const isCurrentPlayer = playerId === gameState.turnState?.currentPlayerId;
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    if (!isCurrentPlayer) {
      if (sprite.angleIndicator) {
        this.container.removeChild(sprite.angleIndicator);
        sprite.angleIndicator.destroy();
        sprite.angleIndicator = null;
      }
      return;
    }

    if (!sprite.angleIndicator) {
      // The arrow's GEOMETRY never changes — only where it points. It is built
      // once, along +x, and thereafter moved and rotated. Transform changes are
      // exactly what PixiJS exempts from the don't-rebuild rule.
      const arrow = new PIXI.Graphics();
      buildArrow(arrow, AIM_ARROW_LENGTH, 3, 0xffff00);
      this.container.addChild(arrow);
      sprite.angleIndicator = arrow;
    }

    // Anchor to the rendered (interpolated) position so the arrow tracks the
    // sprite instead of the raw server position it is smoothing toward.
    const pos = this.motion.getRendered(playerId) ?? { x: player.x, y: player.y };
    sprite.angleIndicator.x = pos.x;
    sprite.angleIndicator.y = pos.y;
    // Firing angles are y-up and Pixi rotation is y-down, so the screen
    // rotation is the negation. Same trap as the tilt sign in worldFiringAngle.
    sprite.angleIndicator.rotation = -this.aimDirection(playerId, player, aimState);
  }

  /**
   * Redraw a health bar, but only when the health it shows has actually
   * changed.
   *
   * Health changes a handful of times a match; the bar was being cleared and
   * re-triangulated 60 times a second regardless. PixiJS names rebuilding
   * unchanged geometry explicitly as the thing not to do.
   */
  private updateHealthBar(sprite: PlayerSprite, health: number): void {
    if (sprite.health === health) return;
    sprite.health = health;

    const bar = sprite.healthBar;
    const fraction = Math.max(0, Math.min(1, health / 100));
    bar.clear();
    bar.rect(
      -HEALTH_BAR_WIDTH / 2,
      -HEALTH_BAR_HEIGHT,
      HEALTH_BAR_WIDTH * fraction,
      HEALTH_BAR_HEIGHT
    );
    bar.fill(fraction > 0.5 ? 0x00ff00 : fraction > 0.25 ? 0xffff00 : 0xff0000);
  }

  /**
   * Update projectile graphics.
   */
  updateProjectiles(gameState: GameState): void {
    const now = performance.now();
    const dtMs = Math.min(100, Math.max(0, now - this.lastProjectileFrameTime));
    this.lastProjectileFrameTime = now;

    // Remove graphics for projectiles that no longer exist
    for (const [projId, graphics] of this.projectileGraphicsMap) {
      if (!gameState.projectiles.has(projId)) {
        this.container.removeChild(graphics);
        graphics.destroy();
        this.projectileGraphicsMap.delete(projId);
        this.projectileMotion.remove(projId);
      }
    }

    // Update or create projectile graphics
    for (const [projId, proj] of gameState.projectiles) {
      let graphics = this.projectileGraphicsMap.get(projId);

      if (!graphics) {
        // An unchanging circle that only moves: built once here, and from then
        // on only its position is touched.
        graphics = new PIXI.Graphics();
        graphics.circle(0, 0, 5);
        graphics.fill(0xff0000);
        this.container.addChild(graphics);
        this.projectileGraphicsMap.set(projId, graphics);
      }

      // Same treatment characters get: server positions arrive at the patch
      // rate, not the frame rate, so assigning them straight to the sprite
      // makes a projectile step rather than fly. Always the remote path — a
      // projectile is nobody's local input, so the interpolation delay costs
      // nothing and buys a sample on each side.
      const pos = this.projectileMotion.update(projId, proj.x, proj.y, false, dtMs, now);
      graphics.x = pos.x;
      graphics.y = pos.y;
    }
  }

  /**
   * The world direction a character's shot will leave in, in the y-up frame.
   *
   * ONE path for both aim visuals, through the same shared transform the
   * server fires with, so the line, the arrow and the projectile cannot
   * disagree. The local player's own aim comes from local input rather than
   * from synchronized state — the clamp is now shared, so it reaches the same
   * answer a round-trip earlier.
   */
  private aimDirection(playerId: string, player: PlayerView, aimState?: AimState): number {
    const isLocal = playerId === this.localPlayerId;
    const aimAngle =
      isLocal && aimState ? degToRad(aimState.angleDeg) : player.aimAngle;
    return worldFiringAngle({ tilt: player.tilt, aimAngle, facing: player.facing || 1 });
  }

  /**
   * Render the aim line.
   *
   * Drawn throughout aiming, not only while the shot is charging. ADR 0003
   * records that the aim line is the sole world-frame feedback in the game —
   * the HUD number is chassis-relative and cannot substitute — so hiding it
   * during the aiming phase leaves the player blind for exactly the part of
   * the flow where they are choosing a direction.
   */
  renderAimLine(myPlayer: PlayerView | null, aimState: AimState): void {
    if (myPlayer && this.localPlayerId) {
      // Reused, not reallocated. The line is now drawn on every frame of
      // aiming rather than only while charging, so allocating a fresh
      // Graphics per frame here would leak in earnest. #22 does the same for
      // the rest of this class.
      if (!this.aimLine) {
        this.aimLine = new PIXI.Graphics();
        this.container.addChild(this.aimLine);
      }
      this.aimLine.clear();

      const aimLength = 100;
      const worldAngle = this.aimDirection(this.localPlayerId, myPlayer, aimState);

      // Anchor to the rendered position so the line starts on the sprite.
      const origin =
        (this.localPlayerId ? this.motion.getRendered(this.localPlayerId) : null) ??
        { x: myPlayer.x, y: myPlayer.y };

      // Full aim line (white)
      const endX = origin.x + Math.cos(worldAngle) * aimLength;
      const endY = origin.y - Math.sin(worldAngle) * aimLength;
      this.aimLine.moveTo(origin.x, origin.y);
      this.aimLine.lineTo(endX, endY);
      this.aimLine.stroke({ width: 3, color: 0xffffff });

      // Power line (green, shorter)
      const powerPercent = (aimState.power / 100) * aimLength;
      const powerEndX = origin.x + Math.cos(worldAngle) * powerPercent;
      const powerEndY = origin.y - Math.sin(worldAngle) * powerPercent;
      this.aimLine.moveTo(origin.x, origin.y);
      this.aimLine.lineTo(powerEndX, powerEndY);
      this.aimLine.stroke({ width: 5, color: 0x00ff00 });
    } else if (this.aimLine) {
      this.container.removeChild(this.aimLine);
      this.aimLine.destroy();
      this.aimLine = null;
    }
  }

  /**
   * Render explosion animation.
   */
  renderExplosion(collision: { type: string; x: number; y: number; time: number } | null): void {
    if (!collision) return;

    const progress = Math.min(1, (Date.now() - collision.time) / this.explosionDuration);

    if (progress >= 1) {
      if (this.explosionGraphics) this.explosionGraphics.visible = false;
      return;
    }

    // One persistent object, drawn at full size once and animated purely by
    // transform. Previously a fresh Graphics was allocated every frame and the
    // previous one merely detached — and detaching does not release GPU
    // geometry, so a single charged shot orphaned around 150 of them.
    if (!this.explosionGraphics) {
      this.explosionGraphics = new PIXI.Graphics();
      this.explosionGraphics.circle(0, 0, EXPLOSION_MAX_RADIUS);
      this.explosionGraphics.fill(0xff8800);
      this.container.addChild(this.explosionGraphics);
    }

    this.explosionGraphics.visible = true;
    this.explosionGraphics.x = collision.x;
    this.explosionGraphics.y = collision.y;
    this.explosionGraphics.scale.set(progress);
    this.explosionGraphics.alpha = 1 - progress;
  }

  /**
   * Spawn a death explosion at the position where a player was destroyed.
   *
   * Placeholder art: an expanding orange fireball with a white-hot core, a
   * shockwave ring and a handful of debris shards flying outwards.
   */
  spawnDeathExplosion(x: number, y: number): void {
    const graphics = new PIXI.Graphics();
    this.container.addChild(graphics);

    const shards = Array.from({ length: 10 }, (_, i) => {
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      return { angle, speed: 60 + Math.random() * 70, size: 2 + Math.random() * 3 };
    });

    this.deathExplosions.push({
      graphics,
      x,
      y,
      start: Date.now(),
      duration: 900,
      shards,
    });
  }

  /**
   * Advance every active death explosion, removing the ones that finished.
   */
  updateDeathExplosions(): void {
    const now = Date.now();

    this.deathExplosions = this.deathExplosions.filter((explosion) => {
      const progress = (now - explosion.start) / explosion.duration;

      if (progress >= 1) {
        this.container.removeChild(explosion.graphics);
        explosion.graphics.destroy();
        return false;
      }

      const g = explosion.graphics;
      g.clear();
      g.x = explosion.x;
      g.y = explosion.y;

      // Shockwave ring
      const ringRadius = 20 + progress * 70;
      g.circle(0, 0, ringRadius);
      g.stroke({ width: 3 * (1 - progress), color: 0xffdd88, alpha: 1 - progress });

      // Fireball
      const fireRadius = 45 * Math.sin(Math.min(1, progress * 1.6) * (Math.PI / 2));
      g.circle(0, 0, fireRadius);
      g.fill({ color: 0xff6622, alpha: 0.85 * (1 - progress) });

      // White-hot core (fades out first)
      if (progress < 0.45) {
        const coreAlpha = 1 - progress / 0.45;
        g.circle(0, 0, fireRadius * 0.5);
        g.fill({ color: 0xffee99, alpha: coreAlpha });
      }

      // Debris shards
      for (const shard of explosion.shards) {
        const distance = shard.speed * progress;
        const sx = Math.cos(shard.angle) * distance;
        const sy = Math.sin(shard.angle) * distance + 60 * progress * progress;
        g.circle(sx, sy, shard.size);
        g.fill({ color: 0x552211, alpha: 1 - progress });
      }

      return true;
    });
  }
}
