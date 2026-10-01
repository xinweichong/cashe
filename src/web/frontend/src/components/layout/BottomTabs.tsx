import { MAIN_DESTINATIONS } from '@/lib/navigation';
import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { thumbSpring } from '@/lib/motionPresets';
import { useAttentionCount } from '@/hooks/useAttentionCount';
import { cn } from '@/lib/utils';

// Approved shared owner (P1, HIG alignment 2026-10-01): the phone tab bar,
// a floating frosted capsule. Content scrolls beneath it, so pages pad by
// TAB_BAR_CLEARANCE. The selected tab sits on a neutral fill that slides
// between tabs; Home carries the "to check" count.

/** Bottom padding that keeps page content clear of the capsule. body already
 * pads for the home indicator; the capsule is 56px tall and floats 12px above
 * it, plus 12px of breathing room. In px, like the bar itself. */
export const TAB_BAR_CLEARANCE = 'pb-[80px] md:pb-0';

export function BottomTabs() {
  const attention = useAttentionCount();
  return (
    <nav
      aria-label="Main navigation"
      className="md:hidden fixed inset-x-3 z-50 bottom-[calc(12px+env(safe-area-inset-bottom))] chrome-frosted rounded-capsule border-[0.5px] border-separator shadow-float"
    >
      {/* Fixed px throughout, as on iOS: the tab bar doesn't grow with the
          text size, so four tabs always fit a 320px-wide phone. */}
      <div className="flex items-center justify-around p-[6px]">
        {MAIN_DESTINATIONS.map(({ to, icon: Icon, label }) => {
          const badge = to === '/' && attention ? attention : undefined;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              aria-label={badge ? `${label}, ${badge} to check` : label}
              className={({ isActive }) => cn(
                'relative flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-[2px] rounded-[18px] px-[8px] py-[4px]',
                'pressable-scale font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'text-foreground' : 'text-muted active:text-foreground',
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && <motion.span aria-hidden layoutId="tab-bar-selection" transition={thumbSpring} className="absolute inset-0 -z-10 rounded-[18px] bg-fill-press" />}
                  <Icon aria-hidden className="h-[22px] w-[22px]" />
                  {/* Tab labels stay put at large text sizes, as on iOS. */}
                  <span className="text-[11px] leading-none">{label}</span>
                  {badge && (
                    <span aria-hidden className="absolute right-[8px] top-[2px] min-w-[16px] rounded-pill bg-teal px-[4px] text-center text-[10px] font-bold leading-[16px] text-on-teal tabular-nums">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
