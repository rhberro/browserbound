import { Client, Room } from 'colyseus.js';
import { PlayerState, TurnState, calculateTrajectory, TerrainOp } from '@browserbond/shared';

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

  async connect(): Promise<void> {
    this.room = await this.client.joinOrCreate('game');

    if (this.room.state) {
      // Initialize turnState immediately from current state (don't wait for onChange)
      this.updateTurnState();
    }

    if (this.room.state && this.room.state.players) {
      this.room.state.players.onAdd((player: any, key: string) => {
        this.players.set(key, {
          id: key,
          x: player.x,
          y: player.y,
          health: player.health,
          currentlyAiming: false,
          facing: player.facing || 1,
        });

        player.onChange(() => {
          const p = this.players.get(key);
          if (p) {
            p.x = player.x;
            p.y = player.y;
            p.health = player.health;
            p.facing = player.facing;
          }
        });
      });

      this.room.state.players.onRemove((player: any, key: string) => {
        this.players.delete(key);
      });
    }

    if (this.room.state) {
      // Listen for state changes
      this.room.state.onChange(() => {
        this.updateTurnState();
      });
    }

    // Register message handlers once at connection time
    this.registerMessageHandlers();
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

    this.room.onMessage('terrainSync', (data: { ops: TerrainOp[] }) => {
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

  fire(angle: number, power: number, weaponType: number = 1) {
    if (this.room) {
      this.room.send('fire', { angle, power, weaponType });
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
