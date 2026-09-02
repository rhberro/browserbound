import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * FireButton: Fire button with charging visual feedback.
 * Independently subscribes to InputAdapter charging state.
 */
export class FireButton {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private button: HTMLButtonElement | null = null;

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
      <button id="fire-button" style="
        padding: 12px 24px;
        border: 2px solid var(--color-accent);
        background: transparent;
        color: var(--color-accent);
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        transition: all 0.1s ease-out;
        ${aimState.isCharging ? 'box-shadow: 0 0 16px rgba(145, 132, 217, 0.6);' : ''}
      ">FIRE</button>
    `;

    this.button = this.container.querySelector('#fire-button');
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    if (!this.button) return;

    this.button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.inputAdapter.startCharging();
      this.update();
    });

    this.button.addEventListener('mouseup', (e) => {
      e.preventDefault();
      this.inputAdapter.fire();
      this.update();
    });

    this.button.addEventListener('mouseleave', () => {
      this.inputAdapter.release();
      this.update();
    });
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
