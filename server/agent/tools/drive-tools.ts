import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getGoogleService, getGoogleServices } from './google-service-helper';
import { saveToWorkspace, timestampedName } from './workspace-save';

const NOT_CONNECTED = 'Google Drive is not connected. Connect Google in Settings > Integrations.';

// ── Search Drive ────────────────────────────────────────────────────────────

export const driveSearchTool: ToolDefinition = {
  name: 'drive_search',
  description:
    'Search Google Drive for files and folders. Use Google Drive query syntax: name contains \'keyword\', mimeType=\'application/vnd.google-apps.document\', etc. Use this when the user asks to find files in Drive.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Google Drive search query. Examples: "name contains \'report\'", "mimeType=\'application/vnd.google-apps.spreadsheet\'", "fullText contains \'budget\'".',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results (default: 10, max: 25).',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '').trim();
    const maxResults = Math.min(Number(args.max_results ?? 10), 25);

    if (!query) return { output: '', error: 'Search query is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;

    try {
      const result = await service.searchFiles(query, maxResults);
      const files = result.files ?? [];

      if (files.length === 0) {
        return { output: `No files found matching: "${query}"` };
      }

      const lines = files.map((f: any, i: number) => {
        const modified = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '';
        const size = f.size ? `${Math.round(Number(f.size) / 1024)}KB` : '';
        return `${i + 1}. **${f.name}**\n   ID: ${f.id} | Type: ${f.mimeType}${modified ? ` | Modified: ${modified}` : ''}${size ? ` | Size: ${size}` : ''}${f.webViewLink ? `\n   ${f.webViewLink}` : ''}`;
      });

      const output = `Found ${files.length} files:\n\n${lines.join('\n\n')}`;

      // Save to workspace
      const slug = query.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`drive-search-${slug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'drive', fileName, `# Drive Search: ${query}\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Drive search failed: ${err.message}` };
    }
  },
};

// ── Read Drive File ─────────────────────────────────────────────────────────

export const driveReadTool: ToolDefinition = {
  name: 'drive_read',
  description:
    'Read the content of a Google Drive file. Google Docs are exported as plain text, Google Sheets as CSV. Use drive_search first to find the file ID.',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The Google Drive file ID to read.',
      },
    },
    required: ['file_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const fileId = String(args.file_id ?? '').trim();
    if (!fileId) return { output: '', error: 'File ID is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;

    try {
      const metadata = await service.getFileMetadata(fileId);
      const content = await service.getFileContent(fileId);
      const truncated = typeof content === 'string' && content.length > 10000
        ? content.slice(0, 10000) + '\n\n...(truncated)'
        : content;

      const output = `**File**: ${metadata.name}\n**Type**: ${metadata.mimeType}\n\n---\n\n${truncated}`;

      // Save to workspace
      const nameSlug = (metadata.name || 'file').slice(0, 40).replace(/[^a-zA-Z0-9.]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`drive-${nameSlug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'drive', fileName, `# ${metadata.name}\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to read Drive file: ${err.message}` };
    }
  },
};

// ── Write Drive File ────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  create_doc: 'application/vnd.google-apps.document',
  create_sheet: 'application/vnd.google-apps.spreadsheet',
  create_folder: 'application/vnd.google-apps.folder',
};

export const driveWriteTool: ToolDefinition = {
  name: 'drive_write',
  description:
    'Create or update files in Google Drive. Can create Google Docs, Sheets, folders, or upload text files. Use this when the user asks to create a document, spreadsheet, or folder in Drive.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create_doc', 'create_sheet', 'create_folder', 'upload', 'update'],
        description: 'What to do: create_doc (Google Doc), create_sheet (Google Sheet), create_folder, upload (text file), update (existing file).',
      },
      name: {
        type: 'string',
        description: 'Name for the file or folder.',
      },
      content: {
        type: 'string',
        description: 'Text content for the file (not needed for folders).',
      },
      parent_folder_id: {
        type: 'string',
        description: 'Parent folder ID to create in (optional, defaults to root).',
      },
      file_id: {
        type: 'string',
        description: 'File ID to update (required for "update" action).',
      },
    },
    required: ['action', 'name'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = String(args.action ?? '');
    const name = String(args.name ?? '').trim();
    const content = args.content ? String(args.content) : undefined;
    const parentFolderId = args.parent_folder_id ? String(args.parent_folder_id) : undefined;
    const fileId = args.file_id ? String(args.file_id) : undefined;

    if (!name) return { output: '', error: 'File/folder name is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;

    try {
      switch (action) {
        case 'create_doc':
        case 'create_sheet': {
          const mimeType = MIME_MAP[action];
          const file = await service.createFile(name, mimeType, content, parentFolderId);
          return {
            output: `${action === 'create_doc' ? 'Google Doc' : 'Google Sheet'} created!\n\n` +
              `- **Name**: ${file.name}\n` +
              `- **ID**: ${file.id}\n` +
              `- **Link**: ${file.webViewLink ?? 'N/A'}\n`,
          };
        }

        case 'create_folder': {
          const folder = await service.createFolder(name, parentFolderId);
          return {
            output: `Folder created!\n\n` +
              `- **Name**: ${folder.name}\n` +
              `- **ID**: ${folder.id}\n` +
              `- **Link**: ${folder.webViewLink ?? 'N/A'}\n`,
          };
        }

        case 'upload': {
          const file = await service.createFile(name, 'text/plain', content, parentFolderId);
          return {
            output: `File uploaded!\n\n` +
              `- **Name**: ${file.name}\n` +
              `- **ID**: ${file.id}\n` +
              `- **Link**: ${file.webViewLink ?? 'N/A'}\n`,
          };
        }

        case 'update': {
          if (!fileId) return { output: '', error: 'File ID is required for update action.' };
          if (!content) return { output: '', error: 'Content is required for update action.' };
          const file = await service.updateFileContent(fileId, content);
          return {
            output: `File updated!\n\n` +
              `- **Name**: ${file.name}\n` +
              `- **ID**: ${file.id}\n` +
              `- **Modified**: ${file.modifiedTime}\n`,
          };
        }

        default:
          return { output: '', error: `Unknown action: ${action}` };
      }
    } catch (err: any) {
      return { output: '', error: `Drive operation failed: ${err.message}` };
    }
  },
};
