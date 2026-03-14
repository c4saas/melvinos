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

  // Use heartbeat-specific model, then platform default, then fallback
  const earlySettings = await storage.getPlatformSettings();
  const platformDefault = (earlySettings.data as any)?.defaultModel as string | undefined;
  const model = config.model || platformDefault || getDefaultModel();
  if (!chat) {
    chat = await storage.createChat({
      userId: melvinUser.id,
      title: HEARTBEAT_CHAT_TITLE,
      model,
    });
  }

  // 3. Build the heartbeat system prompt overlay
  const heartbeatPrompt = buildHeartbeatPrompt(config);

  // 4. Persist the trigger message
  await storage.createMessage({
    chatId: chat.id,
    role: 'user',
    content: 'Run the heartbeat scan now.',
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
  const platformSettings = await storage.getPlatformSettings();
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

function buildHeartbeatPrompt(config: HeartbeatSettings): string {
  const enabledItems = config.scanItems.filter((i) => i.enabled);
  const lines: string[] = [];

  lines.push('## Heartbeat Executive Scan Protocol');
  lines.push('');
  lines.push('You are running a periodic heartbeat scan. Check the areas below and produce a brief, structured status report.');
  lines.push('Use your available tools (web search, shell, file read, memory, etc.) to gather real data.');
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
    lines.push('Run these in order:');
    lines.push('');
    for (let i = 0; i < enabledItems.length; i++) {
      const item = enabledItems[i];
      lines.push(`**${String.fromCharCode(65 + i)}) ${item.label}**`);
      lines.push(item.description);
      lines.push('');
    }
  }

  lines.push('### Output Format');
  lines.push('Provide a concise status for each checked area. Use plain text only — NO markdown, NO asterisks, NO hashtags, NO bullet dashes. Use simple labels like "SECTION:" followed by 1-2 sentences. Keep it readable as a plain SMS or chat message.');
  lines.push(`If there is nothing material to report across all areas, respond with exactly: "${config.quietResponse}"`);

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

  // Strip any residual markdown and truncate to SMS-friendly length
  const plain = text
    .replace(/#{1,6}\s*/g, '')           // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')   // underscore bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // code
    .replace(/^\s*[-*+]\s+/gm, '• ')     // bullets → •
    .replace(/\n{3,}/g, '\n\n')          // collapse excess newlines
    .trim();
  const smsText = plain.length > 1500
    ? plain.slice(0, 1497) + '...'
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
