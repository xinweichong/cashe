import { cn, getCategoryColor } from '@/lib/utils';

interface CategoryAvatarProps {
  category: string | null | undefined;
  isIncome?: boolean;
  className?: string;
}

/**
 * The 20%-tint category-initial (or income "+") glyph shared across
 * Activity, Home and Evidence rows — docs plan §4. Decorative: every caller
 * shows the category name as visible adjacent text, so this is aria-hidden
 * rather than duplicating an accessible name.
 */
export function CategoryAvatar({ category, isIncome = false, className }: CategoryAvatarProps) {
  const color = getCategoryColor(category ?? 'Other');
  return (
    <div
      aria-hidden
      className={cn('w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold shrink-0', className)}
      style={{ background: `${color}33`, color }}
    >
      {isIncome ? '+' : category?.charAt(0) ?? '·'}
    </div>
  );
}
