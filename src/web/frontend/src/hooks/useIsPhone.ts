import { useMediaQuery } from './useMediaQuery';

// Below Tailwind's `md` breakpoint (768px): the phone layout, where each tab
// is one non-scrolling screen (PhoneScreen + LensBar + DrillSheet). Tablet
// and desktop keep their own compositions, so pages mount exactly one layout
// rather than hiding a duplicate behind CSS.
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
