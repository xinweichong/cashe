import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPage, TermsPage } from '../LegalPage';
import { LoginScreen } from '@/components/auth/LoginScreen';

vi.mock('@/hooks/useAuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }));

afterEach(cleanup);

test('the privacy policy carries the Google Limited Use disclosure and links to the terms', () => {
  render(<MemoryRouter initialEntries={['/privacy']}><PrivacyPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
  expect(screen.getByText(/Limited Use requirements/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Terms of service' }).getAttribute('href')).toBe('/terms');
});

test('the terms link back to the privacy policy', () => {
  render(<MemoryRouter initialEntries={['/terms']}><TermsPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: /privacy policy/i }).every(a => a.getAttribute('href') === '/privacy')).toBe(true);
});

test('the login screen links to both pages', () => {
  render(<MemoryRouter><LoginScreen /></MemoryRouter>);
  const legal = screen.getByRole('navigation', { name: 'Legal' });
  expect(legal.querySelector('a[href="/privacy"]')).toBeTruthy();
  expect(legal.querySelector('a[href="/terms"]')).toBeTruthy();
});
