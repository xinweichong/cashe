import { formatCurrency } from '@/lib/utils';

interface MerchantData {
  merchant: string;
  count: number;
  total: number;
  avg_amount: number;
}

export function MerchantTable({ data }: { data: MerchantData[] }) {
  if (data.length === 0) {
    return <p className="text-center text-muted text-sm py-6">No merchant data</p>;
  }

  const maxTotal = Math.max(...data.map((d) => d.total));

  return (
    <div className="space-y-2">
      {data.map((m) => (
        <div key={m.merchant} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm truncate">{m.merchant}</span>
              <span className="text-sm font-medium ml-2">{formatCurrency(m.total)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal rounded-full"
                  style={{ width: `${(m.total / maxTotal) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted whitespace-nowrap">{m.count}x</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
