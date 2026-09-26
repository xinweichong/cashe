import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrendLine } from '../TrendLine';

const DATA = [
  { date: '2026-09-01', amount: 10 },
  { date: '2026-09-02', amount: 20 },
  { date: '2026-09-03', amount: 30 },
];

describe('<TrendLine>', () => {
  it('renders no day readout when onSelectDate is not given (legacy Overview caller unaffected)', () => {
    render(<TrendLine data={DATA} />);
    expect(screen.queryByTestId('trend-day-readout')).toBeNull();
  });

  it('defaults the readout to the last day when no selection is given', () => {
    render(<TrendLine data={DATA} onSelectDate={vi.fn()} />);
    const readout = screen.getByTestId('trend-day-readout');
    expect(readout.textContent).toContain('3 Sep');
  });

  it('stepping to the previous day calls onSelectDate with the prior date', () => {
    const onSelectDate = vi.fn();
    render(<TrendLine data={DATA} selectedDate="2026-09-03" onSelectDate={onSelectDate} />);
    fireEvent.click(screen.getByLabelText('Previous day'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-09-02');
  });

  it('disables "Previous day" at the first point and "Next day" at the last', () => {
    const onSelectDate = vi.fn();
    render(<TrendLine data={DATA} selectedDate="2026-09-01" onSelectDate={onSelectDate} />);
    expect((screen.getByLabelText('Previous day') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Next day') as HTMLButtonElement).disabled).toBe(false);
  });
});
