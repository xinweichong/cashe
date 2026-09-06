import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { BottomTabs } from '../BottomTabs';
import { LegacyRedirect } from '../LegacyRedirect';

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}{location.hash}</output>;
}

describe('opt-in navigation', () => {
  it('shows four destinations with the detail parent active', () => {
    render(<MemoryRouter initialEntries={['/activity/42']}><BottomTabs newExperience /></MemoryRouter>);
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Home', 'Activity', 'Plan', 'Explore']);
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('retains classic destinations by default', () => {
    render(<MemoryRouter><BottomTabs /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });

  it.each([
    ['/transactions/42?returnTo=%2Fevidence%3Fcategory%3DFood#detail', '/transactions', '/activity', '/activity/42?returnTo=%2Fevidence%3Fcategory%3DFood#detail'],
    ['/merchants/Toast%20Box?start=2026-09-01', '/merchants', '/explore/merchants', '/explore/merchants/Toast%20Box?start=2026-09-01'],
    ['/finance?tab=goals', '/finance', '/plan', '/plan?tab=goals'],
  ])('preserves deep link %s', (url, from, to, expected) => {
    render(<MemoryRouter initialEntries={[url]}><Routes>
      <Route path={`${from}/*`} element={<LegacyRedirect from={from} to={to} />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toBe(expected);
  });
});
