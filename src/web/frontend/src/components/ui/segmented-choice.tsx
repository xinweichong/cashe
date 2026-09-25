import { cn } from "@/lib/utils"

// Approved shared owner (P2/U06, 2026-09-25): a single-choice form value
// rendered as segments. Native radios keep form semantics and arrow-key
// behaviour; the look is the Tabs track with the Tabs active treatment.
interface SegmentedChoiceProps<T extends string> {
  name: string
  value: T
  onValueChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  "aria-label": string
  className?: string
}

function SegmentedChoice<T extends string>({ name, value, onValueChange, options, className, ...aria }: SegmentedChoiceProps<T>) {
  return (
    <div role="radiogroup" aria-label={aria["aria-label"]} className={cn("flex h-11 gap-1 rounded-sm border border-border bg-card-hover p-1", className)}>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "relative inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-sm border px-3 text-sm font-medium transition-colors duration-[var(--dur-fast)]",
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            option.value === value
              ? "border-teal/25 bg-teal/13 font-semibold text-teal"
              : "border-transparent text-muted hover:text-foreground"
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onValueChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}

export { SegmentedChoice }
