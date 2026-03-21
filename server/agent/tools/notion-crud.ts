import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getUncachableNotionClient } from '../../notion-service';
import { saveToWorkspace, timestampedName } from './workspace-save';

async function getNotionClient(context: ToolContext) {
  try {
    return await getUncachableNotionClient(context.userId);
  } catch {
    return null;
  }
}

const NOT_CONNECTED = 'Notion is not connected. Connect your Notion account in Settings > Integrations.';

// ── Read Page ───────────────────────────────────────────────────────────────

export const notionReadPageTool: ToolDefinition = {
  name: 'notion_read_page',
  description:
    'Read the full content of a Notion page including its properties and block content. Use this when the user wants to view or read a specific Notion page. Requires a page ID (from notion_search results or a Notion URL).',
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The Notion page ID (UUID format, e.g., "a1b2c3d4-..."). Can be extracted from Notion URLs.',
      },
    },
    required: ['page_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pageId = String(args.page_id ?? '').trim();
    if (!pageId) return { output: '', error: 'Page ID is required.' };
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(pageId)) {
      return { output: '', error: `Invalid page ID format: "${pageId}". Expected UUID.` };
    }

    const client = await getNotionClient(context);
    if (!client) return { output: '', error: NOT_CONNECTED };

    try {
      const page: any = await client.pages.retrieve({ page_id: pageId });

      // Extract title
      let title = '(Untitled)';
      if (page.properties) {
        for (const prop of Object.values(page.properties) as any[]) {
          if (prop.type === 'title' && Array.isArray(prop.title)) {
            title = prop.title.map((t: any) => t.plain_text).join('') || '(Untitled)';
            break;
          }
        }
      }

      // Extract properties
      const propLines: string[] = [];
      if (page.properties) {
        for (const [key, prop] of Object.entries(page.properties) as [string, any][]) {
          if (prop.type === 'title') continue;
          const val = formatPropertyValue(prop);
          if (val) propLines.push(`- **${key}**: ${val}`);
        }
      }

      // Get page blocks (content)
      const blocks: any[] = [];
      let cursor: string | undefined;
      do {
        const resp: any = await client.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
          page_size: 100,
        });
        blocks.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
      } while (cursor);

      const contentLines = blocks.map(formatBlock).filter(Boolean);

      let output = `# ${title}\n`;
      if (page.url) output += `${page.url}\n`;
      output += `Last edited: ${page.last_edited_time ?? 'unknown'}\n\n`;
      if (propLines.length) output += `## Properties\n${propLines.join('\n')}\n\n`;
      if (contentLines.length) output += `## Content\n${contentLines.join('\n')}`;
      else output += '_No content blocks found._';

      // Save to workspace
      const titleSlug = title.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`notion-${titleSlug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'notion', fileName, output);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to read Notion page: ${err.message}` };
    }
  },
};

// ── Create Page ─────────────────────────────────────────────────────────────

