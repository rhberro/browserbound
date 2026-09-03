import { isMyTurn, selectedWeapon } from '../signals';
import { useInput } from '../InputContext';

const WEAPONS = [
  { id: 1, label: 'Normal' },
  { id: 2, label: 'Burst' },
  { id: 3, label: 'Shotgun' },
] as const;

/** Weapon 1/2/3 — Variant 2: sharp-edged buttons with a cyan active glow.
 *  Stays in sync with the number-key shortcuts, which write through the same
 *  InputAdapter. */
export function WeaponSelector() {
  const input = useInput();
  const selected = selectedWeapon.value;
  const disabled = !isMyTurn.value;

  return (
    <div class="flex flex-col gap-2">
      <span class="hud-label">Weapon</span>

      <div class="flex gap-1">
        {WEAPONS.map(({ id, label }) => {
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={`${label} (key ${id})`}
              aria-pressed={active}
              disabled={disabled}
              onPointerDown={(e) => {
                e.preventDefault();
                input.selectWeapon(id);
              }}
              class={
                'size-10 border text-sm font-bold select-none touch-none transition-colors ' +
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
                'disabled:cursor-not-allowed disabled:opacity-45 ' +
                (active
                  ? 'border-accent bg-accent/10 text-accent shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                  : 'border-neutral-700 text-ink hover:border-neutral-600 hover:bg-white/5')
              }
            >
              {id}
            </button>
          );
        })}
      </div>
    </div>
  );
}
