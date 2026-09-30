import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger } from '../tabs';
import { SegmentedChoice } from '../segmented-choice';

function Controlled() {
  const [value, setValue] = useState('month');
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList>
        <TabsTrigger value="month">Month</TabsTrigger>
        <TabsTrigger value="year">Year</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

const thumbIn = (el: HTMLElement) => el.querySelector('span[aria-hidden]');

describe('Tabs segmented look (P10)', () => {
  it('draws one thumb, inside the active trigger, and moves it on selection', () => {
    render(<Controlled />);
    const month = screen.getByRole('tab', { name: 'Month' });
    const year = screen.getByRole('tab', { name: 'Year' });
    expect(thumbIn(month)).not.toBeNull();
    expect(thumbIn(year)).toBeNull();
    fireEvent.mouseDown(year);
    expect(thumbIn(year)).not.toBeNull();
    expect(thumbIn(month)).toBeNull();
  });

  it('tracks the value for uncontrolled tabs too', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList>
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }));
    expect(thumbIn(screen.getByRole('tab', { name: 'B' }))).not.toBeNull();
  });

  it('keeps the thumb label-free so the tab name stays the text alone', () => {
    render(<Controlled />);
    expect(screen.getByRole('tab', { name: 'Month' }).textContent).toBe('Month');
  });
});

describe('SegmentedChoice shares the look', () => {
  it('puts the thumb in the checked segment', () => {
    render(
      <SegmentedChoice name="t" aria-label="Type" value="income" onValueChange={() => {}}
        options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />,
    );
    const income = screen.getByRole('radio', { name: 'Income' }).closest('label') as HTMLElement;
    const expense = screen.getByRole('radio', { name: 'Expense' }).closest('label') as HTMLElement;
    expect(thumbIn(income)).not.toBeNull();
    expect(thumbIn(expense)).toBeNull();
  });
});
