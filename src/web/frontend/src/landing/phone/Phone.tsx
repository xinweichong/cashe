import { AnimatePresence, LayoutGroup, m, useReducedMotion } from 'motion/react';
import { ChartNoAxesCombined, House, List, Search, SlidersHorizontal, Wallet } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn, getCategoryColor, getCategoryTextColor } from '@/lib/utils';
import { DAYS, EXPLORE, MONTH, NEW_PURCHASE, PLAN, TOUR, money } from '../content';
import { EASE_OUT, SPRING_GLIDE, SPRING_LAND } from '../lib/ease';
import { usePhases } from '../lib/usePhases';
import { SlidingNumber } from '../vendor/animate-ui/SlidingNumber';
import './phone.css';

const TABS = [House, List, Wallet, ChartNoAxesCombined];

/**
 * The app on a phone, drawn live rather than from screenshots: it uses the
 * app's colour tokens, so it follows light and dark, and each screen plays a
 * short scene (a purchase landing, a projection filling in) while `play` is on.
 */
export function Phone({ page, play, className }: { page: number; play: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const id = useId();
  // Screens slide the way the tab bar moves, like the app's tab switch.
  const [last, setLast] = useState({ page, direction: 1 });
  if (last.page !== page) setLast({ page, direction: page > last.page ? 1 : -1 });
  const direction = last.page !== page ? (page > last.page ? 1 : -1) : last.direction;
  const Screen = SCREENS[page];
  return (
    <div className={cn('ph-frame', className)} role="img" aria-label={`cashe ${TOUR[page].label}, with an invented demo month`}>
      <div className="ph-glass" aria-hidden="true">
        <div className="ph-island" />
        <div className="ph-status"><span>9:41</span><span>●●●</span></div>
        <AnimatePresence initial={false}>
          <m.div
            key={page}
            className="ph-page"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: `${direction * 6}%` }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: `${direction * -4}%` }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
          >
            <Screen play={play} />
          </m.div>
        </AnimatePresence>
        <div className="ph-fade" />
        <LayoutGroup id={id}>
          <div className="ph-tabbar">
            {TOUR.map((step, i) => {
              const Icon = TABS[i];
              return (
                <div key={step.id} className={cn('ph-tab', i === page && 'on')}>
                  {i === page && <m.div layoutId="tab" className="ph-tab-pill" transition={reduce ? { duration: 0 } : SPRING_GLIDE} />}
                  <Icon />
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}

const SCREENS = [HomeScreen, ActivityScreen, PlanScreen, ExploreScreen];

// ─── Shared bits ─────────────────────────────────────────────────────────────

function Avatar({ category }: { category: string }) {
  return (
    <span className="ph-avatar" style={{ background: `color-mix(in srgb, ${getCategoryColor(category)} 22%, transparent)`, color: getCategoryTextColor(category) }}>
      {category[0]}
    </span>
  );
}

function Cat({ name }: { name: string }) {
  return <span style={{ color: getCategoryTextColor(name) }}>{name}</span>;
}

function Switch({ items }: { items: string[] }) {
  return <div className="ph-switch">{items.map((item, i) => <span key={item} className={i === 0 ? 'on' : undefined}>{item}</span>)}</div>;
}

/** An iOS-style notification that drops in over the screen. */
function Banner({ show, app, title, body }: { show: boolean; app: string; title: string; body: string }) {
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0, y: '-120%', scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: '-60%', scale: 0.98 }}
          transition={SPRING_LAND}
          className="absolute inset-x-[0.5em] top-[2.6em] z-10 flex items-center gap-[0.7em] rounded-[1.1em] bg-card-elev/95 p-[0.7em] shadow-lift ring-1 ring-border backdrop-blur"
        >
          <span className="spectrum-fill grid size-[2.3em] shrink-0 place-items-center rounded-[0.6em] font-display text-[0.95em] font-extrabold">$</span>
          <span className="grid min-w-0 flex-1 gap-[0.1em]">
            <span className="flex justify-between text-[0.72em] text-muted"><span className="font-semibold uppercase tracking-wide">{app}</span><span>now</span></span>
            <span className="truncate text-[0.88em] font-semibold">{title}</span>
            <span className="truncate text-[0.8em] text-muted">{body}</span>
          </span>
        </m.div>
      )}
    </AnimatePresence>
  );
}

