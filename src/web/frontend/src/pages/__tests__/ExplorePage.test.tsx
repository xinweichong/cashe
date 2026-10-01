import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExplorePage } from '../ExplorePage';

test('Explore is one dashboard: no sub-navigation, and no standalone Merchants destination', () => {
  render(<MemoryRouter initialEntries={['/explore']}><ExplorePage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeTruthy();
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Insights' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Merchants' })).toBeNull();
});

test('signals and health are pushed pages with a back button to Explore', () => {
  render(<MemoryRouter initialEntries={['/explore/signals']}><ExplorePage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Worth a look' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Explore' }).getAttribute('href')).toBe('/explore');
});
