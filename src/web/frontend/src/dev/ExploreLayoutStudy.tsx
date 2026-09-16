import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { PageCard } from '@/components/ui/cards';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CategoryTrendLine } from '@/components/charts/CategoryTrendLine';
import { getCategoryColor, formatCurrency, cn } from '@/lib/utils';
import { OVER_TIME_TREND, CATEGORY_CHANGES, MERCHANT_RANKING, RECURRING_CHANGES } from './exploreFixtures';

// Explore layout study (increment 2): spatial composition of "main visual +
// contextual inspection" at each breakpoint, per docs/plans/2026-09-16-cashe-
// design-language-restoration.md. Reviews placement, not final behaviour —
// only "Over time" wires a real chart; the other modes are static composition
// sketches of the same main-visual/inspection split. Fixture data only, no
// backend. Mounted at /dev/preview/explore (dev-only, see App.tsx).

type Mode = 'over-time' | 'by-category' | 'by-merchant' | 'recurring';

const MODES: { value: Mode; label: string }[] = [
  { value: 'over-time', label: 'Over time' },
  { value: 'by-category', label: 'By category' },
  { value: 'by-merchant', label: 'By merchant' },
  { value: 'recurring', label: 'Recurring' },
];

export function ExploreLayoutStudy() {
  const [mode, setMode] = useState<Mode>('over-time');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6" data-testid="explore-layout-study">
      <header>
        <h1 className="font-display text-2xl font-semibold">Explore</h1>
        <p className="text-muted text-sm">Follow a pattern from day to category to merchant to transaction.</p>
      </header>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex justify-center">
        <TabsList>
          {MODES.map((m) => (
            <TabsTrigger key={m.value} value={m.value}>{m.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Main visual + contextual inspection: side by side on wide layouts,
          stacked on phone/portrait tablet — the spatial question this study
          exists to answer. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        {mode === 'over-time' && (
          <PageCard title="Spending over time">
            <p className="text-sm text-muted mb-4">Your three most active categories this period.</p>
            <div className="h-[280px]"><CategoryTrendLine data={OVER_TIME_TREND} /></div>
          </PageCard>
        )}
        {mode === 'by-category' && (
          <PageCard title="What changed">
            <p className="text-sm text-muted mb-4">Signed change vs. the comparable period, centred on zero.</p>
            <DivergingBars data={CATEGORY_CHANGES} selected={selectedCategory} onSelect={setSelectedCategory} />
          </PageCard>
        )}
        {mode === 'by-merchant' && (
          <PageCard title="Merchant ranking">
            <p className="text-sm text-muted mb-4">Ranked by total this period.</p>
            <MerchantBars data={MERCHANT_RANKING} selected={selectedCategory} onSelect={setSelectedCategory} />
          </PageCard>
        )}
        {mode === 'recurring' && (
          <PageCard title="Recurring charges">
            <ul className="divide-y divide-border">
              {RECURRING_CHANGES.map((r) => (
                <li key={r.label} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{r.label}</p>
                    <p className="text-sm font-mono tabular-nums text-muted">
                      {formatCurrency(r.oldAmount)}{r.oldAmount !== r.newAmount && <> → {formatCurrency(r.newAmount)}</>}
                    </p>
                  </div>
                  {r.status === 'increased' && <Badge tone="notable">Increased</Badge>}
                  {r.status === 'overdue' && <Badge tone="warm">Overdue</Badge>}
                  {r.status === 'unchanged' && <Badge tone="calm">On track</Badge>}
                </li>
              ))}
            </ul>
          </PageCard>
        )}

        <PageCard title={selectedCategory ? selectedCategory : 'This period'}>
          {selectedCategory ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: getCategoryColor(selectedCategory) }} aria-hidden />
                <span className="text-sm font-medium">{selectedCategory}</span>
              </div>
              <p className="text-sm text-muted">Explanation and supporting facts for the selected item appear here, scoped to the same period as the main visual.</p>
              <button type="button" className="text-sm text-teal min-h-11 inline-flex items-center gap-1">
                View transactions <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Select a bar or line to see its exact values and evidence here.</p>
          )}
        </PageCard>
      </div>
    </div>
  );
}

function DivergingBars({
  data, selected, onSelect,
}: {
  data: { category: string; change: number }[];
  selected: string | null;
  onSelect: (c: string) => void;
}) {
  const max = Math.max(...data.map((d) => Math.abs(d.change)), 1);
  return (
    <ul className="space-y-2" data-testid="diverging-bars">
      {data.map((d) => {
        const widthPct = (Math.abs(d.change) / max) * 50;
        const isPositive = d.change >= 0;
        return (
          <li key={d.category}>
            <button
              type="button"
              onClick={() => onSelect(d.category)}
              aria-pressed={selected === d.category}
              className={cn('flex w-full items-center gap-2 min-h-11 px-2 py-1 rounded-md', selected === d.category ? 'bg-card-hover' : 'hover:bg-card-hover')}
            >
              <span className="w-24 shrink-0 text-sm text-left truncate">{d.category}</span>
              <span className="relative flex-1 h-4">
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-border" aria-hidden />
                <span
                  className="absolute top-0.5 h-3 rounded-sm"
                  style={{
                    background: getCategoryColor(d.category),
                    width: `${widthPct}%`,
                    left: isPositive ? '50%' : `${50 - widthPct}%`,
                  }}
                  aria-hidden
                />
              </span>
              <span className={cn('w-20 shrink-0 text-sm font-mono tabular-nums text-right', isPositive ? 'text-coral' : 'text-teal')}>
                {isPositive ? '+' : '−'}{formatCurrency(Math.abs(d.change))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MerchantBars({
  data, selected, onSelect,
}: {
  data: { merchant: string; category: string; total: number }[];
  selected: string | null;
  onSelect: (c: string) => void;
}) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <ul className="space-y-2" data-testid="merchant-bars">
      {data.map((d) => (
        <li key={d.merchant}>
          <button
            type="button"
            onClick={() => onSelect(d.category)}
            aria-pressed={selected === d.category}
            className={cn('flex w-full items-center gap-2 min-h-11 px-2 py-1 rounded-md', selected === d.category ? 'bg-card-hover' : 'hover:bg-card-hover')}
          >
            <span className="w-28 shrink-0 text-sm text-left truncate">{d.merchant}</span>
            <span className="relative flex-1 h-3 bg-card-hover rounded-sm overflow-hidden">
              <span className="absolute inset-y-0 left-0 rounded-sm" style={{ background: getCategoryColor(d.category), width: `${(d.total / max) * 100}%` }} aria-hidden />
            </span>
            <span className="w-16 shrink-0 text-sm font-mono tabular-nums text-right">{formatCurrency(d.total)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
