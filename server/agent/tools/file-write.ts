import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, relative } from 'path';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

function safePath(workspacePath: string, filePath: string): string {
  const resolved = resolve(workspacePath, filePath);
  if (!resolved.startsWith(resolve(workspacePath))) {
    throw new Error('Path traversal outside workspace is not allowed');
  }
  return resolved;
}

export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description:
    'Write content to a file in the workspace. Creates parent directories if they do not exist. Use this to save code, data, configuration, or any generated output.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within the workspace where the file should be written',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = String(args.path ?? '');
    const content = String(args.content ?? '');

    if (!filePath.trim()) {
      return { output: '', error: 'File path cannot be empty' };
    }

    try {
      const fullPath = safePath(context.workspacePath, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');

      const relPath = relative(context.workspacePath, fullPath);
      const bytes = Buffer.byteLength(content, 'utf-8');

      return {
        output: `Wrote ${bytes} bytes to ${relPath}`,
        artifacts: [
          {
            type: 'file',
            name: relPath,
            path: relPath,
            mimeType: 'text/plain',
          },
        ],
      };
    } catch (err: any) {
      return { output: '', error: err.message };
    }
  },
};
