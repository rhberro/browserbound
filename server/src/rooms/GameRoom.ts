import { Room, Client } from 'colyseus';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import {
  GRAVITY, WIND_INTEGRATION, TerrainOp, MAP_WIDTH, MAP_HEIGHT,
  DEFAULT_CRATER_RADIUS, applyOpToBitmap, collapseLips, appendOp, PLAYER_HEIGHT,
  MOVE_STEPS, TURN_TIME_MS, TURN_SKIP_DELAY, TERMINAL_VELOCITY, WIND_DRIFT_SCALE, KNOCKBACK_SHOVE_SCALE,
  PROJECTILE_CEILING, PROJECTILE_BOUNDS_MARGIN,
  PROJECTILE_MAX_LIFETIME_FRAMES, RECONNECT_WINDOW_SECONDS,
  walkStep, isSolid, isGrounded, groundDistance, ejectUp, computeTilt, Body,
  pointInBody, distanceToBody,
  worldFiringAngle, clampAimDeg, degToRad,
  Player, RoomState, Projectile, Seat, resolveMode, teamOfSeat,
} from '@browserbond/shared';
import { PhysicsAdapter, Wind } from '@browserbond/shared/src/adapters/PhysicsAdapter';
import { MessageValidationAdapter } from '@browserbond/shared/src/adapters/MessageValidationAdapter';
import { WindManager } from '../adapters/WindManager';
import { fetchDisplayName } from '../adapters/SupabaseAdmin';
import { PlayerLifecycle } from './PlayerLifecycle';
import { shouldAdvanceTurn, nothingInFlight } from './turnLoop';
import { advanceTimer, windupElapsed, fallDelayElapsed, nextFallSpeed } from './gait';
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

/** Fixed simulation tick, matching setSimulationInterval below. */
const SIMULATION_INTERVAL_MS = 16;

interface AuthPayload {
  sub: string;
  userId: string;
  email: string;
}

