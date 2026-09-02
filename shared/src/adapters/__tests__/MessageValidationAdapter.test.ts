import { describe, it, expect, beforeEach } from 'vitest';
import { MessageValidationAdapter, ValidationResult } from '../MessageValidationAdapter';
import { MAP_WIDTH, MAP_HEIGHT } from '../../terrain';
import { GRAVITY, POWER_SCALE } from '../../types';

interface MockGameState {
  currentPlayerId: string;
  players: Map<string, { health: number }>;
  projectiles: Map<string, { x: number; y: number; firedBy?: string }>;
}

function createMockGameState(overrides?: Partial<MockGameState>): MockGameState {
  return {
    currentPlayerId: 'player-1',
    players: new Map([
      ['player-1', { health: 100 }],
      ['player-2', { health: 100 }],
    ]),
    projectiles: new Map(),
    ...overrides,
  };
}

describe('MessageValidationAdapter', () => {
  let validator: MessageValidationAdapter;
  let gameState: MockGameState;

  beforeEach(() => {
    validator = new MessageValidationAdapter();
    gameState = createMockGameState();
  });

  describe('validateFireMessage', () => {
    it('accepts valid fire message', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects fire when player not in current turn', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 50, weaponType: 1 },
        gameState,
        'player-2'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not in current turn');
    });

    it('rejects fire with angle < 0', () => {
      const result = validator.validateFireMessage(
        { angle: -0.1, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('angle out of bounds');
    });

    it('rejects fire with angle > π', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI + 0.1, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('angle out of bounds');
    });

    it('accepts fire with angle = 0 (boundary)', () => {
      const result = validator.validateFireMessage(
        { angle: 0, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });

    it('accepts fire with angle = π (boundary)', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });

    it('rejects fire with power < 0', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: -1, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('power out of bounds');
    });

    it('rejects fire with power > 100', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 101, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('power out of bounds');
    });

    it('accepts fire with power = 0 (boundary)', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 0, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });

    it('accepts fire with power = 100 (boundary)', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 100, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });

    it('rejects fire with unknown weapon type', () => {
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 50, weaponType: 999 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('weapon type');
    });

    it('rejects fire when player has active projectiles', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100, firedBy: 'player-1' });
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('active projectiles');
    });

    it('allows fire when other player has projectiles', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100, firedBy: 'player-2' } as any);
      const result = validator.validateFireMessage(
        { angle: Math.PI / 4, power: 50, weaponType: 1 },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateMoveMessage', () => {
    it('accepts valid move message', () => {
      const result = validator.validateMoveMessage(
        { left: true, right: false, jump: false },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(true);
    });

    it('rejects move when player not found', () => {
      const result = validator.validateMoveMessage(
        { left: false, right: false, jump: false },
        gameState,
        'unknown-player'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('rejects move when player is dead', () => {
      gameState.players.set('player-1', { health: 0 });
      const result = validator.validateMoveMessage(
        { left: false, right: false, jump: false },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('dead');
    });

    it('rejects move with non-boolean left', () => {
      const result = validator.validateMoveMessage(
        { left: 'true' as any, right: false, jump: false },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('boolean');
    });

    it('rejects move with non-boolean right', () => {
      const result = validator.validateMoveMessage(
        { left: false, right: 1 as any, jump: false },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('boolean');
    });

    it('rejects move with non-boolean jump', () => {
      const result = validator.validateMoveMessage(
        { left: false, right: false, jump: null as any },
        gameState,
        'player-1'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('boolean');
    });
  });

  describe('validateProjectileUpdateMessage', () => {
    it('accepts valid projectile update', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 105, y: 105 },
        gameState
      );
      expect(result.valid).toBe(true);
    });

    it('rejects update for unknown projectile', () => {
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'unknown', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('rejects position with x < -margin', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: -150, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bounds');
    });

    it('rejects position with x > MAP_WIDTH + margin', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: MAP_WIDTH + 150, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bounds');
    });

    it('rejects position with y < -margin', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 100, y: -150 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bounds');
    });

    it('rejects position with y > MAP_HEIGHT + margin', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 100, y: MAP_HEIGHT + 150 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bounds');
    });

    it('accepts position at bounds edge', () => {
      gameState.projectiles.set('proj-1', { x: -50, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: -100, y: 100 }, // delta = 50, at the boundary
        gameState
      );
      expect(result.valid).toBe(true);
    });

    it('rejects delta > MAX_DELTA_PER_FRAME', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 160, y: 100 }, // delta = 60, MAX = 50
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('delta too large');
    });

    it('rejects delta on y > MAX_DELTA_PER_FRAME', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 100, y: 160 }, // delta = 60, MAX = 50
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('delta too large');
    });

    it('accepts delta = MAX_DELTA_PER_FRAME (boundary)', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateProjectileUpdateMessage(
        { projectileId: 'proj-1', x: 150, y: 100 }, // delta = 50, MAX = 50
        gameState
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCollisionMessage', () => {
    it('accepts valid collision message', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'terrain', x: 150, y: 150 },
        gameState
      );
      expect(result.valid).toBe(true);
    });

    it('rejects collision for unknown projectile', () => {
      const result = validator.validateCollisionMessage(
        { projectileId: 'unknown', type: 'terrain', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('rejects collision with position out of bounds', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'terrain', x: MAP_WIDTH + 200, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bounds');
    });

    it('rejects collision with unknown type', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'unknown', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('type');
    });

    it('accepts collision type "player"', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'player', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(true);
    });

    it('accepts collision type "terrain"', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'terrain', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(true);
    });

    it('accepts collision type "miss"', () => {
      gameState.projectiles.set('proj-1', { x: 100, y: 100 });
      const result = validator.validateCollisionMessage(
        { projectileId: 'proj-1', type: 'miss', x: 100, y: 100 },
        gameState
      );
      expect(result.valid).toBe(true);
    });
  });
});
