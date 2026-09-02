import { Room, Client } from 'colyseus';
import { Schema, type, MapSchema } from '@colyseus/schema';
import {
  POWER_SCALE, GRAVITY, WIND_INTEGRATION, TerrainOp, MAP_WIDTH, MAP_HEIGHT,
  DEFAULT_CRATER_RADIUS, applyOpToBitmap, collapseLips, PLAYER_HEIGHT,
  MOVE_BUDGET, WALK_SPEED, TURN_TIME_MS, TERMINAL_VELOCITY,
  walkStep, settle, testCollisionY, pushOutOfWall, airborneHorizontal, Body,
} from '@browserbond/shared';
import { PhysicsAdapter, Wind } from '@browserbond/shared/src/adapters/PhysicsAdapter';
import { MessageValidationAdapter } from '@browserbond/shared/src/adapters/MessageValidationAdapter';
import { WindManager } from '../adapters/WindManager';
import { loadMap, loadRandomMap, LoadedMap } from '../adapters/MapLoader';
import {
  getWeapon,
  generateProjectileSpecs,
  splashDamage,
  splashRange,
  knockbackImpulse,
} from '@browserbond/shared/src/adapters/WeaponConfigAdapter';


class Player extends Schema {
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
}

class Projectile extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('string') firedBy = '';
}

class GameState extends Schema {
  @type('string') currentPlayerId = '';
  @type('number') windSpeed = 5;
  @type('number') windDirection = 0;
  /** Epoch ms at which the current turn passes if nobody fires. */
  @type('number') turnEndsAt = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  projectile: Projectile | null = null;
}

class GameProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  firedBy: string;
  id: string;
  fireFrame: number; // Frame quando o projétil foi disparado
  weaponType: number; // Weapon that fired this projectile

  constructor(x: number, y: number, vx: number, vy: number, firedBy: string, fireFrame: number = 0, weaponType: number = 1) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.firedBy = firedBy;
    this.id = Math.random().toString(36).substring(7);
    this.fireFrame = fireFrame;
    this.weaponType = weaponType;
  }
}

/**
 * Fractional pixels of walk carried between frames. At WALK_SPEED 120 px/s and
 * a 16 ms tick that is 1.92 px per frame; rounding each frame independently
 * would quietly walk at 125 px/s instead.
 */
const WALK_PX_PER_MS = WALK_SPEED / 1000;

/** Fixed simulation tick, matching setSimulationInterval below. */
const SIMULATION_INTERVAL_MS = 16;

export class GameRoom extends Room<GameState> {
  maxClients = 2;
  private terrainBitmap: Uint8Array = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  private terrainOps: TerrainOp[] = [];
  private playerInputs: Map<string, { left: boolean; right: boolean; jump: boolean }> = new Map();
  private clientLastActivity: Map<string, number> = new Map();
  private projectiles: GameProjectile[] = [];
  private pendingProjectiles: GameProjectile[] = [];
  private currentFrame: number = 0;
  private physics!: PhysicsAdapter;
  private windManager!: WindManager;
  private validator!: MessageValidationAdapter;
  private roundsCompleted: number = 0;
  private currentWindDuration: number = 0;
  private lastPlayerId: string = '';
  /** Sub-pixel walk remainder per player; see WALK_PX_PER_MS. */
  private walkCarry: Map<string, number> = new Map();
  /** Players already told they are against a wall, to debounce the cue. */
  private blockedNotified: Set<string> = new Set();
  /** Fractional vx accumulation for airborne horizontal stepping. */
  private airborneVxCarry: Map<string, number> = new Map();
  private map!: LoadedMap;

  constructor(options: any) {
    super(options);
    this.initializeTerrainPlatform();
  }

