import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * AngleControl: Displays angle stepper buttons and slider.
 * Independently subscribes to InputAdapter aimState updates.
 */
export class AngleControl {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`AngleControl: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'angle-control';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 120px;
    `;
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    this.container.innerHTML = `
      <label style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Angle</label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="angle-down" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
        ">−</button>
        <span style="min-width: 40px; text-align: center; font-weight: 600;">${aimState.angle.toFixed(0)}°</span>
        <button id="angle-up" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
        ">+</button>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const angleDown = this.container?.querySelector('#angle-down') as HTMLButtonElement;
    const angleUp = this.container?.querySelector('#angle-up') as HTMLButtonElement;

    if (angleDown) {
      angleDown.addEventListener('click', () => {
        this.inputAdapter.angleDown();
        this.update();
      });
    }

    if (angleUp) {
      angleUp.addEventListener('click', () => {
        this.inputAdapter.angleUp();
        this.update();
      });
    }
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