export class GameRoom extends Room {
  private static jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  private static getJWKS() {
    if (!GameRoom.jwks) {
      const supabaseUrl = process.env.SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('SUPABASE_URL not configured');
      }
      // Supabase provides JWKS endpoint for verifying ES256 tokens
      GameRoom.jwks = createRemoteJWKSet(
        new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      );
    }
    return GameRoom.jwks;
  }

  /**
   * Colyseus 0.18 onAuth: Validates client JWT token before room join.
   *
   * Called with: (client, options, context)
   * - options.auth contains the JWT token from client (Supabase JWT)
   * - Supabase uses ES256 (elliptic curve) signing
   * - Verification uses Supabase's public keys from JWKS endpoint
   */
  async onAuth(client: any, options: any, context: any) {
    try {
      // Extract token from options.auth
      const token = options?.auth;

      if (!token) {
        throw new Error('No authentication token provided');
      }

      // Verify token using Supabase's JWKS endpoint
      // This is the standard OAuth/OIDC way to verify ES256 tokens
      const jwks = GameRoom.getJWKS();
      const verified = await jwtVerify(token, jwks);
      const sub = (verified.payload.sub as string) || '';

      if (!sub) {
        throw new Error('Invalid JWT: missing sub claim');
      }

      // Fetch or create display name from Supabase profiles
      const email = verified.payload.email as string;
      const displayName = await fetchDisplayName(sub, email);

      // Return auth data that becomes client.auth in onJoin
      return {
        userId: sub,
        displayName,
        email,
      };
    } catch (error) {
      console.error('JWT verification failed:', error);
      throw error;
    }
  }
  maxClients = 2;
  /**
   * 0.17 dropped the state generic: the room declares its state as a field and
   * the type is inferred from it, so `setState` in onCreate is redundant.
   */
  state = new RoomState();
  private terrainBitmap: Uint8Array = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  private terrainOps: TerrainOp[] = [];
  /**
   * Every piece of per-session state outside synchronized schema: held
   * input, walk windup, fall delay, wind drift and the blocked-notify
   * debounce flag. See PlayerLifecycle's own doc comment.
   */
  private lifecycle: PlayerLifecycle = new PlayerLifecycle();
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
  private lastPlayerId: string = '';
  /**
   * Epoch ms at which the current turn passes. Server-side only: clients get a
   * remaining duration instead, because their clocks do not agree with this one.
   */
  private turnEndsAtMs: number = 0;
  /**
   * True once the match has had two characters in it at the same time.
   *
   * Without this, "fewer than two characters remain" is true before the second
   * player has ever joined, and every room would end the instant it opened.
   */
  private matchStarted: boolean = false;
  /** A character left the field this frame; re-check the match at frame end. */
  private matchEndDirty: boolean = false;
  private map!: LoadedMap;

  constructor() {
    super();
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

  onCreate(options: any) {
    // Configure room from options
    const mode = options?.mode || 'duel';
    const modeConfig = resolveMode(mode, options?.ffaCount);
    const roomName = options?.roomName || `Game ${Math.random().toString(36).substring(7)}`;

    this.state.roomName = roomName;
    this.state.teamCount = modeConfig.teamCount;
    this.state.teamSize = modeConfig.teamSize;
    this.maxClients = modeConfig.teamCount * modeConfig.teamSize;

    // Set room metadata for the lobby browser to discover
    this.setMetadata({
      roomName,
      mode,
      teamCount: modeConfig.teamCount,
      teamSize: modeConfig.teamSize,
      capacity: this.maxClients,
    });

    // Initialize adapters
    this.physics = new PhysicsAdapter({
      gravity: GRAVITY,
      windIntegration: WIND_INTEGRATION,
    });
    this.validator = new MessageValidationAdapter();
    // Bounds, drift and re-roll cadence all come from the shared wind
    // constants; nothing about the wind is configured at the call site.
    this.windManager = new WindManager();
    this.publishWind();

    // Physics loop - update every 16ms. `setSimulationInterval` in 0.18 is a
    // deprecated alias for this.
    this.setTimestep(() => this.updatePhysics(), SIMULATION_INTERVAL_MS);

    // Lobby phase message handlers
    this.onMessage('claimSeat', (client, data: { seatIndex: number }) => {
      if (this.state.matchPhase !== 'lobby') return;
      const seat = this.state.seats.get(client.sessionId);
      if (!seat || seat.ready) return; // Can't change seat while ready

      const targetSeat = Array.from(this.state.seats.values()).find(s => s.seatIndex === data.seatIndex);
      if (targetSeat && targetSeat.sessionId !== client.sessionId) return; // Seat already taken

      if (seat.seatIndex >= 0) {
        // Release current seat
        const oldSeat = Array.from(this.state.seats.values()).find(s => s.seatIndex === seat.seatIndex && s.sessionId === client.sessionId);
        if (oldSeat) oldSeat.seatIndex = -1;
      }

      seat.seatIndex = data.seatIndex;
    });

    this.onMessage('setReady', (client, data: { ready: boolean }) => {
      if (this.state.matchPhase !== 'lobby') return;
      const seat = this.state.seats.get(client.sessionId);
      if (!seat || seat.seatIndex < 0) return; // Must have a seat to ready up

      seat.ready = data.ready;
    });

    this.onMessage('startGame', (client) => {
      if (this.state.matchPhase !== 'lobby') return;
      if (client.sessionId !== this.state.hostSessionId) return; // Only host can start

      // Check if all seats are filled and ready
      const allFilled = Array.from(this.state.seats.values()).every(s => s.seatIndex >= 0 && s.ready);
      if (!allFilled) return;

      this.beginMatch();
    });

    this.onMessage('move', (client, data: { left: boolean; right: boolean; jump: boolean }) => {
      const validation = this.validator.validateMoveMessage(data, this.buildValidationGameState(), client.sessionId);
      if (!validation.valid) {
        console.warn(`[Move] ${validation.reason} from ${client.sessionId}`);
        return;
      }
      this.lifecycle.setInput(client.sessionId, data);
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
      // Firing costs tempo: add the weapon's delay NOW, before the turn passes,
      // so the next-turn owner is chosen against the cost just paid (issue #35).
      player.delay += weapon.delayCost;
      this.lifecycle.clearBlockedNotified(client.sessionId);

      for (const spec of projectileSpecs) {
        const vel = this.physics.createProjectile(spec.angle, data.power, weapon.mass);
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

  /**
   * End the match if fewer than two characters remain.
   *
   * Deliberately gated on matchStarted: before the second player joins there is
   * legitimately one character, and that is a room waiting to fill, not a match
   * won. Idempotent, because every removal path calls it and a final exchange
   * can remove two characters in one frame.
   */
  /** Put a fresh character on the field for a session, at the given spawn slot. */
  private spawnCharacter(sessionId: string, spawnIndex: number): Player {
    const player = new Player();
    player.id = sessionId;
    const spawn = this.map.spawns[spawnIndex % this.map.spawns.length];
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = 100;
    this.state.players.set(sessionId, player);
    return player;
  }

  private getPlayerTeam(sessionId: string): number {
    const seat = this.state.seats.get(sessionId);
    if (!seat || seat.seatIndex < 0) return -1;
    return teamOfSeat(seat.seatIndex, this.state.teamSize);
  }

  private getTeamsWithLivingPlayers(): Set<number> {
    const teams = new Set<number>();
    for (const player of this.state.players.values()) {
      if (player.health > 0) {
        const team = this.getPlayerTeam(player.id);
        teams.add(team);
      }
    }
    return teams;
  }

  private checkMatchEnd(): void {
    if (!this.matchStarted || this.state.matchPhase !== 'playing') return;

    const livingTeams = this.getTeamsWithLivingPlayers();
    if (livingTeams.size > 1) return; // Match still ongoing

    this.state.matchPhase = 'ended';
    // -1 means a draw (no teams left or simultaneous elimination)
    // Otherwise, the surviving team is in livingTeams
    this.state.winningTeamId = livingTeams.size === 1 ? Array.from(livingTeams)[0] : -1;

    // Nobody's turn, no clock, no more wind changes.
    this.state.currentPlayerId = '';
    this.endTurnClock();

    // Schedule return to lobby after a delay for result display
    this.clock.setTimeout(() => this.returnToLobby(), 3000);
  }

  private returnToLobby(): void {
    this.state.matchPhase = 'lobby';
    this.state.players.clear();
    this.state.projectiles.clear();
    this.state.currentPlayerId = '';
    this.state.windSpeed = 5;
    this.state.windDirection = 0;
    this.state.turnSecondsRemaining = 0;
    this.state.winningTeamId = -1;

    // Reset all seats' ready status while retaining seats
    for (const seat of this.state.seats.values()) {
      seat.ready = false;
    }

    // Reset internal state
    this.matchStarted = false;
    this.terrainOps = [];
    this.pendingProjectiles = [];
    this.lifecycle.clearAll();
    this.currentFrame = 0;
    this.initializeTerrainPlatform();
    this.publishWind();

    // Un-lock the room and make it visible again
    this.unlock();
    this.setMetadata({
      roomName: this.state.roomName,
      mode: this.getModeFromConfig(),
      teamCount: this.state.teamCount,
      teamSize: this.state.teamSize,
      capacity: this.maxClients,
    });
  }

  private getModeFromConfig(): string {
    if (this.state.teamSize === 1) {
      if (this.state.teamCount === 2) return 'duel';
      return 'ffa';
    } else if (this.state.teamSize === 2) {
      return '2v2';
    } else if (this.state.teamSize === 3) {
      return '3v3';
    }
    return 'duel';
  }

  private beginMatch(): void {
    this.lock();
    this.setMetadata({
      roomName: this.state.roomName,
      mode: this.getModeFromConfig(),
      teamCount: this.state.teamCount,
      teamSize: this.state.teamSize,
      capacity: this.maxClients,
      unlisted: true,
    });

    this.terrainOps = [];
    this.initializeTerrainPlatform();
    this.state.projectiles.clear();
    this.pendingProjectiles = [];
    this.state.players.clear();
    this.lifecycle.clearAll();
    this.currentFrame = 0;

    let spawnIndex = 0;
    for (const seat of this.state.seats.values()) {
      if (seat.seatIndex >= 0) {
        this.spawnCharacter(seat.sessionId, spawnIndex);
        spawnIndex++;
      }
    }

    this.state.matchPhase = 'playing';
    this.matchStarted = true;

    // Broadcast the terrain state to all clients so they can render the map
    this.broadcast('terrainSync', { mapId: this.map.id, ops: this.terrainOps });

    const first = this.lowestDelayPlayerId();
    if (first) this.beginTurn(first);
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

  /**
   * Start a fresh match with the players already here.
   *
   * A new map, full health, spawns reassigned, terrain log cleared. Everything
   * that could carry a finished match into a new one is reset here rather than
   * relying on the room being recreated, because the whole point is that
   * nobody has to reconnect.
   */
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

    // Get current wind (changes at the end of each turn, not every frame)
    const wind: Wind = this.windManager.getCurrentWind();

    // Update projectiles using PhysicsAdapter. Wind influence is per weapon, so
    // each projectile's drift is scaled by what fired it.
    const active: Projectile[] = Array.from(this.state.projectiles.values());
    this.physics.updateAllProjectiles(
      active,
      wind,
      (proj) => getWeapon(proj.weaponType).windInfluence
    );

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

      // Out of bounds. The ceiling is far higher than the other three, because
      // a high lob's apex is well above the map and clipping it deletes the
      // shot rather than bounding it — see PROJECTILE_CEILING.
      if (
        !collision &&
        (proj.y < -PROJECTILE_CEILING ||
          proj.y > MAP_HEIGHT + PROJECTILE_BOUNDS_MARGIN ||
          proj.x < -PROJECTILE_BOUNDS_MARGIN ||
          proj.x > MAP_WIDTH + PROJECTILE_BOUNDS_MARGIN)
      ) {
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
        // killPlayer deletes from this.state.players, which is the collection
        // this loop is walking. Collect the casualties and resolve them after
        // the walk, so a blast that kills two characters cannot skip the
        // second one by mutating the map mid-iteration.
        const killed: string[] = [];

        // On any collision, damage and knockback all characters within splash range
        for (const [playerId, player] of this.state.players) {
          // Skip the firer
          if (playerId === proj.firedBy) continue;

          // Skip teammates (no friendly fire)
          const firerTeam = this.getPlayerTeam(proj.firedBy);
          const targetTeam = this.getPlayerTeam(playerId);
          if (firerTeam >= 0 && targetTeam >= 0 && firerTeam === targetTeam) {
            continue;
          }

          // Knockback DIRECTION only, and deliberately still from the contact
          // point: which way a blast shoves a character is a question about
          // where it stands, not about the nearest corner of its sprite.
          const dx = player.x - collision.x;
          const dy = player.y - collision.y;
          // Distance to the DRAWN BODY, not to the contact point. `player.y` is
          // the feet, so hypot() to it scored a blast level with the head as a
          // whole body-height (36px) further away than it looked, and made an
          // identical shot hurt less the higher up the character it landed. It
          // also contradicted the direct-hit test: a projectile could be inside
          // `pointInBody` and still be treated as 36px of falloff away. Both
          // now read the same oriented box, tilt included. Zero inside it, so a
          // blast in the body always takes the saturated core of the curve.
          const dist = distanceToBody(collision.x, collision.y, player);

          if (dist > range) continue; // Outside splash range

          // Calculate damage and apply it
          const dmg = splashDamage(dist, weapon.splashRadius, weapon.maxDamage);
          if (dmg <= 0) continue;

          // Clamped: this value is broadcast, and a character killed by a
          // large blast would otherwise be reported at negative health.
          player.health = Math.max(0, player.health - dmg);

          // Apply knockback
          // HORIZONTAL ONLY, deliberately. Since ADR 0004 a character has no
          // upward motion at all — gravity moves it down toward the surface and
          // nothing moves it up — so an upward `iy` would be discarded by the
          // next tick's fall. Taking only `ix` says that plainly instead of
          // storing an impulse nothing will ever spend. This matches GunBound,
          // where a blast shoves a mobile sideways and it falls; mobiles are
          // never launched.
          const kb = knockbackImpulse(dx, dy, dmg, weapon.knockbackScale);
          if (kb.ix !== 0) this.shove(playerId, player, kb.ix);

          if (player.health <= 0) {
            killed.push(playerId);
          }
        }

        // A miss left the field; it did not land. Cratering there dug a hole at
        // the map boundary and — for a shot that went out over the TOP — drew an
        // explosion in the open sky. Terrain is destroyed where a shot actually
        // hit something.
        let removedPixels = 0;
        if (collision.type !== 'miss') {
          removedPixels = this.destroyTerrain(collision.x, collision.y, weapon.craterRadius);
        }

        // Where and what, nothing more. The damage this blast did travels as
        // synchronized health; repeating it here made the payload a second
        // source of truth that no client ever read. `removedPixels` rides along
        // so the client can scale debris to how much earth was actually moved.
        this.broadcast('collision', {
          type: collision.type,
          projectileId: proj.id,
          ...(collision.type === 'player' ? { targetId: collision.playerId } : {}),
          x: collision.x,
          y: collision.y,
          removedPixels,
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

    // Every death this frame has now been applied, so a mutual kill is visible
    // as one event rather than two sequential ones.
    if (this.matchEndDirty) {
      this.matchEndDirty = false;
      this.checkMatchEnd();
    }

    // Pass the turn only once nothing is airborne AND nothing is still staged
    // to fire. See shouldAdvanceTurn for why the staged term matters.
    if (
      this.state.matchPhase === 'playing' &&
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
      this.state.matchPhase === 'playing' &&
      this.state.currentPlayerId &&
      this.nothingInFlight() &&
      this.turnEndsAtMs > 0 &&
      Date.now() > this.turnEndsAtMs
    ) {
      // No turnTimeout broadcast: nothing listened for it, and since #19 the
      // countdown reaching zero IS the notification.
      // Passing costs tempo — far less than any shot — so skipping is a real
      // move: give up this turn to act again sooner (issue #35).
      const timedOut = this.state.players.get(this.state.currentPlayerId);
      if (timedOut) timedOut.delay += TURN_SKIP_DELAY;
      this.advanceTurn();
    }

    // Update players
    const deadPlayers: string[] = [];

    for (const [playerId, player] of this.state.players) {
      const body: Body = { x: player.x, y: player.y };

      // Terrain can be drawn over a contact point (a rect op); lift it out
      // before anything else reads its position. A point can only ever be
      // buried straight down, so this is a lift and nothing more.
      ejectUp(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body);

      const grounded = isGrounded(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body);

      if (!grounded) {
        // Airborne. Ground destroyed under the feet lands here on the next
        // frame with no special case.
        player.airborne = true;
        this.lifecycle.clearWalkWindup(playerId);

        // The hang. Gravity does nothing for FALL_DELAY_MS, which is what makes
        // ground collapsing underfoot read as a beat rather than a snap.
        const hung = advanceTimer(this.lifecycle.getFallDelay(playerId), SIMULATION_INTERVAL_MS);
        this.lifecycle.setFallDelay(playerId, hung);
        if (!fallDelayElapsed(hung)) {
          player.vy = 0;
        } else {
          player.vy = nextFallSpeed(player.vy);

          this.stepAirborneHorizontal(playerId, player, body);

          // Move by at most the distance to the ground, so a fall can never
          // overshoot into terrain. This is why there is no settle step and no
          // per-pixel descent loop: landing is exact by construction.
          const drop = groundDistance(
            this.terrainBitmap,
            MAP_WIDTH,
            MAP_HEIGHT,
            body.x,
            body.y,
            player.vy
          );
          body.y += drop;

          if (isGrounded(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body)) {
            player.vy = 0;
            player.vx = 0;
            player.airborne = false;
            // Facing sign is deliberately preserved: a character must not
            // silently turn around because it landed.
            this.lifecycle.clearFallDelay(playerId);
            this.lifecycle.clearWindDrift(playerId);
          }
        }
      } else {
        player.vy = 0;
        player.vx = 0;
        player.airborne = false;
        this.lifecycle.clearFallDelay(playerId);
        this.lifecycle.clearWindDrift(playerId);
        // A blocked run does not survive a fall: a character that walked into a
        // wall, was blasted loose and landed against another one must be told
        // again. Cleared here rather than only on the walking path below, which
        // a falling character never reaches.
        this.lifecycle.clearBlockedNotified(playerId);

        const input = this.lifecycle.getInput(playerId);
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
          // The wind-up. Held time accumulates and is spent only on the first
          // step; from then on it stays above the threshold and every tick
          // steps. Releasing the direction is the only thing that resets it.
          const held = advanceTimer(this.lifecycle.getWalkWindup(playerId), SIMULATION_INTERVAL_MS);
          this.lifecycle.setWalkWindup(playerId, held);

          if (windupElapsed(held)) {
            const result = walkStep(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body, dir);

            if (result === 'moved') {
              // The budget is a STEP COUNT. A blocked step costs nothing, and
              // walking off a ledge costs the step that took you over it.
              player.movementBudget -= 1;
              this.lifecycle.clearBlockedNotified(playerId);
            } else if (result === 'fell') {
              player.movementBudget -= 1;
              player.vy = 0;
              player.airborne = true;
              this.lifecycle.clearBlockedNotified(playerId);
            } else {
              // Once per blocked run, not once per frame: a player holding a
              // direction against a wall would otherwise flood the channel.
              if (!this.lifecycle.isBlockedNotified(playerId)) {
                this.lifecycle.setBlockedNotified(playerId);
                this.broadcast('unableToMove', { playerId, x: body.x, y: body.y });
              }
            }
          }
        } else {
          this.lifecycle.clearWalkWindup(playerId);
          if (dir === 0) this.lifecycle.clearBlockedNotified(playerId);
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
   * Lateral motion for a FALLING character: wind drift plus whatever knockback
   * velocity it still carries. Mutates `body` and `player.vx`.
   *
   * Deliberately without a bounce or a mid-air climb. GunBound falls straight
   * down and lets only the wind push sideways; we keep knockback because it is
   * tuned into every weapon's `knockbackScale`, but a character that meets a
   * wall STOPS against it rather than reflecting off it. The old
   * `WALL_ELASTICITY` ping-pong was the most visibly wrong thing our physics
   * did. (Setting every `knockbackScale` to 0 reduces this to exact GunBound
   * behaviour without touching this code.)
   */
  private stepAirborneHorizontal(playerId: string, player: Player, body: Body) {
    const wind: Wind = this.windManager.getCurrentWind();
    // The same acceleration the projectiles get, so there is one answer to
    // "what is the wind doing".
    const windAx = wind.magnitude * Math.cos(wind.angle) * WIND_INTEGRATION;

    const vx = Math.max(-TERMINAL_VELOCITY, Math.min(player.vx, TERMINAL_VELOCITY));
    player.vx = vx;

    // ONE accumulator for both forces. Truncating each independently loses its
    // remainder every tick, which under-delivers a knockback by up to a pixel
    // per tick and drops a sub-pixel one entirely.
    const carried = this.lifecycle.getWindDrift(playerId) + vx + windAx * WIND_DRIFT_SCALE;
    const pixels = Math.trunc(carried);
    this.lifecycle.setWindDrift(playerId, carried - pixels);

    const step = Math.sign(pixels);
    for (let i = 0; i < Math.abs(pixels); i++) {
      if (isSolid(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body.x + step, body.y)) {
        // Stop against the wall. Both forces die here: reflecting the velocity
        // is the bounce, and carrying the remainder would grind the character
        // along the face for the rest of the fall.
        player.vx = 0;
        this.lifecycle.setWindDrift(playerId, 0);
        return;
      }
      body.x += step;
    }
  }

  /**
   * Push a character sideways along the ground, away from a blast.
   *
   * A POSITIONAL shove, not stored velocity. A grounded character has no way to
   * spend velocity — the integrator only moves `vx` on the airborne path — so an
   * impulse handed to someone still standing sat unspent until something else
   * knocked them loose, and then fired late. That is the common case rather than
   * the edge one: splash reaches further than the crater does, so most targets
   * take damage while keeping their footing.
   *
   * Walking the shove with `walkStep` is what makes it read as a shove: it
   * follows slopes, stops dead against a wall, and pushes a character clean off
   * a ledge into a fall, all without a single special case. A character already
   * in the air has nothing to walk on, so there it stays velocity and the
   * airborne path spends it.
   */
  private shove(playerId: string, player: Player, ix: number) {
    const body: Body = { x: player.x, y: player.y };

    if (!isGrounded(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body)) {
      player.vx += ix;
      return;
    }

    const dir = Math.sign(ix);
    const pixels = Math.round(Math.abs(ix) * KNOCKBACK_SHOVE_SCALE);

    for (let i = 0; i < pixels; i++) {
      const result = walkStep(this.terrainBitmap, MAP_WIDTH, MAP_HEIGHT, body, dir);
      if (result === 'blocked') break;
      if (result === 'fell') {
        // Off the edge. The rest of the shove is the fall's business.
        player.airborne = true;
        break;
      }
    }

    player.x = body.x;
    player.y = body.y;
    // A fresh blast restarts the hang, so a character shoved off a ledge gets
    // the same beat before dropping as one whose ground vanished.
    this.lifecycle.clearFallDelay(playerId);
    this.lifecycle.clearWindDrift(playerId);
  }

  /**
   * Start `playerId`'s turn: refill the Movement Budget and arm the turn timer.
   */
  private beginTurn(playerId: string) {
    this.state.currentPlayerId = playerId;
    const player = this.state.players.get(playerId);
    if (player) {
      player.movementBudget = MOVE_STEPS;
      // Aim is NOT reset. ADR 0003 makes the chassis-relative measurement the
      // thing that stays put, and zeroing it here put the server at 0 while
      // the client's HUD and aim line still read whatever the player had
      // dialled in — a silent disagreement about where the shot goes.
    }
    this.turnEndsAtMs = Date.now() + TURN_TIME_MS;
    this.publishTurnClock();
    this.lifecycle.clearWalkWindup(playerId);
    this.lifecycle.clearBlockedNotified(playerId);
  }

  /**
   * Mirror the wind into synchronized state. That IS the notification: the wind
   * dial reads these two fields, so a broadcast alongside them would be a
   * second source of truth that the next state patch immediately overwrites.
   */
  private publishWind() {
    const wind = this.windManager.getCurrentWind();
    this.state.windSpeed = wind.magnitude * 100;
    this.state.windDirection = wind.angle;
  }

  /**
   * Pass the turn to the living player with the lowest Delay, and drift the
   * wind because a turn ended.
   *
   * Delay is the whole turn-order model (issue #35): it replaces the fixed
   * rotation. Whoever has the lowest total acts next, so a cheap shot or a pass
   * can buy two turns in a row, and a heavy shot hands the opponent tempo.
   */
  private advanceTurn() {
    const next = this.lowestDelayPlayerId();
    if (!next) {
      this.state.currentPlayerId = '';
      this.endTurnClock();
      return;
    }
    this.beginTurn(next);

    // Every turn, unconditionally. Wind drifts per TURN, never per "round" — a
    // round used to exist only because the rotation wrapped to index 0, and the
    // Delay queue has no wrap to hang it on.
    this.windManager.advanceTurn();
    this.publishWind();
  }

  /**
   * The living player who acts next: lowest Delay wins, ties resolve on the
   * session id so every client arrives at the same answer.
   */
  private lowestDelayPlayerId(): string {
    let best = '';
    for (const [id, player] of this.state.players) {
      if (!best) {
        best = id;
        continue;
      }
      const bestPlayer = this.state.players.get(best)!;
      if (player.delay < bestPlayer.delay || (player.delay === bestPlayer.delay && id < best)) {
        best = id;
      }
    }
    return best;
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
   * Delegates its runtime-state cleanup to PlayerLifecycle.remove, which is
   * itself the one place every per-session map is released together — they
   * used to be released across three call sites here, each of which forgot a
   * different one.
   */
  private removePlayer(playerId: string) {
    if (!this.state.players.has(playerId)) return;

    this.state.players.delete(playerId);
    this.lifecycle.leave(playerId, false);

    // NOT checked here. Two characters can die in the same frame — a splash
    // kill plus an out-of-bounds death, or both crossing the Kill Boundary —
    // and ending on the first removal would name the second one's killer as
    // the winner of what is actually a draw. The check runs once at the end of
    // the frame, when the casualty list is complete.
    this.matchEndDirty = true;

    if (this.state.currentPlayerId !== playerId) return;

    const next = this.lowestDelayPlayerId();
    if (next) {
      this.beginTurn(next);
    } else {
      this.state.currentPlayerId = '';
      this.endTurnClock();
    }
  }

  private destroyTerrain(x: number, y: number, radius: number = DEFAULT_CRATER_RADIUS): number {
    const op: TerrainOp = { type: 'explosion', x: Math.floor(x), y: Math.floor(y), radius };
    // Compacted rather than appended blindly: the log is replayed in full to
    // every joining client, and lip collapse below emits one op per column.
    this.terrainOps = appendOp(this.terrainOps, op);
    // How much earth this blast actually moved — the debris budget. A shot into
    // open ground reports the full crater; the same shot into an existing
    // crater reports almost nothing, because there is nothing left to remove.
    const removedPixels = applyOpToBitmap(this.terrainBitmap, op, MAP_WIDTH, MAP_HEIGHT);
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
      this.terrainOps = appendOp(this.terrainOps, lip);
      applyOpToBitmap(this.terrainBitmap, lip, MAP_WIDTH, MAP_HEIGHT);
      this.broadcast('terrainOp', lip);
    }

    return removedPixels;
  }

  private buildValidationGameState(): {
    currentPlayerId: string;
    players: Map<string, { health: number }>;
    projectiles: Map<string, { x: number; y: number; firedBy: string }>;
  } {
    // Include both active and pending projectiles to prevent double-firing within single frame
    const allProjectiles: Projectile[] = [
      ...this.state.projectiles.values(),
      ...this.pendingProjectiles,
    ];
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

  onJoin(client: Client, options: any) {
    // Create a seat for this player
    const seat = new Seat();
    seat.sessionId = client.sessionId;
    seat.userId = options?.userId || '';
    seat.displayName = options?.displayName || `Player ${client.sessionId.substring(0, 4)}`;
    seat.seatIndex = -1; // Start unclaimed
    seat.ready = false;
    seat.connected = true;

    this.state.seats.set(client.sessionId, seat);
    this.lifecycle.join(client.sessionId, seat);

    // First joiner becomes the host
    if (this.state.hostSessionId === '') {
      this.state.hostSessionId = client.sessionId;
    }

    // In match phase, handle reconnections
    if (this.state.matchPhase === 'playing') {
      // This is a reconnection during an active match
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.connected = true;
      }
    } else {
      // Lobby phase - send current terrain state for later use
      client.send('terrainSync', { mapId: this.map.id, ops: this.terrainOps });
    }
  }

  /**
   * Release everything scoped to this room.
   *
   * Colyseus stops the timestep itself, but the room's own maps and buffers
   * are ours. The terrain mask is MAP_WIDTH * MAP_HEIGHT bytes and is by far
   * the largest thing a room holds.
   */
  onDispose() {
    this.lifecycle.clearAll();
    this.pendingProjectiles = [];
    this.terrainOps = [];
    this.terrainBitmap = new Uint8Array(0);
  }

  /**
   * An abnormal disconnect. 0.17 split this out of onLeave, so the "might come
   * back" case and the "definitely gone" case are now separate hooks rather
   * than one method branching on a consent flag.
   *
   * Nothing is torn down here. That is the entire trick: the character keeps
   * its health, position, turn and Movement Budget, so a reconnect restores
   * everything by doing nothing at all.
   */
  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // They are not holding a key any more. Without this a player who
    // disconnects mid-walk keeps walking.
    this.lifecycle.leave(client.sessionId, true);
    player.connected = false;

    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
      // Resolved: they are back, and onReconnect has run.
    } catch {
      // Rejection is the NORMAL expiry path, not an error — the window closed
      // and onLeave will run for the permanent departure. Unhandled, this was
      // a rejected promise for every player who ever failed to come back.
    }
  }

  /** They made it back inside the window. */
  async onReconnect(client: Client) {
    this.lifecycle.reconnect(client.sessionId);

    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = true;
      return;
    }

    // No character: theirs was destroyed while they were reconnecting.
    // onJoin does not run again for a reconnect, so without this they would
    // sit in a live match with nothing to play.
    if (this.state.matchPhase === 'playing') {
      this.spawnCharacter(client.sessionId, this.state.players.size);
      if (this.state.players.size >= 2) this.matchStarted = true;
      if (!this.state.currentPlayerId) {
        const next = this.lowestDelayPlayerId();
        if (next) this.beginTurn(next);
      }
    }
  }

  /**
   * Permanent departure only.
   *
   * In 0.17+ this no longer runs for a recoverable drop — onDrop owns that
   * window — so everything here is unconditional teardown. It still fires for
   * a deliberate leave and for a drop whose window expired.
   */
  async onLeave(client: Client) {
    this.removePlayer(client.sessionId);
  }
}
