import { AnimatePresence, m, useInView, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { TourCard } from './Callouts';
import { TOUR } from '../content';
import { EASE_OUT, SPRING_LAND } from '../lib/ease';
import { Phone } from '../phone/Phone';
import { StepPills } from '../vendor/beui/StepPills';
import './tour.css';

const HEADER = 56; // the sticky header, h-14
const STEP_SPAN = 85; // svh of scrolling for each page of the tour
const CARD_SLOTS = [0, 1, 2, 3];

/** Home, Activity, Plan and Explore on a live phone, with each page's key parts beside it. */
export function Tour() {
  return (
    <section id="tour" aria-label="A tour of cashe" className="scroll-mt-14">
      <Stage />
      <Stack />
    </section>
  );
}

/**
 * Tablet and desktop: the stage pins under the header while the page scrolls
 * past it, and each stretch of scrolling is one page of the app. The pills
 * show where you are and jump to any page; scrolling back goes back.
 */
function Stage() {
  const reduce = useReducedMotion();
  const wide = useMediaQuery('(min-width: 1024px)');
  const track = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: [`start ${HEADER}px`, 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', p => {
    setStep(Math.min(TOUR.length - 1, Math.max(0, Math.floor(p * TOUR.length))));
  });

  const jump = (i: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - HEADER;
    const span = el.offsetHeight - (window.innerHeight - HEADER);
    window.scrollTo({ top: top + span * ((i + 0.5) / TOUR.length), behavior: reduce ? 'auto' : 'smooth' });
  };

  const page = TOUR[step];
  return (
    <div ref={track} className="relative hidden md:block" style={{ height: `calc(100svh - 3.5rem + ${TOUR.length * STEP_SPAN}svh)` }}>
      <div className="sticky top-14 flex h-[calc(100svh-3.5rem)] flex-col items-center gap-6 pb-6 pt-5">
        <StepPills steps={TOUR} current={step} onPick={jump} label="Tour of cashe" />
        <div className="tour-grid mx-auto min-h-0 w-full max-w-6xl flex-1 px-8">
          <div style={{ gridArea: 'phone' }} className="self-center">
            <Phone page={step} play className="tour-phone" />
          </div>
          <div style={{ gridArea: 'cap' }} className="self-end lg:min-h-[7rem]">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={page.id}
                initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                transition={{ duration: 0.3, ease: EASE_OUT }}
              >
                <h2 className="font-display text-2xl font-extrabold tracking-tight text-balance lg:text-3xl">{page.title}</h2>
                <p className="mt-2 max-w-md text-base text-muted">{page.body}</p>
              </m.div>
            </AnimatePresence>
          </div>
          {CARD_SLOTS.map(slot => (
            <div key={slot} style={{ gridArea: `c${slot}` }} className="min-w-0 max-w-sm self-start">
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={page.id}
                  // Cards come out of the phone: towards whichever side they sit on.
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: slot < 2 && wide ? 24 : -24, scale: 0.97, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, filter: 'blur(4px)', transition: { duration: 0.18 } }}
                  transition={{ ...SPRING_LAND, delay: 0.08 + (slot % 2) * 0.07 + (slot < 2 ? 0 : 0.04) }}
                >
                  <TourCard page={step} slot={slot} />
                </m.div>
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Phones: no pinning. Each page is a chapter: its words, the phone playing
 * that page as it comes into view, then its cards in a row you can swipe.
 * A floating pill bar in the thumb band follows along and jumps between them.
 */
function Stack() {
  const reduce = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const chapters = useRef<(HTMLLIElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const inTour = useInView(list, { margin: '-40% 0px -40% 0px' });

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) setCurrent(Number((entry.target as HTMLElement).dataset.index));
      }
    }, { rootMargin: '-50% 0px -49% 0px' });
    chapters.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jump = (i: number) => chapters.current[i]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

  return (
    <>
      <ol ref={list} className="mx-auto flex max-w-xl flex-col gap-20 px-4 pb-24 pt-8 md:hidden">
        {TOUR.map((step, i) => (
          <Chapter key={step.id} index={i} itemRef={el => { chapters.current[i] = el; }} />
        ))}
      </ol>
      <AnimatePresence>
        {inTour && (
          <m.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={SPRING_LAND}
            className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex justify-center md:hidden"
          >
            <StepPills steps={TOUR} current={current} onPick={jump} label="Tour of cashe" className="shadow-float ring-1 ring-border" />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Chapter({ index, itemRef }: { index: number; itemRef: (el: HTMLLIElement | null) => void }) {
  const phone = useRef<HTMLDivElement>(null);
  const seen = useInView(phone, { amount: 0.5 });
  const step = TOUR[index];
  return (
    <li ref={itemRef} id={step.id} data-index={index} className="flex scroll-mt-16 flex-col gap-5">
      <div>
        <p className="text-sm font-semibold text-teal">{step.label}</p>
        <h2 className="mt-1 font-display text-[1.75rem] font-extrabold leading-tight tracking-tight text-balance">{step.title}</h2>
        <p className="mt-2 text-base text-muted">{step.body}</p>
      </div>
      <div ref={phone} className="flex justify-center">
        <Phone page={index} play={seen} className="w-[min(17rem,74vw)]" />
      </div>
      <ul aria-label={`${step.label}, in detail`} className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-3 [scrollbar-width:none]">
        {CARD_SLOTS.map(slot => (
          <li key={slot} className="w-[80%] max-w-xs shrink-0 snap-start"><TourCard page={index} slot={slot} /></li>
        ))}
      </ul>
    </li>
  );
}
