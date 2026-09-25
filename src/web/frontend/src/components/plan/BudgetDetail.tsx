import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getBudgetTone, formatCurrency } from '@/lib/utils';
import { useBudget } from './planHooks';

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
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">Budget</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4"><p className="text-sm text-muted">Catching up…</p></div>
      </div>
    );
  }

  const budgetAmount = b.budget_amount.minor_units / 100;
  const spent = b.spent.minor_units / 100;
  const remaining = b.remaining.minor_units / 100;
  const projected = b.projected.minor_units / 100;
  const { color, toneName } = getBudgetTone(b.percent);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{b.label}</h2>
          <p className="text-xs text-muted capitalize mt-0.5">{b.period} budget</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ProgressBar percent={b.percent} label={`${b.label} budget used`} tone={toneName === 'warn' ? 'warm' : toneName} className="h-2.5" />
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Spent', value: formatCurrency(spent), color },
            { label: 'Budget', value: formatCurrency(budgetAmount) },
            { label: b.status === 'over_budget' ? 'Over' : 'Remaining', value: b.status === 'over_budget' ? formatCurrency(spent - budgetAmount) : formatCurrency(remaining) },
            { label: 'Projected', value: formatCurrency(projected) },
          ].map(({ label, value, color: c }) => (
            <div key={label} className="bg-background rounded-lg p-3 border border-border">
              <p className="text-[10px] font-mono uppercase tracking-[0.06em] text-muted">{label}</p>
              <p className="text-sm font-display font-bold mt-0.5" style={c ? { color: c } : undefined}>{value}</p>
            </div>
          ))}
        </div>

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
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 space-y-2">
            <p className="text-sm text-foreground">Delete budget "{b.label}"? Past spending isn't affected.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
