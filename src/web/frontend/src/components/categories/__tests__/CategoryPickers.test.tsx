import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PALETTE } from '@/lib/utils';
import { CategoryColorPicker, CategoryIconPicker } from '../CategoryPickers';

test('icon picker is a labelled radio group reporting the chosen icon', () => {
  const onChange = vi.fn();
  render(<CategoryIconPicker value="📌" onChange={onChange} />);
  expect((screen.getByRole('radio', { name: 'Icon 📌' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Icon 🍜' }));
  expect(onChange).toHaveBeenCalledWith('🍜');
});

test('colours used by other categories are disabled and explained', () => {
  const used = PALETTE[0];
  render(<CategoryColorPicker value={PALETTE[1]} onChange={() => {}} taken={(c) => c === used} />);
  expect((screen.getByRole('radio', { name: `${used} (used by another category)` }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/already used by other categories/)).toBeTruthy();
});
