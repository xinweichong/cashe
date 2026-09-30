import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskSheet } from '../task-sheet';

function stubPhone(isPhone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isPhone && query.includes('max-width: 767px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

const base = { open: true, title: 'Filters', children: <p>Body</p> };

describe('<TaskSheet> (P5)', () => {
  it('is a titled dialog with Cancel and the confirming action', () => {
    const onClick = vi.fn();
    render(<TaskSheet {...base} onOpenChange={() => {}} confirm={{ label: 'Done', onClick }} />);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('closes on Cancel when nothing is unsaved', () => {
    const onOpenChange = vi.fn();
    render(<TaskSheet {...base} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks before discarding unsaved input, and can keep editing', () => {
    const onOpenChange = vi.fn();
    render(<TaskSheet {...base} dirty onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Discard changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('routes Escape through the same discard check', () => {
    const onOpenChange = vi.fn();
    render(<TaskSheet {...base} dirty onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the pending label on the confirming action', () => {
    render(<TaskSheet {...base} onOpenChange={() => {}} confirm={{ label: 'Add', onClick: () => {}, pending: true, pendingLabel: 'Adding…' }} />);
    expect((screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rises from the bottom on a phone, at its first detent', () => {
    stubPhone(true);
    render(<TaskSheet {...base} onOpenChange={() => {}} detents={['medium', 'large']} />);
    expect(screen.getByRole('dialog').getAttribute('data-detent')).toBe('medium');
  });

  it('opens large when asked, e.g. for keyboard entry', () => {
    stubPhone(true);
    render(<TaskSheet {...base} onOpenChange={() => {}} initialDetent="large" />);
    expect(screen.getByRole('dialog').getAttribute('data-detent')).toBe('large');
  });

  it('is a centred dialog with no detents on md+', () => {
    stubPhone(false);
    render(<TaskSheet {...base} onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog').hasAttribute('data-detent')).toBe(false);
  });
});
