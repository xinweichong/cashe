// Isolated fixture data for the Home prototype journey (increment 2 of
// docs/plans/2026-09-16-cashe-design-language-restoration.md). Not real API
// shapes beyond what the shared primitives already consume (Money, plain
// {date, amount}/{category, total} chart points) — this never touches the
// backend, by design, so the journey can be reviewed without live data.

export interface FixtureTransaction {
  id: number;
  date: string; // YYYY-MM-DD
  merchant: string;
  category: string;
  minorUnits: number; // positive = expense
}

export const FIXTURE_TRANSACTIONS: FixtureTransaction[] = [
  { id: 1, date: '2026-09-01', merchant: 'FairPrice', category: 'Food', minorUnits: 4820 },
  { id: 2, date: '2026-09-01', merchant: 'Grab', category: 'Transport', minorUnits: 1240 },
  { id: 3, date: '2026-09-02', merchant: 'Toast Box', category: 'Food', minorUnits: 780 },
  { id: 4, date: '2026-09-03', merchant: 'Shopee', category: 'Shopping', minorUnits: 6590 },
  { id: 5, date: '2026-09-03', merchant: 'SP Services', category: 'Bills', minorUnits: 12400 },
  { id: 6, date: '2026-09-04', merchant: 'Netflix', category: 'Entertainment', minorUnits: 1798 },
  { id: 7, date: '2026-09-04', merchant: 'Grab', category: 'Transport', minorUnits: 980 },
  { id: 8, date: '2026-09-05', merchant: 'Ya Kun', category: 'Food', minorUnits: 650 },
  { id: 9, date: '2026-09-05', merchant: 'Cold Storage', category: 'Food', minorUnits: 3920 },
  { id: 10, date: '2026-09-06', merchant: 'MRT', category: 'Transport', minorUnits: 420 },
  { id: 11, date: '2026-09-07', merchant: 'Lazada', category: 'Shopping', minorUnits: 3100 },
  { id: 12, date: '2026-09-08', merchant: 'Singtel', category: 'Bills', minorUnits: 5800 },
  { id: 13, date: '2026-09-09', merchant: 'Spotify', category: 'Entertainment', minorUnits: 1088 },
  { id: 14, date: '2026-09-10', merchant: 'Parking', category: 'Other', minorUnits: 600 },
  { id: 15, date: '2026-09-10', merchant: 'Din Tai Fung', category: 'Food', minorUnits: 5640 },
];

export function categoryTotals(transactions: FixtureTransaction[]) {
  const byCategory = new Map<string, number>();
  for (const t of transactions) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.minorUnits / 100);
  }
  return Array.from(byCategory.entries()).map(([category, total]) => ({ category, total }));
}

export function dailyTotals(transactions: FixtureTransaction[]) {
  const byDay = new Map<string, number>();
  for (const t of transactions) {
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.minorUnits / 100);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));
}

export function monthTotal(transactions: FixtureTransaction[]): number {
  return transactions.reduce((sum, t) => sum + t.minorUnits, 0);
}

export const FIXTURE_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];
