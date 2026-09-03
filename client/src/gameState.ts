import { Client, Room } from 'colyseus.js';
import {
  PlayerState,
  TurnState,
  TerrainOp,
  RECONNECT_WINDOW_SECONDS,
} from '@browserbond/shared';

export class GameState {
  private client: Client;
  private room: Room | null = null;
  public players: Map<string, PlayerState> = new Map();
  public turnState: TurnState | null = null;
  public currentProjectile: { x: number; y: number } | null = null;
  public projectiles: Map<string, { x: number; y: number }> = new Map();
  public collision: { type: string; x: number; y: number; time: number } | null = null;
  public currentPlayerAimAngle: number = 45;
  public onTerrainOp: ((op: TerrainOp) => void) | null = null;

  /**
   * Called with the map the room is playing before any of its terrain ops.
   * The base terrain is a PNG, not an op (ADR 0002) — `terrainSync` names the
   * map and carries destruction since it loaded.
   */
  public onMapLoad: ((mapId: string) => void) | null = null;
  private pendingMapId: string | null = null;
  public onPlayerHit: ((targetId: string, health: number) => void) | null = null;
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
      this.room.state.players.onAdd((player: any, key: string) => {
        this.players.set(key, {
          id: key,
          x: player.x,
          y: player.y,
          health: player.health,
          currentlyAiming: false,
          facing: player.facing || 1,
          connected: player.connected !== false,
        });

        player.onChange(() => {
          const p = this.players.get(key);
          if (p) {
            p.x = player.x;
            p.y = player.y;
            p.health = player.health;
            p.facing = player.facing;
            p.connected = player.connected !== false;
          }
        });
      });

      this.room.state.players.onRemove((player: any, key: string) => {
        this.players.delete(key);
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

    this.room.onMessage('projectile', (data) => {
      this.projectiles.clear();
      if (data.projectileIds) {
        for (const id of data.projectileIds) {
          this.projectiles.set(id, { x: data.startX, y: data.startY });
        }
      }
    });

    this.room.onMessage('projectileUpdate', (data) => {
      if (data.projectileId) {
        const proj = this.projectiles.get(data.projectileId);
        if (proj) {
          proj.x = data.x;
          proj.y = data.y;
        }
      } else {
        const firstProj = this.projectiles.values().next().value;
        if (firstProj) {
          firstProj.x = data.x;
          firstProj.y = data.y;
        }
      }
    });

    this.room.onMessage('collision', (data) => {
      this.collision = {
        type: data.type,
        x: data.x,
        y: data.y,
        time: Date.now(),
      };

      if (data.type === 'player') {
        if (this.onPlayerHit) {
          this.onPlayerHit(data.targetId, data.health);
        }
      }

      if (data.projectileId) {
        this.projectiles.delete(data.projectileId);
      } else {
        this.projectiles.clear();
      }
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

    this.room.onMessage('hit', (data) => {
      if (this.onPlayerHit) {
        this.onPlayerHit(data.targetId, data.health);
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

    this.room.onMessage('aimAngle', (data) => {
      this.currentPlayerAimAngle = data.angle;
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
    this.turnState = {
      currentPlayerId: this.room.state.currentPlayerId,
      windSpeed: this.room.state.windSpeed,
      windDirection: this.room.state.windDirection,
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
}
