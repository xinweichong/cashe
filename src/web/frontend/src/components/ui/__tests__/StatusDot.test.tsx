import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '../StatusDot';

test('StatusDot keeps meaning in its readable label, with a decorative dot', () => {
  const { container } = render(<StatusDot tone="active" label="Check" />);
  expect(screen.getByText('Check')).toBeTruthy();
  expect(container.querySelector('[aria-hidden]')?.className).toContain('h-1.5');
});
