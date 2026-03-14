import type { IStorage } from '../storage';
import { buildUsageSummary } from './analytics';
import type { UsageSummarySnapshot } from '@shared/schema';

export interface UsageAggregationSchedulerOptions {
  intervalMs?: number;
  lookbackMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type UsageAggregationStorage = Pick<
  IStorage,
  'listUsers' | 'getLatestUsageSummarySnapshot' | 'getUserUsageMetrics' | 'saveUsageSummarySnapshot'
>;

function alignToInterval(date: Date, intervalMs: number): Date {
  const safeInterval = Math.max(1, intervalMs);
  const aligned = Math.floor(date.getTime() / safeInterval) * safeInterval;
  return new Date(aligned);
}

function isUserActive(userStatus: unknown): boolean {
  if (typeof userStatus !== 'string') {
    return true;
  }
  return userStatus.toLowerCase() === 'active';
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return { error };
}

export async function runUsageAggregationCycle(
  storage: UsageAggregationStorage,
  options: UsageAggregationSchedulerOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs && options.intervalMs > 0 ? options.intervalMs : DEFAULT_INTERVAL_MS;
  const lookbackMs = options.lookbackMs && options.lookbackMs > 0 ? options.lookbackMs : DEFAULT_LOOKBACK_MS;
  const nowProvider = options.now ?? (() => new Date());
  const logger = options.logger;

  const now = nowProvider();
  const rangeEnd = alignToInterval(now, intervalMs);
  const rangeStart = new Date(rangeEnd.getTime() - lookbackMs);

  let users;
  try {
    users = await storage.listUsers();
  } catch (error) {
    if (logger) {
      logger('usage-scheduler:list-users-error', normalizeError(error));
    } else {
      console.error('[usage-scheduler] Failed to list users', normalizeError(error));
    }
    return;
  }

  for (const user of users) {
    if (!user?.id) {
      continue;
    }

    if (!isUserActive((user as { status?: string | null }).status ?? 'active')) {
      continue;
    }

    try {
      const latest = await storage.getLatestUsageSummarySnapshot(user.id);
      if (latest && isSnapshotForRange(latest, rangeStart, rangeEnd)) {
        continue;
      }

      const metrics = await storage.getUserUsageMetrics(user.id, rangeStart, rangeEnd);
      const summary = buildUsageSummary(metrics, { from: rangeStart, to: rangeEnd });

      await storage.saveUsageSummarySnapshot({
        userId: user.id,
        rangeStart,
        rangeEnd,
        totals: summary.totals,
        modelBreakdown: summary.models,
        generatedAt: now,
      });
    } catch (error) {
      const meta = {
        userId: user.id,
        ...normalizeError(error),
      };
      if (logger) {
        logger('usage-scheduler:user-run-error', meta);
      } else {
        console.error('[usage-scheduler] Failed to aggregate usage for user', meta);
      }
    }
  }
}

function isSnapshotForRange(
  snapshot: Pick<UsageSummarySnapshot, 'rangeStart' | 'rangeEnd'>,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const snapshotStart = snapshot.rangeStart instanceof Date ? snapshot.rangeStart : new Date(snapshot.rangeStart);
  const snapshotEnd = snapshot.rangeEnd instanceof Date ? snapshot.rangeEnd : new Date(snapshot.rangeEnd);
  return snapshotStart.getTime() === rangeStart.getTime() && snapshotEnd.getTime() === rangeEnd.getTime();
}

export function startUsageAggregationScheduler(
  storage: UsageAggregationStorage,
  options: UsageAggregationSchedulerOptions = {},
) {
  const intervalMs = options.intervalMs && options.intervalMs > 0 ? options.intervalMs : DEFAULT_INTERVAL_MS;
  const lookbackMs = options.lookbackMs && options.lookbackMs > 0 ? options.lookbackMs : DEFAULT_LOOKBACK_MS;
  const runOptions: UsageAggregationSchedulerOptions = {
    ...options,
    intervalMs,
    lookbackMs,
  };

  let timer: NodeJS.Timeout | undefined;
  let currentRun: Promise<void> | null = null;
  let stopped = false;

  const scheduleRun = () => {
    if (currentRun) {
      return;
    }
    currentRun = runUsageAggregationCycle(storage, runOptions)
      .catch((error) => {
        const meta = normalizeError(error);
        if (runOptions.logger) {
          runOptions.logger('usage-scheduler:run-error', meta);
        } else {
          console.error('[usage-scheduler] Unexpected scheduler error', meta);
        }
      })
      .finally(() => {
        currentRun = null;
      });
  };

  if (options.runOnStart !== false) {
    scheduleRun();
  }

  timer = setInterval(scheduleRun, intervalMs);

  return {
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (currentRun) {
        try {
          await currentRun;
        } catch (error) {
          const meta = normalizeError(error);
          if (runOptions.logger) {
            runOptions.logger('usage-scheduler:stop-error', meta);
          } else {
            console.error('[usage-scheduler] Error while awaiting final run', meta);
          }
        }
      }
    },
  };
}

export const __testing = {
  alignToInterval,
  isSnapshotForRange,
};
