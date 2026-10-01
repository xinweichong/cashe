import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Approved shared owner (P12, HIG alignment 2026-10-01): the pinned, frosted
// action bar above a detail view. It carries the Persistent Chrome rule:
// actions stay visible while the content scrolls beneath. Callers compose
// view / edit / select modes from ToolbarActions (Edit · Delete, Cancel ·
// Save, "3 selected" · Category · Delete); on a phone the same actions sit
// in the nav bar's trailing slot (P3).

interface ToolbarProps {
  title?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function Toolbar({ title, leading, trailing, className }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label={typeof title === 'string' ? title : undefined}
      className={cn('chrome-frosted sticky top-0 z-20 flex min-h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2', className)}>
      {leading && <div className="flex items-center gap-0.5">{leading}</div>}
      {title && <div className="min-w-0 flex-1 truncate px-1 text-headline font-semibold">{title}</div>}
      {!title && <div className="flex-1" />}
      {trailing && <div className="flex items-center gap-0.5">{trailing}</div>}
    </div>
  );
}

interface ToolbarActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 'strong' for the confirming action (Save, Done); 'destructive' for Delete. */
  tone?: 'default' | 'strong' | 'destructive';
  /** Shown in place of the label while the action runs, e.g. "Saving…". */
  pendingLabel?: string;
  pending?: boolean;
}

export function ToolbarAction({ tone = 'default', pending = false, pendingLabel, disabled, className, children, ...props }: ToolbarActionProps) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        'pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-[8px] px-2.5 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'destructive' ? 'text-destructive' : 'text-teal',
        tone === 'strong' ? 'font-bold' : 'font-medium',
        className,
      )}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
