/**
 * Heartbeat Prompt Builder & Agent Runner
 *
 * Builds the heartbeat scan prompt from config, runs Melvin's agent loop
 * with full tool access, persists messages, and delivers results.
 * Follows the same pattern as telegram-bot.ts.
 */
import type { IStorage } from '../storage';
import type { HeartbeatSettings } from '@shared/schema';
import { assembleRequest } from '../prompt-engine';
import { runAgentLoop, createFallbackAwareProvider } from '../agent';
import { getDefaultModel, getModelTemperature } from '../ai-models';
import { sendHeartbeatMessage } from '../telegram-bot';
import { toolRegistry } from '../agent/tool-registry';
import { buildTimezoneInstruction } from '../timezone-context';

const HEARTBEAT_CHAT_TITLE = '[Heartbeat] Executive Scan';

export async function runHeartbeatCycle(
  storage: IStorage,
  config: HeartbeatSettings,
): Promise<string> {
  // 1. Resolve Melvin user (first super_admin — same as Telegram bot)
  const users = await storage.listUsers();
  const melvinUser = users.find((u) => u.role === 'super_admin') ?? users[0];
  if (!melvinUser) {
    console.warn('[heartbeat] No user found, skipping cycle.');
    return '';
  }

  // 2. Find or create dedicated heartbeat conversation (continues from last session)
  const userChats = await storage.getUserChats(melvinUser.id);
  let chat = userChats.find((c) => c.title === HEARTBEAT_CHAT_TITLE);

  // Load platform settings once — reused throughout this function
  const platformSettings = await storage.getPlatformSettings();
  const platformDefault = (platformSettings.data as any)?.defaultModel as string | undefined;
  const model = config.model || platformDefault || getDefaultModel();
  if (!chat) {
    chat = await storage.createChat({
      userId: melvinUser.id,
      title: HEARTBEAT_CHAT_TITLE,
      model,
    });
  }

  // 3. Load user timezone + location for date/time grounding
  const userPreferences = await storage.getUserPreferences(melvinUser.id);
  const userTimezone = (userPreferences as any)?.timezone as string | undefined || 'America/Chicago';
  const userLocation = (userPreferences as any)?.location as string | undefined || '';

  // 3. Build the heartbeat system prompt overlay (with injected date/time)
  const heartbeatPrompt = buildHeartbeatPrompt(config, userTimezone, userLocation);

  // 4. Persist the trigger message
  await storage.createMessage({
    chatId: chat.id,
    role: 'user',
    content: '⏱️ Heartbeat tick. Continue any active work in progress, then run your scheduled checks.',
    metadata: { source: 'heartbeat', automated: true },
  });

  // 5. Load chat history for context (continues from last session)
  const allMessages = await storage.getChatMessages(chat.id);
  const historyMessages = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // 6. Assemble prompt (adds system prompt layers + heartbeat overlay)
  const assembled = await assembleRequest({
    systemPrompt: heartbeatPrompt,
    messages: historyMessages,
    storage,
  });

  // 7. Create LLM provider (with fallback)
  const fallbackModel = (platformSettings.data as any)?.fallbackModel as string | null;
  const llmProvider = createFallbackAwareProvider(storage, model, fallbackModel);

  // 8. Resolve platform-level enabled tools (full tool access)
  const platformEnabledTools = (platformSettings.data as any)?.enabledAgentTools as string[] | undefined;
  const enabledTools = platformEnabledTools?.length ? platformEnabledTools : undefined;

  // 8b. Inject platform settings and OAuth tokens into tool context (mirrors routes.ts)
  const extraToolContext: Record<string, any> = {};

  // Provide saveFile so tools can cache external media locally
  extraToolContext.saveFile = async (buffer: Buffer, name: string, mimeType: string): Promise<string> => {
    const attachment = await storage.saveFile(melvinUser.id, buffer, name, mimeType);
    return attachment.url;
  };

  try {
    const settingsData = platformSettings?.data as Record<string, any> | undefined;
    if (settingsData) {
      extraToolContext.platformSettings = settingsData;
    }
  } catch { /* ignore */ }

  try {
    const googleToken = await storage.getOAuthToken(melvinUser.id, 'google');
    if (googleToken) {
      extraToolContext.googleAccessToken = googleToken.accessToken;
      if (googleToken.refreshToken) extraToolContext.googleRefreshToken = googleToken.refreshToken;
    }
    const googleSettings = (platformSettings.data as any)?.integrations?.google;
    if (googleSettings?.enabled && googleSettings?.clientId && googleSettings?.clientSecret) {
      extraToolContext.googleClientId = googleSettings.clientId;
      extraToolContext.googleClientSecret = googleSettings.clientSecret;
    }
    // Persist refreshed tokens back to storage so they survive across sessions
    extraToolContext.updateGoogleTokens = async (accessToken: string, refreshToken?: string | null, expiryDate?: number | null) => {
      await storage.updateOAuthToken(melvinUser.id, 'google', {
        accessToken,
        ...(refreshToken != null && { refreshToken }),
        ...(expiryDate != null && { tokenExpiry: new Date(expiryDate) }),
      });
    };
  } catch (tokenErr) {
    console.error('[heartbeat] Failed to load Google OAuth tokens:', tokenErr);
  }

  try {
    const recallSettings = (platformSettings.data as any)?.integrations?.recall;
    if (recallSettings?.enabled && recallSettings?.apiKey) {
      extraToolContext.recallApiKey = recallSettings.apiKey;
      extraToolContext.recallRegion = recallSettings.region || 'us-west-2';
    }
  } catch (recallErr) {
    console.error('[heartbeat] Failed to load Recall settings:', recallErr);
  }

  // 9. Run agent loop
  const agentMessages = assembled.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));

  let fullResponse = '';
  let agentUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  for await (const event of runAgentLoop(
    {
      model,
      maxIterations: 20,
      userId: melvinUser.id,
      conversationId: chat.id,
      temperature: getModelTemperature(model),
      maxTokens: 4000,
    },
    agentMessages,
    llmProvider,
    enabledTools,
    extraToolContext,
  )) {
    switch (event.type) {
      case 'text_delta':
        fullResponse += event.text;
        break;
      case 'done':
        fullResponse = event.content || fullResponse;
        agentUsage = event.usage;
        break;
      case 'error':
        fullResponse += `\n\nError: ${event.message}`;
        break;
    }
  }

  const finalText = fullResponse.trim() || config.quietResponse;

  // 10. Persist assistant response
  await storage.createMessage({
    chatId: chat.id,
    role: 'assistant',
    content: finalText,
    metadata: { source: 'heartbeat', model },
  });

  // 10b. Track token usage
  if (agentUsage) {
    try {
      await storage.createUsageMetric({
        userId: melvinUser.id,
        chatId: chat.id,
        model,
        promptTokens: agentUsage.promptTokens,
        completionTokens: agentUsage.completionTokens,
        totalTokens: agentUsage.totalTokens,
      });
    } catch (metricErr) {
      console.error('[heartbeat] Failed to create usage metric:', metricErr);
    }
  }

  // 11. Deliver via configured channel
  if (config.deliveryChannel === 'telegram') {
    await sendHeartbeatMessage(storage, finalText);
  } else if (config.deliveryChannel === 'sms') {
    await sendHeartbeatSms(config, finalText);
  }
  // 'in_app' — messages are already in the heartbeat conversation, visible in chat sidebar

  return finalText;
}

