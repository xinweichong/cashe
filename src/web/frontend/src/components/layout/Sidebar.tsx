import { MAIN_DESTINATIONS } from '@/lib/navigation';
import { ProfileMenu } from './ProfileMenu';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, List, BarChart3, Store, Wallet, Settings, Lock, Command } from 'lucide-react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { CasheWordmark, CasheIcon } from '@/components/ui/Brand';
import { springs } from '@/lib/animations';

export function Sidebar({ newExperience = false }: { newExperience?: boolean }) {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    staleTime: 30_000,
  });
  const financeEnabled =
    settings?.budgets_enabled ||
    settings?.goals_enabled ||
    settings?.trips_enabled ||
    settings?.subscriptions_enabled;

  const navItems = newExperience ? MAIN_DESTINATIONS : [
    { to: '/', icon: LayoutDashboard, label: 'Overview' },
    { to: '/transactions', icon: List, label: 'Transactions' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/merchants', icon: Store, label: 'Merchants' },
  ];

  return (
    <aside className="hidden md:flex flex-col w-14 lg:w-56 bg-card/80 backdrop-blur-sm border-r border-border h-screen sticky top-0">
      <div className="flex items-center justify-center lg:justify-start gap-3 px-3 py-5 lg:px-4">
        <CasheIcon size={32} className="lg:hidden" />
        <CasheWordmark size={22} className="hidden lg:inline-flex" />
      </div>

      <nav aria-label="Main navigation" className="flex-1 px-2 lg:px-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            aria-label={label}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors justify-center lg:justify-start ${
                isActive
                  ? 'bg-teal/10 text-foreground font-medium'
                  : 'text-muted hover:text-foreground hover:bg-foreground/5'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5 shrink-0" />
                <span className="hidden lg:inline font-display">{label}</span>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-dot"
                    className="absolute right-2 w-1.5 h-1.5 rounded-full bg-teal"
                    transition={springs.snappy}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}

        {!newExperience && <>
        <NavLink
          to="/finance"
          className={({ isActive }) =>
            `relative min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors justify-center lg:justify-start ${
              isActive
                ? 'bg-teal/10 text-foreground font-medium'
                : 'text-muted hover:text-foreground hover:bg-foreground/5'
            } ${!financeEnabled ? 'opacity-40' : ''}`
          }
        >
          {({ isActive }) => (
            <>
              <Wallet className="w-5 h-5 shrink-0" />
              <span className="hidden lg:flex items-center gap-1 font-display">
                Finance
                {!financeEnabled && <Lock className="w-3 h-3 ml-1" />}
              </span>
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-dot"
                  className="absolute right-2 w-1.5 h-1.5 rounded-full bg-teal"
                  transition={springs.snappy}
                />
              )}
            </>
          )}
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `relative min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors justify-center lg:justify-start ${
              isActive
                ? 'bg-teal/10 text-foreground font-medium'
                : 'text-muted hover:text-foreground hover:bg-foreground/5'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Settings className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline font-display">Settings</span>
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-dot"
                  className="absolute right-2 w-1.5 h-1.5 rounded-full bg-teal"
                  transition={springs.snappy}
                />
              )}
            </>
          )}
        </NavLink>
        </>}
      </nav>
      <div className="p-1 lg:p-3"><ProfileMenu /></div>

      {/* ⌘K hint — desktop only */}
      <div className="hidden lg:flex items-center gap-2 px-4 py-4 border-t border-border/30 text-[11px] text-muted/60 font-mono">
        <Command className="w-3 h-3" />
        <span>K</span>
        <span className="ml-auto">search</span>
      </div>
    </aside>
  );
}
