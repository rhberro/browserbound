import { Client, Room } from 'colyseus.js';
import {
  PlayerView,
  TurnView,
  RoomState,
  Player,
  Projectile,
  ProjectileView,
  TerrainOp,
  RECONNECT_WINDOW_SECONDS,
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
   * The server holds a character, its turn and its Movement Budget for
   * RECONNECT_WINDOW_SECONDS after a drop; none of that is any use unless the
   * client actually comes back for it. The token is kept in sessionStorage so a
   * reload inside the window rejoins the same match rather than starting a new
   * one — it is scoped to the tab and cleared on a deliberate leave, so it can
   * never resurrect a match the player has finished with.
   */
  private static readonly TOKEN_KEY = 'browserbound:reconnectionToken';
  private leaving = false;

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

  /** Subscribe to the room's synchronized state. Re-run after a reconnect. */
  private bindStateListeners(): void {
    if (this.room?.state) {
      // Initialize turnState immediately from current state (don't wait for onChange)
      this.updateTurnState();
    }

    if (this.room?.state && this.room.state.players) {
      this.room.state.players.onAdd((player: Player, key: string) => {
        this.players.set(key, snapshot(player));
        player.onChange(() => {
          this.players.set(key, snapshot(player));
        });
      });

      this.room.state.players.onRemove((_player: Player, key: string) => {
        this.players.delete(key);
      });
    }

    if (this.room?.state && this.room.state.projectiles) {
      // Projectiles arrive as state like everything else that moves. There is
      // no announcement message and no per-frame position message: appearing
      // in this map IS the shot being fired, and leaving it is the shot being
      // over, however it ended.
      this.room.state.projectiles.onAdd((proj: Projectile, key: string) => {
        this.projectiles.set(key, { x: proj.x, y: proj.y });
        proj.onChange(() => {
          this.projectiles.set(key, { x: proj.x, y: proj.y });
        });
      });

      this.room.state.projectiles.onRemove((_proj: Projectile, key: string) => {
        this.projectiles.delete(key);
      });
    }

    if (this.room?.state) {
      // Listen for state changes
      this.room.state.onChange(() => {
        this.updateTurnState();
      });
    }
  }

  /**
   * Rejoin after an unexpected drop, for as long as the server's window lasts.
   *
   * Code 1000 is a clean close — the player left on purpose, or the match
   * ended — and must not be retried, or leaving the game would immediately
   * rejoin it. Anything else is the case this exists for.
   */
  private watchForDisconnect(): void {
    if (!this.room) return;
    this.room.onLeave((code: number) => {
      if (this.leaving || code === 1000) {
        this.rememberToken(null);
        return;
      }
      this.onConnectionChange?.(false);
      void this.reconnectLoop();
    });
  }

  private async reconnectLoop(): Promise<void> {
    const token = this.storedToken();
    if (!token) return;

    const deadline = Date.now() + RECONNECT_WINDOW_SECONDS * 1000;
    let delayMs = 500;

    while (Date.now() < deadline && !this.leaving) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Back off, but keep retrying often enough to use most of the window.
      delayMs = Math.min(delayMs * 2, 4000);
      try {
        this.room = await this.client.reconnect(token);
      } catch {
        continue;
      }
      this.rememberToken(this.room.reconnectionToken);
      this.rebindRoom();
      this.onConnectionChange?.(true);
      return;
    }

    // The window has closed; the server has already removed the character.
    this.rememberToken(null);
  }

  /**
   * Re-attach every listener to the room object returned by a reconnect.
   *
   * `reconnect` hands back a NEW Room instance, so callbacks registered on the
   * old one are attached to an object nothing will ever update again — the
   * game would appear frozen while the connection was in fact healthy.
   */
  private rebindRoom(): void {
    if (!this.room) return;
    this.players.clear();
    this.projectiles.clear();
    this.bindStateListeners();
    this.registerMessageHandlers();
    this.watchForDisconnect();
    this.updateTurnState();
  }

  /** Leave on purpose: no reconnection window, no stored token. */
  async leave(): Promise<void> {
    this.leaving = true;
    this.rememberToken(null);
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
