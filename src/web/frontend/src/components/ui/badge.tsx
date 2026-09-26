import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeBase =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"

const badgeVariants = cva(badgeBase, {
  variants: {
    variant: {
      default:
        "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
      secondary:
        "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
      destructive:
        "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
      outline: "border-border text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

// Spectrum status tones — docs/design-language.md §7.3. 13% tint, 25% border,
// theme-resolved text (colour-mix aside, these use the same --color-* tokens
// the theme already re-derives per light/dark, so no hardcoded hex here).
const badgeToneVariants = {
  saved: "border-teal/25 bg-teal/13 text-teal",
  calm: "border-mint/25 bg-mint/13 text-mint",
  active: "border-honey/25 bg-honey/13 text-honey",
  notable: "border-tangerine/25 bg-tangerine/13 text-tangerine",
  warm: "border-coral/25 bg-coral/13 text-coral",
} as const

export type BadgeTone = keyof typeof badgeToneVariants

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Spectrum status tone. Takes precedence over `variant` when both are given
   *  — CVA would otherwise fall back to the `default` variant's opaque fill
   *  underneath the tone classes, since `variant` is unset rather than absent. */
  tone?: BadgeTone
}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        tone ? cn(badgeBase, badgeToneVariants[tone]) : badgeVariants({ variant }),
        className
      )}
      {...props}
    />
  )
}

// badgeVariants is a cva() config object, not a component; standard shadcn/ui
// pattern. Fast-refresh HMR still works for Badge — this only means editing
// badgeVariants alone triggers a full reload instead of a component patch.
// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants }
