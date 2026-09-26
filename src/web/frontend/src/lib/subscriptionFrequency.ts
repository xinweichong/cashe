import type { Subscription } from '@/api/client';

export const FREQUENCY_LABELS: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

/** The label for a schedule frequency, or the raw value if it isn't a known one. */
export function frequencyLabel(frequency: string): string {
  return FREQUENCY_LABELS[frequency as Subscription['frequency']] ?? frequency;
}
