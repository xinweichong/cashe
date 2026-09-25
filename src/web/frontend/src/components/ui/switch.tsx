import * as React from "react"

import { cn } from "@/lib/utils"

// Approved shared owner (P3/U07, 2026-09-25). A 40×20 track inside a 44px
// hit area; `pending` blocks repeat toggles while a save is in flight.
interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  pending?: boolean
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, pending = false, disabled, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "relative block h-5 w-10 rounded-full transition-colors duration-[var(--dur-fast)]",
          checked ? "toggle-on" : "bg-foreground/20"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-[var(--dur-fast)]",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </span>
    </button>
  )
)
Switch.displayName = "Switch"

export { Switch }
