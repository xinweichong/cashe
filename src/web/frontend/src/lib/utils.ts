import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { SPECTRUM_PALETTE, COLOR_MINT, COLOR_TEAL, COLOR_HONEY, COLOR_TANGERINE, COLOR_CORAL } from './chartTheme'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A refund is money coming back, same display sign as income — the stored
 * `amount` column is always positive regardless of type. */
export function isCreditType(type: string | null | undefined): boolean {
  return type === 'income' || type === 'refund';
}

// Building an Intl.NumberFormat is the expensive part, and long transaction
// lists format on every row; keep one per currency and precision.
const currencyFormats = new Map<string, Intl.NumberFormat>();
function currencyFormat(currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let format = currencyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-SG', whole
      ? { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : { style: 'currency', currency, minimumFractionDigits: 2 });
    currencyFormats.set(key, format);
  }
  return format;
}

export function formatCurrency(amount: number, currency = 'SGD'): string {
  return currencyFormat(currency, false).format(amount);
}

export function formatCurrencyWhole(amount: number, currency = 'SGD'): string {
  return currencyFormat(currency, true).format(amount);
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatShortDate(date: string): string {
  const [y, m, d] = date.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Format a transaction_date string for display.
 * Shows time only when it is non-midnight (i.e. a real time was captured).
 * Handles null/undefined gracefully. Handles both "YYYY-MM-DD" (bare) and
 * "YYYY-MM-DDTHH:MM:SS" (ISO) formats.
 */
/** Just the time of day ("10:05 am"), or '' for a date-only record. */
export function formatTimeOfDay(date: string | null | undefined): string {
  const tIdx = date?.indexOf('T') ?? -1;
  if (!date || tIdx === -1 || date.slice(tIdx + 1).startsWith('00:00')) return '';
  const [y, m, d] = date.slice(0, tIdx).split('-').map(Number);
  const [h, min] = date.slice(tIdx + 1).split(':').map(Number);
  return new Date(y, m - 1, d, h, min).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—';
  const tIdx = date.indexOf('T');
  const datePart = tIdx !== -1 ? date.slice(0, tIdx) : date.slice(0, 10);
  const timePart = tIdx !== -1 ? date.slice(tIdx + 1) : null;

  const [y, m, d] = datePart.split('-').map(Number);
  const dateStr = new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Only show time when it is not synthetic midnight
  if (timePart && !timePart.startsWith('00:00')) {
    const [h, min] = timePart.split(':').map(Number);
    const timeStr = new Date(y, m - 1, d, h, min).toLocaleTimeString('en-SG', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${dateStr}, ${timeStr}`;
  }
  return dateStr;
}

/**
 * The calendar-day bucket a transaction_date belongs to for grouping
 * purposes — the same bare-date-substring convention formatDate/
 * formatDateTime already use (no timezone conversion), so a transaction's
 * group header always matches its own displayed date.
 */
export function localDayKey(date: string | null | undefined): string {
  if (!date) return 'undated';
  return date.slice(0, 10);
}

export function formatDayHeading(dayKey: string): string {
  return dayKey === 'undated' ? 'No date' : formatDate(dayKey);
}

const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  'Food':          '#FB923C', // tangerine
  'Transport':     '#34D399', // mint
  'Shopping':      '#FF6B6B', // coral
  'Bills':         '#FBBF24', // honey
  'Entertainment': '#2DD4BF', // mint-teal
  'Other':         '#7A7488', // muted
  'Income':        '#00D4AA', // teal
};

const _categoryColorOverrides: Record<string, string> = {};

export function setCategoryColors(categories: { name: string; color: string | null }[]) {
  Object.keys(_categoryColorOverrides).forEach(k => delete _categoryColorOverrides[k]);
  for (const cat of categories) {
    if (cat.color) {
      _categoryColorOverrides[cat.name] = cat.color;
    }
  }
}

export function getCategoryColor(category: string): string {
  if (_categoryColorOverrides[category]) return _categoryColorOverrides[category];
  return DEFAULT_CATEGORY_COLORS[category] ?? '#7A7488';
}

/** Re-exported palette for the category color picker in Settings. */
export const PALETTE = SPECTRUM_PALETTE;

/** Format a Date to "YYYY-MM-DD" in local time. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Map budget utilisation % to a spectrum colour. */
export function getBudgetTone(percent: number): { color: string; toneName: 'calm' | 'active' | 'notable' | 'warn' } {
  if (percent < 50)  return { color: COLOR_MINT,      toneName: 'calm' };
  if (percent < 80)  return { color: COLOR_HONEY,     toneName: 'active' };
  if (percent < 100) return { color: COLOR_TANGERINE, toneName: 'notable' };
  return              { color: COLOR_CORAL,            toneName: 'warn' };
}

/** Map goal completion % to a spectrum colour (higher = better for goals). */
export function getGoalTone(percent: number): { color: string } {
  if (percent < 25) return { color: COLOR_TANGERINE };
  if (percent < 50) return { color: COLOR_HONEY };
  if (percent < 75) return { color: COLOR_MINT };
  return             { color: COLOR_TEAL };
}

/** Every ISO date (YYYY-MM-DD) from start to end inclusive, in order. */
export function datesInRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
