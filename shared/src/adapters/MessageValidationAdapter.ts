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

/**
 * No angle. The firing direction is derived on the server from the character's
 * chassis tilt, its stored aim angle and its facing (see `worldFiringAngle`);
 * a client-supplied angle was accepted, range-checked and then ignored. Worse,
 * the range check was [0, PI], which would have rejected the twenty degrees
 * below the horizontal that ADR 0003's aim range permits.
 */
interface FireMessage {
  power: number;
  weaponType: number;
}

interface AimMessage {
  angle: number;
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

/**
 * True only for a real, finite JavaScript number.
 *
 * Every range check in this file is a comparison, and a comparison against a
 * non-number is silently false — so `power > 100` waves an object, a string or
 * NaN straight through. Downstream that becomes a NaN velocity, and a NaN
 * projectile can neither collide (its ray-march step count is NaN, so the loop
 * body never runs) nor go out of bounds (every comparison against NaN is
 * false). It stays in the active list forever and the turn never passes.
 *
 * Type before range, on every numeric field that crosses the wire.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Messages arrive as untyped JSON; a non-object payload has no fields to read. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class MessageValidationAdapter {
  private static readonly POWER_MIN = 0;
  private static readonly POWER_MAX = 100;
  private static readonly MAP_MARGIN = 100;
  private static readonly MAX_DELTA_PER_FRAME = 50;

  validateFireMessage(
    message: FireMessage,
    gameState: GameStateForValidation,
    playerId: string
  ): ValidationResult {
    // 0. Payload must be an object with genuinely numeric fields, BEFORE any
    //    range check — see isFiniteNumber.
    if (!isObject(message)) {
      return { valid: false, reason: 'fire message is not an object' };
    }
    if (!isFiniteNumber(message.power)) {
      return { valid: false, reason: 'power must be a finite number' };
    }

    // 1. Player must be in current turn
    if (gameState.currentPlayerId !== playerId) {
      return { valid: false, reason: 'player not in current turn' };
    }

    // 2. No active projectiles from this player
    if (this.playerHasActiveProjectiles(playerId, gameState)) {
      return { valid: false, reason: 'player has active projectiles' };
    }

    // 3. Power bounds: [0, 100]
    if (message.power < MessageValidationAdapter.POWER_MIN || message.power > MessageValidationAdapter.POWER_MAX) {
      return {
        valid: false,
        reason: `power out of bounds [${MessageValidationAdapter.POWER_MIN}, ${MessageValidationAdapter.POWER_MAX}]`,
      };
    }

    // 4. Weapon type must exist
    if (!WEAPONS[message.weaponType]) {
      return { valid: false, reason: `unknown weapon type ${message.weaponType}` };
    }

    return { valid: true };
  }

  /**
   * Aim carries no bounds check on purpose.
   *
   * ADR 0003 makes out-of-range aim a CLAMP, not a rejection: the barrel stops
   * moving and firing is never blocked. What the clamp cannot survive is a
   * non-number, which passes straight through `Math.max`/`Math.min` as NaN and
   * poisons the next legitimate shot. So this validates the type and the turn,
   * and leaves the range to the clamp.
   */
  validateAimMessage(
    message: AimMessage,
    gameState: GameStateForValidation,
    playerId: string
  ): ValidationResult {
    if (!isObject(message)) {
      return { valid: false, reason: 'aim message is not an object' };
    }
    if (!isFiniteNumber(message.angle)) {
      return { valid: false, reason: 'angle must be a finite number' };
    }
    if (!gameState.players.has(playerId)) {
      return { valid: false, reason: 'player not found' };
    }
    if (gameState.currentPlayerId !== playerId) {
      return { valid: false, reason: 'player not in current turn' };
    }
    return { valid: true };
  }

  validateMoveMessage(
    message: MoveMessage,
    gameState: GameStateForValidation,
    playerId: string
  ): ValidationResult {
    if (!isObject(message)) {
      return { valid: false, reason: 'move message is not an object' };
    }

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
    if (!isObject(message) || !isFiniteNumber(message.x) || !isFiniteNumber(message.y)) {
      return { valid: false, reason: 'projectile update position must be finite numbers' };
    }

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
    if (!isObject(message) || !isFiniteNumber(message.x) || !isFiniteNumber(message.y)) {
      return { valid: false, reason: 'collision position must be finite numbers' };
    }

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
