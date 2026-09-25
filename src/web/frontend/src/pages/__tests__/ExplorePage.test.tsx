import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExplorePage } from '../ExplorePage';

test('Explore is one dashboard: no sub-navigation, and no standalone Merchants destination', () => {
  render(<MemoryRouter initialEntries={['/explore']}><ExplorePage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Every pattern, caught.' })).toBeTruthy();
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Insights' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Merchants' })).toBeNull();
});
