import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { RecallService } from '../../recall-service';
import { saveToWorkspace, timestampedName } from './workspace-save';

/** Retrieve Recall API key from context or env. */
function getRecallApiKey(context: ToolContext): string | null {
  return context.recallApiKey || process.env.RECALL_API_KEY || null;
}

function getRecallRegion(context: ToolContext): string {
  return context.recallRegion || process.env.RECALL_REGION || 'us-west-2';
}

export const recallSearchTool: ToolDefinition = {
  name: 'recall_search',
  description:
    'Search meeting transcripts from Recall AI. Use this when the user asks about past meetings, what was discussed, or wants to recall key moments from conversations. Searches across recent meeting bot transcripts for matching keywords.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to find in meeting transcripts (e.g., "budget discussion", "action items", "quarterly review")',
      },
      daysBack: {
        type: 'number',
        description: 'How many days back to search (default: 30, max: 90)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of meetings to search (default: 10, max: 20)',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '');
    const daysBack = Math.min(Number(args.daysBack ?? 30), 90);
    const limit = Math.min(Number(args.limit ?? 10), 20);

    if (!query.trim()) {
      return { output: '', error: 'Search query cannot be empty' };
    }

    const apiKey = getRecallApiKey(context);
    if (!apiKey) {
      return {
        output: '',
        error: 'Recall AI is not configured. Add a RECALL_API_KEY or enable Recall in Settings > Integrations.',
      };
    }

    const region = getRecallRegion(context);
    const service = new RecallService(apiKey, region);

    try {
      const joinAtAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const results = await service.searchTranscripts(query, { joinAtAfter, limit });

      if (results.length === 0) {
        return { output: `No meeting transcripts found matching "${query}" in the last ${daysBack} days.` };
      }

      const sections = results.map((r, i) => {
        const date = new Date(r.joinAt).toLocaleDateString();
        const matchLines = r.matches.map(m => `   > ${m}`).join('\n');
        return `${i + 1}. **${r.botName}** (${date})\n   Meeting: ${r.meetingUrl}\n${matchLines}`;
      });

      const output = `Found matches in ${results.length} meeting(s) for "${query}":\n\n${sections.join('\n\n')}`;

      // Save to workspace
      const slug = query.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`meeting-search-${slug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'meetings', fileName, `# Meeting Search: ${query}\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Recall search failed: ${err.message}` };
    }
  },
};

export const recallListMeetingsTool: ToolDefinition = {
  name: 'recall_meetings',
  description:
    'List recent meetings recorded by Recall AI bots. Use this when the user asks to see their recent meetings or recorded calls.',
  parameters: {
    type: 'object',
    properties: {
      daysBack: {
        type: 'number',
        description: 'How many days back to list (default: 7, max: 30)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of meetings to return (default: 10, max: 20)',
      },
    },
    required: [],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const daysBack = Math.min(Number(args.daysBack ?? 7), 30);
    const limit = Math.min(Number(args.limit ?? 10), 20);

    const apiKey = getRecallApiKey(context);
    if (!apiKey) {
      return {
        output: '',
        error: 'Recall AI is not configured. Add a RECALL_API_KEY or enable Recall in Settings > Integrations.',
      };
    }

    const region = getRecallRegion(context);
    const service = new RecallService(apiKey, region);

    try {
      const joinAtAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const bots = await service.listBots({ joinAtAfter, limit });

      if (bots.length === 0) {
        return { output: `No recorded meetings found in the last ${daysBack} days.` };
      }

      const lines = bots.map((bot, i) => {
        const lastStatus = bot.status_changes?.length ? bot.status_changes[bot.status_changes.length - 1] : null;
        const statusLabel = lastStatus?.code ?? 'unknown';
        const date = new Date(bot.join_at).toLocaleDateString();
        return `${i + 1}. **${bot.bot_name}** (${date}) — ${statusLabel}\n   ${bot.meeting_url}`;
      });

      const output = `Found ${bots.length} meeting(s) in the last ${daysBack} days:\n\n${lines.join('\n\n')}`;

      // Save to workspace
      const fileName = timestampedName('meetings-list', 'md');
      await saveToWorkspace(context.workspacePath, 'meetings', fileName, `# Recent Meetings\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to list meetings: ${err.message}` };
    }
  },
};
