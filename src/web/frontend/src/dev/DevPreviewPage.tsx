import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { SegmentedChoice } from '@/components/ui/segmented-choice';
import { Switch } from '@/components/ui/switch';
import { StatusDot } from '@/components/ui/StatusDot';
import { SelectableRow } from '@/components/ui/selectable-row';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CategoryAvatar } from '@/components/ui/CategoryAvatar';
import { CategoryColorPicker, CategoryIconPicker } from '@/components/categories/CategoryPickers';
import { PALETTE } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Dev-only visual harness for shared primitives — mounted at /dev/preview only
// when import.meta.env.DEV (see App.tsx), so it never ships in a production
// build. Exists so Playwright can screenshot foundation changes (typography,
// Card geometry, Badge tones, shell wash) without needing authenticated app
// state or real backend data.

const TYPE_SCALE: { cls: string; label: string; px: number }[] = [
  { cls: 'text-2xs', label: 'text-2xs', px: 11 },
  { cls: 'text-xs', label: 'text-xs', px: 12 },
  { cls: 'text-sm', label: 'text-sm', px: 14 },
  { cls: 'text-base', label: 'text-base', px: 16 },
  { cls: 'text-lg', label: 'text-lg', px: 20 },
  { cls: 'text-xl', label: 'text-xl', px: 25 },
  { cls: 'text-2xl', label: 'text-2xl', px: 31 },
  { cls: 'text-3xl', label: 'text-3xl', px: 39 },
  { cls: 'text-4xl', label: 'text-4xl', px: 49 },
  { cls: 'text-5xl', label: 'text-5xl', px: 61 },
  { cls: 'text-6xl', label: 'text-6xl', px: 77 },
];

const BADGE_TONES: BadgeTone[] = ['saved', 'calm', 'active', 'notable', 'warm'];
const BADGE_VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const;

// Shared-control contact sheet (consolidation gate): every shared owner in
// its main states, captured in both themes by e2e/visual/foundations.spec.ts.
function ControlsSheet() {
  const [chip, setChip] = useState(true);
  const [segment, setSegment] = useState<'expense' | 'income'>('expense');
  const [on, setOn] = useState(true);
  const [icon, setIcon] = useState('🍜');
  const [color, setColor] = useState(PALETTE[1]);
  return (
    <section data-testid="section-controls" className="space-y-6">
      <h2 className="font-display text-lg font-semibold">Shared controls</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button><Button variant="destructive">Destructive</Button><Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ChoiceChip selected={chip} onSelectedChange={setChip}>Selected chip</ChoiceChip>
        <ChoiceChip selected={false}>Resting chip</ChoiceChip>
        <ChoiceChip selected tone="warning">Needs review</ChoiceChip>
        {PALETTE.slice(0, 4).map((c, i) => <ChoiceChip key={c} selected={i === 0} categoryColor={c}>Category {i + 1}</ChoiceChip>)}
      </div>
      <SegmentedChoice<'expense' | 'income'> name="preview-type" aria-label="Transaction type" value={segment} onValueChange={setSegment} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] as const} className="max-w-sm" />
      <div className="flex items-center gap-4">
        <Switch checked={on} onCheckedChange={setOn} aria-label="Preview switch" />
        <Switch checked={false} onCheckedChange={() => {}} aria-label="Preview switch off" />
        <Switch checked pending onCheckedChange={() => {}} aria-label="Preview switch pending" />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {BADGE_TONES.map((tone) => <StatusDot key={tone} tone={tone} label={tone} />)}
        <CategoryAvatar category="Food" /><CategoryAvatar category="Food" size="detail" glyph="🍜" /><CategoryAvatar category="Salary" isIncome />
      </div>
      <div className="max-w-md space-y-1">
        <SelectableRow selected><StatusDot color={PALETTE[0]} /><span className="flex-1">Selected row</span><span className="font-mono">$42.00</span></SelectableRow>
        <SelectableRow><StatusDot color={PALETTE[4]} /><span className="flex-1">Resting row</span><span className="font-mono">$12.00</span></SelectableRow>
      </div>
      <div className="max-w-md space-y-3">
        <ProgressBar percent={45} label="Calm budget" tone="calm" />
        <ProgressBar percent={85} label="Notable budget" tone="notable" />
        <ProgressBar percent={130} label="Over budget" tone="warm" />
      </div>
      <div className="grid max-w-md gap-2">
        <Input placeholder="Input (shared field contract)" />
        <input className="input-field" placeholder="Native .input-field" />
        <input className="input-field" aria-invalid="true" defaultValue="Invalid value" />
        <select className="select-field" defaultValue="a"><option value="a">Native .select-field</option></select>
        <Input disabled placeholder="Disabled" />
      </div>
      <div className="max-w-md space-y-3">
        <CategoryIconPicker value={icon} onChange={setIcon} />
        <CategoryColorPicker value={color} onChange={setColor} taken={(c) => c === PALETTE[0]} />
      </div>
    </section>
  );
}

export function DevPreviewPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-10 font-sans">
      <section data-testid="section-type-scale">
        <h2 className="font-display text-lg font-semibold mb-4">Type scale</h2>
        <div className="space-y-2">
          {TYPE_SCALE.map(({ cls, label, px }) => (
            <div key={cls} className="flex items-baseline gap-4" data-testid={`type-${label}`}>
              <span className="font-mono text-2xs text-muted w-32 shrink-0">{label} · {px}px doc</span>
              <span className={`font-display ${cls}`}>Spent $1,284.50</span>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="section-card">
        <h2 className="font-display text-lg font-semibold mb-4">Card (ordinary, rounded-md, border-only)</h2>
        <Card className="max-w-sm" data-testid="ordinary-card">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">Category distribution card body text.</p>
          </CardContent>
        </Card>
      </section>

      <section data-testid="section-badge">
        <h2 className="font-display text-lg font-semibold mb-4">Badge — variants</h2>
        <div className="flex flex-wrap gap-2 mb-6" data-testid="badge-variants">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>{variant}</Badge>
          ))}
        </div>
        <h2 className="font-display text-lg font-semibold mb-4">Badge — spectrum tones</h2>
        <div className="flex flex-wrap gap-2" data-testid="badge-tones">
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>{tone}</Badge>
          ))}
        </div>
      </section>

      <ControlsSheet />

      <section data-testid="section-wash">
        <h2 className="font-display text-lg font-semibold mb-4">Shell wash</h2>
        <div className="experience-next shell-wash rounded-md border border-border h-40 w-full max-w-xl" data-testid="shell-wash-sample" />
      </section>
    </div>
  );
}
