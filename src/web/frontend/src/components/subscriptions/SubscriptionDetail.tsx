import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Ban, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChartCard } from '@/components/ui/cards';
import { useChartTheme } from '@/lib/chartTheme';
import { api, type Subscription, type Transaction, type UpcomingTransaction } from '@/api/client';
import { SubscriptionForm } from './SubscriptionForm';

interface SubscriptionDetailProps {
  subId: number;
  onClose: () => void;
}

const FREQUENCY_LABELS: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const FREQUENCY_MONTHLY_FACTOR: Record<Subscription['frequency'], number> = {
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

export function SubscriptionDetail({ subId, onClose }: SubscriptionDetailProps) {
  const { CHART_AXIS_PROPS, CHART_CURSOR_BAR, CHART_TOOLTIP_STYLE, COLOR_TEAL } = useChartTheme();
  const qc = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [adoptPrompt, setAdoptPrompt] = useState<{ txMerchant: string } | null>(null);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSelectedId, setLinkSelectedId] = useState('');

  const { data: list } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.getSubscriptions(),
  });
  const sub = list?.subscriptions.find((s) => s.id === subId);

  const { data: history = [] } = useQuery({
    queryKey: ['subscription-history', subId],
    queryFn: () => api.getSubscriptionHistory(subId, 50),
    enabled: sub != null,
  });

  const { data: upcoming = [] } = useQuery({
    queryKey: ['subscription-upcoming', subId],
    queryFn: () => api.getSubscriptionUpcoming(subId),
    enabled: sub != null,
  });

  // Transactions for this merchant — used for link-past-transaction picker
  const { data: merchantTxs = [] } = useQuery({
    queryKey: ['merchant-transactions-for-link', sub?.merchant],
    queryFn: () => api.getTransactions({ merchant: sub!.merchant, limit: 100 }),
    enabled: sub != null,
    staleTime: 60_000,
  });

  // Transactions for upcoming match picker (last 90 days, all merchants)
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: recentTxs = [] } = useQuery({
    queryKey: ['transactions', 'match-picker', ninetyDaysAgo, today],
    queryFn: () =>
      api.getTransactions({ start_date: ninetyDaysAgo, end_date: today, limit: 50 }) as Promise<Transaction[]>,
    enabled: sub != null,
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.updateSubscription(subId, { status: 'cancelled' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setConfirmCancel(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteSubscription(subId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (upcomingId: number) => api.dismissUpcoming(subId, upcomingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription-upcoming', subId] }),
  });

  const matchMutation = useMutation({
    mutationFn: ({ upcomingId, txId }: { upcomingId: number; txId: number }) =>
      api.matchUpcoming(subId, upcomingId, txId).then(() => txId),
    onSuccess: (txId) => {
      qc.invalidateQueries({ queryKey: ['subscription-upcoming', subId] });
      qc.invalidateQueries({ queryKey: ['subscription-history', subId] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      const matchedTx = recentTxs.find((t) => t.id === txId);
      if (matchedTx && sub && matchedTx.merchant && matchedTx.merchant !== sub.merchant) {
        setAdoptPrompt({ txMerchant: matchedTx.merchant });
      }
    },
  });

  const adoptMutation = useMutation({
    mutationFn: (merchant: string) => api.updateSubscription(subId, { merchant }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setAdoptPrompt(null);
    },
  });

  const linkMutation = useMutation({
    mutationFn: (txId: number) => api.linkTransaction(subId, txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription-history', subId] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setLinkSelectedId('');
    },
  });

  const linkedTxIds = useMemo(() => new Set(history.map((t: Transaction) => t.id)), [history]);

  // Filter out already-linked transactions from the link picker
  const linkCandidates = useMemo(
    () => (merchantTxs as Transaction[]).filter((t) => !linkedTxIds.has(t.id)),
    [merchantTxs, linkedTxIds],
  );

  const pendingUpcomings = upcoming.filter((u: UpcomingTransaction) => u.status === 'pending');

  const trendData = useMemo(
    () =>
      history
        .slice(0, 6)
        .map((t: Transaction) => ({
          date: t.transaction_date.slice(0, 10),
          amount: Number((t.amount * t.exchange_rate).toFixed(2)),
        }))
        .reverse(),
    [history],
  );

  const monthlyCost =
    sub && sub.last_amount != null
      ? sub.last_amount * FREQUENCY_MONTHLY_FACTOR[sub.frequency]
      : null;

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header — pinned */}
        <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold font-display tracking-tight text-foreground">
              {sub?.label ?? sub?.merchant ?? 'Subscription'}
            </h2>
            {sub && (
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                <span>{FREQUENCY_LABELS[sub.frequency]}</span>
                {sub.status === 'possibly_cancelled' && (
                  <span className="text-warning">⚠ Possibly cancelled</span>
                )}
                {sub.status === 'cancelled' && <span>Cancelled</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action bar — persistent chrome */}
        {sub && (
          <div className="shrink-0 border-b border-border">
            {confirmCancel ? (
              <div className="flex items-center justify-between px-4 py-2 gap-3">
                <span className="text-sm text-foreground">Cancel this subscription?</span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="px-3 py-1 text-xs text-muted hover:text-foreground"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    className="px-3 py-1 text-xs bg-warning text-background rounded-md disabled:opacity-40"
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Confirm'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 px-4 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowEdit(true)}
                  aria-label="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                {sub.status !== 'cancelled' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-warning"
                    onClick={() => setConfirmCancel(true)}
                    aria-label="Cancel subscription"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!sub && <p className="text-sm text-muted">Catching up…</p>}

          {sub && (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Monthly', value: monthlyCost != null ? `S$${monthlyCost.toFixed(2)}` : '—' },
                  { label: 'Last charge', value: sub.last_amount != null ? `S$${sub.last_amount.toFixed(2)}` : '—' },
                  { label: 'Next charge', value: sub.next_expected_date ? sub.next_expected_date.slice(0, 10) : '—' },
                  { label: 'History', value: `${history.length} linked` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-background rounded-lg p-3 border border-border">
                    <p className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted">{label}</p>
                    <p className="text-sm font-display font-bold text-foreground mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {adoptPrompt && (
                <div className="flex items-center justify-between p-3 rounded-md bg-warning/10 border border-warning/30 text-xs">
                  <span className="text-foreground">
                    Transaction merchant is <strong>{adoptPrompt.txMerchant}</strong>. Update subscription for future auto-matching?
                  </span>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => adoptMutation.mutate(adoptPrompt.txMerchant)}
                      className="text-foreground underline underline-offset-2"
                    >
                      Yes
                    </button>
                    <button onClick={() => setAdoptPrompt(null)} className="text-muted">
                      No
                    </button>
                  </div>
                </div>
              )}

              {trendData.length >= 2 && (
                <ChartCard title="Recent charges">
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" {...CHART_AXIS_PROPS} />
                      <YAxis hide />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_BAR} />
                      <Bar dataKey="amount" fill={COLOR_TEAL} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              {pendingUpcomings.length > 0 && (
                <section>
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">
                    Upcoming
                  </p>
                  <div className="divide-y divide-border">
                    {pendingUpcomings.map((u: UpcomingTransaction) => (
                      <UpcomingRow
                        key={u.id}
                        upcoming={u}
                        recentTxs={recentTxs}
                        onMatch={(txId) => matchMutation.mutate({ upcomingId: u.id, txId })}
                        onDismiss={() => dismissMutation.mutate(u.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* History + link past transactions */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted">
                    History
                  </p>
                  <button
                    onClick={() => setShowLinkPicker((v) => !v)}
                    className="text-xs text-muted hover:text-foreground underline underline-offset-2"
                  >
                    {showLinkPicker ? 'Hide' : 'Link past transaction'}
                  </button>
                </div>

                {showLinkPicker && (
                  <div className="mb-3 p-3 rounded-md border border-border bg-background space-y-2">
                    <p className="text-xs text-muted">
                      Select a past transaction from <strong className="text-foreground">{sub.merchant}</strong> to mark as part of this subscription.
                    </p>
                    {linkCandidates.length === 0 ? (
                      <p className="text-xs text-muted py-1">No unlinked transactions found for this merchant.</p>
                    ) : (
                      <div className="flex gap-2">
                        <select
                          value={linkSelectedId}
                          onChange={(e) => setLinkSelectedId(e.target.value)}
                          className="select-field flex-1 min-w-0"
                        >
                          <option value="">Choose transaction…</option>
                          {linkCandidates.map((tx: Transaction) => (
                            <option key={tx.id} value={String(tx.id)}>
                              {tx.transaction_date.slice(0, 10)} · S${(tx.amount * tx.exchange_rate).toFixed(2)} · {tx.merchant ?? '—'}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            if (linkSelectedId) linkMutation.mutate(Number(linkSelectedId));
                          }}
                          disabled={!linkSelectedId || linkMutation.isPending}
                          className="btn-action disabled:opacity-40 shrink-0"
                        >
                          {linkMutation.isPending ? 'Linking…' : 'Link'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {history.length === 0 ? (
                  <p className="text-sm text-muted py-2">No matched transactions yet.</p>
                ) : (
                  <div className="space-y-0.5">
                    {history.map((tx: Transaction) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-foreground/5 transition-colors"
                      >
                        <span className="text-xs text-muted">{tx.transaction_date.slice(0, 10)}</span>
                        <span className="text-xs font-medium text-foreground tabular-nums">
                          S${(tx.amount * tx.exchange_rate).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {confirmDelete && (
                <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 space-y-2">
                  <p className="text-sm text-foreground">
                    Delete this subscription permanently? Matched transactions are not deleted.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1.5 text-sm text-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="px-3 py-1.5 text-sm bg-destructive text-white rounded-md disabled:opacity-40"
                    >
                      {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showEdit && sub && (
        <SubscriptionForm
          initial={sub}
          onClose={() => setShowEdit(false)}
          onSave={() => {
            setShowEdit(false);
            qc.invalidateQueries({ queryKey: ['subscriptions'] });
          }}
        />
      )}
    </>
  );
}

interface UpcomingRowProps {
  upcoming: UpcomingTransaction;
  recentTxs: Transaction[];
  onMatch: (txId: number) => void;
  onDismiss: () => void;
}

function UpcomingRow({ upcoming, recentTxs, onMatch, onDismiss }: UpcomingRowProps) {
  const [selectedTxId, setSelectedTxId] = useState('');
  const candidates = recentTxs.slice(0, 20);

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">
            Expected {upcoming.expected_date.slice(0, 10)}
          </span>
          {upcoming.expected_amount != null && (
            <span className="text-xs text-muted">S${upcoming.expected_amount.toFixed(2)}</span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-muted hover:text-foreground underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
      <div className="flex gap-2">
        <select
          value={selectedTxId}
          onChange={(e) => setSelectedTxId(e.target.value)}
          className="select-field flex-1 min-w-0"
        >
          <option value="">Match to transaction…</option>
          {candidates.map((tx) => (
            <option key={tx.id} value={String(tx.id)}>
              {tx.transaction_date.slice(0, 10)} · S${(tx.amount * tx.exchange_rate).toFixed(2)} · {tx.merchant ?? '—'}
            </option>
          ))}
        </select>
        <button
          onClick={() => { if (selectedTxId) onMatch(Number(selectedTxId)); }}
          disabled={!selectedTxId}
          className="btn-action disabled:opacity-40 shrink-0"
        >
          Match
        </button>
      </div>
    </div>
  );
}
