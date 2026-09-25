import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import { PageCard } from '@/components/ui/cards';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

function formatRelativeTime(isoString: string): string {
  const hours = Math.floor((Date.now() - new Date(isoString).getTime()) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * The optional AI daily read. Renders nothing when the model layer is off
 * or has not written a read yet — the dashboard stands on its facts alone.
 */
export function DailyReadCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-insight', 'daily'],
    queryFn: () => api.getAnalyticsInsight(),
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-28 rounded-md" />;
  if (!data?.content) return null;

  return (
    <PageCard
      title="Today's read"
      action={
        <Badge tone="saved" className="gap-1">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />AI
        </Badge>
      }
    >
      <p className="text-sm leading-relaxed text-foreground max-w-[70ch]">{data.content.narrative}</p>
      {data.content.nudges?.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-3" aria-label="Suggestions">
          {data.content.nudges.map((nudge, i) => (
            <li key={i}><Badge variant="outline" className="font-medium">{nudge}</Badge></li>
          ))}
        </ul>
      )}
      {data.generated_at && (
        <p className="text-xs text-muted mt-3">
          Written {formatRelativeTime(data.generated_at)}{data.is_stale ? ' · may be out of date' : ''}. Figures on this page are the source of truth.
        </p>
      )}
    </PageCard>
  );
}
