import { readFile, writeFile } from 'fs/promises';
import { resolve, relative } from 'path';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

function safePath(workspacePath: string, filePath: string): string {
  const resolved = resolve(workspacePath, filePath);
  if (!resolved.startsWith(resolve(workspacePath))) {
    throw new Error('Path traversal outside workspace is not allowed');
  }
  return resolved;
}

export const fileEditTool: ToolDefinition = {
  name: 'file_edit',
  description:
    'Edit an existing file by replacing a specific text fragment with new text. Use this for targeted modifications instead of rewriting entire files. The old_text must match exactly (including whitespace and indentation).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file within the workspace',
      },
      old_text: {
        type: 'string',
        description: 'The exact text to find and replace (must match uniquely in the file)',
      },
      new_text: {
        type: 'string',
        description: 'The replacement text',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences instead of just the first (default: false)',
        default: false,
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = String(args.path ?? '');
    const oldText = String(args.old_text ?? '');
    const newText = String(args.new_text ?? '');
    const replaceAll = Boolean(args.replace_all ?? false);

    if (!filePath.trim()) {
      return { output: '', error: 'File path cannot be empty' };
    }
    if (!oldText) {
      return { output: '', error: 'old_text cannot be empty' };
    }
    if (oldText === newText) {
      return { output: '', error: 'old_text and new_text are identical' };
    }

    try {
      const fullPath = safePath(context.workspacePath, filePath);
      const content = await readFile(fullPath, 'utf-8');

      const occurrences = content.split(oldText).length - 1;
      if (occurrences === 0) {
        return { output: '', error: 'old_text not found in file' };
      }
      if (!replaceAll && occurrences > 1) {
        return {
          output: '',
          error: `old_text found ${occurrences} times. Provide more context to make it unique, or set replace_all: true`,
        };
      }

      const updated = replaceAll
        ? content.split(oldText).join(newText)
        : content.replace(oldText, newText);

      await writeFile(fullPath, updated, 'utf-8');
      const relPath = relative(context.workspacePath, fullPath);
      const replacedCount = replaceAll ? occurrences : 1;

      return {
        output: `Edited ${relPath}: replaced ${replacedCount} occurrence${replacedCount > 1 ? 's' : ''}`,
        artifacts: [{ type: 'file', name: relPath, path: relPath, mimeType: 'text/plain' }],
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { output: '', error: `File not found: ${filePath}` };
      }
      return { output: '', error: err.message };
    }
  },
};
