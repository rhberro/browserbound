import { h } from 'preact';

interface LobbyProps {
  onNavigate: (scene: string) => void;
}

export function Lobby({ onNavigate }: LobbyProps) {
  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start p-4 pt-12 pointer-events-auto">
      <div class="w-full max-w-md pointer-events-auto">
        <div class="flex items-center justify-between mb-8 pointer-events-auto">
          <h1 class="text-3xl font-bold text-white pointer-events-none">Lobby</h1>
          <button
            onClick={() => onNavigate('mainMenu')}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Back
          </button>
        </div>

        <div class="bg-slate-800 rounded-lg border border-slate-700 p-6 pointer-events-auto">
          <p class="text-slate-400 pointer-events-none">Lobby screen placeholder - will be implemented in a later ticket</p>
        </div>
      </div>
    </div>
  );
}
