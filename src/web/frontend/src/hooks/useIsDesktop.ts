import { useEffect, useState } from 'react';

// Matches Tailwind's `lg` breakpoint (1024px). Used to mount exactly one
// instance of a layout (e.g. Plan's month calendar) instead of duplicating
// it behind CSS `hidden`/`lg:block` toggles, per the design-language
// restoration plan's "no duplicated mounted forms" rule.
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => hasMatchMedia() && window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isDesktop;
}
