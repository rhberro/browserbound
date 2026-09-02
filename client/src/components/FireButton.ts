import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * FireButton: Fire button with charging visual feedback.
 * Attaches listeners directly to button element.
 */
export class FireButton {
  private container: HTMLElement | null = null;
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
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    this.container.innerHTML = `
      <button id="fire-btn" style="
        padding: 14px 32px;
        border: 2px solid var(--color-accent);
        background: transparent;
        color: var(--color-accent);
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 15px;
        transition: all 0.1s ease-out;
        ${aimState.isCharging ? 'box-shadow: 0 0 20px rgba(145, 132, 217, 0.8), inset 0 0 10px rgba(145, 132, 217, 0.3);' : ''}
      ">FIRE</button>
    `;

    this.attachListeners();
  }

  private attachListeners(): void {
    const btn = this.container?.querySelector('#fire-btn') as HTMLButtonElement;
    if (!btn) return;

    btn.onmousedown = (e) => {
      e.preventDefault();
      this.isCharging = true;
      this.inputAdapter.startCharging();
      this.update();
    };

    btn.onmouseup = (e) => {
      e.preventDefault();
      if (this.isCharging) {
        this.isCharging = false;
        this.inputAdapter.fire();
        this.update();
      }
    };

    btn.onmouseleave = () => {
      if (this.isCharging) {
        this.isCharging = false;
        this.inputAdapter.release();
        this.update();
      }
    };
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
