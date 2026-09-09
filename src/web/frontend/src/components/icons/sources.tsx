import { SOURCE_LABELS } from '@/lib/sourceLabels';

export function SourceGlyph({ source }: { source: string }) {
  const label = SOURCE_LABELS[source] ?? '·';
  return (
    <span
      className="inline-flex items-center justify-center rounded font-mono font-bold text-[9px] leading-none px-[3px] py-[2px] bg-foreground/10 text-muted"
      aria-label={source}
    >
      {label}
    </span>
  );
}
