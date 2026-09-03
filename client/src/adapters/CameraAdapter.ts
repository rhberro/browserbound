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
import { MAP_WIDTH, MAP_HEIGHT, PlayerView } from '@browserbond/shared';
import type { GameState } from '../gameState';

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
  update(gameState: GameState): void {
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
  private getCurrentPlayer(gameState: GameState): PlayerView | null {
    if (!gameState.turnState) return null;
    return gameState.players.get(gameState.turnState.currentPlayerId) || null;
  }

  /**
   * Constrain camera to stay within map boundaries.
   */
  /**
   * The viewport in WORLD units.
   *
   * `app.screen` is the logical size; `app.canvas` is the backing store, which
   * is the logical size multiplied by the renderer resolution. They are equal
   * only while resolution is 1. Reading the canvas therefore worked by
   * coincidence, and would have centred the camera on the wrong point and
   * clamped it to the wrong bounds the moment high-density rendering was
   * switched on — which it now is.
   */
  private viewport(): { width: number; height: number } {
    return {
      width: this.app.screen?.width || 1000,
      height: this.app.screen?.height || 600,
    };
  }

  private constrainToMapBounds(): void {
    const { width, height } = this.viewport();

    this.cameraX = Math.max(width / 2, Math.min(MAP_WIDTH - width / 2, this.cameraX));
    this.cameraY = Math.max(height / 2, Math.min(MAP_HEIGHT - height / 2, this.cameraY));
  }

  /**
   * Apply camera offset to container (move stage so camera focal point is centered).
   */
  private applyToContainer(): void {
    const { width, height } = this.viewport();

    this.container.position.x = width / 2 - this.cameraX;
    this.container.position.y = height / 2 - this.cameraY;
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
