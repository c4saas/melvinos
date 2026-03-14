import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getGoogleService } from './google-service-helper';

const NOT_CONNECTED = 'Google Calendar is not connected. Connect Google in Settings > Integrations.';

// ── Create Event ────────────────────────────────────────────────────────────

export const calendarCreateEventTool: ToolDefinition = {
  name: 'calendar_create_event',
  description:
    'Create a new Google Calendar event. Can include attendees and automatically add a Google Meet link. Use this when the user asks to schedule a meeting, create an event, or book time.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Event title/name.',
      },
      start: {
        type: 'string',
        description: 'Start time in ISO 8601 format (e.g., "2026-03-10T14:00:00Z").',
      },
      end: {
        type: 'string',
        description: 'End time in ISO 8601 format (e.g., "2026-03-10T15:00:00Z").',
      },
      description: {
        type: 'string',
        description: 'Event description or notes.',
      },
      location: {
        type: 'string',
        description: 'Event location.',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of attendee email addresses.',
      },
      add_meet_link: {
        type: 'boolean',
        description: 'Set to true to automatically add a Google Meet video conference link.',
      },
    },
    required: ['summary', 'start', 'end'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const summary = String(args.summary ?? '').trim();
    const start = String(args.start ?? '').trim();
    const end = String(args.end ?? '').trim();
    const description = args.description ? String(args.description) : undefined;
    const location = args.location ? String(args.location) : undefined;
    const attendees = Array.isArray(args.attendees) ? args.attendees.map(String) : undefined;
    const addMeetLink = Boolean(args.add_meet_link);

    if (!summary) return { output: '', error: 'Event summary/title is required.' };
    if (!start) return { output: '', error: 'Start time is required.' };
    if (!end) return { output: '', error: 'End time is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;
    if (!service) return { output: '', error: NOT_CONNECTED };

    try {
      const event = await service.createCalendarEvent({
        summary, start, end, description, location, attendees, addMeetLink,
      });

      let output = `Event created successfully!\n\n` +
        `- **Title**: ${event.summary}\n` +
        `- **Start**: ${event.start}\n` +
        `- **End**: ${event.end}\n` +
        `- **Event ID**: ${event.id}\n`;
      if (event.htmlLink) output += `- **Link**: ${event.htmlLink}\n`;
      if (event.meetLink) output += `- **Meet Link**: ${event.meetLink}\n`;

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to create calendar event: ${err.message}` };
    }
  },
};

// ── Update Event ────────────────────────────────────────────────────────────

export const calendarUpdateEventTool: ToolDefinition = {
  name: 'calendar_update_event',
  description:
    'Update an existing Google Calendar event. Use calendar_events first to find the event ID, then use this to modify it.',
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'The Google Calendar event ID to update.',
      },
      summary: {
        type: 'string',
        description: 'New event title.',
      },
      start: {
        type: 'string',
        description: 'New start time (ISO 8601).',
      },
      end: {
        type: 'string',
        description: 'New end time (ISO 8601).',
      },
      description: {
        type: 'string',
        description: 'New event description.',
      },
      location: {
        type: 'string',
        description: 'New event location.',
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Updated list of attendee email addresses (replaces existing).',
      },
    },
    required: ['event_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const eventId = String(args.event_id ?? '').trim();
    if (!eventId) return { output: '', error: 'Event ID is required.' };

    const updates: any = {};
    if (args.summary) updates.summary = String(args.summary);
    if (args.start) updates.start = String(args.start);
    if (args.end) updates.end = String(args.end);
    if (args.description !== undefined) updates.description = String(args.description);
    if (args.location !== undefined) updates.location = String(args.location);
    if (Array.isArray(args.attendees)) updates.attendees = args.attendees.map(String);

    if (Object.keys(updates).length === 0) {
      return { output: '', error: 'Provide at least one field to update.' };
    }

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;
    if (!service) return { output: '', error: NOT_CONNECTED };

    try {
      const event = await service.updateCalendarEvent(eventId, updates);
      return {
        output: `Event updated successfully!\n\n` +
          `- **Title**: ${event.summary}\n` +
          `- **Start**: ${event.start}\n` +
          `- **End**: ${event.end}\n` +
          `- **Link**: ${event.htmlLink}\n`,
      };
    } catch (err: any) {
      return { output: '', error: `Failed to update calendar event: ${err.message}` };
    }
  },
};

// ── Delete Event ────────────────────────────────────────────────────────────

export const calendarDeleteEventTool: ToolDefinition = {
  name: 'calendar_delete_event',
  description:
    'Delete or cancel a Google Calendar event. Use calendar_events first to find the event ID.',
  parameters: {
    type: 'object',
    properties: {
      event_id: {
        type: 'string',
        description: 'The Google Calendar event ID to delete.',
      },
    },
    required: ['event_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const eventId = String(args.event_id ?? '').trim();
    if (!eventId) return { output: '', error: 'Event ID is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;
    if (!service) return { output: '', error: NOT_CONNECTED };

    try {
      await service.deleteCalendarEvent(eventId);
      return { output: `Calendar event deleted successfully.` };
    } catch (err: any) {
      return { output: '', error: `Failed to delete calendar event: ${err.message}` };
    }
  },
};
