import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import {
  PlayerView,
  TurnView,
  RoomState,
  Player,
  Projectile,
  ProjectileView,
  TerrainOp,
} from '@browserbond/shared';
import { ShotClock } from './rendering/ShotClock';

/**
 * Copy the fields the client is allowed to read off a synchronized Player.
 *
 * A plain object rather than the schema instance itself: the renderer
 * interpolates and mutates its own view of position, and writing back into
 * synchronized state would be the client pretending to be authoritative. The
 * PlayerView type is derived from the schema, so a field renamed on the server
 * fails to compile here.
 */
function snapshot(player: Player): PlayerView {
  return {
    id: player.id,
    x: player.x,
    y: player.y,
    health: player.health,
    facing: player.facing || 1,
    movementBudget: player.movementBudget,
    airborne: player.airborne,
    tilt: player.tilt,
    aimAngle: player.aimAngle,
    connected: player.connected,
    delay: player.delay,
  };
}

/**
 * A single impact, as the server reported it in the `collision` message.
 *
 * `removedPixels` is how much terrain the blast actually carved out — zero for
 * a miss — and is what the renderer scales debris to.
 */
export interface CollisionEvent {
  type: string;
  x: number;
  y: number;
  time: number;
  removedPixels: number;
}

export class GameState {
  private client: Client;
  private room: Room<RoomState> | null = null;
  public players: Map<string, PlayerView> = new Map();
  public turnState: TurnView | null = null;
  public projectiles: Map<string, ProjectileView> = new Map();
  public collision: CollisionEvent | null = null;
  public onTerrainOp: ((op: TerrainOp) => void) | null = null;

  /**
   * Everything a shot does on arrival waits here.
   *
   * A projectile's position is drawn `SHOT_DELAY_MS` behind live so it can be
   * interpolated between patches; its impact, its crater and its removal from
   * the world all arrive as news that is true the instant it lands. Releasing
   * that news immediately put it a delay's worth of flight AHEAD of the
   * projectile the player was watching, which is what made shots explode in
   * mid-air short of the ground.
   *
   * Presentation timing in the state layer is deliberate: this is where a
   * shot's news lands, and the whole point is that one owner decides when ALL
   * of it becomes visible. Split that decision across the renderer and here and
   * the two clocks grow apart again.
   */
  private shotClock = new ShotClock();

  /**
   * Called with the map the room is playing before any of its terrain ops.
   * The base terrain is a PNG, not an op (ADR 0002) — `terrainSync` names the
   * map and carries destruction since it loaded.
   */
  public onMapLoad: ((mapId: string) => void) | null = null;
  private pendingMapId: string | null = null;
  public onPlayerDied: ((playerId: string, x: number, y: number) => void) | null = null;
  private pendingTerrainOps: TerrainOp[] = [];

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // In development (localhost), connect to port 3002 where the server runs
    // In production, connect to the current host
    let url: string;
    if (window.location.hostname === 'localhost') {
      url = `${protocol}//localhost:3002`;
    } else {
      url = `${protocol}//${window.location.host}`;
    }

