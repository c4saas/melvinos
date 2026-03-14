import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { enqueueTask } from '../task-queue';

export const consolidateDataTool: ToolDefinition = {
  name: 'consolidate_data',
  description:
    'Read all data from Google Drive, Notion, Qdrant, PostgreSQL, Recall, and workspace files. Deduplicate, cluster by topic, consolidate via LLM, and write clean knowledge pages to Notion under "Cleansed Data". This is a long-running background task — you will be notified when it completes.',
  parameters: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Limit to specific sources (default: all). Options: qdrant, postgres, drive, notion, recall, workspace',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, run extraction + clustering + consolidation but skip writing to Notion. Useful for testing.',
      },
    },
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const sources = Array.isArray(args.sources) ? args.sources.map(String) : undefined;
    const dryRun = Boolean(args.dry_run);
    const chatId = context.conversationId;

    try {
      const task = await enqueueTask(
        'data_consolidation',
        'Data Consolidation Pipeline',
        {
          userId: context.userId,
          chatId,
          sources,
          dryRun,
        },
        chatId,
      );

      const sourceList = sources ? sources.join(', ') : 'all (qdrant, postgres, drive, notion, recall, workspace)';
      return {
        output: [
          `Data consolidation pipeline started.`,
          `Task ID: ${task.id}`,
          `Sources: ${sourceList}`,
          dryRun ? `Mode: DRY RUN (no Notion writes)` : `Output: Notion → "Cleansed Data"`,
          ``,
          `This is a long-running task. Progress will be tracked in the task queue.`,
        ].join('\n'),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: '', error: `Failed to start consolidation: ${message}` };
    }
  },
};
