import * as React from "react"

import { cn } from "@/lib/utils"

// Approved shared owner (P1/U04, 2026-09-25): a selectable filter or choice
// chip. Not a command (Button), a read-only label (Badge) or a panel switch
// (Tabs). It is a pressed toggle; single-choice rows set exactly one selected.
interface ChoiceChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  selected: boolean
  onSelectedChange?: (selected: boolean) => void
  tone?: "neutral" | "warning"
  /** Category identity colour (from getCategoryColor); overrides tone. */
  categoryColor?: string
}

const ChoiceChip = React.forwardRef<HTMLButtonElement, ChoiceChipProps>(
  ({ selected, onSelectedChange, tone = "neutral", categoryColor, className, style, onClick, ...props }, ref) => {
    const categoryStyle: React.CSSProperties | undefined = categoryColor ? {
      // Mixed toward foreground so category text keeps contrast in both themes.
      color: `color-mix(in srgb, ${categoryColor} 40%, var(--color-foreground))`,
      background: `color-mix(in srgb, ${categoryColor} ${selected ? 20 : 7}%, transparent)`,
      borderColor: `color-mix(in srgb, ${categoryColor} ${selected ? 55 : 25}%, transparent)`,
    } : undefined
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected}
        onClick={(event) => { onClick?.(event); onSelectedChange?.(!selected) }}
        className={cn(
          // 36px visible, 44px hit area via the pseudo-element.
          "relative inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs font-medium",
          "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
          "transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          !categoryColor && tone === "neutral" && (selected
            ? "border-foreground/40 bg-card-hover text-foreground"
            : "border-border text-muted hover:text-foreground"),
          !categoryColor && tone === "warning" && (selected
            ? "border-warning/40 bg-warning/13 text-warning"
            : "border-border text-muted hover:text-foreground"),
          className
        )}
        style={{ ...categoryStyle, ...style }}
        {...props}
      />
    )
  }
)
ChoiceChip.displayName = "ChoiceChip"

export { ChoiceChip }
