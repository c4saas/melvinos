/**
 * Shared timezone context builder.
 * Generates the authoritative timezone instruction injected into every agent prompt.
 *
 * This is the SINGLE source of truth for timezone instructions.
 * Called from: ai-service.ts (chat), prompt-builder.ts (heartbeat), routes.ts (autonomous tasks).
 */

export function getCurrentTimeInTz(timezone: string): { dateStr: string; timeStr: string } {
  const now = new Date();
  try {
    const dateStr = now.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return { dateStr, timeStr };
  } catch {
    return { dateStr: now.toDateString(), timeStr: now.toTimeString().slice(0, 5) };
  }
}

/**
 * Computes the UTC ISO timestamps for the start and end of "today" in the given timezone.
 *
 * Critical for tool calls: passing timeMin="2026-03-19T00:00:00Z" means midnight UTC,
 * which is 6 PM CST the previous day. This function returns the correct UTC equivalent
 * of midnight in the user's timezone, e.g. "2026-03-19T06:00:00.000Z" for CST (UTC-6).
 */
export function getTodayUTCBounds(timezone: string): { startUTC: string; endUTC: string } {
  const tz = timezone || 'UTC';
  const now = new Date();

  // Get today's date string in the user's timezone (YYYY-MM-DD format)
  const localDate = now.toLocaleDateString('en-CA', { timeZone: tz }); // en-CA = YYYY-MM-DD

  // Compute the current UTC offset for this timezone by comparing
  // the same instant formatted in UTC vs the target timezone (handles DST automatically)
  const getTimeParts = (date: Date, tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
    return get('hour') * 3600 + get('minute') * 60 + get('second');
  };

  const utcSec = getTimeParts(now, 'UTC');
  const tzSec = getTimeParts(now, tz);
  let diffSec = utcSec - tzSec;
  // Adjust for midnight-crossing edge cases
  if (diffSec > 12 * 3600) diffSec -= 24 * 3600;
  if (diffSec < -12 * 3600) diffSec += 24 * 3600;

  // "Naive" midnight = YYYY-MM-DDT00:00:00Z (pretend it's UTC midnight)
  // Actual UTC midnight in the user's timezone = naiveMidnight + diffSec
  const naiveMidnight = new Date(localDate + 'T00:00:00Z');
  const startOfDay = new Date(naiveMidnight.getTime() + diffSec * 1000);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  return { startUTC: startOfDay.toISOString(), endUTC: endOfDay.toISOString() };
}

/**
 * Builds the mandatory timezone instruction block injected at the top of every agent session.
 * Explicitly tells the agent to convert UTC tool results to the user's timezone,
 * AND provides the correct UTC date boundaries for "today" so tools receive accurate timeMin/timeMax.
 */
export function buildTimezoneInstruction(timezone: string, location?: string): string {
  const tz = timezone || 'UTC';
  const { dateStr, timeStr } = getCurrentTimeInTz(tz);
  const locationLine = location ? `\nUser location: ${location}` : '';
  const { startUTC, endUTC } = getTodayUTCBounds(tz);

  return `## TIMEZONE — NON-NEGOTIABLE (apply to every response)
User timezone: ${tz}${locationLine}
Current date/time: ${dateStr}, ${timeStr} (${tz})
Today UTC range: ${startUTC} → ${endUTC}

RULE: ALL dates and times you report MUST be in the user's timezone (${tz}).
Tool results (calendar events, emails, tasks, logs, etc.) return UTC/ISO timestamps.
You MUST convert every timestamp to ${tz} before mentioning it in any response, message, email, or SMS.
NEVER report UTC times, never use "Z" suffix times, never say "GMT".
If a tool returns 2026-03-19T19:00:00Z and the user is in ${tz}, report the converted local time — not 7:00 PM UTC.
This applies to: calendar events, email send/receive times, task schedules, heartbeat logs, cron run times, and any other timestamp from any tool.

TOOL DATE RANGES: When calling tools with timeMin/timeMax, use the pre-computed UTC values above.
- For "today's events": timeMin=${startUTC}, timeMax=${endUTC}
- For "tomorrow": timeMin=${endUTC}, timeMax=${new Date(new Date(endUTC).getTime() + 24 * 60 * 60 * 1000).toISOString()}
- NEVER use T00:00:00Z as a date boundary — that is midnight UTC, not midnight in ${tz}.`.trim();
}