    this.client = new Client(url);
  }

  /**
   * Reconnection is driven entirely from here.
   *
   * The server holds a character, its turn and its Movement Budget for the
   * length of the reconnection window; none of that is any use unless the
   * client actually comes back for it. The token is kept in sessionStorage so a
   * reload inside the window rejoins the same match rather than starting a new
   * one — it is scoped to the tab and cleared on a deliberate leave, so it can
   * never resurrect a match the player has finished with.
   */
  private static readonly TOKEN_KEY = 'browserbound:reconnectionToken';
  /** Unsubscribe functions for state callbacks bound to the current room. */
  private stateUnsubscribers: Array<() => void> = [];
  /**
   * Per-entity `onChange` unsubscribers, keyed by the entity's id.
   *
   * Kept apart from the room-level ones because they have a different
   * lifetime: a projectile's callback must be released when THAT projectile
   * resolves, not when the room does. Pushed onto the flat list instead, they
   * accumulated one entry per shot fired for the life of the session.
   */
  private entityUnsubscribers: Map<string, () => void> = new Map();

  /** Notified when the connection drops and again when it is restored. */
  public onConnectionChange: ((connected: boolean) => void) | null = null;


  /** Notified when this character walks into terrain it cannot climb. */
  public onBlocked: (() => void) | null = null;

  private storedToken(): string | null {
    try {
      return sessionStorage.getItem(GameState.TOKEN_KEY);
    } catch {
      // Private browsing modes throw on access. A missing token just means a
      // fresh join, which is the correct fallback.
      return null;
    }
  }

  private rememberToken(token: string | null): void {
    try {
      if (token) sessionStorage.setItem(GameState.TOKEN_KEY, token);
      else sessionStorage.removeItem(GameState.TOKEN_KEY);
    } catch {
      // Non-fatal: reconnection simply will not survive a reload.
    }
  }

  async connect(): Promise<void> {
    const token = this.storedToken();
    if (token) {
      try {
        this.room = await this.client.reconnect(token);
      } catch {
        // Window expired, or the room is gone. Fall through to a fresh join.
        this.rememberToken(null);
      }
    }
    if (!this.room) {
      this.room = await this.client.joinOrCreate('game');
    }
    this.rememberToken(this.room.reconnectionToken);
    this.watchForDisconnect();

    this.bindStateListeners();

    // Register message handlers once at connection time
    this.registerMessageHandlers();
  }

  /**
   * Subscribe to the room's synchronized state. Re-run after a reconnect.
   *
   * 0.16 moved callbacks OFF the schema instances: `state.players.onAdd(...)`
   * is gone, and registration goes through a proxy from `getStateCallbacks`.
   * The instances themselves stay plain data, which is why every read below
   * still touches `player.x` directly — only the *subscription* changed.
   *
   * Every registration returns an unsubscribe function and all of them are
   * collected, so teardown can drop them. Room-level ones live for the
   * session; per-entity ones are released when their entity leaves the map.
   */
  private bindStateListeners(): void {
    if (!this.room?.state) return;
    this.unbindStateListeners();

    const $ = getStateCallbacks(this.room);
    const track = (off: () => void) => this.stateUnsubscribers.push(off);

    // Initialize turnState immediately from current state (don't wait for onChange)
    this.updateTurnState();

    track(
      $(this.room.state).players.onAdd((player: Player, key: string) => {
        this.players.set(key, snapshot(player));
        this.trackEntity(
          key,
          $(player).onChange(() => {
            this.players.set(key, snapshot(player));
          })
        );
      })
    );

    track(
      $(this.room.state).players.onRemove((_player: Player, key: string) => {
        this.players.delete(key);
        this.releaseEntity(key);
      })
    );

    // Projectiles arrive as state like everything else that moves. There is no
    // announcement message and no per-frame position message: appearing in
    // this map IS the shot being fired, and leaving it is the shot being over,
    // however it ended.
    track(
      $(this.room.state).projectiles.onAdd((proj: Projectile, key: string) => {
        this.projectiles.set(key, { x: proj.x, y: proj.y });
        this.trackEntity(
          key,
          $(proj).onChange(() => {
            this.projectiles.set(key, { x: proj.x, y: proj.y });
          })
        );
      })
    );

    track(
      $(this.room.state).projectiles.onRemove((_proj: Projectile, key: string) => {
        // Stop taking new positions for it straight away — there are none —
        // but let it finish flying the stretch already in the buffer before it
        // vanishes, so it disappears into its own explosion rather than a
        // delay short of it.
        this.releaseEntity(key);
        this.shotClock.defer(performance.now(), () => this.projectiles.delete(key));
      })
    );

    track(
      $(this.room.state).onChange(() => {
        this.updateTurnState();
      })
    );
  }

  private trackEntity(key: string, off: () => void): void {
    this.releaseEntity(key);
    this.entityUnsubscribers.set(key, off);
  }

  private releaseEntity(key: string): void {
    const off = this.entityUnsubscribers.get(key);
    if (!off) return;
    off();
    this.entityUnsubscribers.delete(key);
  }

  /** Drop every state callback registered against the current room. */
  private unbindStateListeners(): void {
    for (const off of this.stateUnsubscribers) off();
    this.stateUnsubscribers = [];
    for (const off of this.entityUnsubscribers.values()) off();
    this.entityUnsubscribers.clear();

    // A held-back crater belongs to a room that is gone. Drop it rather than
    // painting it over whatever comes next.
    this.shotClock.clear();

    // Dropping the queue drops the removals waiting in it, so anything those
    // were going to delete would be stranded on screen forever — a red dot
    // hanging in the sky from a shot that landed before a reconnect. Clearing
    // both maps costs nothing, because rebinding re-fires `onAdd` for
    // everything the room still holds and repopulates them from state.
    this.projectiles.clear();
    this.players.clear();
  }

  /**
   * Advance the shot clock, releasing anything a shot did that the drawn moment
   * has now caught up to. Called once per rendered frame.
   */
  advanceShotClock(now: number): void {
    this.shotClock.flush(now);
  }

  /**
   * Track connection state through the SDK's own reconnection.
   *
   * 0.18 reconnects automatically and preserves this Room instance along with
   * every state callback and message handler on it, so the hand-rolled retry
   * loop and listener-rebinding this replaced are not merely redundant — two
   * mechanisms racing to reconnect the same session would fight. What is left
   * is reporting which state we are in.
   */
  private watchForDisconnect(): void {
    if (!this.room) return;

    this.room.onDrop(() => {
      this.onConnectionChange?.(false);
    });

    this.room.onReconnect(() => {
      this.rememberToken(this.room?.reconnectionToken ?? null);
      this.onConnectionChange?.(true);
    });

    // Reached only once the SDK has given up, or on a clean close. Either way
    // the session is over and the token is worthless.
    this.room.onLeave(() => {
      this.rememberToken(null);
    });
  }

  /** Leave on purpose: no reconnection window, no stored token. */
  async leave(): Promise<void> {
    this.rememberToken(null);
    this.unbindStateListeners();
    await this.room?.leave(true);
    this.room = null;
  }

  private registerMessageHandlers(): void {
    if (!this.room) return;

    this.room.onMessage('collision', (data) => {
      // Fly the projectile the rest of the way in, NOW rather than on release.
      //
      // Positions arrive at the patch rate but the shot resolves on a
      // simulation frame, so the last position the client is ever told about
      // can be most of a patch short of where the shot actually landed — and
      // the projectile is deleted in the same patch, so no later position is
      // coming. Left alone the drawn projectile stops in mid-air a few frames
      // shy of the ground, which is most of what "it explodes nowhere near the
      // projectile" was.
      //
      // This message carries the exact impact point, so feed it in as the
      // track's final position and let the interpolation carry the projectile
      // into it over the delay that is about to elapse. By the time the
      // explosion is released below, the projectile has arrived.
      if (data.projectileId && this.projectiles.has(data.projectileId)) {
        this.projectiles.set(data.projectileId, { x: data.x, y: data.y });
      }

      this.shotClock.defer(performance.now(), () => {
        this.collision = {
          type: data.type,
          x: data.x,
          y: data.y,
          // Stamped on RELEASE, not on arrival: the explosion animation runs
          // off this, and a timestamp from a delay ago starts it part-played.
          time: Date.now(),
          removedPixels: data.removedPixels ?? 0,
        };
      });

      // No hit callback. It had no subscriber, and it read `data.health` —
      // a field this broadcast has never carried, so it always passed
      // undefined. Health is synchronized state and reaches the health bar
      // that way.
      //
      // Removal is state's job, not this message's. The impact stays a
      // message because it is an EVENT — it happens once, at a moment — while
      // the projectile's existence is continuous state.
    });

    this.room.onMessage('playerDied', (data: { playerId: string; x: number; y: number }) => {
      // A death is part of the impact that caused it, so it waits with the
      // rest of the shot. Held back together, and released together: the sprite
      // must disappear on the same frame its explosion starts, which is the
      // reason this drops the player locally rather than waiting for the schema
      // removal to arrive on its own.
      this.shotClock.defer(performance.now(), () => {
        this.players.delete(data.playerId);
        this.onPlayerDied?.(data.playerId, data.x, data.y);
      });
    });

    this.room.onMessage('terrainSync', (data: { mapId?: string; ops: TerrainOp[] }) => {
      // Map first, ops second: the renderer holds its op queue until the map
      // has been painted, so craters land on top of the ground, not under it.
      if (data.mapId) {
        if (this.onMapLoad) {
          this.onMapLoad(data.mapId);
        } else {
          this.pendingMapId = data.mapId;
        }
      }
      if (this.onTerrainOp) {
        for (const op of data.ops) {
          this.onTerrainOp(op);
        }
      } else {
        this.pendingTerrainOps.push(...data.ops);
      }
    });

    this.room.onMessage('terrainOp', (op: TerrainOp) => {
      // A crater is part of the impact that made it, so it waits with the
      // explosion. `terrainSync` above does NOT wait: that is the backlog of a
      // match already in progress, history rather than news, and holding it
      // back would only draw the map wrong for a moment on join.
      this.shotClock.defer(performance.now(), () => {
        if (this.onTerrainOp) {
          this.onTerrainOp(op);
        } else {
          this.pendingTerrainOps.push(op);
        }
      });
    });

    // A Blocked Move: the character is against terrain it cannot climb, which
    // costs no Movement Budget and so leaves the budget bar unmoving. The
    // server already debounces this; without a listener it was a cue computed
    // and thrown away.
    this.room.onMessage('unableToMove', (data: { playerId: string }) => {
      if (data.playerId === this.room?.sessionId) this.onBlocked?.();
    });
  }

  private updateTurnState() {
    if (!this.room?.state) return;
    const state = this.room.state;
    this.turnState = {
      currentPlayerId: state.currentPlayerId,
      roomName: state.roomName,
      hostSessionId: state.hostSessionId,
      teamCount: state.teamCount,
      teamSize: state.teamSize,
      windSpeed: state.windSpeed,
      windDirection: state.windDirection,
      turnSecondsRemaining: state.turnSecondsRemaining,
      matchPhase: state.matchPhase,
      winningTeamId: state.winningTeamId,
    };
  }

  /**
   * Register the map-load handler. Call this BEFORE `setOnTerrainOp`: if a
   * `terrainSync` already arrived, both replay their backlog on registration,
   * and the map has to be requested before the craters queue behind it.
   */
  setOnMapLoad(callback: (mapId: string) => void) {
    this.onMapLoad = callback;
    if (this.pendingMapId) {
      callback(this.pendingMapId);
      this.pendingMapId = null;
    }
  }

  setOnTerrainOp(callback: (op: TerrainOp) => void) {
    this.onTerrainOp = callback;
    for (const op of this.pendingTerrainOps) {
      callback(op);
    }
    this.pendingTerrainOps = [];
  }

  isCurrentPlayer(playerId: string): boolean {
    return this.room?.state.currentPlayerId === playerId;
  }

  /** The local session's own character, if it is still in the match. */
  getMyPlayer(): PlayerView | null {
    const myId = this.room?.sessionId;
    if (!myId) return null;
    return this.players.get(myId) ?? null;
  }

  isMyTurn(): boolean {
    if (!this.room || !this.room.state) return false;
    return this.room.sessionId === this.room.state.currentPlayerId;
  }

  sendMovement(data: { left: boolean; right: boolean; jump: boolean }) {
    if (this.room) {
      this.room.send('move', data);
    }
  }

  /**
   * No angle: the server derives the firing direction from the character's
   * chassis tilt, stored aim angle and facing. Sending one meant the client
   * computed a world angle the server ignored, which is precisely how the two
   * drifted apart.
   */
  fire(power: number, weaponType: number = 1) {
    if (this.room) {
      this.room.send('fire', { power, weaponType });
    }
  }

  sendAimAngle(angle: number) {
    if (this.room) {
      this.room.send('aimAngle', { angle });
    }
  }

  getRoomSessionId(): string | null {
    return this.room?.sessionId || null;
  }

  getGameState() {
    return this.room?.state || null;
  }

  // Lobby and room management methods
  async createRoom(options: { mode: string; roomName: string; ffaCount?: number }): Promise<string> {
    const { data: { session } } = await (await import('./supabase')).supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    this.room = await this.client.create('game', {
      mode: options.mode,
      roomName: options.roomName,
      ffaCount: options.ffaCount,
      userId: session.user.id,
      displayName: session.user.user_metadata?.display_name || session.user.email,
    } as any);

    this.setupRoomHandlers();
    return (this.room as any).roomId || '';
  }

  async joinRoom(roomId: string): Promise<void> {
    const { data: { session } } = await (await import('./supabase')).supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    this.room = await this.client.joinById('game', roomId, {
      userId: session.user.id,
      displayName: session.user.user_metadata?.display_name || session.user.email,
    } as any);

    this.setupRoomHandlers();
  }

  async discoverRooms(): Promise<any[]> {
    const lobby = await this.client.joinOrCreate('lobby');

    return new Promise((resolve) => {
      const rooms: any[] = [];

      const cleanup = lobby.onMessage('rooms', (message: any) => {
        if (message && Array.isArray(message)) {
          resolve(message.filter((room: any) => !room.metadata?.unlisted));
        }
      });

      setTimeout(() => {
        cleanup();
        resolve(rooms);
      }, 5000);
    });
  }

  claimSeat(seatIndex: number) {
    if (this.room) {
      this.room.send('claimSeat', { seatIndex });
    }
  }

  setReady(ready: boolean) {
    if (this.room) {
      this.room.send('setReady', { ready });
    }
  }

  startGame() {
    if (this.room) {
      this.room.send('startGame');
    }
  }

  private setupRoomHandlers(): void {
    if (!this.room) return;

    this.room.onMessage('collision', (message: any) => {
      this.collision = { ...message, time: Date.now(), x: message.x || 0, y: message.y || 0, removedPixels: message.removedPixels || 0 };
    });

    this.room.onMessage('terrainSync', (message: any) => {
      this.pendingMapId = message.mapId;
      this.pendingTerrainOps = message.ops || [];
    });

    this.room.onMessage('blocked', () => {
      if (this.onBlocked) {
        this.onBlocked();
      }
    });
  }
}
