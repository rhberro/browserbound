import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * AngleControl: Displays angle stepper buttons and slider with last-used angle.
 * Uses event delegation for persistent event handling.
 */
export class AngleControl {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private lastAngle: number = 45;
  private listenerAttached: boolean = false;

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
      min-width: 140px;
    `;
    parent.appendChild(this.container);

    this.setupEventDelegation();
    this.update();
  }

  private setupEventDelegation(): void {
    if (!this.container || this.listenerAttached) return;

    this.container.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute('data-action') === 'angle-down') {
        this.inputAdapter.angleDown();
        this.lastAngle = this.inputAdapter.getAimState().angle;
        this.update();
      } else if (target.getAttribute('data-action') === 'angle-up') {
        this.inputAdapter.angleUp();
        this.lastAngle = this.inputAdapter.getAimState().angle;
        this.update();
      }
    });

    this.listenerAttached = true;
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Angle</label>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button data-action="angle-down" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
        ">−</button>
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 45px;">
          <span style="font-weight: 600; font-size: 13px;">${aimState.angle.toFixed(0)}°</span>
          <span style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
          ">Last: ${this.lastAngle.toFixed(0)}°</span>
        </div>
        <button data-action="angle-up" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
        ">+</button>
      </div>
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
