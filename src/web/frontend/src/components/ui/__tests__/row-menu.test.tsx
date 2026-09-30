import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2 } from 'lucide-react';
import { RowMenu } from '../row-menu';

function open(onDelete = vi.fn(), onEdit = vi.fn()) {
  render(
    <RowMenu items={[
      { label: 'Edit', icon: Pencil, onSelect: onEdit },
      { label: 'Add to trip', onSelect: () => {}, hidden: true },
      { separator: true },
      { label: 'Delete', icon: Trash2, destructive: true, onSelect: onDelete },
    ]}>
      <div>Kopitiam</div>
    </RowMenu>,
  );
  fireEvent.contextMenu(screen.getByText('Kopitiam'));
  return { onDelete, onEdit };
}

describe('<RowMenu> (P9)', () => {
  it('opens a menu of the row actions on right-click', () => {
    open();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Delete']);
  });

  it('hides items marked hidden (a disabled feature)', () => {
    open();
    expect(screen.queryByRole('menuitem', { name: 'Add to trip' })).toBeNull();
  });

  it('runs the chosen action and styles Delete as destructive', () => {
    const { onDelete } = open();
    const del = screen.getByRole('menuitem', { name: 'Delete' });
    expect(del.className).toContain('text-destructive');
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('lifts the row while the menu is open', () => {
    open();
    expect(screen.getByText('Kopitiam').getAttribute('data-state')).toBe('open');
  });
});
