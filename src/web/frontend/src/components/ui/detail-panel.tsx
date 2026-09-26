import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Building blocks shared by the Plan, subscription and merchant detail panels.

export function DetailHeader({ title, subtitle, onClose }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void }) {
  return (
    <div className="shrink-0 flex items-start justify-between p-4 border-b border-border">
      <div>
        <h2 className="text-lg font-bold font-display tracking-tight text-foreground">{title}</h2>
        {subtitle}
      </div>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></Button>
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
        <div key={label} className="bg-background rounded-lg p-3 border border-border">
          <p className="text-2xs font-mono uppercase tracking-[0.06em] text-muted">{label}</p>
          <p className="text-sm font-display font-bold text-foreground mt-0.5" style={color ? { color } as CSSProperties : undefined}>{value}</p>
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
  return <p className={cn('text-2xs font-mono font-semibold uppercase tracking-[0.22em] text-muted', className)}>{children}</p>;
}
