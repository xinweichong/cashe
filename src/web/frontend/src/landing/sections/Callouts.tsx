import type { ReactNode } from 'react';
import { cn, getCategoryColor, getCategoryTextColor } from '@/lib/utils';
import { DAYS, EXPLORE, MONTH, NEW_PURCHASE, PLAN, SOURCES, money } from '../content';

// The cards beside the tour phone: each lifts one key part of the page on the
// phone out to a readable size. Four per page (CARD_SLOTS in Tour.tsx); the stage puts two on each
// side, phones show them in a swipeable row under the phone.

const spent = MONTH.spentBefore + NEW_PURCHASE.amount;

function Callout({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-3 rounded-group bg-card p-4 text-sm shadow-elev-md', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-bold tracking-tight">{title}</h3>
        {aside && <span className="shrink-0 text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ left, sub, right, tone }: { left: ReactNode; sub?: ReactNode; right?: ReactNode; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-inset bg-background/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{left}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
      {right && <span className={cn('shrink-0 font-mono text-sm', tone)}>{right}</span>}
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-fill-press">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  );
}

const Cat = ({ name }: { name: string }) => <span style={{ color: getCategoryTextColor(name) }}>{name}</span>;

const HOME: ReactNode[] = [
  <Callout key="mix" title="Where it went" aside={MONTH.name}>
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
      {MONTH.mix.map(c => <span key={c.category} style={{ flex: c.amount, background: getCategoryColor(c.category) }} />)}
    </div>
    <ul className="grid gap-1.5">
      {MONTH.mix.map(c => (
        <li key={c.category} className="flex justify-between"><Cat name={c.category} /><span className="font-mono text-tangerine">{money(c.amount)}</span></li>
      ))}
    </ul>
  </Callout>,
  <Callout key="look" title="Needs a look" aside={`${MONTH.toCheck} to check`}>
    <Row left="Lawson" sub="¥1,200 · rate pending" right="Partial" tone="text-honey" />
    <Row left="Ride Hail" sub="3× its usual" right={money(48.6)} tone="text-coral" />
  </Callout>,
  <Callout key="left" title="Left after spending">
    <div className="font-mono text-2xl font-semibold text-teal">{money(MONTH.income - spent)}</div>
    <p className="text-muted">Income of {money(MONTH.income)} recorded, and {money(MONTH.vsLast)} less spent than by this time in September.</p>
  </Callout>,
  <Callout key="soon" title="Coming up" aside="Estimated">
    <Row left={MONTH.comingUp.merchant} sub={MONTH.comingUp.date} right={money(MONTH.comingUp.amount)} tone="text-honey" />
    <Row left={PLAN.charges[1].merchant} sub={PLAN.charges[1].date} right={money(PLAN.charges[1].amount)} tone="text-honey" />
  </Callout>,
];

const ACTIVITY: ReactNode[] = [
  <Callout key="sources" title="Captured from">
    <ul className="flex flex-wrap gap-1.5">
      {SOURCES.map(s => <li key={s} className="rounded-full bg-fill-press px-2.5 py-1 text-xs font-medium">{s}</li>)}
    </ul>
    <p className="text-muted">Alert emails, Wallet taps and Telegram entries all land in one list.</p>
  </Callout>,
  <Callout key="one" title="One purchase, one record">
    <Row left={NEW_PURCHASE.merchant} sub={<>{NEW_PURCHASE.time} · <Cat name={NEW_PURCHASE.category} /></>} right={`-${money(NEW_PURCHASE.amount)}`} />
    <p className="text-muted">The Apple Pay tap at 2:48 and the UOB email at 2:50 are joined, so nothing counts twice.</p>
  </Callout>,
  <Callout key="fix" title="Fix it once">
    <div className="grid grid-cols-2 gap-1 rounded-inset bg-fill-press p-1 text-center text-xs font-medium">
      <span className="rounded-md bg-card py-1.5 shadow-elev-xs">This purchase</span>
      <span className="py-1.5 text-muted">Remember merchant</span>
    </div>
    <p className="text-muted">Change one category, or teach cashe the merchant for next time.</p>
  </Callout>,
  <Callout key="cash" title="Cash in a message" aside="Telegram">
    <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-teal/15 px-3 py-1.5 font-mono text-xs">/cash 6.52 Hawker Centre</div>
    <div className="w-fit rounded-2xl rounded-bl-md bg-fill-press px-3 py-1.5 text-xs">Captured. <b>Hawker Centre</b> · {money(DAYS[0].rows[0].amount)}</div>
  </Callout>,
];

const PLAN_CARDS: ReactNode[] = [
  <Callout key="proj" title={`${MONTH.name}, projected`} aside="Estimated">
    <div className="font-mono text-2xl font-semibold text-honey">{money(PLAN.projection)}</div>
    <p className="text-muted">From what is recorded, what is scheduled, and what you usually spend in the rest of a month.</p>
  </Callout>,
  <Callout key="budgets" title="Budgets" aside="Monthly">
    {PLAN.budgets.map(b => (
      <div key={b.category} className="grid gap-1.5">
        <div className="flex justify-between"><Cat name={b.category} /><span className={cn('font-mono', b.spent > b.limit && 'text-coral')}>{money(b.spent)} <span className="text-muted">/ {money(b.limit)}</span></span></div>
        <Bar value={b.spent} max={b.limit} color={b.spent > b.limit ? 'var(--color-coral)' : getCategoryColor(b.category)} />
      </div>
    ))}
  </Callout>,
  <Callout key="charges" title="Next 30 days" aside={`${PLAN.charges.length} charges`}>
    <ul className="grid gap-1.5">
      {PLAN.charges.slice(2).map(c => (
        <li key={c.merchant} className="flex justify-between"><span>{c.merchant} <span className="text-muted">· {c.date}</span></span><span className="font-mono text-honey">{money(c.amount)}</span></li>
      ))}
    </ul>
    <p className="text-muted">Every amount is an estimate until it is charged.</p>
  </Callout>,
  <Callout key="goal" title={PLAN.goal.name} aside={`Goal · by ${PLAN.goal.by}`}>
    <div className="font-mono text-2xl font-semibold text-teal">{money(PLAN.goal.saved)}</div>
    <Bar value={PLAN.goal.saved} max={PLAN.goal.target} color="var(--color-teal)" />
    <p className="text-muted">{Math.round((PLAN.goal.saved / PLAN.goal.target) * 100)}% of {money(PLAN.goal.target)}. Trips collect their own spending, too.</p>
  </Callout>,
];

const EXPLORE_CARDS: ReactNode[] = [
  <Callout key="health" title="Health score" aside="50/30/20">
    <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-extrabold">{EXPLORE.score}</span><span className="font-semibold text-teal">{EXPLORE.grade}</span></div>
    <p className="text-muted">Needs, wants and savings against your income, once the month has enough data.</p>
  </Callout>,
  <Callout key="worth" title="Worth a look">
    {EXPLORE.worth.map(w => <Row key={w.merchant} left={w.merchant} sub={w.note} right={money(w.amount)} tone={w.note.startsWith('First') ? undefined : 'text-coral'} />)}
  </Callout>,
  <Callout key="mover" title="Biggest mover" aside="vs September">
    <div className="font-mono text-2xl font-semibold text-coral">+{money(EXPLORE.mover.change)}</div>
    <p className="text-muted"><Cat name={EXPLORE.mover.category} /> is up the most this month.</p>
  </Callout>,
  <Callout key="modes" title="Four ways to look">
    <ul className="grid grid-cols-2 gap-1.5 text-xs font-medium">
      {['Over time', 'By category', 'By merchant', 'Recurring'].map(l => <li key={l} className="rounded-inset bg-fill-press px-2.5 py-2">{l}</li>)}
    </ul>
  </Callout>,
];

const CALLOUTS: readonly ReactNode[][] = [HOME, ACTIVITY, PLAN_CARDS, EXPLORE_CARDS];

/** Card `slot` (0–3) of tour page `page`. */
export function TourCard({ page, slot }: { page: number; slot: number }) {
  return CALLOUTS[page][slot];
}
