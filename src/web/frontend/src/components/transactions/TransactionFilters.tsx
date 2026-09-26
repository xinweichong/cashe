import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Input } from '@/components/ui/input';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn, getCategoryColor, toDateStr } from '@/lib/utils';
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
  variant?: 'default' | 'sheet';
}

// Local calendar dates, so a preset still matches between midnight and 8am
// in Singapore (toISOString would give yesterday's UTC date).
function quickRanges(today = new Date()) {
  const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()];
  const todayStr = toDateStr(today);
  return [
    { label: 'Last 30 days', start: toDateStr(new Date(y, m, d - 30)), end: todayStr },
    { label: 'This month', start: toDateStr(new Date(y, m, 1)), end: todayStr },
    { label: 'Last month', start: toDateStr(new Date(y, m - 1, 1)), end: toDateStr(new Date(y, m, 0)) },
    { label: 'All time', start: '', end: '' },
  ];
}

function quickSelectMatches(start: string, end: string): boolean {
  return quickRanges().some((range) => range.start !== '' && range.start === start && range.end === end);
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
  variant = 'default',
}: TransactionFiltersProps) {
  // 'sheet' is the phone's Filters DrillSheet: search already lives in the
  // thumb dock, so the sheet shows every control, expanded, without it.
  const inSheet = variant === 'sheet';
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Filter chips/date range default collapsed on phone — a search you can
  // always see, with everything else a tap away, beats eight rows of chrome
  // above the first transaction. Tablet/desktop have the room to keep
  // filters visible, so they stay expanded there regardless of this state
  // (the md:flex override below always wins at that breakpoint).
  const activeFilterCount = [category !== 'all', type !== 'all', !!startDate, !!endDate, !!tripId, needsReview]
    .filter(Boolean).length;
  const hasFilters = search || activeFilterCount > 0;
  const [customOpen, setCustomOpen] = useState(false);
  // In the phone sheet the raw date inputs sit behind "Custom…", unless a
  // range that isn't one of the presets is already applied.
  const customDates = customOpen || ((!!startDate || !!endDate) && !quickSelectMatches(startDate, endDate));

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

  const quickSelects = useMemo(() => quickRanges(), []); // computed once per mount

  return (
    <div className="flex flex-col gap-2">
      {!inSheet && <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <Input
          placeholder="Search merchant, alias, description, category, or amount..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>}
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
          className={cn('min-h-11 relative md:hidden', inSheet && 'hidden')}
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
        {hasFilters && !inSheet && (
          <Button
            variant="ghost"
            size={inSheet ? 'default' : 'icon'}
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
            <X className="w-4 h-4" />{inSheet && 'Clear all'}
          </Button>
        )}
      </div>

      <div id="transaction-filter-controls" className={cn(mobileFiltersOpen || inSheet ? 'flex' : 'hidden', 'md:flex flex-col gap-2')}>
        {inSheet && <h3 className="mt-3 text-2xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Type</h3>}
        <div className="overflow-x-auto">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <ChoiceChip key={opt.value} selected={type === opt.value} onClick={() => onTypeChange(opt.value)}>
                {opt.label}
              </ChoiceChip>
            ))}
            <ChoiceChip tone="warning" selected={needsReview} onSelectedChange={onNeedsReviewChange}>
              Needs review
            </ChoiceChip>
          </div>
        </div>

        {inSheet && <h3 className="mt-3 text-2xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Category</h3>}
        <div className="overflow-x-auto">
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={category === 'all'} onClick={() => onCategoryChange('all')}>
              All
            </ChoiceChip>
            {categories.map((cat) => {
              const isActive = category === cat.name;
              return (
                <ChoiceChip
                  key={cat.name}
                  selected={isActive}
                  categoryColor={getCategoryColor(cat.name)}
                  className="max-w-[20ch]"
                  onClick={() => onCategoryChange(isActive ? 'all' : cat.name)}
                >
                  <span className="truncate">{cat.name}</span>
                </ChoiceChip>
              );
            })}
          </div>
        </div>

        {inSheet && <h3 className="mt-3 text-2xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">Dates</h3>}
        {inSheet ? <>
        <div className="flex flex-wrap gap-1.5">
          {quickSelects.map((q) => {
            const isActive = q.label !== 'All time' && startDate === q.start && endDate === q.end;
            return (
              <ChoiceChip key={q.label} selected={isActive} onClick={() => { setStartDate(q.start); setEndDate(q.end); }}>
                {q.label}
              </ChoiceChip>
            );
          })}
          <ChoiceChip selected={customDates} aria-expanded={customDates} onClick={() => setCustomOpen((v) => !v)}>Custom…</ChoiceChip>
        </div>
          {customDates && <div className="flex flex-wrap items-center gap-2">
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
        </div>}
          <Button type="button" variant="outline" className="mt-4 w-full min-h-12" onClick={handleExport}>Export CSV</Button>
        </> : <>
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
              <ChoiceChip key={q.label} selected={isActive} onClick={() => { setStartDate(q.start); setEndDate(q.end); }}>
                {q.label}
              </ChoiceChip>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleExport}>
            Export CSV
          </Button>
        </div>
        </>}
      </div>
    </div>
  );
}
