/**
 * Heartbeat Scheduler
 *
 * Periodic setInterval-based scheduler that runs the heartbeat scan
 * at the configured interval, respects quiet hours, and supports
 * live reconfiguration via reconcile().
 *
 * Follows the same module-state pattern as telegram-bot.ts.
 */
import type { IStorage } from '../storage';
import { runHeartbeatCycle } from './prompt-builder';
import type { HeartbeatSettings } from '@shared/schema';

// ── Module state ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let currentRun: Promise<void> | null = null;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let currentIntervalMs: number | null = null;
let schedulerStorage: IStorage | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function getHeartbeatStatus() {
  return {
    lastRunAt,
    nextRunAt,
    intervalMs: currentIntervalMs,
    running: timer !== null,
  };
}

export function startHeartbeatScheduler(storage: IStorage) {
  schedulerStorage = storage;

  // Read settings and start polling
  void (async () => {
    try {
      const settings = await storage.getPlatformSettings();
      const hb = settings.data?.heartbeat;
      if (!hb?.enabled) {
        console.log('[heartbeat] Scheduler not started — heartbeat disabled');
        return;
      }

      const intervalMs = hb.intervalMinutes * 60 * 1000;
      scheduleTimer(storage, intervalMs);
      console.log(`[heartbeat] Scheduler started — interval ${hb.intervalMinutes}m`);
    } catch (err) {
      console.warn('[heartbeat] Failed to read initial settings:', err);
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
 * Stops existing timer and restarts with new interval (or stops entirely).
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
    scheduleTimer(storage, intervalMs);
    console.log(`[heartbeat] Scheduler reconciled — interval ${hb.intervalMinutes}m`);
  } catch (err) {
    console.warn('[heartbeat] Reconcile failed:', err);
  }
}

/**
 * Run a single heartbeat tick. Exposed for manual trigger endpoint.
 */
export async function runHeartbeatTick(storage: IStorage): Promise<string> {
  const settings = await storage.getPlatformSettings();
  const hb = settings.data?.heartbeat;

  if (!hb) {
    return 'Heartbeat not configured.';
  }

  // Check quiet hours (skip for manual triggers — only auto runs respect quiet hours)
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
    clearInterval(timer);
    timer = null;
  }
  currentIntervalMs = null;
  nextRunAt = null;
}

function scheduleTimer(storage: IStorage, intervalMs: number) {
  clearTimer();
  currentIntervalMs = intervalMs;
  updateNextRunAt(intervalMs);

  timer = setInterval(() => {
    void runScheduledTick(storage);
  }, intervalMs);
}

function updateNextRunAt(intervalMs: number) {
  nextRunAt = new Date(Date.now() + intervalMs).toISOString();
}

async function runScheduledTick(storage: IStorage) {
  if (currentRun) return; // previous run still in progress

  currentRun = (async () => {
    try {
      // Re-read settings in case they changed between ticks
      const settings = await storage.getPlatformSettings();
      const hb = settings.data?.heartbeat;

      if (!hb?.enabled) return;

      // Check quiet hours for automated runs
      if (isInQuietHours(hb.quietHours)) {
        console.log('[heartbeat] Skipped — quiet hours');
        return;
      }

      const enabledItems = hb.scanItems.filter((item) => item.enabled);
      if (enabledItems.length === 0) return;

      console.log('[heartbeat] Running scheduled scan...');
      await runHeartbeatCycle(storage, hb);
      lastRunAt = new Date().toISOString();
      console.log('[heartbeat] Scheduled scan completed');
    } catch (err) {
      console.error('[heartbeat] Scheduled run error:', err instanceof Error ? err.message : err);
    }
  })();

  try {
    await currentRun;
  } finally {
    currentRun = null;
    if (currentIntervalMs) {
      updateNextRunAt(currentIntervalMs);
    }
  }
}

function isInQuietHours(quietHours: HeartbeatSettings['quietHours']): boolean {
  if (!quietHours.enabled) return false;

  try {
    // Get current time in the configured timezone
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

    // Parse start/end times
    const [startH, startM] = quietHours.startTime.split(':').map(Number);
    const [endH, endM] = quietHours.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Handle overnight ranges (e.g., 23:00 - 08:00)
    if (startMinutes <= endMinutes) {
      // Same-day range (e.g., 09:00 - 17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 23:00 - 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch {
    // If timezone parsing fails, don't suppress the scan
    return false;
  }
}