  /**
   * Seed the terrain mask from a map PNG (ADR 0002).
   *
   * The base terrain is NOT an op — the client rasterises the same PNG as its
   * texture. `terrainOps` stays empty here and accumulates destruction only, so
   * a late joiner replays craters on top of the map it loads by `mapId`.
   */
  private initializeTerrainPlatform() {
    // BROWSERBOUND_MAP pins a map for playtesting (e.g. `chasm` to exercise the
    // pit). Unset means a random map per room.
    const forced = process.env.BROWSERBOUND_MAP;
    this.map = forced ? loadMap(forced) : loadRandomMap();
    this.terrainBitmap = this.map.mask;
  }

  onCreate() {
    this.setState(new GameState());

    // Initialize adapters
    this.physics = new PhysicsAdapter({
      gravity: GRAVITY,
      windIntegration: WIND_INTEGRATION,
    });
    this.validator = new MessageValidationAdapter();
    this.windManager = new WindManager({
      durationMin: 5,
      durationMax: 10,
      magnitudeMin: 0.1,
      magnitudeMax: 0.5,
    });
    // Initialize wind duration (in rounds, not frames)
    const wind = this.windManager.getCurrentWind();
    this.currentWindDuration = wind.framesRemaining;
    this.roundsCompleted = 0;

    // Set initial wind state
    this.state.windSpeed = wind.magnitude * 100;
    this.state.windDirection = wind.angle;

    // Physics loop - update every 16ms
    this.setSimulationInterval(() => this.updatePhysics(), 16);

    this.onMessage('move', (client, data: { left: boolean; right: boolean; jump: boolean }) => {
      const validation = this.validator.validateMoveMessage(data, this.buildValidationGameState(), client.sessionId);
      if (!validation.valid) {
        console.warn(`[Move] ${validation.reason} from ${client.sessionId}`);
        return;
      }
      this.playerInputs.set(client.sessionId, data);
      this.clientLastActivity.set(client.sessionId, Date.now());
    });

    this.onMessage('aimAngle', (client, data: { angle: number }) => {
      // Don't broadcast aim angle to other players - it's exclusive to each player's UI
    });

    this.onMessage('fire', (client, data: any) => {
      this.clientLastActivity.set(client.sessionId, Date.now());
      const validation = this.validator.validateFireMessage(data, this.buildValidationGameState(), client.sessionId);
      if (!validation.valid) {
        console.warn(`[Fire] ${validation.reason} from ${client.sessionId}`);
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const weaponType = data.weaponType || 1;
      const weapon = getWeapon(weaponType);
      const projectileSpecs = generateProjectileSpecs(weaponType, data.angle);
      const speed = data.power * POWER_SCALE;

      // Firing ends movement and forfeits the remaining budget. The turn
      // itself passes once the projectiles resolve.
      player.movementBudget = 0;
      this.blockedNotified.delete(client.sessionId);

      const projIds: string[] = [];
      const allAngles: number[] = [];

      for (const spec of projectileSpecs) {
        const vel = this.physics.createProjectile(spec.angle, data.power);
        const proj = new GameProjectile(
          player.x,
          player.y,
          vel.vx,
          vel.vy,
          client.sessionId,
          this.currentFrame + spec.fireFrame,
          weaponType
        );

        allAngles.push(spec.angle);
        projIds.push(proj.id);

        // If fireFrame is 0, add to active projectiles; otherwise add to pending
        if (spec.fireFrame === 0) {
          this.projectiles.push(proj);
        } else {
          this.pendingProjectiles.push(proj);
        }
      }

      this.broadcast('projectile', {
        startX: player.x,
        startY: player.y,
        projectileIds: projIds,
        angles: allAngles,
        power: data.power,
        weaponType,
        windSpeed: this.state.windSpeed,
        windDirection: this.state.windDirection,
      });
    });
  }

  private isSolidAt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= MAP_WIDTH || iy < 0 || iy >= MAP_HEIGHT) return false;
    return this.terrainBitmap[iy * MAP_WIDTH + ix] === 1;
  }

  private updatePhysics() {
    this.currentFrame++;

    // Remove inactive clients (disconnected but not yet cleaned up)
    const now = Date.now();
    for (const [clientId] of this.clientLastActivity) {
      if (now - this.clientLastActivity.get(clientId)! > 30000) { // 30 seconds
        this.clientLastActivity.delete(clientId);
        if (this.state.players.has(clientId)) {
          this.state.players.delete(clientId);
          if (this.state.currentPlayerId === clientId) {
            const playerIds = Array.from(this.state.players.keys());
            if (playerIds[0]) {
              this.beginTurn(playerIds[0]);
            } else {
              this.state.currentPlayerId = '';
              this.state.turnEndsAt = 0;
            }
          }
        }
      }
    }

    // Verificar se há projéteis pendentes que devem ser ativados
    this.pendingProjectiles = this.pendingProjectiles.filter((proj) => {
      if (proj.fireFrame <= this.currentFrame) {
        this.projectiles.push(proj);
        return false; // Remove da fila pendente
      }
      return true; // Mantém na fila
    });

    // Get current wind (changes only at end of rounds, not every frame)
    const wind: Wind = this.windManager.getCurrentWind();

    // Update wind state - Colyseus detects changes automatically
    this.state.windSpeed = wind.magnitude * 100;
    this.state.windDirection = wind.angle;

    // Update projectiles using PhysicsAdapter
    this.physics.updateAllProjectiles(this.projectiles, wind);

    // Check collisions
    const projectilesToRemove: string[] = [];

    for (const proj of this.projectiles) {
      const prevX = proj.x - proj.vx;
      const prevY = proj.y - proj.vy;

      // Enviar posição do projétil para os clientes
      this.broadcast('projectileUpdate', {
        projectileId: proj.id,
        x: proj.x,
        y: proj.y,
      });

      let collision = null;

      // Ray-march entre posição anterior e nova
      const dx = proj.x - prevX;
      const dy = proj.y - prevY;
      const dist = Math.hypot(dx, dy);
      const steps = Math.min(200, Math.max(1, Math.ceil(dist)));

      for (let s = 1; s <= steps && !collision; s++) {
        const t = s / steps;
        const sx = prevX + dx * t;
        const sy = prevY + dy * t;

        if (this.isSolidAt(sx, sy)) {
          collision = { type: 'terrain' as const, x: sx, y: sy };
          break;
        }

        for (const [playerId, player] of this.state.players) {
          if (playerId === proj.firedBy) continue;
          if (Math.hypot(sx - player.x, sy - player.y) < 20) {
            collision = { type: 'player' as const, playerId, x: sx, y: sy };
            break;
          }
        }
      }

      // Out of bounds
      if (!collision && (proj.y < -50 || proj.y > MAP_HEIGHT + 50 || proj.x < -50 || proj.x > MAP_WIDTH + 50)) {
        collision = { type: 'miss' as const, x: proj.x, y: proj.y };
      }

      if (collision) {
        const weapon = getWeapon(proj.weaponType);
        const range = splashRange(weapon.splashRadius);
        const affectedPlayers: string[] = [];

        // On any collision, damage and knockback all characters within splash range
        for (const [playerId, player] of this.state.players) {
          // Skip the firer
          if (playerId === proj.firedBy) continue;

          const dx = player.x - collision.x;
          const dy = player.y - collision.y;
          const dist = Math.hypot(dx, dy);

          if (dist > range) continue; // Outside splash range

          // Calculate damage and apply it
          const dmg = splashDamage(dist, weapon.splashRadius, weapon.maxDamage);
          if (dmg <= 0) continue;

          player.health -= dmg;
          affectedPlayers.push(playerId);

          // Apply knockback
          const kb = knockbackImpulse(dx, dy, dmg, weapon.knockbackScale);
          if (kb.ix !== 0 || kb.iy !== 0) {
            player.vx += kb.ix;
            player.vy += kb.iy;
            player.airborne = true;
            this.airborneVxCarry.delete(playerId);
          }

          if (player.health <= 0) {
            this.killPlayer(playerId, 'destroyed');
          }
        }

        // Broadcast collision details
        if (collision.type === 'player') {
          this.broadcast('collision', {
            type: 'player',
            projectileId: proj.id,
            targetId: collision.playerId,
            x: collision.x,
            y: collision.y,
            affectedPlayers: affectedPlayers.map(id => {
              const p = this.state.players.get(id);
              return { playerId: id, health: p?.health ?? 0 };
            }),
          });
        } else if (collision.type === 'terrain') {
          this.destroyTerrain(collision.x, collision.y, weapon.craterRadius);

          this.broadcast('collision', {
            type: 'terrain',
            projectileId: proj.id,
            x: collision.x,
            y: collision.y,
            affectedPlayers: affectedPlayers.map(id => {
              const p = this.state.players.get(id);
              return { playerId: id, health: p?.health ?? 0 };
            }),
          });
        } else if (collision.type === 'miss') {
          this.broadcast('collision', {
            type: 'miss',
            projectileId: proj.id,
            x: collision.x,
            y: collision.y,
            affectedPlayers: affectedPlayers.map(id => {
              const p = this.state.players.get(id);
              return { playerId: id, health: p?.health ?? 0 };
            }),
          });
        }

        projectilesToRemove.push(proj.id);
      }
    }

    // Remove projectiles that collided
    this.projectiles = this.projectiles.filter(p => !projectilesToRemove.includes(p.id));

    // If all projectiles are gone, change turn
    if (this.projectiles.length === 0 && projectilesToRemove.length > 0) {
      this.advanceTurn();
    }

    // Turn timer: a player who never fires must not stall the game. Separate
    // from the inactivity sweep above, which DELETES a player — a timed-out
    // turn just passes.
    if (
      this.state.currentPlayerId &&
      this.projectiles.length === 0 &&
      this.pendingProjectiles.length === 0 &&
      this.state.turnEndsAt > 0 &&
      Date.now() > this.state.turnEndsAt
    ) {
      this.broadcast('turnTimeout', { playerId: this.state.currentPlayerId });
      this.advanceTurn();
    }

    // Update players
    const deadPlayers: string[] = [];

    for (const [playerId, player] of this.state.players) {
      const body: Body = { x: player.x, y: player.y };

      // Terrain can be drawn over a body (a rect op); eject it before anything
      // else reads its position. Bails rather than teleporting if truly wedged.
      pushOutOfWall(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body);

      const grounded = testCollisionY(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body, 1);

      if (!grounded) {
        // Airborne. Ground destroyed under the feet lands here on the next
        // frame with no special case.
        player.airborne = true;

        // Apply gravity and clamp both velocity axes to TERMINAL_VELOCITY.
        player.vy = Math.min(player.vy + GRAVITY, TERMINAL_VELOCITY);
        player.vx = Math.max(-TERMINAL_VELOCITY, Math.min(player.vx, TERMINAL_VELOCITY));

        // Horizontal movement: try lifting when blocked, bounce if all lifts fail.
        // For each pixel of movement, call airborneHorizontal which applies damping
        // on successful climbs or bounces on wall contact.
        const vxPixels = Math.floor(Math.abs(player.vx));
        for (let i = 0; i < vxPixels; i++) {
          player.vx = airborneHorizontal(
            this.terrainBitmap,
            MAP_WIDTH,
            MAP_HEIGHT,
            body,
            player.vx
          );
        }

        // Descend one pixel at a time so a fast fall cannot tunnel through thin ground.
        let remaining = player.vy;
        while (remaining > 0) {
          const stepPx = Math.min(1, remaining);
          body.y += stepPx;
          remaining -= stepPx;
          if (testCollisionY(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body, 1)) {
            settle(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body);
            player.vy = 0;
            player.vx = 0;
            player.airborne = false;
            // Facing sign is deliberately preserved: a character must not
            // silently turn around because it landed.
            this.airborneVxCarry.delete(playerId);
            break;
          }
        }
      } else {
        player.vy = 0;
        player.airborne = false;

        const input = this.playerInputs.get(playerId);
        const isCurrent = playerId === this.state.currentPlayerId;
        const dir = input?.left ? -1 : input?.right ? 1 : 0;

        // Turning is FREE and is never gated on the Movement Budget. Spending
        // your last step walking away from an opponent must not leave you
        // unable to turn round and shoot them — facing is an aiming concern,
        // not a movement one.
        if (isCurrent && dir !== 0) {
          player.facing = dir;
        }

        if (isCurrent && dir !== 0 && player.movementBudget > 0) {
          const carried = this.walkCarry.get(playerId) ?? 0;
          const wanted = carried + WALK_PX_PER_MS * SIMULATION_INTERVAL_MS;
          let pixels = Math.floor(wanted);
          this.walkCarry.set(playerId, wanted - pixels);

          pixels = Math.min(pixels, player.movementBudget);

          let blocked = false;
          for (let i = 0; i < pixels; i++) {
            const result = walkStep(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body, dir);
            if (result === 'moved') {
              // Budget is spent per pixel ADVANCED. Climbing and descending are
              // free, and a blocked move costs nothing.
              player.movementBudget -= 1;
            } else if (result === 'blocked') {
              blocked = true;
              break;
            } else {
              // 'fell' — walkStep has already undone the drop; velocity and
              // airborne state are the integrator's business, not its own.
              player.vy = 0;
              player.airborne = true;
              break;
            }
          }

          if (blocked) {
            // Once per blocked run, not once per frame: a player holding a
            // direction against a wall would otherwise flood the channel.
            if (!this.blockedNotified.has(playerId)) {
              this.blockedNotified.add(playerId);
              this.broadcast('unableToMove', { playerId, x: body.x, y: body.y });
            }
          } else {
            this.blockedNotified.delete(playerId);
          }
        } else {
          this.walkCarry.set(playerId, 0);
          if (dir === 0) this.blockedNotified.delete(playerId);
        }
      }

      player.x = body.x;
      player.y = body.y;

      // Kill Boundary — the only lethal consequence of falling. Characters
      // take no damage from impact however far they fall.
      if (player.y > MAP_HEIGHT + 50 || player.x < -50 || player.x > MAP_WIDTH + 50 || player.y < -50) {
        deadPlayers.push(playerId);
      }
    }

    // Remove dead players
    for (const playerId of deadPlayers) {
      this.killPlayer(playerId, 'outOfBounds');
    }
  }

  /**
   * Start `playerId`'s turn: refill the Movement Budget and arm the turn timer.
   */
  private beginTurn(playerId: string) {
    this.state.currentPlayerId = playerId;
    const player = this.state.players.get(playerId);
    if (player) player.movementBudget = MOVE_BUDGET;
    this.state.turnEndsAt = Date.now() + TURN_TIME_MS;
    this.walkCarry.set(playerId, 0);
    this.blockedNotified.delete(playerId);
  }

  /**
   * Pass the turn to the next surviving player, advancing the round (and the
   * wind) when it wraps back to the first.
   */
  private advanceTurn() {
    const playerIds = Array.from(this.state.players.keys());
    if (playerIds.length === 0) {
      this.state.currentPlayerId = '';
      this.state.turnEndsAt = 0;
      return;
    }

    const currentIndex = playerIds.indexOf(this.state.currentPlayerId);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    this.beginTurn(playerIds[nextIndex]);

    if (nextIndex !== 0) return;

    this.roundsCompleted++;
    if (this.roundsCompleted < this.currentWindDuration) return;

    this.windManager.generateNewWind();
    const newWind = this.windManager.getCurrentWind();
    this.currentWindDuration = newWind.framesRemaining;
    this.roundsCompleted = 0;
    this.state.windSpeed = newWind.magnitude * 100;
    this.state.windDirection = newWind.angle;
    this.broadcast('windChanged', {
      windSpeed: this.state.windSpeed,
      windDirection: this.state.windDirection,
    });
  }

  /**
   * Remove a player from the game the instant it dies.
   *
   * Broadcasts `playerDied` (carrying the last known position, so clients can
   * play the death explosion where the player actually was) and then deletes the
   * player from state in the same frame — clients must never keep rendering a
   * corpse while waiting for a timeout.
   */
  private killPlayer(playerId: string, cause: 'destroyed' | 'outOfBounds') {
    const player = this.state.players.get(playerId);
    if (!player) return;

    this.broadcast('playerDied', {
      playerId,
      x: player.x,
      y: player.y,
      cause,
    });

    this.state.players.delete(playerId);
    this.playerInputs.delete(playerId);

    // Any projectile fired by the dead player keeps flying, but the turn must
    // move on to a survivor right away.
    if (this.state.currentPlayerId === playerId) {
      const playerIds = Array.from(this.state.players.keys());
      if (playerIds[0]) this.beginTurn(playerIds[0]);
      else {
        this.state.currentPlayerId = '';
        this.state.turnEndsAt = 0;
      }
    }
  }

  private destroyTerrain(x: number, y: number, radius: number = DEFAULT_CRATER_RADIUS) {
    const op: TerrainOp = { type: 'explosion', x: Math.floor(x), y: Math.floor(y), radius };
    this.terrainOps.push(op);
    applyOpToBitmap(this.terrainBitmap, op, MAP_WIDTH, MAP_HEIGHT);
    this.broadcast('terrainOp', op);

    // A shot landing inside an existing crater carves below the surface and
    // leaves a thin roof over a void too short to stand in — a character under
    // it is wedged, unable to climb or pass. Collapse those; leave real caves.
    const lipOps = collapseLips(
      this.terrainBitmap,
      op.x,
      op.y,
      radius,
      MAP_WIDTH,
      MAP_HEIGHT,
      PLAYER_HEIGHT
    );
    for (const lip of lipOps) {
      this.terrainOps.push(lip);
      applyOpToBitmap(this.terrainBitmap, lip, MAP_WIDTH, MAP_HEIGHT);
      this.broadcast('terrainOp', lip);
    }
  }

  private buildValidationGameState(): {
    currentPlayerId: string;
    players: Map<string, { health: number }>;
    projectiles: Map<string, { x: number; y: number; firedBy: string }>;
  } {
    // Include both active and pending projectiles to prevent double-firing within single frame
    const allProjectiles = [...this.projectiles, ...this.pendingProjectiles];
    const projectilesMap = new Map(
      allProjectiles.map((proj) => [proj.id, { x: proj.x, y: proj.y, firedBy: proj.firedBy }])
    );
    const playersMap = new Map(
      Array.from(this.state.players.entries()).map(([id, player]) => [id, { health: player.health }])
    );
    return {
      currentPlayerId: this.state.currentPlayerId,
      players: playersMap,
      projectiles: projectilesMap,
    };
  }

  onJoin(client: Client) {
    const player = new Player();
    player.id = client.sessionId;
    const spawn = this.map.spawns[this.state.players.size % this.map.spawns.length];
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = 100;

    this.state.players.set(client.sessionId, player);
    this.clientLastActivity.set(client.sessionId, Date.now());

    // Ensure currentPlayerId always points to a valid player, and that whoever
    // holds the turn actually has a budget and a deadline.
    if (this.state.currentPlayerId === '' || !this.state.players.has(this.state.currentPlayerId)) {
      const playerIds = Array.from(this.state.players.keys());
      if (playerIds[0]) this.beginTurn(playerIds[0]);
    }

    // Send current terrain state to the client
    client.send('terrainSync', { mapId: this.map.id, ops: this.terrainOps });
  }

  onLeave(client: Client) {
    this.clientLastActivity.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);
    this.walkCarry.delete(client.sessionId);
    this.blockedNotified.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    if (this.state.players.size === 0) {
      this.state.currentPlayerId = '';
    } else if (!this.state.players.has(this.state.currentPlayerId)) {
      // If current player left, switch to another valid player
      const playerIds = Array.from(this.state.players.keys());
      if (playerIds[0]) this.beginTurn(playerIds[0]);
    }
  }
}
