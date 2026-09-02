/**
 * InputAdapter: Handles all keyboard input and action coordination.
 *
 * Manages:
 * - Keyboard state tracking
 * - Weapon selection
 * - Aim angle adjustments
 * - Power charging (when firing)
 * - Movement and fire actions
 */

/** How fast the power gauge fills, in percent per second. */
const CHARGE_RATE_PER_SECOND = 40;

export interface AimState {
  angle: number;
  power: number;
  isCharging: boolean;
}

export class InputAdapter {
  private keys: Map<string, boolean> = new Map();
  private isCharging: boolean = false;
  private aimPower: number = 0;
  private aimAngle: number = 45; // 0 = horizontal, 90 = up
  private selectedWeapon: number = 1; // 1 = normal, 2 = burst, 3 = shotgun
  private lastMoveUpdate: number = 0;

  constructor(private gameState: any) {}

  /**
   * Register keyboard event listeners.
   */
  setupInput(): void {
    document.addEventListener('keydown', (e) => {
      this.keys.set(e.code, true);

      // Weapon selection (1, 2, 3 keys)
      if (e.code === 'Digit1') {
        this.selectedWeapon = 1;
      } else if (e.code === 'Digit2') {
        this.selectedWeapon = 2;
      } else if (e.code === 'Digit3') {
        this.selectedWeapon = 3;
      }

      // Start charging when Space is pressed
      if (e.code === 'Space' && this.gameState.isMyTurn()) {
        e.preventDefault();
        if (!this.isCharging) {
          this.isCharging = true;
          this.aimPower = 0;
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);

      // Fire when Space is released
      if (e.code === 'Space' && this.isCharging) {
        this.isCharging = false;
      }
    });
  }

  /**
   * Update input state (called every frame).
   */
  update(deltaMS: number): void {
    // Charge power while the fire input is held (40%/sec -> 2.5s for a full bar)
    if (this.isCharging) {
      this.aimPower = Math.min(100, this.aimPower + (deltaMS / 1000) * CHARGE_RATE_PER_SECOND);
    }

    // Adjust aim angle with Up/Down arrows
    if (this.gameState.isMyTurn()) {
      const upPressed = this.keys.get('ArrowUp') || false;
      const downPressed = this.keys.get('ArrowDown') || false;

      if (upPressed) {
        this.aimAngle = Math.min(90, this.aimAngle + 1.5);
      } else if (downPressed) {
        this.aimAngle = Math.max(0, this.aimAngle - 1.5);
      }
    }
  }

  /**
   * Get current aim state.
   */
  getAimState(): AimState {
    return {
      angle: this.aimAngle,
      power: this.aimPower,
      isCharging: this.isCharging,
    };
  }

  /**
   * Check if player should fire (Space was just released).
   */
  shouldFire(): boolean {
    return !this.isCharging && this.aimPower > 0;
  }

  /**
   * Get movement input (left/right arrow or A/D keys).
   */
  getMovement(): { left: boolean; right: boolean } {
    return {
      left: this.keys.get('ArrowLeft') || this.keys.get('KeyA') || false,
      right: this.keys.get('ArrowRight') || this.keys.get('KeyD') || false,
    };
  }

  /**
   * Reset aim/power after firing.
   */
  resetAfterFire(): void {
    this.isCharging = false;
    this.aimPower = 0;
  }

  /**
   * Get selected weapon type.
   */
  getSelectedWeapon(): number {
    return this.selectedWeapon;
  }

  /**
   * Set selected weapon type.
   */
  setWeapon(weaponType: number): void {
    this.selectedWeapon = weaponType;
  }

  /**
   * Set aim angle directly.
   */
  setAimAngle(angle: number): void {
    this.aimAngle = Math.max(0, Math.min(90, angle));
  }

  /**
   * Check if movement update should be sent (throttled to 50ms).
   */
  shouldSendMovement(): boolean {
    const now = Date.now();
    if (now - this.lastMoveUpdate < 50) {
      return false;
    }
    this.lastMoveUpdate = now;
    return true;
  }

  /**
   * Increment aim angle (called by HUD button).
   */
  angleUp(): void {
    this.aimAngle = Math.min(90, this.aimAngle + 1.5);
  }

  /**
   * Decrement aim angle (called by HUD button).
   */
  angleDown(): void {
    this.aimAngle = Math.max(0, this.aimAngle - 1.5);
  }

  /**
   * Select weapon (called by HUD button or keyboard).
   */
  selectWeapon(weaponType: number): void {
    this.selectedWeapon = Math.max(1, Math.min(3, weaponType));
  }

  /**
   * Start charging (called by HUD fire button mousedown).
   */
  startCharging(): void {
    if (this.gameState.isMyTurn() && !this.isCharging) {
      this.isCharging = true;
      this.aimPower = 0;
    }
  }

  /**
   * Release charge (called by HUD fire button mouseleave/mouseup without firing).
   */
  release(): void {
    this.isCharging = false;
  }

}
