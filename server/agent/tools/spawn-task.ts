import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { enqueueTask } from '../task-queue';

/**
 * Allows the agent to spawn a background autonomous task.
 * The task will run asynchronously via the task queue and can continue
 * working even after the current conversation turn ends — enabling true
 * 24/7 autonomous operation.
 */
export const spawnTaskTool: ToolDefinition = {
  name: 'spawn_task',
  description:
    'Spawn a background autonomous task that runs independently of this conversation. Use this when you need to schedule follow-up work, run long operations asynchronously, or decompose a large task into parallel subtasks. The spawned task runs via the agent task queue and will report results to a conversation you specify.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short descriptive title for the task (e.g. "Monitor inbox for reply", "Daily calendar summary")',
      },
      prompt: {
        type: 'string',
        description: 'The full instructions for the autonomous task. Be specific — this is what the background agent will act on.',
      },
      chat_id: {
        type: 'string',
        description:
          'Optional conversation ID to post results to. If omitted, the current conversation is used. Results will appear as an agent message in that chat.',
      },
    },
    required: ['title', 'prompt'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const title = String(args.title ?? '').trim();
    const prompt = String(args.prompt ?? '').trim();
    const chatId = args.chat_id ? String(args.chat_id) : context.conversationId;

    if (!title) return { output: '', error: 'title is required' };
    if (!prompt) return { output: '', error: 'prompt is required' };

    try {
      const task = await enqueueTask(
        'agent_autonomous',
        title,
        { prompt, userId: context.userId, chatId },
        chatId,
      );

      return {
        output: `Task spawned successfully. Task ID: ${task.id}\nTitle: "${title}"\nThe agent will run this task in the background and post results to the conversation.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: '', error: `Failed to spawn task: ${message}` };
    }
  },
};
