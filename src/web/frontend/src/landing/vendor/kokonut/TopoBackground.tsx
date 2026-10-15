/**
 * Adapted from Kokonut UI "Topo Background" v1.1.0 by @dorianbaffier (MIT)
 * https://kokonutui.com · https://github.com/kokonut-labs/kokonutui
 *
 * Landing page only: the contour lines behind the purchases in the hero.
 * Changes from the original: no elevation labels and no built-in content; the
 * map fills its positioned parent; lines are stroked with cashe's spectrum
 * (teal, mint, honey, tangerine, coral) read from the theme tokens, so they
 * follow light and dark; the fade is a soft oval so it sits into the hero
 * without a box edge; the click ripple is gone (clicks belong to the page);
 * lines are fainter.
 */
import { useEffect, useRef } from "react";
import { cn } from '@/lib/utils';

export interface TopoBackgroundProps {
  className?: string;
  /** Height difference between two contour lines. Lower draws more lines. */
  interval?: number;
  /** How fast the terrain drifts. 0 holds it still. */
  speed?: number;
  /** Raise a hill under the cursor. */
  interactive?: boolean;
  /** Seed for the terrain, so the page always opens on the same map. */
  seed?: number;
}

// The brand spectrum, as theme tokens (index.css), first to last.
const SPECTRUM = ["teal", "mint", "honey", "tangerine", "coral"];
// Distance between field samples, in CSS px.
const CELL = 12;
// Width of a hill in the terrain, in px.
const TERRAIN_SCALE = 360;
// Every fifth line is an index contour, drawn heavier, as on a real map.
const INDEX_EVERY = 5;
const HILL_HEIGHT = 0.45;
const HILL_SPREAD = 130;
const HILL_FOLLOW = 9;
const HILL_RISE = 5;
// When nothing is moving but the drift, a frame every 33ms is plenty.
const IDLE_FRAME_MS = 33;

/** Seeded 3D gradient noise (Ken Perlin's improved noise), about -1 to 1. */
function createNoise(seed: number) {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [p[i], p[j]] = [p[j] as number, p[i] as number];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] as number;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    let v = z;
    if (h < 4) v = y;
    else if (h === 12 || h === 14) v = x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  const at = (i: number) => perm[i] as number;

  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const A = at(X) + Y;
    const AA = at(A) + Z;
    const AB = at(A + 1) + Z;
    const B = at(X + 1) + Y;
    const BA = at(B) + Z;
    const BB = at(B + 1) + Z;
    return lerp(
      lerp(
        lerp(grad(at(AA), fx, fy, fz), grad(at(BA), fx - 1, fy, fz), u),
        lerp(grad(at(AB), fx, fy - 1, fz), grad(at(BB), fx - 1, fy - 1, fz), u),
        v,
      ),
      lerp(
        lerp(grad(at(AA + 1), fx, fy, fz - 1), grad(at(BA + 1), fx - 1, fy, fz - 1), u),
        lerp(grad(at(AB + 1), fx, fy - 1, fz - 1), grad(at(BB + 1), fx - 1, fy - 1, fz - 1), u),
        v,
      ),
      w,
    );
  };
}

/**
 * The segment a contour draws through one grid cell, given which corners are
 * above the level (bits: top-left 8, top-right 4, bottom-right 2, bottom-left 1).
 */
function cellSegments(
  path: Path2D,
  index: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  cross: { top: number; right: number; bottom: number; left: number },
) {
  const { x0, y0, x1, y1 } = box;
  const { top, right, bottom, left } = cross;
  const line = (ax: number, ay: number, bx: number, by: number) => {
    path.moveTo(ax, ay);
    path.lineTo(bx, by);
  };
  switch (index) {
    case 1:
    case 14:
      line(x0, left, bottom, y1);
      break;
    case 2:
    case 13:
      line(bottom, y1, x1, right);
      break;
    case 3:
    case 12:
      line(x0, left, x1, right);
      break;
    case 4:
    case 11:
      line(top, y0, x1, right);
      break;
    case 6:
    case 9:
      line(top, y0, bottom, y1);
      break;
    case 7:
    case 8:
      line(x0, left, top, y0);
      break;
    // The two saddles: opposite corners are high, so the level crosses twice.
    case 5:
      line(x0, left, top, y0);
      line(bottom, y1, x1, right);
      break;
    case 10:
      line(top, y0, x1, right);
      line(x0, left, bottom, y1);
      break;
    default:
      break;
  }
}

/** Marching squares over the sampled field; index contours get their own path. */
function traceContours(
  field: Float32Array,
  cols: number,
  rows: number,
  interval: number,
  minor: Path2D,
  major: Path2D,
) {
  const value = (i: number) => field[i] as number;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = value(j * cols + i);
      const b = value(j * cols + i + 1);
      const c = value((j + 1) * cols + i + 1);
      const d = value((j + 1) * cols + i);
      const first = Math.ceil(Math.min(a, b, c, d) / interval);
      const last = Math.floor(Math.max(a, b, c, d) / interval);
      if (first > last) continue;
      const x0 = i * CELL;
      const y0 = j * CELL;
      const box = { x0, y0, x1: x0 + CELL, y1: y0 + CELL };
      for (let level = first; level <= last; level++) {
        const t = level * interval;
        const index = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
        if (index === 0 || index === 15) continue;
        cellSegments(level % INDEX_EVERY === 0 ? major : minor, index, box, {
          top: x0 + CELL * ((t - a) / (b - a)),
          right: y0 + CELL * ((t - b) / (c - b)),
          bottom: x0 + CELL * ((t - d) / (c - d)),
          left: y0 + CELL * ((t - a) / (d - a)),
        });
      }
    }
  }
}

