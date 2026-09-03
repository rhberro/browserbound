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
  /**
   * Velocity. Server-only: the client never predicts motion, it interpolates
   * positions, so these were on the wire every patch for nobody.
   */
  vx = 0;
  vy = 0;
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
  /**
   * Aim angle in radians, measured RELATIVE TO THE CHASSIS, clamped to
   * [AIM_MIN_DEG, AIM_MAX_DEG].
   *
   * SYNCHRONIZED AND CONSUMED, deliberately. A comment beside the server's aim
   * handler used to claim aim was "exclusive to each player's UI" while this
   * declaration broadcast it to the whole room — the worst of both, sent to
   * opponents who could read it and ignored by the client that needed it.
   *
   * Settled in favour of broadcasting: the renderer draws the on-character aim
   * arrow for whoever holds the turn, and from the opponent's screen that IS
   * this field. A barrel you can watch swing is information the game should
   * give you; a barrel that moves only on your own screen would make the
   * opponent's character read as inert while they aim.
   */
  @type('number') aimAngle = 0;
  /**
   * False while this player's connection is dropped and their reconnection
   * window is still open. Synchronized so the opponent sees a character marked
   * as reconnecting rather than one that is idle for no reason, or one that
   * vanishes and comes back.
   */
  @type('boolean') connected = true;

  /**
   * Accumulated turn cost. The living player with the LOWEST total acts next
   * (issue #35): firing adds the fired weapon's delay cost, and passing or
   * timing out adds TURN_SKIP_DELAY. A cheap action can therefore buy two turns
   * in a row, and the HUD sorts the field by this number.
   */
  @type('number') delay = 0;
}

/**
 * A projectile in flight.
 *
 * Only position is synchronized. Velocity, the weapon that fired it and the
 * frame bookkeeping are plain fields: the server integrates them, the client
 * has no use for them, and a `@type` on any of them would put them on the wire
 * every patch for nobody.
 *
 * This replaces a per-projectile, per-frame `projectileUpdate` broadcast —
 * around 190 messages a second per room with a three-projectile weapon — while
 * every other moving thing in the game already travelled as state.
 */
export class Projectile extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;

  /** Server-only simulation state. Deliberately not synchronized. */
  vx = 0;
  vy = 0;
  firedBy = '';
  id = '';
  /** Frame this projectile is scheduled to launch on (staggered volleys). */
  fireFrame = 0;
  /** Frame it actually entered the active set; see PROJECTILE_MAX_LIFETIME_FRAMES. */
  activatedFrame = 0;
  weaponType = 1;
}

/**
 * Whether the match is still being played.
 *
 * 'ended' freezes the turn loop, the turn clock and the wind: with one
 * character left there is nobody to pass the turn to, and a lone survivor was
 * previously left playing on their own indefinitely.
 */
export type MatchPhase = 'playing' | 'ended';

export class RoomState extends Schema {
  @type('string') currentPlayerId = '';
  @type('string') matchPhase: MatchPhase = 'playing';
  /**
   * Session id of the winner once the match has ended.
   *
   * Empty string means a DRAW — both characters died in the same exchange —
   * which is why the winner is not simply inferred from whoever is left.
   */
  @type('string') winnerId = '';
  @type('number') windSpeed = 5;
  @type('number') windDirection = 0;
  /**
   * Whole seconds left in the current turn; 0 when no turn is running.
   *
   * A REMAINING DURATION, not a deadline. This was an absolute server
   * timestamp, which requires the client's clock to agree with the server's —
   * it does not, and a countdown computed from a skewed clock is wrong by the
   * skew, permanently. A duration is correct on any clock.
   *
   * Whole seconds rather than milliseconds because the schema only patches a
   * field when its value actually changes: seconds means one patch per second,
   * where milliseconds would mean one every tick for a number nobody reads at
   * that resolution.
   */
  @type('number') turnSecondsRemaining = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  /** Projectiles currently in flight. Empty between shots. */
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
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
  | 'delay'
>;

/** The client's picture of one projectile. */
export type ProjectileView = Pick<Projectile, 'x' | 'y'>;

/** The client's picture of the room, minus the maps it reads separately. */
export type TurnView = Pick<
  RoomState,
  | 'currentPlayerId'
  | 'windSpeed'
  | 'windDirection'
  | 'turnSecondsRemaining'
  | 'matchPhase'
  | 'winnerId'
>;
