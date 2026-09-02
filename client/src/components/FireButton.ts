import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * FireButton: Fire button with charging visual feedback.
 * Uses event delegation for persistent event handling.
 */
export class FireButton {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private isMouseDown: boolean = false;
  private listenerAttached: boolean = false;

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

    this.setupEventDelegation();
    this.update();
  }

  private setupEventDelegation(): void {
    if (!this.container || this.listenerAttached) return;

    this.container.addEventListener('mousedown', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-fire-button')) {
        e.preventDefault();
        this.isMouseDown = true;
        this.inputAdapter.startCharging();
        this.update();
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.inputAdapter.fire();
        this.update();
      }
    });

    this.container.addEventListener('mouseleave', () => {
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.inputAdapter.release();
        this.update();
      }
    });

    this.listenerAttached = true;
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    this.container.innerHTML = `
      <button data-fire-button="true" style="
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
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
