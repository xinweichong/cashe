import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NavBar } from '@/components/ui/nav-bar';
import { Toolbar, ToolbarAction } from '@/components/ui/toolbar';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useStackBack, useStackLabel } from '@/components/layout/stackContext';

// Building blocks shared by the Plan, subscription and merchant detail panels.

// Direction B (P3/P12, 2026-10-01): a detail's persistent chrome. A pushed
// page on a phone gets the nav bar with a back button named for its parent;
// an md+ inspector gets the toolbar with Done, its title the pane's heading.
// Extra actions sit beside them.
export function DetailHeader({ title, subtitle, onClose, actions }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const isPhone = useIsPhone();
  const stackBack = useStackBack();
  const backLabel = useStackLabel();
  return (
    <div className="shrink-0">
      {isPhone
        ? <NavBar title={title} back={{ label: backLabel, onClick: stackBack }} trailing={actions} />
        : <Toolbar title={<h2 className="truncate">{title}</h2>} trailing={<>{actions}<ToolbarAction tone="strong" onClick={onClose}>Done</ToolbarAction></>} />}
      {subtitle && <div className="px-4 pt-3">{subtitle}</div>}
    </div>
  );
}

/** A panel whose record hasn't loaded yet. */
export function DetailLoading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <DetailHeader title={title} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4"><p className="text-sm text-muted">Catching up…</p></div>
    </div>
  );
}

export function StatTiles({ items, columns = 2 }: {
  items: { label: string; value: string; color?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <div className={cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {items.map(({ label, value, color }) => (
        <div key={label} className="rounded-[12px] bg-fill-press p-3">
          <p className="text-xs text-muted">{label}</p>
          <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-foreground" style={color ? { color } as CSSProperties : undefined}>{value}</p>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDestructive({ message, confirmLabel = 'Delete', pending, onConfirm, onCancel }: {
  message: ReactNode;
  confirmLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3 rounded-md border border-destructive/30 bg-destructive/10 space-y-2">
      <p className="text-sm text-foreground">{message}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
          {pending ? 'Deleting…' : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('font-display text-base font-bold text-foreground', className)}>{children}</h3>;
}
