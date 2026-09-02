import * as PIXI from 'pixi.js';
import { GameState } from '../gameState';
import { MAP_WIDTH, MAP_HEIGHT, TerrainOp } from '@browserbond/shared';

export class GameScene {
  private app: PIXI.Application;
  private gameState: GameState;
  private container: PIXI.Container;
  private playerSprites: Map<string, PIXI.Container> = new Map();
  private angleIndicators: Map<string, PIXI.Graphics> = new Map();
  private trajectoryGraphics: PIXI.Graphics | null = null;
  private terrainGraphics: PIXI.Graphics;
  private aimLine: PIXI.Graphics | null = null;
  private projectileGraphics: PIXI.Graphics | null = null;
  private projectileGraphicsMap: Map<string, PIXI.Graphics> = new Map();
  private explosionGraphics: PIXI.Graphics | null = null;
  private explosionDuration: number = 500; // ms para animação de explosão
  private terrainOps: TerrainOp[] = [];

  // Camera
  private cameraX: number = 1000;
  private cameraY: number = 600;
  private cameraTargetX: number = 1000;
  private cameraTargetY: number = 600;
  private cameraSmoothness: number = 0.1;
  private readonly MAP_WIDTH = MAP_WIDTH;
  private readonly MAP_HEIGHT = MAP_HEIGHT;

  // Input state
  private keys: Map<string, boolean> = new Map();
  private isCharging: boolean = false;
  private aimPower: number = 0;
  private aimAngle: number = 45; // 0 = reto, 90 = para cima
  private lastMoveUpdate: number = 0;

  // Weapon system
  private selectedWeapon: number = 1; // 1 = normal, 2 = rajada, 3 = shotgun
  private weaponSelectGraphics: Map<number, PIXI.Graphics> = new Map();

  constructor(app: PIXI.Application, gameState: GameState) {
    console.log('GameScene constructor starting...');
    this.app = app;
    this.gameState = gameState;
    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);
    console.log('Container created, MAP_WIDTH:', MAP_WIDTH, 'MAP_HEIGHT:', MAP_HEIGHT);

    this.terrainGraphics = new PIXI.Graphics();
    this.container.addChildAt(this.terrainGraphics, 0);
    console.log('Terrain graphics created');

    this.gameState.setOnTerrainOp((op) => this.applyTerrainOp(op));