function Glow({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <m.div
      initial={false}
      animate={{ backgroundColor: on ? 'color-mix(in srgb, var(--color-teal) 16%, transparent)' : 'color-mix(in srgb, var(--color-teal) 0%, transparent)' }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
    >
      {children}
    </m.div>
  );
}

// ─── Home ────────────────────────────────────────────────────────────────────

const HOME_SCRIPT = [700, 1300, 1600] as const;

function HomeScreen({ play }: { play: boolean }) {
  const phase = usePhases(HOME_SCRIPT, play);
  const landed = phase >= 2;
  const spent = MONTH.spentBefore + (landed ? NEW_PURCHASE.amount : 0);
  const latest = landed ? NEW_PURCHASE : MONTH.latestBefore;
  return (
    <>
      <Banner show={phase === 1 || phase === 2} app="Wallet" title={NEW_PURCHASE.merchant} body={`${money(NEW_PURCHASE.amount)} · Apple Pay`} />
      <div className="ph-title">Home</div>
      <div className="ph-hero spectrum-fill">
        <div className="ph-hero-top"><span>{MONTH.name}</span><span>Budget {money(MONTH.budget)}</span></div>
        <SlidingNumber className="ph-hero-big" text={money(spent)} />
        <div className="ph-hero-sub"><SlidingNumber text={money(MONTH.budget - spent)} /> left</div>
        <div className="ph-track"><m.span initial={false} animate={{ width: `${(spent / MONTH.budget) * 100}%` }} transition={SPRING_LAND} /></div>
      </div>
      <div className="ph-line">
        <span><span className="ph-dot bg-honey" />{MONTH.toCheck} to check</span>
        <span className="font-mono text-teal">↓ {money(MONTH.vsLast)} <span className="font-sans text-muted">vs Sept</span></span>
      </div>
      <div className="ph-group ph-mix">
        <Donut />
        <div className="ph-legend">
          {MONTH.mix.map(c => (
            <div key={c.category}><span className="ph-dot" style={{ background: getCategoryColor(c.category) }} />{c.category}<b>{money(c.amount)}</b></div>
          ))}
        </div>
      </div>
      <div className="ph-group">
        <div className="ph-row"><div className="ph-row-main"><span className="ph-row-title">Income</span></div><span className="ph-amt text-teal">{money(MONTH.income)}</span></div>
        <div className="ph-row"><div className="ph-row-main"><span className="ph-row-title">Left after spending</span></div><SlidingNumber className="ph-amt text-teal" text={money(MONTH.income - spent)} /></div>
        <div className="ph-row"><div className="ph-row-main"><span className="ph-row-title">Coming up</span><span className="ph-row-sub">{MONTH.comingUp.merchant} · {MONTH.comingUp.date}</span></div><span className="ph-amt text-honey">{money(MONTH.comingUp.amount)}</span></div>
        <Glow on={phase === 2}>
          <div className="ph-row"><div className="ph-row-main"><span className="ph-row-title">Latest</span><span className="ph-row-sub">{latest.merchant} · <Cat name={latest.category} /></span></div><span className="ph-amt">{money(latest.amount)}</span></div>
        </Glow>
      </div>
      <Switch items={['Month', 'Trend', 'Changed']} />
    </>
  );
}

function Donut() {
  const total = MONTH.mix.reduce((sum, c) => sum + c.amount, 0);
  const r = 15.5;
  const circumference = 2 * Math.PI * r;
  const lengths = MONTH.mix.map(c => (c.amount / total) * circumference);
  return (
    <svg viewBox="0 0 40 40" className="ph-donut -rotate-90">
      {MONTH.mix.map((c, i) => (
        <circle
          key={c.category}
          cx="20" cy="20" r={r} fill="none" stroke={getCategoryColor(c.category)} strokeWidth="5"
          strokeDasharray={`${lengths[i] - 0.8} ${circumference}`}
          strokeDashoffset={-lengths.slice(0, i).reduce((sum, l) => sum + l, 0)}
        />
      ))}
    </svg>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

const ACTIVITY_SCRIPT = [600, 1100, 1500, 1200, 1000] as const;

function ActivityScreen({ play }: { play: boolean }) {
  const phase = usePhases(ACTIVITY_SCRIPT, play);
  const landed = phase >= 2;
  const joined = phase >= 4;
  const [today, yesterday] = DAYS;
  const todayTotal = today.rows.reduce((sum, r) => sum + r.amount, 0) + (landed ? NEW_PURCHASE.amount : 0);
  return (
    <>
      <Banner show={phase === 1 || phase === 2} app="Wallet" title={NEW_PURCHASE.merchant} body={`${money(NEW_PURCHASE.amount)} · Apple Pay`} />
      <Banner show={phase === 3 || phase === 4} app="Gmail · UOB" title="Card transaction alert" body={`SGD ${NEW_PURCHASE.amount.toFixed(2)} at KOPI CORNER`} />
      <div className="ph-title">Activity</div>
      <div className="ph-day"><span>{today.day}</span><SlidingNumber text={money(todayTotal)} /></div>
      <m.div layout className="ph-group" transition={SPRING_LAND}>
        <AnimatePresence initial={false}>
          {landed && (
            <m.div key="new" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={SPRING_LAND}>
              <Glow on={phase === 2 || phase === 4}>
                <div className="ph-row">
                  <Avatar category={NEW_PURCHASE.category} />
                  <div className="ph-row-main"><span className="ph-row-title">{NEW_PURCHASE.merchant}</span><span className="ph-row-sub">{NEW_PURCHASE.time} · <Cat name={NEW_PURCHASE.category} /></span></div>
                  <span className="ph-amt">-{money(NEW_PURCHASE.amount)}<small>{joined ? 'Apple Pay + UOB' : 'Apple Pay'}</small></span>
                </div>
              </Glow>
            </m.div>
          )}
        </AnimatePresence>
        {today.rows.map(row => <ActivityRow key={row.merchant + row.time} {...row} />)}
      </m.div>
      <m.div layout className="ph-day" transition={SPRING_LAND}><span>{yesterday.day}</span><span>{money(yesterday.rows.reduce((s, r) => s + r.amount, 0))}</span></m.div>
      <m.div layout className="ph-group" transition={SPRING_LAND}>
        {yesterday.rows.map(row => <ActivityRow key={row.merchant + row.time} {...row} />)}
      </m.div>
      <div className="ph-search"><Search className="size-[1.1em]" />Search<SlidersHorizontal className="ml-auto size-[1.1em] text-teal" /></div>
      <Switch items={['All', 'Review', 'Income', 'Refunds']} />
    </>
  );
}

function ActivityRow({ merchant, time, category, amount, note }: { merchant: string; time: string; category: string; amount: number; note?: string }) {
  return (
    <div className="ph-row">
      <Avatar category={category} />
      <div className="ph-row-main"><span className="ph-row-title">{merchant}</span><span className="ph-row-sub">{time} · <Cat name={category} /></span></div>
      <span className="ph-amt">-{money(amount)}{note && <small>{note}</small>}</span>
    </div>
  );
}

// ─── Plan ────────────────────────────────────────────────────────────────────

const PLAN_SCRIPT = [250, 450, 450] as const;

function PlanScreen({ play }: { play: boolean }) {
  const phase = usePhases(PLAN_SCRIPT, play);
  const spent = MONTH.spentBefore + NEW_PURCHASE.amount;
  const total = PLAN.projection;
  const parts = [
    { value: spent, color: 'var(--color-teal)', label: 'recorded' },
    { value: PLAN.scheduled, color: 'var(--color-honey)', label: 'scheduled' },
    { value: PLAN.rest, color: 'var(--color-tangerine)', label: 'rest, est.' },
  ];
  const chargesTotal = PLAN.charges.reduce((sum, c) => sum + c.amount, 0);
  return (
    <>
      <div className="ph-title">Plan</div>
      <div className="ph-hero spectrum-fill">
        <div className="ph-hero-top"><span>{MONTH.name} projection</span><span>Estimated</span></div>
        <div className="ph-hero-big">{money(total)}</div>
        <div className="ph-hero-sub">{money(MONTH.budget - total)} under your {money(MONTH.budget)} target</div>
      </div>
      <div className="ph-stack">
        {parts.map((p, i) => (
          <m.span key={p.label} initial={false} animate={{ flexGrow: phase > i ? p.value : 0.001 }} transition={{ duration: 0.6, ease: EASE_OUT }} style={{ background: p.color, flexBasis: 0 }} />
        ))}
      </div>
      <div className="ph-keys">
        {parts.map(p => <span key={p.label}><b style={{ color: p.color }}>${Math.round(p.value).toLocaleString('en-SG')}</b>{p.label}</span>)}
      </div>
      <div className="ph-group">
        <div className="ph-row"><div className="ph-row-main"><span className="ph-row-title">Next 30 days</span><span className="ph-row-sub">{PLAN.charges.length} charges</span></div><span className="ph-amt text-honey">{money(chargesTotal)}</span></div>
        {PLAN.charges.map((c, i) => (
          <m.div key={c.merchant} className="ph-row" initial={false} animate={{ opacity: phase >= 3 || !play ? 1 : 0.25, x: phase >= 3 || !play ? 0 : 6 }} transition={{ ...SPRING_LAND, delay: i * 0.07 }}>
            <div className="ph-row-main"><span className="ph-row-title">{c.merchant}</span><span className="ph-row-sub">{c.date}</span></div>
            <span className="ph-amt text-honey">{money(c.amount)}</span>
          </m.div>
        ))}
      </div>
      <Switch items={['Soon', 'Budgets', 'Goals', 'Subs']} />
    </>
  );
}

// ─── Explore ─────────────────────────────────────────────────────────────────

const EXPLORE_SCRIPT = [200] as const;

function ExploreScreen({ play }: { play: boolean }) {
  const phase = usePhases(EXPLORE_SCRIPT, play);
  const spent = MONTH.spentBefore + NEW_PURCHASE.amount;
  return (
    <>
      <div className="ph-title">Explore</div>
      <div className="ph-hero spectrum-fill">
        <div className="ph-hero-top"><span>Health score</span><span>out of 100</span></div>
        <div className="flex items-baseline gap-[0.4em]"><span className="ph-hero-big">{EXPLORE.score}</span><span className="text-[1.05em] font-bold">{EXPLORE.grade}</span></div>
        <div className="ph-hero-sub">Spent {money(spent)} of {money(MONTH.income)} income · 50/30/20 rule</div>
        <div className="ph-track"><m.span initial={false} animate={{ width: phase >= 1 || !play ? `${EXPLORE.score}%` : '0%' }} transition={{ duration: 0.9, ease: EASE_OUT }} /></div>
      </div>
      <div className="ph-line">
        <span>Spent <span className="font-mono text-tangerine">{money(spent)}</span></span>
        <span><span className="ph-dot bg-honey" />{EXPLORE.worth.length} worth a look</span>
      </div>
      <div className="font-display text-[1.25em] font-extrabold tracking-tight">Spending over time</div>
      <div className="ph-chart">
        <div className="ph-chips">
          {EXPLORE.series.map(s => (
            <span key={s.category} className="ph-chip" style={{ color: getCategoryTextColor(s.category), borderColor: `color-mix(in srgb, ${getCategoryColor(s.category)} 45%, transparent)`, background: `color-mix(in srgb, ${getCategoryColor(s.category)} 14%, transparent)` }}>{s.category}</span>
          ))}
        </div>
        <LineChart drawn={phase >= 1 || !play} />
      </div>
      <div className="ph-group">
        {EXPLORE.worth.map(w => (
          <div key={w.merchant} className="ph-row">
            <div className="ph-row-main"><span className="ph-row-title">{w.merchant}</span><span className="ph-row-sub">{w.note}</span></div>
            <span className={cn('ph-amt', !w.note.startsWith('First') && 'text-coral')}>{money(w.amount)}</span>
          </div>
        ))}
      </div>
      <Switch items={['Time', 'Category', 'Merchant', 'Week']} />
    </>
  );
}

function LineChart({ drawn }: { drawn: boolean }) {
  const reduce = useReducedMotion();
  const W = 200, H = 70, max = 60;
  const x = (i: number) => 6 + (i * (W - 12)) / 6;
  const y = (v: number) => H - 6 - (v / max) * (H - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} className="w-full">
      {[0, 20, 40, 60].map(v => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="var(--color-separator)" strokeWidth="0.6" />)}
      {EXPLORE.series.map((s, k) => {
        const d = s.points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
        return (
          <m.path
            key={s.category}
            d={d}
            fill="none"
            stroke={getCategoryColor(s.category)}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: drawn ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 1.1, ease: EASE_OUT, delay: k * 0.12 }}
          />
        );
      })}
      {[9, 10, 11, 12, 13, 14, 15].map((d, i) => <text key={d} x={x(i)} y={H + 9} textAnchor="middle" fontSize="6" fill="var(--color-muted)">{d}</text>)}
    </svg>
  );
}
