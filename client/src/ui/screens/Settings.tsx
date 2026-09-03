import { h } from 'preact';

interface SettingsProps {
  onNavigate: (scene: string) => void;
}

export function Settings({ onNavigate }: SettingsProps) {
  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start p-4 pt-12">
      <div class="w-full max-w-md">
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-3xl font-bold text-white">Settings</h1>
          <button
            onClick={() => onNavigate('mainMenu')}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition"
          >
            Back
          </button>
        </div>

        <div class="bg-slate-800 rounded-lg border border-slate-700 p-6">
          <p class="text-slate-400">Settings placeholder - no content yet</p>
        </div>
      </div>
    </div>
  );
}
