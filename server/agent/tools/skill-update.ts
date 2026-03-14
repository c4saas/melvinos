/**
 * skill_update tool — lets Melvin create, update, delete, and list its own
 * prompt-injection skills in platform settings. Enables genuine self-modification
 * of behavior across future conversations.
 */

import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import type { IStorage } from '../../storage';

let storageRef: IStorage | null = null;

export function setSkillStorage(storage: IStorage): void {
  storageRef = storage;
}

const VALID_CATEGORIES = ['productivity', 'research', 'coding', 'communication', 'memory', 'general'];

export const skillUpdateTool: ToolDefinition = {
  name: 'skill_update',
  description:
    'Create, update, delete, or list your own prompt-injection skills. Skills are instruction sets ' +
    'injected into your system prompt on every conversation, letting you build and refine new capabilities. ' +
    'Use this to encode procedures you want to follow automatically in future conversations.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update', 'delete', 'list'],
        description: 'Action to perform: list all skills, create a new one, update an existing one, or delete one.',
      },
      skill_id: {
        type: 'string',
        description: 'Skill ID — required for update and delete.',
      },
      name: {
        type: 'string',
        description: 'Human-readable skill name — required for create.',
      },
      description: {
        type: 'string',
        description: 'One-sentence description of what this skill does — required for create.',
      },
      instructions: {
        type: 'string',
        description:
          'Full instructions injected into the system prompt when this skill is active. ' +
          'Write in second person ("When asked about X, you should..."). Required for create.',
      },
      category: {
        type: 'string',
        enum: ['productivity', 'research', 'coding', 'communication', 'memory', 'general'],
        description: 'Skill category — optional, defaults to general.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether to activate this skill immediately — optional, defaults to true.',
      },
    },
    required: ['action'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!storageRef) {
      return { output: '', error: 'Skill storage not initialized' };
    }

    const action = String(args.action ?? '');

    let settings: any;
    try {
      settings = await storageRef.getPlatformSettings();
    } catch (err: any) {
      return { output: '', error: `Failed to load platform settings: ${err.message}` };
    }

    const data = settings.data as Record<string, any>;
    const allSkills: any[] = Array.isArray(data.skills) ? [...data.skills] : [];
    // Only expose/manage prompt-injection skills created by this tool
    const mySkills = allSkills.filter((s) => s.type === 'prompt-injection' && !s.isPlatformDefault);

    switch (action) {
      case 'list': {
        if (mySkills.length === 0) {
          return { output: 'No custom skills defined yet. Use action "create" to add one.' };
        }
        const lines = mySkills.map(
          (s) =>
            `• **${s.name}** \`${s.id}\` [${s.enabled ? 'enabled' : 'disabled'}] — ${s.description}`,
        );
        return { output: `Custom skills (${mySkills.length}):\n\n${lines.join('\n')}` };
      }

      case 'create': {
        const name = String(args.name ?? '').trim();
        const description = String(args.description ?? '').trim();
        const instructions = String(args.instructions ?? '').trim();

        if (!name) return { output: '', error: 'name is required for create' };
        if (!description) return { output: '', error: 'description is required for create' };
        if (!instructions) return { output: '', error: 'instructions is required for create' };

        const category = VALID_CATEGORIES.includes(String(args.category ?? ''))
          ? String(args.category)
          : 'general';

        const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newSkill = {
          id,
          name,
          description,
          instructions,
          category,
          enabled: args.enabled !== false,
          isPlatformDefault: false,
          requiresIntegration: null,
          linkedTools: [],
          type: 'prompt-injection',
        };

        const updatedSkills = [...allSkills, newSkill];
        await storageRef.upsertPlatformSettings({ ...data, skills: updatedSkills }, 'skill_update_tool');

        return {
          output: `Created skill "${name}" (id: \`${id}\`). It will be injected into all future conversations automatically.`,
        };
      }

      case 'update': {
        const skillId = String(args.skill_id ?? '').trim();
        if (!skillId) return { output: '', error: 'skill_id is required for update' };

        const idx = allSkills.findIndex((s) => s.id === skillId);
        if (idx === -1) return { output: '', error: `Skill "${skillId}" not found` };

        const skill = { ...allSkills[idx] };
        if (args.name !== undefined) skill.name = String(args.name).trim();
        if (args.description !== undefined) skill.description = String(args.description).trim();
        if (args.instructions !== undefined) skill.instructions = String(args.instructions).trim();
        if (args.category !== undefined && VALID_CATEGORIES.includes(String(args.category))) {
          skill.category = String(args.category);
        }
        if (args.enabled !== undefined) skill.enabled = Boolean(args.enabled);

        allSkills[idx] = skill;
        await storageRef.upsertPlatformSettings({ ...data, skills: allSkills }, 'skill_update_tool');

        return { output: `Updated skill "${skill.name}" (id: \`${skillId}\`).` };
      }

      case 'delete': {
        const skillId = String(args.skill_id ?? '').trim();
        if (!skillId) return { output: '', error: 'skill_id is required for delete' };

        const before = allSkills.length;
        const filtered = allSkills.filter((s) => s.id !== skillId);
        if (filtered.length === before) return { output: '', error: `Skill "${skillId}" not found` };

        await storageRef.upsertPlatformSettings({ ...data, skills: filtered }, 'skill_update_tool');
        return { output: `Deleted skill \`${skillId}\`.` };
      }

      default:
        return { output: '', error: `Unknown action: ${action}` };
    }
  },
};
