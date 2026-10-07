/**
 * Adapted from Kokonut UI "Background Paths" by @dorianbaffier (MIT)
 * https://kokonutui.com · https://github.com/kokonut-labs/kokonutui
 *
 * Landing page only (src/landing is a separate marketing surface; see
 * docs/design-language.md). Changes from the original: the Cashe spectrum
 * gradient, stable ids, the title removed, and the drift moved off SVG.
 * Animating 37 SVG paths re-rasterized the full-screen drawing every frame
 * (about 1.5 s of raster work per second); each group now drifts as one
 * compositor layer, drawn once.
 */
import { memo, useId } from 'react';
import './BackgroundPaths.css';

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

// Drift is the original's per-group y offset (15/10/5 of the 1600-unit
// viewBox) and duration, now set in BackgroundPaths.css. The original's
// per-path opacities were overridden by its fade-in to 1, so paths are opaque.
const GROUPS: { kind: Kind; count: number; width: (i: number) => number; groupOpacity: number }[] = [
  { kind: 'primary', count: 12, width: i => 4 + i * 0.3, groupOpacity: 1 },
  { kind: 'secondary', count: 15, width: i => 3 + i * 0.25, groupOpacity: 0.8 },
  { kind: 'accent', count: 10, width: i => 2 + i * 0.2, groupOpacity: 0.6 },
];

export const BackgroundPaths = memo(function BackgroundPaths() {
  const id = useId();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {GROUPS.map(g => (
        <div key={g.kind} className={`landing-drift landing-drift-${g.kind} absolute inset-0`} style={{ opacity: g.groupOpacity }}>
          <svg className="h-full w-full" fill="none" preserveAspectRatio="xMidYMid slice" viewBox="-2400 -800 4800 1600">
            <defs>
              <linearGradient id={`${id}-${g.kind}`} x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" stopColor="#00D4AA" stopOpacity="0.55" />
                <stop offset="50%" stopColor="#FBBF24" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#FF6B6B" stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {Array.from({ length: g.count }, (_, i) => (
              <path
                key={i}
                d={aestheticPath(i, g.kind)}
                stroke={`url(#${id}-${g.kind})`}
                strokeLinecap="round"
                strokeWidth={g.width(i)}
              />
            ))}
          </svg>
        </div>
      ))}
    </div>
  );
});
