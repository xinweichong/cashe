import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SelectableRow } from '../selectable-row';

test('SelectableRow exposes selection, but a disclosure row reports expansion instead', () => {
  render(<>
    <SelectableRow selected>Food</SelectableRow>
    <SelectableRow selected={false} aria-expanded={false}>Remaining</SelectableRow>
  </>);
  expect(screen.getByRole('button', { name: 'Food', pressed: true })).toBeTruthy();
  const remaining = screen.getByRole('button', { name: 'Remaining' });
  expect(remaining.hasAttribute('aria-pressed')).toBe(false);
  expect(remaining.getAttribute('aria-expanded')).toBe('false');
});
