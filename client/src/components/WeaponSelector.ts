import { InputAdapter } from '../adapters/InputAdapter';

/**
 * WeaponSelector: Displays weapon selection buttons (1/2/3).
 * Independently subscribes to InputAdapter weapon selection state.
 */
export class WeaponSelector {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;

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
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const selectedWeapon = this.inputAdapter.getSelectedWeapon();

    this.container.innerHTML = `
      <label style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Weapon</label>
      <div style="display: flex; gap: 4px;">
        <button id="weapon-1" data-weapon="1" style="
          padding: 8px 12px;
          border: 1px solid ${selectedWeapon === 1 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 1 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 1 ? '600' : '400'};
        ">1</button>
        <button id="weapon-2" data-weapon="2" style="
          padding: 8px 12px;
          border: 1px solid ${selectedWeapon === 2 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 2 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 2 ? '600' : '400'};
        ">2</button>
        <button id="weapon-3" data-weapon="3" style="
          padding: 8px 12px;
          border: 1px solid ${selectedWeapon === 3 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 3 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 3 ? '600' : '400'};
        ">3</button>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    for (let i = 1; i <= 3; i++) {
      const btn = this.container?.querySelector(`#weapon-${i}`) as HTMLButtonElement;
      if (btn) {
        btn.addEventListener('click', () => {
          this.inputAdapter.selectWeapon(i);
          this.update();
        });
      }
    }
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
