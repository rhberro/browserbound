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
    console.log('Joined game room:', this.room.sessionId);

    if (this.room.state && this.room.state.players) {
      this.room.state.players.onAdd((player: any, key: string) => {
        console.log('Player added:', key);
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
        console.log('Player removed:', key);
        this.players.delete(key);
      });
    }

    if (this.room.state) {
      // Listen for changes on root state fields
      this.room.state.onChange(() => {
        console.log('State changed - windSpeed:', this.room!.state.windSpeed, 'windDirection:', this.room!.state.windDirection);
        this.updateTurnState();
      });

      // Also listen specifically to wind changes (windSpeed and windDirection)
      this.room.state.onChange('windSpeed', (value: number) => {
        console.log('Wind speed changed:', value);
        this.updateTurnState();
      });

      this.room.state.onChange('windDirection', (value: number) => {
        console.log('Wind direction changed:', value);
        this.updateTurnState();
      });
    }
  }

  private updateTurnState() {
    if (!this.room?.state) return;
    this.turnState = {
      currentPlayerId: this.room.state.currentPlayerId,
      windSpeed: this.room.state.windSpeed,
      windDirection: this.room.state.windDirection,
    };
    console.log('TurnState updated:', this.turnState);

    this.room.onMessage('projectile', (data) => {
      console.log('Projectile fired:', data);
      this.projectiles.clear();
      // Usar os IDs que o servidor envia
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
        // Backwards compatibility: se não tiver projectileId, atualizar o primeiro
        const firstProj = this.projectiles.values().next().value;
        if (firstProj) {
          firstProj.x = data.x;
          firstProj.y = data.y;
        }
      }
    });

    this.room.onMessage('collision', (data) => {
      console.log('Collision detected:', data);
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

      // Remove only the projectile that collided, not all of them
      if (data.projectileId) {
        this.projectiles.delete(data.projectileId);
      } else {
        // If no specific projectile ID, clear all (fallback)
        this.projectiles.clear();
      }
    });

    this.room.onMessage('hit', (data) => {
      console.log('Player hit:', data.targetId, 'Health:', data.health);
      if (this.onPlayerHit) {
        this.onPlayerHit(data.targetId, data.health);
      }
    });

    this.room.onMessage('terrainSync', (data: { ops: TerrainOp[] }) => {
      console.log('Terrain sync received, ops:', data.ops.length);
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
