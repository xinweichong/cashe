import { useEffect, type RefObject } from 'react';

// Mac list conventions for a split view's list column (P7): ↑/↓ move focus
// between rows (selection follows only on ↩, the row's own activation),
// ⌫/Delete asks to delete the selected item, Esc closes the detail, and
// ⌘F focuses the page's search field ([data-list-search]).
export function useListKeyboard(
  listRef: RefObject<HTMLElement | null>,
  { onDelete, onEscape, enabled = true }: { onDelete?: () => void; onEscape?: () => void; enabled?: boolean },
) {
  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;

    const rows = () => Array.from(list.querySelectorAll<HTMLElement>('[data-list-row]'));
    const onListKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = rows();
        if (!all.length) return;
        e.preventDefault();
        const current = all.indexOf(document.activeElement as HTMLElement);
        const next = current === -1 ? 0 : Math.min(all.length - 1, Math.max(0, current + (e.key === 'ArrowDown' ? 1 : -1)));
        all[next].focus();
        all[next].scrollIntoView({ block: 'nearest' });
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && onDelete) {
        e.preventDefault();
        onDelete();
      }
    };
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape && !document.querySelector('[role="dialog"], [role="menu"]')) onEscape();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const search = document.querySelector<HTMLElement>('[data-list-search]');
        if (search) { e.preventDefault(); search.focus(); }
      }
    };
    list.addEventListener('keydown', onListKey);
    window.addEventListener('keydown', onWindowKey);
    return () => {
      list.removeEventListener('keydown', onListKey);
      window.removeEventListener('keydown', onWindowKey);
    };
  }, [listRef, onDelete, onEscape, enabled]);
}
