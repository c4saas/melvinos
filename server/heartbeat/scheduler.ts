/**
 * Heartbeat Scheduler
 *
 * Self-rescheduling setTimeout chain (not a fixed setInterval).
 * After each tick, the agent's NEXT TICK directive is parsed from the response
 * and used to determine when the next tick fires. Falls back to the configured
 * interval if no directive is found.
 *
 * Key behaviors:
 * - NEXT TICK: < 2 minutes → treated as work continuation, bypasses quiet hours
 * - NEXT TICK: >= 2 minutes → treated as scheduled scan, respects quiet hours
 * - No directive → uses configured intervalMinutes as fallback
 * - Overlapping runs are prevented (if a run is still active, the next tick
 *   is rescheduled after it completes)
 */
import type { IStorage } from '../storage';
import { runHeartbeatCycle } from './prompt-builder';
import type { HeartbeatSettings } from '@shared/schema';

// ── Module state ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let currentRun: Promise<void> | null = null;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let currentIntervalMs: number | null = null;  // configured default
let schedulerStorage: IStorage | null = null;

/** Set by current tick, consumed by next tick — lets continuation runs bypass quiet hours */
let bypassNextQuietHours = false;

// ── Public API ───────────────────────────────────────────────────────────────

export function getHeartbeatStatus() {
  return {
    lastRunAt,
    nextRunAt,
    intervalMs: currentIntervalMs,
    running: timer !== null || currentRun !== null,
  };
}

export async function stopHeartbeatScheduler(): Promise<void> {
  clearTimer();
  if (currentRun) {
    try { await currentRun; } catch { /* ignore */ }
  }
}

export function startHeartbeatScheduler(storage: IStorage) {
  schedulerStorage = storage;

  void (async () => {
    try {
      const settings = await storage.getPlatformSettings();
      const hb = settings.data?.heartbeat;
      if (!hb?.enabled) {
        console.log('[heartbeat] Scheduler not started — heartbeat disabled');
        return;
      }

      const intervalMs = hb.intervalMinutes * 60 * 1000;
      currentIntervalMs = intervalMs;
      scheduleNextTick(storage, intervalMs);
      console.log(`[heartbeat] Scheduler started — interval ${hb.intervalMinutes}m`);
    } catch (err) {
      console.error('[heartbeat] STARTUP FAILED — heartbeat will not run:', err instanceof Error ? err.message : err);
    }
  })();

  return {
    stop: async () => {
      clearTimer();
      if (currentRun) {
        try { await currentRun; } catch { /* ignore */ }
      }
    },
  };
}

/**
 * Called when platform settings are saved to reconcile the scheduler.
 * Resets to the new configured interval (clears any agent-directed interval).
 */
export async function reconcileHeartbeatScheduler(storage: IStorage) {
  schedulerStorage = storage;
  clearTimer();

  try {
    const settings = await storage.getPlatformSettings();
    const hb = settings.data?.heartbeat;

    if (!hb?.enabled) {
      console.log('[heartbeat] Scheduler stopped — heartbeat disabled');
      return;
    }

    const intervalMs = hb.intervalMinutes * 60 * 1000;
    currentIntervalMs = intervalMs;
    bypassNextQuietHours = false;
    scheduleNextTick(storage, intervalMs);
    console.log(`[heartbeat] Scheduler reconciled — interval ${hb.intervalMinutes}m`);
  } catch (err) {
    console.warn('[heartbeat] Reconcile failed:', err);
  }
}

/**
 * Run a single heartbeat tick. Exposed for manual trigger endpoint.
 * Does not participate in the self-scheduling chain.
 */
export async function runHeartbeatTick(storage: IStorage): Promise<string> {
  const settings = await storage.getPlatformSettings();
  const hb = settings.data?.heartbeat;

  if (!hb) {
    return 'Heartbeat not configured.';
  }

  const enabledItems = hb.scanItems.filter((item) => item.enabled);
  if (enabledItems.length === 0) {
    return 'No scan items enabled.';
  }

  const result = await runHeartbeatCycle(storage, hb);
  lastRunAt = new Date().toISOString();
  return result;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  nextRunAt = null;
}

