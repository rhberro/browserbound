/**
 * The synchronized room state, defined once for both sides of the wire.
 *
 * This used to live in the server room, with the client keeping a hand-written
 * interface alongside it. Nothing connected the two, so when the server gained
 * chassis tilt, aim angle, velocity, airborne status and Movement Budget, the
 * client's copy gained none of them and the build stayed green — which is how
 * the aim line ended up reading a tilt that never arrived.
 *
 * Server-authoritative still: the client imports these as TYPES only, and
 * never constructs or mutates one. What it gains is a compile error the moment
 * a field it consumes is renamed or removed.
 */

import { Schema, type, MapSchema } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('number') health = 100;
  @type('number') facing = 1; // 1 = direita, -1 = esquerda
  /** Pixels of walking left this turn. Spent per pixel actually advanced. */
  @type('number') movementBudget = 0;
  /** Falling. Walking and airborne motion obey different rules. */
  @type('boolean') airborne = false;
  /**
   * Chassis tilt in radians, in SCREEN space (y grows downward), so ground
   * rising to the right is negative. Zero when airborne. Never combine this
   * with an aim angle by hand — see `worldFiringAngle`.
   */
  @type('number') tilt = 0;
  /** Aim angle in radians, measured RELATIVE TO THE CHASSIS, clamped to [AIM_MIN_DEG, AIM_MAX_DEG]. */
  @type('number') aimAngle = 0;
  /**
   * False while this player's connection is dropped and their reconnection
   * window is still open. Synchronized so the opponent sees a character marked
   * as reconnecting rather than one that is idle for no reason, or one that
   * vanishes and comes back.
   */
  @type('boolean') connected = true;
}

export class RoomState extends Schema {
  @type('string') currentPlayerId = '';
  @type('number') windSpeed = 5;
  @type('number') windDirection = 0;
  /** Epoch ms at which the current turn passes if nobody fires. */
  @type('number') turnEndsAt = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}

/**
 * The client's picture of one character.
 *
 * DERIVED from the schema with `Pick`, deliberately, so that renaming or
 * removing a field the client consumes is a client build failure rather than a
 * silent zero. Add a field here only once something actually reads it — the
 * list doubles as the answer to "what does the client legitimately need?".
 */
export type PlayerView = Pick<
  Player,
  | 'id'
  | 'x'
  | 'y'
  | 'health'
  | 'facing'
  | 'movementBudget'
  | 'airborne'
  | 'tilt'
  | 'aimAngle'
  | 'connected'
>;

/** The client's picture of the room, minus the player map it reads separately. */
export type TurnView = Pick<
  RoomState,
  'currentPlayerId' | 'windSpeed' | 'windDirection' | 'turnEndsAt'
>;
