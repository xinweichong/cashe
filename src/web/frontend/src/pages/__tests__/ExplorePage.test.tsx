import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExplorePage } from '../ExplorePage';

test('Explore nav has no standalone Merchants destination — profiles are drill-downs only', () => {
  render(<MemoryRouter initialEntries={['/explore']}><ExplorePage /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Spending patterns' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Insights' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Merchants' })).toBeNull();
});
