// Colour roles for money (approved 2026-10-06, phone quick view). One
// meaning per colour on figures outside the spectrum card; per-purchase
// amounts stay neutral so colour marks totals and change.
export type MoneyTone = 'spend' | 'in' | 'over' | 'estimate';

export const MONEY_TONE_CLASS: Record<MoneyTone, string> = {
  /** Spending totals and per-category spend. */
  spend: 'text-tangerine',
  /** Income, money left, saved, and spending that went down. */
  in: 'text-teal',
  /** Spending that went up, and budgets that are over. */
  over: 'text-coral',
  /** Scheduled charges, estimated parts of a projection, goal progress. */
  estimate: 'text-honey',
};

/** Tone for a change in spending: up is coral, down is teal. */
export const changeTone = (minorUnits: number): MoneyTone => (minorUnits > 0 ? 'over' : 'in');
