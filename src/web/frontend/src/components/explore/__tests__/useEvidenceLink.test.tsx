import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SpendingPeriod } from '@/api/briefing';
import { useEvidenceLink } from '../useEvidenceLink';

const period = { start: '2026-10-01', end: '2026-10-06' } as SpendingPeriod;

describe('useEvidenceLink', () => {
  it('returns evidence to the Explore view it was opened from', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/explore?mode=by-category']}>{children}</MemoryRouter>;
    const { result } = renderHook(() => useEvidenceLink(), { wrapper });
    const href = result.current(period, 'Food');
    expect(href.startsWith('/evidence?start=2026-10-01&end=2026-10-06&measure=spending&category=Food&returnTo=')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('returnTo')).toBe('/explore?mode=by-category');
  });
});
