import { InputAdapter } from '../adapters/InputAdapter';

/**
 * FireButton: Fire button with charging visual feedback.
 *
 * The DOM is built once in mount(); update() only patches the glow.
 * Uses pointer capture so the release always reaches this button, even if
 * the cursor drifts off it while charging.
 */
export class FireButton {
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private inputAdapter: InputAdapter;
  private isCharging: boolean = false;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`FireButton: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'fire-control';
    this.container.style.cssText = `
      display: flex;
      align-items: flex-end;
    `;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.id = 'fire-btn';
    this.button.textContent = 'FIRE';
    this.button.style.cssText = `
      padding: 14px 32px;
      border: 2px solid var(--color-accent);
      background: transparent;
      color: var(--color-accent);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 15px;
      transition: box-shadow 0.1s ease-out;
      user-select: none;
      touch-action: none;
    `;
    this.container.appendChild(this.button);
    parent.appendChild(this.container);

    this.attachListeners();
    this.update();
  }

  private attachListeners(): void {
    const btn = this.button;
    if (!btn) return;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Capture the pointer so pointerup lands here no matter where it happens.
      btn.setPointerCapture(e.pointerId);
      this.isCharging = true;
      this.inputAdapter.startCharging();
      this.update();
    });

    const release = (e: PointerEvent) => {
      if (!this.isCharging) return;
      e.preventDefault();
      this.isCharging = false;
      this.inputAdapter.release();
      this.update();
    };

    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  update(): void {
    if (!this.button) return;

    const charging = this.inputAdapter.getAimState().isCharging;
    const shadow = charging
      ? '0 0 20px rgba(145, 132, 217, 0.8), inset 0 0 10px rgba(145, 132, 217, 0.3)'
      : 'none';

    if (this.button.style.boxShadow !== shadow) {
      this.button.style.boxShadow = shadow;
    }

    // Keep local flag in sync if charging was cancelled elsewhere (e.g. fired).
    if (!charging && this.isCharging) {
      this.isCharging = false;
    }
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
