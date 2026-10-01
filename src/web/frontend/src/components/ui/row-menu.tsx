import { useRef, useState, type ReactNode } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Approved shared owner (P9, HIG alignment 2026-10-01): the row's context
// menu. Long-press on touch, right-click with a pointer, and the keyboard
// context-menu key all open it (Radix). While open, the row lifts above a
// scrim. Every action here is also reachable from the detail page; Delete
// never deletes directly: its onSelect opens the caller's confirmation.

export type RowMenuItem =
  | { separator: true }
  | {
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
      hidden?: boolean;
    };

interface RowMenuProps {
  items: readonly RowMenuItem[];
  /** The row. Must be a single element that can hold a ref. */
  children: ReactNode;
  disabled?: boolean;
}

export function RowMenu({ items, children, disabled = false }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  // An item that opens its own dialog (Delete's confirmation) must wait for
  // the menu to close: otherwise the menu's focus return and the dialog's
  // focus trap pull focus back and forth. Run it once the menu has closed,
  // and skip the focus return, since the dialog takes focus.
  const pending = useRef<(() => void) | null>(null);
  const skipFocusReturn = useRef(false);
  const visible = items.filter((item) => !('label' in item) || !item.hidden);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && pending.current) {
      const action = pending.current;
      pending.current = null;
      setTimeout(action, 0);
    }
  };
  return (
    <ContextMenuPrimitive.Root modal onOpenChange={onOpenChange}>
      {open && <div aria-hidden className="overlay-motion fixed inset-0 z-40 bg-scrim backdrop-blur-[3px]" data-state="open" />}
      <ContextMenuPrimitive.Trigger
        asChild
        disabled={disabled}
        className="relative block transition-[transform,box-shadow] duration-[var(--dur-fast)] data-[state=open]:z-50 data-[state=open]:scale-[1.02] data-[state=open]:rounded-[16px] data-[state=open]:shadow-lift motion-reduce:data-[state=open]:scale-100 [-webkit-touch-callout:none]"
      >
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          collisionPadding={12}
          onCloseAutoFocus={(e) => { if (skipFocusReturn.current) { skipFocusReturn.current = false; e.preventDefault(); } }}
          className="pop-motion z-50 min-w-[14rem] overflow-hidden rounded-[14px] bg-card-elev text-sm text-foreground shadow-elev-md origin-[--radix-context-menu-content-transform-origin]"
        >
          {visible.map((item, i) =>
            'separator' in item
              ? <ContextMenuPrimitive.Separator key={`sep-${i}`} className="h-1.5 bg-fill-press" />
              : (
                <ContextMenuPrimitive.Item
                  key={item.label}
                  disabled={item.disabled}
                  onSelect={() => { pending.current = item.onSelect; skipFocusReturn.current = true; }}
                  className={cn(
                    'flex min-h-11 cursor-default select-none items-center justify-between gap-6 px-3.5 outline-none',
                    'border-t-[0.5px] border-separator first:border-t-0 [[role=separator]+&]:border-t-0',
                    'data-[highlighted]:bg-fill-press data-[disabled]:opacity-45',
                    item.destructive && 'text-destructive',
                  )}
                >
                  {item.label}
                  {item.icon && <item.icon aria-hidden className="h-4 w-4 shrink-0" />}
                </ContextMenuPrimitive.Item>
              ),
          )}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
