import { MAIN_DESTINATIONS } from '@/lib/navigation';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, List, BarChart3, Store, Wallet, Settings } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { springs } from '@/lib/animations';

const TABS = [
  { to: '/',             icon: LayoutDashboard, label: 'Overview'     },
  { to: '/transactions', icon: List,            label: 'Transactions' },
  { to: '/analytics',   icon: BarChart3,       label: 'Analytics'    },
  { to: '/merchants',   icon: Store,           label: 'Merchants'    },
  { to: '/finance',     icon: Wallet,          label: 'Finance'      },
  { to: '/settings',    icon: Settings,        label: 'Settings'     },
];

export function BottomTabs({ newExperience = false }: { newExperience?: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.nav
      aria-label="Main navigation"
      initial={reduceMotion ? false : { y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={springs.expo}
      className="md:hidden fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-sm border-t border-border z-50"
    >
      <div className="flex justify-around items-center h-16">
        {(newExperience ? MAIN_DESTINATIONS : TABS).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `min-h-11 min-w-11 flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] transition-colors relative ${
                isActive ? 'text-teal' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" />
                <span>{label}</span>
                {isActive && (
                  <motion.div
                    layoutId="bottom-tab-dot"
                    className="absolute bottom-0 w-1 h-1 rounded-full bg-teal"
                    transition={springs.snappy}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </motion.nav>
  );
}
