import { turnOrder } from '../signals';

/**
 * The Delay board: who acts next, and what each player's accumulated turn cost
 * is. Leftmost is next; the current turn is highlighted and your own chip is
 * tinted. This is the visible half of the Delay system — a player cannot plan
 * around tempo they cannot see.
 */
export function TurnOrder() {
  return (
    <div class="flex items-center gap-1.5">
      {turnOrder.value.map((entry) => (
        <span
          key={entry.label}
          class={[
            'rounded px-2 py-0.5 text-[11px] leading-none',
            entry.isCurrent ? 'bg-white/25 font-semibold' : 'bg-black/25',
            entry.isYou ? 'text-emerald-200' : 'text-white/80',
          ].join(' ')}
        >
          {entry.label} · {Math.round(entry.delay)}
        </span>
      ))}
    </div>
  );
}
