import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { Transaction } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    queryKey: ['merchant-profile-v2', merchant],
    queryFn: () => api.getMerchantProfileV2(merchant),
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
      qc.invalidateQueries({ queryKey: ['merchant-profile-v2', merchant] });
      qc.invalidateQueries({ queryKey: ['merchant-intelligence-v2'] });
    },
  });

  const { data: ruleImpact } = useQuery({
    queryKey: ['merchant-rule-impact', merchant],
    queryFn: () => api.getMerchantRuleImpact(merchant),
    enabled: !!merchant,
    retry: false,
  });
  const applyRuleMutation = useMutation({
    mutationFn: () => api.applyMerchantRule(merchant),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-rule-impact', merchant] });
      qc.invalidateQueries({ queryKey: ['merchant-profile-v2', merchant] });
      qc.invalidateQueries({ queryKey: ['merchant-intelligence-v2'] });
    },
  });

  const [displayName, setDisplayName] = useState('');
  const [aliasSaved, setAliasSaved] = useState(false);
  const setAliasMutation = useMutation({
    mutationFn: (value: string) => api.setMerchantAlias(merchant, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-profile-v2', merchant] });
      qc.invalidateQueries({ queryKey: ['merchant-intelligence-v2'] });
      setAliasSaved(true);
      setTimeout(() => setAliasSaved(false), 1500);
    },
  });

  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const setNotesMutation = useMutation({
    mutationFn: (n: string) => api.setMerchantNotes(merchant, n),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-profile-v2', merchant] });
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayName(profile?.display_name ?? '');
  }, [merchant, profile?.display_name]);

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
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{profile.display_name}</h2>
          {profile.display_name !== profile.merchant && (
            <p className="text-xs text-muted mt-0.5">Recorded as “{profile.merchant}”</p>
          )}
          {profile.category && (
            <Badge variant="outline" className="mt-1">{profile.category}</Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Total Spent', value: formatSGD(profile.total.minor_units / 100) },
          { label: 'Transactions', value: String(profile.transaction_count) },
          { label: 'Average', value: formatSGD(profile.avg_amount.minor_units / 100) },
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

      {/* Display name — cosmetic only; never rewrites the recorded merchant string above */}
      <div>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Display name</p>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => setAliasMutation.mutate(displayName)}
          placeholder={profile.merchant}
          className="input-field w-full placeholder:text-muted focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/20"
        />
        {aliasSaved && (
          <p className="text-xs text-success mt-1">Saved</p>
        )}
      </div>

      {/* Category rule impact — the rule itself (merchant_overrides) is only ever
          created via "remember this category" on a transaction correction; this
          only previews/backfills it, never creates or edits the rule. */}
      {ruleImpact && (
        <div>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Category rule</p>
          <div className="bg-background rounded-lg p-3 border border-border space-y-2">
            <p className="text-sm text-foreground">New transactions from this merchant are categorized <strong>{ruleImpact.category}</strong>.</p>
            {ruleImpact.differing_count > 0 ? (
              <>
                <p className="text-sm text-muted">{ruleImpact.differing_count} past transaction{ruleImpact.differing_count === 1 ? '' : 's'} still {ruleImpact.differing_count === 1 ? 'has' : 'have'} a different category.</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-11 p-0"
                  onClick={() => applyRuleMutation.mutate()}
                  disabled={applyRuleMutation.isPending}
                >
                  Apply to {ruleImpact.differing_count} existing transaction{ruleImpact.differing_count === 1 ? '' : 's'}
                </Button>
                {applyRuleMutation.isError && <p className="text-xs text-destructive">Couldn’t apply the rule. Try again.</p>}
              </>
            ) : (
              <p className="text-sm text-muted">All existing transactions already match this rule.</p>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => setNotesMutation.mutate(notes)}
          placeholder="Add notes about this merchant…"
          className="input-field w-full h-20 placeholder:text-muted resize-none focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/20"
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
