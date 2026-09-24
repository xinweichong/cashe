import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type BudgetProgressV2, type Category, type GoalProgress, type GoalProgressV2, type Trip, type RecurringTransaction } from '@/api/client';
import { PageCard, HeroCard, HighlightCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, getBudgetTone, getGoalTone, getCategoryColor } from '@/lib/utils';
import { springs, staggerContainerVariants, staggerItemVariants, slideInRightVariants } from '@/lib/motionPresets';
import { Pencil, Trash2, X, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { ActiveTripCard } from '@/components/trips/ActiveTripCard';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { SubscriptionsSection } from '@/components/subscriptions/SubscriptionsSection';
import { SubscriptionDetail } from '@/components/subscriptions/SubscriptionDetail';

function SavingsOverviewCard() {
  const { data: overview } = useQuery({
    queryKey: ['savings-overview'],
    queryFn: () => api.getSavingsOverview(),
    staleTime: 30_000,
  });

  if (!overview) return null;

  const monthLabel = new Date(overview.month + '-01').toLocaleString('en', { month: 'long', year: 'numeric' });

  return (
    <HeroCard title={`Savings — ${monthLabel}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-1">
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Saved</p>
          <p className="text-lg font-semibold text-success">${overview.savings.toFixed(0)}</p>
          <p className="text-xs text-muted font-mono">income − expenses</p>
        </div>
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Toward Goals</p>
          <p className="text-lg font-semibold text-teal">${overview.allocated_to_goals.toFixed(0)}</p>
          <p className="text-xs text-muted font-mono">manually added</p>
        </div>
        <div>
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted mb-0.5">Unallocated</p>
          <p className="text-lg font-semibold text-foreground">${overview.unallocated.toFixed(0)}</p>
          <p className="text-xs text-muted font-mono">free to allocate</p>
        </div>
      </div>
    </HeroCard>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  // Determine gradient based on color (budget tone)
  let gradient = color;
  if (color === '#FBBF24') {
    // Honey/warm gradient for active budget
    gradient = 'linear-gradient(90deg, #FBBF24 0%, #F59E0B 100%)';
  } else if (color === '#FF6B6B') {
    // Coral gradient for over budget
    gradient = 'linear-gradient(90deg, #FF6B6B 0%, #EF4444 100%)';
  } else if (color === '#FB923C') {
    // Tangerine gradient for notable
    gradient = 'linear-gradient(90deg, #FB923C 0%, #EA580C 100%)';
  } else if (color === '#34D399') {
    // Mint gradient for calm
    gradient = 'linear-gradient(90deg, #34D399 0%, #10B981 100%)';
  }

  return (
    <div className="w-full h-2 bg-foreground/10 rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ background: gradient }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent, 100)}%` }}
        transition={springs.gentle}
      />
    </div>
  );
}

