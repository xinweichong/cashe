import type { KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn, getCategoryColor } from '@/lib/utils';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';

interface ActivityRowShellProps {
  /** DOM id for the row element — lets a caller return focus to it. */
  id?: string;
  category: string | null | undefined;
  isIncome?: boolean;
  selected?: boolean;
  /** Navigates via a real <Link> — use for a row that always goes somewhere (Home's recent activity, Evidence). */
  href?: string;
  /** Row toggles/opens in place rather than navigating (Activity's list, which manages selection/detail state itself). */
  onClick?: () => void;
  /** Overrides the category-initial avatar — e.g. Activity's bulk-selection checkbox. Receives the row's own computed category color so it never drifts from the category label. */
  avatarSlot?: (categoryColor: string) => ReactNode;
  title: ReactNode;
  /** The row's primary meta text (timestamp, date) — the category name itself is appended automatically. */
  metaPrimary: ReactNode;
  /** Pre-formatted, already-signed amount text — this component never formats money itself (Home's reporting-SGD values and Activity's original-currency values are not interchangeable; see docs plan §3). */
  amount: ReactNode;
  amountSub?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * The shared shell behind every transaction-like row (Activity, Evidence,
 * Explore's "Worth a look"). Purely presentational: callers own money
 * formatting and navigation semantics (href vs. onClick).
 *
 * Direction B (P4, HIG alignment 2026-10-01): the grouped-list row. Square,
 * on the group's card surface, separated by hairlines inset to the text
 * start; pressed and hover fills; the opened row is a teal fill that becomes
 * an inset pill on md+; a multi-select row (avatarSlot) takes a neutral fill
 * instead. Category identity lives in the avatar, so the meta line is plain
 * text. Rows stack below an 18rem group width (Larger text, 200% zoom).
 */
export function ActivityRowShell({
  id, category, isIncome = false, selected = false, href, onClick,
  avatarSlot, title, metaPrimary, amount, amountSub, trailing, className,
}: ActivityRowShellProps) {
  const categoryColor = getCategoryColor(category ?? 'Other');
  const isClickable = !!href || !!onClick;
  const multiSelect = !!avatarSlot;
  const onTeal = selected && !multiSelect;

  const rowClassName = cn(
    'separator-inset flex w-full min-h-row items-center gap-3 bg-card px-3 py-2 text-left text-sm',
    '@max-[18rem]:flex-wrap',
    isClickable && 'pressable cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    onTeal && 'bg-teal text-on-teal hover:bg-teal active:bg-teal md:mx-1 md:my-0.5 md:w-[calc(100%-0.5rem)] md:rounded-inset',
    selected && multiSelect && 'bg-fill-press',
    className,
  );
  const muted = onTeal ? 'text-on-teal/80' : 'text-muted';
  const style = { '--separator-inset': '3.5rem' } as React.CSSProperties;

  const content = (
    <>
      <span className="flex w-8 shrink-0 justify-center">
        {avatarSlot ? avatarSlot(categoryColor) : <CategoryAvatar category={category} isIncome={isIncome} className="rounded-full" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className={cn('block truncate text-xs', muted)}>
          {metaPrimary}{category && <> · {category}</>}
        </span>
      </span>
      <span className="shrink-0 text-right @max-[18rem]:basis-full @max-[18rem]:pl-11 @max-[18rem]:text-left">
        <span data-testid="tx-amount" className={cn('block font-mono text-sm font-medium tabular-nums', isIncome && !onTeal && 'text-success')}>
          {amount}
        </span>
        {amountSub && <span className={cn('block max-w-[6rem] truncate text-xs', muted)}>{amountSub}</span>}
      </span>
      {trailing}
    </>
  );

  if (href) {
    return (
      <Link id={id} to={href} className={rowClassName} style={style} data-list-row="" aria-current={selected ? 'page' : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <div
      id={id}
      className={rowClassName}
      style={style}
      data-list-row={isClickable ? '' : undefined}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-current={selected && !multiSelect ? 'true' : undefined}
      aria-pressed={multiSelect ? selected : undefined}
      onKeyDown={isClickable ? (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return; // never let a nested control activate the row
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
    >
      {content}
    </div>
  );
}