function scheduleNextTick(storage: IStorage, delayMs: number) {
  clearTimer();
  nextRunAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(() => {
    void runScheduledTick(storage);
  }, delayMs);
}

async function runScheduledTick(storage: IStorage) {
  // If a run is still in progress, reschedule and wait for it to finish
  if (currentRun) {
    const fallback = currentIntervalMs ?? 30 * 60 * 1000;
    scheduleNextTick(storage, fallback);
    return;
  }

  // Capture and reset the bypass flag set by the previous tick
  const bypassQuietHours = bypassNextQuietHours;
  bypassNextQuietHours = false;

  // Default to configured interval; will be overridden if agent provides NEXT TICK directive
  let nextIntervalMs = currentIntervalMs ?? 30 * 60 * 1000;

  currentRun = (async () => {
    try {
      // Re-read settings in case they changed between ticks
      const settings = await storage.getPlatformSettings();
      const hb = settings.data?.heartbeat;

      if (!hb?.enabled) return;

      // Update the stored default interval in case admin changed it
      currentIntervalMs = hb.intervalMinutes * 60 * 1000;
      nextIntervalMs = currentIntervalMs;

      // Respect quiet hours — but skip if this is a work-continuation tick
      if (!bypassQuietHours && isInQuietHours(hb.quietHours)) {
        console.log('[heartbeat] Skipped — quiet hours');
        return;
      }

      const enabledItems = hb.scanItems.filter((item) => item.enabled);
      if (enabledItems.length === 0) return;

      console.log('[heartbeat] Running scheduled scan...');
      const response = await runHeartbeatCycle(storage, hb);
      lastRunAt = new Date().toISOString();

      // Parse NEXT TICK directive from agent response
      const directive = parseNextTickMs(response);
      if (directive !== null) {
        nextIntervalMs = directive;
        const isContinuation = directive < 2 * 60 * 1000; // < 2 min = work continuation
        bypassNextQuietHours = isContinuation;
        console.log(
          `[heartbeat] Agent-directed next tick in ${formatDuration(directive)}` +
          (isContinuation ? ' (work continuation — quiet hours bypassed)' : '')
        );
      } else {
        console.log(`[heartbeat] No NEXT TICK directive found — using configured interval (${formatDuration(nextIntervalMs)})`);
      }

      console.log('[heartbeat] Scheduled scan completed');
    } catch (err) {
      console.error('[heartbeat] Scheduled run error:', err instanceof Error ? err.message : err);
    }
  })();

  try {
    await currentRun;
  } finally {
    currentRun = null;
    // Schedule next tick with the interval determined during this run
    scheduleNextTick(storage, nextIntervalMs);
  }
}

/**
 * Parse "NEXT TICK: N minutes/hours/seconds" from the agent's response.
 * Returns milliseconds, or null if not found.
 */
function parseNextTickMs(response: string): number | null {
  const match = response.match(
    /NEXT TICK:\s*(\d+(?:\.\d+)?)\s*(minute|min|hour|hr|second|sec)s?/i
  );
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (!isFinite(value) || value <= 0) return null;

  const unit = match[2].toLowerCase();
  if (unit.startsWith('hour') || unit.startsWith('hr')) return Math.round(value * 60 * 60 * 1000);
  if (unit.startsWith('second') || unit.startsWith('sec')) return Math.round(value * 1000);
  return Math.round(value * 60 * 1000); // minutes (default)
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function isInQuietHours(quietHours: HeartbeatSettings['quietHours']): boolean {
  if (!quietHours.enabled) return false;

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: quietHours.timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    const minutePart = parts.find((p) => p.type === 'minute');

    if (!hourPart || !minutePart) return false;

    const currentMinutes = parseInt(hourPart.value, 10) * 60 + parseInt(minutePart.value, 10);
    const [startH, startM] = quietHours.startTime.split(':').map(Number);
    const [endH, endM] = quietHours.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Handle overnight ranges (e.g., 23:00 - 08:00)
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch {
    return false;
  }
}
