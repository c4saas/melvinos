import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { storage } from '../../storage/index';
import { scheduleNextRun } from '../../cron-scheduler';

// ── schedule_task ────────────────────────────────────────────────────────────

const scheduleTaskSchema = z.object({
  name: z.string().describe('Short descriptive name for this scheduled task'),
  cron: z.string().describe('5-field cron expression in server local time (e.g. "0 9 * * 1-5" = weekdays at 9am, "*/30 * * * *" = every 30 min)'),
  prompt: z.string().describe('The prompt/instruction to run on each trigger'),
  recurring: z.boolean().default(true).describe('true = repeat on every cron match; false = fire once then disable'),
  conversationId: z.string().optional().describe('Conversation ID to associate results with'),
});

export const scheduleTaskTool: ToolDefinition = {
  name: 'schedule_task',
  description: 'Schedule a recurring or one-shot task using a cron expression. The prompt will be executed by Melvin at the specified time(s). Use standard 5-field cron: minute hour day-of-month month day-of-week.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name for this job' },
      cron: { type: 'string', description: '5-field cron expression (e.g. "0 9 * * *" = 9am daily)' },
      prompt: { type: 'string', description: 'Prompt to execute at each trigger' },
      recurring: { type: 'boolean', description: 'true = repeating, false = one-shot', default: true },
      conversationId: { type: 'string', description: 'Conversation to attach to (optional)' },
    },
    required: ['name', 'cron', 'prompt'],
  },
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = scheduleTaskSchema.safeParse(input);
    if (!parsed.success) return { content: `Invalid input: ${parsed.error.message}`, isError: true };
    const { name, cron, prompt, recurring, conversationId } = parsed.data;

    const userId = context.userId;
    if (!userId) return { content: 'No user context.', isError: true };

    const job = await storage.createCronJob({
      userId,
      name,
      cronExpression: cron,
      prompt,
      recurring: recurring ?? true,
      enabled: true,
      conversationId: conversationId ?? null,
      nextRunAt: null,
    });

    await scheduleNextRun(storage, job.id);
    const updated = await storage.getCronJob(job.id);
    const nextStr = updated?.nextRunAt ? new Date(updated.nextRunAt).toLocaleString() : 'unknown';

    return {
      content: `Scheduled job **"${name}"** (id: \`${job.id}\`)\n- Cron: \`${cron}\`\n- Recurring: ${recurring ?? true}\n- Next run: ${nextStr}`,
    };
  },
};

// ── list_scheduled_tasks ─────────────────────────────────────────────────────

export const listScheduledTasksTool: ToolDefinition = {
  name: 'list_scheduled_tasks',
  description: 'List all scheduled cron jobs.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, context: ToolContext): Promise<ToolResult> {
    const userId = context.userId;
    if (!userId) return { content: 'No user context.', isError: true };

    const jobs = await storage.listCronJobs(userId);
    if (jobs.length === 0) return { content: 'No scheduled tasks.' };

    const lines = jobs.map(j => {
      const status = j.enabled ? '✅ active' : '⏸ disabled';
      const next = j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : 'N/A';
      const last = j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : 'never';
      return `- **${j.name}** (\`${j.id}\`) — ${status}\n  Cron: \`${j.cronExpression}\` | Next: ${next} | Last: ${last}`;
    });

    return { content: `**Scheduled Tasks (${jobs.length})**\n\n${lines.join('\n\n')}` };
  },
};

// ── delete_scheduled_task ────────────────────────────────────────────────────

const deleteScheduledTaskSchema = z.object({
  id: z.string().describe('Job ID to delete'),
});

export const deleteScheduledTaskTool: ToolDefinition = {
  name: 'delete_scheduled_task',
  description: 'Delete (cancel) a scheduled cron job by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Job ID returned by schedule_task or list_scheduled_tasks' },
    },
    required: ['id'],
  },
  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = deleteScheduledTaskSchema.safeParse(input);
    if (!parsed.success) return { content: `Invalid input: ${parsed.error.message}`, isError: true };

    const deleted = await storage.deleteCronJob(parsed.data.id);
    if (!deleted) return { content: `Job \`${parsed.data.id}\` not found.`, isError: true };
    return { content: `Scheduled task \`${parsed.data.id}\` deleted.` };
  },
};
