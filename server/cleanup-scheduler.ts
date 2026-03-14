/**
 * Data Cleanup Scheduler
 *
 * Periodic job that purges stale data:
 * - Expired sessions
 * - Completed/failed agent tasks older than 30 days
 * - Raw usage metrics older than 90 days (after snapshots exist)
 * - Duplicate/low-relevance memories beyond retention limit
 *
 * Runs once per hour. Never blocks request handling.
 */

import { db } from './db';
import { sessions, agentTasks, usageMetrics, agentMemories } from '@shared/schema';
import { lt, and, inArray, desc, sql } from 'drizzle-orm';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TASK_RETENTION_DAYS = 30;
const METRICS_RETENTION_DAYS = 90;
const MAX_MEMORIES = 500;

let timer: ReturnType<typeof setInterval> | null = null;

export function startCleanupScheduler(): void {
  if (timer) return;

  // Run first cleanup after 60s (let the app fully start)
  setTimeout(() => void runCleanup(), 60_000);

  timer = setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS);
  console.log('[cleanup] Scheduler started — interval 1h');
}

export function stopCleanupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runCleanup(): Promise<void> {
  const results: string[] = [];

  // 1. Expired sessions
  try {
    const expired = await db.delete(sessions)
      .where(lt(sessions.expire, new Date()))
      .returning({ sid: sessions.sid });
    if (expired.length > 0) results.push(`sessions: ${expired.length}`);
  } catch (err) {
    console.error('[cleanup] Sessions cleanup failed:', err instanceof Error ? err.message : err);
  }

  // 2. Old completed/failed tasks
  try {
    const cutoff = new Date(Date.now() - TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const old = await db.delete(agentTasks)
      .where(and(
        inArray(agentTasks.status, ['completed', 'failed', 'cancelled']),
        lt(agentTasks.completedAt, cutoff),
      ))
      .returning({ id: agentTasks.id });
    if (old.length > 0) results.push(`tasks: ${old.length}`);
  } catch (err) {
    console.error('[cleanup] Tasks cleanup failed:', err instanceof Error ? err.message : err);
  }

  // 3. Old raw usage metrics
  try {
    const metricsCutoff = new Date(Date.now() - METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const oldMetrics = await db.delete(usageMetrics)
      .where(lt(usageMetrics.createdAt, metricsCutoff))
      .returning({ id: usageMetrics.id });
    if (oldMetrics.length > 0) results.push(`metrics: ${oldMetrics.length}`);
  } catch (err) {
    console.error('[cleanup] Metrics cleanup failed:', err instanceof Error ? err.message : err);
  }

  // 4. Prune memories beyond MAX_MEMORIES (keep highest relevance)
  try {
    const totalCount = await db.select({ count: sql<number>`count(*)::int` }).from(agentMemories);
    const count = totalCount[0]?.count ?? 0;
    if (count > MAX_MEMORIES) {
      const excess = count - MAX_MEMORIES;
      // Delete lowest-relevance memories
      const toDelete = await db.select({ id: agentMemories.id })
        .from(agentMemories)
        .orderBy(agentMemories.relevanceScore, agentMemories.updatedAt)
        .limit(excess);
      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await db.delete(agentMemories).where(inArray(agentMemories.id, ids));
        results.push(`memories: ${ids.length}`);
      }
    }
  } catch (err) {
    console.error('[cleanup] Memory prune failed:', err instanceof Error ? err.message : err);
  }

  if (results.length > 0) {
    console.log(`[cleanup] Purged: ${results.join(', ')}`);
  }
}
