import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export const thinkTool: ToolDefinition = {
  name: 'think',
  description:
    'Use this tool to reason through complex decisions, plan multi-step tasks, or analyze tradeoffs ' +
    'before taking action. Your thinking is internal and will not be shown to the user. ' +
    'Use when: planning a sequence of 3+ tool calls, making decisions with significant consequences, ' +
    'resolving ambiguous requests, or cross-referencing multiple tool results before acting. ' +
    'Do NOT use for simple lookups or direct answers.',
  parameters: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Your internal reasoning, analysis, or planning.',
      },
    },
    required: ['thought'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const thought = String(args.thought ?? '');
    return { output: thought };
  },
};
