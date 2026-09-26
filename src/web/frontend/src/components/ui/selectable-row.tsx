import * as React from "react"

import { cn } from "@/lib/utils"

// Approved shared owner (P5/U13, 2026-09-25): a full-width row that selects
// or opens something. aria-pressed is set only when `selected` is given and
// the row is not a disclosure (aria-expanded). Never nest interactive
// children inside it.
interface SelectableRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

const SelectableRow = React.forwardRef<HTMLButtonElement, SelectableRowProps>(
  ({ selected, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={props["aria-expanded"] === undefined ? selected : undefined}
      className={cn(
        "flex w-full min-h-11 items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-[var(--dur-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "bg-foreground/10" : "hover:bg-foreground/5",
        className
      )}
      {...props}
    />
  )
)
SelectableRow.displayName = "SelectableRow"

export { SelectableRow }
