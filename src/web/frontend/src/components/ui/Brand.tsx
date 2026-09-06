import type { CSSProperties } from 'react';

export const B1_WASH =
  'linear-gradient(135deg, rgba(0,212,170,.38) 0%, transparent 35%, transparent 58%, rgba(234,88,12,.34) 82%, rgba(220,38,38,.3) 100%), var(--color-background)';

export const B2_WASH =
  'linear-gradient(135deg, rgba(0,212,170,.08) 0%, transparent 30%, transparent 68%, rgba(234,88,12,.07) 86%, rgba(220,38,38,.06) 100%), var(--color-background)';

const WARM_GRADIENT = 'linear-gradient(135deg, #D97706, #EA580C 50%, #DC2626)';

const dollarStyle: CSSProperties = {
  background: WARM_GRADIENT,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
  margin: '0 -0.02em',
};

const tealStyle: CSSProperties = {
  color: 'var(--color-teal)',
};

interface CasheWordmarkProps {
  size?: number;
  className?: string;
}

export function CasheWordmark({ size = 22, className }: CasheWordmarkProps) {
  const rootStyle: CSSProperties = {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontWeight: 800,
    letterSpacing: '-0.045em',
    lineHeight: 0.9,
    fontSize: `${size}px`,
    display: 'inline-flex',
    alignItems: 'baseline',
  };

  return (
    <span style={rootStyle} className={className} aria-label="cashe">
      <span style={tealStyle}>ca</span>
      <span style={dollarStyle}>$</span>
      <span style={tealStyle}>he</span>
    </span>
  );
}

interface CasheIconProps {
  size?: number;
  className?: string;
}

export function CasheIcon({ size = 32, className }: CasheIconProps) {
  const wrapStyle: CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    background: B1_WASH,
    border: '1px solid var(--color-border)',
    borderRadius: '25.5%',
    boxShadow: '0 18px 40px -30px rgba(0,212,170,.85)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  };

  const glyphStyle: CSSProperties = {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontWeight: 800,
    fontSize: `${Math.round(size * 0.724)}px`,
    letterSpacing: '-0.05em',
    lineHeight: 0.9,
    background: WARM_GRADIENT,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    transform: 'translate(-1px, -1px)',
  };

  return (
    <span style={wrapStyle} className={className} aria-label="cashe">
      <span style={glyphStyle}>$</span>
    </span>
  );
}

interface CasheBrandLockupProps {
  size?: number;
  className?: string;
}

export function CasheBrandLockup({ size = 160, className }: CasheBrandLockupProps) {
  const wmSize = Math.round(size * 34 / 116);
  const tlSize = Math.round(size * 8.5 / 116);
  const gap    = Math.round(size * 8 / 116);

  const wrapStyle: CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    background: B1_WASH,
    border: '1px solid var(--color-border)',
    borderRadius: '25.5%',
    boxShadow: '0 18px 40px -30px rgba(0,212,170,.85)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  };

  const stackStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${gap}px`,
    transform: 'translateY(-1px)',
  };

  const wordmarkStyle: CSSProperties = {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontWeight: 800,
    letterSpacing: '-0.045em',
    lineHeight: 0.9,
    fontSize: `${wmSize}px`,
    display: 'inline-flex',
    alignItems: 'baseline',
  };

  const taglineStyle: CSSProperties = {
    color: 'rgba(238, 234, 245, 0.68)',
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
    fontSize: `${tlSize}px`,
    fontWeight: 600,
    letterSpacing: '0.24em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };

  return (
    <span style={wrapStyle} className={className} aria-label="cashe — cash, caught">
      <span style={stackStyle}>
        <span style={wordmarkStyle}>
          <span style={tealStyle}>ca</span>
          <span style={dollarStyle}>$</span>
          <span style={tealStyle}>he</span>
        </span>
        <span style={taglineStyle}>CASH, CAUGHT.</span>
      </span>
    </span>
  );
}
