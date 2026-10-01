import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavBar } from '../nav-bar';
import { Toolbar, ToolbarAction } from '../toolbar';

describe('<Toolbar> (P12)', () => {
  it('is a labelled toolbar holding its actions', () => {
    render(<Toolbar title="Transaction" trailing={<><ToolbarAction>Edit</ToolbarAction><ToolbarAction tone="destructive">Delete</ToolbarAction></>} />);
    expect(screen.getByRole('toolbar', { name: 'Transaction' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('text-destructive');
  });

  it('shows the pending label and blocks repeat presses while saving', () => {
    const onClick = vi.fn();
    render(<ToolbarAction tone="strong" pending pendingLabel="Saving…" onClick={onClick}>Save</ToolbarAction>);
    const button = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('<NavBar> (P3)', () => {
  let callback: IntersectionObserverCallback | undefined;
  beforeEach(() => {
    callback = undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) { callback = cb; }
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const scrollTitle = (isIntersecting: boolean) =>
    act(() => callback?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));

  it('gives a tab root one h1, the large title, and hides the inline copy', () => {
    render(<MemoryRouter><NavBar large title="Activity" /></MemoryRouter>);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].className).toContain('text-large-title');
    expect(document.querySelector('header')!.hasAttribute('data-collapsed')).toBe(false);
  });

  it('collapses into a frosted bar once the large title scrolls under it', () => {
    render(<MemoryRouter><NavBar large title="Activity" /></MemoryRouter>);
    scrollTitle(false);
    expect(document.querySelector('header')!.hasAttribute('data-collapsed')).toBe(true);
    scrollTitle(true);
    expect(document.querySelector('header')!.hasAttribute('data-collapsed')).toBe(false);
  });

  it('shows a pushed page with an inline h1 and a back link named for its parent', () => {
    render(<MemoryRouter><NavBar title="By category" back={{ label: 'Explore', to: '/explore' }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'By category' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore' }).getAttribute('href')).toBe('/explore');
    expect(document.querySelector('header')!.hasAttribute('data-collapsed')).toBe(true);
  });

  it('supports a back action instead of a link', () => {
    const onClick = vi.fn();
    render(<MemoryRouter><NavBar title="Transaction" back={{ label: 'Activity', onClick }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
