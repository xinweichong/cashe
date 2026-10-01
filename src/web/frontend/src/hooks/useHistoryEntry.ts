import { useEffect, useRef } from 'react';

// Gives an open overlay (a TaskSheet) its own browser-history entry, so the
// phone's back gesture or the browser Back button closes it instead of
// leaving the page. `onBack` returns false when the close was refused (an
// unsaved form asking to discard); the entry is then restored so the next
// Back still lands on the overlay. Closing from the UI removes the entry.
// The entry repeats the current URL and keeps the router's own state, so
// the router sees no navigation.
export function useHistoryEntry(open: boolean, onBack: () => boolean) {
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });

  useEffect(() => {
    if (!open) return;
    const key = Math.random().toString(36).slice(2);
    const push = () => window.history.pushState({ ...window.history.state, casheOverlay: key }, '');
    push();
    let ours = true;
    const onPop = () => {
      if (window.history.state?.casheOverlay === key) return; // forward again onto our entry
      if (onBackRef.current()) ours = false;
      else push();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (ours && window.history.state?.casheOverlay === key) window.history.back();
    };
  }, [open]);
}
