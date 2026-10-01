import { useId, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Approved shared owner (P4, HIG alignment 2026-10-01): the grouped list.
// An inset group with an 18px outer radius holds square rows separated by
// hairlines inset to the text start (iOS Settings). On md+ the selected row
// becomes a 12px inset pill (iPad/Mac sidebars and list columns). The group
// is a size container: rows stack title / detail / value once it is narrower
// than 18rem, which happens at the Larger text size or 200% zoom.

interface ListGroupProps {
  /** Plus Jakarta group heading above the rows. */
  title?: ReactNode;
  /** Trailing link or control beside the heading, e.g. "See all". */
  action?: ReactNode;
  /** Caption under the group (explanations, footnotes). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ListGroup({ title, action, footer, children, className }: ListGroupProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={title ? headingId : undefined} className={cn('min-w-0', className)}>
      {(title || action) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
          {title && <h2 id={headingId} className="font-display text-lg font-bold tracking-[-0.01em] text-foreground">{title}</h2>}
          {action && <div className="shrink-0 text-sm">{action}</div>}
        </div>
      )}
      <div className="@container overflow-hidden rounded-group bg-card">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-xs text-muted">{footer}</p>}
    </section>
  );
}

interface ListRowProps {
  /** Navigates with a real link. */
  to?: string;
  /** Acts in place (opens a sheet, selects in a split view). */
  onClick?: () => void;
  /** Avatar or icon; sets the separator inset to the text start. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Plain trailing value (muted), e.g. a setting's current choice. */
  value?: ReactNode;
  /** Pre-formatted money, set in mono. The row never formats money itself. */
  amount?: ReactNode;
  /** 'chevron' for navigation rows; any node (a Switch, a Badge) otherwise. */
  trailing?: 'chevron' | ReactNode;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

export function ListRow({
  to, onClick, leading, title, subtitle, value, amount, trailing,
  selected = false, destructive = false, disabled = false, id, className, ...aria
}: ListRowProps) {
  const interactive = !disabled && (!!to || !!onClick);
  const rowClass = cn(
    'separator-inset flex w-full min-h-row items-center gap-3 px-3 py-2 text-left text-sm',
    '@max-[18rem]:flex-col @max-[18rem]:items-start @max-[18rem]:gap-1',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    interactive && 'pressable cursor-pointer',
    selected && 'bg-teal text-on-teal md:mx-1 md:my-0.5 md:w-[calc(100%-0.5rem)] md:rounded-inset',
    disabled && 'cursor-not-allowed opacity-45',
    className,
  );
  // Text start: 0.75rem padding + 2rem avatar + 0.75rem gap.
  const style = { '--separator-inset': leading ? '3.5rem' : '0.75rem' } as CSSProperties;
  const muted = selected ? 'text-on-teal/80' : 'text-muted';

  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading && <span className="shrink-0">{leading}</span>}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium @max-[18rem]:whitespace-normal', destructive && !selected && 'text-destructive')}>{title}</span>
          {subtitle && <span className={cn('block truncate text-xs @max-[18rem]:whitespace-normal', muted)}>{subtitle}</span>}
        </span>
      </div>
      {(value || amount || trailing) && (
        <div className="flex shrink-0 items-center gap-2 @max-[18rem]:pl-11">
          {value && <span className={cn('text-sm', muted)}>{value}</span>}
          {amount && <span className="font-mono text-sm font-medium tabular-nums">{amount}</span>}
          {trailing === 'chevron'
            ? <ChevronRight aria-hidden className={cn('h-4 w-4 opacity-60', muted)} />
            : trailing}
        </div>
      )}
    </>
  );

  // data-list-row: the split view's arrow-key focus moves between these.
  const shared = { id, className: rowClass, style, 'aria-label': aria['aria-label'], 'data-list-row': '' };
  if (to && !disabled) {
    return <Link {...shared} to={to} aria-current={selected ? 'page' : undefined}>{content}</Link>;
  }
  if (onClick) {
    return (
      <button {...shared} type="button" onClick={onClick} disabled={disabled} aria-current={selected ? 'true' : undefined}>
        {content}
      </button>
    );
  }
  return <div {...shared} aria-disabled={disabled || undefined}>{content}</div>;
}