export const notionCreatePageTool: ToolDefinition = {
  name: 'notion_create_page',
  description:
    'Create a new page in Notion. Can be created as a child of a database (with properties) or as a child of another page. Use notion_search first to find the parent database or page ID.',
  parameters: {
    type: 'object',
    properties: {
      parent_id: {
        type: 'string',
        description: 'ID of the parent database or page where the new page will be created.',
      },
      parent_type: {
        type: 'string',
        enum: ['database', 'page'],
        description: 'Whether the parent is a database or a page (default: "database").',
      },
      title: {
        type: 'string',
        description: 'Title of the new page.',
      },
      content: {
        type: 'string',
        description: 'Text content for the page body. Each line becomes a paragraph block.',
      },
      properties: {
        type: 'object',
        description: 'Additional properties to set (for database pages). Keys are property names, values are property values. Example: {"Status": "In Progress", "Priority": "High"}',
      },
    },
    required: ['parent_id', 'title'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parentId = String(args.parent_id ?? '').trim();
    const parentType = String(args.parent_type ?? 'database');
    const title = String(args.title ?? '').trim();
    const content = args.content ? String(args.content) : '';
    const properties = args.properties as Record<string, unknown> | undefined;

    if (!parentId) return { output: '', error: 'Parent ID is required.' };
    if (!title) return { output: '', error: 'Title is required.' };

    const client = await getNotionClient(context);
    if (!client) return { output: '', error: NOT_CONNECTED };

    try {
      const parent = parentType === 'page'
        ? { page_id: parentId }
        : { database_id: parentId };

      // Build properties — title is always required
      const pageProperties: any = {
        title: { title: [{ text: { content: title } }] },
      };

      // Add additional properties for database pages
      if (properties && parentType === 'database') {
        for (const [key, value] of Object.entries(properties)) {
          if (key.toLowerCase() === 'title') continue; // Already handled
          pageProperties[key] = buildPropertyValue(value);
        }
      }

      // Build content blocks
      const children: any[] = [];
      if (content) {
        for (const line of content.split('\n')) {
          if (line.trim()) {
            children.push({
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
            });
          }
        }
      }

      const response: any = await client.pages.create({
        parent: parent as any,
        properties: pageProperties,
        children: children.length > 0 ? children : undefined,
      });

      return {
        output: `Page created successfully!\n\n` +
          `- **Title**: ${title}\n` +
          `- **ID**: ${response.id}\n` +
          `- **URL**: ${response.url ?? 'N/A'}\n`,
      };
    } catch (err: any) {
      return { output: '', error: `Failed to create Notion page: ${err.message}` };
    }
  },
};

// ── Update Page ─────────────────────────────────────────────────────────────

export const notionUpdatePageTool: ToolDefinition = {
  name: 'notion_update_page',
  description:
    'Update a Notion page\'s properties or archive (delete) it. Use this to modify page properties or to archive/restore a page. Use notion_search or notion_read_page first to get the page ID.',
  parameters: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The Notion page ID to update.',
      },
      properties: {
        type: 'object',
        description: 'Properties to update. Keys are property names, values are new values. Example: {"Status": "Done", "Priority": "Low"}',
      },
      archived: {
        type: 'boolean',
        description: 'Set to true to archive (soft-delete) the page, false to restore it.',
      },
    },
    required: ['page_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pageId = String(args.page_id ?? '').trim();
    const properties = args.properties as Record<string, unknown> | undefined;
    const archived = args.archived as boolean | undefined;

    if (!pageId) return { output: '', error: 'Page ID is required.' };
    if (!properties && archived === undefined) {
      return { output: '', error: 'Provide properties to update or set archived to true/false.' };
    }

    const client = await getNotionClient(context);
    if (!client) return { output: '', error: NOT_CONNECTED };

    try {
      const updatePayload: any = { page_id: pageId };

      if (properties) {
        const pageProps: any = {};
        for (const [key, value] of Object.entries(properties)) {
          pageProps[key] = buildPropertyValue(value);
        }
        updatePayload.properties = pageProps;
      }

      if (archived !== undefined) {
        updatePayload.archived = archived;
      }

      const response: any = await client.pages.update(updatePayload);

      const actions: string[] = [];
      if (archived === true) actions.push('archived');
      if (archived === false) actions.push('restored');
      if (properties) actions.push(`updated ${Object.keys(properties).length} properties`);

      return {
        output: `Page ${actions.join(' and ')} successfully.\n\n` +
          `- **ID**: ${response.id}\n` +
          `- **URL**: ${response.url ?? 'N/A'}\n`,
      };
    } catch (err: any) {
      return { output: '', error: `Failed to update Notion page: ${err.message}` };
    }
  },
};

// ── Query Database ──────────────────────────────────────────────────────────

