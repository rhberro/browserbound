import { Room, Client } from 'colyseus';
import { Schema, type, MapSchema } from '@colyseus/schema';
import { POWER_SCALE, GRAVITY, TerrainOp, MAP_WIDTH, MAP_HEIGHT, DEFAULT_CRATER_RADIUS, applyOpToBitmap } from '@browserbond/shared';
import { PhysicsAdapter, Wind } from '@browserbond/shared/src/adapters/PhysicsAdapter';
import { WindManager } from './adapters/WindManager';


class Player extends Schema {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('number') health = 100;
  @type('number') facing = 1; // 1 = direita, -1 = esquerda
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

  constructor(x: number, y: number, vx: number, vy: number, firedBy: string, fireFrame: number = 0) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.firedBy = firedBy;
    this.id = Math.random().toString(36).substring(7);
    this.fireFrame = fireFrame;
  }
}

const MOVE_SPEED = 5;
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;

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

  constructor(options: any) {
    super(options);
    this.initializeTerrainPlatform();
  }

  private initializeTerrainPlatform() {
    const platformLeft = 400;
    const platformRight = 1600;
    const platformTop = 500;

    const op: TerrainOp = {
      type: 'rect',
      x: platformLeft,
      y: platformTop,
      width: platformRight - platformLeft,
      height: MAP_HEIGHT - platformTop,
    };
    this.terrainOps.push(op);
    applyOpToBitmap(this.terrainBitmap, op, MAP_WIDTH, MAP_HEIGHT);
  }

  onCreate() {
    console.log('GameRoom created');
    this.setState(new GameState());

    // Initialize adapters
    this.physics = new PhysicsAdapter({
      gravity: GRAVITY,
      windIntegration: 0.1,
    });
    this.windManager = new WindManager({
      durationMin: 20,
      durationMax: 60,
      magnitudeMin: 0.1,
      magnitudeMax: 0.5,
    });

    // Physics loop - update every 16ms
    this.setSimulationInterval(() => this.updatePhysics(), 16);

    this.onMessage('move', (client, data: { left: boolean; right: boolean; jump: boolean }) => {
      this.playerInputs.set(client.sessionId, data);
      this.clientLastActivity.set(client.sessionId, Date.now());
    });

    this.onMessage('aimAngle', (client, data: { angle: number }) => {
      this.broadcast('aimAngle', { angle: data.angle });
    });

    this.onMessage('fire', (client, data: any) => {
      this.clientLastActivity.set(client.sessionId, Date.now());
      const player = this.state.players.get(client.sessionId);
      if (!player || client.sessionId !== this.state.currentPlayerId || this.projectiles.length > 0) return;

      const weaponType = data.weaponType || 1;
      console.log(`Player ${client.sessionId} fired with angle=${data.angle}, power=${data.power}, weapon=${weaponType}`);

      const speed = data.power * POWER_SCALE;

      // Criar projéteis baseado no tipo de arma
      if (weaponType === 1) {
        // Tiro normal - 1 projétil
        const vel = this.physics.createProjectile(data.angle, data.power);
        const proj = new GameProjectile(
          player.x,
          player.y,
          vel.vx,
          vel.vy,
          client.sessionId,
          this.currentFrame
        );
        this.projectiles.push(proj);

        this.broadcast('projectile', {
          startX: player.x,
          startY: player.y,
          projectileIds: [proj.id],
          angle: data.angle,
          power: data.power,
          weaponType: 1,
          windSpeed: this.state.windSpeed,
          windDirection: this.state.windDirection,
        });
      } else if (weaponType === 2) {
        // Rajada - 3 projéteis em sequência com variação mínima
        const angles = [
          data.angle,
          data.angle + (Math.random() * 0.4 - 0.2) * (Math.PI / 180),
          data.angle + (Math.random() * 0.4 - 0.2) * (Math.PI / 180),
        ];

        const projIds: string[] = [];

        // Criar todos os projéteis antecipadamente para ter IDs
        // Cada um dispara 5 frames depois do anterior (16ms/frame ≈ 80ms)
        const projectiles = angles.map((angle, index) => {
          const proj = new GameProjectile(
            player.x,
            player.y,
            Math.cos(angle) * speed,
            -Math.sin(angle) * speed,
            client.sessionId,
            this.currentFrame + index * 5 // Fire at frame+0, frame+5, frame+10
          );
          projIds.push(proj.id);
          return proj;
        });

        // Adicionar à fila de projéteis pendentes
        this.pendingProjectiles.push(...projectiles);

        // Enviar aviso que vai haver rajada
        this.broadcast('projectile', {
          startX: player.x,
          startY: player.y,
          projectileIds: projIds,
          angles: angles,
          power: data.power,
          weaponType: 2,
          windSpeed: this.state.windSpeed,
          windDirection: this.state.windDirection,
        });
      } else if (weaponType === 3) {
        // Shotgun - 3 projéteis simultâneos com ±1°
        const angles = [
          data.angle - (1 * Math.PI / 180),
          data.angle,
          data.angle + (1 * Math.PI / 180),
        ];

        const projIds: string[] = [];
        for (const angle of angles) {
          const proj = new GameProjectile(
            player.x,
            player.y,
            Math.cos(angle) * speed,
            -Math.sin(angle) * speed,
            client.sessionId,
            this.currentFrame // Todos disparam no mesmo frame
          );
          this.projectiles.push(proj);
          projIds.push(proj.id);
        }

        this.broadcast('projectile', {
          startX: player.x,
          startY: player.y,
          projectileIds: projIds,
          angles: angles,
          power: data.power,
          weaponType: 3,
          windSpeed: this.state.windSpeed,
          windDirection: this.state.windDirection,
        });
      }
    });
  }

  private isSolidAt(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= MAP_WIDTH || iy < 0 || iy >= MAP_HEIGHT) return false;
    return this.terrainBitmap[iy * MAP_WIDTH + ix] === 1;
  }

  private isPlayerGrounded(player: InstanceType<typeof Player>): boolean {
    const offsets = [-15, 0, 15];
    for (const dx of offsets) {
      if (this.isSolidAt(player.x + dx, player.y)) return true;
    }
    return false;
  }

  private updatePhysics() {
    this.currentFrame++;

    // Remove inactive clients (disconnected but not yet cleaned up)
    const now = Date.now();
    for (const [clientId] of this.clientLastActivity) {
      if (now - this.clientLastActivity.get(clientId)! > 30000) { // 30 seconds
        console.log(`Removing inactive client: ${clientId}`);
        this.clientLastActivity.delete(clientId);
        if (this.state.players.has(clientId)) {
          this.state.players.delete(clientId);
          if (this.state.currentPlayerId === clientId) {
            const playerIds = Array.from(this.state.players.keys());
            this.state.currentPlayerId = playerIds[0] || '';
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

    // Advance wind cycle
    this.windManager.advance();
    const wind: Wind = this.windManager.getCurrentWind();

    // Update state with wind info
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
        if (collision.type === 'player') {
          const hitPlayer = this.state.players.get(collision.playerId!);
          if (hitPlayer) {
            console.log(`Hit player ${collision.playerId}`);
            hitPlayer.health -= 20;

            this.broadcast('collision', {
              type: 'player',
              projectileId: proj.id,
              targetId: collision.playerId,
              health: hitPlayer.health,
              x: collision.x,
              y: collision.y,
            });

            if (hitPlayer.health <= 0) {
              console.log(`Player ${collision.playerId} defeated!`);
            }
          }
        } else if (collision.type === 'terrain') {
          console.log(`Projectile hit terrain`);
          this.destroyTerrain(collision.x, collision.y);

          this.broadcast('collision', {
            type: 'terrain',
            projectileId: proj.id,
            x: collision.x,
            y: collision.y,
          });
        } else if (collision.type === 'miss') {
          this.broadcast('collision', {
            type: 'miss',
            projectileId: proj.id,
            x: collision.x,
            y: collision.y,
          });
        }

        projectilesToRemove.push(proj.id);
      }
    }

    // Remove projectiles that collided
    this.projectiles = this.projectiles.filter(p => !projectilesToRemove.includes(p.id));

    // If all projectiles are gone, change turn
    if (this.projectiles.length === 0 && projectilesToRemove.length > 0) {
      const playerIds = Array.from(this.state.players.keys());
      const currentIndex = playerIds.indexOf(this.state.currentPlayerId);
      this.state.currentPlayerId = playerIds[(currentIndex + 1) % playerIds.length];
    }

    // Update players
    const deadPlayers: string[] = [];

    for (const [playerId, player] of this.state.players) {
      const input = this.playerInputs.get(playerId);

      if (input?.left) {
        player.vx = -MOVE_SPEED;
        player.facing = -1;
      } else if (input?.right) {
        player.vx = MOVE_SPEED;
        player.facing = 1;
      } else {
        player.vx *= 0.9;
      }

      const isGrounded = this.isPlayerGrounded(player);
      if (!isGrounded) {
        player.vy += GRAVITY;
      } else {
        player.vy = 0;
      }

      player.x += player.vx;
      player.y += player.vy;

      if (this.isPlayerGrounded(player)) {
        let iterations = 0;
        while (this.isPlayerGrounded(player) && iterations < 60) {
          player.y -= 1;
          iterations++;
        }
        player.vy = 0;
      }

      // Verificar se o jogador saiu dos limites do mapa (morre)
      if (player.y > MAP_HEIGHT + 50 || player.x < -50 || player.x > MAP_WIDTH + 50 || player.y < -50) {
        console.log(`Player ${playerId} fell off the map!`);
        deadPlayers.push(playerId);
      }
    }

    // Remove dead players
    for (const playerId of deadPlayers) {
      this.state.players.delete(playerId);
      if (this.state.currentPlayerId === playerId) {
        const playerIds = Array.from(this.state.players.keys());
        this.state.currentPlayerId = playerIds[0] || '';
      }
    }
  }

  private destroyTerrain(x: number, y: number, radius: number = DEFAULT_CRATER_RADIUS) {
    const op: TerrainOp = { type: 'explosion', x: Math.floor(x), y: Math.floor(y), radius };
    this.terrainOps.push(op);
    applyOpToBitmap(this.terrainBitmap, op, MAP_WIDTH, MAP_HEIGHT);
    this.broadcast('terrainOp', op);
  }

  onJoin(client: Client) {
    console.log(`Client ${client.sessionId} joined`);

    const player = new Player();
    player.id = client.sessionId;
    player.x = this.state.players.size === 0 ? 500 : 1500; // Separados por todo o mapa
    player.y = 400; // Acima do retângulo flutuante, vai cair e pousar
    player.health = 100;

    this.state.players.set(client.sessionId, player);
    this.clientLastActivity.set(client.sessionId, Date.now());

    // Ensure currentPlayerId always points to a valid player
    if (this.state.currentPlayerId === '' || !this.state.players.has(this.state.currentPlayerId)) {
      const playerIds = Array.from(this.state.players.keys());
      this.state.currentPlayerId = playerIds[0] || '';
    }

    // Send current terrain state to the client
    client.send('terrainSync', { ops: this.terrainOps });

    console.log(`Current turn: ${this.state.currentPlayerId}, Players: ${Array.from(this.state.players.keys()).join(',')}`);
  }

  onLeave(client: Client) {
    console.log(`Client ${client.sessionId} left`);
    this.clientLastActivity.delete(client.sessionId);
    this.playerInputs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    if (this.state.players.size === 0) {
      this.state.currentPlayerId = '';
    } else if (!this.state.players.has(this.state.currentPlayerId)) {
      // If current player left, switch to another valid player
      const playerIds = Array.from(this.state.players.keys());
      this.state.currentPlayerId = playerIds[0] || '';
    }
  }
}
