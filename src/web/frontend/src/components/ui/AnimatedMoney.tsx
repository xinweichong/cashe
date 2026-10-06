import { m } from 'motion/react';
import { formatMoney, type Money } from '@/api/briefing';
import { thumbSpring } from '@/lib/motionPresets';

// A money figure whose digits roll to a new value when it changes after the
// first render (approved 2026-10-06; design-language §14). Mounting never
// animates, and MotionConfig's reducedMotion="user" makes changes jump.
// Slots are keyed from the right so cents stay put when the length changes.
export function AnimatedMoney({ value }: { value: Money }) {
  const text = formatMoney(value);
  const chars = [...text];
  return (
    <span>
      <span className="sr-only" aria-live="polite">{text}</span>
      <span aria-hidden>
        {chars.map((ch, i) => {
          const key = chars.length - i;
          return /\d/.test(ch) ? <DigitSlot key={key} digit={Number(ch)} /> : <span key={key}>{ch}</span>;
        })}
      </span>
    </span>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// The invisible digit gives the slot its width and keeps the baseline; the
// clipped strip of 0–9 slides over it. The mask fades neighbouring digits
// out of the line box leading while the strip moves.
function DigitSlot({ digit }: { digit: number }) {
  return (
    <span className="relative inline-block">
      <span className="invisible">{digit}</span>
      <span className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(transparent,black_14%,black_86%,transparent)]">
        <m.span className="flex flex-col" initial={false} animate={{ y: `${-digit * 10}%` }} transition={thumbSpring}>
          {DIGITS.map(d => <span key={d}>{d}</span>)}
        </m.span>
      </span>
    </span>
  );
}
