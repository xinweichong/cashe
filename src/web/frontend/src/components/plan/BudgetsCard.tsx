import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type BudgetProgressV2 } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { SelectableRow } from '@/components/ui/selectable-row';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getBudgetTone, formatCurrency } from '@/lib/utils';
import { staggerContainerVariants, staggerItemVariants } from '@/lib/motionPresets';

function BudgetSummaryRow({ b, onSelect }: { b: BudgetProgressV2; onSelect: () => void }) {
  const budgetAmount = b.budget_amount.minor_units / 100;
  const spent = b.spent.minor_units / 100;
  const remaining = b.remaining.minor_units / 100;
  const { color, toneName } = getBudgetTone(b.percent);
  return (
    <SelectableRow onClick={onSelect} className="flex-col items-stretch gap-1.5 rounded-none border-b border-border last:border-b-0 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground truncate">{b.label}</span>
        <span className="text-xs text-muted font-mono capitalize shrink-0">{b.period}</span>
      </div>
      <ProgressBar percent={b.percent} label={`${b.label} budget used`} tone={toneName === 'warn' ? 'warm' : toneName} />
      <div className="flex justify-between text-xs text-muted font-mono">
        <span><span style={{ color }} className="font-medium">{formatCurrency(spent)}</span> of {formatCurrency(budgetAmount)}</span>
        <span>{b.status === 'over_budget' ? `${formatCurrency(spent - budgetAmount)} over` : `${formatCurrency(remaining)} left`}</span>
      </div>
    </SelectableRow>
  );
}

function AddBudgetForm({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api.getCategories(), staleTime: 60_000 });
  const [category, setCategory] = useState<string>('__overall__');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.createBudget({ category: category === '__overall__' ? null : category, amount: parseFloat(amount), period }),
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
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="select-field flex-1 min-w-32">
          <option value="__overall__">Overall</option>
          {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="select-field">
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="input-field w-28" />
        <Button type="button" onClick={() => createMutation.mutate()} disabled={!amount || parseFloat(amount) <= 0 || createMutation.isPending}>
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function BudgetsCard({ onSelect }: { onSelect: (id: number) => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings(), staleTime: 10_000 });
  const { data: progress = [], isLoading } = useQuery({
    queryKey: ['budget-progress-v2'],
    queryFn: () => api.getBudgetProgressV2(),
    enabled: settings?.budgets_enabled === true,
    staleTime: 30_000,
  });

  return (
    <PageCard
      title="Budgets"
      action={<Button variant="ghost" size="sm" onClick={() => setShowAddForm(!showAddForm)}>{showAddForm ? 'Cancel' : '+ Add Budget'}</Button>}
    >
      {isLoading ? (
        <p className="text-muted text-sm py-4 text-center">Catching up…</p>
      ) : progress.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">No budgets yet. Add one to start tracking.</p>
      ) : (
        <motion.div variants={staggerContainerVariants} initial="initial" animate="animate">
          <AnimatePresence>
            {progress.map((b) => (
              <motion.div key={b.id} variants={staggerItemVariants} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                <BudgetSummaryRow b={b} onSelect={() => onSelect(b.id)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {showAddForm && <AddBudgetForm onAdd={() => setShowAddForm(false)} />}
    </PageCard>
  );
}