interface Hill {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  amount: number;
  on: boolean;
}

/** Ease the hill towards the cursor and up or down. True while it moves. */
function stepHill(hill: Hill, dt: number) {
  const follow = 1 - Math.exp(-HILL_FOLLOW * dt);
  hill.x += (hill.targetX - hill.x) * follow;
  hill.y += (hill.targetY - hill.y) * follow;
  const goal = hill.on ? 1 : 0;
  hill.amount += (goal - hill.amount) * (1 - Math.exp(-HILL_RISE * dt));
  return (
    Math.abs(hill.targetX - hill.x) > 0.5 ||
    Math.abs(hill.targetY - hill.y) > 0.5 ||
    Math.abs(goal - hill.amount) > 0.002
  );
}

export function TopoBackground({
  className,
  interval = 0.075,
  speed = 0.8,
  interactive = true,
  seed = 8,
}: TopoBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const host = root?.parentElement;
    if (!(root && canvas && ctx && host)) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noise = createNoise(seed);
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let field = new Float32Array(0);
    let color: CanvasGradient | string = "";
    const hill: Hill = { x: 0, y: 0, targetX: 0, targetY: 0, amount: 0, on: false };
    let time = 0;
    let last = 0;
    let lastPaint = 0;
    let raf = 0;
    let visible = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL) + 1;
      rows = Math.ceil(height / CELL) + 1;
      field = new Float32Array(cols * rows);
      color = spectrum();
    };

    // The spectrum runs across the map, corner to corner, in the current
    // theme's shades of the brand colours.
    const spectrum = () => {
      const css = getComputedStyle(document.documentElement);
      const stops = SPECTRUM.map((name) => css.getPropertyValue(`--color-${name}`).trim()).filter(Boolean);
      if (!stops.length) return getComputedStyle(canvas).color;
      const gradient = ctx.createLinearGradient(0, height, width, 0);
      stops.forEach((stop, i) => gradient.addColorStop(i / Math.max(1, stops.length - 1), stop));
      return gradient;
    };

    const sample = () => {
      const z = time * 0.05;
      const drift = time * 6;
      const hillOn = hill.amount > 0.001;
      const spread = 2 * HILL_SPREAD * HILL_SPREAD;
      for (let j = 0; j < rows; j++) {
        const y = j * CELL;
        for (let i = 0; i < cols; i++) {
          const x = i * CELL;
          const nx = (x + drift) / TERRAIN_SCALE;
          const ny = y / TERRAIN_SCALE;
          let v = noise(nx, ny, z) * 0.78 + noise(nx * 2.3 + 17.1, ny * 2.3 + 4.7, z * 1.4) * 0.22;
          if (hillOn) {
            const dx = x - hill.x;
            const dy = y - hill.y;
            v += HILL_HEIGHT * hill.amount * Math.exp(-(dx * dx + dy * dy) / spread);
          }
          field[j * cols + i] = v;
        }
      }
    };

    const paint = () => {
      sample();
      const minor = new Path2D();
      const major = new Path2D();
      traceContours(field, cols, rows, interval, minor, major);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 0.8;
      ctx.stroke(minor);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.1;
      ctx.stroke(major);
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      const settling = stepHill(hill, dt);
      time += dt * speed;
      // The drift alone is slow; half the frame rate looks the same and costs
      // half as much. Anything following the hand gets every frame.
      if (settling || now - lastPaint >= IDLE_FRAME_MS) {
        paint();
        lastPaint = now;
      }
      if (speed > 0 || settling) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible && !reduceMotion) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    // Follow light and dark mode by re-reading the colours when they change:
    // the system setting, or cashe's own choice on the root element.
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      color = spectrum();
      paint();
    };
    scheme.addEventListener("change", onScheme);
    const themeObserver = new MutationObserver(onScheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    resize();
    paint();
    canvas.style.opacity = "1";
    start();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      paint();
    });
    resizeObserver.observe(canvas);

    // Stop drawing while the map is scrolled away or the tab is hidden.
    let onScreen = true;
    const updateVisible = () => {
      visible = onScreen && document.visibilityState === "visible";
      if (visible) start();
    };
    const intersection = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      updateVisible();
    });
    intersection.observe(root);
    document.addEventListener("visibilitychange", updateVisible);

    const onMove = (event: PointerEvent) => {
      // Touch has no hover; a hill stuck where a finger lifted looks wrong.
      if (event.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!hill.on) {
        hill.x = x;
        hill.y = y;
      }
      hill.targetX = x;
      hill.targetY = y;
      hill.on = true;
      start();
    };
    const onLeave = () => {
      hill.on = false;
      start();
    };
    if (interactive && !reduceMotion) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      scheme.removeEventListener("change", onScheme);
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", updateVisible);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [interval, speed, interactive, seed]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full opacity-0 transition-opacity duration-700 ease-out"
        style={{
          maskImage: "radial-gradient(70% 62% at 55% 50%, #000 35%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(70% 62% at 55% 50%, #000 35%, transparent 100%)",
        }}
      />
    </div>
  );
}
