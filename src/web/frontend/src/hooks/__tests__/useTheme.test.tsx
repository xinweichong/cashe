import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useTheme } from '../useTheme';
import { ThemeProvider } from '../ThemeProvider';
import { useChartTheme } from '@/lib/chartTheme';

let dark = false;
let notify: () => void;

function Probe() {
  const { resolved, setPreference } = useTheme();
  const chart = useChartTheme();
  const [draft, setDraft] = useState('');
  return <>
    <output>{resolved}</output>
    <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={() => setPreference('dark')}>Dark</button>
    <button onClick={() => setPreference('system')}>System</button>
    <span data-testid="axis">{chart.CHART_AXIS_PROPS.tick.fill}</span>
  </>;
}

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }),
  });
  dark = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return dark; },
    addEventListener: (_: string, callback: () => void) => { notify = callback; },
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('follows system changes, preserves drafts, and updates chart colors', () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole('status').textContent).toBe('light');
  expect(screen.getByTestId('axis').textContent).toBe('#625C70');
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Taxi home' } });
  act(() => { dark = true; notify(); });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByTestId('axis').textContent).toBe('#A8A1B5');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Taxi home');
});

it('persists explicit preference and resumes system behavior when requested', () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  act(() => { dark = false; notify(); });
  expect(screen.getByRole('status').textContent).toBe('dark');
  expect(window.localStorage.getItem('cashe-appearance')).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'System' }));
  expect(screen.getByRole('status').textContent).toBe('light');
});

it('restores preference and tolerates unavailable local storage', () => {
  window.localStorage.setItem('cashe-appearance', 'dark');
  const view = render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByRole('status').textContent).toBe('dark');
  view.unmount();
  vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('status').textContent).toBe('dark');
});
