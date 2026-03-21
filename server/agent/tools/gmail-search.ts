import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getGoogleServices, accountDisplayName } from './google-service-helper';
import { saveToWorkspace, timestampedName } from './workspace-save';

export const gmailSearchTool: ToolDefinition = {
  name: 'gmail_search',
  description:
    'Search Gmail messages across all connected Google accounts. Use Gmail search syntax (e.g., "from:john subject:meeting", "is:unread", "newer_than:7d"). Returns message summaries with sender, subject, date, and snippet, labeled by account.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (e.g., "from:boss@company.com newer_than:7d", "subject:invoice", "is:unread")',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results per account (default: 10, max: 20)',
      },
      account: {
        type: 'string',
        description: 'Optional: search only a specific account label (e.g. "Work", "Personal"). Omit to search all accounts.',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '');
    const maxResults = Math.min(Number(args.maxResults ?? 10), 20);
    const accountFilter = args.account ? String(args.account).toLowerCase() : null;

    if (!query.trim()) {
      return { output: '', error: 'Search query cannot be empty' };
    }

    const services = getGoogleServices(context);
    const filtered = accountFilter
      ? services.filter(s => s.label.toLowerCase() === accountFilter)
      : services;

    if (filtered.length === 0) {
      return { output: '', error: 'Gmail is not connected. Connect Google in Settings > Integrations.' };
    }

    const results = await Promise.allSettled(
      filtered.map(async (acct) => {
        const result = await acct.service.listEmails(query, maxResults);
        return { displayName: accountDisplayName(acct), result };
      }),
    );

    const sections: string[] = [];
    for (const r of results) {
      if (r.status === 'rejected') continue;
      const { displayName, result } = r.value;
      if (!result.messages || result.messages.length === 0) {
        sections.push(`**[${displayName}]** No emails found.`);
        continue;
      }
      const lines = result.messages.map((msg: any, i: number) =>
        `${i + 1}. **${msg.subject || '(No subject)'}**\n   From: ${msg.from}\n   Date: ${msg.date}\n   ${msg.snippet}`,
      );
      sections.push(`**[${displayName}]** ${result.messages.length} result(s):\n\n${lines.join('\n\n')}`);
    }

    const output = sections.join('\n\n---\n\n');

    const slug = query.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const fileName = timestampedName(`email-search-${slug}`, 'md');
    await saveToWorkspace(context.workspacePath, 'email', fileName, `# Email Search: ${query}\n\n${output}`);

    return { output };
  },
};
