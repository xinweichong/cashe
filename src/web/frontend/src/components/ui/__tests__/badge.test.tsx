import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '../badge';

describe('<Badge>', () => {
  it('defaults to the default variant when no variant/tone is given', () => {
    const { getByText } = render(<Badge>Default</Badge>);
    expect(getByText('Default').className).toContain('bg-primary');
  });

  it('applies the requested variant when no tone is given', () => {
    const { getByText } = render(<Badge variant="secondary">Secondary</Badge>);
    expect(getByText('Secondary').className).toContain('bg-secondary');
  });

  it.each(['saved', 'calm', 'active', 'notable', 'warm'] as const)(
    'applies the %s tone classes',
    (tone) => {
      const { getByText } = render(<Badge tone={tone}>{tone}</Badge>);
      const className = getByText(tone).className;
      expect(className).toContain(`border-${tone === 'saved' ? 'teal' : tone === 'calm' ? 'mint' : tone === 'active' ? 'honey' : tone === 'notable' ? 'tangerine' : 'coral'}/25`);
    }
  );

  it('lets tone take precedence over variant and suppresses the default variant fill', () => {
    const { getByText } = render(
      <Badge variant="destructive" tone="saved">Both</Badge>
    );
    const className = getByText('Both').className;
    expect(className).toContain('text-teal');
    expect(className).not.toContain('bg-destructive');
    expect(className).not.toContain('bg-primary');
  });

  it('forwards className overrides alongside tone classes', () => {
    const { getByText } = render(
      <Badge tone="warm" className="ml-2">Overdue</Badge>
    );
    expect(getByText('Overdue').className).toContain('ml-2');
  });
});
