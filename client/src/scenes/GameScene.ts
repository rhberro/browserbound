import * as PIXI from 'pixi.js';
import { GameState } from '../gameState';
import { InputAdapter } from '../adapters/InputAdapter';
import { CameraAdapter } from '../adapters/CameraAdapter';
import { RendererAdapter } from '../adapters/RendererAdapter';
import { mountHud } from '../ui/mountHud';
import { syncHudSignals, isConnected } from '../ui/signals';

export class GameScene {
  private app: PIXI.Application;
  private gameState: GameState;
  private container: PIXI.Container;
  /** Last aim angle sent to the server; null forces a send on the first frame. */
  private lastSentAimDeg: number | null = null;
  private wasMyTurn = false;

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

    // Our own connection state drives the banner. Without this the dropped
    // player sees a game that has simply stopped, with no way to tell a retry
    // in progress from a hang.
    this.gameState.onConnectionChange = (connected) => {
      isConnected.value = connected;
    };

    // Blow up players the moment the server reports them dead
    this.gameState.onPlayerDied = (_playerId, x, y) => {
      this.rendererAdapter.spawnDeathExplosion(x, y);
    };

    this.inputAdapter.setupInput();
    mountHud(this.inputAdapter);
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

    // A new turn forces a resend even if the dialled-in angle has not moved,
    // so the server's stored aim can never sit at a stale value while the HUD
    // and the aim line show a different one.
    const myTurn = this.gameState.isMyTurn();
    if (myTurn !== this.wasMyTurn) {
      this.wasMyTurn = myTurn;
      this.lastSentAimDeg = null;
    }

    // Handle server communication
    if (myTurn) {
      // Send movement input to server
      if (this.inputAdapter.shouldSendMovement()) {
        const movement = this.inputAdapter.getMovement();
        this.gameState.sendMovement({ left: movement.left, right: movement.right, jump: false });
      }

      // Only when it actually moves. This ran every frame, sending 60
      // identical messages a second for a value the player changes in steps.
      if (aimState.angleDeg !== this.lastSentAimDeg) {
        this.lastSentAimDeg = aimState.angleDeg;
        this.gameState.sendAimAngle(aimState.angleDeg);
      }

      // Check if player fired
      if (this.inputAdapter.shouldFire()) {
        this.fire();
      }
    }
  }

  render() {
    const aimState = this.inputAdapter.getAimState();
    const myPlayer = this.gameState.getMyPlayer();

    // The aim line is the only world-frame feedback the player gets (ADR
    // 0003), so it is drawn for the whole of your turn — not just while the
    // shot is charging. Nobody else's aim is your business.
    this.rendererAdapter.renderAimLine(this.gameState.isMyTurn() ? myPlayer : null, aimState);

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

    // Power and weapon only. The firing direction is the server's, computed
    // from the aim angle already sent, the chassis tilt and the facing.
    const aimState = this.inputAdapter.getAimState();
    this.gameState.fire(aimState.power, this.inputAdapter.getSelectedWeapon());
    this.inputAdapter.resetAfterFire();
  }
}
