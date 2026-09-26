import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getBudgetTone, formatCurrency } from '@/lib/utils';
import { useBudget } from './planHooks';
import { ConfirmDestructive, DetailHeader, DetailLoading, StatTiles } from '@/components/ui/detail-panel';

export function BudgetDetail({ budgetId, onClose }: { budgetId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const b = useBudget(budgetId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inputVal, setInputVal] = useState('');

  const editMutation = useMutation({
    mutationFn: (amount: number) => api.updateBudget(budgetId, amount),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-progress'] });
      qc.invalidateQueries({ queryKey: ['budget-progress-v2'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBudget(budgetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-progress'] });
      qc.invalidateQueries({ queryKey: ['budget-progress-v2'] });
      onClose();
    },
  });

  if (!b) {
    return <DetailLoading title="Budget" onClose={onClose} />;
  }

  const budgetAmount = b.budget_amount.minor_units / 100;
  const spent = b.spent.minor_units / 100;
  const remaining = b.remaining.minor_units / 100;
  const projected = b.projected.minor_units / 100;
  const { color, toneName } = getBudgetTone(b.percent);

  return (
    <div className="flex flex-col h-full">
      <DetailHeader title={b.label} subtitle={<p className="text-xs text-muted capitalize mt-0.5">{b.period} budget</p>} onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ProgressBar percent={b.percent} label={`${b.label} budget used`} tone={toneName === 'warn' ? 'warm' : toneName} className="h-2.5" />
        <StatTiles items={[
            { label: 'Spent', value: formatCurrency(spent), color },
            { label: 'Budget', value: formatCurrency(budgetAmount) },
            { label: b.status === 'over_budget' ? 'Over' : 'Remaining', value: b.status === 'over_budget' ? formatCurrency(spent - budgetAmount) : formatCurrency(remaining) },
            { label: 'Projected', value: formatCurrency(projected) },]} />

        {editing ? (
          <div className="border border-border rounded-lg p-3 space-y-3">
            <label className="block text-sm">Budget amount
              <input
                autoFocus
                type="number"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className="input-field min-h-11 block w-full mt-1"
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => { const v = parseFloat(inputVal); if (!isNaN(v) && v > 0) editMutation.mutate(v); }}
                disabled={editMutation.isPending}
              >
                {editMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => { setInputVal(String(budgetAmount)); setEditing(true); }}>Edit amount</Button>
            <Button variant="outline" className="min-h-11 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>Delete budget</Button>
          </div>
        )}

        {confirmDelete && (
          <ConfirmDestructive
            message={`Delete budget "${b.label}"? Past spending isn't affected.`}
            pending={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </div>
  );
}
