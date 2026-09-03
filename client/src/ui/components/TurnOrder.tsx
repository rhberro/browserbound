import { turnOrder } from '../signals';

/**
 * The Delay board — Variant 2: sharp angular chips, the current turn rimmed in
 * cyan with a glow. Leftmost acts next; your own chip is tinted.
 */
export function TurnOrder() {
  return (
    <div class="pointer-events-auto flex items-center gap-1.5">
      {turnOrder.value.map((entry) => (
        <span
          key={entry.label}
          class={[
            'flex items-center gap-1.5 border px-2.5 py-1 text-[11px] leading-none',
            entry.isCurrent
              ? 'border-accent bg-accent/10 font-bold shadow-[0_0_12px_rgba(34,211,238,0.35)]'
              : 'border-neutral-700 bg-black/30',
            entry.isYou ? 'text-accent-300' : 'text-white/70',
          ].join(' ')}
        >
          <span class={['h-1.5 w-3', entry.isCurrent ? 'bg-accent' : 'bg-neutral-600'].join(' ')} />
          {entry.label}
          <span class="tabular-nums text-neutral-400">{Math.round(entry.delay)}</span>
        </span>
      ))}
    </div>
  );
}
