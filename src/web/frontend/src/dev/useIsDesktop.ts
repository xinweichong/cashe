import { useEffect, useState } from 'react';

// Matches Tailwind's `lg` breakpoint (1024px), used so the Plan layout study
// mounts exactly one MonthCalendar instance instead of duplicating it behind
// CSS `hidden`/`lg:block` toggles — see the plan's "no duplicated mounted
// forms" rule. A production useBreakpoint hook belongs in src/hooks/ once
// increment 5 actually needs it; this is scoped to the study for now.
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isDesktop;
}
