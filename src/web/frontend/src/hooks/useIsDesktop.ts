import { useMediaQuery } from './useMediaQuery';

// Matches Tailwind's `lg` breakpoint (1024px). Used to mount exactly one
// instance of a layout (e.g. Plan's month calendar) instead of duplicating
// it behind CSS `hidden`/`lg:block` toggles, per the design-language
// restoration plan's "no duplicated mounted forms" rule.
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
