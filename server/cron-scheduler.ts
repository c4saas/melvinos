/**
 * Persistent cron job scheduler backed by the database.
 * Parses standard 5-field cron expressions, fires prompts as agent tasks.
 */

import type { IStorage } from './storage/index';
import type { CronJob } from '@shared/schema';

let _storage: IStorage | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** Extract date parts (minute, hour, dom, month, dow) in a given IANA timezone. */
function dateParts(d: Date, timezone: string): { min: number; h: number; dom: number; m: number; dw: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { min: get('minute'), h: get('hour') % 24, dom: get('day'), m: get('month'), dw: dowMap[weekday] ?? 0 };
  } catch {
    // Fallback to UTC if timezone is invalid
    return { min: d.getUTCMinutes(), h: d.getUTCHours(), dom: d.getUTCDate(), m: d.getUTCMonth() + 1, dw: d.getUTCDay() };
  }
}

/** Parse a 5-field cron expression and return the next fire Date after `from`. */
function nextCronDate(expr: string, from: Date = new Date(), timezone = 'UTC'): Date | null {
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

    // Walk forward minute by minute (max 8 days), evaluating in job's timezone
    const candidate = new Date(from.getTime() + 60_000); // at least 1 minute ahead
    candidate.setSeconds(0, 0);

    for (let i = 0; i < 60 * 24 * 8; i++) {
      const p = dateParts(candidate, timezone);

      if (
        months.includes(p.m) &&
        doms.includes(p.dom) &&
        dows.includes(p.dw) &&
        hours.includes(p.h) &&
        minutes.includes(p.min)
      ) {
        return new Date(candidate);
      }
      candidate.setTime(candidate.getTime() + 60_000);
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

export async function fireJob(job: CronJob) {
  if (!_storage) return;
  try {
    const next = nextCronDate(job.cronExpression, new Date(), job.timezone ?? 'UTC');
    if (job.recurring && next) {
      await _storage.updateCronJob(job.id, { lastRunAt: new Date(), nextRunAt: next });
    } else {
      // One-shot — disable after firing
      await _storage.updateCronJob(job.id, { lastRunAt: new Date(), enabled: false, nextRunAt: null });
    }

    // If this is the routine populator cron, use the populateRoutine function
    if (job.name === 'Daily Success Routine - Populate') {
      try {
        const { populateRoutine } = await import('./routine-populator');
        await populateRoutine(_storage, job.userId);
        console.log(`[cron] routine populator fired for ${job.userId}`);
        return;
      } catch (err) {
        console.error('[cron] routine populator failed, falling back to generic task:', err);
      }
    }

    // Enqueue via the agent_autonomous handler (has model resolution + full tool context)
    await _storage.createAgentTask({
      type: 'agent_autonomous',
      title: `[Cron] ${job.name}`,
      status: 'pending',
      input: {
        prompt: job.prompt,
        userId: job.userId,
        chatId: job.conversationId ?? undefined,
        cronJobId: job.id,
      },
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
  const next = nextCronDate(job.cronExpression, new Date(), job.timezone ?? 'UTC');
  await storage.updateCronJob(jobId, { nextRunAt: next ?? undefined });
}

async function initNextRuns(storage: IStorage): Promise<void> {
  try {
    const jobs = await storage.getEnabledCronJobs();
    for (const job of jobs) {
      if (!job.nextRunAt) {
        const next = nextCronDate(job.cronExpression, new Date(), job.timezone ?? 'UTC');
        if (next) await storage.updateCronJob(job.id, { nextRunAt: next });
      }
    }
  } catch (err) {
    console.error('[cron] initNextRuns error:', err);
  }
}
