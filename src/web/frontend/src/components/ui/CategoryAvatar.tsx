import { cn, getCategoryColor } from '@/lib/utils';

interface CategoryAvatarProps {
  category: string | null | undefined;
  isIncome?: boolean;
  /** "detail" is the 40px header size (approved P4/U09, 2026-09-25). */
  size?: 'row' | 'detail';
  /** Replaces the initial, e.g. the category's chosen icon in detail headers. */
  glyph?: string;
  className?: string;
}

/**
 * The 20%-tint category-initial (or income "+") glyph shared across
 * Activity, Home and Evidence rows — docs plan §4. Decorative: every caller
 * shows the category name as visible adjacent text, so this is aria-hidden
 * rather than duplicating an accessible name.
 */
export function CategoryAvatar({ category, isIncome = false, size = 'row', glyph, className }: CategoryAvatarProps) {
  const color = getCategoryColor(category ?? 'Other');
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-md flex items-center justify-center font-bold shrink-0',
        size === 'detail' ? 'w-10 h-10 text-lg' : 'w-8 h-8 text-sm',
        className,
      )}
      style={{ background: `${color}33`, color }}
    >
      {isIncome ? '+' : glyph ?? category?.charAt(0) ?? '·'}
    </div>
  );
}
