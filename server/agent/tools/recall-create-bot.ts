import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { RecallService } from '../../recall-service';

export const recallCreateBotTool: ToolDefinition = {
  name: 'recall_create_bot',
  description:
    'Send a Recall.ai recording bot to a meeting. The bot will join the meeting URL (Google Meet, Zoom, Teams, etc.), record audio/video, and generate a transcript. Use this when the user wants to record a meeting or add a bot to a call.',
  parameters: {
    type: 'object',
    properties: {
      meeting_url: {
        type: 'string',
        description: 'The meeting URL to join (e.g., Google Meet link, Zoom link)',
      },
      bot_name: {
        type: 'string',
        description: 'Display name for the bot in the meeting. Defaults to "[FirstName]\'s Notetaker" from the user profile.',
      },
      join_at: {
        type: 'string',
        description: 'ISO 8601 timestamp for when the bot should join. Must be >10 minutes in the future for scheduled joins. Omit to join immediately.',
      },
    },
    required: ['meeting_url'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const meetingUrl = String(args.meeting_url ?? '');
    const joinAt = args.join_at ? String(args.join_at) : undefined;

    // Derive default bot name from user profile first name
    const firstName = (context as any).userFirstName as string | undefined;
    const defaultBotName = firstName ? `${firstName}'s Notetaker` : 'Notetaker';
    const botName = args.bot_name ? String(args.bot_name) : defaultBotName;

    if (!meetingUrl.trim()) {
      return { output: '', error: 'Meeting URL is required.' };
    }

    const apiKey = context.recallApiKey;
    const region = context.recallRegion || process.env.RECALL_REGION || 'us-west-2';
    if (!apiKey) {
      return { output: '', error: 'Recall AI is not configured. Set up Recall in Settings > Integrations.' };
    }

    try {
      const service = new RecallService(apiKey, region);
      const bot = await service.createBot(meetingUrl, botName, joinAt);

      const statusText = joinAt
        ? `Scheduled to join at ${new Date(joinAt).toLocaleString()}`
        : 'Joining now';

      return {
        output: `Recording bot "${botName}" sent to meeting.\n\n` +
          `- **Bot ID**: ${bot.id}\n` +
          `- **Meeting**: ${meetingUrl}\n` +
          `- **Status**: ${statusText}\n\n` +
          `The bot will record the meeting and generate a transcript. Use the recall_search or recall_meetings tools to access the recording after the meeting ends.`,
      };
    } catch (err: any) {
      return { output: '', error: `Failed to create recording bot: ${err.message}` };
    }
  },
};
