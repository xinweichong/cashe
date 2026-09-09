import {
  useCallback, useRef, useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToastContext } from '@/hooks/useToastContext';

const DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string) => {
    clearTimeout(timer.current);
    setToast({ message });
    timer.current = setTimeout(() => setToast(null), DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key="toast"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
            className="fixed z-[60] bottom-20 left-1/2 -translate-x-1/2 md:bottom-6 md:left-auto md:right-6 md:translate-x-0 px-4 py-2.5 rounded-md bg-card-elev border border-border shadow-elev-md text-sm text-foreground"
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
}
