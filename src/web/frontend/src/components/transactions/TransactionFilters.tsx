import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { getCategoryColor } from '@/lib/utils';

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
}: TransactionFiltersProps) {
  const hasFilters = search || category !== 'all' || startDate || endDate;

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
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <Input
            placeholder="Search merchant or description..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 bg-background border-border"
          />
        </div>
        {/* Category filter pills moved below */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              onSearchChange('');
              onCategoryChange('all');
              setStartDate('');
              setEndDate('');
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
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
        <button
          type="button"
          onClick={handleExport}
          className="px-3 py-1.5 text-xs border border-border rounded-md text-muted hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
