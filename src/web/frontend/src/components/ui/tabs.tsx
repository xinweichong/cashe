import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { m } from "motion/react"

import { cn } from "@/lib/utils"
import { thumbSpring } from "@/lib/motionPresets"

// Segmented-control look (P10, HIG alignment 2026-10-01): a recessed track
// with one raised thumb that slides to the active trigger. Radix keeps the
// tablist semantics; the wrapper only tracks the active value so every
// trigger in one list shares a layoutId. MotionConfig's reducedMotion="user"
// (App.tsx) makes the thumb jump instead of slide.

const TabsThumbContext = React.createContext<{ value?: string; id: string } | null>(null)

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const id = React.useId()
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const current = value ?? uncontrolled
  return (
    <TabsThumbContext.Provider value={{ value: current, id }}>
      <TabsPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(next) => { setUncontrolled(next); onValueChange?.(next) }}
        {...props}
      />
    </TabsThumbContext.Provider>
  )
})
Tabs.displayName = TabsPrimitive.Root.displayName

// Shared by TabsList and SegmentedChoice so the two never drift.
const segmentTrackClassName =
  "inline-flex h-11 max-w-full items-center gap-0.5 overflow-x-auto scroll-strip rounded-[10px] bg-fill-press p-0.5 text-muted"
const segmentThumbClassName =
  "absolute inset-0 -z-10 rounded-[8px] bg-card shadow-[0_1px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_var(--color-separator)]"

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn(segmentTrackClassName, "isolate", className)} {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

const tabTriggerBase =
  "relative inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-sm font-medium text-muted pressable-scale transition-[color,transform] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"

// Route-level selectors (NavLink sets aria-current) keep link/history
// semantics; the active route gets the thumb fill without the slide.
const routeTabClassName = cn(
  tabTriggerBase,
  "aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-[0_1px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_var(--color-separator)]"
)

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, value, ...props }, ref) => {
  const thumb = React.useContext(TabsThumbContext)
  const active = thumb?.value === value
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(tabTriggerBase, "data-[state=active]:font-semibold data-[state=active]:text-foreground", className)}
      {...props}
    >
      {active && <m.span aria-hidden layoutId={`${thumb.id}-thumb`} transition={thumbSpring} className={segmentThumbClassName} />}
      {children}
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

// eslint-disable-next-line react-refresh/only-export-components
export { Tabs, TabsList, TabsTrigger, TabsContent, routeTabClassName, segmentTrackClassName, segmentThumbClassName }
