import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { InputAdapter } from '../adapters/InputAdapter';

/**
 * The HUD dispatches into the game through the same InputAdapter the keyboard
 * uses, so both paths converge on one state. The value is set once at mount and
 * never changes, so reading it costs no re-renders.
 */
export const InputContext = createContext<InputAdapter | null>(null);

export function useInput(): InputAdapter {
  const input = useContext(InputContext);
  if (!input) throw new Error('useInput must be used inside the HUD InputContext provider');
  return input;
}
