import { formatCurrency, getPaceColor } from '@/lib/utils';
import { motion } from 'framer-motion';
import { springs } from '@/lib/animations';
import { useChartTheme } from '@/lib/chartTheme';

interface VelocityData {
  current_mtd: number;
  last_month_total: number;
  projected_total: number;
  pace_percent: number;
  status: string;
  days_elapsed: number;
  total_days: number;
}

export function VelocityRing({ data }: { data: VelocityData }) {
  const { COLOR_TRACK } = useChartTheme();
  const { pace_percent, status, current_mtd, projected_total, last_month_total } = data;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(pace_percent, 100) / 100;
  const strokeDashoffset = circumference - progress * circumference;

  const color = getPaceColor(pace_percent);

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-32 h-32 shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={radius} fill="none" stroke={COLOR_TRACK} strokeWidth="8" />
          <motion.circle
            cx="70" cy="70" r={radius} fill="none"
            stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={springs.gentle}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold">{Math.round(pace_percent)}%</span>
        </div>
      </div>
      <div className="space-y-1 text-sm">
        <p>Spent MTD: <span className="font-medium">{formatCurrency(current_mtd)}</span></p>
        <p>Projected: <span className="font-medium">{formatCurrency(projected_total)}</span></p>
        <p>Last month: <span className="font-medium">{formatCurrency(last_month_total)}</span></p>
        <p className={`font-medium ${status === 'ahead' ? 'text-destructive' : status === 'on_track' ? 'text-success' : 'text-info'}`}>
          {status === 'ahead' ? 'Spending ahead of pace' : status === 'on_track' ? 'On track' : 'Under pace'}
        </p>
      </div>
    </div>
  );
}
