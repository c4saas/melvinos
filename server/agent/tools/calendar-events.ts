import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getGoogleServices } from './google-service-helper';
import { saveToWorkspace, timestampedName } from './workspace-save';

export const calendarEventsTool: ToolDefinition = {
  name: 'calendar_events',
  description:
    'List upcoming Google Calendar events across all connected accounts. Defaults to the next 7 days. Use this when the user asks about their schedule, meetings, or calendar.',
  parameters: {
    type: 'object',
    properties: {
      timeMin: {
        type: 'string',
        description: 'Start of time range (ISO 8601 datetime, e.g., "2026-03-01T00:00:00Z"). Defaults to now.',
      },
      timeMax: {
        type: 'string',
        description: 'End of time range (ISO 8601 datetime). Defaults to 7 days from now.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of events per account (default: 20, max: 50)',
      },
      account: {
        type: 'string',
        description: 'Optional: show only events from a specific account (e.g. "Work", "Personal"). Omit to show all.',
      },
    },
    required: [],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const timeMin = args.timeMin ? String(args.timeMin) : undefined;
    const timeMax = args.timeMax ? String(args.timeMax) : undefined;
    const maxResults = Math.min(Number(args.maxResults ?? 20), 50);
    const accountFilter = args.account ? String(args.account).toLowerCase() : null;

    const services = getGoogleServices(context);
    const filtered = accountFilter
      ? services.filter(s => s.label.toLowerCase() === accountFilter)
      : services;

    if (filtered.length === 0) {
      return { output: '', error: 'Google Calendar is not connected. Connect Google in Settings > Integrations.' };
    }

    const results = await Promise.allSettled(
      filtered.map(async ({ label, service }) => {
        const result = await service.listCalendarEvents(timeMin, timeMax, maxResults);
        return { label, result };
      }),
    );

    const userTz = (context as any).userTimezone as string | undefined || 'UTC';
    const fmtEvtTime = (iso: string) => {
      try {
        return new Date(iso).toLocaleString('en-US', {
          timeZone: userTz,
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        });
      } catch {
        return new Date(iso).toLocaleString('en-US');
      }
    };

    const sections: string[] = [];
    for (const r of results) {
      if (r.status === 'rejected') continue;
      const { label, result } = r.value;
      if (!result.events || result.events.length === 0) {
        sections.push(`**[${label}]** No upcoming events.`);
        continue;
      }
      const lines = result.events.map((evt: any, i: number) => {
        const start = evt.start ? fmtEvtTime(evt.start) : 'TBD';
        const end = evt.end ? new Date(evt.end).toLocaleTimeString('en-US', { timeZone: userTz, hour: 'numeric', minute: '2-digit', hour12: true }) : '';
        const attendeeStr = evt.attendees?.length > 0 ? `\n   Attendees: ${evt.attendees.join(', ')}` : '';
        const locationStr = evt.location ? `\n   Location: ${evt.location}` : '';
        const meetStr = evt.meetLink ? `\n   Meet Link: ${evt.meetLink}` : '';
        return `${i + 1}. **${evt.summary}**\n   ${start}${end ? ` – ${end}` : ''}${locationStr}${meetStr}${attendeeStr}\n   Event ID: ${evt.id}`;
      });
      sections.push(`**[${label}]** ${result.events.length} event(s):\n\n${lines.join('\n\n')}`);
    }

    const output = sections.join('\n\n---\n\n');
    const fileName = timestampedName('calendar-events', 'md');
    await saveToWorkspace(context.workspacePath, 'calendar', fileName, `# Calendar Events\n\n${output}`);

    return { output };
  },
};
