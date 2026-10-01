import { useId } from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { thumbSpring } from "@/lib/motionPresets"
import { segmentThumbClassName, segmentTrackClassName } from "@/components/ui/tabs"

// Approved shared owner (P2/U06, 2026-09-25): a single-choice form value
// rendered as segments. Native radios keep form semantics and arrow-key
// behaviour; the look is the Tabs segmented control (P10, 2026-10-01),
// including the sliding thumb.
interface SegmentedChoiceProps<T extends string> {
  name: string
  value: T
  onValueChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  "aria-label": string
  className?: string
}

function SegmentedChoice<T extends string>({ name, value, onValueChange, options, className, ...aria }: SegmentedChoiceProps<T>) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={aria["aria-label"]} className={cn(segmentTrackClassName, "isolate flex", className)}>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              "relative inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-3 text-sm font-medium pressable-scale transition-[color,transform]",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              checked ? "font-semibold text-foreground" : "text-muted hover:text-foreground"
            )}
          >
            {checked && <motion.span aria-hidden layoutId={`${id}-thumb`} transition={thumbSpring} className={segmentThumbClassName} />}
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}

export { SegmentedChoice }
