import { useMediaQuery } from './useMediaQuery';

// Below Tailwind's `md` breakpoint (768px): the phone layout, where details
// are pushed pages (ListDetail) and a few compositions differ (Explore's
// summary list, Plan's charge rows). Pages mount exactly one layout rather
// than hiding a duplicate behind CSS.
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
