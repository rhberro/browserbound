import * as PIXI from 'pixi.js';
import { GameState } from '../gameState';
import { InputAdapter } from '../adapters/InputAdapter';
import { CameraAdapter } from '../adapters/CameraAdapter';
import { RendererAdapter } from '../adapters/RendererAdapter';
import { mountHud, unmountHud } from '../ui/mountHud';
import {
  syncHudSignals,
  isConnected,
  blockedAt,
} from '../ui/signals';

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
      // A fresh map means a fresh match: debris from the last impact must not
      // carry into it.
      this.rendererAdapter.clearParticles();
      return this.rendererAdapter.loadMap(mapId);
    });
    this.gameState.setOnTerrainOp((op) => this.rendererAdapter.applyTerrainOp(op));

    // Release any terrain news that arrived over the wire before the
    // callbacks above were registered. Awaits the map load before a single
    // op replays, so a queued crater can never land on a still-loading map.
    //
    // Not awaited here (constructors can't be async) — fired and left to
    // run. If a map is pending, this calls `onMapLoad` synchronously as part
    // of this expression, which runs `clearParticles()` and starts
    // `loadMap()` within this constructor's own call stack. That is safe:
    // `rendererAdapter` (line 35, above) is fully constructed by this point,
    // so there is nothing later in this constructor for `clearParticles` to
    // race against.
    void this.gameState.replayPendingTerrain();

    // Our own connection state drives the banner. Without this the dropped
    // player sees a game that has simply stopped, with no way to tell a retry
    // in progress from a hang.
    this.gameState.onConnectionChange = (connected) => {
      isConnected.value = connected;
    };

    this.gameState.onBlocked = () => {
      blockedAt.value = Date.now();
    };

    // Blow up players the moment the server reports them dead
    this.gameState.onPlayerDied = (_playerId, x, y) => {
      this.rendererAdapter.spawnDeathExplosion(x, y);
    };

    this.inputAdapter.setupInput();
    mountHud(this.inputAdapter, this.gameState);
  }

  update(deltaMS: number) {
    // First: release anything a shot did whose drawn moment has arrived. Ahead
    // of everything else in the frame so the explosion and the crater are in
    // place before the projectile that caused them is drawn one last time.
    this.gameState.advanceShotClock(performance.now());

    // Update input state
    this.inputAdapter.update(deltaMS);

    // Update camera to follow current player or projectiles
    this.cameraAdapter.update(this.gameState);

    // Update player sprites and health bars
    const aimState = this.inputAdapter.getAimState();
    this.rendererAdapter.updatePlayers(this.gameState, aimState);

    // Update projectile graphics
    this.rendererAdapter.updateProjectiles(this.gameState);

    // Advance debris particles
    this.rendererAdapter.updateParticles(deltaMS);

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

  /**
   * Tear the scene down.
   *
   * Nothing called for this while a page navigation ended every session, but
   * #21's rematch means a scene can now outlive a match — and the renderer
   * holds a map-sized render texture.
   */
  destroy(): void {
    unmountHud();
    this.inputAdapter.teardownInput();
    this.rendererAdapter.destroy();
    this.app.stage.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  render() {
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
