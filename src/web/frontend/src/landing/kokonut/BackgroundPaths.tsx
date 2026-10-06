/**
 * Adapted from Kokonut UI "Background Paths" by @dorianbaffier (MIT)
 * https://kokonutui.com · https://github.com/kokonut-labs/kokonutui
 *
 * Landing page only (src/landing is a separate marketing surface; see
 * docs/design-language.md). Changes from the original: the Cashe spectrum
 * gradient, stable ids, m.* for LazyMotion, and the title removed.
 */
import { m } from 'motion/react';
import { memo, useId } from 'react';

type Kind = 'primary' | 'secondary' | 'accent';

function aestheticPath(index: number, kind: Kind): string {
  const amplitude = kind === 'primary' ? 150 : kind === 'secondary' ? 100 : 60;
  const segments = kind === 'primary' ? 10 : kind === 'secondary' ? 8 : 6;
  const phase = index * 0.2;
  const [startX, startY, endX, endY] = [2400, 800, -2400, -800 + index * 25];
  const points = Array.from({ length: segments + 1 }, (_, i) => {
    const progress = i / segments;
    const eased = 1 - (1 - progress) ** 2;
    const factor = 1 - eased * 0.3;
    const wave =
      Math.sin(progress * Math.PI * 3 + phase) * amplitude * 0.7 * factor +
      Math.cos(progress * Math.PI * 4 + phase) * amplitude * 0.3 * factor +
      Math.sin(progress * Math.PI * 2 + phase) * amplitude * 0.2 * factor;
    return { x: startX + (endX - startX) * eased, y: startY + (endY - startY) * eased + wave };
  });
  return points.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    return `C ${prev.x + (p.x - prev.x) * 0.4} ${prev.y}, ${prev.x + (p.x - prev.x) * 0.6} ${p.y}, ${p.x} ${p.y}`;
  }).join(' ');
}

const GROUPS: { kind: Kind; count: number; opacity: (i: number) => number; width: (i: number) => number; drift: number; duration: number; groupOpacity: number }[] = [
  { kind: 'primary', count: 12, opacity: i => 0.15 + i * 0.02, width: i => 4 + i * 0.3, drift: 15, duration: 8, groupOpacity: 1 },
  { kind: 'secondary', count: 15, opacity: i => 0.12 + i * 0.015, width: i => 3 + i * 0.25, drift: 10, duration: 6, groupOpacity: 0.8 },
  { kind: 'accent', count: 10, opacity: i => 0.08 + i * 0.12, width: i => 2 + i * 0.2, drift: 5, duration: 4, groupOpacity: 0.6 },
];

export const BackgroundPaths = memo(function BackgroundPaths() {
  const gradient = useId();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="h-full w-full" fill="none" preserveAspectRatio="xMidYMid slice" viewBox="-2400 -800 4800 1600">
        <defs>
          <linearGradient id={gradient} x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#00D4AA" stopOpacity="0.55" />
            <stop offset="50%" stopColor="#FBBF24" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#FF6B6B" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {GROUPS.map(g => (
          <g key={g.kind} style={{ opacity: g.groupOpacity }}>
            {Array.from({ length: g.count }, (_, i) => (
              <m.path
                key={i}
                d={aestheticPath(i, g.kind)}
                stroke={`url(#${gradient})`}
                strokeLinecap="round"
                strokeWidth={g.width(i)}
                style={{ opacity: g.opacity(i) }}
                initial={{ opacity: 0, scale: g.kind === 'primary' ? 0.8 : g.kind === 'secondary' ? 0.9 : 0.95 }}
                animate={{ opacity: 1, scale: 1, y: [0, -g.drift, 0] }}
                transition={{
                  opacity: { duration: 1 }, scale: { duration: 1 },
                  y: { duration: g.duration, repeat: Infinity, ease: 'easeInOut', repeatType: 'reverse' },
                }}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
});
