/**
 * Adapted from Kokonut UI "Dynamic Text" by @dorianbaffier (MIT)
 * https://kokonutui.com · https://github.com/kokonut-labs/kokonutui
 *
 * Landing page only. Changes from the original: caller-supplied words, a
 * slower step, m.* for LazyMotion, and one pass that settles on the last word
 * (no endless loop). Screen readers get the full list instead of the motion.
 */
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

export function DynamicText({ words, label, step = 1100 }: { words: string[]; label: string; step?: number }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const last = words.length - 1;
  const current = reduce ? last : index;

  useEffect(() => {
    if (reduce || index >= last) return;
    const timer = setTimeout(() => setIndex(i => i + 1), step);
    return () => clearTimeout(timer);
  }, [index, last, reduce, step]);

  return (
    <span className="relative inline-flex min-w-[9ch] justify-start">
      <span className="sr-only">{label}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={current}
          aria-hidden
          className="inline-block whitespace-nowrap"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {words[current]}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
