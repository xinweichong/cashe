import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import homeLight from './screens/home-light.webp';
import homeDark from './screens/home-dark.webp';
import activityLight from './screens/activity-light.webp';
import activityDark from './screens/activity-dark.webp';
import planLight from './screens/plan-light.webp';
import planDark from './screens/plan-dark.webp';
import exploreLight from './screens/explore-light.webp';
import exploreDark from './screens/explore-dark.webp';

interface Step {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  screen: { light: string; dark: string; alt: string };
}

const STEPS: Step[] = [
  {
    id: 'home', eyebrow: 'Home', title: 'Know where the month stands',
    body: 'Spending against your budget, what needs a look, and what is coming up, in one glance each morning.',
    points: ['Every total opens the transactions behind it', 'Unsure amounts are labelled partial or estimated, never guessed', 'A daily digest on Telegram, if you want one'],
    screen: { light: homeLight, dark: homeDark, alt: 'cashe Home: October spending against a budget, an all-caught-up check and this month’s income' },
  },
  {
    id: 'activity', eyebrow: 'Activity', title: 'Purchases write themselves down',
    body: 'Bank alert emails from DBS PayLah! and UOB, Apple Pay taps through an iOS Shortcut, and quick Telegram entries all land in one list.',
    points: ['A Wallet tap and its bank email become one record', 'Fix a category once, or teach cashe the merchant', 'Cash and one-offs with /add or /cash in Telegram'],
    screen: { light: activityLight, dark: activityDark, alt: 'cashe Activity: purchases grouped by day with merchant, time and category' },
  },
  {
    id: 'plan', eyebrow: 'Plan', title: 'See the month before it happens',
    body: 'A projection for the rest of the month, with a likely range, built from what you usually spend and what is scheduled.',
    points: ['Upcoming subscription charges on a calendar', 'Monthly and weekly budgets, savings goals and trips', 'Pause or dismiss a charge without touching your provider'],
    screen: { light: planLight, dark: planDark, alt: 'cashe Plan: an estimated October projection, savings toward goals and upcoming charges' },
  },
  {
    id: 'explore', eyebrow: 'Explore', title: 'Find the patterns',
    body: 'How spending moves over time, by category and by merchant, with the purchases that stand out.',
    points: ['Unusual purchases and first-time merchants', 'Income against spending, month by month', 'A 50/30/20 health score once the month has enough data'],
    screen: { light: exploreLight, dark: exploreDark, alt: 'cashe Explore: spending over time by category, and income against spending by month' },
  },
];

// Desktop and iPad: steps scroll on the left while the phone stays pinned on
// the right. Phones (P2): the same phone pins to the top half and the
// captions scroll underneath it. The screen follows the step on the reading line.
export function ProductTour() {
  const { resolved } = useTheme();
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    // On phones the pinned mock covers the top half, so read at three
    // quarters down; beside it (md+), read at the middle.
    const line = window.matchMedia('(min-width: 768px)').matches ? 50 : 75;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
      }
    }, { rootMargin: `-${line}% 0px -${99 - line}% 0px` });
    stepRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="tour" aria-labelledby="tour-title" className="mx-auto max-w-5xl scroll-mt-14 px-4 md:px-8">
      <h2 id="tour-title" className="sr-only">A tour of cashe</h2>
      <div className="grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
        <div className="sticky top-14 z-10 -mx-4 bg-background px-4 pb-4 pt-2 md:static md:col-start-2 md:row-start-1 md:mx-0 md:bg-transparent md:p-0">
          <div className="md:sticky md:top-[12vh]">
            <Phone screens={STEPS.map(s => s.screen)} active={active} theme={resolved} />
          </div>
          {/* Captions slide under the pinned phone on small screens. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-8 bg-gradient-to-b from-background to-transparent md:hidden" />
        </div>
        <ol className="md:col-start-1 md:row-start-1">
          {STEPS.map((step, i) => (
            <li
              key={step.id}
              ref={el => { stepRefs.current[i] = el; }}
              data-step={i}
              className="flex min-h-[45svh] flex-col justify-center py-8 md:min-h-[80vh] md:py-10"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal">{String(i + 1).padStart(2, '0')} · {step.eyebrow}</p>
              <h3 className="mt-2 font-display text-2xl font-extrabold tracking-tight md:text-4xl">{step.title}</h3>
              <p className="mt-3 max-w-prose text-base text-muted md:text-lg">{step.body}</p>
              <ul className="mt-5 space-y-2 text-sm md:text-base">
                {step.points.map(point => (
                  <li key={point} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                    {point}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Phone({ screens, active, theme }: { screens: Step['screen'][]; active: number; theme: 'light' | 'dark' }) {
  // Load a screen once the tour reaches the step before it, not up front.
  const [reached, setReached] = useState(0);
  if (active > reached) setReached(active);
  return (
    <figure className="mx-auto w-fit">
      <div className="relative aspect-[390/844] h-[46svh] rounded-[2.25rem] border border-border bg-card p-1.5 shadow-elev-md md:h-[min(76vh,46rem)] md:rounded-[3rem] md:p-2.5">
        <div className="relative h-full w-full overflow-hidden rounded-[1.9rem] md:rounded-[2.5rem]">
          {screens.map((screen, i) => i <= reached + 1 && (
            <img
              key={screen.alt}
              src={screen[theme]}
              alt={i === active ? screen.alt : ''}
              aria-hidden={i !== active}
              loading="lazy"
              decoding="async"
              className={cn(
                'absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500 ease-out motion-reduce:transition-none',
                i === active ? 'opacity-100' : 'opacity-0',
              )}
            />
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-muted">Demo account · invented data</figcaption>
    </figure>
  );
}
