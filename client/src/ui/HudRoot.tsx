import { WindDial } from './components/WindDial';
import { ConnectionBanner } from './components/ConnectionBanner';
import { MatchResult } from './components/MatchResult';
import { TurnOrder } from './components/TurnOrder';
import { AngleControl } from './components/AngleControl';
import { PowerBar } from './components/PowerBar';
import { MovementBudget } from './components/MovementBudget';
import { TurnClock } from './components/TurnClock';
import { WeaponSelector } from './components/WeaponSelector';
import { FireButton } from './components/FireButton';
import { deckStateClass } from './signals';
import type { GameState } from '../gameState';

/**
 * The HUD overlay: a status pill along the top and the control deck along the
 * bottom, floating over the game canvas.
 *
 * The layer itself is inert (`#hud` is pointer-events:none in index.html);
 * only the pill and the deck opt back in, so clicks anywhere else reach the
 * canvas underneath.
 */
export function HudRoot({ gameState }: { gameState: GameState }) {
  return (
    <div class="relative flex h-full flex-col justify-between">
      <MatchResult gameState={gameState} />

      <div>
        <WindDial />
        <TurnOrder />
        <ConnectionBanner />
      </div>

      <div class="pointer-events-none flex justify-center px-4 pb-6">
        <div class={deckStateClass}>
          <div class="hud-panel pointer-events-auto flex flex-wrap items-end justify-center gap-x-8 gap-y-5 rounded-xl px-8 py-5 shadow-lg shadow-black/50">
            <AngleControl />
            <PowerBar />
            <MovementBudget />
            <TurnClock />
            <WeaponSelector />
            <FireButton />
          </div>

          <p class="mt-2 text-center text-[10px] text-neutral-600">
            ↑/↓ angle · A/D move · 1-3 weapon · hold Space to fire
          </p>
        </div>
      </div>
    </div>
  );
}
