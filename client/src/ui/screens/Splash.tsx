import { h } from 'preact';
import { useEffect } from 'preact/hooks';

interface SplashProps {
  onDone: () => void;
}

export function Splash({ onDone }: SplashProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center pointer-events-none">
      <div class="text-center pointer-events-none">
        <h1 class="text-5xl font-bold text-white mb-4 pointer-events-none">BrowserBound</h1>
        <p class="text-slate-400 pointer-events-none">Initializing...</p>
      </div>
    </div>
  );
}
