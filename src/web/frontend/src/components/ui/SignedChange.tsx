import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatMoneyAbs, type Money } from '@/api/briefing';

// A money change as an up/down arrow and its unsigned amount.
export function SignedChange({ change }: { change: Money }) {
  return (
    <>
      {change.minor_units >= 0 ? <ArrowUp size={12} aria-label="up" /> : <ArrowDown size={12} aria-label="down" />}
      {formatMoneyAbs(change)}
    </>
  );
}
