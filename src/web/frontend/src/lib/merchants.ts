/** Shared tag constants for merchant list and merchant profile views. */

export const ALL_TAGS: string[] = ['online', 'subscription', 'foreign', 'essential', 'recurring'];

export function formatSGD(v: number): string {
  return `$${v.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
