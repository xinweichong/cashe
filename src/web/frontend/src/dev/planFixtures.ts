// Isolated fixture data for the Plan layout study. See docs/plans/2026-09-16-
// cashe-design-language-restoration.md §"Prototype milestone".

export const PROJECTION = {
  recorded: 498.26,
  committed: 210.0, // remaining scheduled commitments — estimate, even though the API field is named confirmed_commitments
  estimatedRemaining: 340.5,
  low: 980.0,
  high: 1120.0,
};

export interface PendingCharge {
  id: number;
  date: string; // YYYY-MM-DD
  label: string;
  amount: number | null; // null = amount unknown
}

export const PENDING_CHARGES: PendingCharge[] = [
  { id: 1, date: '2026-09-12', label: 'Netflix', amount: 17.98 },
  { id: 2, date: '2026-09-14', label: 'Gym membership', amount: 89.0 },
  { id: 3, date: '2026-09-18', label: 'Spotify', amount: 10.88 },
  { id: 4, date: '2026-09-21', label: 'Insurance premium', amount: null },
  { id: 5, date: '2026-09-25', label: 'SP Services', amount: 124.0 },
  { id: 6, date: '2026-09-28', label: 'Singtel', amount: 58.0 },
];

export const MONTH_LABEL = 'September 2026';
export const MONTH_DAYS = 30;
export const MONTH_START_WEEKDAY = 2; // 2026-09-01 is a Tuesday (0=Sun)
