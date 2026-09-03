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
 * The HUD overlay — Variant 2 "Neon Tech".
 *
 * A top band (turn order left, clock centre, wind right) and two floating
 * glass panels along the bottom: an aim cluster (angle + power) on the left,
 * an action cluster (move + weapon + fire) on the right.
 *
 * The layer itself is inert (`#hud` is pointer-events:none in index.html);
 * only the panels opt back in, so clicks anywhere else reach the canvas.
 */
export function HudRoot({ gameState }: { gameState: GameState }) {
  return (
    <div class="relative flex h-full flex-col">
      <MatchResult gameState={gameState} />

      <div class="pointer-events-none flex items-start justify-between px-5 pt-4">
        <TurnOrder />
        <div class="flex flex-col items-center gap-2">
          <TurnClock />
          <ConnectionBanner />
        </div>
        <WindDial />
      </div>

      <div class="pointer-events-none mt-auto flex flex-col items-center gap-2 px-5 pb-5">
        <div class="flex w-full items-end justify-between gap-4">
          <div class={deckStateClass}>
            <div class="hud-panel pointer-events-auto flex items-center gap-5 rounded-lg px-5 py-4">
              <AngleControl />
              <div class="h-px w-8 bg-accent/30" />
              <PowerBar />
            </div>
          </div>

          <div class={deckStateClass}>
            <div class="hud-panel pointer-events-auto flex items-center gap-5 rounded-lg px-5 py-4">
              <MovementBudget />
              <WeaponSelector />
              <FireButton />
            </div>
          </div>
        </div>

        <p class="text-[10px] text-neutral-500">
          ↑/↓ angle · A/D move · 1-3 weapon · hold Space to fire
        </p>
      </div>
    </div>
  );
}
