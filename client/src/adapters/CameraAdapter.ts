/**
 * CameraAdapter: Handles camera positioning and movement.
 *
 * Manages:
 * - Camera target tracking (players or projectiles)
 * - Smooth camera movement
 * - Map boundary constraints
 * - Camera offset application to stage container
 */

import * as PIXI from 'pixi.js';
import { MAP_WIDTH, MAP_HEIGHT } from '@browserbond/shared';

export class CameraAdapter {
  private cameraX: number = 1000;
  private cameraY: number = 600;
  private cameraTargetX: number = 1000;
  private cameraTargetY: number = 600;
  private cameraSmoothness: number = 0.1;

  constructor(private app: PIXI.Application, private container: PIXI.Container) {}

  /**
   * Update camera position to track projectiles or current player.
   */
  update(gameState: any): void {
    // Focus on projectiles if any are in flight, otherwise focus on current player
    if (gameState.projectiles.size > 0) {
      const firstProj = gameState.projectiles.values().next().value;
      if (firstProj) {
        this.cameraTargetX = firstProj.x;
        this.cameraTargetY = firstProj.y;
      }
    } else {
      const currentPlayer = this.getCurrentPlayer(gameState);
      if (currentPlayer) {
        this.cameraTargetX = currentPlayer.x;
        this.cameraTargetY = currentPlayer.y;
      }
    }

    // Smooth camera movement towards target
    this.cameraX += (this.cameraTargetX - this.cameraX) * this.cameraSmoothness;
    this.cameraY += (this.cameraTargetY - this.cameraY) * this.cameraSmoothness;

    // Constrain camera to map boundaries
    this.constrainToMapBounds();

    // Apply camera offset to container
    this.applyToContainer();
  }

  /**
   * Get the current player (whose turn it is).
   */
  private getCurrentPlayer(gameState: any): any {
    if (!gameState.turnState) return null;
    return gameState.players.get(gameState.turnState.currentPlayerId) || null;
  }

  /**
   * Constrain camera to stay within map boundaries.
   */
  private constrainToMapBounds(): void {
    const canvasWidth = this.app.canvas?.width || 1000;
    const canvasHeight = this.app.canvas?.height || 600;

    this.cameraX = Math.max(canvasWidth / 2, Math.min(MAP_WIDTH - canvasWidth / 2, this.cameraX));
    this.cameraY = Math.max(canvasHeight / 2, Math.min(MAP_HEIGHT - canvasHeight / 2, this.cameraY));
  }

  /**
   * Apply camera offset to container (move stage so camera focal point is centered).
   */
  private applyToContainer(): void {
    const canvasWidth = this.app.canvas?.width || 1000;
    const canvasHeight = this.app.canvas?.height || 600;

    this.container.position.x = canvasWidth / 2 - this.cameraX;
    this.container.position.y = canvasHeight / 2 - this.cameraY;
  }

  /**
   * Get current camera position (for debugging).
   */
  getPosition(): { x: number; y: number } {
    return { x: this.cameraX, y: this.cameraY };
  }

  /**
   * Set camera position directly.
   */
  setPosition(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.cameraTargetX = x;
    this.cameraTargetY = y;
    this.applyToContainer();
  }

  /**
   * Set camera smoothness (0-1, lower = more responsive).
   */
  setSmoothness(value: number): void {
    this.cameraSmoothness = Math.max(0, Math.min(1, value));
  }
}
