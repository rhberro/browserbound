import { Room, Client } from 'colyseus';
import {
  GRAVITY, WIND_INTEGRATION, TerrainOp, MAP_WIDTH, MAP_HEIGHT,
  DEFAULT_CRATER_RADIUS, applyOpToBitmap, collapseLips, PLAYER_HEIGHT,
  MOVE_BUDGET, WALK_SPEED, TURN_TIME_MS, TERMINAL_VELOCITY,
  PROJECTILE_MAX_LIFETIME_FRAMES, RECONNECT_WINDOW_SECONDS,
  walkStep, settle, testCollisionY, pushOutOfWall, airborneHorizontal, computeTilt, Body,
  pointInBody,
  worldFiringAngle, clampAimDeg, degToRad,
  Player, RoomState, Projectile,
} from '@browserbond/shared';
import { PhysicsAdapter, Wind } from '@browserbond/shared/src/adapters/PhysicsAdapter';
import { MessageValidationAdapter } from '@browserbond/shared/src/adapters/MessageValidationAdapter';
import { WindManager } from '../adapters/WindManager';
import { shouldAdvanceTurn, nothingInFlight } from './turnLoop';
import { loadMap, loadRandomMap, LoadedMap } from '../adapters/MapLoader';
import {
  getWeapon,
  generateProjectileSpecs,
  splashDamage,
  splashRange,
  knockbackImpulse,
} from '@browserbond/shared/src/adapters/WeaponConfigAdapter';


/**
 * Build a projectile. The schema class carries the synchronized position; the
 * rest are plain fields the server integrates and the client never sees.
 */
function makeProjectile(
  x: number,
  y: number,
  vx: number,
  vy: number,
  firedBy: string,
  fireFrame: number,
  weaponType: number
): Projectile {
  const proj = new Projectile();
  proj.x = x;
  proj.y = y;
  proj.vx = vx;
  proj.vy = vy;
  proj.firedBy = firedBy;
  proj.fireFrame = fireFrame;
  proj.weaponType = weaponType;
  proj.id = Math.random().toString(36).substring(7);
  return proj;
}

/**
 * Fractional pixels of walk carried between frames. At WALK_SPEED 120 px/s and
 * a 16 ms tick that is 1.92 px per frame; rounding each frame independently
 * would quietly walk at 125 px/s instead.
 */
const WALK_PX_PER_MS = WALK_SPEED / 1000;

/** Fixed simulation tick, matching setSimulationInterval below. */
const SIMULATION_INTERVAL_MS = 16;

