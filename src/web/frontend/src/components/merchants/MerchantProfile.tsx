import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { Transaction } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { ChartCard } from '@/components/ui/cards';
import { useChartTheme } from '@/lib/chartTheme';
import { X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { TAG_COLORS, ALL_TAGS, formatSGD } from '@/lib/merchants';

export function MerchantProfile({
  merchant,
  onClose,
}: {
  merchant: string;
  onClose: () => void;
}) {
  const { CHART_AXIS_PROPS, CHART_TOOLTIP_STYLE, CHART_CURSOR_BAR, COLOR_TEAL } = useChartTheme();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['merchant-profile', merchant],
    queryFn: () => api.getMerchantProfile(merchant),
    enabled: !!merchant,
  });

  const { data: trend } = useQuery({
    queryKey: ['merchant-trend', merchant],
    queryFn: () => api.getMerchantTrend(merchant),
    enabled: !!merchant,
  });

  const { data: transactions } = useQuery({
    queryKey: ['merchant-transactions', merchant],
    queryFn: () => api.getTransactions({ merchant, limit: 100 }),
    enabled: !!merchant,
    staleTime: 60_000,
  });

  const setTagsMutation = useMutation({
    mutationFn: (tags: string[]) => api.setMerchantTags(merchant, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-profile', merchant] });
      qc.invalidateQueries({ queryKey: ['merchant-intelligence'] });
    },
  });

  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const setNotesMutation = useMutation({
    mutationFn: (n: string) => api.setMerchantNotes(merchant, n),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-profile', merchant] });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1500);
    },
  });

  // Syncs the editable draft from server data — profile arrives asynchronously
  // after `merchant` changes, so this must react to profile?.notes too (a
  // prior [merchant]-only dependency list left the draft stuck on the
  // previous merchant's notes once the new profile loaded).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotes(profile?.notes ?? '');
  }, [merchant, profile?.notes]);

  const toggleTag = (tag: string) => {
    if (!profile) return;
    const current = profile.tags ?? [];
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    setTagsMutation.mutate(next);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Catching up…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Merchant not found.
      </div>
    );
  }

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const chartData = (trend?.months ?? []).map((m) => ({
    month: MONTH_LABELS[parseInt(m.month.slice(5), 10) - 1] ?? m.month.slice(5),
    Total: m.total,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header — pinned above scroll area */}
      <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{profile.merchant}</h2>
          {profile.category && (
            <Badge variant="outline" className="mt-1 text-xs">{profile.category}</Badge>
          )}
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Total Spent', value: formatSGD(profile.total_sgd) },
          { label: 'Transactions', value: String(profile.transaction_count) },
          { label: 'Average', value: formatSGD(profile.avg_amount_sgd) },
          { label: 'Last Seen', value: profile.last_seen ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-background rounded-lg p-3 border border-border">
            <p className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted">{label}</p>
            <p className="text-sm font-display font-bold text-foreground mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Spend trend — ChartCard used here (Recharts does not support CSS custom properties; all values come from chartTheme.ts) */}
      {chartData.length > 0 && (
        <ChartCard title="Monthly Spend">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" {...CHART_AXIS_PROPS} />
              <YAxis hide />
              <Tooltip
                formatter={(v) => [formatSGD(Number(v ?? 0)), 'Spent']}
                contentStyle={CHART_TOOLTIP_STYLE}
                cursor={CHART_CURSOR_BAR}
              />
              <Bar dataKey="Total" fill={COLOR_TEAL} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Tags */}
      <div>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Tags</p>
        <div className="flex flex-wrap gap-2">
          {ALL_TAGS.map((tag) => {
            const active = (profile.tags ?? []).includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="cursor-pointer"
              >
                <Badge
                  variant={active ? 'default' : 'outline'}
                  className={`transition-colors ${
                    active
                      ? TAG_COLORS[tag]
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  {tag}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => setNotesMutation.mutate(notes)}
          placeholder="Add notes about this merchant…"
          className="w-full h-20 px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-border"
        />
        {notesSaved && (
          <p className="text-xs text-success mt-1">Saved</p>
        )}
      </div>

      {/* Transactions */}
      {transactions && transactions.length > 0 && (
        <div className="pt-4 border-t border-border">
          <h3 className="text-sm font-semibold mb-2">Transactions</h3>
          <div className="space-y-0.5">
            {transactions.map((tx: Transaction) => (
              <Link
                key={tx.id}
                to={`/transactions/${tx.id}`}
                className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-foreground/5 transition-colors"
              >
                <span className="text-xs text-muted">
                  {tx.transaction_date.slice(0, 10)}
                </span>
                <span
                  className={`text-xs font-medium ${
                    tx.type === 'income' ? 'text-success' : 'text-foreground'
                  }`}
                >
                  {tx.type === 'income' ? '+' : '-'}
                  {formatCurrency(tx.amount, tx.currency)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
