import { Badge, type BadgeTone } from '@/components/ui/badge';
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
        <h2 className="font-display text-lg font-semibold mb-4">Card (ordinary, rounded-md/shadow-elev-xs)</h2>
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

      <section data-testid="section-wash">
        <h2 className="font-display text-lg font-semibold mb-4">Shell wash</h2>
        <div className="experience-next shell-wash rounded-md border border-border h-40 w-full max-w-xl" data-testid="shell-wash-sample" />
      </section>
    </div>
  );
}