function BudgetRow({
  b,
  onDelete,
  onEdit,
}: {
  b: BudgetProgressV2;
  onDelete: (id: number) => void;
  onEdit: (id: number, amount: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const budgetAmount = b.budget_amount.minor_units / 100;
  const spent = b.spent.minor_units / 100;
  const remaining = b.remaining.minor_units / 100;
  const projected = b.projected.minor_units / 100;
  const [inputVal, setInputVal] = useState(String(budgetAmount));

  const handleSave = () => {
    const v = parseFloat(inputVal);
    if (!isNaN(v) && v > 0) {
      onEdit(b.id, v);
    }
    setEditing(false);
  };

  const { color } = getBudgetTone(b.percent);

  return (
    <div className={cn('py-3 space-y-1.5 border-b border-border last:border-b-0', 'card-hover')}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{b.label}</span>
          <span className="ml-2 text-xs text-muted font-mono capitalize">{b.period}</span>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                type="number"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className={cn('input-field', 'w-24 !py-1 !text-xs')}
              />
              <Button type="button" size="sm" onClick={handleSave}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => onDelete(b.id)}>Delete</Button>
            </>
          )}
        </div>
      </div>
      <ProgressBar percent={b.percent} color={color} />
      <div className="flex justify-between text-xs text-muted font-mono">
        <span>
          <span style={{ color }} className="font-medium">${spent.toFixed(2)}</span>
          {' '}spent of ${budgetAmount.toFixed(2)}
        </span>
        <span>
          {b.status === 'over_budget'
            ? `$${(spent - budgetAmount).toFixed(2)} over`
            : `$${remaining.toFixed(2)} left · proj $${projected.toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}

function AddBudgetForm({ categories, onAdd }: { categories: Category[]; onAdd: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('__overall__');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.createBudget({
        category: category === '__overall__' ? null : category,
        amount: parseFloat(amount),
        period,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-progress'] });
      qc.invalidateQueries({ queryKey: ['budget-progress-v2'] });
      setAmount('');
      setCategory('__overall__');
      setPeriod('monthly');
      setError('');
      onAdd();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="pt-4 border-t border-border space-y-3">
      <p className="text-sm font-medium text-foreground">Add Budget</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={cn('select-field', 'flex-1 min-w-32')}
        >
          <option value="__overall__">Overall</option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="select-field"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className={cn('input-field', 'w-28 placeholder:text-muted')}
        />
        <Button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={!amount || parseFloat(amount) <= 0 || createMutation.isPending}
        >
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ProgressRing({ percent, color }: { percent: number; color: string }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(percent, 100) / 100) * circ;
  const strokeDashoffset = circ - filled;
  return (
    <svg width="88" height="88" className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
      <motion.circle
        cx="44" cy="44" r={r} fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={circ}
        strokeLinecap="round"
        transform="rotate(-90 44 44)"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset }}
        transition={springs.gentle}
      />
      <text x="44" y="48" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--color-foreground)">
        {percent.toFixed(0)}%
      </text>
    </svg>
  );
}

// GoalCard (below) and its editable forms/sparkline/mutations were built around
// v1's plain-number GoalProgress shape. Converting the query itself to the typed
// v2 endpoint without rewriting all of that display logic: unwrap Money to plain
// dollar numbers here, once, so GoalCard stays untouched. Mutations (create/edit/
// delete/contribute) stay on their v1 endpoints — no v2 mutation contract exists
// for goals yet, matching the budget-progress migration's same split.
function goalV2ToLegacy(g: GoalProgressV2): GoalProgress {
  return {
    id: g.id,
    name: g.name,
    target_amount: g.target_amount.minor_units / 100,
    saved_amount: g.saved_amount.minor_units / 100,
    target_date: g.target_date,
    status: g.status,
    percent: g.percent,
    monthly_rate: g.monthly_rate ? g.monthly_rate.minor_units / 100 : null,
    rate_window: g.rate_window,
    months_to_target: g.months_to_target,
    on_track: g.on_track,
    contributions: g.contributions.map(c => ({
      id: c.id,
      goal_id: c.goal_id,
      amount: c.amount.minor_units / 100,
      month: c.month,
      contributed_date: c.contributed_date,
      source: c.source,
      note: c.note,
      created_at: c.created_at,
    })),
  };
}

function GoalCard({ g, onContribute, onEdit, onDelete }: {
  g: GoalProgress;
  onContribute: (id: number, amount: number, note?: string) => void;
  onEdit: (id: number, data: { name?: string; target_amount?: number; target_date?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [contributing, setContributing] = useState(false);
  const [contribAmount, setContribAmount] = useState('');
  const [contribNote, setContribNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editingContribId, setEditingContribId] = useState<number | null>(null);
  const [editContribAmount, setEditContribAmount] = useState('');
  const [editContribDate, setEditContribDate] = useState('');
  const [editContribNote, setEditContribNote] = useState('');

  const qc = useQueryClient();

  const updateContribMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { amount?: number; note?: string | null; contributed_date?: string } }) =>
      api.updateContribution(g.id, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals-v2'] });
      qc.invalidateQueries({ queryKey: ['savings-overview'] });
      setEditingContribId(null);
    },
  });

  const deleteContribMutation = useMutation({
    mutationFn: (id: number) => api.deleteContribution(g.id, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals-v2'] });
      qc.invalidateQueries({ queryKey: ['savings-overview'] });
    },
  });

  const startEditContrib = (c: { id: number; amount: number; contributed_date: string | null; month: string; note: string | null }) => {
    setEditingContribId(c.id);
    setEditContribAmount(String(c.amount));
    setEditContribDate(c.contributed_date ?? '');
    setEditContribNote(c.note ?? '');
  };

  const handleSaveContrib = () => {
    if (editingContribId === null) return;
    const amount = parseFloat(editContribAmount);
    if (isNaN(amount) || amount <= 0) return;
    updateContribMutation.mutate({
      id: editingContribId,
      data: { amount, contributed_date: editContribDate || undefined, note: editContribNote || null },
    });
  };

  const startEdit = () => {
    setEditName(g.name);
    setEditTarget(String(g.target_amount));
    setEditDate(g.target_date ?? '');
    setEditing(true);
    setContributing(false);
  };

  const handleEdit = () => {
    const t = parseFloat(editTarget);
    if (!editName.trim() || isNaN(t)) return;
    onEdit(g.id, { name: editName, target_amount: t, target_date: editDate || undefined });
    setEditing(false);
  };

  const handleContrib = () => {
    const v = parseFloat(contribAmount);
    if (!isNaN(v) && v > 0) {
      onContribute(g.id, v, contribNote || undefined);
      setContributing(false);
      setContribAmount('');
      setContribNote('');
    }
  };

  const onTrackColor =
    g.on_track === 'ahead'    ? 'text-success' :
    g.on_track === 'behind'   ? 'text-destructive' :
    g.on_track === 'on_track' ? 'text-info' : '';

  const onTrackLabel =
    g.on_track === 'ahead'    ? 'Ahead 🟢' :
    g.on_track === 'behind'   ? 'Behind 🔴' :
    g.on_track === 'on_track' ? 'On Track ✓' : null;

  const { color: goalColor } = getGoalTone(g.percent);
  const isComplete = g.status === 'completed' || g.percent >= 100;

  // Compute once and reuse in both sparkline bar and label rows
  const sparklineData = (() => {
    const byMonth = new Map<string, number>();
    for (const c of g.contributions) {
      byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + c.amount);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6);
  })();

  if (editing) {
    return (
      <div className="py-4 border-b border-border last:border-b-0 space-y-2">
        <p className="text-xs text-muted font-medium">Edit Goal</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Goal name"
            className="input-field flex-1 min-w-36"
            autoFocus
          />
          <input
            type="number"
            value={editTarget}
            onChange={(e) => setEditTarget(e.target.value)}
            placeholder="Target ($)"
            className="input-field w-28"
          />
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="input-field"
              title="Deadline (optional)"
            />
            {editDate && (
              <Button type="button" variant="ghost" size="icon" onClick={() => setEditDate('')} aria-label="Clear deadline">
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleEdit} disabled={!editName.trim() || !editTarget}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const goalCardContent = (
    <div className={cn('space-y-3', !isComplete && 'py-4 border-b border-border last:border-b-0', 'card-hover')}>
      <div className="flex items-start gap-4">
        <ProgressRing percent={g.percent} color={goalColor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{g.name}</p>
              {g.target_date && (
                <p className="text-xs text-muted font-mono">Deadline: {g.target_date}</p>
              )}
            </div>
            {onTrackLabel && (
              <span className={`text-xs shrink-0 ${onTrackColor}`}>{onTrackLabel}</span>
            )}
          </div>
          <p className="text-sm text-foreground mt-1">
            ${g.saved_amount.toFixed(0)} saved of ${g.target_amount.toFixed(0)}
          </p>
          {g.monthly_rate != null && g.monthly_rate > 0 ? (
            <p className="text-xs text-muted font-mono mt-0.5">
              ~${g.monthly_rate.toFixed(0)}/mo
              {g.months_to_target != null && ` · ${g.months_to_target.toFixed(0)} months to target`}
            </p>
          ) : g.contributions.length > 0 && (
            <p className="text-xs text-muted mt-0.5">Not enough dated contribution history yet to estimate a pace.</p>
          )}
        </div>
      </div>

      {/* Sparkline: last 6 months contributions aggregated by month */}
      {g.contributions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-end gap-1 h-8">
            {(() => {
              const maxAmt = Math.max(...sparklineData.map(([, v]) => v), 1);
              return sparklineData.map(([month, total]) => {
                const h = Math.max(4, (total / maxAmt) * 32);
                const label = new Date(month + '-01').toLocaleString('en', { month: 'short' });
                return (
                  <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      title={`${label}: $${total.toFixed(0)}`}
                      className="w-full rounded-sm transition-colors"
                      style={{
                        height: `${h}px`,
                        background: 'linear-gradient(180deg, #00D4AA 0%, #00B896 100%)',
                      }}
                    />
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex gap-1">
            {sparklineData.map(([month]) => {
              const label = new Date(month + '-01').toLocaleString('en', { month: 'short' });
              return (
                <div key={month} className="flex-1 text-center text-[10px] text-muted leading-none">
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contribution history */}
      {g.contributions.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted">Contribution History</p>
          {g.contributions.slice(-6).reverse().map((c) => (
            <div key={c.id}>
              {editingContribId === c.id ? (
                <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                  <input
                    type="number"
                    value={editContribAmount}
                    onChange={(e) => setEditContribAmount(e.target.value)}
                    className="input-field w-24 !py-1 !text-xs"
                  />
                  <input
                    type="date"
                    value={editContribDate}
                    onChange={(e) => setEditContribDate(e.target.value)}
                    className="input-field !py-1 !text-xs"
                  />
                  <input
                    type="text"
                    value={editContribNote}
                    onChange={(e) => setEditContribNote(e.target.value)}
                    placeholder="Note"
                    className="input-field flex-1 min-w-20 !py-1 !text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-teal"
                    onClick={handleSaveContrib}
                    disabled={updateContribMutation.isPending}
                    aria-label="Save contribution"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingContribId(null)}
                    aria-label="Cancel editing contribution"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">
                      {c.contributed_date ?? c.month}
                    </span>
                    {c.note && <span className="text-muted italic truncate max-w-28">{c.note}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-foreground mr-1">${c.amount.toFixed(0)}</span>
                    <Button variant="ghost" size="icon" onClick={() => startEditContrib(c)} aria-label="Edit contribution">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteContribMutation.mutate(c.id)} disabled={deleteContribMutation.isPending} aria-label="Delete contribution">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {g.contributions.length > 6 && (
            <p className="text-xs text-muted">+{g.contributions.length - 6} more</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted italic">No contributions yet.</p>
      )}

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => { setContributing(!contributing); setEditing(false); }}>
          + Add Contribution
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={startEdit}>
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (window.confirm(`Delete goal "${g.name}"? This will also remove all contribution history.`)) {
              onDelete(g.id);
            }
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
      </div>

      {contributing && (
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            type="number"
            value={contribAmount}
            onChange={(e) => setContribAmount(e.target.value)}
            placeholder="Amount"
            className="input-field w-28"
          />
          <input
            type="text"
            value={contribNote}
            onChange={(e) => setContribNote(e.target.value)}
            placeholder="Note (optional)"
            className="input-field flex-1"
          />
          <Button type="button" size="sm" onClick={handleContrib} disabled={!contribAmount}>
            Save
          </Button>
        </div>
      )}
    </div>
  );

  if (isComplete) {
    return (
      <div className="py-4 border-b border-border last:border-b-0">
        <HighlightCard title="Goal Complete">
          {goalCardContent}
        </HighlightCard>
      </div>
    );
  }

  return goalCardContent;
}

function GoalsSection() {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newDate, setNewDate] = useState('');

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals-v2'],
    queryFn: async () => (await api.getGoalsV2()).map(goalV2ToLegacy),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createGoal({
        name: newName,
        target_amount: parseFloat(newTarget),
        target_date: newDate || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals-v2'] });
      setShowAddForm(false);
      setNewName('');
      setNewTarget('');
      setNewDate('');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; target_amount?: number; target_date?: string } }) =>
      api.updateGoal(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals-v2'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals-v2'] }),
  });

  const contribMutation = useMutation({
    mutationFn: ({ id, amount, note }: { id: number; amount: number; note?: string }) =>
      api.contributeToGoal(id, { amount, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals-v2'] }),
  });

  return (
    <PageCard
      title="Goals"
      action={
        <Button variant="ghost" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Goal'}
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-muted text-sm py-4 text-center">Catching up…</p>
      ) : goals.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          No goals yet. Add one to start tracking your savings.
        </p>
      ) : (
        <motion.div variants={staggerContainerVariants} initial="initial" animate="animate">
          <AnimatePresence>
            {goals.map((g) => (
              <motion.div
                key={g.id}
                variants={staggerItemVariants}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
              >
                <GoalCard
                  g={g}
                  onContribute={(id, amount, note) => contribMutation.mutate({ id, amount, note })}
                  onEdit={(id, data) => editMutation.mutate({ id, data })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {showAddForm && (
        <div className="pt-4 border-t border-border space-y-3">
          <p className="text-sm font-medium text-foreground">Add Goal</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Goal name"
              className="input-field flex-1 min-w-40"
            />
            <input
              type="number"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="Target ($)"
              className="input-field w-28"
            />
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="input-field"
                title="Deadline (optional)"
              />
              {newDate && (
                <Button type="button" variant="ghost" size="icon" onClick={() => setNewDate('')} aria-label="Clear deadline">
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!newName || !newTarget || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Goal'}
          </Button>
        </div>
      )}
    </PageCard>
  );
}

// ── Recurring ─────────────────────────────────────────────────────────────────

function RecurringSection() {
  const { data: recurring = [], isLoading } = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.getRecurring(),
    staleTime: 5 * 60 * 1000,
  });

  const frequencyBadgeClass = (frequency: string) => {
    if (frequency === 'monthly') return 'bg-teal/10 text-teal';
    if (frequency === 'weekly') return 'bg-info/10 text-info';
    return 'bg-foreground/10 text-muted';
  };

  return (
    <PageCard title="Recurring Transactions">
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : recurring.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">
          No recurring patterns detected yet — patterns appear after 2+ consistent transactions
        </p>
      ) : (
        <div className="divide-y divide-border">
          {recurring.map((r: RecurringTransaction) => {
            const catColor = getCategoryColor(r.category);
            return (
            <div key={r.id} className="flex items-center gap-3 py-3">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                style={{ background: `${catColor}33`, color: catColor }}
              >
                {r.category}
              </span>
              <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                {r.merchant}
              </span>
              <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0', frequencyBadgeClass(r.frequency))}>
                {r.frequency}
              </span>
              <span className="text-sm font-mono text-foreground shrink-0">
                ~${r.avg_amount.toFixed(0)}/{r.frequency === 'weekly' ? 'wk' : r.frequency === 'biweekly' ? '2wk' : 'mo'}
              </span>
              <span className="text-xs text-muted font-mono shrink-0 hidden sm:block">
                {r.last_seen}
              </span>
            </div>
            );
          })}
        </div>
      )}
    </PageCard>
  );
}

// ── Trips ─────────────────────────────────────────────────────────────────────

const TX_PAGE_SIZE = 20;

function TripRow({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [delistingId, setDelistingId] = useState<number | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['trip-summary', trip.id],
    queryFn: () => api.getTripSummaryV2(trip.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  const { data: txs = [] } = useQuery({
    queryKey: ['trip-transactions', trip.id],
    queryFn: () => api.getTripTransactions(trip.id, 1000),
    enabled: expanded,
    staleTime: 30_000,
  });

  const activateMutation = useMutation({
    mutationFn: () => api.activateTrip(trip.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trips-active'] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => api.deactivateTrip(trip.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trips-active'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTrip(trip.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });

  const delistMutation = useMutation({
    mutationFn: (txId: number) => api.delistTransaction(trip.id, txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-transactions', trip.id] });
      qc.invalidateQueries({ queryKey: ['trip-summary', trip.id] });
      qc.invalidateQueries({ queryKey: ['trip-membership', trip.id] });
    },
  });

  const isActive = trip.status === 'active';
  const isPendingToggle = activateMutation.isPending || deactivateMutation.isPending;

  const handleToggle = () => {
    if (isPendingToggle) return;
    if (isActive) deactivateMutation.mutate();
    else activateMutation.mutate();
  };

  const totalTxPages = Math.ceil(txs.length / TX_PAGE_SIZE);
  const pageTxs = txs.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);
  const dateLabel = trip.end_date
    ? `${trip.start_date} → ${trip.end_date}`
    : trip.start_date;

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => { setExpanded((v) => !v); if (expanded) setTxPage(1); }}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">{trip.name}</p>
          <p className="text-xs text-muted">
            {trip.destination ? `${trip.destination} · ` : ''}{dateLabel}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted hidden sm:inline">Auto-assign</span>
          <button
            onClick={handleToggle}
            disabled={isPendingToggle}
            className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${
              isActive ? 'toggle-on' : 'bg-foreground/20'
            }`}
            title={isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                isActive ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="text-destructive shrink-0"
          onClick={() => { if (confirm(`Delete trip "${trip.name}"?`)) deleteMutation.mutate(); }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {expanded && (
        <>
          <div className="mt-3 ml-9 space-y-3">
            {summary && (
              <p className="text-xs text-muted font-mono">
                S${(summary.total.minor_units / 100).toFixed(2)} · {summary.transaction_count} transactions ·
                S${(summary.daily_average.minor_units / 100).toFixed(2)}/day
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold font-mono uppercase tracking-[0.22em] text-muted">Transactions</p>
              {totalTxPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Previous page"
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))} disabled={txPage === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted">{txPage}/{totalTxPages}</span>
                  <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Next page"
                    onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))} disabled={txPage === totalTxPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {txs.length === 0 ? (
            <p className="ml-9 mt-1 text-xs text-muted">Nothing captured this period.</p>
          ) : (
            <div className="mt-2 border-t border-border">
              {pageTxs.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  readOnly
                  onRemove={() => {
                    setDelistingId(tx.id);
                    delistMutation.mutate(tx.id, { onSettled: () => setDelistingId(null) });
                  }}
                  removeDisabled={delistingId === tx.id}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TripsSection() {
  const qc = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newEndDate, setNewEndDate] = useState('');
  const [newDest, setNewDest] = useState('');

  const { data: trips = [], isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.getTrips(),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const trip = await api.createTrip({
        name: newName,
        start_date: newStartDate,
        destination: newDest || undefined,
      });
      if (newEndDate) {
        await api.updateTrip(trip.id, { end_date: newEndDate }).catch(() => {});
      }
      return trip;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      setShowCreateForm(false);
      setNewName('');
      setNewDest('');
      setNewEndDate('');
    },
  });

  return (
    <>
      <ActiveTripCard showEndButton />
      <PageCard
        title="Trips"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            {showCreateForm ? 'Cancel' : '+ New Trip'}
          </Button>
        }
      >
        {showCreateForm && (
          <div className="space-y-3 pb-4 border-b border-border mb-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Trip name"
                className="input-field flex-1 min-w-40"
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted font-mono">Start date</span>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={(e) => setNewStartDate(e.target.value)}
                  className="input-field"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newDest}
                onChange={(e) => setNewDest(e.target.value)}
                placeholder="Destination (optional)"
                className="input-field flex-1 min-w-32"
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted font-mono">End date (optional)</span>
                <input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  className="input-field"
                />
              </label>
            </div>
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!newName || !newStartDate || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Trip'}
            </Button>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24" />
        ) : trips.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">
            No trips yet. Create one to start grouping transactions.
          </p>
        ) : (
          trips.map((trip) => <TripRow key={trip.id} trip={trip} />)
        )}
      </PageCard>
    </>
  );
}

// ── FinancePage ───────────────────────────────────────────────────────────────

export function FinancePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showAddForm, setShowAddForm] = useState(false);
  const [search, setSearch] = useSearchParams();
  const requestedSubId = Number(search.get('subscription'));
  const selectedSubId = Number.isSafeInteger(requestedSubId) && requestedSubId > 0 ? requestedSubId : null;
  const setSelectedSubId = (id: number | null) => {
    const next = new URLSearchParams(search);
    if (id === null) next.delete('subscription'); else next.set('subscription', String(id));
    setSearch(next);
  };

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 10_000,
  });

  const { data: progress = [], isLoading } = useQuery({
    queryKey: ['budget-progress-v2'],
    queryFn: () => api.getBudgetProgressV2(),
    enabled: settings?.budgets_enabled === true,
    staleTime: 30_000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteBudget(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-progress'] });
      qc.invalidateQueries({ queryKey: ['budget-progress-v2'] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) =>
      api.updateBudget(id, amount),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-progress'] });
      qc.invalidateQueries({ queryKey: ['budget-progress-v2'] });
    },
  });

  if (!settings) return null;

  if (!settings.budgets_enabled && !settings.goals_enabled && !settings.trips_enabled && !settings.subscriptions_enabled && !settings.recurring_enabled) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-48 text-center gap-3">
        <p className="text-muted text-sm">
          Enable Budgets, Goals, Trips, Subscriptions, or Recurring in Settings to get started.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="text-sm underline underline-offset-2 text-foreground/70 hover:text-foreground"
        >
          Go to Settings →
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Finance grid content */}
      <div className={`flex-1 min-w-0 overflow-y-auto md:overflow-hidden p-4 space-y-4 md:grid md:gap-4 md:p-6 md:space-y-0 page-grid-finance ${selectedSubId != null ? 'hidden md:block' : ''}`}>

      {/* ── Top area: title ── */}
      <div className="area-top">
        <Link className="text-teal min-h-11 inline-flex items-center" to="/plan">Upcoming timeline</Link>
        <div className="flex flex-col gap-1 pb-5 border-b border-border">
          <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
            Finance
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">
            Budgets, goals, trips.
          </h1>
        </div>
      </div>

      {/* ── Left panel: expense-side (budgets + subscriptions + trips) ── */}
      {(settings.budgets_enabled || settings.subscriptions_enabled || settings.trips_enabled || settings.recurring_enabled) ? (
        <div
          className="area-left grid-scroll-panel space-y-4"
          style={!settings.goals_enabled ? { gridColumn: '1 / -1' } : undefined}
        >
          {settings.budgets_enabled && (
            <PageCard
              title="Budgets"
              action={
                <Button variant="ghost" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                  {showAddForm ? 'Cancel' : '+ Add Budget'}
                </Button>
              }
            >
              {isLoading ? (
                <p className="text-muted text-sm py-4 text-center">Catching up…</p>
              ) : progress.length === 0 ? (
                <p className="text-muted text-sm py-4 text-center">
                  No budgets yet. Add one to start tracking.
                </p>
              ) : (
                <motion.div variants={staggerContainerVariants} initial="initial" animate="animate">
                  <AnimatePresence>
                    {progress.map((b) => (
                      <motion.div
                        key={b.id}
                        variants={staggerItemVariants}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      >
                        <BudgetRow
                          b={b}
                          onDelete={(id) => deleteMutation.mutate(id)}
                          onEdit={(id, amount) => editMutation.mutate({ id, amount })}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
              {showAddForm && (
                <AddBudgetForm
                  categories={categories}
                  onAdd={() => setShowAddForm(false)}
                />
              )}
            </PageCard>
          )}
          {settings.subscriptions_enabled && (
            <SubscriptionsSection
              selectedSubId={selectedSubId}
              onSelectSub={setSelectedSubId}
            />
          )}
          {settings.recurring_enabled && <RecurringSection />}
          {settings.trips_enabled && <TripsSection />}
        </div>
      ) : (
        <div className="area-left" />
      )}

      {/* ── Right panel: income-side (savings + goals) ── */}
      {settings.goals_enabled ? (
        <div
          className="area-right grid-scroll-panel space-y-4"
          style={(!settings.budgets_enabled && !settings.subscriptions_enabled && !settings.trips_enabled)
            ? { gridColumn: '1 / -1' }
            : undefined}
        >
          <SavingsOverviewCard />
          <GoalsSection />
        </div>
      ) : (
        <div className="area-right" />
      )}

      </div>{/* end flex-1 finance grid */}

      {/* Subscription detail panel — slides in from right, mirrors MerchantsPage */}
      <AnimatePresence>
        {selectedSubId != null && (
          <motion.div
            className="w-full md:w-[420px] border-l border-border bg-card flex-shrink-0 overflow-hidden"
            variants={slideInRightVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <SubscriptionDetail
              subId={selectedSubId}
              onClose={() => setSelectedSubId(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
