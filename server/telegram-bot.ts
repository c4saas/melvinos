/**
 * Telegram Bot Service for Melvin
 *
 * Uses grammY (long polling) to receive messages and routes them through the
 * existing agent loop. No public URL required.
 */
import { Bot } from 'grammy';
import type { IStorage } from './storage';
import { assembleRequest } from './prompt-engine';
import { runAgentLoop, createFallbackAwareProvider } from './agent';
import { getDefaultModel, getModelTemperature, getModelConfig } from './ai-models';
import { scheduleAutoMemory } from './agent/auto-memory';

// ── Module state ──────────────────────────────────────────────────────────────

let activeBotInstance: Bot | null = null;
let botStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
let botError: string | null = null;
let botUsername: string | null = null;
let activeToken: string | null = null;

// Prevent concurrent message handlers from racing
const processingChats = new Set<number>();

// ── Public API ────────────────────────────────────────────────────────────────

export function getTelegramBotStatus() {
  return { status: botStatus, error: botError, botUsername };
}

export async function stopTelegramBot() {
  if (activeBotInstance) {
    try {
      await activeBotInstance.stop();
    } catch {
      // swallow — may already be stopped
    }
    activeBotInstance = null;
  }
  activeToken = null;
  botUsername = null;
  botStatus = 'stopped';
  botError = null;
}

/**
 * Reads current settings and starts / stops the bot as needed.
 * Safe to call repeatedly — no-ops when nothing changed.
 */
export async function reconcileTelegramBot(storage: IStorage) {
  let settings;
  try {
    settings = await storage.getPlatformSettings();
  } catch {
    return; // settings not loaded yet — skip
  }

  const tg = (settings.data as any)?.integrations?.telegram;
  const enabled = tg?.enabled === true;
  const token = tg?.botToken as string | null;

  if (enabled && token) {
    // Already running with same token — no-op
    if (botStatus === 'running' && activeToken === token) return;

    // Token changed or first start — (re)start
    await stopTelegramBot();
    await startTelegramBot(storage, token, tg.allowedUserIds as string | null, tg.model as string | null);
  } else {
    // Disabled or no token — ensure stopped
    if (botStatus !== 'stopped') {
      await stopTelegramBot();
    }
  }
}

/**
 * Send a message from the heartbeat scheduler via the active Telegram bot.
 * Returns true if the message was sent to at least one user.
 */
