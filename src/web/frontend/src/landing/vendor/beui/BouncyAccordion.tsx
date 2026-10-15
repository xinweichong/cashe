/**
 * Adapted from beUI "Bouncy Accordion" (beui.dev/components/motion/bouncy-accordion).
 * Copyright beUI; used under the beUI license, which permits modification and
 * commercial use with this notice kept.
 *
 * Landing page only: questions about access and data. Changes: local imports,
 * a drawn chevron instead of an icon library, cashe's 18px group radius
 * instead of 28px, m.* for LazyMotion, the previous value held in state
 * instead of a ref, and cashe's colour tokens.
 */

import { m, type Transition, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from '@/lib/utils';
import { EASE_OUT } from '../../lib/ease';

export type BouncyAccordionItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type BouncyAccordionClassNames = {
  root?: string;
  item?: string;
  trigger?: string;
  icon?: string;
  title?: string;
  chevron?: string;
  content?: string;
  description?: string;
};

export interface BouncyAccordionProps {
  items: BouncyAccordionItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  collapsible?: boolean;
  className?: string;
  classNames?: BouncyAccordionClassNames;
}

// Rows, cards and scale-corrected text share a transition so their edges
// stay joined. A close or switch uses the faster non-overshooting spring;
// opening from all-closed keeps the weighted bounce.
const EXPAND_TRANSITION: Transition = {
  type: "spring",
  duration: 0.58,
  bounce: 0.32,
};

const COLLAPSE_TRANSITION: Transition = {
  type: "spring",
  duration: 0.46,
  bounce: 0,
};

const DESCRIPTION_TRANSITION: Transition = {
  duration: 0.18,
  ease: EASE_OUT,
};

const CHEVRON_TRANSITION: Transition = {
  type: "spring",
  duration: 0.42,
  bounce: 0.28,
};

function useControllableAccordionValue({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? null);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = useCallback(
    (next: string | null) => {
      if (!isControlled) {
        setInternalValue(next);
      }

      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  return [currentValue, setValue] as const;
}

function BouncyAccordionRow({
  item,
  open,
  startsGroup,
  endsGroup,
  separatedFromPrevious,
  contentId,
  triggerId,
  reduce,
  layoutTransition,
  layoutDependency,
  classNames,
  onToggle,
}: {
  item: BouncyAccordionItem;
  open: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  separatedFromPrevious: boolean;
  contentId: string;
  triggerId: string;
  reduce: boolean | null;
  layoutTransition: Transition;
  layoutDependency: string | null;
  classNames?: BouncyAccordionClassNames;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const updateHeight = () => {
      setContentHeight(node.offsetHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <m.div
      layout={reduce ? false : "position"}
      layoutDependency={layoutDependency}
      initial={false}
      style={{ marginTop: separatedFromPrevious ? 18 : 0 }}
      transition={{ layout: layoutTransition }}
    >
      <m.div
        data-state={open ? "open" : "closed"}
        layout={!reduce}
        layoutDependency={layoutDependency}
        initial={false}
        animate={{
          borderTopLeftRadius: startsGroup ? 18 : 0,
          borderTopRightRadius: startsGroup ? 18 : 0,
          borderBottomLeftRadius: endsGroup ? 18 : 0,
          borderBottomRightRadius: endsGroup ? 18 : 0,
        }}
        transition={reduce ? { duration: 0 } : layoutTransition}
        style={{ originY: 0 }}
        className={cn(
          "overflow-hidden bg-card text-foreground",
          item.disabled && "opacity-50",
          classNames?.item,
        )}
      >
        <m.button
          id={triggerId}
          type="button"
          disabled={item.disabled}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          layout={reduce ? false : "position"}
          layoutDependency={layoutDependency}
          transition={{ layout: layoutTransition }}
          style={{ originY: 0 }}
          className={cn(
            "flex min-h-14 w-full items-center gap-4 px-5 text-left outline-none transition-colors",
            "focus-visible:bg-fill-hover",
            "disabled:pointer-events-none",
            classNames?.trigger,
          )}
        >
          {item.icon ? (
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center text-muted",
                classNames?.icon,
              )}
            >
              {item.icon}
            </span>
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 text-[17px] leading-[22px] font-medium text-foreground",
              classNames?.title,
            )}
          >
            {item.title}
          </span>
          <m.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : CHEVRON_TRANSITION}
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center text-muted",
              classNames?.chevron,
            )}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </m.span>
        </m.button>

        <section
          id={contentId}
          aria-labelledby={triggerId}
          aria-hidden={!open}
          inert={!open}
          style={{ height: open && item.description ? contentHeight || "auto" : 0 }}
          className={cn(classNames?.content)}
        >
          <m.div
            ref={contentRef}
            // The card clips this full-size layout node. Correcting only the
            // card scale avoids a one-pixel clip and its extreme text scale.
            // Size changes outside a toggle snap to their natural geometry.
            layout={reduce ? false : "position"}
            layoutDependency={layoutDependency}
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{
              opacity: reduce ? { duration: 0 } : DESCRIPTION_TRANSITION,
              layout: layoutTransition,
            }}
            style={{ originY: 0 }}
            className="px-5 pb-5"
          >
            <div
              className={cn("max-w-[62ch] text-base leading-6 text-muted", classNames?.description)}
            >
              {item.description}
            </div>
          </m.div>
        </section>
      </m.div>
    </m.div>
  );
}

export function BouncyAccordion({
  items,
  value,
  defaultValue = null,
  onValueChange,
  collapsible = true,
  className,
  classNames,
}: BouncyAccordionProps) {
  const reduce = useReducedMotion();
  const baseId = useId();
  const [activeValue, setActiveValue] = useControllableAccordionValue({
    value,
    defaultValue,
    onValueChange,
  });
  const activeIndex = items.findIndex((item) => item.id === activeValue);
  // The value before the latest change, kept in state rather than a ref
  // (cashe's lint forbids reading refs during render).
  const [history, setHistory] = useState({ value: activeValue, previous: activeValue });
  if (history.value !== activeValue) setHistory({ value: activeValue, previous: history.value });
  const layoutTransition =
    activeValue === null || history.previous !== null
      ? COLLAPSE_TRANSITION
      : EXPAND_TRANSITION;

  const toggleItem = useCallback(
    (id: string) => {
      if (activeValue === id) {
        if (collapsible) {
          setActiveValue(null);
        }
        return;
      }

      setActiveValue(id);
    },
    [activeValue, collapsible, setActiveValue],
  );

  return (
    <div className={cn("w-full", className, classNames?.root)}>
      {items.map((item, index) => {
        const open = activeValue === item.id;
        const previousIsOpen = activeIndex === index - 1;
        const nextIsOpen = activeIndex === index + 1;
        const startsGroup = open || index === 0 || previousIsOpen;
        const endsGroup = open || index === items.length - 1 || nextIsOpen;
        const separatedFromPrevious = index > 0 && (open || previousIsOpen);
        const contentId = `${baseId}-${item.id}-content`;
        const triggerId = `${baseId}-${item.id}-trigger`;

        return (
          <BouncyAccordionRow
            key={item.id}
            item={item}
            open={open}
            startsGroup={startsGroup}
            endsGroup={endsGroup}
            separatedFromPrevious={separatedFromPrevious}
            contentId={contentId}
            triggerId={triggerId}
            reduce={reduce}
            layoutTransition={layoutTransition}
            layoutDependency={activeValue}
            classNames={classNames}
            onToggle={() => toggleItem(item.id)}
          />
        );
      })}
    </div>
  );
}
