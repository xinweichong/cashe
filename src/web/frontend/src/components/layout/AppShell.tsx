import { ProfileMenu } from './ProfileMenu';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { BottomTabs, TAB_BAR_CLEARANCE } from './BottomTabs';
import { CasheWordmark } from '@/components/ui/Brand';
import { CommandPalette } from '@/components/CommandPalette';
import { PullToRefresh } from './PullToRefresh';
import { pageVariants } from '@/lib/motionPresets';

// Tab roots migrated to their own large-title NavBar (P3), which carries the
// profile menu on a phone. The rest keep the shell's phone bar until they move.
const ownNavBar = (path: string) => path === '/' || path === '/home' || /^\/(activity|transactions|evidence|plan|explore)(\/|$)/.test(path);

export function AppShell() {
  const location = useLocation();
  const shouldReduce = useReducedMotion();
  // Keep list filters and drafts mounted when opening a detail route.
  const pageKey = location.pathname.replace(/^(\/(?:activity|transactions|merchants|explore\/merchants))(?:\/.*)?$/, '$1');

  // body already pads for the status bar and home indicator (index.css), so
  // the shell fills the rest rather than a full extra screen height.
  return (
    <div className="min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex experience-next chrome-wash">
      <CommandPalette />
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Phone-only top bar until each tab root carries its own NavBar (plan steps 4–10). */}
        {!ownNavBar(location.pathname) && (
          <header className="md:hidden sticky top-0 z-40 h-12 shrink-0 chrome-frosted border-b-[0.5px] border-separator flex items-center px-4 gap-2">
            <CasheWordmark size={22} />
            <div className="ml-auto"><ProfileMenu /></div>
          </header>
        )}
        {/* overflow-x-clip, not hidden: a scroll container here would stop NavBar and Toolbar sticking. */}
        <main className={`flex-1 min-w-0 overflow-x-clip ${TAB_BAR_CLEARANCE}`}>
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
      <BottomTabs />
    </div>
  );
}
