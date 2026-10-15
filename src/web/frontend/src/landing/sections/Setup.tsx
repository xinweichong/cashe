import { useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { SETUP } from '../content';
import { Timeline, TimelineItem } from '../vendor/origin/Timeline';

/**
 * Origin UI's timeline: the three steps light in turn as the list comes into
 * view. They stay numbered, never ticked: the visitor has not done them yet.
 */
export function Setup() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.5 });
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!seen) return;
    const timers = SETUP.map((_, i) => setTimeout(() => setDone(i + 1), 250 + i * 650));
    return () => timers.forEach(clearTimeout);
  }, [seen]);
  return (
    <section aria-labelledby="setup-title" className="border-t border-border/60 bg-card/40">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-12 md:gap-8 md:px-8 md:py-28">
        <div className="md:col-span-5">
          <h2 id="setup-title" className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-[2.75rem]">
            Set up once, then forget it.
          </h2>
          <p className="mt-4 max-w-md text-lg text-muted">
            Three connections, each optional. Use whichever match how you pay.
          </p>
        </div>
        <div ref={ref} className="md:col-span-7 md:pt-2">
          <Timeline>
            {SETUP.map((step, i) => (
              <TimelineItem key={step.title} completed={i < done} last={i === SETUP.length - 1} indicator={i + 1} title={step.title}>
                {step.body}
              </TimelineItem>
            ))}
          </Timeline>
        </div>
      </div>
    </section>
  );
}
