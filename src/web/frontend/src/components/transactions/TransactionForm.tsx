import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useCreateTransaction } from '@/hooks/useTransactions';
import { useToast } from '@/hooks/useToastContext';
import { type Category } from '@/api/client';

const TX_TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'cash', label: 'Cash' },
] as const;

type TxType = typeof TX_TYPES[number]['value'];

const CURRENCIES = ['SGD', 'USD', 'THB', 'MYR', 'JPY', 'EUR', 'GBP'] as const;

interface TransactionFormProps {
  categories: Category[];
  onClose: () => void;
}

export function TransactionForm({ categories, onClose }: TransactionFormProps) {
  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('SGD');
  const [datetime, setDatetime] = useState(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });

  const [requestKey] = useState(() => crypto.randomUUID());
  const createTx = useCreateTransaction();
  const toast = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || createTx.isPending) return;
    createTx.mutate(
      {
        requestKey,
        data: {
          type: type === 'cash' ? 'expense' : type,
          amount: parsed,
          merchant: merchant || undefined,
          category: category || undefined,
          description: description || undefined,
          currency,
          source: type === 'cash' ? 'cash' : 'manual',
          transaction_date: datetime ? datetime + ':00' : undefined,
        },
      },
      {
        onSuccess: () => {
          toast('Captured.');
          onClose();
        },
      }
    );
  };

  return (
    <Card className="p-4 bg-card border-border">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex rounded-md border border-border overflow-hidden">
          {TX_TYPES.map((t, i) => (
            <Button
              key={t.value}
              type="button"
              variant="ghost"
              size="sm"
              className={`flex-1 rounded-none ${i > 0 ? 'border-l border-border' : ''} ${
                type === t.value
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted">Amount</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="bg-background border-border"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted">Currency</label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted">Merchant</label>
          <Input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="e.g. Coffee Shop"
            className="bg-background border-border"
          />
        </div>

        <div>
          <label className="text-xs text-muted">Category</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-background border-border">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted">Date & Time</label>
          <Input
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="bg-background border-border"
          />
        </div>

        <div>
          <label className="text-xs text-muted">Description (optional)</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes..."
            className="bg-background border-border"
          />
        </div>

        {createTx.isError && (
          <p role="alert" className="text-sm text-destructive">
            {createTx.error.message.includes('409')
              ? 'This entry was already submitted. Check Activity before starting another entry.'
              : 'Save was not confirmed. Retry with the same fields, or check Activity before starting another entry.'}
          </p>
        )}

        <Separator />

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!amount || createTx.isPending}>
            {createTx.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
