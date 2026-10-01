import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwipeRow, type SwipeAction } from '../swipe-row';

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

const setup = (onDelete = vi.fn(), onCategory = vi.fn()) => {
  const trailing: SwipeAction[] = [{ label: 'Delete', tone: 'destructive', confirm: 'Delete S$4.50?', onAction: onDelete }];
  const leading: SwipeAction[] = [{ label: 'Category', tone: 'warm', onAction: onCategory }];
  render(<SwipeRow leadingActions={leading} trailingActions={trailing}><div>Kopitiam</div></SwipeRow>);
  return { onDelete, onCategory };
};

describe('<SwipeRow> (P8)', () => {
  it('leaves the row untouched with a fine pointer (RowMenu carries the actions)', () => {
    stubPointer(false);
    setup();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.getByText('Kopitiam')).toBeTruthy();
  });

  it('keeps unrevealed actions out of the tab order and hidden from assistive tech', () => {
    stubPointer(true);
    setup();
    const del = screen.getByText('Delete');
    expect(del.getAttribute('tabindex')).toBe('-1');
    expect(del.parentElement!.getAttribute('aria-hidden')).toBe('true');
  });

  it('runs a plain action straight away', () => {
    stubPointer(true);
    const { onCategory } = setup();
    fireEvent.click(screen.getByText('Category'));
    expect(onCategory).toHaveBeenCalledOnce();
  });

  it('turns Delete into its own confirmation, then deletes', () => {
    stubPointer(true);
    const { onDelete } = setup();
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete S$4.50?' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('cancels the confirmation without deleting', () => {
    stubPointer(true);
    const { onDelete } = setup();
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Kopitiam')).toBeTruthy();
  });
});
