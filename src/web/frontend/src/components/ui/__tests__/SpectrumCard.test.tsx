import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpectrumCard } from '../SpectrumCard';

describe('<SpectrumCard> (P11)', () => {
  it('shows label, meta, value and caption on the spectrum fill', () => {
    const { container } = render(
      <SpectrumCard label="September" meta="Budget S$3,000" value="S$2,184.30" caption="S$815.70 left" progress={0.72} progressLabel="Budget used" />,
    );
    expect((container.firstElementChild as HTMLElement).className).toContain('spectrum-fill');
    for (const text of ['September', 'Budget S$3,000', 'S$2,184.30', 'S$815.70 left']) expect(screen.getByText(text)).toBeTruthy();
  });

  it('exposes progress as a labelled, clamped progress bar', () => {
    render(<SpectrumCard label="September" value="S$3,300" progress={1.1} progressLabel="Budget used" />);
    const bar = screen.getByRole('progressbar', { name: 'Budget used' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('has no bar when there is nothing to measure against', () => {
    render(<SpectrumCard label="September" value="S$2,184.30" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('labels estimates and hides their bar', () => {
    render(<SpectrumCard label="Next 30 days" meta="ignored" value="S$184.20" status="estimated" progress={0.4} />);
    expect(screen.getByText('Estimated')).toBeTruthy();
    expect(screen.queryByText('ignored')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('labels partial data and draws a dashed bar', () => {
    render(<SpectrumCard label="September" value="S$2,184.30" status="partial" progress={0.72} />);
    expect(screen.getByText('Partial')).toBeTruthy();
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.className).toContain('repeating-linear-gradient');
  });
});
