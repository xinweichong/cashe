import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ListGroup, ListRow } from '../list';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('<ListGroup>', () => {
  it('labels the section with its heading', () => {
    wrap(<ListGroup title="Coming up"><ListRow title="Spotify" /></ListGroup>);
    expect(screen.getByRole('region', { name: 'Coming up' })).toBeTruthy();
  });

  it('renders no heading or label when untitled', () => {
    wrap(<ListGroup><ListRow title="Spotify" /></ListGroup>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('<ListRow>', () => {
  it('navigates with a real link when given `to`', () => {
    wrap(<ListRow to="/plan" title="Plan" trailing="chevron" />);
    expect(screen.getByRole('link', { name: /Plan/ }).getAttribute('href')).toBe('/plan');
  });

  it('acts in place as a button when given onClick', () => {
    const onClick = vi.fn();
    wrap(<ListRow onClick={onClick} title="Filters" />);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is static and unpressable without to or onClick', () => {
    const { container } = wrap(<ListRow title="Paid with" value="Apple Wallet" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('DIV');
    expect(row.className).not.toContain('pressable');
  });

  it('gives interactive rows the pressed state and the row height', () => {
    wrap(<ListRow onClick={() => {}} title="Category" />);
    const className = screen.getByRole('button').className;
    expect(className).toContain('pressable');
    expect(className).toContain('min-h-row');
  });

  it('marks the selected row as current and fills it teal, as an inset pill on md+', () => {
    wrap(<ListRow onClick={() => {}} selected title="Kopitiam" />);
    const row = screen.getByRole('button');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.className).toContain('bg-teal');
    expect(row.className).toContain('md:rounded-inset');
  });

  it('disables the button and drops the pressed state', () => {
    const onClick = vi.fn();
    wrap(<ListRow onClick={onClick} disabled title="Trip" />);
    const row = screen.getByRole('button');
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.className).not.toContain('pressable');
  });

  it('renders a disabled link row as plain text, not a link', () => {
    wrap(<ListRow to="/x" disabled title="Locked" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sets money in mono and never formats it', () => {
    wrap(<ListRow title="Grab" amount="S$12.40" />);
    expect(screen.getByText('S$12.40').className).toContain('font-mono');
  });

  it('insets the separator to the text start when there is a leading avatar', () => {
    const { container } = wrap(<ListRow title="Grab" leading={<span />} />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--separator-inset')).toBe('3.5rem');
  });

  it('colours the title destructive for destructive rows', () => {
    wrap(<ListRow onClick={() => {}} destructive title="Delete transaction" />);
    expect(screen.getByText('Delete transaction').className).toContain('text-destructive');
  });
});
