/**
 * MessageValidationAdapter: Validates all network messages for correctness.
 *
 * Owns: validation rules for fire, move, projectileUpdate, collision messages
 * Doesn't own: game logic, message handling, network transport
 */

import { MAP_WIDTH, MAP_HEIGHT } from '../terrain';
import { WEAPONS } from './WeaponConfigAdapter';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

interface FireMessage {
  angle: number;
  power: number;
  weaponType: number;
}

interface MoveMessage {
  left: boolean;
  right: boolean;
  jump: boolean;
}

interface ProjectileUpdateMessage {
  projectileId: string;
  x: number;
  y: number;
}

interface CollisionMessage {
  projectileId: string;
  type: string;
  x: number;
  y: number;
}

interface GameStateForValidation {
  currentPlayerId: string;
  players: Map<string, { health: number }>;
  projectiles: Map<string, { x: number; y: number; firedBy?: string }>;
}

export class MessageValidationAdapter {
  private static readonly ANGLE_MIN = 0;
  private static readonly ANGLE_MAX = Math.PI;
  private static readonly POWER_MIN = 0;
  private static readonly POWER_MAX = 100;
  private static readonly MAP_MARGIN = 100;
  private static readonly MAX_DELTA_PER_FRAME = 50;

  validateFireMessage(
    message: FireMessage,
    gameState: GameStateForValidation,
    playerId: string
  ): ValidationResult {
    // 1. Player must be in current turn
    if (gameState.currentPlayerId !== playerId) {
      return { valid: false, reason: 'player not in current turn' };
    }

    // 2. No active projectiles from this player
    if (this.playerHasActiveProjectiles(playerId, gameState)) {
      return { valid: false, reason: 'player has active projectiles' };
    }

    // 3. Angle bounds: [0, π]
    if (message.angle < MessageValidationAdapter.ANGLE_MIN || message.angle > MessageValidationAdapter.ANGLE_MAX) {
      return {
        valid: false,
        reason: `angle out of bounds [${MessageValidationAdapter.ANGLE_MIN}, ${MessageValidationAdapter.ANGLE_MAX}]`,
      };
    }

    // 4. Power bounds: [0, 100]
    if (message.power < MessageValidationAdapter.POWER_MIN || message.power > MessageValidationAdapter.POWER_MAX) {
      return {
        valid: false,
        reason: `power out of bounds [${MessageValidationAdapter.POWER_MIN}, ${MessageValidationAdapter.POWER_MAX}]`,
      };
    }

    // 5. Weapon type must exist
    if (!WEAPONS[message.weaponType]) {
      return { valid: false, reason: `unknown weapon type ${message.weaponType}` };
    }

    return { valid: true };
  }

  validateMoveMessage(
    message: MoveMessage,
    gameState: GameStateForValidation,
    playerId: string
  ): ValidationResult {
    // 1. Player must exist
    const player = gameState.players.get(playerId);
    if (!player) {
      return { valid: false, reason: 'player not found' };
    }

    // 2. Player must be alive
    if (player.health <= 0) {
      return { valid: false, reason: 'player is dead' };
    }

    // 3. Inputs must be boolean
    if (typeof message.left !== 'boolean') {
      return { valid: false, reason: 'inputs must be boolean' };
    }
    if (typeof message.right !== 'boolean') {
      return { valid: false, reason: 'inputs must be boolean' };
    }
    if (typeof message.jump !== 'boolean') {
      return { valid: false, reason: 'inputs must be boolean' };
    }

    return { valid: true };
  }

  validateProjectileUpdateMessage(
    message: ProjectileUpdateMessage,
    gameState: GameStateForValidation
  ): ValidationResult {
    // 1. Projectile must exist
    const projectile = gameState.projectiles.get(message.projectileId);
    if (!projectile) {
      return { valid: false, reason: `projectile ${message.projectileId} not found` };
    }

    // 2. Position must be within bounds
    const margin = MessageValidationAdapter.MAP_MARGIN;
    if (
      message.x < -margin ||
      message.x > MAP_WIDTH + margin ||
      message.y < -margin ||
      message.y > MAP_HEIGHT + margin
    ) {
      return { valid: false, reason: `position out of bounds (${message.x}, ${message.y})` };
    }

    // 3. Position delta must be reasonable (no teleportation)
    const deltaX = Math.abs(message.x - projectile.x);
    const deltaY = Math.abs(message.y - projectile.y);
    const maxDelta = MessageValidationAdapter.MAX_DELTA_PER_FRAME;
    if (deltaX > maxDelta || deltaY > maxDelta) {
      return { valid: false, reason: `position delta too large (${deltaX}, ${deltaY})` };
    }

    return { valid: true };
  }

  validateCollisionMessage(message: CollisionMessage, gameState: GameStateForValidation): ValidationResult {
    // 1. Projectile must exist
    if (!gameState.projectiles.has(message.projectileId)) {
      return { valid: false, reason: `projectile ${message.projectileId} not found` };
    }

    // 2. Position must be in bounds
    const margin = MessageValidationAdapter.MAP_MARGIN;
    if (
      message.x < -margin ||
      message.x > MAP_WIDTH + margin ||
      message.y < -margin ||
      message.y > MAP_HEIGHT + margin
    ) {
      return { valid: false, reason: 'collision position out of bounds' };
    }

    // 3. Collision type must be known
    const validTypes = ['player', 'terrain', 'miss'];
    if (!validTypes.includes(message.type)) {
      return { valid: false, reason: `unknown collision type ${message.type}` };
    }

    return { valid: true };
  }

  private playerHasActiveProjectiles(playerId: string, gameState: GameStateForValidation): boolean {
    for (const projectile of gameState.projectiles.values()) {
      if (projectile.firedBy === playerId) {
        return true;
      }
    }
    return false;
  }
}
