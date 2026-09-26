import type { ReactNode } from 'react';
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
  /** Overrides the category-initial avatar — e.g. Activity's bulk-selection checkbox. Receives the row's own computed category color so it never drifts from the pill/background tint. */
  avatarSlot?: (categoryColor: string) => ReactNode;
  title: ReactNode;
  /** The row's primary meta text (timestamp, date) — the category name itself is appended automatically as a tinted pill. */
  metaPrimary: ReactNode;
  /** Pre-formatted, already-signed amount text — this component never formats money itself (Home's reporting-SGD values and Activity's original-currency values are not interchangeable; see docs plan §3). */
  amount: ReactNode;
  amountSub?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * The shared visual shell behind every transaction-like row in the app —
 * Activity/Finance's TransactionRow and Home's Recent activity both render
 * through this so the two never drift in appearance again. Purely
 * presentational: callers own money formatting and navigation semantics
 * (href vs. onClick); this only owns layout, the category tint/hover
 * treatment, the avatar, and the category pill.
 */
export function ActivityRowShell({
  id, category, isIncome = false, selected = false, href, onClick,
  avatarSlot, title, metaPrimary, amount, amountSub, trailing, className,
}: ActivityRowShellProps) {
  const categoryColor = getCategoryColor(category ?? 'Other');
  const isClickable = !!href || !!onClick;

  const rowClassName = cn(
    'grid gap-3 items-center px-3.5 py-2.5 border-b border-border/30 last:border-b-0',
    'transition-[background,transform] duration-[150ms]',
    trailing ? 'grid-cols-[36px_1fr_auto_auto]' : 'grid-cols-[36px_1fr_auto]',
    isClickable && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    className,
  );
  const rowStyle = { background: `${categoryColor}${selected ? '1A' : '0D'}` };
  const onMouseEnter = isClickable ? (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = `${categoryColor}1A`;
    e.currentTarget.style.transform = 'translateY(-1px)';
  } : undefined;
  const onMouseLeave = isClickable ? (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = `${categoryColor}${selected ? '1A' : '0D'}`;
    e.currentTarget.style.transform = '';
  } : undefined;

  const content = (
    <>
      {avatarSlot ? avatarSlot(categoryColor) : <CategoryAvatar category={category} isIncome={isIncome} />}
      <div className="min-w-0">
        <div className="text-sm font-medium tracking-[-0.005em] truncate">{title}</div>
        <div className="font-mono text-2xs text-muted uppercase tracking-[0.06em] mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{metaPrimary}</span>
          {category && (
            <span
              className="px-1 py-0.5 rounded text-2xs font-semibold font-mono uppercase tracking-[0.08em]"
              style={{ color: categoryColor, background: `${categoryColor}1F` }}
            >
              {category}
            </span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div data-testid="tx-amount" className={cn('font-bold tracking-tight text-sm font-display', isIncome && 'text-teal')}>
          {amount}
        </div>
        {amountSub && <div className="text-2xs text-muted font-mono mt-0.5 truncate max-w-[80px]">{amountSub}</div>}
      </div>
      {trailing}
    </>
  );

  if (href) {
    return (
      <Link id={id} to={href} className={rowClassName} style={rowStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {content}
      </Link>
    );
  }
  return (
    <div
      id={id}
      className={rowClassName}
      style={rowStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
    >
      {content}
    </div>
  );
}
