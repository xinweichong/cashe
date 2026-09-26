import { MAIN_DESTINATIONS } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Command } from 'cmdk';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/api/client';
import { toDateStr } from '@/lib/utils';
import {
  LayoutDashboard, List, BarChart3, Store, Wallet, Settings, Plus,
} from 'lucide-react';

const PAGES = [
  { to: '/',             icon: LayoutDashboard, label: 'Overview'     },
  { to: '/transactions', icon: List,            label: 'Transactions' },
  { to: '/analytics',    icon: BarChart3,       label: 'Analytics'    },
  { to: '/finance',      icon: Wallet,          label: 'Finance'      },
  { to: '/merchants',    icon: Store,           label: 'Merchants'    },
  { to: '/settings',     icon: Settings,        label: 'Settings'     },
];

const ITEM_CLASS =
  'flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer ' +
  'text-foreground data-[selected=true]:bg-foreground/10';

export function CommandPalette({ newExperience = false }: { newExperience?: boolean }) {
  const pages = newExperience ? [...MAIN_DESTINATIONS, { to: '/settings', icon: Settings, label: 'Settings' }] : PAGES;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { data: merchants } = useQuery({
    queryKey: ['palette-merchants'],
    queryFn: () => {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 1);
      return api.getMerchants(toDateStr(start), toDateStr(end));
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="p-0 gap-0 max-w-lg overflow-hidden"
        style={{ boxShadow: 'var(--shadow-glow-teal)', backdropFilter: 'blur(20px)' }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          transition={{ type: 'tween', ease: [0.16, 1, 0.3, 1], duration: 0.2 }}
        >
          <Command
            label="Command palette"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-muted"
          >
            <Command.Input
              placeholder="Jump to…"
              className="w-full px-4 py-3 text-sm bg-transparent border-b border-border text-foreground placeholder:text-muted focus:outline-none"
            />
            <Command.List className="max-h-72 overflow-y-auto p-2">
              <Command.Empty className="py-6 text-center text-sm text-muted">
                Nothing matches.
              </Command.Empty>
              <Command.Group heading="Pages">
                {pages.map(({ to, icon: Icon, label }) => (
                  <Command.Item
                    key={to}
                    className={ITEM_CLASS}
                    onSelect={() => run(() => navigate(to))}
                  >
                    <Icon className="w-4 h-4 text-muted" />
                    {label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions">
                <Command.Item
                  className={ITEM_CLASS}
                  onSelect={() => run(() => navigate(`${newExperience ? '/activity' : '/transactions'}?add=1`))}
                >
                  <Plus className="w-4 h-4 text-muted" />
                  Add transaction
                </Command.Item>
              </Command.Group>
              {merchants && merchants.length > 0 && (
                <Command.Group heading="Merchants">
                  {merchants.slice(0, 50).map((m) => (
                    <Command.Item
                      key={m}
                      className={ITEM_CLASS}
                      onSelect={() =>
                        run(() => navigate(`${newExperience ? '/explore/merchants' : '/merchants'}/${encodeURIComponent(m)}`))
                      }
                    >
                      <Store className="w-4 h-4 text-muted" />
                      {m}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
