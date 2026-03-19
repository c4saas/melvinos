import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { getGoogleService } from './google-service-helper';
import { saveToWorkspace, timestampedName } from './workspace-save';

const NOT_CONNECTED = 'Gmail is not connected. Connect Google in Settings > Integrations.';

// ── Read Email ──────────────────────────────────────────────────────────────

export const gmailReadTool: ToolDefinition = {
  name: 'gmail_read',
  description:
    'Read the full content of a specific email message. Use gmail_search first to find message IDs, then use this tool to read the full email body.',
  parameters: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'The Gmail message ID to read (from gmail_search results).',
      },
    },
    required: ['message_id'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const messageId = String(args.message_id ?? '').trim();
    if (!messageId) return { output: '', error: 'Message ID is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;

    try {
      const email = await service.getEmail(messageId);
      const output = `**From**: ${email.from}\n**To**: ${email.to}\n**Subject**: ${email.subject}\n**Date**: ${email.date}\n\n---\n\n${email.body || email.snippet || '(No content)'}`;

      // Save to workspace
      const subjectSlug = (email.subject || 'email').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`email-${subjectSlug}`, 'md');
      await saveToWorkspace(context.workspacePath, 'email', fileName, `# ${email.subject || 'Email'}\n\n${output}`);

      return { output };
    } catch (err: any) {
      return { output: '', error: `Failed to read email: ${err.message}` };
    }
  },
};

// ── Send Email ──────────────────────────────────────────────────────────────

export const gmailSendTool: ToolDefinition = {
  name: 'gmail_send',
  description:
    'Send an email via Gmail. Can send a new email or reply to an existing thread. ' +
    'Use when the user asks to send, reply, compose, or forward an email. ' +
    'Supports HTML body (set html=true for styled emails with inline CSS), CC/BCC, and threading. ' +
    'DO NOT use for drafts. DO NOT use for reading emails (use gmail_read instead). ' +
    'Example: gmail_send({ to: "user@example.com", subject: "Follow up", body: "<h2>Hello</h2><p>Details here</p>", html: true })',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated for multiple.',
      },
      subject: {
        type: 'string',
        description: 'Email subject line.',
      },
      body: {
        type: 'string',
        description: 'Email body text. When html=true, include valid HTML with inline styles.',
      },
      html: {
        type: 'boolean',
        description: 'Set to true to send the body as an HTML email instead of plain text. Default: false.',
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated.',
      },
      bcc: {
        type: 'string',
        description: 'BCC recipients, comma-separated.',
      },
      reply_to_message_id: {
        type: 'string',
        description: 'Message ID to reply to (makes this a reply in an existing thread).',
      },
      thread_id: {
        type: 'string',
        description: 'Thread ID to add this message to (for replies).',
      },
      account: {
        type: 'string',
        description: 'Which Google account to send from (e.g. "Work", "Personal"). Defaults to primary account.',
      },
    },
    required: ['to', 'subject', 'body'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const to = String(args.to ?? '').trim();
    const subject = String(args.subject ?? '').trim();
    const body = String(args.body ?? '');
    const cc = args.cc ? String(args.cc) : undefined;
    const bcc = args.bcc ? String(args.bcc) : undefined;
    const isHtml = Boolean(args.html);
    const replyToMessageId = args.reply_to_message_id ? String(args.reply_to_message_id) : undefined;
    const threadId = args.thread_id ? String(args.thread_id) : undefined;
    const accountLabel = args.account ? String(args.account) : undefined;

    if (!to) return { output: '', error: 'Recipient (to) is required.' };
    if (!subject) return { output: '', error: 'Subject is required.' };
    if (!body.trim()) return { output: '', error: 'Email body is required.' };

    const acc = getGoogleService(context, accountLabel);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { label: fromAccount, service } = acc;

    try {
      const result = await service.sendEmail(to, subject, body, { cc, bcc, replyToMessageId, threadId, html: isHtml });
      return {
        output: `Email sent successfully from **${fromAccount}**!\n\n` +
          `- **To**: ${to}\n` +
          `- **Subject**: ${subject}\n` +
          `- **Message ID**: ${result.id}\n` +
          (replyToMessageId ? `- **Reply to thread**: ${result.threadId}\n` : ''),
      };
    } catch (err: any) {
      return { output: '', error: `Failed to send email: ${err.message}` };
    }
  },
};

// ── Modify Email ────────────────────────────────────────────────────────────

export const gmailModifyTool: ToolDefinition = {
  name: 'gmail_modify',
  description:
    'Manage Gmail messages: archive, trash, mark as read/unread, or add/remove labels. Use gmail_search first to find message IDs.',
  parameters: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'The Gmail message ID to modify.',
      },
      action: {
        type: 'string',
        enum: ['archive', 'trash', 'mark_read', 'mark_unread', 'add_label', 'remove_label'],
        description: 'The action to perform on the message.',
      },
      label: {
        type: 'string',
        description: 'Label name for add_label/remove_label actions (e.g., "STARRED", "IMPORTANT", or a custom label).',
      },
    },
    required: ['message_id', 'action'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const messageId = String(args.message_id ?? '').trim();
    const action = String(args.action ?? '');
    const label = args.label ? String(args.label) : undefined;

    if (!messageId) return { output: '', error: 'Message ID is required.' };
    if (!action) return { output: '', error: 'Action is required.' };

    const acc = getGoogleService(context);
    if (!acc) return { output: '', error: NOT_CONNECTED };
    const { service } = acc;

    try {
      switch (action) {
        case 'archive':
          await service.modifyEmail(messageId, [], ['INBOX']);
          return { output: `Email archived (removed from Inbox).` };

        case 'trash':
          await service.trashEmail(messageId);
          return { output: `Email moved to Trash.` };

        case 'mark_read':
          await service.modifyEmail(messageId, [], ['UNREAD']);
          return { output: `Email marked as read.` };

        case 'mark_unread':
          await service.modifyEmail(messageId, ['UNREAD'], []);
          return { output: `Email marked as unread.` };

        case 'add_label':
          if (!label) return { output: '', error: 'Label name is required for add_label action.' };
          await service.modifyEmail(messageId, [label], []);
          return { output: `Label "${label}" added to email.` };

        case 'remove_label':
          if (!label) return { output: '', error: 'Label name is required for remove_label action.' };
          await service.modifyEmail(messageId, [], [label]);
          return { output: `Label "${label}" removed from email.` };

        default:
          return { output: '', error: `Unknown action: ${action}` };
      }
    } catch (err: any) {
      return { output: '', error: `Failed to modify email: ${err.message}` };
    }
  },
};
