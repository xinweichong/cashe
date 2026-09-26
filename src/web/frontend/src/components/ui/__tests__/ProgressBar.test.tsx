import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../ProgressBar';

test('ProgressBar announces its label and value', () => {
  render(<ProgressBar percent={42.4} label="Food budget used" tone="active" />);
  const bar = screen.getByRole('progressbar', { name: 'Food budget used' });
  expect(bar.getAttribute('aria-valuenow')).toBe('42');
  expect(bar.getAttribute('aria-valuemax')).toBe('100');
});

test('an overage is announced rather than capped', () => {
  render(<ProgressBar percent={130} label="Dining budget used" tone="warm" />);
  const bar = screen.getByRole('progressbar', { name: 'Dining budget used' });
  expect(bar.getAttribute('aria-valuetext')).toBe('130%');
  expect(bar.getAttribute('aria-valuemax')).toBe('130');
});
