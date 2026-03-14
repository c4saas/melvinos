/**
 * Persistent cron job scheduler backed by the database.
 * Parses standard 5-field cron expressions, fires prompts as agent tasks.
 */

import type { IStorage } from './storage/index';
import type { CronJob } from '@shared/schema';

let _storage: IStorage | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** Parse a 5-field cron expression and return the next fire Date after `from`. */
function nextCronDate(expr: string, from: Date = new Date()): Date | null {
  try {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

    const parseField = (s: string, min: number, max: number): number[] => {
      if (s === '*') return range(min, max);
      const vals: number[] = [];
      for (const part of s.split(',')) {
        if (part.includes('/')) {
          const [base, step] = part.split('/');
          const start = base === '*' ? min : parseInt(base, 10);
          const stepN = parseInt(step, 10);
          for (let i = start; i <= max; i += stepN) vals.push(i);
        } else if (part.includes('-')) {
          const [lo, hi] = part.split('-').map(Number);
          for (let i = lo; i <= hi; i++) vals.push(i);
        } else {
          vals.push(parseInt(part, 10));
        }
      }
      return vals.filter(v => v >= min && v <= max);
    };

    const minutes = parseField(minExpr, 0, 59);
    const hours = parseField(hourExpr, 0, 23);
    const doms = parseField(domExpr, 1, 31);
    const months = parseField(monExpr, 1, 12);
    const dows = parseField(dowExpr, 0, 6);

    // Walk forward minute by minute (max 8 days)
    const candidate = new Date(from.getTime() + 60_000); // at least 1 minute ahead
    candidate.setSeconds(0, 0);

    for (let i = 0; i < 60 * 24 * 8; i++) {
      const m = candidate.getMonth() + 1; // 1-12
      const d = candidate.getDate();
      const dw = candidate.getDay(); // 0-6 Sun-Sat
      const h = candidate.getHours();
      const min = candidate.getMinutes();

      if (
        months.includes(m) &&
        doms.includes(d) &&
        dows.includes(dw) &&
        hours.includes(h) &&
        minutes.includes(min)
      ) {
        return new Date(candidate);
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
    return null;
  } catch {
    return null;
  }
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => i + min);
}

async function tick() {
  if (!_storage || _running) return;
  _running = true;
  try {
    const now = new Date();
    const jobs = await _storage.getEnabledCronJobs();
    for (const job of jobs) {
      const due = job.nextRunAt && job.nextRunAt <= now;
      if (!due) continue;
      await fireJob(job);
    }
  } catch (err) {
    console.error('[cron] tick error:', err);
  } finally {
    _running = false;
  }
}

async function fireJob(job: CronJob) {
  if (!_storage) return;
  try {
    const next = nextCronDate(job.cronExpression);
    if (job.recurring && next) {
      await _storage.updateCronJob(job.id, { lastRunAt: new Date(), nextRunAt: next });
    } else {
      // One-shot — disable after firing
      await _storage.updateCronJob(job.id, { lastRunAt: new Date(), enabled: false, nextRunAt: null });
    }

    // Enqueue as an agent task so it runs through the normal pipeline
    await _storage.createAgentTask({
      type: 'cron',
      title: `[Cron] ${job.name}`,
      status: 'pending',
      input: { prompt: job.prompt, cronJobId: job.id },
      conversationId: job.conversationId ?? null,
    });

    console.log(`[cron] fired job "${job.name}" (${job.id})`);
  } catch (err) {
    console.error(`[cron] failed to fire job ${job.id}:`, err);
  }
}

/** Call once on server startup. */
export function startCronScheduler(storage: IStorage): void {
  _storage = storage;
  // Recompute nextRunAt for any enabled jobs that are missing it
  void initNextRuns(storage);
  // Check every minute
  _timer = setInterval(tick, 60_000);
  console.log('[cron] Scheduler started — polling every 60s');
}

export function stopCronScheduler(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

/** After creating a job, call this to set its initial nextRunAt. */
export async function scheduleNextRun(storage: IStorage, jobId: string): Promise<void> {
  const job = await storage.getCronJob(jobId);
  if (!job) return;
  const next = nextCronDate(job.cronExpression);
  await storage.updateCronJob(jobId, { nextRunAt: next ?? undefined });
}

async function initNextRuns(storage: IStorage): Promise<void> {
  try {
    const jobs = await storage.getEnabledCronJobs();
    for (const job of jobs) {
      if (!job.nextRunAt) {
        const next = nextCronDate(job.cronExpression);
        if (next) await storage.updateCronJob(job.id, { nextRunAt: next });
      }
    }
  } catch (err) {
    console.error('[cron] initNextRuns error:', err);
  }
}
