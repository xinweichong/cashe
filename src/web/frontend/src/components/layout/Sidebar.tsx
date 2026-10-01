import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Command, ListChecks, PanelLeft, Settings } from 'lucide-react';
import { MAIN_DESTINATIONS } from '@/lib/navigation';
import { ProfileMenu } from './ProfileMenu';
import { CasheWordmark, CasheIcon } from '@/components/ui/Brand';
import { useAttentionCount } from '@/hooks/useAttentionCount';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Approved shared owner (P2, HIG alignment 2026-10-01): the iPad/desktop
// sidebar, a frosted panel inset from the window edge. It shows icons only
// as a rail on md and expands at lg, unless the viewer chose otherwise
// (the toolbar button or ⌘⌥S), which is remembered per device. On md+
// Review and Settings live here rather than in the profile menu.

type Collapse = 'auto' | 'expanded' | 'collapsed';
const STORAGE_KEY = 'cashe-sidebar';

function readCollapse(): Collapse {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'expanded' || value === 'collapsed') return value;
  } catch { /* Private mode: follow the breakpoint. */ }
  return 'auto';
}

const SECONDARY = [
  { to: '/review', icon: ListChecks, label: 'Review' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const [collapse, setCollapse] = useState<Collapse>(readCollapse);
  const attention = useAttentionCount();

  // Rail = icons only. 'auto' leaves it to the breakpoint via CSS.
  const rail = collapse === 'collapsed';
  const expanded = collapse === 'expanded';
  const labelClass = rail ? 'sr-only' : expanded ? '' : 'sr-only lg:not-sr-only';
  const toggle = () => {
    // From 'auto', flip whichever state the breakpoint is showing.
    const showingRail = collapse === 'collapsed' || (collapse === 'auto' && !window.matchMedia?.('(min-width: 1024px)').matches);
    const next: Collapse = showingRail ? 'expanded' : 'collapsed';
    setCollapse(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Still applies for this visit. */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === 'KeyS') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const item = ({ to, icon: Icon, label }: { to: string; icon: typeof Settings; label: string }, count?: number) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      title={label}
      aria-label={count ? `${label}, ${count} to check` : label}
      className={({ isActive }) => cn(
        'pressable flex min-h-11 items-center gap-2.5 rounded-inset px-2.5 text-sm font-medium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        rail ? 'justify-center px-0' : expanded ? '' : 'justify-center px-0 lg:justify-start lg:px-2.5',
        isActive ? 'bg-teal font-semibold text-on-teal hover:bg-teal active:bg-teal' : 'text-foreground',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon aria-hidden className={cn('h-5 w-5 shrink-0', !isActive && 'text-teal')} />
          <span className={cn('flex-1 truncate', labelClass)}>{label}</span>
          {!!count && <span aria-hidden className={cn('text-xs tabular-nums', labelClass, isActive ? 'text-on-teal/80' : 'text-muted')}>{count}</span>}
        </>
      )}
    </NavLink>
  );

  return (
    <aside
      className={cn(
        'hidden md:flex sticky top-[env(safe-area-inset-top)] m-2 mr-0 h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] shrink-0 flex-col',
        'chrome-frosted rounded-group border-[0.5px] border-separator px-2 py-3 transition-[width] duration-[var(--dur-base)]',
        rail ? 'w-[4.25rem]' : expanded ? 'w-60' : 'w-[4.25rem] lg:w-60',
      )}
    >
      <div className={cn('flex items-center pb-3', rail ? 'flex-col gap-2' : expanded ? 'justify-between px-1.5' : 'flex-col gap-2 lg:flex-row lg:justify-between lg:px-1.5')}>
        <CasheIcon size={30} className={cn(rail ? '' : expanded ? 'hidden' : 'lg:hidden')} />
        {/* Wrapped: the wordmark's inline display style would beat a hidden class on itself. */}
        <span className={cn(rail ? 'hidden' : expanded ? 'inline-flex' : 'hidden lg:inline-flex')}><CasheWordmark size={20} /></span>
        <Button type="button" variant="ghost" size="icon" onClick={toggle} title="Toggle sidebar (⌘⌥S)" aria-label="Toggle sidebar" className="h-9 w-9">
          <PanelLeft aria-hidden className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
        {MAIN_DESTINATIONS.map((destination) => item(destination))}
      </nav>
      {/* The show/hide class sits on inner spans: not-sr-only resets padding. */}
      <p className="px-2.5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted"><span className={labelClass}>You</span></p>
      <nav aria-label="Account" className="flex flex-col gap-0.5">
        {SECONDARY.map((destination) => item(destination, destination.to === '/review' ? attention : undefined))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <ProfileMenu showDestinations={false} labelClassName={labelClass} />
        <div className={cn('items-center gap-2 px-2.5 py-2 text-xs text-muted', rail ? 'hidden' : expanded ? 'flex' : 'hidden lg:flex')}>
          <Command aria-hidden className="h-3.5 w-3.5" />K<span className="ml-auto">Search</span>
        </div>
      </div>
    </aside>
  );
}
