// Isolated fixture data for the Explore layout study — a spatial-composition
// review (main chart + inspection placement across breakpoints), not a full
// behavioural build-out. See docs/plans/2026-09-16-cashe-design-language-
// restoration.md §"Prototype milestone".

export const OVER_TIME_TREND = [
  { date: '2026-09-01', Food: 48, Transport: 12, Shopping: 0 },
  { date: '2026-09-02', Food: 8, Transport: 0, Shopping: 0 },
  { date: '2026-09-03', Food: 0, Transport: 0, Shopping: 66 },
  { date: '2026-09-04', Food: 0, Transport: 10, Shopping: 0 },
  { date: '2026-09-05', Food: 46, Transport: 0, Shopping: 0 },
  { date: '2026-09-06', Food: 0, Transport: 4, Shopping: 0 },
  { date: '2026-09-07', Food: 0, Transport: 0, Shopping: 31 },
  { date: '2026-09-08', Food: 12, Transport: 0, Shopping: 0 },
  { date: '2026-09-09', Food: 0, Transport: 0, Shopping: 0 },
  { date: '2026-09-10', Food: 56, Transport: 0, Shopping: 0 },
];

export const CATEGORY_CHANGES = [
  { category: 'Bills', change: 62.0 },
  { category: 'Food', change: 34.5 },
  { category: 'Shopping', change: -18.2 },
  { category: 'Transport', change: -6.4 },
  { category: 'Entertainment', change: 2.1 },
];

export const MERCHANT_RANKING = [
  { merchant: 'FairPrice', category: 'Food', total: 84.4 },
  { merchant: 'Din Tai Fung', category: 'Food', total: 56.4 },
  { merchant: 'Shopee', category: 'Shopping', total: 65.9 },
  { merchant: 'Grab', category: 'Transport', total: 22.2 },
  { merchant: 'SP Services', category: 'Bills', total: 124.0 },
];

export const RECURRING_CHANGES = [
  { label: 'Netflix', oldAmount: 15.98, newAmount: 17.98, status: 'increased' as const },
  { label: 'Spotify', oldAmount: 10.88, newAmount: 10.88, status: 'unchanged' as const },
  { label: 'Gym membership', oldAmount: 89.0, newAmount: 89.0, status: 'overdue' as const },
];
