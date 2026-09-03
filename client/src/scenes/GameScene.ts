import * as PIXI from 'pixi.js';
import { GameState } from '../gameState';
import { InputAdapter } from '../adapters/InputAdapter';
import { CameraAdapter } from '../adapters/CameraAdapter';
import { RendererAdapter } from '../adapters/RendererAdapter';
import { mountHud } from '../ui/mountHud';
import { syncHudSignals } from '../ui/signals';

export class GameScene {
  private app: PIXI.Application;
  private gameState: GameState;
  private container: PIXI.Container;

  // Adapters
  private inputAdapter: InputAdapter;
  private cameraAdapter: CameraAdapter;
  private rendererAdapter: RendererAdapter;

  constructor(app: PIXI.Application, gameState: GameState) {
    this.app = app;
    this.gameState = gameState;
    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);

    // Initialize adapters
    this.inputAdapter = new InputAdapter(gameState);
    this.cameraAdapter = new CameraAdapter(app, this.container);
    this.rendererAdapter = new RendererAdapter(app, this.container);

    // Set up terrain. Map before ops: the renderer holds queued craters until
    // the map PNG has been painted, so destruction lands on top of the ground
    // rather than being wiped by the arriving map (ADR 0002).
    this.gameState.setOnMapLoad((mapId) => {
      void this.rendererAdapter.loadMap(mapId);
    });
    this.gameState.setOnTerrainOp((op) => this.rendererAdapter.applyTerrainOp(op));

    // Blow up players the moment the server reports them dead
    this.gameState.onPlayerDied = (_playerId, x, y) => {
      this.rendererAdapter.spawnDeathExplosion(x, y);
    };

    this.inputAdapter.setupInput();
    mountHud(this.inputAdapter);
  }

  private getMyPlayer() {
    const myId = this.gameState.getRoomSessionId();
    if (!myId) return null;
    return this.gameState.players.get(myId) || null;
  }

  update(deltaMS: number) {
    // Update input state
    this.inputAdapter.update(deltaMS);

    // Update camera to follow current player or projectiles
    this.cameraAdapter.update(this.gameState);

    // Update player sprites and health bars
    const aimState = this.inputAdapter.getAimState();
    this.rendererAdapter.updatePlayers(this.gameState, aimState);

    // Update projectile graphics
    this.rendererAdapter.updateProjectiles(this.gameState);

    // Handle server communication
    if (this.gameState.isMyTurn()) {
      // Send movement input to server
      if (this.inputAdapter.shouldSendMovement()) {
        const movement = this.inputAdapter.getMovement();
        this.gameState.sendMovement({ left: movement.left, right: movement.right, jump: false });
      }

      // Send aim angle to server
      this.gameState.sendAimAngle(aimState.angle);

      // Check if player fired
      if (this.inputAdapter.shouldFire()) {
        this.fire();
      }
    }
  }

  render() {
    const aimState = this.inputAdapter.getAimState();
    const myPlayer = this.getMyPlayer();

    // Render aim line while charging
    this.rendererAdapter.renderAimLine(myPlayer, aimState);

    // Render explosion animation
    this.rendererAdapter.renderExplosion(this.gameState.collision);

    // Advance any death explosions
    this.rendererAdapter.updateDeathExplosions();

    // Push this frame's state into the HUD
    syncHudSignals(this.gameState, this.inputAdapter);

    // Clear collision state after explosion finishes
    if (this.gameState.collision) {
      const now = Date.now();
      const elapsed = now - this.gameState.collision.time;
      if (elapsed > 500) {
        this.gameState.collision = null;
      }
    }
  }

  private fire() {
    if (!this.gameState.isMyTurn()) return;

    const myPlayer = this.getMyPlayer();
    const facing = myPlayer ? (myPlayer as any).facing || 1 : 1;
    const aimState = this.inputAdapter.getAimState();
    const relativeAngle = facing === 1 ? aimState.angle : 180 - aimState.angle;
    const radians = (relativeAngle * Math.PI) / 180;

    this.gameState.fire(radians, aimState.power, this.inputAdapter.getSelectedWeapon());
    this.inputAdapter.resetAfterFire();
  }
}