export class GameRoom extends Room<RoomState> {
  maxClients = 2;
  private terrainBitmap: Uint8Array = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  private terrainOps: TerrainOp[] = [];
  private playerInputs: Map<string, { left: boolean; right: boolean; jump: boolean }> = new Map();
  /**
   * Projectiles staged to launch on a later frame (Burst fires at 0, 5, 10).
   * Deliberately NOT in synchronized state: they do not exist in the world yet,
   * and a client that could see them would see the shot before it was fired.
   */
  private pendingProjectiles: Projectile[] = [];
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
  /**
   * Epoch ms at which the current turn passes. Server-side only: clients get a
   * remaining duration instead, because their clocks do not agree with this one.
   */
  private turnEndsAtMs: number = 0;
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
    this.setState(new RoomState());

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
    });

    this.onMessage('aimAngle', (client, data: { angle: number }) => {
      const validation = this.validator.validateAimMessage(data, this.buildValidationGameState(), client.sessionId);
      if (!validation.valid) {
        console.warn(`[Aim] ${validation.reason} from ${client.sessionId}`);
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Clamp chassis-relative aim angle to valid range (in degrees, convert to radians)
      player.aimAngle = degToRad(clampAimDeg(data.angle));
    });

    this.onMessage('fire', (client, data: any) => {
      const validation = this.validator.validateFireMessage(data, this.buildValidationGameState(), client.sessionId);
      if (!validation.valid) {
        console.warn(`[Fire] ${validation.reason} from ${client.sessionId}`);
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const weaponType = data.weaponType || 1;
      const weapon = getWeapon(weaponType);

      // The server owns the firing direction end to end. The client sends no
      // angle at all — it draws its aim line through this same function.
      const worldAngle = worldFiringAngle(player);

      const projectileSpecs = generateProjectileSpecs(weaponType, worldAngle);

      // Firing ends movement and forfeits the remaining budget. The turn
      // itself passes once the projectiles resolve.
      player.movementBudget = 0;
      this.blockedNotified.delete(client.sessionId);

      for (const spec of projectileSpecs) {
        const vel = this.physics.createProjectile(spec.angle, data.power);
        const proj = makeProjectile(
          player.x,
          player.y,
          vel.vx,
          vel.vy,
          client.sessionId,
          this.currentFrame + spec.fireFrame,
          weaponType
        );

        // Immediate shots enter the world now; staged ones wait. Either way
        // the client learns about them from synchronized state, so there is no
        // announcement broadcast — the old one told clients about projectiles
        // that had not been fired yet.
        if (spec.fireFrame === 0) {
          this.activate(proj);
        } else {
          this.pendingProjectiles.push(proj);
        }
      }
    });
  }

  /**
   * Nothing airborne and nothing staged to fire.
   *
   * Shared with shouldAdvanceTurn so the two places that ask "is the shot
   * over?" cannot drift — the staged term is exactly the one that went missing
   * and let Burst fire into the next player's turn.
   */
  private nothingInFlight(): boolean {
    return nothingInFlight({
      active: this.state.projectiles.size,
      pending: this.pendingProjectiles.length,
    });
  }

  /**
   * Publish the turn clock as whole seconds remaining.
   *
   * Ceil, not floor, so the display reads "1" for the whole of the last second
   * and reaches 0 exactly when the turn actually passes, rather than sitting on
   * 0 for a second first.
   */
  private publishTurnClock(): void {
    if (this.turnEndsAtMs <= 0) {
      this.state.turnSecondsRemaining = 0;
      return;
    }
    const msLeft = this.turnEndsAtMs - Date.now();
    this.state.turnSecondsRemaining = Math.max(0, Math.ceil(msLeft / 1000));
  }

  private endTurnClock(): void {
    this.turnEndsAtMs = 0;
    this.state.turnSecondsRemaining = 0;
  }

  /** Put a staged projectile into the world, where clients can see it. */
  private activate(proj: Projectile) {
    proj.activatedFrame = this.currentFrame;
    this.state.projectiles.set(proj.id, proj);
  }

  private isSolidAt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= MAP_WIDTH || iy < 0 || iy >= MAP_HEIGHT) return false;
    return this.terrainBitmap[iy * MAP_WIDTH + ix] === 1;
  }

  private updatePhysics() {
    this.currentFrame++;

    // A player whose connection has dropped still holds the turn, and must not
    // lose it to a clock they cannot see. Push the deadline along by exactly
    // one tick so the turn is frozen, not extended: the moment they reconnect
    // it resumes with the time they had left. onLeave owns actually giving up
    // on them.
    if (this.turnEndsAtMs > 0) {
      const current = this.state.players.get(this.state.currentPlayerId);
      if (current && !current.connected) {
        this.turnEndsAtMs += SIMULATION_INTERVAL_MS;
      }
    }
    this.publishTurnClock();

    // Verificar se há projéteis pendentes que devem ser ativados
    this.pendingProjectiles = this.pendingProjectiles.filter((proj) => {
      if (proj.fireFrame <= this.currentFrame) {
        this.activate(proj);
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
    const active = Array.from(this.state.projectiles.values());
    this.physics.updateAllProjectiles(active, wind);

    // Check collisions
    const projectilesToRemove: string[] = [];
    // Whose turn it was BEFORE any of this frame's deaths. killPlayer hands the
    // turn to a survivor immediately, and without this the advance check below
    // would then fire as well and skip the turn it had just begun — reachable
    // by killing yourself with your own splash.
    const turnOwnerBeforeCollisions = this.state.currentPlayerId;

    for (const proj of active) {
      const prevX = proj.x - proj.vx;
      const prevY = proj.y - proj.vy;

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
          // The simulated body, not a circle at its feet. See pointInBody.
          if (pointInBody(sx, sy, player)) {
            collision = { type: 'player' as const, playerId, x: sx, y: sy };
            break;
          }
        }
      }

      // Out of bounds
      if (!collision && (proj.y < -50 || proj.y > MAP_HEIGHT + 50 || proj.x < -50 || proj.x > MAP_WIDTH + 50)) {
        collision = { type: 'miss' as const, x: proj.x, y: proj.y };
      }

      // Lifetime backstop. A projectile still airborne after this long cannot
      // resolve on its own — every bound above is a comparison, and a NaN
      // position makes all of them false. Retire it as a miss so the turn loop,
      // which waits on an empty projectile list, is never held open forever.
      // Deliberately NOT a terrain-destroying impact: nothing legitimate gets
      // here, so it must not dig a crater at a nonsense position.
      if (!collision && this.currentFrame - proj.activatedFrame >= PROJECTILE_MAX_LIFETIME_FRAMES) {
        console.warn(
          `[Projectile] ${proj.id} expired after ${PROJECTILE_MAX_LIFETIME_FRAMES} frames at (${proj.x}, ${proj.y})`
        );
        // Deliberately NOT a collision broadcast. A collision carries a
        // position, and the position of an expired projectile is exactly the
        // thing that cannot be trusted — in the NaN case that reaches this
        // path, broadcasting it would have the client draw an explosion at
        // NaN. Removing it from state below is the whole signal the client
        // needs: the projectile stops existing, and nothing is drawn.
        projectilesToRemove.push(proj.id);
        continue;
      }

      if (collision) {
        const weapon = getWeapon(proj.weaponType);
        const range = splashRange(weapon.splashRadius);
        const affectedPlayers: string[] = [];
        // killPlayer deletes from this.state.players, which is the collection
        // this loop is walking. Collect the casualties and resolve them after
        // the walk, so a blast that kills two characters cannot skip the
        // second one by mutating the map mid-iteration.
        const killed: string[] = [];

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

          // Clamped: this value is broadcast, and a character killed by a
          // large blast would otherwise be reported at negative health.
          player.health = Math.max(0, player.health - dmg);
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
            killed.push(playerId);
          }
        }

        // Always destroy terrain at impact point, regardless of collision type
        this.destroyTerrain(collision.x, collision.y, weapon.craterRadius);

        // Health is read BEFORE the casualties are resolved below, so a killed
        // character is reported at the health that killed it rather than
        // vanishing from the payload.
        this.broadcast('collision', {
          type: collision.type,
          projectileId: proj.id,
          ...(collision.type === 'player' ? { targetId: collision.playerId } : {}),
          x: collision.x,
          y: collision.y,
          affectedPlayers: affectedPlayers.map((id) => {
            const p = this.state.players.get(id);
            return { playerId: id, health: p?.health ?? 0 };
          }),
        });

        // Safe now that the walk is finished.
        for (const playerId of killed) {
          this.killPlayer(playerId, 'destroyed');
        }

        projectilesToRemove.push(proj.id);
      }
    }

    // Remove projectiles that resolved. Deleting from the map while the loop
    // above walks a snapshot of it is safe precisely because `active` is a
    // snapshot; deleting from the map inside that loop would not be.
    for (const id of projectilesToRemove) {
      this.state.projectiles.delete(id);
    }

    // Pass the turn only once nothing is airborne AND nothing is still staged
    // to fire. See shouldAdvanceTurn for why the staged term matters.
    if (
      this.state.currentPlayerId === turnOwnerBeforeCollisions &&
      shouldAdvanceTurn({
        active: this.state.projectiles.size,
        pending: this.pendingProjectiles.length,
        resolvedThisFrame: projectilesToRemove.length,
      })
    ) {
      this.advanceTurn();
    }

    // Turn timer: a player who never fires must not stall the game. A timed-out
    // turn just passes; it never removes anyone. Losing a character to silence
    // is what the reconnection window in onLeave is for, and only a genuinely
    // dropped connection triggers it.
    if (
      this.state.currentPlayerId &&
      this.nothingInFlight() &&
      this.turnEndsAtMs > 0 &&
      Date.now() > this.turnEndsAtMs
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
        // Accumulate fractional velocity like walkCarry does for walking movement.
        // For each pixel of movement, call airborneHorizontal which applies damping
        // on successful climbs or bounces on wall contact.
        const vxCarry = this.airborneVxCarry.get(playerId) ?? 0;
        const vxTotal = vxCarry + player.vx;
        const vxPixels = Math.floor(Math.abs(vxTotal));

        // Process remaining pixels until exhausted or velocity reverses
        let remaining = vxPixels;
        while (remaining > 0) {
          const oldDir = Math.sign(player.vx) || 0;
          player.vx = airborneHorizontal(
            this.terrainBitmap,
            MAP_WIDTH,
            MAP_HEIGHT,
            body,
            player.vx
          );
          const newDir = Math.sign(player.vx) || 0;

          // If direction reversed (bounced) or velocity became negligible, stop moving
          if (oldDir !== 0 && newDir !== oldDir) break;
          if (Math.abs(player.vx) < 0.01) break;

          remaining--;
        }

        // Store fractional component for next frame
        this.airborneVxCarry.set(playerId, vxTotal - Math.sign(vxTotal) * vxPixels);

        // Descend one pixel at a time so a fast fall cannot tunnel through thin ground.
        let remainingVy = player.vy;
        while (remainingVy > 0) {
          const stepPx = Math.min(1, remainingVy);
          body.y += stepPx;
          remainingVy -= stepPx;
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

      // Calculate chassis tilt based on terrain under the character.
      // Tilt is zero when airborne (chassis is level mid-air).
      if (player.airborne) {
        player.tilt = 0;
      } else {
        player.tilt = computeTilt(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, player.x, player.y);
      }

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
    if (player) {
      player.movementBudget = MOVE_BUDGET;
      // Aim is NOT reset. ADR 0003 makes the chassis-relative measurement the
      // thing that stays put, and zeroing it here put the server at 0 while
      // the client's HUD and aim line still read whatever the player had
      // dialled in — a silent disagreement about where the shot goes.
    }
    this.turnEndsAtMs = Date.now() + TURN_TIME_MS;
    this.publishTurnClock();
    this.walkCarry.set(playerId, 0);
    this.airborneVxCarry.set(playerId, 0);
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
      this.endTurnClock();
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

    // Any projectile fired by the dead player keeps flying, but the turn must
    // move on to a survivor right away.
    this.removePlayer(playerId);
  }

  /**
   * The ONE permanent-departure path: death, a deliberate leave, and a
   * reconnection window that ran out all end here.
   *
   * Every per-player map is released together, in one place, because they were
   * previously released in three places that each forgot a different one.
   * Anything keyed by session id belongs in this method.
   */
  private removePlayer(playerId: string) {
    if (!this.state.players.has(playerId)) return;

    this.state.players.delete(playerId);
    this.playerInputs.delete(playerId);
    this.walkCarry.delete(playerId);
    this.blockedNotified.delete(playerId);
    this.airborneVxCarry.delete(playerId);

    if (this.state.currentPlayerId !== playerId) return;

    const playerIds = Array.from(this.state.players.keys());
    if (playerIds[0]) {
      this.beginTurn(playerIds[0]);
    } else {
      this.state.currentPlayerId = '';
      this.endTurnClock();
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
    const allProjectiles = [...this.state.projectiles.values(), ...this.pendingProjectiles];
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

    // Ensure currentPlayerId always points to a valid player, and that whoever
    // holds the turn actually has a budget and a deadline.
    if (this.state.currentPlayerId === '' || !this.state.players.has(this.state.currentPlayerId)) {
      const playerIds = Array.from(this.state.players.keys());
      if (playerIds[0]) this.beginTurn(playerIds[0]);
    }

    // Send current terrain state to the client
    client.send('terrainSync', { mapId: this.map.id, ops: this.terrainOps });
  }

  /**
   * The only place that decides whether a departure is temporary.
   *
   * Deliberately kept whole rather than spread across the room: the
   * reconnection hooks are restructured in Colyseus 0.18 (#24), and the
   * migration should be a rewire of this method, not a hunt.
   */
  async onLeave(client: Client, consented?: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Whether or not they come back, they are not holding a key right now.
    // Without this a player who disconnects mid-walk keeps walking.
    this.playerInputs.delete(client.sessionId);

    if (consented) {
      // A deliberate leave is a decision, not an accident. Do not make the
      // opponent wait out a window for someone who has already gone.
      this.removePlayer(client.sessionId);
      return;
    }

    player.connected = false;

    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
      // Still in the match, still holding whatever turn and Movement Budget
      // they had: nothing was torn down, so nothing needs restoring.
      const rejoined = this.state.players.get(client.sessionId);
      if (rejoined) rejoined.connected = true;
    } catch {
      // Window expired, or the room was disposed underneath us. removePlayer
      // is idempotent, so a disposal race cannot pass the turn twice.
      this.removePlayer(client.sessionId);
    }
  }
}
