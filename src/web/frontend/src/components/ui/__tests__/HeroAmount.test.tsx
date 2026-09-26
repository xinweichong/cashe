import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroAmount } from '../HeroAmount';

describe('<HeroAmount>', () => {
  it('renders the formatted money contract, cents included', () => {
    render(<HeroAmount value={{ minor_units: 128450, currency: 'SGD' }} />);
    expect(screen.getByText('$1,284.50')).toBeTruthy();
  });
});
