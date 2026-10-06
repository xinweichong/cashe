import { useLocation } from 'react-router-dom';
import { evidenceLink } from '@/api/briefing';

// Evidence opened from Explore returns to the same Explore view (mode,
// selection params) and names it on its back button.
export function useEvidenceLink(): typeof evidenceLink {
  const location = useLocation();
  const here = encodeURIComponent(location.pathname + location.search);
  return (...args) => `${evidenceLink(...args)}&returnTo=${here}`;
}
