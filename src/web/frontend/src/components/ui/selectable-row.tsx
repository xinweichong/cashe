import * as React from "react"

import { cn } from "@/lib/utils"

// Approved shared owner (P5/U13, 2026-09-25): a full-width row that selects
// or opens something. Direction B (P4, 2026-10-01): the grouped-list row with
// custom content (budget progress, legends): square, hairline-separated from
// its sibling rows, pressed fill, teal selection that insets on md+. aria-pressed is set only when `selected` is given and
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
        "separator-inset pressable flex w-full min-h-row items-center gap-2 px-3 py-2.5 text-left text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected && "bg-teal text-on-teal hover:bg-teal active:bg-teal md:mx-1 md:my-0.5 md:w-[calc(100%-0.5rem)] md:rounded-inset",
        className
      )}
      {...props}
    />
  )
)
SelectableRow.displayName = "SelectableRow"

export { SelectableRow }
