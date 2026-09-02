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
import { MAP_WIDTH, MAP_HEIGHT, TerrainOp } from '@browserbond/shared';
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
  private terrainGraphics: PIXI.Graphics;
  private aimLine: PIXI.Graphics | null = null;
  private projectileGraphicsMap: Map<string, PIXI.Graphics> = new Map();
  private explosionGraphics: PIXI.Graphics | null = null;
  private terrainOps: TerrainOp[] = [];
  private explosionDuration: number = 500;
  private deathExplosions: DeathExplosion[] = [];

  constructor(app: PIXI.Application, container: PIXI.Container) {
    this.container = container;

    this.terrainGraphics = new PIXI.Graphics();
    this.container.addChildAt(this.terrainGraphics, 0);
  }

  /**
   * Apply a terrain operation and redraw.
   */
  applyTerrainOp(op: TerrainOp): void {
    this.terrainOps.push(op);
    this.redrawTerrain();
  }

  /**
   * Redraw all terrain from operations.
   */
  private redrawTerrain(): void {
    this.terrainGraphics.clear();

    // Draw rectangles first (platforms)
    for (const op of this.terrainOps) {
      if (op.type === 'rect') {
        this.terrainGraphics.rect(op.x, op.y, op.width, op.height);
        this.terrainGraphics.fill(0x8b7355);
        this.terrainGraphics.stroke({ width: 0 });
      }
    }

    // Draw explosions (sky blue craters)
    for (const op of this.terrainOps) {
      if (op.type === 'explosion') {
        this.terrainGraphics.circle(op.x, op.y, op.radius);
        this.terrainGraphics.fill(0x87ceeb);
        this.terrainGraphics.stroke({ width: 0 });
      }
    }
  }

  /**
   * Update all player sprites and health bars.
   */
  updatePlayers(gameState: any, aimState?: any): void {
    // Remove sprites for players that no longer exist
    for (const [playerId, sprite] of this.playerSprites) {
      if (!gameState.players.has(playerId)) {
        this.container.removeChild(sprite);
        this.playerSprites.delete(playerId);

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

      // Update position
      sprite.x = player.x;
      sprite.y = player.y;

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
  private createPlayerSprite(playerId: string, gameState: any): PIXI.Container {
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
  private updateAngleIndicator(playerId: string, player: any, gameState: any, aimState?: any): void {
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

      this.drawArrow(angleInd, player.x, player.y, radians, 35, 3, 0xffff00);
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
  updateProjectiles(gameState: any): void {
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
  renderAimLine(myPlayer: any, aimState: AimState): void {
    if (aimState.isCharging && myPlayer) {
      if (this.aimLine) {
        this.container.removeChild(this.aimLine);
      }

      this.aimLine = new PIXI.Graphics();
      const aimLength = 100;
      const facing = myPlayer.facing || 1;
      const relativeAngle = facing === 1 ? aimState.angle : 180 - aimState.angle;
      const radians = (relativeAngle * Math.PI) / 180;

      // Full aim line (white)
      const endX = myPlayer.x + Math.cos(radians) * aimLength;
      const endY = myPlayer.y - Math.sin(radians) * aimLength;
      this.aimLine.moveTo(myPlayer.x, myPlayer.y);
      this.aimLine.lineTo(endX, endY);
      this.aimLine.stroke({ width: 3, color: 0xffffff });

      // Power line (green, shorter)
      const powerPercent = (aimState.power / 100) * aimLength;
      const powerEndX = myPlayer.x + Math.cos(radians) * powerPercent;
      const powerEndY = myPlayer.y - Math.sin(radians) * powerPercent;
      this.aimLine.moveTo(myPlayer.x, myPlayer.y);
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
  renderExplosion(collision: any): void {
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

  /**
   * Update UI text display.
   */
  updateUI(gameState: any, aimState: AimState, selectedWeapon: number): void {
    const ui = document.getElementById('ui');
    if (!ui || !gameState.turnState) return;

    const isMyTurn = gameState.isMyTurn();
    let aimDisplay = '';
    let weaponDisplay = '';

    if (isMyTurn) {
      aimDisplay = `
        <div style="color: #0f0; margin-top: 5px;">
          Angle: ${aimState.angle.toFixed(0)}° | Power: ${aimState.power.toFixed(0)}%
        </div>
      `;
      if (aimState.isCharging) {
        aimDisplay += `<div style="color: #ff0;">Charging... Release Space to Fire!</div>`;
      } else {
        aimDisplay += `<div style="color: #0f0;">↑/↓: Adjust Angle | A/D: Move | Space: Fire</div>`;
      }

      weaponDisplay = `
        <div style="margin-top: 10px; display: flex; gap: 10px;">
          <div style="padding: 8px 12px; background: ${selectedWeapon === 1 ? '#ffff00' : '#666'}; border: ${selectedWeapon === 1 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">1: Normal</div>
          <div style="padding: 8px 12px; background: ${selectedWeapon === 2 ? '#ffff00' : '#666'}; border: ${selectedWeapon === 2 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">2: Rajada</div>
          <div style="padding: 8px 12px; background: ${selectedWeapon === 3 ? '#ffff00' : '#666'}; border: ${selectedWeapon === 3 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">3: Shotgun</div>
        </div>
      `;
    }

    const windDegrees = ((gameState.turnState.windDirection * 180) / Math.PI) % 360;
    const windArrow = this.getWindArrow(windDegrees);

    ui.innerHTML = `
      <div style="padding: 10px; background: rgba(0,0,0,0.7); border: 2px solid #0f0; border-radius: 5px;">
        <div style="font-size: 14px; color: #0f0; margin-bottom: 5px;">
          🌪️ Wind: <strong>${(gameState.turnState.windSpeed / 100).toFixed(2)}</strong> | Direction: <strong>${windDegrees.toFixed(0)}°</strong> ${windArrow}
        </div>
        <div>Turn: ${isMyTurn ? 'YOUR TURN' : 'Opponent Turn'}</div>
        ${aimDisplay}
        ${weaponDisplay}
      </div>
    `;
  }

  /**
   * Convert wind direction degrees to emoji arrow.
   */
  private getWindArrow(degrees: number): string {
    if (degrees >= 337.5 || degrees < 22.5) return '➡️';
    if (degrees >= 22.5 && degrees < 67.5) return '↗️';
    if (degrees >= 67.5 && degrees < 112.5) return '⬆️';
    if (degrees >= 112.5 && degrees < 157.5) return '↖️';
    if (degrees >= 157.5 && degrees < 202.5) return '⬅️';
    if (degrees >= 202.5 && degrees < 247.5) return '↙️';
    if (degrees >= 247.5 && degrees < 292.5) return '⬇️';
    if (degrees >= 292.5 && degrees < 337.5) return '↘️';
    return '➡️';
  }
}