export async function sendHeartbeatMessage(storage: IStorage, text: string): Promise<boolean> {
  if (!activeBotInstance || botStatus !== 'running') {
    console.warn('[telegram] Heartbeat delivery skipped — bot not running');
    return false;
  }

  let settings;
  try {
    settings = await storage.getPlatformSettings();
  } catch {
    return false;
  }

  const tg = (settings.data as any)?.integrations?.telegram;
  const allowedIds = parseAllowedIds(tg?.allowedUserIds ?? null);

  if (allowedIds.length === 0) {
    console.warn('[telegram] Heartbeat delivery skipped — no allowed user IDs');
    return false;
  }

  const chunks = splitForTelegram(text);
  let sent = false;

  for (const userId of allowedIds) {
    try {
      for (const chunk of chunks) {
        await activeBotInstance.api.sendMessage(
          userId,
          markdownToTelegramHtml(chunk),
          { parse_mode: 'HTML' },
        );
      }
      sent = true;
    } catch (err) {
      console.error(`[telegram] Failed to send heartbeat to user ${userId}:`, err);
    }
  }

  return sent;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function startTelegramBot(
  storage: IStorage,
  token: string,
  allowedUserIds: string | null,
  telegramModel: string | null,
) {
  botStatus = 'starting';
  botError = null;

  try {
    const bot = new Bot(token);

    // Validate token
    const me = await bot.api.getMe();
    botUsername = me.username ?? me.first_name;

    // Parse allowed users (empty = anyone)
    const allowedIds = parseAllowedIds(allowedUserIds);

    // Track cleared chats — when a user runs /clear, their next message starts fresh
    const clearedChats = new Map<number, number>();
    // Evict stale entries every 30 minutes (if user clears but never messages back)
    const CLEAR_TTL = 60 * 60 * 1000; // 1 hour
    setInterval(() => {
      const now = Date.now();
      for (const [chatId, ts] of clearedChats) {
        if (now - ts > CLEAR_TTL) clearedChats.delete(chatId);
      }
    }, 30 * 60 * 1000);

    // ── Slash commands ──────────────────────────────────────────────────────

    const commandList = [
      '/help — Show available commands',
      '/clear — Start a new conversation',
      '/model — Show current model',
      '/status — Bot status info',
    ].join('\n');

    bot.command('start', async (ctx) => {
      await ctx.reply(
        `Melvin is ready. Send me a message or use:\n\n${commandList}`,
      );
    });

    bot.command('help', async (ctx) => {
      await ctx.reply(`Available commands:\n\n${commandList}`);
    });

    bot.command('clear', async (ctx) => {
      clearedChats.set(ctx.chat.id, Date.now());
      await ctx.reply('Conversation cleared. Your next message will start a fresh session.');
    });

    bot.command('model', async (ctx) => {
      const currentModel = telegramModel || getDefaultModel();
      const modelConf = getModelConfig(currentModel);
      const thinkingStatus = modelConf?.supportsThinking ? 'Reasoning: supported' : 'Reasoning: not available';
      await ctx.reply(`Current model: ${currentModel}\n${thinkingStatus}`);
    });

    bot.command('status', async (ctx) => {
      const currentModel = telegramModel || getDefaultModel();
      await ctx.reply(
        `Bot: @${botUsername}\nStatus: ${botStatus}\nModel: ${currentModel}`,
      );
    });

    // ── Text message handler ────────────────────────────────────────────────

    bot.on('message:text', async (ctx) => {
      const telegramUserId = ctx.from.id;

      // Access control
      if (allowedIds.length > 0 && !allowedIds.includes(telegramUserId)) {
        await ctx.reply('⛔ You are not authorised to use this bot.');
        return;
      }

      // Prevent parallel handling for same Telegram chat
      if (processingChats.has(ctx.chat.id)) {
        await ctx.reply('⏳ Still working on your previous message…');
        return;
      }

      processingChats.add(ctx.chat.id);
      const forceNewChat = clearedChats.has(ctx.chat.id);
      if (forceNewChat) clearedChats.delete(ctx.chat.id);
      // Safety timeout: unlock chat after 5 minutes even if handleMessage hangs
      const PROCESSING_TIMEOUT = 5 * 60 * 1000;
      const safetyTimer = setTimeout(() => {
        if (processingChats.has(ctx.chat.id)) {
          processingChats.delete(ctx.chat.id);
          console.warn('[telegram] Safety timeout: unlocked chat', ctx.chat.id, 'after 5m');
        }
      }, PROCESSING_TIMEOUT);
      try {
        await handleMessage(storage, ctx, telegramModel, forceNewChat);
      } finally {
        clearTimeout(safetyTimer);
        processingChats.delete(ctx.chat.id);
      }
    });

    // Start long polling (runs in background)
    bot.start({
      onStart: () => {
        console.log(`[telegram] Bot @${botUsername} started (long polling)`);
      },
    });

    activeBotInstance = bot;
    activeToken = token;
    botStatus = 'running';
  } catch (err) {
    botError = err instanceof Error ? err.message : 'Failed to start bot';
    botStatus = 'error';
    console.error('[telegram] Start failed:', botError);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(storage: IStorage, ctx: any, telegramModel: string | null, forceNewChat = false) {
  const userText: string = ctx.message.text;
  const firstName: string = ctx.from.first_name || 'Telegram User';

  try {
    // 1. Resolve Melvin user (first super_admin)
    const users = await storage.listUsers();
    const melvinUser = users.find((u) => u.role === 'super_admin') ?? users[0];
    if (!melvinUser) {
      await ctx.reply('❌ No Melvin user found. Set up your account first.');
      return;
    }

    // 2. Find or create dedicated Telegram chat
    const chatTitle = `[Telegram] ${firstName}`;
    const userChats = await storage.getUserChats(melvinUser.id);
    let chat = forceNewChat ? undefined : userChats.find((c) => c.title === chatTitle);

    const defaultModel = telegramModel || getDefaultModel();
    if (!chat) {
      // Archive old chat by renaming it if it exists
      if (forceNewChat) {
        const oldChat = userChats.find((c) => c.title === chatTitle);
        if (oldChat) {
          await storage.updateChat(oldChat.id, { title: `${chatTitle} (archived ${new Date().toISOString().slice(0, 10)})` });
        }
      }
      chat = await storage.createChat({
        userId: melvinUser.id,
        title: chatTitle,
        model: defaultModel,
      });
    }

    // 3. Persist user message
    await storage.createMessage({
      chatId: chat.id,
      role: 'user',
      content: userText,
      metadata: { source: 'telegram', telegramUserId: ctx.from.id },
    });

    // 4. Load chat history for context
    const allMessages = await storage.getChatMessages(chat.id);
    const historyMessages = allMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 5. Load user context (preferences, memories, knowledge, custom instructions)
    const preferences = await storage.getUserPreferences(melvinUser.id);
    const profileParts: string[] = [];
    const systemParts: string[] = [];

    // Knowledge base
    try {
      const knowledgeItems = await storage.getKnowledgeItems(melvinUser.id);
      if (knowledgeItems && knowledgeItems.length > 0) {
        systemParts.push('\n## Knowledge Base');
        systemParts.push('The following information has been provided about the user and should inform your responses:');
        knowledgeItems.forEach((item, index) => {
          systemParts.push(`\n### ${item.title}`);
          systemParts.push(`Source: ${item.type === 'file' ? `File (${item.fileName})` : item.type === 'url' ? `URL (${item.sourceUrl})` : 'User-provided text'}`);
          systemParts.push(`Content:\n${item.content}`);
          if (index < knowledgeItems.length - 1) systemParts.push('\n---');
        });
      }
    } catch (e) {
      console.error('[telegram] Failed to load knowledge items:', e);
    }

    // User profile + personalization
    if (preferences?.personalizationEnabled === 'true') {
      if (preferences.name || preferences.occupation || preferences.bio) {
        profileParts.push('\n## User Profile');
        if (preferences.name) profileParts.push(`Name: ${preferences.name}`);
        if (preferences.occupation) profileParts.push(`Occupation: ${preferences.occupation}`);
        if (preferences.bio) profileParts.push(`About: ${preferences.bio}`);
      }

      if (preferences.memories && Array.isArray(preferences.memories) && preferences.memories.length > 0) {
        profileParts.push('\n## Things to Remember');
        preferences.memories.forEach((memory: string) => profileParts.push(`- ${memory}`));
      }

      if (preferences.customInstructions) {
        profileParts.push('\n## User Custom Instructions');
        profileParts.push(preferences.customInstructions);
      }

      if (preferences.chatHistoryEnabled === 'true') {
        profileParts.push('\n## Note');
        profileParts.push('You have access to the conversation history. Use it to maintain context and provide consistent responses.');
      }
    }

    // Agent memories
    try {
      const agentMemories = await storage.listAgentMemories();
      if (agentMemories && agentMemories.length > 0) {
        profileParts.push('\n## Saved Memories');
        agentMemories.forEach((m: any) => profileParts.push(`- [${m.category}] ${m.content}`));
      }
    } catch (e) {
      console.error('[telegram] Failed to load agent memories:', e);
    }

    const systemPrompt = systemParts.join('\n').trim() || undefined;
    const profilePrompt = profileParts.join('\n').trim() || undefined;

    // 6. Assemble prompt (adds system prompt layers + user context)
    const assembled = await assembleRequest({
      systemPrompt,
      profilePrompt,
      messages: historyMessages,
      storage,
    });

    // 6. Create LLM provider (with fallback)
    // Always use the platform-configured Telegram model so changing it in Settings
    // takes effect immediately — never use the stale chat.model stored at creation time.
    const model = defaultModel;
    const platformSettings = await storage.getPlatformSettings();
    const fallbackModel = (platformSettings.data as any)?.fallbackModel as string | null;
    const llmProvider = createFallbackAwareProvider(storage, model, fallbackModel);

    // 7. Send "thinking" placeholder
    const placeholder = await ctx.reply('💭 Thinking…');

    // 8. Run agent loop and stream updates
    let fullResponse = '';
    let agentUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    let lastEditTime = 0;
    const EDIT_THROTTLE_MS = 1500;

    const agentMessages = assembled.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // Resolve platform-level enabled tools + model reasoning config
    const platformEnabledTools = (platformSettings.data as any)?.enabledAgentTools as string[] | undefined;
    const enabledTools = platformEnabledTools?.length ? platformEnabledTools : undefined;

    const platformModelConfig = (platformSettings.data as any)?.modelConfig?.[model] as
      { reasoningLevel?: string; maxOutputTokens?: number | null } | undefined;

    // Map reasoning level to thinking config
    const resolveThinking = () => {
      const level = platformModelConfig?.reasoningLevel;
      if (level === 'max') return { enabled: true, budget: 16000 };
      if (level === 'high') return { enabled: true, budget: 10000 };
      if (level === 'medium') return { enabled: true, budget: 4000 };
      if (level === 'low') return { enabled: true, budget: 2000 };
      if (level === 'off') return { enabled: false as const, budget: undefined };
      return { enabled: undefined, budget: undefined };
    };
    const thinking = resolveThinking();
    const effectiveMaxTokens = platformModelConfig?.maxOutputTokens ?? 4000;

    // Inject platform settings and OAuth tokens into tool context (mirrors routes.ts)
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
        console.log('[telegram] Google OAuth token loaded — has refresh token:', !!googleToken.refreshToken);
      } else {
        console.warn('[telegram] No Google OAuth token found for user', melvinUser.id, '— Calendar/Gmail/Drive tools will be unavailable');
      }
      const googleSettings = (platformSettings.data as any)?.integrations?.google;
      if (googleSettings?.clientId && googleSettings?.clientSecret) {
        extraToolContext.googleClientId = googleSettings.clientId;
        extraToolContext.googleClientSecret = googleSettings.clientSecret;
      } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        // Fall back to env vars — these are used by the calendar/gmail/drive tools
        extraToolContext.googleClientId = process.env.GOOGLE_CLIENT_ID;
        extraToolContext.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
        console.log('[telegram] Using env-var Google client credentials');
      } else {
        console.warn('[telegram] No Google client credentials found in platform settings or env — Calendar/Gmail/Drive tools will fail');
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
      console.error('[telegram] Failed to load Google OAuth tokens:', tokenErr);
    }

    // Explicit Notion key (also accessible via platformSettings but kept here for clarity)
    try {
      const notionSettings = (platformSettings.data as any)?.integrations?.notion;
      if (notionSettings?.enabled && notionSettings?.apiKey) {
        extraToolContext.notionApiKey = notionSettings.apiKey;
      }
    } catch { /* ignore */ }

    try {
      const recallSettings = (platformSettings.data as any)?.integrations?.recall;
      if (recallSettings?.enabled && recallSettings?.apiKey) {
        extraToolContext.recallApiKey = recallSettings.apiKey;
        extraToolContext.recallRegion = recallSettings.region || 'us-west-2';
      }
    } catch (recallErr) {
      console.error('[telegram] Failed to load Recall settings:', recallErr);
    }

    for await (const event of runAgentLoop(
      {
        model,
        maxIterations: 25,
        userId: melvinUser.id,
        conversationId: chat.id,
        temperature: getModelTemperature(model),
        maxTokens: effectiveMaxTokens,
        thinkingEnabled: thinking.enabled,
        thinkingBudget: thinking.budget,
      },
      agentMessages,
      llmProvider,
      enabledTools,
      extraToolContext,
    )) {
      switch (event.type) {
        case 'text_delta':
          fullResponse += event.text;
          // Throttled edit so Telegram doesn't rate-limit us
          if (Date.now() - lastEditTime > EDIT_THROTTLE_MS && fullResponse.trim()) {
            await safeEdit(ctx, placeholder.message_id, truncateForTelegram(fullResponse));
            lastEditTime = Date.now();
          }
          break;

        case 'tool_call':
          // Show a brief tool status
          await safeEdit(
            ctx,
            placeholder.message_id,
            truncateForTelegram(
              (fullResponse || '') + `\n\n🔧 Using ${event.tool}…`,
            ),
          );
          lastEditTime = Date.now();
          break;

        case 'done':
          fullResponse = event.content || fullResponse;
          agentUsage = event.usage;
          break;

        case 'error':
          fullResponse += `\n\n❌ Error: ${event.message}`;
          break;
      }
    }

    // 9. Final send with complete response — splits into multiple messages if needed
    const finalText = fullResponse.trim() || 'No response generated.';
    await sendSplitHtml(ctx, placeholder.message_id, finalText);

    // 10. Persist assistant message
    await storage.createMessage({
      chatId: chat.id,
      role: 'assistant',
      content: finalText,
      metadata: { source: 'telegram', model },
    });

    // Fire-and-forget memory extraction after each Telegram turn
    scheduleAutoMemory(melvinUser.id, chat.id, agentMessages, storage);

    // 11. Track token usage
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
        console.error('[telegram] Failed to create usage metric:', metricErr);
      }
    }
  } catch (err) {
    console.error('[telegram] Message handling error:', err);
    await ctx.reply(`❌ Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAllowedIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

const TELEGRAM_MAX_CHARS = 4000; // Conservative limit under Telegram's 4096 hard cap

/** Split text into ≤4000-char chunks, breaking at paragraph → line → word boundaries. */
function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MAX_CHARS) {
    let splitAt = TELEGRAM_MAX_CHARS;

    // Prefer paragraph break
    const para = remaining.lastIndexOf('\n\n', TELEGRAM_MAX_CHARS);
    if (para > TELEGRAM_MAX_CHARS / 2) {
      splitAt = para;
    } else {
      // Fall back to line break
      const line = remaining.lastIndexOf('\n', TELEGRAM_MAX_CHARS);
      if (line > TELEGRAM_MAX_CHARS / 2) {
        splitAt = line;
      } else {
        // Fall back to word boundary
        const space = remaining.lastIndexOf(' ', TELEGRAM_MAX_CHARS);
        if (space > TELEGRAM_MAX_CHARS / 2) {
          splitAt = space;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/** Truncate for live streaming previews only (not the final send). */
function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_CHARS) return text;
  return text.slice(0, TELEGRAM_MAX_CHARS - 1) + '…';
}

/**
 * Send a (potentially long) final response as split messages.
 * Edits the placeholder with the first chunk, sends new messages for the rest.
 */
async function sendSplitHtml(
  ctx: any,
  placeholderMessageId: number,
  plainText: string,
): Promise<void> {
  const chunks = splitForTelegram(plainText);

  // Edit the placeholder with the first chunk
  await safeEditHtml(ctx, placeholderMessageId, markdownToTelegramHtml(chunks[0]));

  // Send remaining chunks as new messages
  for (let i = 1; i < chunks.length; i++) {
    try {
      await ctx.api.sendMessage(ctx.chat.id, markdownToTelegramHtml(chunks[i]), {
        parse_mode: 'HTML',
      });
    } catch {
      // Fallback to plain text if HTML fails
      try {
        await ctx.api.sendMessage(ctx.chat.id, chunks[i]);
      } catch (err) {
        console.error(`[telegram] Failed to send message chunk ${i + 1}:`, err);
      }
    }
  }
}

async function safeEdit(ctx: any, messageId: number, text: string) {
  try {
    await ctx.api.editMessageText(ctx.chat.id, messageId, text);
  } catch {
    // Telegram may reject if text hasn't changed — ignore
  }
}

async function safeEditHtml(ctx: any, messageId: number, html: string) {
  try {
    await ctx.api.editMessageText(ctx.chat.id, messageId, html, { parse_mode: 'HTML' });
  } catch {
    // If HTML parse fails, fall back to plain text
    try {
      await ctx.api.editMessageText(ctx.chat.id, messageId, stripHtml(html));
    } catch {
      // ignore — text may be unchanged
    }
  }
}

/**
 * Convert common Markdown patterns to Telegram-safe HTML.
 * Handles: bold, italic, inline code, code blocks, links, headers.
 * Escapes HTML entities in plain text to avoid parse errors.
 */
function markdownToTelegramHtml(md: string): string {
  let html = md;

  // Escape HTML entities first (before inserting tags)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);

  // Inline code: `...` → <code>...</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **...** or __...__
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *...* or _..._  (not inside words)
  html = html.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<i>$1</i>');
  html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>');

  // Headers: # ... → bold text
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  return html;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}
