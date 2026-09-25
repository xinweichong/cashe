import { useId } from 'react';
import { cn, PALETTE } from '@/lib/utils';

// Approved shared owners (P7/U19, 2026-09-25): category icon and colour
// choice for Settings' create and edit flows. Native radios give checked
// state and arrow-key movement; each option has a 44px hit area.

const CATEGORY_ICONS = [
  '🍜', '🚗', '🛒', '📄', '🎬', '📌', '💰', '🏥', '✈️', '🎓',
  '🏠', '💎', '🎮', '📱', '🏋️', '🎨', '🐾', '🎁', '☕', '🍕',
  '👕', '💊', '🔧', '🎵', '📖', '🌺', '⚡', '🎪', '🌊', '🍀',
];

const OPTION = 'flex h-11 w-11 items-center justify-center rounded-sm border transition-colors duration-[var(--dur-fast)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

export function CategoryIconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
      {CATEGORY_ICONS.map((icon) => (
        <label
          key={icon}
          className={cn(OPTION, 'cursor-pointer text-lg', value === icon ? 'border-teal/40 bg-teal/13' : 'border-transparent hover:bg-foreground/5')}
        >
          <input type="radio" name={name} value={icon} checked={value === icon} onChange={() => onChange(icon)} className="sr-only" aria-label={`Icon ${icon}`} />
          {icon}
        </label>
      ))}
    </div>
  );
}

export function CategoryColorPicker({ value, onChange, taken }: { value: string; onChange: (color: string) => void; taken: (color: string) => boolean }) {
  const name = useId();
  const anyTaken = PALETTE.some(taken);
  return (
    <div className="space-y-1">
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1">
        {PALETTE.map((color) => {
          const unavailable = taken(color);
          return (
            <label
              key={color}
              className={cn(OPTION, 'border-transparent', unavailable ? 'cursor-not-allowed opacity-30' : 'cursor-pointer')}
            >
              <input
                type="radio"
                name={name}
                value={color}
                checked={value === color}
                disabled={unavailable}
                onChange={() => onChange(color)}
                className="sr-only"
                aria-label={unavailable ? `${color} (used by another category)` : color}
              />
              <span
                aria-hidden
                className={cn('h-7 w-7 rounded-full', value === color && 'ring-2 ring-foreground ring-offset-2 ring-offset-card-elev')}
                style={{ backgroundColor: color }}
              />
            </label>
          );
        })}
      </div>
      {anyTaken && <p className="text-xs text-muted">Faded colours are already used by other categories.</p>}
    </div>
  );
}
