import { WorthALookCard } from '@/components/explore/WorthALookCard';
import { HealthScoreCard } from '@/components/explore/HealthScoreCard';

/** /explore/signals — every charge worth a second look this month. */
export function ExploreSignalsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-8 pt-3">
      <WorthALookCard />
    </div>
  );
}

/** /explore/health — the full financial health breakdown. */
export function ExploreHealthPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-8 pt-3">
      <HealthScoreCard />
    </div>
  );
}
