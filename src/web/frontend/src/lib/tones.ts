import type { BadgeTone } from '@/components/ui/badge';

// Solid fill for each Badge tone, shared by StatusDot and ProgressBar.
export const TONE_FILL: Record<BadgeTone, string> = {
  saved: 'bg-teal',
  calm: 'bg-mint',
  active: 'bg-honey',
  notable: 'bg-tangerine',
  warm: 'bg-coral',
};
