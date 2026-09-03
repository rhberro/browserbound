import { h } from 'preact';
import { supabase } from '../../supabase';

interface MainMenuProps {
  onNavigate: (scene: string) => void;
}

export function MainMenu({ onNavigate }: MainMenuProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center p-4 pointer-events-auto">
      <div class="w-full max-w-md pointer-events-auto">
        <div class="text-center mb-12 pointer-events-none">
          <h1 class="text-5xl font-bold text-white mb-2">BrowserBound</h1>
          <p class="text-slate-400">Main Menu</p>
        </div>

        <div class="space-y-3 pointer-events-auto">
          <button
            onClick={() => onNavigate('findServers')}
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Find Servers
          </button>
          <button
            onClick={() => onNavigate('createServer')}
            class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Create Server
          </button>
          <button
            onClick={() => onNavigate('settings')}
            class="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Settings
          </button>
          <button
            onClick={handleSignOut}
            class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
