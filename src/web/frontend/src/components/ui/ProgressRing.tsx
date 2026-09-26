import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/lib/motionPresets';

// A circular progress track. `children` are SVG nodes drawn on top (e.g. a
// centred <text>); `animated` sweeps the arc in from empty.
export function ProgressRing({ percent, color, size, radius, strokeWidth, track = 'var(--color-border)', animated = false, children, ...svgProps }: {
  percent: number;
  color: string;
  size: number;
  radius: number;
  strokeWidth: number;
  track?: string;
  animated?: boolean;
  children?: ReactNode;
  role?: string;
  'aria-label'?: string;
}) {
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(percent, 0), 100) / 100);
  const arc = {
    cx: centre, cy: centre, r: radius, fill: 'none', stroke: color, strokeWidth,
    strokeDasharray: circumference, strokeLinecap: 'round' as const, transform: `rotate(-90 ${centre} ${centre})`,
  };
  return (
    <svg width={size} height={size} className="shrink-0" {...svgProps}>
      <circle cx={centre} cy={centre} r={radius} fill="none" stroke={track} strokeWidth={strokeWidth} />
      {animated
        ? <motion.circle {...arc} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={springs.gentle} />
        : <circle {...arc} strokeDashoffset={offset} />}
      {children}
    </svg>
  );
}
