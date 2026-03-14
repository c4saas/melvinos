import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getUncachableNotionClient } from '../../notion-service';
import { saveToWorkspace, timestampedName } from './workspace-save';

export const notionSearchTool: ToolDefinition = {
  name: 'notion_search',
  description:
    'Search the user\'s Notion workspace for pages and databases. Use this when the user asks to look up, find, or retrieve information from Notion. Supports text search queries.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text to find in Notion pages and databases',
      },
      type: {
        type: 'string',
        enum: ['page', 'database', 'all'],
        description: 'Filter results by type (default: "all")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 25)',
      },
    },
    required: [],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = args.query ? String(args.query) : '';
    const type = (args.type as string) || 'all';
    const limit = Math.min(Number(args.limit ?? 10), 25);

    let client;
    try {
      client = await getUncachableNotionClient(context.userId);
    } catch (err: any) {
      return {
        output: '',
        error: 'Notion is not connected. Connect your Notion account in Settings > Integrations.',
      };
    }

    try {
      const searchParams: any = { page_size: limit };
      if (query) searchParams.query = query;
      if (type === 'page') {
        searchParams.filter = { property: 'object', value: 'page' };
      } else if (type === 'database') {
        searchParams.filter = { property: 'object', value: 'data_source' };
      }

      const response = await client.search(searchParams);
      const results = response.results;

      if (results.length === 0) {
        return { output: query ? `No Notion results found for "${query}".` : 'No pages or databases found in your Notion workspace.' };
      }

      const formatted = results.map((item: any, i: number) => {
        const kind = item.object === 'page' ? 'Page' : 'Database';
        const title = extractTitle(item);
        const url = item.url || '';
        const lastEdited = item.last_edited_time
          ? new Date(item.last_edited_time).toLocaleDateString()
          : '';

        let details = `${i + 1}. **[${kind}] ${title}**`;
        if (lastEdited) details += ` (edited ${lastEdited})`;
        if (url) details += `\n   ${url}`;

        // For pages, try to extract property values
        if (item.object === 'page' && item.properties) {
          const props = extractPageProperties(item.properties);
          if (props) details += `\n   ${props}`;
        }

        return details;
      });

      const output = `Found ${results.length} Notion result(s)${query ? ` for "${query}"` : ''}:\n\n${formatted.join('\n\n')}`;

      // Save to workspace
      const slug = (query || 'browse').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`notion-search-${slug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'notion', fileName, `# Notion Search: ${query || 'All'}\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Notion search failed: ${err.message}` };
    }
  },
};

/** Extract the title from a Notion page or database object */
function extractTitle(item: any): string {
  // Database title
  if (item.title && Array.isArray(item.title)) {
    return item.title.map((t: any) => t.plain_text).join('') || '(Untitled)';
  }
  // Page title — look in properties
  if (item.properties) {
    for (const prop of Object.values(item.properties) as any[]) {
      if (prop.type === 'title' && Array.isArray(prop.title)) {
        return prop.title.map((t: any) => t.plain_text).join('') || '(Untitled)';
      }
    }
  }
  return '(Untitled)';
}

/** Extract key property values from a page for display */
function extractPageProperties(properties: Record<string, any>): string {
  const parts: string[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'title') continue; // Already shown as title
    const value = extractPropertyValue(prop);
    if (value) parts.push(`${key}: ${value}`);
    if (parts.length >= 4) break; // Limit properties shown
  }
  return parts.join(' | ');
}

function extractPropertyValue(prop: any): string {
  switch (prop.type) {
    case 'rich_text':
      return prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return prop.multi_select?.map((s: any) => s.name).join(', ') || '';
    case 'date':
      return prop.date?.start || '';
    case 'checkbox':
      return prop.checkbox ? 'Yes' : 'No';
    case 'status':
      return prop.status?.name || '';
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    default:
      return '';
  }
}
