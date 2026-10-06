import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatMoney, type Money } from '@/api/briefing';
import { AnimatedMoney } from '../AnimatedMoney';

const sgd = (minor_units: number): Money => ({ minor_units, currency: 'SGD' });

describe('AnimatedMoney', () => {
  it('exposes only the formatted amount to assistive technology', () => {
    const { container } = render(<AnimatedMoney value={sgd(123456)} />);
    expect(screen.getByText(formatMoney(sgd(123456))).getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('announces the new amount when the value changes', () => {
    const { rerender } = render(<AnimatedMoney value={sgd(99900)} />);
    rerender(<AnimatedMoney value={sgd(100000)} />);
    expect(screen.getByText(formatMoney(sgd(100000))).textContent).toBe(formatMoney(sgd(100000)));
  });
});
