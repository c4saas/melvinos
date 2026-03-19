/**
 * propose_patch tool
 *
 * Melvin uses this to submit a code fix proposal for Austin's approval.
 * Stores the proposal in DB and sends an SMS with a short approval code.
 * Austin replies "APPROVE XXXXXX" or "REJECT XXXXXX" to act on it.
 */
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { storage } from '../../storage';
import { toolRegistry } from '../tool-registry';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/1/O/0
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function sendApprovalSms(text: string, platformSettings: Record<string, any>): Promise<void> {
  const hb = platformSettings?.heartbeat;
  const { contactId, fromNumber, mcpServerId } = hb?.smsConfig ?? {};
  if (!contactId || !mcpServerId) {
    console.warn('[propose_patch] SMS delivery skipped — missing contactId or mcpServerId in heartbeat smsConfig');
    return;
  }

  const toolName = `mcp_${mcpServerId}_conversations_send-a-new-message`;
  if (!toolRegistry.has(toolName)) {
    console.error(`[propose_patch] SMS tool "${toolName}" not found in registry`);
    return;
  }

  const args: Record<string, unknown> = {
    body_type: 'SMS',
    body_contactId: contactId,
    body_message: text,
  };
  if (fromNumber) args.body_fromNumber = fromNumber;

  const result = await toolRegistry.execute(toolName, args, {
    userId: 'system',
    conversationId: null,
    model: '',
  });

  if (result.error) {
    console.error('[propose_patch] SMS delivery failed:', result.error);
  }
}

export const proposePatchTool: ToolDefinition = {
  name: 'propose_patch',
  description:
    'Propose a code fix to be reviewed and approved by Austin. Stores the patch proposal in the database and sends an SMS with an approval code. Austin replies "APPROVE XXXXXX" or "REJECT XXXXXX" to act on it. Use this when you detect a real bug or issue in the MelvinOS codebase that you can fix.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short title of the fix (e.g. "Fix heartbeat date injection")',
      },
      description: {
        type: 'string',
        description: 'Plain-text explanation of the problem and how the fix addresses it. 2-4 sentences max.',
      },
      claude_prompt: {
        type: 'string',
        description:
          'The exact prompt to send to Claude Code to apply the fix. Must be precise: include file paths, what to change, and the desired outcome. Claude Code will run with workdir=/opt/melvinos.',
      },
      workdir: {
        type: 'string',
        description: 'Working directory for Claude Code (default: /opt/melvinos)',
      },
    },
    required: ['title', 'description', 'claude_prompt'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const title = String(args.title ?? '').trim();
    const description = String(args.description ?? '').trim();
    const claudePrompt = String(args.claude_prompt ?? '').trim();
    const workdir = String(args.workdir ?? '/opt/melvinos');

    if (!title || !description || !claudePrompt) {
      return { output: '', error: 'title, description, and claude_prompt are required' };
    }

    try {
      const code = generateCode();

      const proposal = await storage.createPatchProposal({
        code,
        title,
        description,
        claudePrompt,
        workdir,
      });

      // Send SMS notification
      const platformSettings = (context as any).platformSettings ?? {};
      const smsText =
        `PATCH ${code}: ${title}\n\n${description}\n\nReply APPROVE ${code} to apply or REJECT ${code} to dismiss.`;

      await sendApprovalSms(smsText, platformSettings);

      return {
        output: `Patch proposal created. Code: ${code}\nID: ${proposal.id}\nSMS sent to Austin for approval.\nTo apply: Austin replies "APPROVE ${code}"\nTo dismiss: Austin replies "REJECT ${code}"`,
      };
    } catch (err: any) {
      return { output: '', error: `Failed to create patch proposal: ${err.message}` };
    }
  },
};
