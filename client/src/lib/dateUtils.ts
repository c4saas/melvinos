/**
 * Shared date/time formatting utilities — all timezone-aware.
 * Always pass the user's IANA timezone string (e.g. 'America/Chicago').
 * Fetched via useUserTimezone() hook.
 */

/**
 * Format an ISO date string in the given IANA timezone.
 * Falls back to browser locale if the timezone is invalid.
 */
export function formatInTz(
  isoString: string | null | undefined,
  timezone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('en-US', { timeZone: timezone, ...opts });
  } catch {
    return new Date(isoString).toLocaleString('en-US', opts);
  }
}

/** Short date: "Mar 19" */
export function fmtDate(isoString: string | null | undefined, tz: string): string {
  return formatInTz(isoString, tz, { month: 'short', day: 'numeric' });
}

/** Short date + year: "Mar 19, 2026" */
export function fmtDateLong(isoString: string | null | undefined, tz: string): string {
  return formatInTz(isoString, tz, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Time only: "7:15 AM" */
export function fmtTime(isoString: string | null | undefined, tz: string): string {
  return formatInTz(isoString, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Date + time: "Mar 19 7:15 AM" */
export function fmtDateTime(isoString: string | null | undefined, tz: string): string {
  return formatInTz(isoString, tz, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Full date + time: "Mar 19, 2026, 7:15 AM" */
export function fmtDateTimeFull(isoString: string | null | undefined, tz: string): string {
  return formatInTz(isoString, tz, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Today's date label in user timezone: "Wednesday, March 19" */
export function todayLabel(tz: string): string {
  const now = new Date().toISOString();
  return formatInTz(now, tz, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Build "Weekdays at 7:15 AM" using nextRunAt time in the user's timezone. */
export function cronScheduleLabel(cronExpr: string, nextRunAt: string | null, tz: string): string {
  const dow = cronExpr.split(/\s+/)[4] ?? '*';
  const prefix = dow === '1-5' ? 'Weekdays' : dow === '0,6' ? 'Weekends' : 'Daily';
  if (nextRunAt) {
    const time = fmtTime(nextRunAt, tz);
    return `${prefix} at ${time}`;
  }
  return cronExpr;
}
