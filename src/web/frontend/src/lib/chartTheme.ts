import { useTheme } from '@/hooks/useTheme';
import type { CSSProperties } from 'react';

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: '#161624',
  color: '#EEEAF5',
  border: '1px solid #2A2A3F',
  borderRadius: '8px',
  fontSize: '13px',
};

export const CHART_AXIS_PROPS = {
  tick: { fontSize: 11, fill: '#A8A1B5' },
  tickLine: false,
  axisLine: false,
};

export const CHART_CURSOR_BAR = { fill: '#1C1C22' };
export const CHART_CURSOR_LINE = { stroke: '#2A2A3F', strokeWidth: 1 };

export const CHART_LEGEND_STYLE: CSSProperties = {
  fontSize: '12px',
  color: '#A8A1B5',
};

// Spectrum data colors
export const COLOR_TEAL      = '#00D4AA';
export const COLOR_MINT      = '#34D399';
export const COLOR_HONEY     = '#FBBF24';
export const COLOR_TANGERINE = '#FB923C';
export const COLOR_CORAL     = '#FF6B6B';
export const COLOR_MUTED_BAR = '#3A3A46';

/** Ring/gauge track — = --color-border */
export const COLOR_TRACK = '#2A2A3F';
/** SVG text fill — = --color-foreground */
export const COLOR_FOREGROUND = '#EEEAF5';

// 10-color cohesive palette sampled along the spectrum.
// Used for category fills (donut chart, category pills).
export const SPECTRUM_PALETTE = [
  '#00D4AA', '#2DD4BF', '#34D399', '#84CC16', '#EAB308',
  '#FBBF24', '#F97316', '#FB923C', '#FB7185', '#FF6B6B',
];

/** XAxis tick: show day-of-month only (e.g. "15") */
export function formatDateTick(v: string): string {
  return new Date(v).getDate().toString();
}

/** Tooltip label: short date (e.g. "15 Apr") */
export function formatDateLabel(v: unknown): string {
  return new Date(String(v)).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

const DARK_CHART_THEME = {
  CHART_TOOLTIP_STYLE, CHART_AXIS_PROPS, CHART_CURSOR_BAR, CHART_CURSOR_LINE,
  CHART_LEGEND_STYLE, COLOR_MUTED_BAR, COLOR_TRACK, COLOR_FOREGROUND, COLOR_TEAL,
};
const LIGHT_CHART_THEME = {
  CHART_TOOLTIP_STYLE: { ...CHART_TOOLTIP_STYLE, background: '#FFFFFF', color: '#201C2C', border: '1px solid #D9D5E1' },
  CHART_AXIS_PROPS: { ...CHART_AXIS_PROPS, tick: { ...CHART_AXIS_PROPS.tick, fill: '#625C70' } },
  CHART_CURSOR_BAR: { fill: '#EDEAF2' },
  CHART_CURSOR_LINE: { ...CHART_CURSOR_LINE, stroke: '#D9D5E1' },
  CHART_LEGEND_STYLE: { ...CHART_LEGEND_STYLE, color: '#625C70' },
  COLOR_MUTED_BAR: '#82798F', COLOR_TRACK: '#D9D5E1', COLOR_FOREGROUND: '#201C2C', COLOR_TEAL: '#007A63',
};

/** Recharts receives explicit hex values and rerenders without remounting page state. */
export function useChartTheme() {
  return useTheme().resolved === 'light' ? LIGHT_CHART_THEME : DARK_CHART_THEME;
}
