import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn, getCategoryColor } from '@/lib/utils';
import type { Trip } from '@/api/client';

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'refund', label: 'Refund' },
  { value: 'transfer', label: 'Transfer' },
];

interface TransactionFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  categories: { name: string }[];
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  type: string;
  onTypeChange: (v: string) => void;
  trips: Trip[];
  tripId: string;
  onTripChange: (v: string) => void;
  needsReview: boolean;
  onNeedsReviewChange: (v: boolean) => void;
}

export function TransactionFilters({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  categories,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  type,
  onTypeChange,
  trips,
  tripId,
  onTripChange,
  needsReview,
  onNeedsReviewChange,
}: TransactionFiltersProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Filter chips/date range default collapsed on phone — a search you can
  // always see, with everything else a tap away, beats eight rows of chrome
  // above the first transaction. Tablet/desktop have the room to keep
  // filters visible, so they stay expanded there regardless of this state
  // (the md:flex override below always wins at that breakpoint).
  const activeFilterCount = [category !== 'all', type !== 'all', !!startDate, !!endDate, !!tripId, needsReview]
    .filter(Boolean).length;
  const hasFilters = search || activeFilterCount > 0;

  const handleExport = () => {
    const params = new URLSearchParams();
    if (search) params.set('merchant', search);
    if (category && category !== 'all') params.set('category', category);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    window.open(
      `/api/transactions/export?${params.toString()}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const quickSelects = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    return [
      {
        label: 'Last 30 days',
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)
          .toISOString().slice(0, 10),
        end: todayStr,
      },
      {
        label: 'This month',
        start: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
        end: todayStr,
      },
      {
        label: 'Last month',
        start: (() => {
          const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          return d.toISOString().slice(0, 10);
        })(),
        end: (() => {
          const d = new Date(today.getFullYear(), today.getMonth(), 0);
          return d.toISOString().slice(0, 10);
        })(),
      },
      { label: 'All time', start: '', end: '' },
    ];
  }, []); // empty deps: computed once per component mount

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <Input
          placeholder="Search merchant, alias, description, category, or amount..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {trips.length > 0 && (
          <select
            aria-label="Trip"
            value={tripId}
            onChange={(e) => onTripChange(e.target.value)}
            className="input-field flex-1 sm:flex-none min-w-0"
          >
            <option value="">All trips</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <Button
          variant="outline"
          className="min-h-11 relative md:hidden"
          onClick={() => setMobileFiltersOpen((v) => !v)}
          aria-expanded={mobileFiltersOpen}
          aria-controls="transaction-filter-controls"
        >
          <SlidersHorizontal className="w-4 h-4 mr-1.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-pill bg-teal text-background text-2xs font-mono font-semibold">
              {activeFilterCount}
            </span>
          )}
        </Button>
        {hasFilters && (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11"
            aria-label="Clear all filters"
            onClick={() => {
              onSearchChange('');
              onCategoryChange('all');
              setStartDate('');
              setEndDate('');
              onTypeChange('all');
              onTripChange('');
              onNeedsReviewChange(false);
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div id="transaction-filter-controls" className={cn(mobileFiltersOpen ? 'flex' : 'hidden', 'md:flex flex-col gap-2')}>
        <div className="overflow-x-auto">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={type === opt.value}
                onClick={() => onTypeChange(opt.value)}
                className="px-3 py-1 rounded-full text-xs font-semibold font-mono uppercase tracking-[0.08em] transition-all duration-[150ms] whitespace-nowrap"
                style={
                  type === opt.value
                    ? { color: 'var(--color-foreground)', background: 'var(--color-card-hover)', border: '1px solid var(--color-muted)' }
                    : { color: 'var(--color-muted)', background: 'transparent', border: '1px solid var(--color-border)' }
                }
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={needsReview}
              onClick={() => onNeedsReviewChange(!needsReview)}
              className="px-3 py-1 rounded-full text-xs font-semibold font-mono uppercase tracking-[0.08em] transition-all duration-[150ms] whitespace-nowrap"
              style={
                needsReview
                  ? { color: 'var(--color-warning, #FBBF24)', background: 'var(--color-warning, #FBBF24)22', border: '1px solid var(--color-warning, #FBBF24)60' }
                  : { color: 'var(--color-muted)', background: 'transparent', border: '1px solid var(--color-border)' }
              }
            >
              Needs review
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={category === 'all'}
              onClick={() => onCategoryChange('all')}
              className="px-3 py-1 rounded-full text-xs font-semibold font-mono uppercase tracking-[0.08em] transition-all duration-[150ms] whitespace-nowrap"
              style={
                category === 'all'
                  ? { color: 'var(--color-foreground)', background: 'var(--color-card-hover)', border: '1px solid var(--color-muted)' }
                  : { color: 'var(--color-muted)', background: 'transparent', border: '1px solid var(--color-border)' }
              }
            >
              All
            </button>
            {categories.map((cat) => {
              const catColor = getCategoryColor(cat.name);
              const isActive = category === cat.name;
              return (
                <button
                  key={cat.name}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onCategoryChange(isActive ? 'all' : cat.name)}
                  className="px-3 py-1 rounded-full text-xs font-semibold font-mono uppercase tracking-[0.08em] transition-all duration-[150ms] whitespace-nowrap max-w-[20ch] truncate"
                  style={{
                    color: catColor,
                    background: isActive ? `${catColor}33` : `${catColor}12`,
                    border: `1px solid ${catColor}${isActive ? '60' : '25'}`,
                  }}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="Start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input-field"
          />
          <span className="text-muted text-sm">–</span>
          <input
            type="date"
            aria-label="End date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {quickSelects.map((q) => {
            const isActive = q.label !== 'All time' && startDate === q.start && endDate === q.end;
            return (
              <button
                key={q.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => { setStartDate(q.start); setEndDate(q.end); }}
                className={`px-2.5 py-2 md:py-1 text-xs rounded-full border transition-colors ${
                  isActive
                    ? 'border-foreground text-foreground bg-foreground/10'
                    : 'border-border text-muted hover:text-foreground'
                }`}
              >
                {q.label}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleExport}>
            Export CSV
          </Button>
        </div>
      </div>
    </div>
  );
}
