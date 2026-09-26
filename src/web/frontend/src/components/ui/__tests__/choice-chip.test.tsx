import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoiceChip } from '../choice-chip';

test('ChoiceChip exposes pressed state and reports the next value', () => {
  const onChange = vi.fn();
  render(<ChoiceChip selected={false} onSelectedChange={onChange}>Needs review</ChoiceChip>);
  const chip = screen.getByRole('button', { name: 'Needs review', pressed: false });
  fireEvent.click(chip);
  expect(onChange).toHaveBeenCalledWith(true);
});

test('a disabled ChoiceChip does not fire', () => {
  const onClick = vi.fn();
  render(<ChoiceChip selected disabled onClick={onClick} categoryColor="#00D4AA">Food</ChoiceChip>);
  fireEvent.click(screen.getByRole('button', { name: 'Food', pressed: true }));
  expect(onClick).not.toHaveBeenCalled();
});
