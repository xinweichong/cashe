import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { getCategoryColor, getCategoryTextColor } from '@/lib/utils';
import { EVIDENCE, money } from '../content';
import { SPRING_LAND } from '../lib/ease';
import { SlidingNumber } from '../vendor/animate-ui/SlidingNumber';

const CATEGORIES = ['Food', 'Transport', 'Entertainment'];

/**
 * Shows its working: a total you can open. Choosing a category re-adds the
 * purchases behind it, and a purchase still waiting for an exchange rate
 * marks the total partial instead of being guessed.
 */
export function Evidence() {
  const [category, setCategory] = useState<string | null>(null);
  const rows = EVIDENCE.filter(r => !category || r.category === category);
  const total = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const pending = rows.filter(r => r.amount === null).length;
  return (
    <section aria-labelledby="evidence-title" className="border-t border-border/60">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-12 md:gap-8 md:px-8 md:py-28">
        <div className="md:col-span-5 md:col-start-8 md:row-start-1">
          <h2 id="evidence-title" className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-[2.75rem]">
            Every number shows its working.
          </h2>
          <p className="mt-4 max-w-md text-lg text-muted">
            Open any total to see the purchases behind it. If one is still waiting for an exchange rate, the total says partial rather than guessing.
          </p>
        </div>
        <div className="md:col-span-6 md:row-start-1">
          <div className="rounded-hero bg-card p-5 shadow-elev-md">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Show spending for">
              <ChoiceChip selected={category === null} onSelectedChange={() => setCategory(null)}>All</ChoiceChip>
              {CATEGORIES.map(c => (
                <ChoiceChip key={c} selected={category === c} categoryColor={getCategoryColor(c)} onSelectedChange={() => setCategory(category === c ? null : c)}>{c}</ChoiceChip>
              ))}
            </div>
            <div className="mt-5 flex items-end justify-between gap-4" aria-live="polite">
              <div>
                <p className="text-sm text-muted">{category ?? 'Spending'} this week</p>
                <SlidingNumber className="font-mono text-4xl font-semibold text-tangerine" text={money(total)} />
              </div>
              <AnimatePresence initial={false}>
                {pending > 0 && (
                  <m.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING_LAND} className="rounded-full bg-honey/15 px-3 py-1 text-xs font-semibold text-honey">
                    Partial · {pending} waiting for a rate
                  </m.span>
                )}
              </AnimatePresence>
            </div>
            <m.ul layout className="mt-4 overflow-hidden rounded-group bg-background/60" transition={SPRING_LAND}>
              <AnimatePresence initial={false}>
                {rows.map(r => (
                  <m.li
                    key={r.merchant + r.category + (r.amount ?? 'pending')}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={SPRING_LAND}
                    className="border-b border-separator last:border-0"
                  >
                    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: getCategoryColor(r.category) }} />
                      <span className="min-w-0 flex-1 truncate">{r.merchant} <span style={{ color: getCategoryTextColor(r.category) }}>· {r.category}</span></span>
                      {r.amount === null
                        ? <span className="font-mono text-honey">{'original' in r ? r.original : ''} <span className="font-sans text-xs">rate pending</span></span>
                        : <span className="font-mono">{money(r.amount)}</span>}
                    </div>
                  </m.li>
                ))}
              </AnimatePresence>
            </m.ul>
          </div>
        </div>
      </div>
    </section>
  );
}
