import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from '../switch';

test('Switch exposes its state and reports the next value', () => {
  const onChange = vi.fn();
  render(<Switch checked={false} onCheckedChange={onChange} aria-label="Budgets" />);
  const control = screen.getByRole('switch', { name: 'Budgets' });
  expect(control.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(control);
  expect(onChange).toHaveBeenCalledWith(true);
});

test('a pending Switch is busy and cannot be toggled again', () => {
  const onChange = vi.fn();
  render(<Switch checked onCheckedChange={onChange} pending aria-label="Trips" />);
  const control = screen.getByRole('switch', { name: 'Trips' });
  expect(control.getAttribute('aria-busy')).toBe('true');
  fireEvent.click(control);
  expect(onChange).not.toHaveBeenCalled();
});
