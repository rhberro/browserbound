import { GameState } from '../gameState';

/**
 * StatusPill: Displays wind speed (as %) and direction.
 *
 * The DOM is built once in mount(); update() only patches the value and the
 * arrow rotation so the CSS transition can actually run.
 */
export class StatusPill {
  private container: HTMLElement | null = null;
  private gameState: GameState;

  // Live nodes
  private valueEl: HTMLElement | null = null;
  private arrowEl: HTMLElement | null = null;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`StatusPill: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'status-pill';
    this.container.style.cssText = `
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 24px;
    `;

    this.container.innerHTML = `
      <div style="
        padding: 14px 22px;
        border-radius: 999px;
        background: rgba(22, 24, 38, 0.92);
        border: 1px solid var(--color-neutral-700);
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 15px;
        color: var(--color-text);
      ">
        <div style="display: flex; flex-direction: column; align-items: center;">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Wind</span>
          <span id="wind-value" style="font-weight: 700; font-size: 18px;">0%</span>
        </div>
        <div style="
          width: 1px;
          height: 40px;
          background: var(--color-neutral-700);
          opacity: 0.5;
        "></div>
        <div id="wind-arrow" style="
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          transform: rotate(0deg);
          transition: transform 0.3s ease-out;
          font-size: 32px;
          color: var(--color-accent);
        ">→</div>
      </div>
    `;
    parent.appendChild(this.container);

    this.valueEl = this.container.querySelector('#wind-value');
    this.arrowEl = this.container.querySelector('#wind-arrow');

    this.update();
  }

  update(): void {
    if (!this.valueEl || !this.arrowEl) return;

    const turnState = this.gameState.turnState;
    if (!turnState) return;

    // windSpeed is magnitude * 100, magnitude maxes out at 0.5 -> 0-50 range.
    const windPercent = Math.round((turnState.windSpeed / 50) * 100);
    const windAngle = (turnState.windDirection * 180) / Math.PI;

    const valueText = `${windPercent}%`;
    if (this.valueEl.textContent !== valueText) this.valueEl.textContent = valueText;

    const transform = `rotate(${windAngle.toFixed(1)}deg)`;
    if (this.arrowEl.style.transform !== transform) this.arrowEl.style.transform = transform;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
