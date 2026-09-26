import { formatMoney, type Money } from '@/api/briefing';
import { formatShortDate } from '@/lib/utils';

/** Signed money for a change: "+$12.00" / "−$4.50" — sign as text, never colour alone. */
export function formatChange(change: Money): string {
  const sign = change.minor_units >= 0 ? '+' : '−';
  return `${sign}${formatMoney({ ...change, minor_units: Math.abs(change.minor_units) })}`;
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
}
