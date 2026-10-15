import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * Plays a short scripted sequence: returns how many of `delays` have elapsed
 * since `active` turned on. Inactive, it rests at 0; with reduced motion it
 * shows the end as soon as it starts. Pass a constant `delays` array so the
 * sequence does not restart on every render.
 */
export function usePhases(delays: readonly number[], active: boolean): number {
  const reduce = useReducedMotion();
  const end = delays.length;
  const [phase, setPhase] = useState(0);
  // Each time it turns on, the sequence starts again from 0.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) { setWasActive(active); setPhase(0); }

  useEffect(() => {
    if (!active || reduce) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    delays.forEach((delay, i) => {
      at += delay;
      timers.push(setTimeout(() => setPhase(i + 1), at));
    });
    return () => timers.forEach(clearTimeout);
  }, [active, reduce, delays]);

  if (!active) return 0;
  return reduce ? end : phase;
}
