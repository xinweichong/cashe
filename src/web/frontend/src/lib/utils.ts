import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { SPECTRUM_PALETTE, COLOR_MINT, COLOR_TEAL, COLOR_HONEY, COLOR_TANGERINE, COLOR_CORAL } from './chartTheme'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'SGD'): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrencyWhole(amount: number, currency = 'SGD'): string {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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

/** Find the nearest spectrum color to `hex` by Euclidean distance in RGB. */
export function nearestSpectrum(hex: string): string {
  const target = hexToRgb(hex);
  if (!target) return SPECTRUM_PALETTE[0];
  let best = SPECTRUM_PALETTE[0];
  let bestDist = Infinity;
  for (const candidate of SPECTRUM_PALETTE) {
    const c = hexToRgb(candidate)!;
    const d = (target.r - c.r) ** 2 + (target.g - c.g) ** 2 + (target.b - c.b) ** 2;
    if (d < bestDist) { bestDist = d; best = candidate; }
  }
  return best;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Format a Date to "YYYY-MM-DD" in local time. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Map spending pace % to a spectrum colour. */
export function getPaceColor(percent: number): string {
  if (percent < 80)  return COLOR_MINT;
  if (percent <= 100) return COLOR_TEAL;
  if (percent <= 115) return COLOR_TANGERINE;
  return COLOR_CORAL;
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
