import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomTabs } from '../BottomTabs';
import { Sidebar } from '../Sidebar';
import { ListDetail } from '../ListDetail';
import { useStackBack } from '../stackContext';
import { useHistoryEntry } from '@/hooks/useHistoryEntry';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ preference: 'system', setPreference: () => {} }) }));
vi.mock('@/hooks/useAttentionCount', () => ({ useAttentionCount: () => 3 }));

function stubMedia(matching: string[]) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.some((m) => query.includes(m)),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const shell = (ui: React.ReactNode, path = '/') =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => { try { window.localStorage.clear(); } catch { /* jsdom */ } });
afterEach(() => vi.unstubAllGlobals());

describe('<BottomTabs> (P1)', () => {
  it('announces the "to check" count on Home', () => {
    shell(<BottomTabs />);
    expect(screen.getByRole('link', { name: 'Home, 3 to check' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Activity' })).toBeTruthy();
  });
});

describe('<Sidebar> (P2)', () => {
  it('lists Review and Settings, with the count on Review only', () => {
    shell(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Review, 3 to check' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });

  it('collapses to a rail and remembers it', () => {
    stubMedia(['min-width: 1024px']);
    shell(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(window.localStorage.getItem('cashe-sidebar')).toBe('collapsed');
    expect(document.querySelector('aside')!.className).toContain('w-[4.25rem]');
  });

  it('toggles with ⌘⌥S', () => {
    stubMedia(['min-width: 1024px']);
    shell(<Sidebar />);
    fireEvent.keyDown(window, { code: 'KeyS', metaKey: true, altKey: true });
    expect(window.localStorage.getItem('cashe-sidebar')).toBe('collapsed');
  });
});

function Detail() {
  const back = useStackBack();
  return <button type="button" onClick={back}>Back to Activity</button>;
}

describe('<ListDetail> (P6, P7)', () => {
  it('on md+ shows list and detail side by side as named regions', () => {
    stubMedia([]);
    shell(<ListDetail listLabel="Transactions" list={<p>List</p>} detail={<p>Kopitiam</p>} onClose={() => {}} />);
    expect(screen.getByRole('region', { name: 'Transactions' }).textContent).toBe('List');
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toBe('Kopitiam');
  });

  it('on md+ shows the empty detail when nothing is selected', () => {
    stubMedia([]);
    shell(<ListDetail listLabel="Transactions" list={<p>List</p>} detail={null} emptyDetail={<p>Choose a transaction</p>} onClose={() => {}} />);
    expect(screen.getByText('Choose a transaction')).toBeTruthy();
  });

  it('on md+ closes the detail with Escape and deletes with ⌫ from the list', () => {
    stubMedia([]);
    const onClose = vi.fn();
    const onDelete = vi.fn();
    shell(<ListDetail listLabel="Transactions" list={<button type="button" data-list-row="">Row</button>} detail={<p>Kopitiam</p>} onClose={onClose} onDeleteSelected={onDelete} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByText('Row'), { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('on md+ moves focus between rows with the arrow keys', () => {
    stubMedia([]);
    shell(<ListDetail listLabel="Transactions" onClose={() => {}} detail={null}
      list={<>{['A', 'B', 'C'].map((t) => <button key={t} type="button" data-list-row="">{t}</button>)}</>} />);
    Element.prototype.scrollIntoView = () => {};
    screen.getByText('A').focus();
    fireEvent.keyDown(screen.getByText('A'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('B');
    fireEvent.keyDown(screen.getByText('B'), { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('A');
  });

  it('on a phone pushes the detail over a list that stays mounted but inert', () => {
    stubMedia(['max-width: 767px']);
    shell(<ListDetail listLabel="Transactions" list={<p>List</p>} detail={<Detail />} onClose={() => {}} />);
    const list = screen.getByText('List').parentElement!;
    expect(list.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: 'Back to Activity' })).toBeTruthy();
  });

  it("on a phone gives the detail a back action that leaves it", () => {
    stubMedia(['max-width: 767px']);
    const onClose = vi.fn();
    shell(<ListDetail listLabel="Transactions" list={<p>List</p>} detail={<Detail />} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Activity' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function Overlay({ open, onBack }: { open: boolean; onBack: () => boolean }) {
  useHistoryEntry(open, onBack);
  return null;
}

describe('useHistoryEntry', () => {
  it('adds an entry while open and removes it when closed from the UI', () => {
    const start = window.history.length;
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender } = render(<Overlay open onBack={() => true} />);
    expect(window.history.length).toBe(start + 1);
    expect(window.history.state.casheOverlay).toBeTruthy();
    rerender(<Overlay open={false} onBack={() => true} />);
    expect(back).toHaveBeenCalledOnce();
    back.mockRestore();
  });

  it('closes on Back, and restores the entry when the close is refused', () => {
    const onBack = vi.fn(() => false);
    render(<Overlay open onBack={onBack} />);
    const before = window.history.length;
    act(() => { window.history.replaceState({}, ''); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(onBack).toHaveBeenCalledOnce();
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state.casheOverlay).toBeTruthy();
  });
});
