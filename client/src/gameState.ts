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
  };
}

export class GameState {
  private client: Client;
  private room: Room<RoomState> | null = null;
  public players: Map<string, PlayerView> = new Map();
  public turnState: TurnView | null = null;
  public projectiles: Map<string, ProjectileView> = new Map();
  public collision: { type: string; x: number; y: number; time: number } | null = null;
  public onTerrainOp: ((op: TerrainOp) => void) | null = null;

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

  /** Notified when the connection drops and again when it is restored. */
  public onConnectionChange: ((connected: boolean) => void) | null = null;

  /** Notified as players vote for a rematch: how many are ready, out of how many. */
  public onRematchReady: ((ready: number, of: number) => void) | null = null;

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
   * Every registration returns an unsubscribe function, and they are collected
   * so a reconnect can drop the old room's listeners. `reconnect` hands back a
   * NEW Room, and listeners left on the previous one would keep firing against
   * state nothing updates any more.
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
        track(
          $(player).onChange(() => {
            this.players.set(key, snapshot(player));
          })
        );
      })
    );

    track(
      $(this.room.state).players.onRemove((_player: Player, key: string) => {
        this.players.delete(key);
      })
    );

    // Projectiles arrive as state like everything else that moves. There is no
    // announcement message and no per-frame position message: appearing in
    // this map IS the shot being fired, and leaving it is the shot being over,
    // however it ended.
    track(
      $(this.room.state).projectiles.onAdd((proj: Projectile, key: string) => {
        this.projectiles.set(key, { x: proj.x, y: proj.y });
        track(
          $(proj).onChange(() => {
            this.projectiles.set(key, { x: proj.x, y: proj.y });
          })
        );
      })
    );

    track(
      $(this.room.state).projectiles.onRemove((_proj: Projectile, key: string) => {
        this.projectiles.delete(key);
      })
    );

    track(
      $(this.room.state).onChange(() => {
        this.updateTurnState();
      })
    );
  }

  /** Drop every state callback registered against the current room. */
  private unbindStateListeners(): void {
    for (const off of this.stateUnsubscribers) off();
    this.stateUnsubscribers = [];
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
      this.collision = {
        type: data.type,
        x: data.x,
        y: data.y,
        time: Date.now(),
      };

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
      // Drop the player locally right away instead of waiting for the schema
      // removal to arrive — the sprite must disappear on the same frame the
      // explosion starts.
      this.players.delete(data.playerId);

      if (this.onPlayerDied) {
        this.onPlayerDied(data.playerId, data.x, data.y);
      }
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
      if (this.onTerrainOp) {
        this.onTerrainOp(op);
      } else {
        this.pendingTerrainOps.push(op);
      }
    });

    // A Blocked Move: the character is against terrain it cannot climb, which
    // costs no Movement Budget and so leaves the budget bar unmoving. The
    // server already debounces this; without a listener it was a cue computed
    // and thrown away.
    this.room.onMessage('unableToMove', (data: { playerId: string }) => {
      if (data.playerId === this.room?.sessionId) this.onBlocked?.();
    });

    this.room.onMessage('rematchReady', (data: { ready: number; of: number }) => {
      this.onRematchReady?.(data.ready, data.of);
    });

    this.room.onMessage('windChanged', (data) => {
      if (this.turnState) {
        this.turnState.windSpeed = data.windSpeed;
        this.turnState.windDirection = data.windDirection;
      }
    });
  }

  private updateTurnState() {
    if (!this.room?.state) return;
    const state = this.room.state;
    this.turnState = {
      currentPlayerId: state.currentPlayerId,
      windSpeed: state.windSpeed,
      windDirection: state.windDirection,
      turnSecondsRemaining: state.turnSecondsRemaining,
      matchPhase: state.matchPhase,
      winnerId: state.winnerId,
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

  /** Ask for a rematch. The match restarts once every client here has asked. */
  requestRematch() {
    this.room?.send('rematch');
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
}