export const notionQueryDatabaseTool: ToolDefinition = {
  name: 'notion_query_database',
  description:
    'Query a Notion database with optional filters and sorting. Use this to retrieve rows from a database filtered by date, status, or other properties. Returns page titles and properties.',
  parameters: {
    type: 'object',
    properties: {
      database_id: {
        type: 'string',
        description: 'The Notion database ID (UUID format).',
      },
      filter: {
        type: 'object',
        description: 'Notion filter object. Example for last 7 days: {"property": "Date", "date": {"on_or_after": "2026-03-10"}}. Compound filters use {"and": [...]} or {"or": [...]}.',
      },
      sorts: {
        type: 'array',
        description: 'Array of sort objects. Example: [{"property": "Date", "direction": "descending"}]',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 25, max: 100).',
      },
    },
    required: ['database_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const databaseId = String(args.database_id ?? '').trim();
    if (!databaseId) return { output: '', error: 'Database ID is required.' };
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(databaseId)) {
      return { output: '', error: `Invalid database ID format: "${databaseId}". Expected UUID (e.g., "a1b2c3d4-5e6f-...").` };
    }

    const filter = args.filter as Record<string, unknown> | undefined;
    const sorts = args.sorts as any[] | undefined;
    const limit = Math.min(Number(args.limit ?? 25), 100);

    const client = await getNotionClient(context);
    if (!client) return { output: '', error: NOT_CONNECTED };

    try {
      const queryParams: any = { database_id: databaseId, page_size: limit };
      if (filter) queryParams.filter = filter;
      if (sorts) queryParams.sorts = sorts;

      const response: any = await (client as any).request({
        path: `databases/${databaseId}/query`,
        method: 'POST',
        body: queryParams,
      });
      const pages = response.results ?? [];

      if (pages.length === 0) {
        return { output: 'No results found matching your query.' };
      }

      const rows: string[] = [];
      for (const page of pages) {
        let title = '(Untitled)';
        const props: string[] = [];

        if (page.properties) {
          for (const [key, prop] of Object.entries(page.properties) as [string, any][]) {
            if (prop.type === 'title') {
              title = prop.title?.map((t: any) => t.plain_text).join('') || '(Untitled)';
            } else {
              const val = formatPropertyValue(prop);
              if (val) props.push(`  - ${key}: ${val}`);
            }
          }
        }

        rows.push(`**${title}** (${page.id})\n${props.join('\n')}`);
      }

      const output = `Found ${pages.length} result(s):\n\n${rows.join('\n\n')}`;

      // Save to workspace
      const fileName = timestampedName('notion-query', 'md');
      await saveToWorkspace(context.workspacePath, 'notion', fileName, output);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to query database: ${err.message}` };
    }
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBlock(block: any): string {
  const type = block.type;
  const data = block[type];
  if (!data) return '';

  const getText = (richText: any[]) =>
    (richText ?? []).map((t: any) => t.plain_text).join('');

  switch (type) {
    case 'paragraph':
      return getText(data.rich_text);
    case 'heading_1':
      return `# ${getText(data.rich_text)}`;
    case 'heading_2':
      return `## ${getText(data.rich_text)}`;
    case 'heading_3':
      return `### ${getText(data.rich_text)}`;
    case 'bulleted_list_item':
      return `- ${getText(data.rich_text)}`;
    case 'numbered_list_item':
      return `1. ${getText(data.rich_text)}`;
    case 'to_do':
      return `${data.checked ? '[x]' : '[ ]'} ${getText(data.rich_text)}`;
    case 'toggle':
      return `> ${getText(data.rich_text)}`;
    case 'code':
      return `\`\`\`${data.language ?? ''}\n${getText(data.rich_text)}\n\`\`\``;
    case 'quote':
      return `> ${getText(data.rich_text)}`;
    case 'callout':
      return `> ${data.icon?.emoji ?? ''} ${getText(data.rich_text)}`;
    case 'divider':
      return '---';
    case 'image':
      return `[Image: ${data.external?.url ?? data.file?.url ?? 'embedded'}]`;
    case 'bookmark':
      return `[Bookmark: ${data.url ?? ''}]`;
    default:
      return '';
  }
}

function formatPropertyValue(prop: any): string {
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
    case 'phone_number':
      return prop.phone_number || '';
    case 'people':
      return prop.people?.map((p: any) => p.name || p.id).join(', ') || '';
    case 'relation':
      return prop.relation?.map((r: any) => r.id).join(', ') || '';
    default:
      return '';
  }
}

function buildPropertyValue(value: unknown): any {
  if (typeof value === 'string') {
    return { rich_text: [{ text: { content: value } }] };
  }
  if (typeof value === 'number') {
    return { number: value };
  }
  if (typeof value === 'boolean') {
    return { checkbox: value };
  }
  // If it's already an object (user passed Notion-format property), use as-is
  if (typeof value === 'object' && value !== null) {
    return value;
  }
  return { rich_text: [{ text: { content: String(value) } }] };
}
