import { ProfileMenu } from './ProfileMenu';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { BottomTabs } from './BottomTabs';
import { CasheWordmark, B2_WASH } from '@/components/ui/Brand';
import { CommandPalette } from '@/components/CommandPalette';
import { PullToRefresh } from './PullToRefresh';
import { pageVariants } from '@/lib/animations';

export function AppShell({ newExperience = false }: { newExperience?: boolean }) {
  const location = useLocation();
  const shouldReduce = useReducedMotion();
  // Keep list filters and drafts mounted when opening a detail route.
  const pageKey = location.pathname.replace(/^(\/(?:activity|transactions|merchants|explore\/merchants))(?:\/.*)?$/, '$1');

  return (
    <div className={`min-h-screen flex ${newExperience ? 'experience-next bg-background' : ''}`} style={newExperience ? undefined : { background: B2_WASH }}>
      <CommandPalette newExperience={newExperience} />
      <Sidebar newExperience={newExperience} />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile-only top bar — hidden on md+ where sidebar provides branding */}
        <header className="md:hidden sticky top-0 z-40 h-12 shrink-0 bg-card/80 backdrop-blur-sm border-b border-border flex items-center px-4 gap-2">
          <CasheWordmark size={22} />
          {newExperience && <div className="ml-auto"><ProfileMenu /></div>}
        </header>
        <main className="flex-1 min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pageKey}
              variants={shouldReduce ? undefined : pageVariants}
              initial={shouldReduce ? false : 'initial'}
              animate={shouldReduce ? undefined : 'animate'}
              exit={shouldReduce ? undefined : 'exit'}
              className="md:h-full"
            >
              <PullToRefresh>
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center py-24">
                      <span className="text-xs text-muted font-mono uppercase tracking-[0.22em]">
                        Catching up…
                      </span>
                    </div>
                  }
                >
                  <Outlet />
                </Suspense>
              </PullToRefresh>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <BottomTabs newExperience={newExperience} />
    </div>
  );
}
