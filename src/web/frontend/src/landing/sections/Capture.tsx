import { AnimatePresence, m, useInView } from 'motion/react';
import { Mail, MessageCircle, Smartphone } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { cn, getCategoryColor, getCategoryTextColor } from '@/lib/utils';
import { NEW_PURCHASE, money } from '../content';
import { SPRING_LAND } from '../lib/ease';
import { usePhases } from '../lib/usePhases';
import { SlidingNumber } from '../vendor/animate-ui/SlidingNumber';

const SCRIPT = [500, 1300, 1400, 1400] as const;
const CASH = { merchant: 'Hawker Centre', category: 'Food', amount: 6.52 };

const MESSAGES = [
  { icon: Smartphone, from: 'Apple Pay · via Shortcut', at: '2:48 pm', text: `${NEW_PURCHASE.merchant} · ${money(NEW_PURCHASE.amount)}` },
  { icon: Mail, from: 'UOB alert email', at: '2:50 pm', text: `SGD ${NEW_PURCHASE.amount.toFixed(2)} at KOPI CORNER` },
  { icon: MessageCircle, from: 'Telegram', at: '7:15 pm', text: `/cash ${CASH.amount} ${CASH.merchant}` },
];

/**
 * How purchases get in: three messages arrive one by one and become two
 * records, because the Wallet tap and its bank email are the same purchase.
 * Plays once as it comes into view; the same scene stacks on phones.
 */
export function Capture() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.5 });
  const phase = usePhases(SCRIPT, seen);
  const records = (phase >= 1 ? 1 : 0) + (phase >= 3 ? 1 : 0);
  return (
    <section aria-labelledby="capture-title" className="border-t border-border/60 bg-card/40">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-12 md:gap-8 md:px-8 md:py-28">
        <div className="md:col-span-5 lg:col-span-4">
          <h2 id="capture-title" className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-[2.75rem]">
            Three messages, two purchases.
          </h2>
          <p className="mt-4 max-w-md text-lg text-muted">
            A Wallet tap arrives first and its bank email a minute later. cashe joins them, so nothing counts twice, and a quick Telegram message covers the cash.
          </p>
          <p className="mt-8 flex items-baseline gap-3 font-display text-lg font-bold" aria-live="polite">
            <SlidingNumber className="text-4xl text-teal" text={String(records)} />
            <span className="text-muted">{records === 1 ? 'purchase' : 'purchases'} from {Math.min(phase, 3)} {phase === 1 ? 'message' : 'messages'}</span>
          </p>
        </div>
        <div ref={ref} className="grid items-center gap-6 md:col-span-7 lg:col-span-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <ol className="grid gap-3" aria-label="Messages">
            {MESSAGES.map((msg, i) => (
              <Message key={msg.from} {...msg} state={phase > i ? (phase === i + 1 ? 'arriving' : 'done') : 'waiting'} />
            ))}
          </ol>
          <span aria-hidden className="hidden text-2xl text-muted lg:block">→</span>
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-muted">Activity · today</p>
            <m.div layout transition={SPRING_LAND} className="min-h-[9.5rem] overflow-hidden rounded-group bg-card shadow-elev-md">
              <AnimatePresence initial={false}>
                {phase >= 3 && (
                  <Record key="cash" {...CASH} note="Cash" fresh={phase === 3} />
                )}
                {phase >= 1 && (
                  <Record key="kopi" {...NEW_PURCHASE} note={phase >= 2 ? 'Apple Pay + UOB' : 'Apple Pay'} fresh={phase === 1 || phase === 2} />
                )}
              </AnimatePresence>
              {phase === 0 && <p className="grid min-h-[9.5rem] place-items-center px-4 text-sm text-muted">Waiting for a purchase…</p>}
            </m.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Message({ icon: Icon, from, at, text, state }: { icon: typeof Mail; from: string; at: string; text: string; state: 'waiting' | 'arriving' | 'done' }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-group bg-card p-3 shadow-elev-xs transition-[opacity,box-shadow,transform] duration-500',
        state === 'waiting' && 'opacity-40',
        state === 'arriving' && 'shadow-glow-teal -translate-y-0.5',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-fill-press text-teal"><Icon className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="flex justify-between gap-2 text-xs text-muted"><span className="font-semibold">{from}</span><span>{at}</span></span>
        <span className="block truncate font-mono text-sm">{text}</span>
      </span>
    </li>
  );
}

function Record({ merchant, category, amount, note, fresh }: { merchant: string; category: string; amount: number; note: ReactNode; fresh: boolean }) {
  return (
    <m.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto', backgroundColor: fresh ? 'color-mix(in srgb, var(--color-teal) 14%, transparent)' : 'color-mix(in srgb, var(--color-teal) 0%, transparent)' }}
      transition={SPRING_LAND}
      className="border-b border-separator last:border-0"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ background: `color-mix(in srgb, ${getCategoryColor(category)} 22%, transparent)`, color: getCategoryTextColor(category) }}>{category[0]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{merchant}</span>
          <span className="block truncate text-xs" style={{ color: getCategoryTextColor(category) }}>{category}</span>
        </span>
        <span className="text-right font-mono text-sm">-{money(amount)}<span className="block font-sans text-xs text-muted">{note}</span></span>
      </div>
    </m.div>
  );
}
