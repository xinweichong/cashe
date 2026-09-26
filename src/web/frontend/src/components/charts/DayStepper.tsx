import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Previous/next-day buttons around a trend chart's selected-day readout.
export function DayStepper({ testId, canPrev, canNext, onStep, children }: {
  testId: string;
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: -1 | 1) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mt-2" data-testid={testId}>
      <Button type="button" variant="ghost" size="icon" onClick={() => onStep(-1)} disabled={!canPrev} aria-label="Previous day">
        <ChevronLeft size={16} aria-hidden />
      </Button>
      <p className="text-sm font-mono tabular-nums text-center">{children}</p>
      <Button type="button" variant="ghost" size="icon" onClick={() => onStep(1)} disabled={!canNext} aria-label="Next day">
        <ChevronRight size={16} aria-hidden />
      </Button>
    </div>
  );
}

export function NoTrendData() {
  return <div className="w-full h-full min-h-[160px] flex items-center justify-center text-muted text-sm">No trend data</div>;
}
