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
import { TerrainOp, PlayerView } from '@browserbond/shared';
import type { GameState } from '../gameState';
import { TerrainSurface } from '../rendering/TerrainSurface';
import { PlayerMotion } from '../rendering/PlayerMotion';
import type { AimState } from './InputAdapter';

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
  private playerSprites: Map<string, PIXI.Container> = new Map();
  private angleIndicators: Map<string, PIXI.Graphics> = new Map();
  private terrain: TerrainSurface;
  private motion: PlayerMotion = new PlayerMotion();
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
    for (const [playerId, sprite] of this.playerSprites) {
      if (!gameState.players.has(playerId)) {
        this.container.removeChild(sprite);
        this.playerSprites.delete(playerId);
        this.motion.remove(playerId);

        const angleInd = this.angleIndicators.get(playerId);
        if (angleInd) {
          this.container.removeChild(angleInd);
          this.angleIndicators.delete(playerId);
        }
      }
    }

    // Create or update player sprites
    for (const [playerId, player] of gameState.players) {
      let sprite = this.playerSprites.get(playerId);

      if (!sprite) {
        sprite = this.createPlayerSprite(playerId, gameState);
        this.playerSprites.set(playerId, sprite);
      }

      // Update position: the local player is smoothed with no delay, remote
      // players are interpolated ~2 patches in the past (see PlayerMotion).
      const isLocal = playerId === this.localPlayerId;
      const pos = this.motion.update(playerId, player.x, player.y, isLocal, dtMs, now);
      sprite.x = pos.x;
      sprite.y = pos.y;

      // A character whose player is mid-reconnect must not read as idle. It
      // stays on the field — the server is still holding its turn and budget —
      // but pulses translucent so the opponent can tell the difference between
      // someone thinking and someone whose connection dropped.
      sprite.alpha = player.connected === false ? 0.35 + 0.25 * Math.sin(now / 200) : 1;

      // Update health bar
      const healthBar = sprite.getChildByName('healthBar') as PIXI.Graphics | undefined;
      if (healthBar) {
        const healthPercent = Math.max(0, player.health / 100);
        healthBar.clear();
        healthBar.rect(-25, -30, 50 * healthPercent, 8);
        healthBar.fill(
          healthPercent > 0.5 ? 0x00ff00 : healthPercent > 0.25 ? 0xffff00 : 0xff0000
        );
      }

      // Draw angle indicator for current player
      this.updateAngleIndicator(playerId, player, gameState, aimState);
    }
  }

  /**
   * Create a player sprite with health bar.
   */
  private createPlayerSprite(playerId: string, gameState: GameState): PIXI.Container {
    const container = new PIXI.Container();
    container.name = `player_${playerId}`;

    // Player circle
    const circle = new PIXI.Graphics();
    circle.circle(0, 0, 20);
    circle.fill(playerId === gameState.getRoomSessionId() ? 0xff0000 : 0x0000ff);
    container.addChild(circle);

    // Health bar background
    const healthBg = new PIXI.Graphics();
    healthBg.rect(-25, -30, 50, 8);
    healthBg.fill(0x333333);
    container.addChild(healthBg);

    // Health bar (green)
    const health = new PIXI.Graphics();
    health.rect(-25, -30, 50, 8);
    health.fill(0x00ff00);
    health.name = 'healthBar';
    container.addChild(health);

    this.container.addChild(container);
    return container;
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

    if (isCurrentPlayer) {
      let angleInd = this.angleIndicators.get(playerId);
      if (!angleInd) {
        angleInd = new PIXI.Graphics();
        this.container.addChild(angleInd);
        this.angleIndicators.set(playerId, angleInd);
      }

      angleInd.clear();
      const facing = player.facing || 1;
      const isMyTurn = playerId === gameState.getRoomSessionId();
      const angle = isMyTurn && aimState ? aimState.angle : 45;
      const relativeAngle = facing === 1 ? angle : 180 - angle;
      const radians = (relativeAngle * Math.PI) / 180;

      // Anchor to the rendered (interpolated) position so the arrow tracks the
      // sprite instead of the raw server position it is smoothing toward.
      const pos = this.motion.getRendered(playerId) ?? { x: player.x, y: player.y };
      this.drawArrow(angleInd, pos.x, pos.y, radians, 35, 3, 0xffff00);
    } else {
      const angleInd = this.angleIndicators.get(playerId);
      if (angleInd) {
        this.container.removeChild(angleInd);
        this.angleIndicators.delete(playerId);
      }
    }
  }

  /**
   * Draw an arrow line with arrowhead.
   */
  private drawArrow(
    graphics: PIXI.Graphics,
    x: number,
    y: number,
    radians: number,
    length: number,
    width: number,
    color: number
  ): void {
    const endX = x + Math.cos(radians) * length;
    const endY = y - Math.sin(radians) * length;

    graphics.moveTo(x, y);
    graphics.lineTo(endX, endY);
    graphics.stroke({ width, color });

    // Arrowhead
    const arrowHeadSize = 8;
    const angle1 = radians + (Math.PI * 5) / 6;
    const angle2 = radians - (Math.PI * 5) / 6;
    graphics.moveTo(endX, endY);
    graphics.lineTo(endX + Math.cos(angle1) * arrowHeadSize, endY - Math.sin(angle1) * arrowHeadSize);
    graphics.moveTo(endX, endY);
    graphics.lineTo(endX + Math.cos(angle2) * arrowHeadSize, endY - Math.sin(angle2) * arrowHeadSize);
    graphics.stroke({ width, color });
  }

  /**
   * Update projectile graphics.
   */
  updateProjectiles(gameState: GameState): void {
    // Remove graphics for projectiles that no longer exist
    for (const [projId, graphics] of this.projectileGraphicsMap) {
      if (!gameState.projectiles.has(projId)) {
        this.container.removeChild(graphics);
        this.projectileGraphicsMap.delete(projId);
      }
    }

    // Update or create projectile graphics
    for (const [projId, proj] of gameState.projectiles) {
      let graphics = this.projectileGraphicsMap.get(projId);

      if (!graphics) {
        graphics = new PIXI.Graphics();
        this.container.addChild(graphics);
        this.projectileGraphicsMap.set(projId, graphics);
      }

      graphics.clear();
      graphics.circle(0, 0, 5);
      graphics.fill(0xff0000);
      graphics.x = proj.x;
      graphics.y = proj.y;
    }
  }

  /**
   * Render aim line (while charging).
   */
  renderAimLine(myPlayer: PlayerView | null, aimState: AimState): void {
    if (aimState.isCharging && myPlayer) {
      if (this.aimLine) {
        this.container.removeChild(this.aimLine);
      }

      this.aimLine = new PIXI.Graphics();
      const aimLength = 100;
      const facing = myPlayer.facing || 1;

      // Calculate world angle from chassis tilt + chassis-relative aim
      // aimState.angle is already in radians and chassis-relative
      let worldAngle = (myPlayer.tilt || 0) + aimState.angle;

      // Adjust for facing: left-facing players use π - worldAngle
      if (facing === -1) {
        worldAngle = Math.PI - worldAngle;
      }

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

      this.container.addChild(this.aimLine);
    } else if (this.aimLine) {
      this.container.removeChild(this.aimLine);
      this.aimLine = null;
    }
  }

  /**
   * Render explosion animation.
   */
  renderExplosion(collision: { type: string; x: number; y: number; time: number } | null): void {
    if (collision) {
      const now = Date.now();
      const explosionElapsed = now - collision.time;
      const explosionProgress = Math.min(1, explosionElapsed / this.explosionDuration);

      if (this.explosionGraphics) {
        this.container.removeChild(this.explosionGraphics);
      }

      if (explosionProgress < 1) {
        this.explosionGraphics = new PIXI.Graphics();
        const maxRadius = 40;
        const currentRadius = maxRadius * explosionProgress;
        const alpha = 1 - explosionProgress;

        this.explosionGraphics.circle(0, 0, currentRadius);
        this.explosionGraphics.fill({ color: 0xff8800, alpha });
        this.explosionGraphics.x = collision.x;
        this.explosionGraphics.y = collision.y;
        this.container.addChild(this.explosionGraphics);
      } else {
        if (this.explosionGraphics) {
          this.container.removeChild(this.explosionGraphics);
          this.explosionGraphics = null;
        }
      }
    }
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
