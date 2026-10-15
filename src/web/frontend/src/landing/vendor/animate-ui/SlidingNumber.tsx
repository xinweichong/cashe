/**
 * Adapted from Animate UI "Sliding Number" (MIT), https://animate-ui.com
 *
 * Landing page only: money figures that roll as purchases land. Kept from the
 * original: each digit is a spring-driven roller with all ten digits stacked
 * and offset from the spring's current value. Changes: it takes formatted
 * text ("$1,284.40") and rolls only its digits, keyed from the right so
 * places stay put as the number grows; offsets in em instead of a measured
 * height; m.* for LazyMotion; no in-view trigger; and the value renders at
 * rest on first paint, so the prerendered page shows the real figure.
 */
import { type MotionValue, m, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const SPRING = { stiffness: 200, damping: 20, mass: 0.4 };
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function SlidingNumber({ text, className }: { text: string; className?: string }) {
  const chars = text.split('');
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        return /\d/.test(ch)
          ? <Roller key={`d${fromRight}`} digit={Number(ch)} />
          : <span key={`s${fromRight}`} aria-hidden="true">{ch}</span>;
      })}
    </span>
  );
}

function Roller({ digit }: { digit: number }) {
  const reduce = useReducedMotion();
  const spring = useSpring(digit, reduce ? { duration: 0 } : SPRING);
  useEffect(() => { spring.set(digit); }, [spring, digit]);
  return (
    <span aria-hidden="true" className="relative inline-block w-[1ch] overflow-y-clip" style={{ height: '1em', lineHeight: 1 }}>
      <span className="invisible">0</span>
      {DIGITS.map(n => <Digit key={n} n={n} spring={spring} />)}
    </span>
  );
}

function Digit({ n, spring }: { n: number; spring: MotionValue<number> }) {
  const y = useTransform(spring, latest => {
    const offset = (10 + n - (latest % 10)) % 10;
    return `${offset > 5 ? offset - 10 : offset}em`;
  });
  return <m.span className="absolute inset-0 flex items-center justify-center" style={{ y }}>{n}</m.span>;
}
