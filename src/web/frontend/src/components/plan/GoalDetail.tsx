import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Pencil, Trash2, X, Check } from 'lucide-react';
import { api, type GoalProgress } from '@/api/client';
import { Button } from '@/components/ui/button';
import { springs } from '@/lib/motionPresets';
import { getGoalTone, formatCurrencyWhole } from '@/lib/utils';
import { useGoals } from './planHooks';

function ProgressRing({ percent, color }: { percent: number; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(percent, 100) / 100) * circ;
  const strokeDashoffset = circ - filled;
  return (
    <svg width="96" height="96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--color-border)" strokeWidth="7" />
      <motion.circle
        cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="7" strokeDasharray={circ} strokeLinecap="round"
        transform="rotate(-90 48 48)"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset }}
        transition={springs.gentle}
      />
      <text x="48" y="53" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--color-foreground)">
        {percent.toFixed(0)}%
      </text>
    </svg>
  );
}

export function GoalDetail({ goalId, onClose }: { goalId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: goals = [] } = useGoals();
  const g = goals.find((goal) => goal.id === goalId);

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['goals-v2'] });
    qc.invalidateQueries({ queryKey: ['savings-overview'] });
  };

  const contribMutation = useMutation({
    mutationFn: ({ amount, note }: { amount: number; note?: string }) => api.contributeToGoal(goalId, { amount, note }),
    onSuccess: invalidate,
  });
  const editMutation = useMutation({
    mutationFn: (data: { name?: string; target_amount?: number; target_date?: string }) => api.updateGoal(goalId, data),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteGoal(goalId),
    onSuccess: () => { invalidate(); onClose(); },
  });
  const updateContribMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { amount?: number; note?: string | null; contributed_date?: string } }) =>
      api.updateContribution(goalId, id, data),
    onSuccess: () => { invalidate(); setEditingContribId(null); },
  });
  const deleteContribMutation = useMutation({
    mutationFn: (id: number) => api.deleteContribution(goalId, id),
    onSuccess: invalidate,
  });

  const startEditContrib = (c: GoalProgress['contributions'][number]) => {
    setEditingContribId(c.id);
    setEditContribAmount(String(c.amount));
    setEditContribDate(c.contributed_date ?? '');
    setEditContribNote(c.note ?? '');
  };
  const handleSaveContrib = () => {
    if (editingContribId === null) return;
    const amount = parseFloat(editContribAmount);
    if (isNaN(amount) || amount <= 0) return;
    updateContribMutation.mutate({ id: editingContribId, data: { amount, contributed_date: editContribDate || undefined, note: editContribNote || null } });
  };
  const startEdit = () => {
    if (!g) return;
    setEditName(g.name); setEditTarget(String(g.target_amount)); setEditDate(g.target_date ?? ''); setEditing(true); setContributing(false);
  };
  const handleEdit = () => {
    const t = parseFloat(editTarget);
    if (!editName.trim() || isNaN(t)) return;
    editMutation.mutate({ name: editName, target_amount: t, target_date: editDate || undefined });
    setEditing(false);
  };
  const handleContrib = () => {
    const v = parseFloat(contribAmount);
    if (!isNaN(v) && v > 0) {
      contribMutation.mutate({ amount: v, note: contribNote || undefined });
      setContributing(false); setContribAmount(''); setContribNote('');
    }
  };

  if (!g) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">Goal</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4"><p className="text-sm text-muted">Catching up…</p></div>
      </div>
    );
  }

  const onTrackColor =
    g.on_track === 'ahead' ? 'text-success' :
    g.on_track === 'behind' ? 'text-destructive' :
    g.on_track === 'on_track' ? 'text-info' : '';
  const onTrackLabel =
    g.on_track === 'ahead' ? 'Ahead' :
    g.on_track === 'behind' ? 'Behind' :
    g.on_track === 'on_track' ? 'On track' : null;
  const { color: goalColor } = getGoalTone(g.percent);

  const sparklineData = (() => {
    const byMonth = new Map<string, number>();
    for (const c of g.contributions) byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + c.amount);
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  })();

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
        <div>
          <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{g.name}</h2>
          {g.target_date && <p className="text-xs text-muted font-mono mt-0.5">Deadline: {g.target_date}</p>}
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-start gap-4">
          <ProgressRing percent={g.percent} color={goalColor} />
          <div className="flex-1 min-w-0">
            {onTrackLabel && <span className={`text-xs font-medium ${onTrackColor}`}>{onTrackLabel}</span>}
            <p className="text-sm text-foreground mt-1">{formatCurrencyWhole(g.saved_amount)} saved of {formatCurrencyWhole(g.target_amount)}</p>
            {g.monthly_rate != null && g.monthly_rate > 0 ? (
              <p className="text-xs text-muted font-mono mt-0.5">
                ~{formatCurrencyWhole(g.monthly_rate)}/mo
                {g.months_to_target != null && ` · ${g.months_to_target.toFixed(0)} months to target`}
              </p>
            ) : g.contributions.length > 0 && (
              <p className="text-xs text-muted mt-0.5">Not enough dated contribution history yet to estimate a pace.</p>
            )}
          </div>
        </div>

        {g.contributions.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-end gap-1 h-8">
              {(() => {
                const maxAmt = Math.max(...sparklineData.map(([, v]) => v), 1);
                return sparklineData.map(([month, total]) => {
                  const h = Math.max(4, (total / maxAmt) * 32);
                  return (
                    <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        title={`${new Date(month + '-01').toLocaleString('en', { month: 'short' })}: ${formatCurrencyWhole(total)}`}
                        className="w-full rounded-sm"
                        style={{ height: `${h}px`, background: 'linear-gradient(180deg, var(--color-teal) 0%, var(--color-mint) 100%)' }}
                      />
                    </div>
                  );
                });
              })()}
            </div>
            <div className="flex gap-1">
              {sparklineData.map(([month]) => (
                <div key={month} className="flex-1 text-center text-[10px] text-muted leading-none">
                  {new Date(month + '-01').toLocaleString('en', { month: 'short' })}
                </div>
              ))}
            </div>
          </div>
        )}

        {editing ? (
          <div className="border border-border rounded-lg p-3 space-y-3">
            <p className="text-xs text-muted font-medium">Edit Goal</p>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Goal name" className="input-field block w-full" autoFocus />
            <div className="flex flex-wrap gap-2">
              <input type="number" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} placeholder="Target ($)" className="input-field w-28" />
              <div className="flex items-center gap-1">
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="input-field" title="Deadline (optional)" />
                {editDate && <Button type="button" variant="ghost" size="icon" onClick={() => setEditDate('')} aria-label="Clear deadline"><X className="w-3.5 h-3.5" /></Button>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={handleEdit} disabled={!editName.trim() || !editTarget}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setContributing(!contributing); setEditing(false); }}>+ Add Contribution</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={startEdit}><Pencil className="w-3.5 h-3.5" />Edit</Button>
            <Button type="button" variant="outline" className="min-h-11 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" />Delete
            </Button>
          </div>
        )}

        {contributing && (
          <div className="flex flex-wrap gap-2 border border-border rounded-lg p-3">
            <input type="number" value={contribAmount} onChange={(e) => setContribAmount(e.target.value)} placeholder="Amount" className="input-field w-28" autoFocus />
            <input type="text" value={contribNote} onChange={(e) => setContribNote(e.target.value)} placeholder="Note (optional)" className="input-field flex-1" />
            <Button type="button" size="sm" onClick={handleContrib} disabled={!contribAmount}>Save</Button>
          </div>
        )}

        {confirmDelete && (
          <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 space-y-2">
            <p className="text-sm text-foreground">Delete goal "{g.name}"? This also removes all of its contribution history.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        )}

        <section>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.22em] text-muted mb-2">Contribution History</p>
          {g.contributions.length === 0 ? (
            <p className="text-xs text-muted italic">No contributions yet.</p>
          ) : (
            <div className="space-y-1.5">
              {g.contributions.slice(-10).reverse().map((c) => (
                <div key={c.id}>
                  {editingContribId === c.id ? (
                    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                      <input type="number" value={editContribAmount} onChange={(e) => setEditContribAmount(e.target.value)} className="input-field w-24 !py-1 !text-xs" />
                      <input type="date" value={editContribDate} onChange={(e) => setEditContribDate(e.target.value)} className="input-field !py-1 !text-xs" />
                      <input type="text" value={editContribNote} onChange={(e) => setEditContribNote(e.target.value)} placeholder="Note" className="input-field flex-1 min-w-20 !py-1 !text-xs" />
                      <Button variant="ghost" size="icon" className="text-teal" onClick={handleSaveContrib} disabled={updateContribMutation.isPending} aria-label="Save contribution"><Check className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditingContribId(null)} aria-label="Cancel editing contribution"><X className="w-3.5 h-3.5" /></Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted shrink-0">{c.contributed_date ?? c.month}</span>
                        {c.note && <span className="text-muted italic truncate">{c.note}</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-medium text-foreground mr-1">{formatCurrencyWhole(c.amount)}</span>
                        <Button variant="ghost" size="icon" onClick={() => startEditContrib(c)} aria-label="Edit contribution"><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteContribMutation.mutate(c.id)} disabled={deleteContribMutation.isPending} aria-label="Delete contribution"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {g.contributions.length > 10 && <p className="text-xs text-muted">+{g.contributions.length - 10} more</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
