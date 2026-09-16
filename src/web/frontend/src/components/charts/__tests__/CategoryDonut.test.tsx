import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryDonut } from '../CategoryDonut';

const DATA = [
  { category: 'Food', total: 500 },
  { category: 'Transport', total: 300 },
  { category: 'Shopping', total: 200 },
  { category: 'Bills', total: 150 },
  { category: 'Entertainment', total: 100 },
  { category: 'Travel', total: 50 },
  { category: 'Gifts', total: 20 },
];

describe('<CategoryDonut>', () => {
  it('renders no legend by default (legacy Overview caller unaffected)', () => {
    render(<CategoryDonut data={DATA} />);
    expect(screen.queryByTestId('category-donut-legend')).toBeNull();
  });

  it('legend groups everything past the top 5 into "Remaining categories"', () => {
    render(<CategoryDonut data={DATA} showLegend />);
    const legend = screen.getByTestId('category-donut-legend');
    expect(legend.textContent).toContain('Food');
    expect(legend.textContent).toContain('Remaining categories');
    expect(legend.textContent).not.toContain('Travel');
  });

  it('selecting a category calls onSelect and toggles off on repeat click', () => {
    const onSelect = vi.fn();
    render(<CategoryDonut data={DATA} showLegend onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Food/ }));
    expect(onSelect).toHaveBeenCalledWith('Food');
  });

  it('deselects when the already-selected category is clicked again', () => {
    const onSelect = vi.fn();
    render(<CategoryDonut data={DATA} showLegend selected="Food" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Food/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('expanding "Remaining categories" reveals its real members, not a fictitious category', () => {
    render(<CategoryDonut data={DATA} showLegend />);
    expect(screen.queryByText('Travel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Remaining categories/ }));
    expect(screen.getByText('Travel')).toBeTruthy();
    expect(screen.getByText('Gifts')).toBeTruthy();
  });

  it('shows the selected category and its share in the centre readout', () => {
    render(<CategoryDonut data={DATA} selected="Food" />);
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText(/% of spending/)).toBeTruthy();
  });

  it('shows the neutral "Spending mix" centre when nothing is selected', () => {
    render(<CategoryDonut data={DATA} />);
    expect(screen.getByText('Spending mix')).toBeTruthy();
  });

  it('renders a "View transactions" action once a category is selected', () => {
    const onView = vi.fn();
    render(<CategoryDonut data={DATA} selected="Food" onViewTransactions={onView} />);
    fireEvent.click(screen.getByRole('button', { name: 'View transactions' }));
    expect(onView).toHaveBeenCalledWith('Food');
  });
});
