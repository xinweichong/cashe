import type { ReactNode } from 'react';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { Skeleton } from '@/components/ui/skeleton';

// A query's first load: an error with retry, or a skeleton, until data
// arrives. A background refetch failure never hides data already shown.
export function QueryState<T>({ data, isError, onRetry, skeleton, loadingLabel = 'Loading…', children }: {
  data: T | null | undefined;
  isError: boolean;
  onRetry: () => void;
  skeleton?: ReactNode;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (data == null) {
    return isError
      ? <div role="alert"><LoadFailed onRetry={onRetry} /></div>
      : <div role="status"><span className="sr-only">{loadingLabel}</span>{skeleton ?? <Skeleton className="h-20 w-full" />}</div>;
  }
  return <>{children(data)}</>;
}
