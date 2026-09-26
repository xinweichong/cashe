import { useSearchParams } from 'react-router-dom';

// Selections and filters held in the URL. Changes replace the current
// history entry, so Back leaves the page instead of stepping through them;
// a null value removes the parameter.
export function useUrlParams() {
  const [search, setSearch] = useSearchParams();
  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key); else params.set(key, value);
    }
    setSearch(params, { replace: true });
  };
  return [search, update] as const;
}
