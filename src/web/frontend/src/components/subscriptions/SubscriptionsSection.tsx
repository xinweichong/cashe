import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, type Subscription } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { SubscriptionForm } from './SubscriptionForm';

const FREQUENCY_LABELS: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

interface SubscriptionsSectionProps {
  selectedSubId: number | null;
  onSelectSub: (id: number) => void;
}

export function SubscriptionsSection({ selectedSubId, onSelectSub }: SubscriptionsSectionProps) {
  const [showForm, setShowForm] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.getSubscriptions(),
    staleTime: 30_000,
  });

  const subs = data?.subscriptions ?? [];
  const summary = data?.summary;

  return (
    <>
      <PageCard
        title="Subscriptions"
        action={
          <div className="flex items-center gap-2">
            {summary && (
              <span className="text-sm font-semibold text-teal tabular-nums">
                S${summary.total_monthly_sgd.toFixed(2)}/mo
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowForm(true)}
              aria-label="Add subscription"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        }
      >
        {summary && summary.possibly_cancelled_count > 0 && (
          <p className="text-xs text-warning mb-3">
            ⚠ {summary.possibly_cancelled_count} subscription
            {summary.possibly_cancelled_count === 1 ? '' : 's'} may have been cancelled
          </p>
        )}
        <div className="divide-y divide-border">
          {subs.map((sub) => (
            <button
              key={sub.id}
              onClick={() => onSelectSub(sub.id)}
              className={`w-full flex items-center justify-between py-3 text-left hover:bg-foreground/5 transition-colors -mx-4 px-4 ${
                selectedSubId === sub.id ? 'bg-foreground/10' : ''
              }`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground truncate">
                  {sub.label ?? sub.merchant}
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs border border-border rounded-full px-2 py-0.5 text-muted">
                    {FREQUENCY_LABELS[sub.frequency]}
                  </span>
                  {sub.status === 'possibly_cancelled' && (
                    <span className="text-xs text-warning">⚠ Check</span>
                  )}
                  {sub.status === 'paused' && <span className="text-xs text-muted">Paused in Cashe</span>}
                  {sub.status === 'cancelled' && (
                    <span className="text-xs text-muted">Cancelled</span>
                  )}
                  {sub.next_expected_date && (sub.status === 'active' || sub.status === 'possibly_cancelled') && (
                    <span className="text-xs text-muted">
                      Next {sub.next_expected_date.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-sm tabular-nums text-foreground shrink-0 ml-2">
                {sub.last_amount != null ? `S$${sub.last_amount.toFixed(2)}` : '—'}
              </span>
            </button>
          ))}
          {subs.length === 0 && (
            <p className="text-sm text-muted py-4 text-center">No subscriptions yet</p>
          )}
        </div>
      </PageCard>

      {showForm && (
        <SubscriptionForm
          onClose={() => setShowForm(false)}
          onSave={() => {
            refetch();
            setShowForm(false);
          }}
        />
      )}
    </>
  );
}
