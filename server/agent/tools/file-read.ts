import { readFile, stat } from 'fs/promises';
import { resolve, relative } from 'path';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

function safePath(workspacePath: string, filePath: string): string {
  const resolved = resolve(workspacePath, filePath);
  if (!resolved.startsWith(resolve(workspacePath))) {
    throw new Error('Path traversal outside workspace is not allowed');
  }
  return resolved;
}

export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description:
    'Read the contents of a file from the workspace. Use this to inspect files, read data, or review code. The path is relative to the workspace root.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file within the workspace',
      },
    },
    required: ['path'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = String(args.path ?? '');
    if (!filePath.trim()) {
      return { output: '', error: 'File path cannot be empty' };
    }

    try {
      const fullPath = safePath(context.workspacePath, filePath);
      const info = await stat(fullPath);

      if (!info.isFile()) {
        return { output: '', error: `"${filePath}" is not a file` };
      }

      if (info.size > MAX_FILE_SIZE) {
        return {
          output: '',
          error: `File is too large (${(info.size / 1024).toFixed(0)} KB). Max: ${MAX_FILE_SIZE / 1024} KB`,
        };
      }

      const content = await readFile(fullPath, 'utf-8');
      const relPath = relative(context.workspacePath, fullPath);

      return {
        output: `File: ${relPath} (${info.size} bytes)\n\n${content}`,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { output: '', error: `File not found: ${filePath}` };
      }
      return { output: '', error: err.message };
    }
  },
};
