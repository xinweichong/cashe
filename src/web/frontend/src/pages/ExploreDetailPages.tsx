import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { WorthALookCard } from '@/components/explore/WorthALookCard';
import { HealthScoreCard } from '@/components/explore/HealthScoreCard';

function BackToExplore() {
  return (
    <Link to="/explore" className="text-sm text-teal min-h-11 inline-flex items-center gap-1 hover:underline">
      <ChevronLeft className="w-4 h-4" aria-hidden="true" />Back to Explore
    </Link>
  );
}

/** /explore/signals — every charge worth a second look this month. */
export function ExploreSignalsPage() {
  return (
    <div className="p-4 md:p-6 space-y-3 max-w-3xl">
      <BackToExplore />
      <WorthALookCard />
    </div>
  );
}

/** /explore/health — the full financial health breakdown. */
export function ExploreHealthPage() {
  return (
    <div className="p-4 md:p-6 space-y-3 max-w-3xl">
      <BackToExplore />
      <HealthScoreCard />
    </div>
  );
}