function buildHeartbeatPrompt(config: HeartbeatSettings, timezone = 'America/Chicago', location = ''): string {
  const enabledItems = config.scanItems.filter((i) => i.enabled);
  const lines: string[] = [];

  lines.push(buildTimezoneInstruction(timezone, location || undefined));
  lines.push('');
  lines.push('## Heartbeat Agent Protocol');
  lines.push('');
  lines.push('This is an automated keepalive tick. Your job has two phases — work through them in order:');
  lines.push('');
  lines.push('### Phase 1: Continue Active Work');
  lines.push('Review this conversation history. If there is an ongoing task or incomplete work from a previous tick:');
  lines.push('- Pick up exactly where you left off');
  lines.push('- Run the next step using your available tools');
  lines.push('- Provide a brief status update on progress (1-2 sentences)');
  lines.push('- If the task is complete, summarize what was accomplished');
  lines.push('');
  lines.push('### Phase 2: Scheduled Checks');
  lines.push('If there is no active work to continue, or after completing Phase 1, run the configured checks below.');
  lines.push('Use your tools (web search, shell, memory, calendar, etc.) to gather real data — never guess.');
  lines.push('');
  lines.push('### Self-Healing');
  lines.push('If you detect a real, reproducible bug in the MelvinOS codebase (/opt/melvinos), you may propose a fix using the `propose_patch` tool.');
  lines.push('Rules:');
  lines.push('- Only propose patches for confirmed bugs you have diagnosed — not guesses or cosmetic changes.');
  lines.push('- Read the relevant source files first to understand exactly what to change.');
  lines.push('- Write a precise `claude_prompt` that Claude Code can execute to apply the fix correctly.');
  lines.push('- Each patch goes to Austin for approval via SMS before anything is changed.');
  lines.push('');

  if (config.constraints.length > 0) {
    lines.push('### Constraints');
    for (const c of config.constraints) {
      lines.push(`- ${c.text}`);
    }
    lines.push('');
  }

  if (enabledItems.length > 0) {
    lines.push('### Scan Checklist');
    lines.push('Run these in order. Only report on sections listed here — do NOT include results for any section not in this list, even if previous responses covered them:');
    lines.push('');
    for (let i = 0; i < enabledItems.length; i++) {
      const item = enabledItems[i];
      lines.push(`**${String.fromCharCode(65 + i)}) ${item.label}**`);
      lines.push(item.description);
      lines.push('');
    }
  }

  const isSms = config.deliveryChannel === 'sms';

  lines.push('### Output Format');
  lines.push('Plain text only — NO markdown, NO asterisks, NO hashtags, NO bullet dashes.');
  if (isSms) {
    lines.push('');
    lines.push('**SMS MODE — keep the ENTIRE response under 160 characters.**');
    lines.push('Use exactly one of these formats:');
    lines.push('- Active work in progress: "Working: [what you\'re doing]"');
    lines.push('- Continuing from last tick: "Continuing: [brief status]"');
    lines.push('- All checks done, nothing urgent: "Heartbeat OK"');
    lines.push('- Something needs attention: "Alert: [one sentence]"');
    lines.push('Do not enumerate sections. Do not add explanations. One line only.');
  } else {
    lines.push('For active work: start with "WORKING: [brief status]"');
    lines.push('For scan results: use "SECTION:" labels followed by 1-2 sentences each.');
  }
  lines.push('');
  lines.push('### NEXT TICK Directive (required — always the last line)');
  lines.push('End every response with a NEXT TICK directive that tells the scheduler when to run next.');
  lines.push('Format: NEXT TICK: [number] [minutes|hours|seconds] — [reason]');
  lines.push('Rules:');
  lines.push('- Mid-task with more work to do immediately → "NEXT TICK: 1 minute — continuing [task]"');
  lines.push('- Awaiting a reply or short-horizon event → "NEXT TICK: 15 minutes — checking reply from [name]"');
  lines.push('- Work complete, nothing urgent → "NEXT TICK: 60 minutes — scheduled scan"');
  lines.push('- Long pause (overnight, weekend) → "NEXT TICK: 8 hours — resuming morning scan"');
  lines.push('The scheduler reads this directive literally to set the next interval — use real numbers and units.');
  lines.push(`If there is nothing to report and no active work, respond with: "${config.quietResponse}" then NEXT TICK.`);

  return lines.join('\n');
}

