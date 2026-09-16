import { useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { HeroCard, PageCard } from '@/components/ui/cards';
import { HeroAmount } from '@/components/ui/HeroAmount';
import { TrendLine } from '@/components/charts/TrendLine';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { getCategoryColor, formatCurrency, formatDate } from '@/lib/utils';
import {
  FIXTURE_TRANSACTIONS, FIXTURE_CATEGORIES, categoryTotals, dailyTotals, monthTotal,
  type FixtureTransaction,
} from './homeFixtures';

// Increment 2 prototype journey: Home -> select category -> inspect
// transactions -> edit -> return, using shared components (HeroCard,
// HeroAmount, TrendLine, CategoryDonut, Sheet, Button) and isolated fixture
// state — no backend, no auth. Mounted at /dev/preview/home (dev-only, see
// App.tsx). The exit gate is demonstrated clarity and a chart that visibly
// updates after an edit, not final page composition or copy.

export function HomePrototype() {
  const [transactions, setTransactions] = useState<FixtureTransaction[]>(FIXTURE_TRANSACTIONS);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [evidenceCategory, setEvidenceCategory] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const totals = useMemo(() => categoryTotals(transactions), [transactions]);
  const trend = useMemo(() => dailyTotals(transactions), [transactions]);
  const total = useMemo(() => monthTotal(transactions), [transactions]);

  const evidenceItems = evidenceCategory
    ? transactions.filter((t) => t.category === evidenceCategory)
    : [];
  const editing = editingId != null ? transactions.find((t) => t.id === editingId) ?? null : null;

  function closeSheet() {
    setEvidenceCategory(null);
    setEditingId(null);
  }

  function saveEdit(id: number, category: string, minorUnits: number) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, category, minorUnits } : t)));
    setEditingId(null);
    closeSheet();
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8 text-base" data-testid="home-prototype">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Your money briefing</h1>
          <p className="text-muted text-sm">Through 10 Sep · Asia/Singapore</p>
        </div>
        <span className="min-h-11 min-w-11 inline-flex items-center gap-2 text-teal">
          <Plus aria-hidden="true" size={20} />Add
        </span>
      </header>

      <HeroCard title="Month spending">
        <HeroAmount value={{ minor_units: total, currency: 'SGD' }} />
        <p className="mt-2 text-sm text-muted">Recorded spending this month · $412 more than the comparable period last month.</p>
        <div className="mt-4">
          <TrendLine data={trend} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        </div>
      </HeroCard>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        <PageCard title="Where it went">
          <CategoryDonut
            data={totals}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            onViewTransactions={(category) => setEvidenceCategory(category)}
            showLegend
          />
        </PageCard>
        <PageCard title="Selected category">
          {selectedCategory ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: getCategoryColor(selectedCategory) }} aria-hidden />
                <span className="font-display text-lg font-semibold">{selectedCategory}</span>
              </div>
              <ul className="space-y-2">
                {transactions
                  .filter((t) => t.category === selectedCategory)
                  .slice(0, 4)
                  .map((t) => (
                    <li key={t.id} className="flex justify-between text-sm">
                      <span>{t.merchant}</span>
                      <span className="font-mono tabular-nums text-muted">{formatCurrency(t.minorUnits / 100)}</span>
                    </li>
                  ))}
              </ul>
              <Button variant="ghost" size="sm" onClick={() => setEvidenceCategory(selectedCategory)} className="text-teal">
                View transactions <ArrowRight size={14} />
              </Button>
            </div>
          ) : (
            <p className="text-muted text-sm">Select a category in "Where it went" to see its merchants and records.</p>
          )}
        </PageCard>
      </div>

      <Sheet open={evidenceCategory != null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent data-testid="evidence-sheet">
          {editing ? (
            <EditForm transaction={editing} onCancel={() => setEditingId(null)} onSave={saveEdit} />
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>{evidenceCategory}</SheetTitle>
                <SheetDescription>{evidenceItems.length} records this period</SheetDescription>
              </SheetHeader>
              <ul className="mt-4 space-y-1">
                {evidenceItems.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setEditingId(t.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 min-h-11 text-left hover:bg-card-hover"
                    >
                      <span>
                        {t.merchant}
                        <span className="block text-xs text-muted">{formatDate(t.date)}</span>
                      </span>
                      <span className="font-mono tabular-nums">{formatCurrency(t.minorUnits / 100)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EditForm({
  transaction, onCancel, onSave,
}: {
  transaction: FixtureTransaction;
  onCancel: () => void;
  onSave: (id: number, category: string, minorUnits: number) => void;
}) {
  const [category, setCategory] = useState(transaction.category);
  const [amount, setAmount] = useState((transaction.minorUnits / 100).toFixed(2));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const minorUnits = Math.round(parseFloat(amount) * 100);
        if (Number.isFinite(minorUnits) && minorUnits > 0) onSave(transaction.id, category, minorUnits);
      }}
    >
      <SheetHeader>
        <SheetTitle>{transaction.merchant}</SheetTitle>
        <SheetDescription>{formatDate(transaction.date)}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-sm text-muted">Amount</span>
          <input
            className="input-field mt-1 w-full"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            aria-label="Amount"
          />
        </label>
        <label className="block">
          <span className="text-sm text-muted">Category</span>
          <select className="select-field mt-1 w-full" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {FIXTURE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <SheetFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Save</Button>
      </SheetFooter>
    </form>
  );
}
