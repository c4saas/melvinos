import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UsageSummaryModelBreakdown, UsageSummaryTotals } from '@shared/usage';

const MINUTES_15_MS = 15 * 60 * 1000;

export interface UsageSnapshotResponse {
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  totals: UsageSummaryTotals;
  models: UsageSummaryModelBreakdown[];
  source: 'snapshot' | 'computed';
}

interface UseUsageSnapshotResult {
  snapshot: UsageSnapshotResponse | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<UsageSnapshotResponse | null>;
}

export function useUsageSnapshot(): UseUsageSnapshotResult {
  const query = useQuery<UsageSnapshotResponse>({
    queryKey: ['/api/usage/user/latest'],
    refetchInterval: MINUTES_15_MS,
  });

  const snapshot = query.data ?? null;

  const refetch = useCallback(async () => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    snapshot,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null,
    refetch,
  };
}