    setTimeout(() => this.setupInput(), 100);
  }

  private applyTerrainOp(op: TerrainOp) {
    console.log('Applying terrain op:', op.type, op);
    this.terrainOps.push(op);
    this.redrawTerrain();
  }

  private redrawTerrain() {
    this.terrainGraphics.clear();

    for (const op of this.terrainOps) {
      if (op.type === 'rect') {
        this.terrainGraphics.rect(op.x, op.y, op.width, op.height);
        this.terrainGraphics.fill(0x8b7355);
        this.terrainGraphics.stroke({ width: 0 });
      }
    }

    for (const op of this.terrainOps) {
      if (op.type === 'explosion') {
        this.terrainGraphics.circle(op.x, op.y, op.radius);
        this.terrainGraphics.fill(0x87ceeb);
        this.terrainGraphics.stroke({ width: 0 });
      }
    }

    console.log('Terrain redrawn with', this.terrainOps.length, 'operations');
  }

  private setupInput() {
    document.addEventListener('keydown', (e) => {
      this.keys.set(e.code, true);

      // Weapon selection
      if (e.code === 'Digit1') {
        this.selectedWeapon = 1;
      } else if (e.code === 'Digit2') {
        this.selectedWeapon = 2;
      } else if (e.code === 'Digit3') {
        this.selectedWeapon = 3;
      }

      if (e.code === 'Space' && this.gameState.isMyTurn()) {
        e.preventDefault();
        if (!this.isCharging) {
          this.isCharging = true;
          this.aimPower = 0;
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);

      if (e.code === 'Space' && this.isCharging) {
        this.fire();
      }
    });
  }

  private getMyPlayer() {
    const myId = this.gameState.getRoomSessionId();
    if (!myId) return null;
    return this.gameState.players.get(myId) || null;
  }

  private getCurrentPlayer() {
    if (!this.gameState.turnState) return null;
    return this.gameState.players.get(this.gameState.turnState.currentPlayerId) || null;
  }

  private updateCamera() {
    // Se houver projéteis, focar neles. Senão, focar no jogador da vez
    if (this.gameState.projectiles.size > 0) {
      // Focar no primeiro projétil (ou calcular média se houver múltiplos)
      const firstProj = this.gameState.projectiles.values().next().value;
      if (firstProj) {
        this.cameraTargetX = firstProj.x;
        this.cameraTargetY = firstProj.y;
      }
    } else {
      const currentPlayer = this.getCurrentPlayer();
      if (currentPlayer) {
        this.cameraTargetX = currentPlayer.x;
        this.cameraTargetY = currentPlayer.y;
      }
    }

    // Smooth camera movement
    this.cameraX += (this.cameraTargetX - this.cameraX) * this.cameraSmoothness;
    this.cameraY += (this.cameraTargetY - this.cameraY) * this.cameraSmoothness;

    // Limitar câmera aos limites do mapa
    const canvasWidth = this.app.canvas?.width || 1000;
    const canvasHeight = this.app.canvas?.height || 600;

    this.cameraX = Math.max(canvasWidth / 2, Math.min(this.MAP_WIDTH - canvasWidth / 2, this.cameraX));
    this.cameraY = Math.max(canvasHeight / 2, Math.min(this.MAP_HEIGHT - canvasHeight / 2, this.cameraY));

    // Apply camera offset to container
    this.container.position.x = canvasWidth / 2 - this.cameraX;
    this.container.position.y = canvasHeight / 2 - this.cameraY;
  }

  private sendMovementToServer() {
    const now = Date.now();
    if (now - this.lastMoveUpdate < 50) return;
    this.lastMoveUpdate = now;

    const left = this.keys.get('ArrowLeft') || this.keys.get('KeyA') || false;
    const right = this.keys.get('ArrowRight') || this.keys.get('KeyD') || false;

    this.gameState.sendMovement({ left, right, jump: false });
  }

  private sendAimAngleToServer() {
    if (this.gameState.isMyTurn()) {
      this.gameState.sendAimAngle(this.aimAngle);
    }
  }

  private fire() {
    if (!this.isCharging || !this.gameState.isMyTurn()) return;

    const myPlayer = this.getMyPlayer();
    const facing = myPlayer ? (myPlayer as any).facing || 1 : 1;
    const relativeAngle = facing === 1 ? this.aimAngle : 180 - this.aimAngle;
    const radians = (relativeAngle * Math.PI) / 180;
    this.gameState.fire(radians, this.aimPower, this.selectedWeapon);
    this.isCharging = false;
    this.aimPower = 0;
  }

  update(deltaMS: number) {
    // Update camera to follow current player
    this.updateCamera();

    if (this.gameState.isMyTurn()) {
      this.sendMovementToServer();

      // Ajustar ângulo sempre durante meu turno
      const upPressed = this.keys.get('ArrowUp') || false;
      const downPressed = this.keys.get('ArrowDown') || false;

      if (upPressed) {
        this.aimAngle = Math.min(90, this.aimAngle + 1.5);
        this.sendAimAngleToServer();
      } else if (downPressed) {
        this.aimAngle = Math.max(0, this.aimAngle - 1.5);
        this.sendAimAngleToServer();
      }

      // Só carregar poder quando Space está pressionado
      if (this.isCharging) {
        this.aimPower = Math.min(100, this.aimPower + (deltaMS / 1000) * 50);
      }
    }

    // Remove sprites for players that no longer exist
    for (const [playerId, sprite] of this.playerSprites) {
      if (!this.gameState.players.has(playerId)) {
        this.container.removeChild(sprite);
        this.playerSprites.delete(playerId);
        const angleInd = this.angleIndicators.get(playerId);
        if (angleInd) {
          this.container.removeChild(angleInd);
          this.angleIndicators.delete(playerId);
        }
      }
    }

    for (const [playerId, player] of this.gameState.players) {
      let sprite = this.playerSprites.get(playerId);

      if (!sprite) {
        const container = new PIXI.Container();
        container.name = `player_${playerId}`;

        const circle = new PIXI.Graphics();
        circle.circle(0, 0, 20);
        circle.fill(playerId === this.gameState.getRoomSessionId() ? 0xff0000 : 0x0000ff);
        container.addChild(circle);

        const healthBg = new PIXI.Graphics();
        healthBg.rect(-25, -30, 50, 8);
        healthBg.fill(0x333333);
        container.addChild(healthBg);

        const health = new PIXI.Graphics();
        health.rect(-25, -30, 50, 8);
        health.fill(0x00ff00);
        health.name = 'healthBar';
        container.addChild(health);

        this.container.addChild(container);
        this.playerSprites.set(playerId, container);
        sprite = container;
      }

      sprite.x = player.x;
      sprite.y = player.y;

      const healthBar = sprite.getChildByName('healthBar') as PIXI.Graphics | undefined;
      if (healthBar) {
        const healthPercent = Math.max(0, player.health / 100);
        healthBar.clear();
        healthBar.rect(-25, -30, 50 * healthPercent, 8);
        healthBar.fill(healthPercent > 0.5 ? 0x00ff00 : healthPercent > 0.25 ? 0xffff00 : 0xff0000);
      }

      // Draw angle indicator arrow para o jogador que está na vez
      if (playerId === this.gameState.turnState?.currentPlayerId) {
        let angleInd = this.angleIndicators.get(playerId);
        if (!angleInd) {
          angleInd = new PIXI.Graphics();
          this.container.addChild(angleInd);
          this.angleIndicators.set(playerId, angleInd);
        }

        angleInd.clear();
        const facing = (player as any).facing || 1;

        // Se for meu turno, usar meu aimAngle. Senão, usar o aimAngle sincronizado do servidor
        const angle = playerId === this.gameState.getRoomSessionId() ? this.aimAngle : this.gameState.currentPlayerAimAngle;
        const relativeAngle = facing === 1 ? angle : 180 - angle;
        const radians = (relativeAngle * Math.PI) / 180;
        const arrowLength = 35;
        const arrowX = player.x + Math.cos(radians) * arrowLength;
        const arrowY = player.y - Math.sin(radians) * arrowLength;

        angleInd.moveTo(player.x, player.y);
        angleInd.lineTo(arrowX, arrowY);
        angleInd.stroke({ width: 3, color: 0xffff00 });

        // Ponta da seta
        const arrowHeadSize = 8;
        const angle1 = radians + (Math.PI * 5) / 6;
        const angle2 = radians - (Math.PI * 5) / 6;
        angleInd.moveTo(arrowX, arrowY);
        angleInd.lineTo(arrowX + Math.cos(angle1) * arrowHeadSize, arrowY - Math.sin(angle1) * arrowHeadSize);
        angleInd.moveTo(arrowX, arrowY);
        angleInd.lineTo(arrowX + Math.cos(angle2) * arrowHeadSize, arrowY - Math.sin(angle2) * arrowHeadSize);
        angleInd.stroke({ width: 3, color: 0xffff00 });
      } else {
        // Remover indicador de ângulo se não estiver na vez
        const angleInd = this.angleIndicators.get(playerId);
        if (angleInd) {
          this.container.removeChild(angleInd);
          this.angleIndicators.delete(playerId);
        }
      }
    }
  }

  render() {
    if (this.isCharging && this.gameState.isMyTurn()) {
      if (this.aimLine) {
        this.container.removeChild(this.aimLine);
      }

      const myPlayer = this.getMyPlayer();
      if (myPlayer) {
        this.aimLine = new PIXI.Graphics();
        const aimLength = 100;
        const facing = (myPlayer as any).facing || 1;
        const relativeAngle = facing === 1 ? this.aimAngle : 180 - this.aimAngle;
        const radians = (relativeAngle * Math.PI) / 180;
        const endX = myPlayer.x + Math.cos(radians) * aimLength;
        const endY = myPlayer.y - Math.sin(radians) * aimLength;
        this.aimLine.moveTo(myPlayer.x, myPlayer.y);
        this.aimLine.lineTo(endX, endY);
        this.aimLine.stroke({ width: 3, color: 0xffffff });

        const powerPercent = (this.aimPower / 100) * aimLength;
        const powerEndX = myPlayer.x + Math.cos(radians) * powerPercent;
        const powerEndY = myPlayer.y - Math.sin(radians) * powerPercent;
        this.aimLine.moveTo(myPlayer.x, myPlayer.y);
        this.aimLine.lineTo(powerEndX, powerEndY);
        this.aimLine.stroke({ width: 5, color: 0x00ff00 });

        this.container.addChild(this.aimLine);
      }
    } else if (this.aimLine) {
      this.container.removeChild(this.aimLine);
      this.aimLine = null;
    }

    // Renderizar projéteis (mesmo durante explosão)
    if (this.gameState.projectiles.size > 0) {
      // Draw multiple projectiles - um gráfico por projétil
      // Remover gráficos de projéteis que não existem mais
      for (const [projId, graphics] of this.projectileGraphicsMap) {
        if (!this.gameState.projectiles.has(projId)) {
          this.container.removeChild(graphics);
          this.projectileGraphicsMap.delete(projId);
        }
      }

      // Renderizar/atualizar cada projétil
      for (const [projId, proj] of this.gameState.projectiles) {
        let graphics = this.projectileGraphicsMap.get(projId);

        if (!graphics) {
          graphics = new PIXI.Graphics();
          this.container.addChild(graphics);
          this.projectileGraphicsMap.set(projId, graphics);
        }

        // Atualizar posição do círculo
        graphics.clear();
        graphics.circle(0, 0, 5);
        graphics.fill(0xff0000);
        graphics.x = proj.x;
        graphics.y = proj.y;
      }
    } else if (this.projectileGraphicsMap.size > 0) {
      // Limpar todos os gráficos de projéteis quando não houver mais nenhum
      for (const [, graphics] of this.projectileGraphicsMap) {
        this.container.removeChild(graphics);
      }
      this.projectileGraphicsMap.clear();
    }

    // Draw explosion animation (agora sobre os projéteis)
    if (this.gameState.collision) {
      const collision = this.gameState.collision;
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

        // Círculo de expansão
        this.explosionGraphics.circle(0, 0, currentRadius);
        this.explosionGraphics.fill({ color: 0xff8800, alpha });
        this.explosionGraphics.x = collision.x;
        this.explosionGraphics.y = collision.y;
        this.container.addChild(this.explosionGraphics);
      } else {
        // Explosão terminou, limpar apenas o estado de colisão
        // Os projéteis continuam sendo renderizados se ainda estiverem no ar
        this.gameState.collision = null;
        if (this.explosionGraphics) {
          this.container.removeChild(this.explosionGraphics);
          this.explosionGraphics = null;
        }
      }
    }

    const ui = document.getElementById('ui');
    if (ui && this.gameState.turnState) {
      const isMyTurn = this.gameState.isMyTurn();
      let aimDisplay = '';
      let weaponDisplay = '';

      if (isMyTurn) {
        aimDisplay = `
          <div style="color: #0f0; margin-top: 5px;">
            Angle: ${this.aimAngle.toFixed(0)}° | Power: ${this.aimPower.toFixed(0)}%
          </div>
        `;
        if (this.isCharging) {
          aimDisplay += `<div style="color: #ff0;">Charging... Release Space to Fire!</div>`;
        } else {
          aimDisplay += `<div style="color: #0f0;">↑/↓: Adjust Angle | A/D: Move | Space: Fire</div>`;
        }

        weaponDisplay = `
          <div style="margin-top: 10px; display: flex; gap: 10px;">
            <div style="padding: 8px 12px; background: ${this.selectedWeapon === 1 ? '#ffff00' : '#666'}; border: ${this.selectedWeapon === 1 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">1: Normal</div>
            <div style="padding: 8px 12px; background: ${this.selectedWeapon === 2 ? '#ffff00' : '#666'}; border: ${this.selectedWeapon === 2 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">2: Rajada</div>
            <div style="padding: 8px 12px; background: ${this.selectedWeapon === 3 ? '#ffff00' : '#666'}; border: ${this.selectedWeapon === 3 ? '2px solid #ffff00' : '1px solid #999'}; cursor: pointer;">3: Shotgun</div>
          </div>
        `;
      }

      // Calculate wind direction in degrees
      const windDegrees = (this.gameState.turnState.windDirection * 180 / Math.PI) % 360;
      const windArrow = this.getWindArrow(windDegrees);

      ui.innerHTML = `
        <div style="padding: 10px; background: rgba(0,0,0,0.7); border: 2px solid #0f0; border-radius: 5px;">
          <div style="font-size: 14px; color: #0f0; margin-bottom: 5px;">
            🌪️ Wind: <strong>${(this.gameState.turnState.windSpeed / 100).toFixed(2)}</strong> | Direction: <strong>${windDegrees.toFixed(0)}°</strong> ${windArrow}
          </div>
          <div>Turn: ${isMyTurn ? 'YOUR TURN' : 'Opponent Turn'}</div>
          ${aimDisplay}
          ${weaponDisplay}
        </div>
      `;
    }
  }

  private getWindArrow(degrees: number): string {
    // Convert degrees to arrow emoji
    if (degrees >= 337.5 || degrees < 22.5) return '➡️'; // Right
    if (degrees >= 22.5 && degrees < 67.5) return '↗️'; // Up-right
    if (degrees >= 67.5 && degrees < 112.5) return '⬆️'; // Up
    if (degrees >= 112.5 && degrees < 157.5) return '↖️'; // Up-left
    if (degrees >= 157.5 && degrees < 202.5) return '⬅️'; // Left
    if (degrees >= 202.5 && degrees < 247.5) return '↙️'; // Down-left
    if (degrees >= 247.5 && degrees < 292.5) return '⬇️'; // Down
    if (degrees >= 292.5 && degrees < 337.5) return '↘️'; // Down-right
    return '➡️';
  }
}
