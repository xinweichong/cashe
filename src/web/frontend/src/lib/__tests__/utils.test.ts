import { describe, it, expect } from 'vitest';
import { formatCurrency, minorToMajor } from '@/lib/utils';

describe('minorToMajor', () => {
  it('uses each currency’s decimal places, matching src/money.py', () => {
    expect(minorToMajor(1250, 'SGD')).toBe(12.5);
    expect(minorToMajor(45, 'JPY')).toBe(45);
    expect(minorToMajor(1000, 'krw')).toBe(1000);
    expect(minorToMajor(1234, 'BHD')).toBe(1.234);
  });
});

describe('formatCurrency', () => {
  it('shows no decimals for zero-decimal currencies and two for SGD', () => {
    expect(formatCurrency(45, 'JPY')).toMatch(/¥45$/);
    expect(formatCurrency(12.5)).toBe('$12.50');
  });
});
