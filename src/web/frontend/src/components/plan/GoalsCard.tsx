import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { api, type GoalProgress } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectableRow } from '@/components/ui/selectable-row';
import { getGoalTone, formatCurrencyWhole } from '@/lib/utils';
import { staggerContainerVariants, staggerItemVariants } from '@/lib/motionPresets';
import { useGoals } from './planHooks';

function GoalSummaryRow({ g, onSelect }: { g: GoalProgress; onSelect: () => void }) {
  const { color } = getGoalTone(g.percent);
  const isComplete = g.status === 'completed' || g.percent >= 100;
  return (
    <SelectableRow onClick={onSelect} className="rounded-none border-b border-border last:border-b-0 py-3">
      <svg width="36" height="36" className="shrink-0">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-border)" strokeWidth="4" />
        <circle
          cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 15}
          strokeDashoffset={2 * Math.PI * 15 * (1 - Math.min(g.percent, 100) / 100)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{g.name}</span>
          {isComplete && <Badge tone="saved" className="shrink-0">Complete</Badge>}
        </div>
        <p className="text-xs text-muted font-mono">{formatCurrencyWhole(g.saved_amount)} of {formatCurrencyWhole(g.target_amount)}</p>
      </div>
      <span className="text-sm font-mono tabular-nums text-muted shrink-0">{g.percent.toFixed(0)}%</span>
    </SelectableRow>
  );
}

function AddGoalForm({ onAdd }: { onAdd: () => void }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newDate, setNewDate] = useState('');

  const createMutation = useMutation({
    mutationFn: () => api.createGoal({ name: newName, target_amount: parseFloat(newTarget), target_date: newDate || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals-v2'] });
      setNewName(''); setNewTarget(''); setNewDate('');
      onAdd();
    },
  });

  return (
    <div className="pt-4 border-t border-border space-y-3">
      <p className="text-sm font-medium text-foreground">Add goal</p>
      <div className="flex flex-wrap gap-2">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Goal name" className="input-field flex-1 min-w-40" />
        <input type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="Target ($)" className="input-field w-28" />
        <div className="flex items-center gap-1">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="input-field" title="Deadline (optional)" />
          {newDate && <Button type="button" variant="ghost" size="icon" onClick={() => setNewDate('')} aria-label="Clear deadline"><X className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>
      <Button type="button" onClick={() => createMutation.mutate()} disabled={!newName || !newTarget || createMutation.isPending}>
        {createMutation.isPending ? 'Creating…' : 'Create Goal'}
      </Button>
    </div>
  );
}

export function GoalsCard({ onSelect }: { onSelect: (id: number) => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const { data: goals = [], isLoading } = useGoals();

  return (
    <PageCard
      title="Goals"
      action={<Button variant="ghost" size="sm" onClick={() => setShowAddForm(!showAddForm)}>{showAddForm ? 'Cancel' : '+ Add goal'}</Button>}
    >
      {isLoading ? (
        <p className="text-muted text-sm py-4 text-center">Catching up…</p>
      ) : goals.length === 0 ? (
        <p className="text-muted text-sm py-4 text-center">No goals yet. Add one to start tracking your savings.</p>
      ) : (
        <motion.div variants={staggerContainerVariants} initial="initial" animate="animate">
          <AnimatePresence>
            {goals.map((g) => (
              <motion.div key={g.id} variants={staggerItemVariants} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                <GoalSummaryRow g={g} onSelect={() => onSelect(g.id)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {showAddForm && <AddGoalForm onAdd={() => setShowAddForm(false)} />}
    </PageCard>
  );
}
