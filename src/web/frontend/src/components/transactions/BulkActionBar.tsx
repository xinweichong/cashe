import { Button } from '@/components/ui/button';

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'refund', label: 'Refund' },
  { value: 'transfer', label: 'Transfer' },
] as const;

interface BulkActionBarProps {
  count: number;
  categories: { name: string }[];
  onCategorize: (category: string) => void;
  onSetType: (type: 'expense' | 'income' | 'refund' | 'transfer') => void;
  onCancel: () => void;
  pending: boolean;
}

export function BulkActionBar({ count, categories, onCategorize, onSetType, onCancel, pending }: BulkActionBarProps) {
  const disabled = pending || count === 0;
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-sm font-semibold min-w-[6ch]">{count} selected</span>
      <select
        aria-label="Set category for selected"
        defaultValue=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onCategorize(e.target.value);
          e.target.value = '';
        }}
        className="select-field text-sm"
      >
        <option value="" disabled>Set category…</option>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
      <div className="flex gap-1 flex-wrap">
        {TYPE_OPTIONS.map((t) => (
          <Button
            key={t.value}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSetType(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending} className="ml-auto">
        Cancel
      </Button>
    </div>
  );
}
