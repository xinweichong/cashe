import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedChoice } from '../segmented-choice';

const options = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] as const;

test('SegmentedChoice is a labelled radio group reporting the chosen value', () => {
  const onChange = vi.fn();
  render(<SegmentedChoice name="t" aria-label="Transaction type" value="expense" onValueChange={onChange} options={options} />);
  expect(screen.getByRole('radiogroup', { name: 'Transaction type' })).toBeTruthy();
  expect((screen.getByRole('radio', { name: 'Expense' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Income' }));
  expect(onChange).toHaveBeenCalledWith('income');
});
