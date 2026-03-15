import type { IStorage } from '../../storage';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { buildOutputTemplateInstruction } from '../../output-template-utils';

let storageRef: IStorage | null = null;

export function setOutputTemplateStorage(storage: IStorage): void {
  storageRef = storage;
}

export const listOutputTemplatesTool: ToolDefinition = {
  name: 'list_output_templates',
  description:
    'List all available output templates by name and category. When the user asks you to use a specific template (e.g. "use the morning brief template", "format this as the daily email"), call this tool first to find the matching template, then format your response according to its instructions. Returns template names, categories, and the full formatting instructions to apply.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(_args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!storageRef) {
      return { output: 'Template storage not initialized' };
    }

    try {
      const templates = await storageRef.listOutputTemplates();
      const active = templates.filter((t) => t.isActive);

      if (active.length === 0) {
        return { output: 'No output templates are currently configured. Ask the user to create templates in Settings → Output Templates.' };
      }

      const list = active.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        format: t.format,
        instructions: buildOutputTemplateInstruction(t),
      }));

      return {
        output: `Found ${list.length} output template(s). To apply one, format your response according to its instructions field.\n\n` +
          list.map((t) => `---\nID: ${t.id}\nName: ${t.name}\nCategory: ${t.category}\nFormat: ${t.format}\n\nInstructions:\n${t.instructions}`).join('\n\n'),
      };
    } catch (err) {
      return { output: `Failed to load output templates: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
