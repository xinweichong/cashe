// A per-device text-size preference. The app's type, spacing and control
// sizes are rem-based, so scaling the root font size scales the content
// proportionally; the wordmark is sized in px and stays put. Stored per
// browser because the right size differs between a phone and a desktop.

export type TextSize = 'small' | 'default' | 'large' | 'larger';

export const TEXT_SIZES: readonly { value: TextSize; label: string; percent: number }[] = [
  { value: 'small', label: 'Small', percent: 87.5 },
  { value: 'default', label: 'Default', percent: 100 },
  { value: 'large', label: 'Large', percent: 112.5 },
  { value: 'larger', label: 'Larger', percent: 125 },
];

const STORAGE_KEY = 'cashe-text-size';

export function readTextSize(): TextSize {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (TEXT_SIZES.some((s) => s.value === value)) return value as TextSize;
  } catch {
    // Private mode or blocked storage: fall back to the default size.
  }
  return 'default';
}

export function applyTextSize(size: TextSize): void {
  const percent = TEXT_SIZES.find((s) => s.value === size)?.percent ?? 100;
  document.documentElement.style.fontSize = percent === 100 ? '' : `${percent}%`;
  // Lets layouts respond to the size itself (PhoneScreen scrolls at Larger).
  document.documentElement.dataset.textSize = size;
}

export function saveTextSize(size: TextSize): void {
  applyTextSize(size);
  try { window.localStorage.setItem(STORAGE_KEY, size); } catch { /* Still applies for this visit. */ }
}
