import { useEffect, useState } from 'react';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => hasMatchMedia() && window.matchMedia(query).matches);
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
