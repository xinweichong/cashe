import { createContext, useContext } from 'react';

// Shared by ListDetail (P6/P7) and the detail pages it hosts: how to leave
// the detail, and what the back button calls the page it returns to.
export const StackContext = createContext<{ back: () => void; label?: string } | null>(null);

/** The detail's own back action (NavBar `back.onClick`): animates the pop on a phone. */
export function useStackBack(): () => void {
  const ctx = useContext(StackContext);
  return ctx?.back ?? (() => window.history.back());
}

/** The parent page's name for the back button, e.g. "Plan". */
export function useStackLabel(fallback = 'Back'): string {
  return useContext(StackContext)?.label ?? fallback;
}
