import { InputAdapter } from '../adapters/InputAdapter';

/**
 * WeaponSelector: Displays weapon selection buttons (1/2/3).
 *
 * The DOM is built once in mount(); update() only patches the selected
 * styling so the buttons stay clickable across frames.
 */
export class WeaponSelector {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private buttons: HTMLButtonElement[] = [];

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`WeaponSelector: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'weapon-control';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Weapon</label>
      <div id="weapon-buttons" style="display: flex; gap: 4px;"></div>
    `;
    parent.appendChild(this.container);

    const row = this.container.querySelector('#weapon-buttons') as HTMLElement;
    for (let i = 1; i <= 3; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `weapon-${i}-btn`;
      btn.textContent = String(i);
      btn.style.cssText = `
        padding: 8px 14px;
        border: 1px solid var(--color-neutral-700);
        background: transparent;
        color: var(--color-text);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 400;
        transition: all 0.1s;
        user-select: none;
      `;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.inputAdapter.selectWeapon(i);
        this.update();
      });
      row.appendChild(btn);
      this.buttons.push(btn);
    }

    this.update();
  }

  update(): void {
    const selected = this.inputAdapter.getSelectedWeapon();

    this.buttons.forEach((btn, index) => {
      const isSelected = index + 1 === selected;
      const border = isSelected ? 'var(--color-accent)' : 'var(--color-neutral-700)';
      const background = isSelected ? 'rgba(145, 132, 217, 0.1)' : 'transparent';
      const weight = isSelected ? '600' : '400';

      if (btn.style.borderColor !== border) btn.style.borderColor = border;
      if (btn.style.background !== background) btn.style.background = background;
      if (btn.style.fontWeight !== weight) btn.style.fontWeight = weight;
    });
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
