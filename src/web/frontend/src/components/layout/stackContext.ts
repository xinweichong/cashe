import { createContext, useContext } from 'react';

// Shared by ListDetail (P6/P7) and the detail pages it hosts.
export const StackContext = createContext<{ back: () => void } | null>(null);

/** The detail's own back action (NavBar `back.onClick`): animates the pop on a phone. */
export function useStackBack(): () => void {
  const ctx = useContext(StackContext);
  return ctx?.back ?? (() => window.history.back());
}