/**
 * Send heartbeat result via GHL SMS through the MCP tool.
 * SMS has a 1600 char limit per segment — truncate if needed.
 */
async function sendHeartbeatSms(config: HeartbeatSettings, text: string): Promise<void> {
  const { contactId, fromNumber, mcpServerId } = config.smsConfig;
  if (!contactId || !mcpServerId) {
    console.warn('[heartbeat] SMS delivery skipped — missing contactId or mcpServerId');
    return;
  }

  // MCP tools are registered as mcp_{serverId}_{toolName}
  const toolName = `mcp_${mcpServerId}_conversations_send-a-new-message`;

  if (!toolRegistry.has(toolName)) {
    console.error(`[heartbeat] SMS tool "${toolName}" not found in registry. Is the GHL MCP server connected?`);
    return;
  }

  // Strip NEXT TICK directive (scheduler metadata, not useful in SMS)
  const withoutNextTick = text.replace(/\n?NEXT TICK:.*$/i, '').trim();

  // Strip any residual markdown and truncate to SMS-friendly length
  const plain = withoutNextTick
    .replace(/#{1,6}\s*/g, '')           // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')   // underscore bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // code
    .replace(/^\s*[-*+]\s+/gm, '• ')     // bullets → •
    .replace(/\n{3,}/g, '\n\n')          // collapse excess newlines
    .trim();
  const smsText = plain.length > 320
    ? plain.slice(0, 317) + '...'
    : plain;

  try {
    const args: Record<string, unknown> = {
      body_type: 'SMS',
      body_contactId: contactId,
      body_message: smsText,
    };
    if (fromNumber) {
      args.body_fromNumber = fromNumber;
    }

    const result = await toolRegistry.execute(toolName, args, {
      userId: 'system',
      conversationId: null,
      model: '',
      workspacePath: process.env.AGENT_WORKSPACE_PATH || '/app/workspace',
    });

    if (result.error) {
      console.error('[heartbeat] SMS delivery failed:', result.error);
    } else {
      console.log('[heartbeat] SMS delivered successfully');
    }
  } catch (err) {
    console.error('[heartbeat] SMS delivery error:', err instanceof Error ? err.message : err);
  }
}
