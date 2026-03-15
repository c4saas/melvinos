import type { Express, Request, Response, NextFunction } from "express";
import type {
  Template,
  InsertTemplate,
  OutputTemplate,
  OutputTemplateValidation,
  User,
  ToolPolicy,
  InsertToolPolicy,
  UpdateToolPolicy,
  Release,
  type UserPlan,
  type AssistantType,
  type Assistant,
  type InsertAssistant,
  type UpdateAssistant,
  type AssistantSummary,
} from "@shared/schema";
import { createServer, type Server } from "http";
import { randomUUID, randomBytes } from "crypto";
import { storage } from "./storage";
import type { IStorage } from "./storage";
import { fileAnalysisService } from "./file-analysis";
import {
  insertChatSchema,
  insertMessageSchema,
  attachmentSchema,
  insertReactionSchema,
  reactionTypeSchema,
  insertKnowledgeItemSchema,
  insertProjectSchema,
  insertProjectKnowledgeSchema,
  insertProjectFileSchema,
  apiProviderSchema,
  platformSettingsDataSchema,
  PLAN_LABELS,
  DEFAULT_FILE_UPLOAD_LIMITS_MB,
  formatFileUploadLimitLabel,
  n8nAgentStatusSchema,
  systemPromptCreateSchema,
  systemPromptUpdateSchema,
  insertAssistantSchema,
  updateAssistantSchema,
  toolPolicyCreateSchema,
  toolPolicyUpdateSchema,
  outputTemplateSectionSchema,
  outputTemplateCategorySchema,
  outputTemplateFormatSchema,
  type SystemPrompt,
  releaseCreateSchema,
  releaseTransitionSchema,
  agentConfigMetadataSchema,
  type AgentConfigMetadata,
} from "@shared/schema";
import { z } from "zod";
import { GoogleDriveService } from "./google-drive";
import { AIService } from "./ai-service";
import { AuthService } from "./auth-service";
import { setupAuth, isAuthenticated } from "./localAuth";
import { transcribeAudio } from "./groq-whisper";
import { checkNotionConnection, getNotionDatabases, getNotionPages, NOTION_NOT_CONNECTED_ERROR } from "./notion-service";
import { ghlEmailService } from "./ghl-email";
import { FileQuotaExceededError } from "./storage/file-store";
import {
  fetchWithSsrfProtection,
  UnsafeRemoteURLError,
  type FetchWithGuardOptions,
} from "./security/safe-fetch";
import { ensureAdminRole } from "./security/admin";
import { attachCsrfToken, verifyCsrfToken } from "./security/csrf";
import { generateCsrfToken } from "./security/secure-compare";
import { getModelConfig, getModelTemperature, getDefaultModel, MODEL_CONFIG } from "./ai-models";
import { assembleRequest } from "./prompt-engine";
import { registerAllTools, runAgentLoop, createLLMProvider, createFallbackAwareProvider, initMcpServers, getMcpServerStatus, reconnectServer, initTaskQueue, registerTaskHandler, listTasks, getTaskStatus, enqueueTask, cancelTask, toolRegistry } from "./agent";
import type { AgentEvent, McpServerConfig } from "./agent";
import { scheduleAutoMemory } from "./agent/auto-memory";
import { buildUsageSummary } from "./usage/analytics";
import { startUsageAggregationScheduler } from "./usage/scheduler";
import { buildOutputTemplateInstruction, validateOutputTemplateContent } from "./output-template-utils";
import { adminDashboardService } from "./admin-dashboard-service";
import { streamClause } from "./openai-voice";
import {
  buildAssistantMetadata,
  chatMetadataSchema,
} from "./chat-metadata";
import { matchTriggerRules, buildTriggerHint } from "./trigger-matcher";
import type { TriggerRule } from "@shared/schema";
import { invokeWebhookAssistant, type WebhookInvocationPayload } from "./webhook-assistant";
import { generateStructuredChatTitle } from "./conversation-title";
import { reconcileTelegramBot, getTelegramBotStatus } from "./telegram-bot";
import { startHeartbeatScheduler, reconcileHeartbeatScheduler, runHeartbeatTick, getHeartbeatStatus } from "./heartbeat/scheduler";
import { startCleanupScheduler } from "./cleanup-scheduler";
import { startCronScheduler } from "./cron-scheduler";

const BYTES_PER_MB = 1024 * 1024;
const REMOTE_CONTENT_BYTE_LIMIT = 2 * 1024 * 1024;

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Single-user app — limits guard against runaway agent loops, not abuse.
interface RateLimitBucket { count: number; resetAt: number; }
const rlStore = new Map<string, RateLimitBucket>();
function checkRateLimit(key: string, maxReq: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rlStore.get(key);
  if (!bucket || now > bucket.resetAt) {
    rlStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxReq) return false;
  bucket.count++;
  return true;
}
function rateLimitMiddleware(maxReq: number, windowMs: number, label: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!checkRateLimit(label, maxReq, windowMs)) {
      return res.status(429).json({ error: `Rate limit exceeded. Max ${maxReq} requests per ${windowMs / 1000}s.` });
    }
    next();
  };
}
const DEFAULT_N8N_BASE_URL = process.env.N8N_BASE_URL || '';
const TEMPLATE_FILE_OWNER = 'admin-templates';
const TEMPLATE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

const PROJECT_UPLOAD_LIMIT_BYTES = Object.fromEntries(
  (Object.entries(DEFAULT_FILE_UPLOAD_LIMITS_MB) as Array<[UserPlan, number | null]>).map(([plan, limitMb]) => [
    plan,
    typeof limitMb === 'number' ? limitMb * BYTES_PER_MB : null,
  ]),
) as Record<UserPlan, number | null>;

const DEFAULT_USAGE_SNAPSHOT_INTERVAL_MINUTES = 15;
const DEFAULT_USAGE_SNAPSHOT_LOOKBACK_HOURS = 24;

const parsePositiveNumber = (value?: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const normalizeUserPlan = (plan: unknown): UserPlan => {
  if (plan === 'pro' || plan === 'enterprise') {
    return plan;
  }
  return 'free';
};


interface UploadValidationResult {
  status: number;
  message: string;
}

const getProjectUploadLimitBytes = (plan: UserPlan): number | null => {
  const limit = PROJECT_UPLOAD_LIMIT_BYTES[plan];
  if (typeof limit === 'number') {
    return limit;
  }

  const fallback = PROJECT_UPLOAD_LIMIT_BYTES.free;
  return typeof fallback === 'number' ? fallback : null;
};

const getPlanLabel = (plan: UserPlan): string => PLAN_LABELS[plan] ?? PLAN_LABELS.free;

const OVERSIZED_ERROR_HEADER_NAMES = [
  'x-error-code',
  'x-upload-error-code',
  'x-upload-error',
  'x-amz-error-code',
  'x-amz-errortype',
] as const;

const OVERSIZED_ERROR_TOKENS = new Set([
  'oversized-file',
  'file-too-large',
  'file_too_large',
  'entitytoolarge',
  'entity_too_large',
  'requestentitytoolarge',
  'payloadtoolarge',
]);

const normalizeErrorToken = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase();
};

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const toPlainRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return { ...(value as Record<string, unknown>) };
};

const extractWebhookHeaders = (metadata: Record<string, unknown> | null): Record<string, string> | undefined => {
  const rawHeaders = metadata?.headers;
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    return undefined;
  }

  const entries = Object.entries(rawHeaders).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof key === 'string' && typeof value === 'string' && key.trim()) {
      acc[key] = value;
    }
    return acc;
  }, {});

  return Object.keys(entries).length > 0 ? entries : undefined;
};

const serializeAssistantSummary = (assistant: Assistant): AssistantSummary => {
  const metadata = toPlainRecord(assistant.metadata ?? null);
  const webhookTimeout = metadata && typeof metadata.timeoutMs === 'number'
    ? clampNumber(Math.floor(metadata.timeoutMs), 1_000, 60_000)
    : undefined;
  const webhookHeaders = extractWebhookHeaders(metadata);

  const webhook = assistant.type === 'webhook'
    ? {
        url: assistant.webhookUrl ?? null,
        workflowId: assistant.workflowId ?? null,
        metadata,
        ...(typeof webhookTimeout === 'number' ? { timeoutMs: webhookTimeout } : {}),
        ...(webhookHeaders ? { headers: webhookHeaders } : {}),
      }
    : null;

  const createdAt = assistant.createdAt instanceof Date
    ? assistant.createdAt.toISOString()
    : assistant.createdAt ?? null;
  const updatedAt = assistant.updatedAt instanceof Date
    ? assistant.updatedAt.toISOString()
    : assistant.updatedAt ?? null;

  return {
    id: assistant.id,
    name: assistant.name,
    description: assistant.description ?? null,
    type: assistant.type,
    promptContent: assistant.promptContent ?? null,
    metadata,
    webhookUrl: assistant.webhookUrl ?? null,
    workflowId: assistant.workflowId ?? null,
    webhook,
    isActive: assistant.isActive,
    createdAt: createdAt ?? undefined,
    updatedAt: updatedAt ?? undefined,
} satisfies AssistantSummary;
};

type AssistantMetrics = {
  total: number;
  active: number;
  inactive: number;
  typeBreakdown: Array<{
    type: Assistant['type'];
    total: number;
    active: number;
    inactive: number;
  }>;
};

const DEFAULT_ASSISTANT_TYPES: Assistant['type'][] = ['prompt', 'webhook'];

const buildAssistantMetrics = (assistants: Assistant[]): AssistantMetrics => {
  const typeOrder = new Map<Assistant['type'], number>();
  DEFAULT_ASSISTANT_TYPES.forEach((type, index) => typeOrder.set(type, index));

  const summaryMap = new Map<Assistant['type'], { total: number; active: number }>();
  const ensureType = (type: Assistant['type']) => {
    if (!summaryMap.has(type)) {
      summaryMap.set(type, { total: 0, active: 0 });
      if (!typeOrder.has(type)) {
        typeOrder.set(type, typeOrder.size);
      }
    }
    return summaryMap.get(type)!;
  };

  DEFAULT_ASSISTANT_TYPES.forEach((type) => ensureType(type));

  for (const assistant of assistants) {
    const summary = ensureType(assistant.type);
    summary.total += 1;
    if (assistant.isActive !== false) {
      summary.active += 1;
    }
  }

  const typeBreakdown = Array.from(summaryMap.entries())
    .sort((a, b) => (typeOrder.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (typeOrder.get(b[0]) ?? Number.MAX_SAFE_INTEGER))
    .map(([type, summary]) => ({
      type,
      total: summary.total,
      active: summary.active,
      inactive: Math.max(summary.total - summary.active, 0),
    }));

  const totalAssistants = assistants.length;
  const activeAssistants = assistants.filter((assistant) => assistant.isActive !== false).length;
  const inactiveAssistants = Math.max(totalAssistants - activeAssistants, 0);

  return {
    total: totalAssistants,
    active: activeAssistants,
    inactive: inactiveAssistants,
    typeBreakdown,
  } satisfies AssistantMetrics;
};

const buildWebhookInvocationPayload = (prepared: PreparedChatRequest): WebhookInvocationPayload => {
  const attachments = (prepared.validatedAttachments ?? []).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: attachment.url,
  }));

  const metadata = prepared.metadata ? { ...prepared.metadata } : null;

  return {
    assistant: {
      id: prepared.assistantId ?? null,
      type: prepared.assistantType ?? null,
      name: prepared.assistantName ?? null,
      metadata: prepared.webhookAssistant?.metadata ?? null,
    },
    message: {
      text: prepared.lastMessage.content,
      metadata,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    chat: {
      id: prepared.chatId ?? null,
      projectId: prepared.chatProjectId ?? null,
    },
    user: {
      id: prepared.userId,
    },
    context: {
      model: prepared.model,
      hasAttachments: prepared.hasAttachments,
      hasContent: prepared.hasContent,
      timestamp: new Date().toISOString(),
    },
  };
};

const resolveFileUploadLimitMb = (plan: UserPlan, overrideMb?: number | null): number | null => {
  if (overrideMb === null || overrideMb === undefined) {
    return DEFAULT_FILE_UPLOAD_LIMITS_MB[plan] ?? DEFAULT_FILE_UPLOAD_LIMITS_MB.free ?? null;
  }
  return overrideMb;
};

export const validateUploadSizeForPlan = (
  plan: UserPlan,
  sizeInBytes: number,
  options?: { fileUploadLimitMb?: number | null },
): UploadValidationResult | null => {
  const limitMb = resolveFileUploadLimitMb(plan, options?.fileUploadLimitMb);

  if (limitMb === null) {
    return null;
  }

  const maxBytes = getProjectUploadLimitBytes(plan);
  if (maxBytes === null) {
    return null;
  }
  const readableMax = formatFileUploadLimitLabel(limitMb);
  const planLabel = getPlanLabel(plan);

  if (sizeInBytes > maxBytes) {
    return {
      status: 413,
      message: `File too large. Maximum size is ${readableMax} for ${planLabel} users.`,
    };
  }

  return null;
};

export const isOversizedProjectFileHeadResponse = (
  response: globalThis.Response,
): boolean => {
  if (response.status === 413) {
    return true;
  }

  for (const headerName of OVERSIZED_ERROR_HEADER_NAMES) {
    const token = normalizeErrorToken(response.headers.get(headerName));
    if (!token) {
      continue;
    }

    if (OVERSIZED_ERROR_TOKENS.has(token)) {
      return true;
    }

    if (token.includes('oversized') || token.includes('too_large') || token.includes('too-large')) {
      return true;
    }
  }

  return false;
};

export const buildProjectFileOversizeError = (plan: UserPlan): UploadValidationResult => {
  const fallback = validateUploadSizeForPlan(plan, Number.MAX_SAFE_INTEGER);
  if (fallback) {
    return fallback;
  }

  return {
    status: 413,
    message: 'File too large to upload for your plan.',
  };
};

export const fetchProjectFileMetadata = (
  url: string,
  options: Omit<FetchWithGuardOptions, 'method'> = {},
) => {
  return fetchWithSsrfProtection(url, { ...options, method: 'HEAD' });
};

const updateProjectSchema = insertProjectSchema.pick({
  name: true,
  description: true,
  customInstructions: true,
  includeGlobalKnowledge: true,
  includeUserMemories: true,
}).partial();

export class HttpError extends Error {
  status: number;
  detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export type PreparedChatRequest = {
  userId: string;
  model: string;
  chatId?: string;
  assistantId?: string | null;
  assistantType?: AssistantType | null;
  assistantName?: string | null;
  webhookAssistant?: {
    url: string;
    workflowId?: string | null;
    metadata?: Record<string, unknown> | null;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } | null;
  metadata?: z.infer<typeof chatMetadataSchema>;
  outputTemplate?: OutputTemplate;
  validatedAttachments?: z.infer<typeof attachmentSchema>[];
  enrichedMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  lastMessage: { role: string; content: string };
  hasAttachments: boolean;
  hasContent: boolean;
  chatProjectId: string | null;
  shouldCallAI: boolean;
  agentConfigMeta?: AgentConfigMetadata;
};

type PrepareChatCompletionRequestDeps = {
  storage: Pick<IStorage, 'getChat' | 'getFileForUser' | 'getOutputTemplate' | 'getActiveRelease' | 'getAssistant'>;
  authService: Pick<AuthService, 'checkRateLimit'>;
};

const isOutputTemplateAllowedByRelease = (templateId: string, release?: Release | null): boolean => {
  if (!release) {
    return true;
  }

  const allowedIds = (release.outputTemplateIds ?? []).filter((id): id is string => Boolean(id));
  if (allowedIds.length === 0) {
    return false;
  }

  return allowedIds.includes(templateId);
};

export const createPrepareChatCompletionRequest = ({
  storage: chatStorage,
  authService,
}: PrepareChatCompletionRequestDeps) =>
  async function prepareChatCompletionRequest(req: Request): Promise<PreparedChatRequest> {
    const { model, messages, chatId, attachments, metadata: rawMetadata, assistantId } = req.body ?? {};
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }

    let activeReleasePromise: Promise<Release | null> | null = null;
    const loadActiveRelease = async (): Promise<Release | null> => {
      if (!activeReleasePromise) {
        activeReleasePromise = chatStorage
          .getActiveRelease()
          .then((release) => release ?? null)
          .catch(() => null);
      }
      return activeReleasePromise;
    };

    let metadata: z.infer<typeof chatMetadataSchema> | undefined;

    if (rawMetadata) {
      const metadataValidation = chatMetadataSchema.safeParse(rawMetadata);
      if (!metadataValidation.success) {
        throw new HttpError(400, 'Invalid metadata format', metadataValidation.error.errors);
      }

      metadata = metadataValidation.data;
    }

    const rateLimit = await authService.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      throw new HttpError(429, 'Rate limit exceeded', {
        message: `You have reached your daily message limit (${rateLimit.limit}/day). Upgrade to a paid plan for unlimited messages.`,
        remaining: rateLimit.remaining,
        limit: rateLimit.limit,
      });
    }

    if (!model || !messages || !Array.isArray(messages)) {
      throw new HttpError(400, 'Missing required fields: model, messages');
    }

    const modelConfig = getModelConfig(model);

    if (!modelConfig) {
      throw new HttpError(400, 'Invalid model selection');
    }

    let validatedAttachments: z.infer<typeof attachmentSchema>[] | undefined;
    if (attachments) {
      if (!Array.isArray(attachments)) {
        throw new HttpError(400, 'Attachments must be an array');
      }

      try {
        validatedAttachments = z.array(attachmentSchema).parse(attachments);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new HttpError(400, 'Invalid attachment data', error.errors);
        }
        throw error;
      }
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      throw new HttpError(400, 'Messages array must contain at least one entry');
    }

    const hasContent = Boolean(lastMessage.content && lastMessage.content.trim());
    const hasAttachments = Boolean(validatedAttachments && validatedAttachments.length > 0);

    let selectedAssistantId: string | null = null;
    let selectedAssistantType: AssistantType | null = null;
    let selectedAssistantName: string | null = null;
    let selectedWebhookAssistant: PreparedChatRequest['webhookAssistant'] = null;
    let selectedAgentConfigMeta: AgentConfigMetadata | undefined;

    if (assistantId !== undefined && assistantId !== null) {
      if (typeof assistantId !== 'string' || assistantId.trim().length === 0) {
        throw new HttpError(400, 'Invalid assistant selection');
      }

      const assistant = await chatStorage.getAssistant(assistantId.trim());

      if (!assistant || !assistant.isActive) {
        throw new HttpError(400, 'Selected assistant is not available');
      }

      const release = await loadActiveRelease();
      if (release) {
        const allowedIds = (release.assistantIds ?? []).filter((id): id is string => Boolean(id));

        if (allowedIds.length === 0 || !allowedIds.includes(assistant.id)) {
          throw new HttpError(400, 'Selected assistant is not available');
        }
      }

      selectedAssistantId = assistant.id;
      selectedAssistantType = assistant.type;
      selectedAssistantName = assistant.name ?? null;

      if (assistant.type === 'webhook') {
        if (!assistant.webhookUrl) {
          throw new HttpError(400, 'Selected assistant webhook is not configured');
        }

        const assistantMetadata = toPlainRecord(assistant.metadata ?? null);
        const timeoutMs = assistantMetadata && typeof assistantMetadata.timeoutMs === 'number'
          ? clampNumber(Math.floor(assistantMetadata.timeoutMs), 1_000, 60_000)
          : undefined;
        const headers = extractWebhookHeaders(assistantMetadata);

        selectedWebhookAssistant = {
          url: assistant.webhookUrl,
          workflowId: assistant.workflowId ?? null,
          metadata: assistantMetadata,
          ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
          ...(headers ? { headers } : {}),
        };
      }

      // Extract agent-level config from assistant metadata
      if (assistant.type === 'prompt' && assistant.metadata) {
        const parsed = agentConfigMetadataSchema.safeParse(assistant.metadata);
        if (parsed.success) {
          selectedAgentConfigMeta = parsed.data;
        }
      }
    }

    let chatProjectId: string | null = null;
    if (chatId) {
      const chat = await chatStorage.getChat(chatId);
      if (!chat) {
        throw new HttpError(404, 'Chat not found');
      }

      if (chat.userId !== userId) {
        throw new HttpError(403, 'Access denied: You do not own this chat');
      }

      chatProjectId = chat.projectId || null;
    }

    const enrichedMessages = [...messages];
    const fileAnalysisPrompts: string[] = [];

    if (hasAttachments && validatedAttachments) {
      for (const attachment of validatedAttachments) {
        const file = await chatStorage.getFileForUser(attachment.id, userId);

        if (!file) {
          throw new HttpError(404, 'Attachment not found');
        }

        if (file.analyzedContent) {
          fileAnalysisPrompts.push(`
File: ${file.name} (${file.mimeType})
Content:
${file.analyzedContent}${file.metadata?.summary ? `\nSummary: ${file.metadata.summary}` : ''}`.trim());
        }
      }

      if (fileAnalysisPrompts.length > 0) {
        const lastUserMessage = enrichedMessages[enrichedMessages.length - 1];
        const fileContent = fileAnalysisPrompts.join('\n\n---\n\n');
        const contentPrefix = lastUserMessage.content?.trim()
          ? lastUserMessage.content
          : 'Please analyze the attached files:';

        const newContent = `${contentPrefix}\n\nAttached Files:\n${fileContent}`;
        enrichedMessages[enrichedMessages.length - 1] = {
          role: lastUserMessage.role,
          content: newContent,
        };
      }
    }

    let outputTemplate: OutputTemplate | undefined;

    if (metadata?.outputTemplateId) {
      const [template, release] = await Promise.all([
        chatStorage.getOutputTemplate(metadata.outputTemplateId),
        loadActiveRelease(),
      ]);

      if (!template || !template.isActive || !isOutputTemplateAllowedByRelease(template.id, release ?? null)) {
        throw new HttpError(400, 'Selected output template is not available');
      }

      outputTemplate = template;
      const instruction = buildOutputTemplateInstruction(template);
      enrichedMessages.unshift({
        role: 'system',
        content: instruction,
      });
    }

    const shouldCallAI = hasContent || (hasAttachments && fileAnalysisPrompts.length > 0);

    return {
      userId,
      model,
      chatId: chatId || undefined,
      assistantId: selectedAssistantId,
      assistantType: selectedAssistantType,
      assistantName: selectedAssistantName,
      webhookAssistant: selectedWebhookAssistant,
      metadata,
      outputTemplate,
      validatedAttachments,
      enrichedMessages,
      lastMessage: {
        role: lastMessage.role,
        content: lastMessage.content || '',
      },
      hasAttachments,
      hasContent,
      chatProjectId,
      shouldCallAI,
      agentConfigMeta: selectedAgentConfigMeta,
    };
  };

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Local Auth
  await setupAuth(app);
  app.use(attachCsrfToken);
  app.use(verifyCsrfToken);
  
  // Initialize services
  const aiService = new AIService(storage);
  const authService = new AuthService(storage);

  // Register agent tools
  registerAllTools(storage);

  // Initialize MCP servers from platform settings
  (async () => {
    try {
      const settings = await storage.getPlatformSettings();
      const mcpConfigs = (settings.data as any).mcpServers ?? [];
      if (mcpConfigs.length > 0) {
        await initMcpServers(mcpConfigs);
      }
    } catch (err) {
      console.error('[mcp] Failed to initialize MCP servers on startup:', err instanceof Error ? err.message : err);
      void storage.logToolError?.({ toolName: 'mcp_init', error: `MCP startup failed: ${err instanceof Error ? err.message : String(err)}`, args: null, conversationId: null }).catch(() => {});
    }
  })();

  // Initialize background task queue
  initTaskQueue(storage);

  // Register autonomous agent task handler — allows Melvin to self-enqueue work
  registerTaskHandler('agent_autonomous', async (task) => {
    const input = task.input as { prompt: string; userId?: string; chatId?: string; model?: string } | null;
    if (!input?.prompt) return { error: 'Missing prompt in task input' };

    // Resolve user
    const users = await storage.listUsers();
    const user = input.userId
      ? users.find(u => u.id === input.userId)
      : users.find(u => u.role === 'super_admin') ?? users[0];
    if (!user) return { error: 'No user found for autonomous task' };

    // Resolve or create chat
    let chatId = input.chatId;
    if (!chatId) {
      const chat = await storage.createChat({
        userId: user.id,
        title: `[Autonomous] ${task.title}`,
        model: input.model || getDefaultModel(),
      });
      chatId = chat.id;
    }

    // Persist the trigger message
    await storage.createMessage({
      chatId,
      role: 'user',
      content: input.prompt,
      metadata: { source: 'autonomous_task', taskId: task.id },
    });

    const model = input.model || getDefaultModel();
    const platformSettings = await storage.getPlatformSettings();
    const fallbackModel = (platformSettings.data as any)?.fallbackModel as string | null;
    const llmProvider = createFallbackAwareProvider(storage, model, fallbackModel);

    // Build tool context with full credentials
    const extraToolContext: Record<string, any> = {};

    extraToolContext.saveFile = async (buffer: Buffer, name: string, mimeType: string): Promise<string> => {
      const attachment = await storage.saveFile(user.id, buffer, name, mimeType);
      return attachment.url;
    };

    const settingsData = platformSettings?.data as Record<string, any> | undefined;
    if (settingsData) extraToolContext.platformSettings = settingsData;

    try {
      const googleTokens = await storage.getOAuthTokens(user.id, 'google');
      const googleSettings = (platformSettings.data as any)?.integrations?.google;
      const clientId = googleSettings?.enabled ? googleSettings?.clientId : undefined;
      const clientSecret = googleSettings?.enabled ? googleSettings?.clientSecret : undefined;

      if (googleTokens.length > 0) {
        // Primary (first/default) token for backwards compat
        const primary = googleTokens.find(t => t.accountLabel === 'default') ?? googleTokens[0];
        extraToolContext.googleAccessToken = primary.accessToken;
        if (primary.refreshToken) extraToolContext.googleRefreshToken = primary.refreshToken;
        extraToolContext.updateGoogleTokens = async (at: string, rt?: string | null, exp?: number | null) => {
          await storage.updateOAuthToken(user.id, 'google', {
            accessToken: at,
            ...(rt != null && { refreshToken: rt }),
            ...(exp != null && { tokenExpiry: new Date(exp) }),
          }, primary.accountLabel ?? 'default');
        };

        // All accounts for fan-out
        extraToolContext.googleAccounts = googleTokens.map(t => ({
          label: t.accountLabel ?? 'default',
          accessToken: t.accessToken,
          refreshToken: t.refreshToken ?? undefined,
          clientId,
          clientSecret,
          update: async (at: string, rt?: string | null, exp?: number | null) => {
            await storage.updateOAuthToken(user.id, 'google', {
              accessToken: at,
              ...(rt != null && { refreshToken: rt }),
              ...(exp != null && { tokenExpiry: new Date(exp) }),
            }, t.accountLabel ?? 'default');
          },
        }));
      }
      if (clientId) extraToolContext.googleClientId = clientId;
      if (clientSecret) extraToolContext.googleClientSecret = clientSecret;
    } catch (err) { console.debug('[tool-context] Google OAuth load failed — Google tools unavailable:', err instanceof Error ? err.message : err); }

    try {
      const recallSettings = (platformSettings.data as any)?.integrations?.recall;
      if (recallSettings?.enabled && recallSettings?.apiKey) {
        extraToolContext.recallApiKey = recallSettings.apiKey;
        extraToolContext.recallRegion = recallSettings.region || 'us-west-2';
      }
    } catch (err) { console.debug('[tool-context] Recall settings load failed — Recall tools unavailable:', err instanceof Error ? err.message : err); }

    // Load chat history
    const allMessages = await storage.getChatMessages(chatId);
    const historyMessages = allMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const assembled = await assembleRequest({
      messages: historyMessages,
      storage,
    });
    const agentMessages = assembled.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const platformEnabledTools = (platformSettings.data as any)?.enabledAgentTools as string[] | undefined;
    const enabledTools = platformEnabledTools?.length ? platformEnabledTools : undefined;

    let fullResponse = '';
    for await (const event of runAgentLoop(
      {
        model,
        maxIterations: 50,
        userId: user.id,
        conversationId: chatId,
        temperature: getModelTemperature(model),
        maxTokens: 4000,
      },
      agentMessages,
      llmProvider,
      enabledTools,
      extraToolContext,
    )) {
      if (event.type === 'text_delta') fullResponse += event.text;
      if (event.type === 'done') fullResponse = event.content || fullResponse;
      if (event.type === 'error') fullResponse += `\nError: ${event.message}`;
    }

    // Persist response
    await storage.createMessage({
      chatId,
      role: 'assistant',
      content: fullResponse.trim(),
      metadata: { source: 'autonomous_task', taskId: task.id, model },
    });

    return { output: { chatId, response: fullResponse.trim() } };
  });

  // Register data consolidation pipeline task handler
  registerTaskHandler('data_consolidation', async (task) => {
    const input = task.input as {
      userId?: string;
      chatId?: string;
      sources?: string[];
      dryRun?: boolean;
      mode?: 'full' | 'incremental';
    } | null;

    // Resolve user
    const users = await storage.listUsers();
    const user = input?.userId
      ? users.find(u => u.id === input.userId)
      : users.find(u => u.role === 'super_admin') ?? users[0];
    if (!user) return { error: 'No user found for consolidation task' };

    // Gather credentials
    const platformSettings = await storage.getPlatformSettings();
    const settingsData = platformSettings?.data as Record<string, any> | undefined;

    const openaiKey = settingsData?.apiProviders?.openai?.defaultApiKey || settingsData?.openaiApiKey || process.env.OPENAI_API_KEY;
    const anthropicKey = settingsData?.apiProviders?.anthropic?.defaultApiKey || settingsData?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

    if (!openaiKey) return { error: 'OpenAI API key required for embeddings (not configured)' };
    if (!anthropicKey) return { error: 'Anthropic API key required for consolidation (not configured)' };

    // Google OAuth
    let googleAccessToken: string | undefined;
    let googleRefreshToken: string | undefined;
    let googleClientId: string | undefined;
    let googleClientSecret: string | undefined;
    let updateGoogleTokens: ((at: string, rt?: string | null, exp?: number | null) => Promise<void>) | undefined;

    try {
      const googleTokens = await storage.getOAuthTokens(user.id, 'google');
      const googleSettings = settingsData?.integrations?.google;
      if (googleSettings?.enabled && googleSettings?.clientId) {
        googleClientId = googleSettings.clientId;
        googleClientSecret = googleSettings.clientSecret;
      }
      if (googleTokens.length > 0) {
        const primary = googleTokens.find(t => t.accountLabel === 'default') ?? googleTokens[0];
        googleAccessToken = primary.accessToken;
        if (primary.refreshToken) googleRefreshToken = primary.refreshToken;
        updateGoogleTokens = async (at: string, rt?: string | null, exp?: number | null) => {
          await storage.updateOAuthToken(user.id, 'google', {
            accessToken: at,
            ...(rt != null && { refreshToken: rt }),
            ...(exp != null && { tokenExpiry: new Date(exp) }),
          }, primary.accountLabel ?? 'default');
        };
      }
    } catch (err) { console.debug('[consolidate] Google OAuth load failed:', err instanceof Error ? err.message : err); }

    // Recall
    let recallApiKey: string | undefined;
    let recallRegion: string | undefined;
    try {
      const recallSettings = settingsData?.integrations?.recall;
      if (recallSettings?.enabled && recallSettings?.apiKey) {
        recallApiKey = recallSettings.apiKey;
        recallRegion = recallSettings.region || 'us-west-2';
      }
    } catch (err) { console.debug('[consolidate] Recall settings load failed:', err instanceof Error ? err.message : err); }

    // Run pipeline
    const { runConsolidationPipeline } = await import('./agent/data-consolidation/pipeline');

    const updateProgress = async (percent: number) => {
      try {
        await storage.updateAgentTask(task.id, {
          progress: percent,
          status: percent >= 100 ? 'completed' : 'running',
        });
      } catch { /* ignore progress update failures */ }
    };

    const state = await runConsolidationPipeline(
      {
        storage,
        userId: user.id,
        openaiKey,
        anthropicKey,
        googleAccessToken,
        googleRefreshToken,
        googleClientId,
        googleClientSecret,
        updateGoogleTokens,
        recallApiKey,
        recallRegion,
      },
      {
        sources: input?.sources,
        dryRun: input?.dryRun,
        taskId: task.id,
        mode: input?.mode,
      },
      updateProgress,
    );

    // Post summary to chat if chatId provided
    if (input?.chatId) {
      const summary = [
        `**Data Consolidation Complete**`,
        `- Documents extracted: ${state.totalDocuments}`,
        `- Topic clusters: ${state.clusters}`,
        `- Pages created: ${state.pagesCreated}`,
        state.errors.length > 0 ? `- Errors: ${state.errors.length}\n  - ${state.errors.join('\n  - ')}` : '',
        state.notionParentId ? `\nResults written to Notion under "Cleansed Data".` : '',
      ].filter(Boolean).join('\n');

      await storage.createMessage({
        chatId: input.chatId,
        role: 'assistant',
        content: summary,
        metadata: { source: 'data_consolidation', taskId: task.id },
      });
    }

    return { output: state };
  });

  // Initialize Telegram bot (if enabled in settings)
  reconcileTelegramBot(storage).catch((err) =>
    console.warn('[telegram] Init failed:', err),
  );

  // Initialize Heartbeat scheduler (if enabled in settings)
  const heartbeatScheduler = startHeartbeatScheduler(storage);

  // Start data cleanup scheduler (sessions, old tasks, metrics, memory pruning)
  startCleanupScheduler();

  // Start persistent cron job scheduler
  startCronScheduler(storage);

  // Use Local Auth middleware
  const requireAuth = isAuthenticated;

  const toIsoString = (value: Date | string | null | undefined): string | null => {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  };

  const parseDateParam = (value: unknown): Date | undefined => {
    if (!value || typeof value !== 'string') {
      return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const ensureIsoString = (value: Date | string | null | undefined): string =>
    toIsoString(value) ?? new Date().toISOString();

  const alignDateToInterval = (date: Date, intervalMinutes: number): Date => {
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    const aligned = Math.floor(date.getTime() / intervalMs) * intervalMs;
    return new Date(aligned);
  };

  const formatToolPolicy = (policy: ToolPolicy) => ({
    id: policy.id,
    provider: policy.provider,
    toolName: policy.toolName,
    isEnabled: policy.isEnabled,
    safetyNote: policy.safetyNote ?? null,
    createdAt: ensureIsoString(policy.createdAt),
    updatedAt: ensureIsoString(policy.updatedAt),
  });

  const isToolPolicyConflictError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const err = error as { code?: string; constraint?: string; message?: string };
    if (err.code === '23505') {
      return true;
    }
    if (err.constraint && err.constraint.includes('tool_policies_provider_tool_name_idx')) {
      return true;
    }
    if (typeof err.message === 'string' && err.message === 'TOOL_POLICY_CONFLICT') {
      return true;
    }
    return false;
  };

  const serializeTemplate = (template: Template) => ({
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    fileName: template.fileName,
    mimeType: template.mimeType,
    fileSize: template.fileSize,
    availableForFree: template.availableForFree,
    availableForPro: template.availableForPro,
    isActive: template.isActive,
    fileId: template.fileId,
    createdAt: toIsoString((template as any).createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString((template as any).updatedAt) ?? new Date().toISOString(),
  });

  const isTemplateAllowedByRelease = (templateId: string, release?: Release | null): boolean => {
    if (!release) {
      return true;
    }

    const allowedIds = (release.templateIds ?? []).filter((id): id is string => Boolean(id));
    if (allowedIds.length === 0) {
      return false;
    }

    return allowedIds.includes(templateId);
  };

  const isTemplateAccessibleToUser = (template: Template, _user: User, release?: Release | null): boolean => {
    if (!template.isActive) {
      return false;
    }

    if (!isTemplateAllowedByRelease(template.id, release)) {
      return false;
    }

    // Single-user: all active templates are accessible
    return true;
  };

  const serializeOutputTemplate = (template: OutputTemplate) => ({
    id: template.id,
    name: template.name,
    category: template.category,
    format: template.format,
    description: template.description ?? null,
    instructions: template.instructions ?? null,
    requiredSections: Array.isArray(template.requiredSections) ? template.requiredSections : [],
    isActive: template.isActive,
    createdAt: toIsoString((template as any).createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString((template as any).updatedAt) ?? new Date().toISOString(),
  });

  const serializeSystemPrompt = (prompt: SystemPrompt) => ({
    id: prompt.id,
    version: prompt.version,
    label: prompt.label ?? null,
    content: prompt.content,
    notes: prompt.notes ?? null,
    createdByUserId: prompt.createdByUserId ?? null,
    activatedByUserId: prompt.activatedByUserId ?? null,
    isActive: prompt.isActive,
    createdAt: toIsoString((prompt as any).createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString((prompt as any).updatedAt) ?? new Date().toISOString(),
    activatedAt: toIsoString((prompt as any).activatedAt) ?? null,
  });

  const serializeRelease = (release: Release) => ({
    id: release.id,
    version: release.version,
    label: release.label,
    status: release.status,
    changeNotes: release.changeNotes ?? null,
    systemPromptId: release.systemPromptId ?? null,
    assistantIds: Array.isArray(release.assistantIds) ? release.assistantIds : [],
    templateIds: Array.isArray(release.templateIds) ? release.templateIds : [],
    outputTemplateIds: Array.isArray(release.outputTemplateIds) ? release.outputTemplateIds : [],
    toolPolicyIds: Array.isArray(release.toolPolicyIds) ? release.toolPolicyIds : [],
    isActive: release.isActive ?? false,
    publishedAt: toIsoString((release as any).publishedAt) ?? null,
    createdAt: toIsoString((release as any).createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString((release as any).updatedAt) ?? new Date().toISOString(),
  });

  const templateFileSchema = z.object({
    name: z.string().min(1, 'File name is required').max(255),
    mimeType: z.string().min(1, 'MIME type is required'),
    data: z.string().min(1, 'File data is required'),
  });

  const templateCreateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(120),
    description: z.string().max(500).optional().nullable(),
    availableForFree: z.boolean().optional(),
    availableForPro: z.boolean().optional(),
    isActive: z.boolean().optional(),
    file: templateFileSchema,
  });

  const templateUpdateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    availableForFree: z.boolean().optional(),
    availableForPro: z.boolean().optional(),
    isActive: z.boolean().optional(),
    file: templateFileSchema.optional(),
  });

  const outputTemplateSectionInputSchema = outputTemplateSectionSchema;

  const outputTemplateSectionsArraySchema = z
    .array(outputTemplateSectionInputSchema)
    .min(1, 'At least one required section must be provided')
    .refine((sections) => {
      const keys = new Set(sections.map(section => section.key.trim().toLowerCase()));
      return keys.size === sections.length;
    }, { message: 'Section keys must be unique' })
    .refine((sections) => {
      const titles = new Set(sections.map(section => section.title.trim().toLowerCase()));
      return titles.size === sections.length;
    }, { message: 'Section titles must be unique' });

  const outputTemplateCreateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(160),
    category: outputTemplateCategorySchema,
    format: outputTemplateFormatSchema,
    description: z.string().max(500).optional().nullable(),
    instructions: z.string().max(2000).optional().nullable(),
    requiredSections: outputTemplateSectionsArraySchema,
    isActive: z.boolean().optional(),
  });

  const outputTemplateUpdateSchema = z.object({
    name: z.string().min(1).max(160).optional(),
    category: outputTemplateCategorySchema.optional(),
    format: outputTemplateFormatSchema.optional(),
    description: z.string().max(500).optional().nullable(),
    instructions: z.string().max(2000).optional().nullable(),
    requiredSections: outputTemplateSectionsArraySchema.optional(),
    isActive: z.boolean().optional(),
  });

  const createN8nAgentSchema = z.object({
    workflowId: z.string().min(1, 'Workflow ID is required'),
    name: z.string().min(1, 'Agent name is required'),
    description: z.string().optional(),
    status: n8nAgentStatusSchema.optional(),
    webhookUrl: z.string().url('Webhook URL must be a valid URL').optional(),
    metadata: z.record(z.any()).optional(),
  });

  const normalizeAssistantFields = <T extends InsertAssistant | UpdateAssistant>(
    payload: T,
    targetType: AssistantType,
  ): T => {
    const normalized = {
      ...payload,
    } as T & { promptContent?: string | null; webhookUrl?: string | null; workflowId?: string | null };

    if (targetType === 'prompt') {
      normalized.webhookUrl = null;
      normalized.workflowId = null;
    }

    if (targetType === 'webhook') {
      normalized.promptContent = null;
    }

    return normalized;
  };

  const prepareChatCompletionRequest = createPrepareChatCompletionRequest({
    storage,
    authService,
  });

  async function persistChatMessages(options: {
    chatId?: string;
    userId: string;
    metadata?: z.infer<typeof chatMetadataSchema>;
    validatedAttachments?: z.infer<typeof attachmentSchema>[];
    hasAttachments: boolean;
    lastMessageContent: string;
    model: string;
    responseContent?: string | null;
    responseMetadata?: Record<string, unknown>;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    toolUsage?: Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number }>;
  }): Promise<void> {
    const {
      chatId,
      userId,
      metadata,
      validatedAttachments,
      hasAttachments,
      lastMessageContent,
      model,
      responseContent,
      responseMetadata,
      usage,
      toolUsage,
    } = options;

    if (!chatId) {
      return;
    }

    try {
      const existingChat = await storage.getChat(chatId);
      if (!existingChat) {
        console.warn(`Chat ${chatId} not found, skipping message persistence`);
        return;
      }

      await storage.createMessage({
        chatId,
        role: 'user',
        content: lastMessageContent,
        attachments: hasAttachments ? validatedAttachments : undefined,
        metadata,
      });

      if (responseContent) {
        await storage.createMessage({
          chatId,
          role: 'assistant',
          content: responseContent,
          metadata: responseMetadata && Object.keys(responseMetadata).length > 0 ? responseMetadata : undefined,
        });
      } else if (hasAttachments) {
        await storage.createMessage({
          chatId,
          role: 'assistant',
          content: 'Files received successfully.',
        });
      }

      if (!existingChat.title || existingChat.title === 'New Conversation') {
        const chatMessages = await storage.getChatMessages(chatId);
        const userChats = await storage.getUserChats(existingChat.userId, true);
        const otherTitles = userChats
          .filter(chat => chat.id !== chatId)
          .map(chat => chat.title);
        const title = generateStructuredChatTitle(chatMessages, {
          existingTitles: otherTitles,
          fallbackTitle: hasAttachments
            ? `${validatedAttachments?.length ?? 0} file${(validatedAttachments?.length ?? 0) !== 1 ? 's' : ''} shared`
            : 'New Conversation',
        });

        await storage.updateChat(chatId, { title });
      }

      if (usage) {
        try {
          await storage.createUsageMetric({
            userId,
            chatId,
            model,
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          });
        } catch (metricError) {
          console.error('Failed to create usage metric:', metricError);
        }
      }

      // Track tool-level API usage (e.g. Perplexity web_search, deep_research)
      if (toolUsage && toolUsage.length > 0) {
        for (const tu of toolUsage) {
          try {
            await storage.createUsageMetric({
              userId,
              chatId,
              model: tu.model,
              promptTokens: tu.promptTokens,
              completionTokens: tu.completionTokens,
              totalTokens: tu.totalTokens,
            });
          } catch (metricError) {
            console.error(`Failed to create tool usage metric for ${tu.model}:`, metricError);
          }
        }
      }
    } catch (dbError) {
      console.error('Failed to save messages to storage:', dbError);
    }
  }

  // Health heartbeat — lightweight status endpoint (unauthenticated)
  const serverStartedAt = Date.now();
  let lastAgentRunAt: number | null = null;

  app.get('/api/health/heartbeat', async (_req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const tasks = await listTasks();
      const activeTasks = tasks.filter((t: any) => t.status === 'running' || t.status === 'pending');

      res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - serverStartedAt) / 1000),
        memoryUsage: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        activeTaskCount: activeTasks.length,
        lastAgentRunAt,
        registeredTools: toolRegistry.names(),
        toolCount: toolRegistry.names().length,
      });
    } catch (error) {
      res.json({
        status: 'degraded',
        uptime: Math.floor((Date.now() - serverStartedAt) / 1000),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Setup status — check if first-run setup is needed
  app.get('/api/auth/setup-status', async (_req, res) => {
    try {
      const hasAdmin = await storage.hasAdminUser();
      res.json({ needsSetup: !hasAdmin });
    } catch (error) {
      console.error('Setup status check error:', error);
      res.status(500).json({ error: 'Failed to check setup status' });
    }
  });

  // First-run setup — create the single user
  app.post('/api/setup', async (req, res) => {
    try {
      // Only allow if no users exist
      const hasAdmin = await storage.hasAdminUser();
      if (hasAdmin) {
        return res.status(403).json({ error: 'Setup already completed' });
      }

      const setupSchema = z.object({
        username: z.string().min(1, 'Username is required').max(50),
        password: z.string()
          .min(8, 'Password must be at least 8 characters')
          .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
          .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
          .regex(/[0-9]/, 'Password must contain at least one number'),
        email: z.string().email().optional().or(z.literal('')),
      });

      const { username, password, email } = setupSchema.parse(req.body);
      const hashedPassword = authService.hashPassword(password);

      const user = await storage.createUser({
        username,
        password: hashedPassword,
        email: email || null,
        avatar: null,
        plan: 'enterprise',
        proAccessCode: null,
        role: 'super_admin',
      });

      // Auto-login after setup
      req.session.userId = user.id;
      req.session.username = user.username ?? undefined;

      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error('Setup error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: 'Setup failed', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/auth/csrf-token', (req, res) => {
    // Token set and refreshed into XSRF-TOKEN cookie by attachCsrfToken middleware.
    // req.csrfToken is the canonical value — same as what's in the outgoing cookie.
    const token = (req as any).csrfToken as string;
    res.json({ csrfToken: token });
  });

  // Authentication routes
  // Login user
  app.post('/api/auth/login', async (req, res) => {
    try {
      const loginSchema = z.union([
        z.object({ identifier: z.string().min(1, 'Email or username is required'), password: z.string().min(1, 'Password is required') }),
        z.object({ email: z.string().email(), password: z.string().min(1, 'Password is required') }),
        z.object({ username: z.string().min(1, 'Username is required'), password: z.string().min(1, 'Password is required') }),
      ]);

      let parsed: z.infer<typeof loginSchema>;
      try {
        parsed = loginSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0].message });
        }
        return res.status(400).json({ error: 'Invalid login payload' });
      }

      const identifier = ((parsed as any).identifier ?? (parsed as any).email ?? (parsed as any).username ?? '').trim();
      if (!identifier) {
        return res.status(400).json({ error: 'Email or username is required' });
      }

      // Look up user by email or username
      let user = identifier.includes('@')
        ? await storage.getUserByEmail(identifier.toLowerCase())
        : await storage.getUserByUsername(identifier);
      if (!user && identifier.includes('@')) {
        user = await storage.getUserByUsername(identifier);
      }
      if (!user && !identifier.includes('@')) {
        user = await storage.getUserByEmail(identifier.toLowerCase());
      }

      if (!user || !user.password) {
        return res.status(401).json({ error: 'Invalid email/username or password' });
      }

      // Verify password
      const verification = authService.verifyPassword(parsed.password, user.password);
      if (!verification.isValid) {
        return res.status(401).json({ error: 'Invalid email/username or password' });
      }

      // Rehash if using legacy format
      if (verification.needsRehash) {
        const newHash = authService.hashPassword(parsed.password);
        await storage.updateUser(user.id, { password: newHash });
      }

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username ?? undefined;
      (req as any).user = user;

      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Logout user
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Failed to logout', detail: err instanceof Error ? err.message : String(err) });
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully' });
    });
  });

  // Get current user
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const normalized = await ensureAdminRole(req.user, storage) ?? req.user;
      if (normalized.role !== req.user.role) {
        await storage.updateUser(normalized.id, { role: normalized.role });
      }

      const { password: _, ...userWithoutPassword } = normalized;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user", detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/users/me/limits', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const limits = await authService.getUserLimits(userId);
      res.json(limits);
    } catch (error) {
      console.error('Failed to fetch user limits:', error);
      res.status(500).json({ error: 'Unable to load user limits', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/settings', requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      res.json({ settings });
    } catch (error) {
      console.error('Failed to load platform settings:', error);
      res.status(500).json({ error: 'Unable to load platform settings', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.put('/api/admin/settings', requireAuth, async (req, res) => {
    try {
      const payload = platformSettingsDataSchema.parse(req.body);
      const userId = (req as any).user?.id;
      const settings = await storage.upsertPlatformSettings(payload, userId);

      // Reconcile Telegram bot state whenever settings are saved
      reconcileTelegramBot(storage).catch((err) =>
        console.warn('[telegram] Reconcile after settings save failed:', err),
      );

      // Reconcile heartbeat scheduler whenever settings are saved
      reconcileHeartbeatScheduler(storage).catch((err) =>
        console.warn('[heartbeat] Reconcile after settings save failed:', err),
      );

      res.json({ settings });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid settings payload', details: error.errors });
      }
      console.error('Failed to update platform settings:', error);
      res.status(500).json({ error: 'Unable to update platform settings', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/settings/history', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 20), 50);
      const history = await storage.getSettingsHistory(limit);
      res.json({ history });
    } catch (error) {
      console.error('Failed to load settings history:', error);
      res.status(500).json({ error: 'Unable to load settings history' });
    }
  });

  app.post('/api/admin/settings/restore/:version', requireAuth, async (req, res) => {
    try {
      const version = Number(req.params.version);
      if (!Number.isFinite(version) || version < 1) {
        return res.status(400).json({ error: 'Invalid version number' });
      }
      const userId = (req as any).user?.id;
      const restored = await storage.restoreSettingsVersion(version, userId);
      if (!restored) {
        return res.status(404).json({ error: `Version ${version} not found in history` });
      }

      // Reconcile dependent services after restore
      reconcileTelegramBot(storage).catch((err) =>
        console.warn('[telegram] Reconcile after settings restore failed:', err),
      );
      reconcileHeartbeatScheduler(storage).catch((err) =>
        console.warn('[heartbeat] Reconcile after settings restore failed:', err),
      );

      res.json({ settings: restored });
    } catch (error) {
      console.error('Failed to restore settings version:', error);
      res.status(500).json({ error: 'Unable to restore settings version' });
    }
  });

  app.get('/api/admin/telegram/status', requireAuth, async (_req, res) => {
    res.json(getTelegramBotStatus());
  });

  // Heartbeat: manual trigger + status
  app.post('/api/admin/heartbeat/trigger', requireAuth, async (_req, res) => {
    // Validate there's something to run before firing off
    try {
      const settings = await storage.getPlatformSettings();
      const hb = (settings.data as any)?.heartbeat;
      if (!hb) {
        return res.status(400).json({ error: 'Heartbeat is not configured yet.' });
      }
      const enabledItems = (hb.scanItems ?? []).filter((i: any) => i.enabled);
      if (enabledItems.length === 0) {
        return res.status(400).json({ error: 'No scan items are enabled. Enable at least one item in the scan checklist.' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read heartbeat settings.' });
    }

    // Fire-and-forget — the full agent cycle can take 30–90 seconds
    runHeartbeatTick(storage).catch((err) => {
      console.error('[heartbeat] Manual trigger failed:', err instanceof Error ? err.message : err);
    });

    res.json({ ok: true, message: 'Heartbeat scan started. Results will appear in the Heartbeat conversation shortly.' });
  });

  app.get('/api/admin/heartbeat/status', requireAuth, async (_req, res) => {
    res.json(getHeartbeatStatus());
  });

  // Available agent tools (for admin UI toggle)
  // Available models (for admin UI selectors)
  app.get('/api/admin/available-models', requireAuth, async (_req, res) => {
    const { getAvailableModels, MODEL_CONFIG } = await import('./ai-models');
    const models = getAvailableModels().map(id => ({
      id,
      provider: MODEL_CONFIG[id]?.provider,
      supportsFunctions: MODEL_CONFIG[id]?.supportsFunctions ?? false,
    }));
    res.json({ models });
  });

  app.get('/api/admin/integrations/connections', requireAuth, async (_req, res) => {
    try {
      const connections = await storage.listAllOAuthConnections();
      res.json({ connections });
    } catch (error) {
      console.error('Failed to list integration connections:', error);
      res.status(500).json({ error: 'Unable to list integration connections' });
    }
  });


  app.get(
    '/api/admin/knowledge',
    requireAuth,
    async (_req, res) => {
      try {
        const users = await storage.listUsers();
        const knowledgeCounts = await Promise.all(users.map(u => storage.getKnowledgeItems(u.id)));
        const knowledgeItems = knowledgeCounts.reduce((sum, items) => sum + items.length, 0);
        const memories = await storage.listAgentMemories();
        const memoryItems = memories.length;
        res.json({
          knowledgeItems,
          memoryItems,
          knowledgeBase: { totalItems: knowledgeItems },
          memory: { totalMemories: memoryItems },
        });
      } catch {
        const summary = await adminDashboardService.getKnowledgeSummary();
        res.json(summary);
      }
    },
  );


  // Tool Error Logs
  app.get('/api/admin/tool-errors', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const errors = await storage.listToolErrors(limit);
      res.json({ errors });
    } catch (error) {
      console.error('Failed to fetch tool errors:', error);
      res.status(500).json({ error: 'Failed to fetch tool errors' });
    }
  });

  app.delete('/api/admin/tool-errors', requireAuth, async (_req, res) => {
    try {
      await storage.clearToolErrors();
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to clear tool errors:', error);
      res.status(500).json({ error: 'Failed to clear tool errors' });
    }
  });

  app.get('/api/admin/system-prompts', requireAuth, async (_req, res) => {
    try {
      const prompts = await storage.listSystemPrompts();
      const active = prompts.find(prompt => prompt.isActive) ?? (await storage.getActiveSystemPrompt()) ?? null;

      res.json({
        systemPrompts: prompts.map(serializeSystemPrompt),
        activeSystemPromptId: active ? active.id : null,
      });
    } catch (error) {
      console.error('Failed to load system prompts:', error);
      res.status(500).json({ error: 'Unable to load system prompts', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/system-prompts', requireAuth, async (req, res) => {
    try {
      const payload = systemPromptCreateSchema.parse(req.body);
      const actorId = (req as any).user?.id ?? null;
      const created = await storage.createSystemPrompt({
        content: payload.content,
        label: payload.label ?? null,
        notes: payload.notes ?? null,
        createdByUserId: actorId,
        activate: payload.activate ?? false,
        activatedByUserId: payload.activate ? actorId : null,
      });

      const prompts = await storage.listSystemPrompts();
      const active = prompts.find(prompt => prompt.isActive) ?? null;
      const createdRecord = prompts.find(prompt => prompt.id === created.id) ?? created;

      res.status(201).json({
        systemPrompt: serializeSystemPrompt(createdRecord),
        systemPrompts: prompts.map(serializeSystemPrompt),
        activeSystemPromptId: active ? active.id : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid system prompt payload', details: error.errors });
      }
      console.error('Failed to create system prompt:', error);
      res.status(500).json({ error: 'Unable to create system prompt', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.patch('/api/admin/system-prompts/:id', requireAuth, async (req, res) => {
    try {
      const payload = systemPromptUpdateSchema.parse(req.body);
      const promptId = req.params.id;
      const actorId = (req as any).user?.id ?? null;

      const existing = await storage.getSystemPrompt(promptId);
      if (!existing) {
        return res.status(404).json({ error: 'System prompt not found' });
      }

      let updated = existing;

      const updates: { content?: string; label?: string | null; notes?: string | null } = {};
      if (payload.content !== undefined) {
        updates.content = payload.content;
      }
      if (payload.label !== undefined) {
        updates.label = payload.label;
      }
      if (payload.notes !== undefined) {
        updates.notes = payload.notes;
      }

      if (Object.keys(updates).length > 0) {
        const result = await storage.updateSystemPrompt(promptId, updates);
        if (!result) {
          return res.status(404).json({ error: 'System prompt not found' });
        }
        updated = result;
      }

      if (payload.activate) {
        const activated = await storage.activateSystemPrompt(promptId, actorId);
        if (!activated) {
          return res.status(404).json({ error: 'System prompt not found' });
        }
        updated = activated;
      }

      const prompts = await storage.listSystemPrompts();
      const active = prompts.find(prompt => prompt.isActive) ?? null;

      res.json({
        systemPrompt: serializeSystemPrompt(updated),
        systemPrompts: prompts.map(serializeSystemPrompt),
        activeSystemPromptId: active ? active.id : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid system prompt payload', details: error.errors });
      }
      console.error('Failed to update system prompt:', error);
      res.status(500).json({ error: 'Unable to update system prompt', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.delete('/api/admin/system-prompts/:id', requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteSystemPrompt(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'System prompt not found or is currently active (cannot delete active prompt)' });
      }
      const prompts = await storage.listSystemPrompts();
      const active = prompts.find(p => p.isActive) ?? null;
      res.json({ systemPrompts: prompts.map(serializeSystemPrompt), activeSystemPromptId: active?.id ?? null });
    } catch (error) {
      console.error('Failed to delete system prompt:', error);
      res.status(500).json({ error: 'Failed to delete system prompt' });
    }
  });

  app.get('/api/admin/releases', requireAuth, async (_req, res) => {
    try {
      const releases = await storage.listReleases();
      const active = releases.find((release) => release.isActive) ?? (await storage.getActiveRelease()) ?? null;

      res.json({
        releases: releases.map(serializeRelease),
        activeReleaseId: active ? active.id : null,
      });
    } catch (error) {
      console.error('Failed to load releases:', error);
      res.status(500).json({ error: 'Unable to load releases', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/releases', requireAuth, async (req, res) => {
    try {
      const payload = releaseCreateSchema.parse(req.body);
      const created = await storage.createRelease({
        label: payload.label,
        systemPromptId: payload.systemPromptId ?? null,
        assistantIds: payload.assistantIds ?? [],
        templateIds: payload.templateIds ?? [],
        outputTemplateIds: payload.outputTemplateIds ?? [],
        toolPolicyIds: payload.toolPolicyIds ?? [],
        changeNotes: payload.changeNotes ?? null,
      });

      const releases = await storage.listReleases();
      const active = releases.find((release) => release.isActive) ?? null;

      res.status(201).json({
        release: serializeRelease(created),
        releases: releases.map(serializeRelease),
        activeReleaseId: active ? active.id : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid release payload', details: error.errors });
      }
      console.error('Failed to create release:', error);
      res.status(500).json({ error: 'Unable to create release', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/releases/:id/publish', requireAuth, async (req, res) => {
    try {
      const payload = releaseTransitionSchema.parse(req.body);
      const actorId = (req as any).user?.id ?? null;
      const releaseId = req.params.id;

      const updated = await storage.publishRelease(releaseId, {
        changeNotes: payload.changeNotes,
        actorUserId: actorId,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Release not found' });
      }

      const releases = await storage.listReleases();
      const active = releases.find((release) => release.isActive) ?? updated;

      res.json({
        release: serializeRelease(updated),
        releases: releases.map(serializeRelease),
        activeReleaseId: active ? active.id : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid release payload', details: error.errors });
      }
      console.error('Failed to publish release:', error);
      res.status(500).json({ error: 'Unable to publish release', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/releases/:id/rollback', requireAuth, async (req, res) => {
    try {
      const payload = releaseTransitionSchema.parse(req.body);
      const actorId = (req as any).user?.id ?? null;
      const releaseId = req.params.id;

      const updated = await storage.rollbackRelease(releaseId, {
        changeNotes: payload.changeNotes,
        actorUserId: actorId,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Release not found' });
      }

      const releases = await storage.listReleases();
      const active = releases.find((release) => release.isActive) ?? updated;

      res.json({
        release: serializeRelease(updated),
        releases: releases.map(serializeRelease),
        activeReleaseId: active ? active.id : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid release payload', details: error.errors });
      }
      console.error('Failed to rollback release:', error);
      res.status(500).json({ error: 'Unable to rollback release', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/templates', requireAuth, async (_req, res) => {
    try {
      const templates = await storage.listTemplates();
      res.json({ templates: templates.map(serializeTemplate) });
    } catch (error) {
      console.error('Failed to list templates:', error);
      res.status(500).json({ error: 'Unable to load templates', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/templates', requireAuth, async (req, res) => {
    try {
      const payload = templateCreateSchema.parse(req.body);
      const buffer = Buffer.from(payload.file.data, 'base64');
      if (!Number.isFinite(buffer.length)) {
        return res.status(400).json({ error: 'Invalid template file payload' });
      }
      if (buffer.byteLength > TEMPLATE_MAX_SIZE_BYTES) {
        const maxMb = Math.floor(TEMPLATE_MAX_SIZE_BYTES / (1024 * 1024));
        return res.status(413).json({ error: `Template files must be ${maxMb}MB or smaller.` });
      }

      const attachment = await storage.saveFile(
        TEMPLATE_FILE_OWNER,
        buffer,
        payload.file.name,
        payload.file.mimeType,
      );

      try {
        const template = await storage.createTemplate({
          name: payload.name,
          description: payload.description ?? null,
          fileId: attachment.id,
          fileName: payload.file.name,
          mimeType: payload.file.mimeType,
          fileSize: attachment.size,
          availableForFree: payload.availableForFree ?? false,
          availableForPro: payload.availableForPro ?? true,
          isActive: payload.isActive ?? true,
        });

        res.status(201).json({ template: serializeTemplate(template) });
      } catch (createError) {
        await storage.deleteFile(attachment.id, TEMPLATE_FILE_OWNER).catch(() => {});
        throw createError;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid template payload', details: error.errors });
      }
      console.error('Failed to create template:', error);
      res.status(500).json({ error: 'Unable to create template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.patch('/api/admin/templates/:id', requireAuth, async (req, res) => {
    try {
      const payload = templateUpdateSchema.parse(req.body);
      const templateId = req.params.id;
      const existing = await storage.getTemplate(templateId);

      if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
      }

      let newAttachment: { id: string; size: number } | null = null;
      let previousFileId: string | null = null;

      if (payload.file) {
        const buffer = Buffer.from(payload.file.data, 'base64');
        if (!Number.isFinite(buffer.length)) {
          return res.status(400).json({ error: 'Invalid template file payload' });
        }
        if (buffer.byteLength > TEMPLATE_MAX_SIZE_BYTES) {
          const maxMb = Math.floor(TEMPLATE_MAX_SIZE_BYTES / (1024 * 1024));
          return res.status(413).json({ error: `Template files must be ${maxMb}MB or smaller.` });
        }

        const attachment = await storage.saveFile(
          TEMPLATE_FILE_OWNER,
          buffer,
          payload.file.name,
          payload.file.mimeType,
        );
        newAttachment = { id: attachment.id, size: attachment.size };
        previousFileId = existing.fileId;
      }

      const updates: Partial<InsertTemplate> = {};
      if (payload.name !== undefined) {
        updates.name = payload.name;
      }
      if (payload.description !== undefined) {
        updates.description = payload.description ?? null;
      }
      if (payload.availableForFree !== undefined) {
        updates.availableForFree = payload.availableForFree;
      }
      if (payload.availableForPro !== undefined) {
        updates.availableForPro = payload.availableForPro;
      }
      if (payload.isActive !== undefined) {
        updates.isActive = payload.isActive;
      }
      if (newAttachment && payload.file) {
        updates.fileId = newAttachment.id;
        updates.fileName = payload.file.name;
        updates.mimeType = payload.file.mimeType;
        updates.fileSize = newAttachment.size;
      }

      const updated = await storage.updateTemplate(templateId, updates);
      if (!updated) {
        if (newAttachment) {
          await storage.deleteFile(newAttachment.id, TEMPLATE_FILE_OWNER).catch(() => {});
        }
        return res.status(404).json({ error: 'Template not found' });
      }

      if (newAttachment && previousFileId) {
        await storage.deleteFile(previousFileId, TEMPLATE_FILE_OWNER).catch(() => {});
      }

      res.json({ template: serializeTemplate(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid template payload', details: error.errors });
      }
      console.error('Failed to update template:', error);
      res.status(500).json({ error: 'Unable to update template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.delete('/api/admin/templates/:id', requireAuth, async (req, res) => {
    try {
      const templateId = req.params.id;
      const existing = await storage.getTemplate(templateId);
      if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const deleted = await storage.deleteTemplate(templateId);
      if (!deleted) {
        return res.status(404).json({ error: 'Template not found' });
      }

      await storage.deleteFile(existing.fileId, TEMPLATE_FILE_OWNER).catch(() => {});
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete template:', error);
      res.status(500).json({ error: 'Unable to delete template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/templates/:id/file', requireAuth, async (req, res) => {
    try {
      const templateId = req.params.id;
      const template = await storage.getTemplate(templateId);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const file = await storage.getFileForUser(template.fileId, TEMPLATE_FILE_OWNER);
      if (!file) {
        return res.status(404).json({ error: 'Template file not found' });
      }

      res.set({
        'Content-Type': file.mimeType,
        'Content-Length': file.size.toString(),
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Cache-Control': 'private, max-age=60',
      });
      res.send(file.buffer);
    } catch (error) {
      console.error('Failed to fetch template file:', error);
      res.status(500).json({ error: 'Unable to fetch template file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/output-templates', requireAuth, async (_req, res) => {
    try {
      const templates = await storage.listOutputTemplates();
      res.json({ templates: templates.map(serializeOutputTemplate) });
    } catch (error) {
      console.error('Failed to list output templates:', error);
      res.status(500).json({ error: 'Unable to load output templates', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/output-templates', requireAuth, async (req, res) => {
    try {
      const payload = outputTemplateCreateSchema.parse(req.body);
      const template = await storage.createOutputTemplate({
        name: payload.name,
        category: payload.category,
        format: payload.format,
        description: payload.description ?? null,
        instructions: payload.instructions ?? null,
        requiredSections: payload.requiredSections,
        isActive: payload.isActive ?? true,
      });

      res.status(201).json({ template: serializeOutputTemplate(template) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid output template payload', details: error.errors });
      }
      console.error('Failed to create output template:', error);
      res.status(500).json({ error: 'Unable to create output template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.patch('/api/admin/output-templates/:id', requireAuth, async (req, res) => {
    try {
      const payload = outputTemplateUpdateSchema.parse(req.body);
      const templateId = req.params.id;
      const updated = await storage.updateOutputTemplate(templateId, payload);

      if (!updated) {
        return res.status(404).json({ error: 'Output template not found' });
      }

      res.json({ template: serializeOutputTemplate(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid output template payload', details: error.errors });
      }
      console.error('Failed to update output template:', error);
      res.status(500).json({ error: 'Unable to update output template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.delete('/api/admin/output-templates/:id', requireAuth, async (req, res) => {
    try {
      const templateId = req.params.id;
      const deleted = await storage.deleteOutputTemplate(templateId);
      if (!deleted) {
        return res.status(404).json({ error: 'Output template not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete output template:', error);
      res.status(500).json({ error: 'Unable to delete output template', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Assistant endpoints - Admin CRUD
  app.get(
    '/api/admin/assistant-metrics',
    requireAuth,
    async (_req, res) => {
      try {
        const assistants = await storage.listAssistants();
        const metrics = buildAssistantMetrics(assistants);

        res.json({
          totalAssistants: metrics.total,
          activeAssistants: metrics.active,
          inactiveAssistants: metrics.inactive,
          typeBreakdown: metrics.typeBreakdown,
        });
      } catch (error) {
        console.error('Failed to load assistant metrics:', error);
        res.status(500).json({
          error: 'Unable to load assistant metrics',
          detail: error instanceof Error ? error.message : undefined,
        });
      }
    },
  );

  app.get('/api/admin/assistants', requireAuth, async (_req, res) => {
    try {
      const assistants = await storage.listAssistants();
      res.json({ assistants });
    } catch (error) {
      console.error('Failed to list assistants:', error);
      res.status(500).json({ error: 'Unable to load assistants', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/assistants', requireAuth, async (req, res) => {
    try {
      const payload = insertAssistantSchema.parse(req.body);
      const targetType = (payload.type ?? 'prompt') as AssistantType;
      const assistant = await storage.createAssistant(normalizeAssistantFields(payload, targetType));
      res.status(201).json({ assistant });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid assistant payload', details: error.errors });
      }
      console.error('Failed to create assistant:', error);
      res.status(500).json({ error: 'Unable to create assistant', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.patch('/api/admin/assistants/:id', requireAuth, async (req, res) => {
    try {
      const assistantId = req.params.id;
      const existing = await storage.getAssistant(assistantId);

      if (!existing) {
        return res.status(404).json({ error: 'Assistant not found' });
      }

      const payload = updateAssistantSchema.parse(req.body);
      const targetType = (payload.type ?? existing.type) as AssistantType;
      const assistant = await storage.updateAssistant(assistantId, normalizeAssistantFields(payload, targetType));

      if (!assistant) {
        return res.status(404).json({ error: 'Assistant not found' });
      }

      res.json({ assistant });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid assistant update payload', details: error.errors });
      }
      console.error('Failed to update assistant:', error);
      res.status(500).json({ error: 'Unable to update assistant', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.delete('/api/admin/assistants/:id', requireAuth, async (req, res) => {
    try {
      const assistantId = req.params.id;
      const deleted = await storage.deleteAssistant(assistantId);

      if (!deleted) {
        return res.status(404).json({ error: 'Assistant not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      res.status(500).json({ error: 'Unable to delete assistant', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/admin/available-tools', requireAuth, async (_req, res) => {
    try {
      const tools = toolRegistry.list().map((t) => ({
        name: t.name,
        description: t.description,
      }));
      res.json({ tools });
    } catch (error) {
      console.error('Failed to list available tools:', error);
      res.status(500).json({ error: 'Unable to load available tools' });
    }
  });

  app.get('/api/admin/tool-policies', requireAuth, async (_req, res) => {
    try {
      const policies = await storage.listToolPolicies();
      res.json({ toolPolicies: policies.map(formatToolPolicy) });
    } catch (error) {
      console.error('Failed to list tool policies:', error);
      res.status(500).json({ error: 'Unable to load tool policies', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/admin/tool-policies', requireAuth, async (req, res) => {
    try {
      const result = toolPolicyCreateSchema.safeParse(req.body);
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({ error: 'Invalid tool policy payload', detail: issue?.message ?? 'Validation failed' });
      }

      const payload = result.data;
      const insertPayload: InsertToolPolicy = {
        provider: payload.provider,
        toolName: payload.toolName,
        isEnabled: payload.isEnabled ?? true,
        safetyNote: payload.safetyNote?.trim() ? payload.safetyNote.trim() : null,
      };

      const toolPolicy = await storage.createToolPolicy(insertPayload);
      res.status(201).json({ toolPolicy: formatToolPolicy(toolPolicy) });
    } catch (error) {
      if (isToolPolicyConflictError(error)) {
        return res.status(409).json({ error: 'A tool policy already exists for this provider and tool.' });
      }
      console.error('Failed to create tool policy:', error);
      res.status(500).json({ error: 'Unable to create tool policy', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.patch('/api/admin/tool-policies/:id', requireAuth, async (req, res) => {
    try {
      const result = toolPolicyUpdateSchema.safeParse(req.body);
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({ error: 'Invalid tool policy payload', detail: issue?.message ?? 'Validation failed' });
      }

      const payload = result.data;
      const updates: UpdateToolPolicy = {};

      if (payload.provider !== undefined) {
        updates.provider = payload.provider;
      }
      if (payload.toolName !== undefined) {
        updates.toolName = payload.toolName;
      }
      if (payload.isEnabled !== undefined) {
        updates.isEnabled = payload.isEnabled;
      }
      if (payload.safetyNote !== undefined) {
        updates.safetyNote = payload.safetyNote === null
          ? null
          : payload.safetyNote.trim()
            ? payload.safetyNote.trim()
            : null;
      }

      const updatedPolicy = await storage.updateToolPolicy(req.params.id, updates);
      if (!updatedPolicy) {
        return res.status(404).json({ error: 'Tool policy not found' });
      }

      res.json({ toolPolicy: formatToolPolicy(updatedPolicy) });
    } catch (error) {
      if (isToolPolicyConflictError(error)) {
        return res.status(409).json({ error: 'A tool policy already exists for this provider and tool.' });
      }
      console.error('Failed to update tool policy:', error);
      res.status(500).json({ error: 'Unable to update tool policy', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.delete('/api/admin/tool-policies/:id', requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteToolPolicy(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Tool policy not found' });
      }
      res.status(204).end();
    } catch (error) {
      console.error('Failed to delete tool policy:', error);
      res.status(500).json({ error: 'Unable to delete tool policy', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // POST /api/auth/change-password - Change password (authenticated users)
  app.post('/api/auth/change-password', isAuthenticated, async (req: any, res) => {
    try {
      const changePasswordSchema = z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z.string()
          .min(8, 'Password must be at least 8 characters')
          .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
          .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
          .regex(/[0-9]/, 'Password must contain at least one number'),
      });

      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      // Get current user
      const userId = req.user.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      if (!user.password) {
        return res.status(400).json({ error: 'Password authentication is not enabled for this account' });
      }

      const passwordCheck = authService.verifyPassword(currentPassword, user.password);
      if (!passwordCheck.isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      // Hash the new password
      const hashedPassword = authService.hashPassword(newPassword);

      // Update user's password
      const updatedUser = await storage.updateUser(userId, {
        password: hashedPassword,
      });

      if (!updatedUser) {
        return res.status(500).json({
          error: 'Failed to update password',
          detail: 'Password update did not persist to the database.',
        });
      }

      console.log(`Password successfully changed for user ${userId}`);

      res.json({ 
        message: 'Your password has been successfully changed.' 
      });
    } catch (error) {
      console.error('Change password error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: 'Failed to change password', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Audio transcription endpoint
  app.post('/api/transcribe', isAuthenticated, async (req, res) => {
    try {
      const transcribeSchema = z.object({
        audio: z.string(), // Base64 encoded audio data
        format: z.string().optional().default('webm'),
      });

      const { audio, format } = transcribeSchema.parse(req.body);

      // Validate audio size (max ~5MB base64 = ~3.75MB actual)
      const maxBase64Length = 5 * 1024 * 1024; // 5MB base64
      if (audio.length > maxBase64Length) {
        return res.status(413).json({ error: 'Audio file too large. Maximum 5MB allowed.' });
      }

      // Decode base64 audio
      const audioBuffer = Buffer.from(audio, 'base64');

      // Resolve STT API key via media routing (default → fallback → env var)
      const settingsRecord = await storage.getPlatformSettings();
      const sttRouting = settingsRecord.data.mediaRouting?.stt;
      const sttProviders = settingsRecord.data.sttProviders ?? {};

      const trySttProvider = (id: string | null | undefined) => {
        if (!id) return null;
        const p = (sttProviders as Record<string, any>)[id];
        return (p?.enabled && p?.defaultApiKey) ? p.defaultApiKey : null;
      };

      const groqKey = trySttProvider(sttRouting?.defaultProvider ?? 'groq-whisper')
        ?? trySttProvider(sttRouting?.fallbackProvider)
        ?? (settingsRecord.data.apiProviders?.groq as any)?.defaultApiKey
        ?? process.env.GROQ_API_KEY
        ?? '';

      // Transcribe using Groq Whisper
      const result = await transcribeAudio(audioBuffer, format, groqKey || undefined);

      res.json(result);
    } catch (error) {
      console.error('Transcription error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid audio data', details: error.errors });
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Transcription failed',
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  });

  const resolveVoiceMimeType = (format: 'mp3' | 'wav' | undefined): string => {
    if (format === 'wav') {
      return 'audio/wav';
    }
    return 'audio/mpeg';
  };

  const voiceStreamSchema = z.object({
    text: z.string().min(1, 'text is required for voice synthesis'),
    voice: z.string().optional(),
    model: z.string().optional(),
    format: z.enum(['mp3', 'wav']).optional().default('mp3'),
    target: z.enum(['assistant', 'preview', 'phone']).optional().default('assistant'),
  });

  app.post('/api/voice/stream', requireAuth, async (req, res) => {
    try {
      const voiceRequest = voiceStreamSchema.parse(req.body ?? {});
      const clipId = randomUUID();
      const mimeType = resolveVoiceMimeType(voiceRequest.format);

      // Resolve TTS API key via media routing (default → fallback → env var)
      const ttsSettings = await storage.getPlatformSettings();
      const ttsRouting = ttsSettings.data.mediaRouting?.tts;
      const ttsProviders = ttsSettings.data.ttsProviders ?? {};

      const tryTtsProvider = (id: string | null | undefined) => {
        if (!id) return null;
        const p = (ttsProviders as Record<string, any>)[id];
        return (p?.enabled && p?.defaultApiKey) ? p.defaultApiKey : null;
      };

      const ttsApiKey = tryTtsProvider(ttsRouting?.defaultProvider ?? 'openai-realtime')
        ?? tryTtsProvider(ttsRouting?.fallbackProvider)
        ?? null;

      res.status(200);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Voice-Clip-Id', clipId);
      res.setHeader('X-Voice-Target', voiceRequest.target);
      res.setHeader('X-Voice-Text', Buffer.from(voiceRequest.text).toString('base64'));
      if (voiceRequest.model) {
        res.setHeader('X-Voice-Model', voiceRequest.model);
      }
      if (voiceRequest.voice) {
        res.setHeader('X-Voice-Voice', voiceRequest.voice);
      }
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      let connectionClosed = false;
      const handleClose = () => {
        connectionClosed = true;
      };
      req.on('close', handleClose);

      try {
        await streamClause(
          { id: clipId, text: voiceRequest.text, voiceId: voiceRequest.voice, format: voiceRequest.format },
          {
            apiKey: ttsApiKey ?? undefined,
            model: voiceRequest.model,
            voice: voiceRequest.voice,
            format: voiceRequest.format,
            onChunk: chunk => {
              if (connectionClosed) {
                return;
              }
              res.write(chunk);
            },
          },
        );

        if (!connectionClosed) {
          res.end();
        }
      } finally {
        if (typeof (req as any).off === 'function') {
          (req as any).off('close', handleClose);
        } else {
          req.removeListener('close', handleClose);
        }
      }
    } catch (error) {
      console.error('Failed to stream OpenAI voice audio:', error);
      if (!res.headersSent) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: 'Invalid voice request payload', details: error.errors });
        }
        const message = error instanceof Error ? error.message : 'Voice synthesis failed';
        return res.status(500).json({ error: message });
      }
      try {
        res.end();
      } catch {
        // ignore secondary failures
      }
    }
  });

  // File upload endpoint with analysis
  app.post('/api/uploads', requireAuth, rateLimitMiddleware(30, 60_000, 'uploads'), async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const fileUploadSchema = z.object({
        name: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        data: z.string(), // Base64 encoded file data
        analyze: z.boolean().optional().default(true), // Whether to analyze content
      });

      const { name, mimeType, data, analyze } = fileUploadSchema.parse(req.body);
      
      // Decode base64 data
      const buffer = Buffer.from(data, 'base64');

      const userPlan = normalizeUserPlan((req as any).user.plan);
      const limitMb = resolveFileUploadLimitMb(userPlan);
      const projectLimitBytes = getProjectUploadLimitBytes(userPlan);
      // null means unlimited — only enforce if a limit is set
      if (projectLimitBytes !== null || limitMb !== null) {
        const maxSize = projectLimitBytes ?? (limitMb! * 1024 * 1024);
        const readableMax = formatFileUploadLimitLabel(limitMb);
        if (buffer.length > maxSize) {
          return res.status(400).json({
            error: `File too large. Maximum size is ${readableMax}.`
          });
        }
      }
      
      let analyzedContent: string | undefined;
      let analysisMetadata: Record<string, unknown> | null = null;
      
      // Analyze file content if requested
      if (analyze) {
        try {
          const analysisResult = await fileAnalysisService.analyzeFile(buffer, name, mimeType);
          analyzedContent = analysisResult.content;
          analysisMetadata = {
            ...analysisResult.metadata,
            summary: analysisResult.summary
          };
        } catch (analysisError) {
          console.warn('File analysis failed:', analysisError);
          // Continue without analysis if it fails
          analysisMetadata = {
            analysisError: analysisError instanceof Error ? analysisError.message : 'Analysis failed'
          };
        }
      }

      // Save file to storage with analysis results
      const attachment = await storage.saveFile(
        userId,
        buffer,
        name,
        mimeType,
        analyzedContent,
        analysisMetadata,
      );

      // Include analysis summary in response if available
      const response = {
        ...attachment,
        ...(analyzedContent && {
          hasAnalysis: true,
          contentPreview: analyzedContent.slice(0, 500) + (analyzedContent.length > 500 ? '...' : ''),
          metadata: analysisMetadata
        })
      };
      
      res.json(response);
    } catch (error) {
      if (error instanceof FileQuotaExceededError) {
        return res.status(413).json({ error: error.message });
      }
      console.error('File upload error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid file data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to upload file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // File serving endpoint
  app.get('/api/files/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const file = await storage.getFileForUser(id, userId);

      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Security: Define safe MIME types that can be displayed inline
      const safeMimeTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm',
        'application/pdf',
        'text/plain'
      ];

      // Security: Block dangerous MIME types
      const dangerousMimeTypes = [
        'text/html', 'application/xhtml+xml',
        'image/svg+xml',
        'application/javascript', 'text/javascript'
      ];

      const mimeType = file.mimeType.toLowerCase();
      const isSafe = safeMimeTypes.includes(mimeType);
      const isDangerous = dangerousMimeTypes.some(dangerous => mimeType === dangerous);

      // Security headers
      const headers: Record<string, string> = {
        'Content-Length': file.size.toString(),
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none';"
      };

      // Force download for unsafe or dangerous files
      if (!isSafe || isDangerous) {
        headers['Content-Type'] = 'application/octet-stream';
        headers['Content-Disposition'] = `attachment; filename="${file.name}"`;
      } else {
        headers['Content-Type'] = file.mimeType;
        headers['Content-Disposition'] = `inline; filename="${file.name}"`;
      }
      
      res.set(headers);
      res.send(file.buffer);
    } catch (error) {
      console.error('File serving error:', error);
      res.status(500).json({ error: 'Failed to serve file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Get file analysis content
  app.get('/api/files/:id/analysis', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const file = await storage.getFileForUser(id, userId);

      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      if (!file.analyzedContent) {
        return res.status(404).json({ error: 'No analysis available for this file' });
      }
      
      res.json({
        id: file.id,
        name: file.name,
        content: file.analyzedContent,
        metadata: file.metadata
      });
    } catch (error) {
      console.error('File analysis serving error:', error);
      res.status(500).json({ error: 'Failed to serve file analysis', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Chat completion endpoint
  app.post('/api/chat/completions', requireAuth, rateLimitMiddleware(60, 60_000, 'chat'), async (req, res) => {
    try {
      const prepared = await prepareChatCompletionRequest(req);

      if (!prepared.hasContent && !prepared.hasAttachments) {
        throw new HttpError(400, 'Message must have content or attachments');
      }

      let response: Awaited<ReturnType<typeof aiService.getChatCompletion>> | null = null;

      const modelTemperature = getModelTemperature(prepared.model);

      if (prepared.shouldCallAI) {
        response = await aiService.getChatCompletion({
          model: prepared.model,
          messages: prepared.enrichedMessages,
          userId: prepared.userId,
          projectId: prepared.chatProjectId,
          assistantId: prepared.assistantId,
          assistantType: prepared.assistantType,
          maxTokens: 4000,
          temperature: modelTemperature,
          metadata: prepared.metadata,
        });
      }

      const validationResult = response && prepared.outputTemplate && response.content
        ? validateOutputTemplateContent(prepared.outputTemplate, response.content)
        : null;

      const assistantMetadata = response
        ? buildAssistantMetadata({
            baseMetadata: prepared.metadata,
            outputTemplate: prepared.outputTemplate,
            executedTools: response.executedTools,
            thinkingContent: response.thinkingContent,
            validation: validationResult,
          })
        : undefined;

      const responseMetadata = prepared.assistantId
        ? {
            ...(assistantMetadata ?? {}),
            assistantId: prepared.assistantId,
            ...(prepared.assistantType ? { assistantType: prepared.assistantType } : {}),
          }
        : assistantMetadata;

      await persistChatMessages({
        chatId: prepared.chatId,
        userId: prepared.userId,
        metadata: prepared.metadata,
        validatedAttachments: prepared.validatedAttachments,
        hasAttachments: prepared.hasAttachments,
        lastMessageContent: prepared.lastMessage.content,
        model: prepared.model,
        responseContent: response?.content ?? (prepared.hasAttachments ? 'Files received successfully.' : null),
        responseMetadata,
        usage: response?.usage,
      });

      if (response) {
        res.json({
          ...response,
          ...(responseMetadata ? { metadata: responseMetadata } : {}),
        });
      } else {
        res.json({
          content: prepared.hasAttachments ? 'Files received successfully.' : 'Message received.',
          role: 'assistant',
        });
      }
    } catch (error) {
      console.error('Chat completion error:', error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  });

  app.post('/api/chat/completions/stream', requireAuth, rateLimitMiddleware(60, 60_000, 'chat'), async (req, res) => {
    let connectionClosed = false;
    let sendEvent: ((event: string, data: Record<string, unknown>) => void) | null = null;

    const endConnection = () => {
      if (!connectionClosed) {
        connectionClosed = true;
        res.end();
      }
    };

    try {
      const prepared = await prepareChatCompletionRequest(req);

      if (!prepared.hasContent && !prepared.hasAttachments) {
        throw new HttpError(400, 'Message must have content or attachments');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      req.on('close', () => {
        connectionClosed = true;
      });

      sendEvent = (event: string, data: Record<string, unknown>) => {
        if (connectionClosed) {
          return;
        }
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // SSE keepalive — send a comment ping every 25s to prevent proxy/socket timeouts
      // on long-running agent tasks (tool chains, deep research, etc.)
      const keepAliveTimer = setInterval(() => {
        if (!connectionClosed) {
          res.write(': ping\n\n');
        }
      }, 25000);
      const clearKeepAlive = () => clearInterval(keepAliveTimer);
      req.on('close', clearKeepAlive);
      res.on('finish', clearKeepAlive);

      // ─── /usage slash command — bypass AI, return Claude Code account info ───
      if (prepared.lastMessage?.content?.trim() === '/usage') {
        const usageContent = await (async () => {
          try {
            const relayHost = process.env.CLAUDE_CODE_HOST ?? 'claude-code';
            const relayPort = process.env.CLAUDE_CODE_PORT ?? '3333';
            const resp = await fetch(`http://${relayHost}:${relayPort}/usage`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const d: any = await resp.json();
            const u = d.usage ?? {};

            const fmtUtil = (pct: number | null | undefined) =>
              pct != null ? `${pct}%` : '—';

            const fmtReset = (iso: string | null | undefined) => {
              if (!iso) return '';
              const ms = new Date(iso).getTime() - Date.now();
              if (ms <= 0) return 'soon';
              const h = Math.floor(ms / 3600000);
              const m = Math.floor((ms % 3600000) / 60000);
              const d = Math.floor(h / 24);
              if (d >= 1) return `${d}d ${h % 24}h`;
              if (h >= 1) return `${h}h ${m}m`;
              return `${m}m`;
            };

            const bar = (pct: number | null | undefined, width = 20) => {
              const p = Math.min(100, Math.max(0, pct ?? 0));
              const filled = Math.round((p / 100) * width);
              return '█'.repeat(filled) + '░'.repeat(width - filled);
            };

            const lines: string[] = [
              `## Claude Code — Usage`,
              ``,
              `**Account:** ${d.name} (${d.email})`,
              `**Plan:** ${d.plan}${d.hasMax ? ' · ✅ Max active' : ''}`,
              ``,
            ];

            if (u.five_hour) {
              const pct = u.five_hour.utilization;
              lines.push(`**Session (5hr)**`);
              lines.push(`\`${bar(pct)}\` ${fmtUtil(pct)}`);
              lines.push(`Resets in ${fmtReset(u.five_hour.resets_at)}`);
              lines.push(``);
            }

            if (u.seven_day) {
              const pct = u.seven_day.utilization;
              lines.push(`**Weekly (7 day)**`);
              lines.push(`\`${bar(pct)}\` ${fmtUtil(pct)}`);
              lines.push(`Resets in ${fmtReset(u.seven_day.resets_at)}`);
              lines.push(``);
            }

            if (u.seven_day_sonnet) {
              const pct = u.seven_day_sonnet.utilization;
              lines.push(`**Weekly Sonnet**`);
              lines.push(`\`${bar(pct)}\` ${fmtUtil(pct)}`);
              lines.push(`Resets in ${fmtReset(u.seven_day_sonnet.resets_at)}`);
              lines.push(``);
            }

            if (u.seven_day_opus) {
              const pct = u.seven_day_opus.utilization;
              lines.push(`**Weekly Opus**`);
              lines.push(`\`${bar(pct)}\` ${fmtUtil(pct)}`);
              lines.push(`Resets in ${fmtReset(u.seven_day_opus.resets_at)}`);
              lines.push(``);
            }

            if (u.extra_usage?.is_enabled) {
              const ex = u.extra_usage;
              lines.push(`**Extra Usage (overflow)**`);
              lines.push(`Used: $${(ex.used_credits ?? 0).toFixed(2)} / $${ex.monthly_limit ?? '?'} monthly cap`);
              lines.push(``);
            }

            return lines.join('\n').trimEnd();
          } catch (e: any) {
            return `❌ Could not fetch Claude Code usage: ${e.message}\n\nMake sure the Claude Code container is running and authenticated.`;
          }
        })();

        sendEvent?.('text_delta', { text: usageContent });
        await persistChatMessages({
          chatId: prepared.chatId,
          userId: prepared.userId,
          metadata: prepared.metadata,
          validatedAttachments: prepared.validatedAttachments,
          hasAttachments: prepared.hasAttachments,
          lastMessageContent: prepared.lastMessage.content,
          model: prepared.model,
          responseContent: usageContent,
        });
        sendEvent?.('done', { content: usageContent });
        endConnection();
        return;
      }

      const fallbackContent = prepared.hasAttachments ? 'Files received successfully.' : 'Message received.';
      const isWebhookAssistant = prepared.assistantType === 'webhook' && Boolean(prepared.webhookAssistant);

      if (isWebhookAssistant && prepared.webhookAssistant) {
        const payload = buildWebhookInvocationPayload(prepared);
        const webhookResult = await invokeWebhookAssistant({
          url: prepared.webhookAssistant.url,
          payload,
          timeoutMs: prepared.webhookAssistant.timeoutMs,
          headers: prepared.webhookAssistant.headers,
        });

        let responseContent = webhookResult.content?.trim() ?? '';

        if (!responseContent) {
          if (webhookResult.status === 'timeout') {
            responseContent = 'The assistant webhook timed out. Please try again later.';
          } else if (webhookResult.status === 'error') {
            responseContent = 'The assistant webhook returned an error. Please contact your administrator.';
          }
        }

        if (!responseContent) {
          responseContent = fallbackContent;
        }

        if (responseContent) {
          sendEvent?.('text_delta', { text: responseContent });
        }

        const validationResult = prepared.outputTemplate
          ? validateOutputTemplateContent(prepared.outputTemplate, responseContent)
          : null;

        const baseAssistantMetadata = buildAssistantMetadata({
          baseMetadata: prepared.metadata,
          outputTemplate: prepared.outputTemplate,
          validation: validationResult,
          voiceMode: (prepared.metadata?.audioClips?.length ?? 0) > 0,
        });

        let assistantMetadata: Record<string, unknown> | undefined = baseAssistantMetadata
          ? { ...baseAssistantMetadata }
          : undefined;

        if (prepared.assistantId) {
          assistantMetadata = {
            ...(assistantMetadata ?? {}),
            assistantId: prepared.assistantId,
            ...(prepared.assistantType ? { assistantType: prepared.assistantType } : {}),
          };
        }

        if (prepared.assistantName) {
          assistantMetadata = {
            ...(assistantMetadata ?? {}),
            assistantName: prepared.assistantName,
          };
        }

        const webhookMetadata: Record<string, unknown> = {
          url: prepared.webhookAssistant.url,
          workflowId: prepared.webhookAssistant.workflowId ?? null,
          status: webhookResult.status,
        };

        if (typeof webhookResult.statusCode === 'number') {
          webhookMetadata.statusCode = webhookResult.statusCode;
        }

        if (Number.isFinite(webhookResult.latencyMs)) {
          webhookMetadata.latencyMs = webhookResult.latencyMs;
        }

        if (webhookResult.errorMessage) {
          webhookMetadata.errorMessage = webhookResult.errorMessage;
        }

        if (webhookResult.responseMetadata !== undefined) {
          webhookMetadata.response = webhookResult.responseMetadata;
        }

        assistantMetadata = {
          ...(assistantMetadata ?? {}),
          webhook: webhookMetadata,
        };

        await persistChatMessages({
          chatId: prepared.chatId,
          userId: prepared.userId,
          metadata: prepared.metadata,
          validatedAttachments: prepared.validatedAttachments,
          hasAttachments: prepared.hasAttachments,
          lastMessageContent: prepared.lastMessage.content,
          model: prepared.model,
          responseContent,
          responseMetadata: assistantMetadata,
        });

        sendEvent?.('done', {
          content: responseContent,
          ...(assistantMetadata ? { metadata: assistantMetadata } : {}),
        });

        endConnection();
        return;
      }

      if (!prepared.shouldCallAI) {
        sendEvent?.('text_delta', { text: fallbackContent });
        await persistChatMessages({
          chatId: prepared.chatId,
          userId: prepared.userId,
          metadata: prepared.metadata,
          validatedAttachments: prepared.validatedAttachments,
          hasAttachments: prepared.hasAttachments,
          lastMessageContent: prepared.lastMessage.content,
          model: prepared.model,
          responseContent: fallbackContent,
        });
        sendEvent?.('done', { content: fallbackContent });
        endConnection();
        return;
      }

      // ─── Daily message quota enforcement ───
      try {
        const userLimits = await authService.getUserLimits(prepared.userId);
        if (userLimits.messageLimitPerDay != null) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayMessages = await storage.getMessagesSince(prepared.userId, todayStart);
          const userMessages = todayMessages.filter(m => m.role === 'user');
          if (userMessages.length >= userLimits.messageLimitPerDay) {
            sendEvent?.('error', {
              message: `Daily message limit reached (${userLimits.messageLimitPerDay}). Upgrade your plan for unlimited messages.`,
            });
            endConnection();
            return;
          }
        }
      } catch (quotaErr) {
        console.error('[quota] Failed to check message limit:', quotaErr);
        // Continue — don't block on quota check failure
      }

      // ─── Per-provider daily rate limit enforcement ───
      try {
        const modelConfig = getModelConfig(prepared.model);
        if (modelConfig) {
          const providerName = modelConfig.provider;
          const pSettings = await storage.getPlatformSettings();
          const providerConf = (pSettings.data as any)?.apiProviders?.[providerName];
          if (providerConf?.dailyRequestLimit != null) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayMetrics = await storage.getUserUsageMetrics(prepared.userId, todayStart);
            // Count requests for this provider's models
            const providerModels = Object.entries(MODEL_CONFIG)
              .filter(([, cfg]) => cfg.provider === providerName)
              .map(([id]) => id);
            const providerRequests = todayMetrics.filter(m => providerModels.includes(m.model));
            if (providerRequests.length >= providerConf.dailyRequestLimit) {
              sendEvent?.('error', {
                message: `Daily ${providerName} request limit reached (${providerConf.dailyRequestLimit}). Try a different model or wait until tomorrow.`,
              });
              endConnection();
              return;
            }
          }
        }
      } catch (rateErr) {
        console.error('[rate-limit] Failed to check provider rate limit:', rateErr);
      }

      // ─── Agent loop (always-on): use tool-calling agent loop ───
      if (prepared.shouldCallAI) {
        let agentFinalContent = '';
        let agentHadError = false;
        let agentUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
        let agentToolUsage: Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number }> | undefined;
        const agentToolCalls: Array<{ tool: string; args: Record<string, unknown>; output: string; durationMs: number }> = [];
        let agentMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

        try {
          const platformSettingsForFallback = await storage.getPlatformSettings();
          const fallbackModel = (platformSettingsForFallback.data as any)?.fallbackModel as string | null;
          const llmProvider = createFallbackAwareProvider(storage, prepared.model, fallbackModel);

          const agentConf = prepared.agentConfigMeta?.agentConfig;

          agentMessages = await aiService.assembleAgentMessages({
            userId: prepared.userId,
            model: prepared.model,
            projectId: prepared.chatProjectId,
            assistantId: prepared.assistantId,
            assistantType: prepared.assistantType,
            messages: prepared.enrichedMessages,
            metadata: prepared.metadata,
            skills: prepared.agentConfigMeta?.skills,
          });

          // Compute effective enabled tools (explicit + skill-declared)
          let effectiveEnabledTools: string[] | undefined;
          const explicitTools = prepared.agentConfigMeta?.enabledTools;
          const skillTools = prepared.agentConfigMeta?.skills?.flatMap(s => s.tools).filter(Boolean);
          if (explicitTools || skillTools?.length) {
            effectiveEnabledTools = [...new Set([...(explicitTools ?? []), ...(skillTools ?? [])])];
          }

          // Main agent (no assistant): apply platform-level tool toggles
          if (!effectiveEnabledTools) {
            const platformSettings = await storage.getPlatformSettings();
            const platformTools = (platformSettings.data as any)?.enabledAgentTools as string[] | undefined;
            if (platformTools && platformTools.length > 0) {
              effectiveEnabledTools = platformTools;
            }
            // Also apply skill-linked tool filtering
            const platformSkills = (platformSettings.data as any)?.skills as Array<{ enabled: boolean; linkedTools?: string[] }> | undefined;
            if (platformSkills) {
              const disabledSkillTools = platformSkills
                .filter(s => !s.enabled && s.linkedTools?.length)
                .flatMap(s => s.linkedTools!);
              if (disabledSkillTools.length > 0) {
                if (effectiveEnabledTools) {
                  effectiveEnabledTools = effectiveEnabledTools.filter(t => !disabledSkillTools.includes(t));
                } else {
                  const allToolNames = toolRegistry.names();
                  effectiveEnabledTools = allToolNames.filter(t => !disabledSkillTools.includes(t));
                }
              }
            }
          }

          // ── Trigger Rules: deterministic phrase → tool routing ──
          {
            const triggerPlatformData = platformSettingsForFallback.data as any;
            const triggerRules = triggerPlatformData?.triggerRules as TriggerRule[] | undefined;
            if (triggerRules?.length) {
              const lastUserMsg = [...prepared.enrichedMessages].reverse().find(m => m.role === 'user');
              const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
              const triggerMatch = matchTriggerRules(userText, triggerRules);
              if (triggerMatch) {
                if (triggerMatch.rule.routeType === 'tool') {
                  effectiveEnabledTools = [triggerMatch.rule.routeTarget];
                } else {
                  // routeType === 'skill': find skill's linkedTools
                  const triggerSkills = triggerPlatformData?.skills as Array<{ id: string; linkedTools?: string[] }> | undefined;
                  const skillDef = triggerSkills?.find((s: any) => s.id === triggerMatch.rule.routeTarget);
                  if (skillDef?.linkedTools?.length) {
                    effectiveEnabledTools = skillDef.linkedTools;
                  }
                }
                // Override model if it doesn't support function calls (tools require it)
                const triggerModelConf = getModelConfig(prepared.model);
                if (!triggerModelConf?.supportsFunctions) {
                  const apiProviders = triggerPlatformData?.apiProviders as Record<string, { enabled?: boolean; defaultApiKey?: string }> | undefined;
                  const functionCapableModel = Object.values(MODEL_CONFIG).find(m => {
                    if (!m.supportsFunctions) return false;
                    // Check platform settings API key or env var
                    const providerConf = apiProviders?.[m.provider];
                    return (providerConf?.enabled && !!providerConf?.defaultApiKey) || !!process.env[m.apiKeyEnvVar];
                  });
                  if (functionCapableModel) {
                    prepared.model = functionCapableModel.id;
                  }
                }
                agentMessages.unshift({
                  role: 'system' as const,
                  content: buildTriggerHint(triggerMatch),
                });
              }
            }
          }

          // Thor Mode: max out thinking, tokens, iterations, and temperature
          const thorMode = !!(prepared.metadata as any)?.thorMode;
          const thinkingLevel = (prepared.metadata as any)?.thinkingLevel as string | undefined;
          const modelMaxTokens = getModelConfig(prepared.model)?.maxTokens ?? 32000;

          // Read per-model reasoning config from platform settings
          const platformModelConfig = (platformSettingsForFallback.data as any)?.modelConfig?.[prepared.model] as
            { reasoningLevel?: string; maxOutputTokens?: number | null } | undefined;

          // Resolve thinking config: Thor Mode > per-message thinkingLevel > platform modelConfig > off
          const resolveThinking = () => {
            if (thorMode) return { enabled: true, budget: 32000 }; // Max thinking budget
            if (thinkingLevel === 'extended') return { enabled: true, budget: 10000 };
            if (thinkingLevel === 'standard') return { enabled: true, budget: 4000 };
            // Fall back to platform model config
            const level = platformModelConfig?.reasoningLevel;
            if (level === 'max') return { enabled: true, budget: 16000 };
            if (level === 'high') return { enabled: true, budget: 10000 };
            if (level === 'medium') return { enabled: true, budget: 4000 };
            if (level === 'low') return { enabled: true, budget: 2000 };
            if (level === 'off') return { enabled: false as const, budget: undefined };
            return { enabled: undefined, budget: undefined };
          };
          const thinking = resolveThinking();

          // Resolve effective max output tokens: Thor Mode uses provider max — no cap
          const effectiveMaxTokens = thorMode
            ? modelMaxTokens
            : (platformModelConfig?.maxOutputTokens ?? agentConf?.maxTokens ?? 4000);

          // Inject platform settings and OAuth tokens into tool context
          let extraToolContext: Record<string, any> = {};

          // Provide saveFile so tools can cache external media locally
          extraToolContext.saveFile = async (buffer: Buffer, name: string, mimeType: string): Promise<string> => {
            const attachment = await storage.saveFile(prepared.userId, buffer, name, mimeType);
            return attachment.url; // e.g. /api/files/:id
          };

          // Pass platform settings so tools can read admin-configured API keys
          const settingsData = platformSettingsForFallback?.data as Record<string, any> | undefined;
          if (settingsData) extraToolContext.platformSettings = settingsData;

          try {
            const googleTokens = await storage.getOAuthTokens(prepared.userId, 'google');
            const googleSettings = (platformSettingsForFallback?.data as any)?.integrations?.google;
            const clientId = googleSettings?.enabled ? googleSettings?.clientId : undefined;
            const clientSecret = googleSettings?.enabled ? googleSettings?.clientSecret : undefined;
            if (clientId) extraToolContext.googleClientId = clientId;
            if (clientSecret) extraToolContext.googleClientSecret = clientSecret;
            if (googleTokens.length > 0) {
              const primary = googleTokens.find(t => t.accountLabel === 'default') ?? googleTokens[0];
              extraToolContext.googleAccessToken = primary.accessToken;
              if (primary.refreshToken) extraToolContext.googleRefreshToken = primary.refreshToken;
              extraToolContext.updateGoogleTokens = async (at: string, rt?: string | null, exp?: number | null) => {
                await storage.updateOAuthToken(prepared.userId, 'google', {
                  accessToken: at,
                  ...(rt != null && { refreshToken: rt }),
                  ...(exp != null && { tokenExpiry: new Date(exp) }),
                }, primary.accountLabel ?? 'default');
              };
              extraToolContext.googleAccounts = googleTokens.map(t => ({
                label: t.accountLabel ?? 'default',
                accessToken: t.accessToken,
                refreshToken: t.refreshToken ?? undefined,
                clientId,
                clientSecret,
                update: async (at: string, rt?: string | null, exp?: number | null) => {
                  await storage.updateOAuthToken(prepared.userId, 'google', {
                    accessToken: at,
                    ...(rt != null && { refreshToken: rt }),
                    ...(exp != null && { tokenExpiry: new Date(exp) }),
                  }, t.accountLabel ?? 'default');
                },
              }));
            }
          } catch (tokenErr) {
            console.error('[agent] Failed to load Google OAuth tokens:', tokenErr);
          }
          // Inject Recall AI API key and region from platform settings
          try {
            const recallSettings = (platformSettingsForFallback?.data as any)?.integrations?.recall;
            if (recallSettings?.enabled && recallSettings?.apiKey) {
              extraToolContext.recallApiKey = recallSettings.apiKey;
              extraToolContext.recallRegion = recallSettings.region || 'us-west-2';
            }
          } catch (recallErr) {
            console.error('[agent] Failed to load Recall settings:', recallErr);
          }


          // Session-level Claude Code settings from chat metadata
          const ccMeta = prepared.metadata as any;
          if (ccMeta?.ccModel) extraToolContext.ccModel = ccMeta.ccModel;
          if (ccMeta?.ccEffort) extraToolContext.ccEffort = ccMeta.ccEffort;

          // Send CC sub-tool events to the SSE stream in real time (not batched)
          // Send CC sub-tool events and text to the SSE stream in real time
          const handleLiveSubEvent = (event: { type: string; [key: string]: unknown }) => {
            if (connectionClosed) return;
            switch (event.type) {
              case 'tool_call':
                sendEvent?.('tool_call', { id: event.id, tool: event.tool, args: event.args });
                break;
              case 'tool_result':
                sendEvent?.('tool_result', {
                  id: event.id,
                  tool: event.tool,
                  output: event.output,
                  ...(event.error ? { error: event.error } : {}),
                });
                break;
              case 'cc_text':
                sendEvent?.('cc_text', { text: event.text });
                break;
            }
          };

          for await (const event of runAgentLoop(
            {
              model: prepared.model,
              maxIterations: thorMode ? 100 : (agentConf?.maxIterations ?? 50),
              userId: prepared.userId,
              conversationId: prepared.chatId,
              temperature: thorMode ? 1.0 : (agentConf?.temperature ?? getModelTemperature(prepared.model)),
              maxTokens: effectiveMaxTokens,
              thinkingEnabled: thinking.enabled,
              thinkingBudget: thinking.budget,
              thorMode,
            },
            agentMessages,
            llmProvider,
            effectiveEnabledTools,
            extraToolContext,
            handleLiveSubEvent,
          )) {
            if (connectionClosed) break;

            switch (event.type) {
              case 'agent_status':
                sendEvent?.('agent_status', { iteration: event.iteration, maxIterations: event.maxIterations });
                break;
              case 'thinking':
                sendEvent?.('thinking', { text: event.text });
                break;
              case 'tool_call':
                console.log(`[SSE] tool_call event: tool=${event.tool}`);
                sendEvent?.('tool_call', { id: event.id, tool: event.tool, args: event.args });
                break;
              case 'tool_result':
                console.log(`[SSE] tool_result event: tool=${event.tool}`);
                sendEvent?.('tool_result', {
                  id: event.id,
                  tool: event.tool,
                  output: event.output,
                  ...(event.error ? { error: event.error } : {}),
                  ...(event.artifacts ? { artifacts: event.artifacts } : {}),
                });
                break;
              case 'text_delta':
                sendEvent?.('text_delta', { text: event.text });
                agentFinalContent += event.text;
                break;
              case 'cc_text':
                sendEvent?.('cc_text', { text: event.text });
                break;
              case 'error':
                agentHadError = true;
                sendEvent?.('error', { message: event.message });
                break;
              case 'done':
                agentFinalContent = event.content || agentFinalContent;
                agentUsage = event.usage;
                agentToolUsage = event.toolUsage;
                lastAgentRunAt = Date.now();
                for (const tc of event.toolCalls) {
                  agentToolCalls.push({ tool: tc.tool, args: tc.args, output: tc.output, durationMs: tc.durationMs });
                }
                break;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Agent loop failed';
          agentHadError = true;
          sendEvent?.('error', { message });
        }

        // Don't persist a fake "Message received." when the agent errored or only ran tools
        const hadToolActivity = agentToolCalls.length > 0;
        const persistedContent = agentFinalContent
          || (agentHadError ? null : hadToolActivity ? null : fallbackContent);

        // Skip persist + done event entirely if agent errored with no output
        if (persistedContent !== null) {
          const validationResult = prepared.outputTemplate
            ? validateOutputTemplateContent(prepared.outputTemplate, persistedContent)
            : null;

          const baseAssistantMetadata = buildAssistantMetadata({
            baseMetadata: prepared.metadata,
            outputTemplate: prepared.outputTemplate,
            validation: validationResult,
          });

          let assistantMetadata: Record<string, unknown> = {
            ...(baseAssistantMetadata ?? {}),
            agentMode: true,
            toolCalls: agentToolCalls,
          };

          if (prepared.assistantId) {
            assistantMetadata.assistantId = prepared.assistantId;
            if (prepared.assistantType) assistantMetadata.assistantType = prepared.assistantType;
          }
          if (prepared.assistantName) {
            assistantMetadata.assistantName = prepared.assistantName;
          }

          await persistChatMessages({
            chatId: prepared.chatId,
            userId: prepared.userId,
            metadata: prepared.metadata,
            validatedAttachments: prepared.validatedAttachments,
            hasAttachments: prepared.hasAttachments,
            lastMessageContent: prepared.lastMessage.content,
            model: prepared.model,
            responseContent: persistedContent,
            responseMetadata: assistantMetadata,
            usage: agentUsage,
            toolUsage: agentToolUsage,
          });

          // Fire-and-forget memory extraction — never blocks the response
          if (persistedContent && agentMessages.length > 0) {
            scheduleAutoMemory(prepared.userId, prepared.chatId, agentMessages, storage);
          }

          sendEvent?.('done', {
            content: persistedContent,
            metadata: assistantMetadata,
          });
        }

        endConnection();
      }
    } catch (error) {
      console.error('Streaming chat completion error:', error);

      if (res.headersSent) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (sendEvent) {
          sendEvent('error', { message });
        } else {
          res.write('event: error\n');
          res.write(`data: ${JSON.stringify({ message })}\n\n`);
        }
        endConnection();
        return;
      }

      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          ...(error.detail ? { detail: error.detail } : {}),
        });
      }

      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  });

  // Get user chats
  app.get('/api/chats', requireAuth, async (req, res) => {
    try {
      // Use authenticated user's ID for security
      const userId = (req as any).user.id;

      // Get projectId from query parameter
      // projectId can be:
      // - undefined: return all chats
      // - 'global': return only global chats (projectId IS NULL)
      // - specific project ID: return only chats for that project
      const projectIdParam = req.query.projectId as string | undefined;
      let projectId: string | null | undefined;
      
      if (projectIdParam === 'global') {
        projectId = null; // Filter for global chats only
      } else if (projectIdParam) {
        projectId = projectIdParam; // Filter for specific project
      } else {
        projectId = undefined; // No filter, return all
      }
      
      const chats = await storage.getUserChats(userId, false, projectId);
      res.json(chats);
    } catch (error) {
      console.error('Get chats error:', error);
      res.status(500).json({ error: 'Failed to get chats', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Create new chat
  app.post('/api/chats', requireAuth, async (req, res) => {
    try {
      // Parse the chat data (excluding userId which we'll add from auth)
      const chatData = insertChatSchema.parse(req.body);
      const modelConfig = chatData.model ? getModelConfig(chatData.model) : undefined;

      if (chatData.model && !modelConfig) {
        return res.status(400).json({ error: 'Invalid model selection' });
      }
      // Ensure chat is created for the authenticated user
      const chatWithUser = {
        userId: (req as any).user.id,
        ...chatData
      };
      const chat = await storage.createChat(chatWithUser);
      res.json(chat);
    } catch (error) {
      console.error('Create chat error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid chat data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Get chat messages
  app.get('/api/chats/:chatId/messages', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const messages = await storage.getChatMessages(chatId);
      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to get messages', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Archive chat
  app.patch('/api/chats/:chatId/archive', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const archived = await storage.archiveChat(chatId);
      if (archived) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Chat not found' });
      }
    } catch (error) {
      console.error('Archive chat error:', error);
      res.status(500).json({ error: 'Failed to archive chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Get archived chats
  app.get('/api/chats/archived', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const archivedChats = await storage.getArchivedChats(userId);
      res.json(archivedChats);
    } catch (error) {
      console.error('Get archived chats error:', error);
      res.status(500).json({ error: 'Failed to get archived chats', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Restore archived chat
  app.patch('/api/chats/:chatId/restore', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const restored = await storage.updateChat(chatId, { status: 'active' });
      if (restored) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Chat not found' });
      }
    } catch (error) {
      console.error('Restore chat error:', error);
      res.status(500).json({ error: 'Failed to restore chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Rename chat
  app.patch('/api/chats/:chatId/rename', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const { title } = req.body;
      const userId = (req as any).user.id;
      
      // Validate title
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }
      
      if (title.length > 200) {
        return res.status(400).json({ error: 'Title must be 200 characters or less' });
      }
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Update chat title
      const updated = await storage.updateChat(chatId, { title: title.trim() });
      if (updated) {
        res.json({ success: true, title: updated.title });
      } else {
        res.status(404).json({ error: 'Chat not found' });
      }
    } catch (error) {
      console.error('Rename chat error:', error);
      res.status(500).json({ error: 'Failed to rename chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Move chat to project (or back to global)
  app.patch('/api/chats/:chatId/move-to-project', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const { projectId } = req.body; // null to move to global, string to move to project
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied to this chat' });
      }
      
      // If moving to a project, verify user owns the project
      if (projectId) {
        const project = await storage.getProject(projectId);
        if (!project || project.userId !== userId) {
          return res.status(403).json({ error: 'Access denied to this project' });
        }
      }
      
      // Update chat's projectId
      const updated = await storage.updateChat(chatId, { projectId });
      if (updated) {
        res.json({ success: true, projectId });
      } else {
        res.status(404).json({ error: 'Chat not found' });
      }
    } catch (error) {
      console.error('Move chat to project error:', error);
      res.status(500).json({ error: 'Failed to move chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Delete chat
  app.delete('/api/chats/:chatId', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const deleted = await storage.deleteChat(chatId);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Chat not found' });
      }
    } catch (error) {
      console.error('Delete chat error:', error);
      res.status(500).json({ error: 'Failed to delete chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Reaction endpoints (protected by auth middleware)
  // Get reactions for a message
  app.get('/api/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify message belongs to a chat owned by user
      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
      
      const chat = await storage.getChat(message.chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const reactions = await storage.getMessageReactions(messageId);
      res.json(reactions);
    } catch (error) {
      console.error('Get reactions error:', error);
      res.status(500).json({ error: 'Failed to get reactions', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Create or update a reaction
  app.post('/api/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const requestBodySchema = z.object({ type: reactionTypeSchema });
      const { type } = requestBodySchema.parse(req.body);
      const userId = (req as any).user.id;

      // Verify message belongs to a chat owned by user
      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
      
      const chat = await storage.getChat(message.chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if user already has a reaction for this message
      const existingReaction = await storage.getUserReaction(messageId, userId);
      
      if (existingReaction) {
        // Update existing reaction
        const updatedReaction = await storage.updateReaction(existingReaction.id, type);
        res.json(updatedReaction);
      } else {
        // Create new reaction
        const newReaction = await storage.createReaction({ messageId, userId, type });
        res.json(newReaction);
      }
    } catch (error) {
      console.error('Create/update reaction error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid reaction data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to save reaction', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Delete a reaction
  app.delete('/api/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify message belongs to a chat owned by user
      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
      
      const chat = await storage.getChat(message.chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const reaction = await storage.getUserReaction(messageId, userId);
      
      if (!reaction) {
        return res.status(404).json({ error: 'Reaction not found' });
      }
      
      const deleted = await storage.deleteReaction(reaction.id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(500).json({
          error: 'Failed to delete reaction',
          detail: 'The reaction could not be removed from storage.',
        });
      }
    } catch (error) {
      console.error('Delete reaction error:', error);
      res.status(500).json({ error: 'Failed to delete reaction', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Usage metrics endpoints
  app.get('/api/usage/user/latest', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const latest = await storage.getLatestUsageSummarySnapshot(userId);

      if (latest) {
        return res.json({
          rangeStart: ensureIsoString(latest.rangeStart),
          rangeEnd: ensureIsoString(latest.rangeEnd),
          generatedAt: ensureIsoString(latest.generatedAt),
          totals: latest.totals,
          models: latest.modelBreakdown ?? [],
          source: 'snapshot',
        });
      }

      const intervalMinutes =
        parsePositiveNumber(process.env.USAGE_SNAPSHOT_INTERVAL_MINUTES) ??
        DEFAULT_USAGE_SNAPSHOT_INTERVAL_MINUTES;
      const lookbackHours =
        parsePositiveNumber(process.env.USAGE_SNAPSHOT_LOOKBACK_HOURS) ??
        DEFAULT_USAGE_SNAPSHOT_LOOKBACK_HOURS;

      const now = new Date();
      const rangeEnd = alignDateToInterval(now, intervalMinutes);
      const rangeStart = new Date(rangeEnd.getTime() - lookbackHours * 60 * 60 * 1000);

      const metrics = await storage.getUserUsageMetrics(userId, rangeStart, rangeEnd);
      const summary = buildUsageSummary(metrics, { from: rangeStart, to: rangeEnd });

      try {
        await storage.saveUsageSummarySnapshot({
          userId,
          rangeStart,
          rangeEnd,
          totals: summary.totals,
          modelBreakdown: summary.models,
          generatedAt: now,
        });
      } catch (snapshotError) {
        console.error('Failed to persist usage snapshot from request:', snapshotError);
      }

      res.json({
        rangeStart: ensureIsoString(rangeStart),
        rangeEnd: ensureIsoString(rangeEnd),
        generatedAt: ensureIsoString(now),
        totals: summary.totals,
        models: summary.models,
        source: 'computed',
      });
    } catch (error) {
      console.error('Get latest usage snapshot error:', error);
      res.status(500).json({
        error: 'Failed to get latest usage snapshot',
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  });

  app.get('/api/usage/user/summary', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { dateFrom, dateTo } = req.query;

      const from = parseDateParam(dateFrom);
      const to = parseDateParam(dateTo);

      const metrics = await storage.getUserUsageMetrics(userId, from, to);
      res.json(buildUsageSummary(metrics, { from, to }));
    } catch (error) {
      console.error('Get usage summary error:', error);
      res.status(500).json({ error: 'Failed to get usage summary', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/usage/user', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { dateFrom, dateTo } = req.query;

      const from = parseDateParam(dateFrom);
      const to = parseDateParam(dateTo);

      const metrics = await storage.getUserUsageMetrics(userId, from, to);
      res.json(metrics);
    } catch (error) {
      console.error('Get user usage metrics error:', error);
      res.status(500).json({ error: 'Failed to get usage metrics', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/usage/chat/:chatId', requireAuth, async (req, res) => {
    try {
      const { chatId } = req.params;
      const userId = (req as any).user.id;
      
      // Verify chat belongs to user
      const chat = await storage.getChat(chatId);
      if (!chat || chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const metrics = await storage.getChatUsageMetrics(chatId);
      res.json(metrics);
    } catch (error) {
      console.error('Get chat usage metrics error:', error);
      res.status(500).json({ error: 'Failed to get chat usage metrics', detail: error instanceof Error ? error.message : undefined });
    }
  });
  
  // Platform skills catalog (user-facing)
  app.get('/api/skills', requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const skills = (settings?.data?.skills ?? []).filter((s: { enabled: boolean }) => s.enabled);
      res.json({ skills });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      res.status(500).json({ error: 'Unable to fetch skills' });
    }
  });

  // User preferences endpoints
  app.get('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const preferences = await storage.getUserPreferences(userId);
      
      if (!preferences) {
        // Return default preferences if none exist
        return res.json({
          personalizationEnabled: false,
          customInstructions: '',
          name: '',
          occupation: '',
          bio: '',
          profileImageUrl: '',
          memories: [],
          chatHistoryEnabled: true,
          autonomousCodeExecution: true,
          lastArea: 'user',
          multiAgentEnabled: true,
          aiCanCreateSubagents: false,
          aiName: 'Melvin',
          aiAvatarUrl: '',
          enabledSkills: [],
          company: '',
          timezone: '',
          location: '',
          website: '',
        });
      }

      res.json({
        personalizationEnabled: preferences.personalizationEnabled === 'true',
        customInstructions: preferences.customInstructions || '',
        name: preferences.name || '',
        occupation: preferences.occupation || '',
        bio: preferences.bio || '',
        profileImageUrl: preferences.profileImageUrl || '',
        memories: preferences.memories || [],
        chatHistoryEnabled: preferences.chatHistoryEnabled === 'true',
        autonomousCodeExecution: preferences.autonomousCodeExecution === 'true',
        lastArea: preferences.lastArea || 'user',
        multiAgentEnabled: preferences.multiAgentEnabled === 'true',
        aiCanCreateSubagents: preferences.aiCanCreateSubagents === 'true',
        aiName: preferences.aiName || 'Melvin',
        aiAvatarUrl: preferences.aiAvatarUrl || '',
        enabledSkills: preferences.enabledSkills || [],
        company: preferences.company || '',
        timezone: preferences.timezone || '',
        location: preferences.location || '',
        website: preferences.website || '',
      });
    } catch (error) {
      console.error('Get user preferences error:', error);
      res.status(500).json({ error: 'Failed to get user preferences', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.post('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const existingPreferences = await storage.getUserPreferences(userId);
      const {
        personalizationEnabled,
        customInstructions,
        name,
        occupation,
        bio,
        profileImageUrl,
        memories,
        chatHistoryEnabled,
        autonomousCodeExecution,
        lastArea,
        multiAgentEnabled,
        aiCanCreateSubagents,
        aiName,
        aiAvatarUrl,
        enabledSkills,
        company,
        timezone,
        location,
        website,
      } = req.body ?? {};

      const preferences = await storage.saveUserPreferences(userId, {
        userId,
        personalizationEnabled:
          personalizationEnabled !== undefined
            ? personalizationEnabled ? 'true' : 'false'
            : existingPreferences?.personalizationEnabled ?? 'false',
        customInstructions:
          customInstructions !== undefined ? customInstructions : existingPreferences?.customInstructions,
        name: name !== undefined ? name : existingPreferences?.name,
        occupation: occupation !== undefined ? occupation : existingPreferences?.occupation,
        bio: bio !== undefined ? bio : existingPreferences?.bio,
        profileImageUrl:
          profileImageUrl !== undefined ? profileImageUrl : existingPreferences?.profileImageUrl,
        memories: memories ?? existingPreferences?.memories ?? [],
        chatHistoryEnabled:
          chatHistoryEnabled !== undefined
            ? chatHistoryEnabled ? 'true' : 'false'
            : existingPreferences?.chatHistoryEnabled ?? 'true',
        autonomousCodeExecution:
          autonomousCodeExecution !== undefined
            ? autonomousCodeExecution ? 'true' : 'false'
            : existingPreferences?.autonomousCodeExecution ?? 'true',
        lastArea:
          typeof lastArea === 'string'
            ? lastArea
            : existingPreferences?.lastArea ?? 'user',
        multiAgentEnabled:
          multiAgentEnabled !== undefined
            ? multiAgentEnabled ? 'true' : 'false'
            : existingPreferences?.multiAgentEnabled ?? 'true',
        aiCanCreateSubagents:
          aiCanCreateSubagents !== undefined
            ? aiCanCreateSubagents ? 'true' : 'false'
            : existingPreferences?.aiCanCreateSubagents ?? 'false',
        aiName:
          aiName !== undefined ? aiName : existingPreferences?.aiName ?? 'Melvin',
        aiAvatarUrl:
          aiAvatarUrl !== undefined ? aiAvatarUrl : existingPreferences?.aiAvatarUrl,
        enabledSkills: enabledSkills ?? existingPreferences?.enabledSkills ?? [],
        company: company !== undefined ? company : existingPreferences?.company,
        timezone: timezone !== undefined ? timezone : existingPreferences?.timezone,
        location: location !== undefined ? location : existingPreferences?.location,
        website: website !== undefined ? website : existingPreferences?.website,
      });

      res.json({
        personalizationEnabled: preferences.personalizationEnabled === 'true',
        customInstructions: preferences.customInstructions || '',
        name: preferences.name || '',
        occupation: preferences.occupation || '',
        bio: preferences.bio || '',
        profileImageUrl: preferences.profileImageUrl || '',
        memories: preferences.memories || [],
        chatHistoryEnabled: preferences.chatHistoryEnabled === 'true',
        autonomousCodeExecution: preferences.autonomousCodeExecution === 'true',
        lastArea: preferences.lastArea || 'user',
        multiAgentEnabled: preferences.multiAgentEnabled === 'true',
        aiCanCreateSubagents: preferences.aiCanCreateSubagents === 'true',
        aiName: preferences.aiName || 'Melvin',
        aiAvatarUrl: preferences.aiAvatarUrl || '',
        enabledSkills: preferences.enabledSkills || [],
        company: preferences.company || '',
        timezone: preferences.timezone || '',
        location: preferences.location || '',
        website: preferences.website || '',
      });
    } catch (error) {
      console.error('Save user preferences error:', error);
      res.status(500).json({ error: 'Failed to save user preferences', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // User endpoint to list active assistants
  app.get('/api/assistants', requireAuth, async (_req, res) => {
    try {
      const [assistants, release] = await Promise.all([
        storage.listActiveAssistants(),
        storage.getActiveRelease().catch(() => undefined),
      ]);

      const allowed = release ? new Set((release.assistantIds ?? []).filter(Boolean)) : null;
      const filtered = allowed ? assistants.filter((assistant) => allowed.has(assistant.id)) : assistants;

      // Filter out sub-agents — they're called internally by Melvin via triggers, not user-selectable
      const userFacing = filtered.filter((assistant) => {
        const meta = assistant.metadata as Record<string, unknown> | null;
        return !meta?.isSubAgent;
      });

      const serialized = userFacing.map(serializeAssistantSummary);
      res.json({ assistants: serialized });
    } catch (error) {
      console.error('Failed to list active assistants:', error);
      res.status(500).json({ error: 'Unable to load assistants', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // User endpoint to list available templates
  app.get('/api/templates', requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const [allTemplates, release] = await Promise.all([
        storage.listTemplates(),
        storage.getActiveRelease().catch(() => undefined),
      ]);

      const allowed = release ? new Set((release.templateIds ?? []).filter(Boolean)) : null;
      const releaseTemplates = allowed ? allTemplates.filter((template) => allowed.has(template.id)) : allTemplates;

      const availableTemplates = releaseTemplates.filter(template =>
        isTemplateAccessibleToUser(template, user, release)
      );

      res.json({ templates: availableTemplates.map(serializeTemplate) });
    } catch (error) {
      console.error('Failed to list templates:', error);
      res.status(500).json({ error: 'Unable to load templates', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/templates/:id/file', requireAuth, async (req, res) => {
    try {
      const templateId = req.params.id;
      const user = (req as any).user as User;

      const template = await storage.getTemplate(templateId);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const release = await storage.getActiveRelease().catch(() => undefined);
      if (!isTemplateAccessibleToUser(template, user, release)) {
        return res.status(404).json({ error: 'Template not available' });
      }

      const file = await storage.getFileForUser(template.fileId, TEMPLATE_FILE_OWNER);
      if (!file) {
        return res.status(404).json({ error: 'Template file not found' });
      }

      res.set({
        'Content-Type': file.mimeType,
        'Content-Length': file.size.toString(),
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Cache-Control': 'private, max-age=60',
      });
      res.send(file.buffer);
    } catch (error) {
      console.error('Failed to fetch template file:', error);
      res.status(500).json({ error: 'Unable to fetch template file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/output-templates', requireAuth, async (_req, res) => {
    try {
      const [templates, release] = await Promise.all([
        storage.listOutputTemplates(),
        storage.getActiveRelease().catch(() => undefined),
      ]);

      const allowed = release ? new Set((release.outputTemplateIds ?? []).filter(Boolean)) : null;
      const scoped = allowed ? templates.filter((template) => allowed.has(template.id)) : templates;
      const available = scoped.filter(template => template.isActive);
      res.json({ templates: available.map(serializeOutputTemplate) });
    } catch (error) {
      console.error('Failed to list output templates:', error);
      res.status(500).json({ error: 'Unable to load output templates', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/integrations/n8n/workflows', requireAuth, async (req, res) => {
    try {
      const settingsRecord = await storage.getPlatformSettings();
      const n8nConfig = settingsRecord.data.apiProviders?.n8n;
      const n8nApiKey = n8nConfig?.defaultApiKey || process.env.N8N_API_KEY;

      if (!n8nApiKey) {
        return res.status(400).json({ error: 'N8N API key not configured. Set it in System Settings → AI Providers.' });
      }

      const configuredBaseUrl = (process.env.N8N_BASE_URL || DEFAULT_N8N_BASE_URL).trim();
      let baseUrl: string;

      try {
        const parsed = new URL(configuredBaseUrl);
        baseUrl = parsed.toString().replace(/\/$/, '');
      } catch (urlError) {
        console.error('Invalid N8N base URL configuration:', urlError);
        return res.status(500).json({ error: 'Invalid N8N base URL configuration' });
      }

      let n8nResponse: globalThis.Response;
      const sanitizedKey = n8nApiKey.trim();
      const requestHeaders: Record<string, string> = {
        'X-N8N-API-KEY': sanitizedKey,
        Accept: 'application/json',
      };

      if (sanitizedKey.toLowerCase().startsWith('n8n_pat_')) {
        requestHeaders.Authorization = `Bearer ${sanitizedKey}`;
      }

      try {
        n8nResponse = await fetch(`${baseUrl}/rest/workflows`, {
          headers: requestHeaders,
        });
      } catch (networkError) {
        console.error('N8N workflow fetch network error:', networkError);
        return res.status(502).json({
          error: 'Could not reach N8N instance',
          detail: networkError instanceof Error ? networkError.message : String(networkError),
        });
      }

      if (!n8nResponse.ok) {
        const detail = await n8nResponse.text();
        return res.status(n8nResponse.status).json({
          error: 'Failed to fetch workflows from N8N',
          detail: detail.slice(0, 500),
        });
      }

      let payload: unknown;
      try {
        payload = await n8nResponse.json();
      } catch (parseError) {
        console.error('Failed to parse N8N workflow response:', parseError);
        return res.status(502).json({ error: 'N8N responded with invalid JSON' });
      }

      const workflowsArray: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as any)?.data)
          ? (payload as any).data
          : [];

      const normalizeWebhookUrls = (workflow: any): string[] => {
        const collected = new Set<string>();
        const candidates: unknown[] = [];

        if (Array.isArray(workflow?.webhookUrls)) {
          candidates.push(...workflow.webhookUrls);
        }

        if (workflow?.webhookUrls && typeof workflow.webhookUrls === 'object' && !Array.isArray(workflow.webhookUrls)) {
          for (const value of Object.values(workflow.webhookUrls as Record<string, unknown>)) {
            if (Array.isArray(value)) {
              candidates.push(...value);
            } else {
              candidates.push(value);
            }
          }
        }

        if (Array.isArray(workflow?.webhooks)) {
          candidates.push(...workflow.webhooks);
        }

        for (const value of candidates) {
          if (typeof value === 'string') {
            collected.add(value);
            continue;
          }

          if (value && typeof value === 'object') {
            const url = (value as any).url;
            const path = (value as any).path;

            if (typeof url === 'string') {
              collected.add(url);
            } else if (typeof path === 'string') {
              collected.add(`${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
            }
          }
        }

        return Array.from(collected);
      };

      const workflows = workflowsArray
        .filter((workflow) => workflow && (workflow.id ?? workflow.name))
        .map((workflow) => {
          const idValue = workflow.id ?? workflow.name;
          const id = typeof idValue === 'string' ? idValue : String(idValue);
          const name = typeof workflow.name === 'string' ? workflow.name : `Workflow ${id}`;
          const tags = Array.isArray(workflow.tags)
            ? workflow.tags
                .map((tag: any) => {
                  if (typeof tag === 'string') return tag;
                  if (tag && typeof tag.name === 'string') return tag.name;
                  return null;
                })
                .filter((tag: string | null): tag is string => Boolean(tag))
            : [];

          return {
            id,
            name,
            active: Boolean(workflow.active),
            versionId: workflow.versionId ?? null,
            tags,
            description:
              typeof workflow.description === 'string'
                ? workflow.description
                : typeof workflow.notes === 'string'
                  ? workflow.notes
                  : null,
            createdAt: workflow.createdAt ?? null,
            updatedAt: workflow.updatedAt ?? workflow.updatedAtAt ?? null,
            webhookUrls: normalizeWebhookUrls(workflow),
          };
        });

      res.json({ baseUrl, workflows });
    } catch (error) {
      console.error('N8N workflow fetch error:', error);
      res.status(500).json({
        error: 'Failed to fetch workflows from N8N',
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  });

  app.get(
    '/api/integrations/n8n/agents',
    requireAuth,
    async (_req, res) => {
      try {
        const agents = await storage.getN8nAgents();
        res.json(agents);
      } catch (error) {
        console.error('Fetch N8N agents error:', error);
        res.status(500).json({
          error: 'Failed to fetch N8N agents',
          detail: error instanceof Error ? error.message : undefined,
        });
      }
    },
  );

  app.post(
    '/api/integrations/n8n/agents',
    requireAuth,
    async (req, res) => {
      try {
        const payload = createN8nAgentSchema.parse(req.body);
        const agent = await storage.createN8nAgent({
          ...payload,
          metadata: payload.metadata ?? null,
        });
        res.status(201).json(agent);
      } catch (error) {
        console.error('Create N8N agent error:', error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({
          error: 'Failed to save N8N agent',
          detail: error instanceof Error ? error.message : undefined,
        });
      }
    },
  );

  app.delete(
    '/api/integrations/n8n/agents/:id',
    requireAuth,
    async (req, res) => {
      try {
        const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
        const deleted = await storage.deleteN8nAgent(id);

        if (!deleted) {
          return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Delete N8N agent error:', error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({
          error: 'Failed to delete N8N agent',
          detail: error instanceof Error ? error.message : undefined,
        });
      }
    },
  );

  // ── MCP Server Management ─────────────────────────────────
  app.get('/api/admin/mcp/servers', requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const configs: McpServerConfig[] = (settings.data as any).mcpServers ?? [];
      const status = getMcpServerStatus();
      const statusMap = new Map(status.map((s) => [s.id, s]));

      const servers = configs.map((config) => {
        const s = statusMap.get(config.id);
        return {
          ...config,
          connected: s?.connected ?? false,
          toolCount: s?.toolCount ?? 0,
          tools: s?.tools ?? [],
        };
      });

      res.json({ servers });
    } catch (error) {
      console.error('MCP list error:', error);
      res.status(500).json({ error: 'Failed to list MCP servers' });
    }
  });

  app.post('/api/admin/mcp/servers', requireAuth, async (req, res) => {
    try {
      const { name, transport, command, args, env, url, headers, enabled } = req.body;
      if (!name || !transport) {
        return res.status(400).json({ error: 'name and transport are required' });
      }

      const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newServer: McpServerConfig = {
        id,
        name,
        transport,
        command: command || undefined,
        args: args || undefined,
        env: env || undefined,
        url: url || undefined,
        headers: headers || undefined,
        enabled: enabled !== false,
      };

      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      data.mcpServers = [...(data.mcpServers ?? []), newServer];
      await storage.upsertPlatformSettings(data);

      // Connect if enabled
      if (newServer.enabled) {
        try {
          await initMcpServers(data.mcpServers);
        } catch (err) {
          console.warn('[mcp] Failed to connect new server:', err);
        }
      }

      res.status(201).json(newServer);
    } catch (error) {
      console.error('MCP create error:', error);
      res.status(500).json({ error: 'Failed to create MCP server' });
    }
  });

  app.patch('/api/admin/mcp/servers/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      const servers: McpServerConfig[] = data.mcpServers ?? [];
      const index = servers.findIndex((s) => s.id === id);

      if (index === -1) {
        return res.status(404).json({ error: 'MCP server not found' });
      }

      const updated = { ...servers[index], ...updates, id };
      servers[index] = updated;
      data.mcpServers = servers;
      await storage.upsertPlatformSettings(data);

      // Reconnect
      try {
        await reconnectServer(id, updated);
      } catch (err) {
        console.warn('[mcp] Failed to reconnect server:', err);
      }

      res.json(updated);
    } catch (error) {
      console.error('MCP update error:', error);
      res.status(500).json({ error: 'Failed to update MCP server' });
    }
  });

  app.delete('/api/admin/mcp/servers/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      const servers: McpServerConfig[] = data.mcpServers ?? [];
      const filtered = servers.filter((s) => s.id !== id);

      if (filtered.length === servers.length) {
        return res.status(404).json({ error: 'MCP server not found' });
      }

      data.mcpServers = filtered;
      await storage.upsertPlatformSettings(data);

      // Disconnect
      try {
        await reconnectServer(id, { id, name: '', transport: 'stdio', enabled: false });
      } catch (err) {
        console.warn('[mcp] Failed to disconnect server:', err);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('MCP delete error:', error);
      res.status(500).json({ error: 'Failed to delete MCP server' });
    }
  });

  // ── SSH Servers ────────────────────────────────────────────

  app.get('/api/admin/ssh-servers', requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const servers: any[] = (settings.data as any)?.sshServers ?? [];
      // Strip private keys from list response
      const safe = servers.map(({ privateKey: _k, ...s }) => ({ ...s, hasKey: !!_k }));
      res.json({ servers: safe });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load SSH servers' });
    }
  });

  app.post('/api/admin/ssh-servers', requireAuth, async (req, res) => {
    try {
      const { label, host, port, username, privateKey } = req.body;
      if (!label || !host || !username) {
        return res.status(400).json({ error: 'label, host, and username are required' });
      }
      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      const servers: any[] = data.sshServers ?? [];
      const newServer = {
        id: `ssh_${Date.now()}`,
        label,
        host,
        port: Number(port) || 22,
        username,
        privateKey: privateKey ?? '',
        enabled: true,
      };
      data.sshServers = [...servers, newServer];
      await storage.upsertPlatformSettings(data);
      const { privateKey: _k, ...safe } = newServer;
      res.status(201).json({ server: { ...safe, hasKey: !!_k } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create SSH server' });
    }
  });

  app.put('/api/admin/ssh-servers/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      const servers: any[] = data.sshServers ?? [];
      const idx = servers.findIndex((s) => s.id === id);
      if (idx === -1) return res.status(404).json({ error: 'SSH server not found' });

      const existing = servers[idx];
      const updated = {
        ...existing,
        label: req.body.label ?? existing.label,
        host: req.body.host ?? existing.host,
        port: req.body.port !== undefined ? Number(req.body.port) : existing.port,
        username: req.body.username ?? existing.username,
        // Only update key if a non-empty string is provided
        privateKey: req.body.privateKey?.trim() ? req.body.privateKey : existing.privateKey,
        enabled: req.body.enabled !== undefined ? Boolean(req.body.enabled) : existing.enabled,
      };
      servers[idx] = updated;
      data.sshServers = servers;
      await storage.upsertPlatformSettings(data);
      const { privateKey: _k, ...safe } = updated;
      res.json({ server: { ...safe, hasKey: !!_k } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update SSH server' });
    }
  });

  app.delete('/api/admin/ssh-servers/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const settings = await storage.getPlatformSettings();
      const data = { ...settings.data } as any;
      const servers: any[] = data.sshServers ?? [];
      const filtered = servers.filter((s) => s.id !== id);
      if (filtered.length === servers.length) return res.status(404).json({ error: 'SSH server not found' });
      data.sshServers = filtered;
      await storage.upsertPlatformSettings(data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete SSH server' });
    }
  });

  app.post('/api/admin/ssh-servers/:id/test', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const settings = await storage.getPlatformSettings();
      const servers: any[] = (settings.data as any)?.sshServers ?? [];
      const server = servers.find((s) => s.id === id);
      if (!server) return res.status(404).json({ error: 'SSH server not found' });
      if (!server.privateKey?.trim()) {
        return res.status(400).json({ success: false, error: 'No private key configured for this server.' });
      }

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const { writeFile, unlink } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const execAsync = promisify(exec);

      const keyPath = join(tmpdir(), `melvinos_ssh_test_${Date.now()}.pem`);
      try {
        await writeFile(keyPath, server.privateKey.trimEnd() + '\n', { mode: 0o600 });
        const port = server.port ?? 22;
        const cmd = [
          'ssh',
          '-o', 'BatchMode=yes',
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'ConnectTimeout=8',
          '-i', keyPath,
          '-p', String(port),
          `${server.username}@${server.host}`,
          'echo melvinos_ok',
        ].join(' ');
        const { stdout } = await execAsync(cmd, { timeout: 12000 });
        const ok = stdout.trim().includes('melvinos_ok');
        res.json({ success: ok, message: ok ? 'Connection successful' : 'Unexpected response from server' });
      } catch (err: any) {
        res.json({ success: false, error: err.stderr?.trim() || err.message });
      } finally {
        await unlink(keyPath).catch(() => {});
      }
    } catch (err) {
      res.status(500).json({ success: false, error: 'Test failed' });
    }
  });

  // ── Workspace File Browser ─────────────────────────────────
  const WORKSPACE = process.env.AGENT_WORKSPACE_PATH || '/app/workspace';

  app.get('/api/workspace/files', requireAuth, async (req, res) => {
    try {
      const { resolve, join } = await import('node:path');
      const { readdir, stat } = await import('node:fs/promises');

      const subpath = String(req.query.path ?? '');
      const fullDir = resolve(WORKSPACE, subpath);

      if (!fullDir.startsWith(resolve(WORKSPACE))) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }

      const dirEntries = await readdir(fullDir, { withFileTypes: true }).catch(() => []);
      const entries = await Promise.all(
        dirEntries
          .filter(e => !e.name.startsWith('.'))
          .map(async (e) => {
            const entryPath = subpath ? `${subpath}/${e.name}` : e.name;
            const fullPath = join(fullDir, e.name);
            let size: number | undefined;
            let modifiedAt: string | undefined;
            if (e.isFile()) {
              try {
                const s = await stat(fullPath);
                size = s.size;
                modifiedAt = s.mtime.toISOString();
              } catch { /* ignore */ }
            }
            return {
              name: e.name,
              path: entryPath,
              type: e.isDirectory() ? 'directory' as const : 'file' as const,
              size,
              modifiedAt,
            };
          })
      );
      res.json({ entries });
    } catch (error) {
      console.error('Workspace list error:', error);
      res.status(500).json({ error: 'Failed to list workspace files' });
    }
  });

  app.get('/api/workspace/files/read', requireAuth, async (req, res) => {
    try {
      const { resolve } = await import('node:path');
      const { readFile } = await import('node:fs/promises');

      const filePath = String(req.query.path ?? '');
      const fullPath = resolve(WORKSPACE, filePath);

      if (!fullPath.startsWith(resolve(WORKSPACE))) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }

      const content = await readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content: content.slice(0, 500_000) });
    } catch (error: any) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  app.get('/api/workspace/files/download', requireAuth, async (req, res) => {
    try {
      const { resolve, basename } = await import('node:path');

      const filePath = String(req.query.path ?? '');
      const fullPath = resolve(WORKSPACE, filePath);

      if (!fullPath.startsWith(resolve(WORKSPACE))) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }

      res.download(fullPath, basename(fullPath));
    } catch (error) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  });

  app.delete('/api/workspace/files', requireAuth, async (req, res) => {
    try {
      const { resolve } = await import('node:path');
      const { unlink } = await import('node:fs/promises');

      const filePath = String(req.query.path ?? '');
      const fullPath = resolve(WORKSPACE, filePath);

      if (!fullPath.startsWith(resolve(WORKSPACE))) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }

      await unlink(fullPath);
      res.json({ success: true });
    } catch (error: any) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  // ── Agent Memory Management ─────────────────────────────────
  app.get('/api/agent/memories', requireAuth, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const query = req.query.q as string | undefined;

      let memories;
      if (query) {
        memories = await storage.searchAgentMemories(query);
      } else {
        memories = await storage.listAgentMemories(category);
      }
      res.json({ memories });
    } catch (error) {
      console.error('Memory list error:', error);
      res.status(500).json({ error: 'Failed to list agent memories' });
    }
  });

  app.post('/api/agent/memories', requireAuth, async (req, res) => {
    try {
      const { content, category = 'fact', source } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      const memory = await storage.createAgentMemory({
        content: content.trim(),
        category,
        source: source ?? 'user',
      });
      res.json({ memory });
    } catch (error) {
      console.error('Memory create error:', error);
      res.status(500).json({ error: 'Failed to create memory' });
    }
  });

  app.delete('/api/agent/memories/:id', requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteAgentMemory(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Memory not found' });
      res.json({ success: true });
    } catch (error) {
      console.error('Memory delete error:', error);
      res.status(500).json({ error: 'Failed to delete memory' });
    }
  });

  app.post('/api/agent/memories/cleanse', requireAuth, async (req, res) => {
    try {
      const { runMemoryCleanse } = await import('./agent/memory-cleanse');
      const result = await runMemoryCleanse(storage);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Memory cleanse error:', error);
      res.status(500).json({ error: 'Failed to run memory cleanse' });
    }
  });

  app.post('/api/agent/memories/backfill', requireAuth, async (req, res) => {
    try {
      const { backfillMemories, isQdrantAvailable } = await import('./qdrant-memory');
      if (!await isQdrantAvailable()) {
        return res.status(503).json({ error: 'Qdrant is not available' });
      }
      const platformSettings = await storage.getPlatformSettings();
      const apiKey = (platformSettings.data as any)?.aiProviders?.openai?.apiKey
        || (platformSettings.data as any)?.apiProviders?.openai?.defaultApiKey
        || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'OpenAI API key not configured' });
      }
      const all = await storage.listAgentMemories();
      const result = await backfillMemories(all.map((m) => ({ id: m.id, content: m.content, category: m.category })), apiKey);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Memory backfill error:', error);
      res.status(500).json({ error: 'Failed to backfill memories' });
    }
  });

  // ── Background Task Queue ─────────────────────────────────
  app.get('/api/agent/tasks', requireAuth, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const tasks = await listTasks(status as any);
      res.json({ tasks });
    } catch (error) {
      console.error('Task list error:', error);
      res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  app.get('/api/agent/tasks/:id', requireAuth, async (req, res) => {
    try {
      const task = await getTaskStatus(req.params.id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    } catch (error) {
      console.error('Task status error:', error);
      res.status(500).json({ error: 'Failed to get task status' });
    }
  });

  app.post('/api/agent/tasks', requireAuth, async (req, res) => {
    try {
      const { type, title, input, conversationId } = req.body;
      if (!type || !title) {
        return res.status(400).json({ error: 'type and title are required' });
      }
      const task = await enqueueTask(type, title, input, conversationId);
      res.status(201).json(task);
    } catch (error) {
      console.error('Task create error:', error);
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  app.post('/api/agent/tasks/:id/cancel', requireAuth, async (req, res) => {
    try {
      const task = await cancelTask(req.params.id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    } catch (error) {
      console.error('Task cancel error:', error);
      res.status(500).json({ error: 'Failed to cancel task' });
    }
  });

  // ── Cron Job API ─────────────────────────────────────────────────────────────

  app.get('/api/cron-jobs', requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const jobs = await storage.listCronJobs(userId);
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list cron jobs' });
    }
  });

  app.post('/api/cron-jobs', requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const { name, cronExpression, prompt, recurring, conversationId } = req.body;
      if (!name || !cronExpression || !prompt) {
        return res.status(400).json({ error: 'name, cronExpression and prompt are required' });
      }
      const job = await storage.createCronJob({
        userId,
        name,
        cronExpression,
        prompt,
        recurring: recurring ?? true,
        enabled: true,
        conversationId: conversationId ?? null,
        nextRunAt: null,
      });
      const { scheduleNextRun } = await import('./cron-scheduler');
      await scheduleNextRun(storage, job.id);
      const updated = await storage.getCronJob(job.id);
      res.status(201).json(updated ?? job);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create cron job' });
    }
  });

  app.delete('/api/cron-jobs/:id', requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteCronJob(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Cron job not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete cron job' });
    }
  });

  app.patch('/api/cron-jobs/:id', requireAuth, async (req, res) => {
    try {
      const { enabled } = req.body;
      const job = await storage.updateCronJob(req.params.id, { enabled });
      if (!job) return res.status(404).json({ error: 'Cron job not found' });
      res.json(job);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update cron job' });
    }
  });

  // Helper: resolve Google OAuth credentials from env or platform settings
  async function getGoogleCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
    }
    try {
      const settings = await storage.getPlatformSettings();
      const google = (settings?.data as any)?.integrations?.google;
      if (google?.enabled && google?.clientId && google?.clientSecret) {
        return { clientId: google.clientId, clientSecret: google.clientSecret };
      }
    } catch (err) { console.debug('[google-oauth] Could not read Google credentials from settings:', err instanceof Error ? err.message : err); }
    return null;
  }

  // Google Drive OAuth routes
  app.get('/auth/google', requireAuth, async (req, res) => {
    try {
      const creds = await getGoogleCredentials();
      if (!creds) {
        return res.status(500).json({ error: 'Google OAuth credentials not configured' });
      }
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;

      const driveService = new GoogleDriveService(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      // Generate CSRF protection state; embed account label in state cookie
      const state = randomUUID();
      const accountLabel = String(req.query.label ?? 'default').trim() || 'default';
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: req.protocol === 'https',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });
      res.cookie('oauth_account_label', accountLabel, {
        httpOnly: true,
        secure: req.protocol === 'https',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });

      const authUrl = driveService.getAuthUrl(state);
      res.redirect(authUrl);
    } catch (error) {
      console.error('Google OAuth init error:', error);
      res.status(500).json({ error: 'Failed to initiate Google authentication', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/auth/google/callback', requireAuth, async (req, res) => {
    try {
      const { code, state } = req.query;
      const storedState = req.cookies.oauth_state;
      
      // Verify CSRF state
      if (!state || !storedState || state !== storedState) {
        return res.redirect('/google-drive?error=invalid_state');
      }
      
      // Clear state cookie
      res.clearCookie('oauth_state');
      
      if (!code) {
        return res.redirect('/google-drive?error=no_code');
      }
      
      const userId = (req as any).user.id;
      const creds = await getGoogleCredentials();
      if (!creds) {
        return res.redirect('/google-drive?error=not_configured');
      }
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;

      const driveService = new GoogleDriveService(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      const tokens = await driveService.exchangeCodeForTokens(code as string);

      const accountLabel = String(req.cookies.oauth_account_label ?? 'default').trim() || 'default';
      res.clearCookie('oauth_account_label');

      // Save tokens to database (upserts on userId + provider + accountLabel)
      await storage.saveOAuthToken({
        userId,
        provider: 'google',
        accountLabel,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : null,
      } as any);

      // Redirect to Google Drive page with success message
      res.redirect('/google-drive?connected=true');
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect('/google-drive?error=auth_failed');
    }
  });

  // Google Drive files list
  app.get('/api/google-drive/files', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { pageToken } = req.query;
      
      const token = await storage.getOAuthToken(userId, 'google');

      if (!token) {
        return res.status(401).json({ error: 'Google Drive not connected', needsAuth: true });
      }

      const creds = await getGoogleCredentials();
      if (!creds) {
        return res.status(500).json({ error: 'Google integration not configured' });
      }
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
      const driveService = new GoogleDriveService(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      driveService.setTokens(
        token.accessToken,
        token.refreshToken || undefined,
        token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : undefined
      );

      // Pre-emptively refresh token if expiring soon (within 60 seconds)
      const expiryTime = token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : 0;
      const now = Date.now();
      if (expiryTime && (expiryTime - now < 60000)) {
        const newTokens = await driveService.refreshTokenIfNeeded();
        await storage.updateOAuthToken(userId, 'google', {
          accessToken: newTokens.access_token!,
          refreshToken: newTokens.refresh_token || token.refreshToken,
          tokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
        });
      }
      
      const files = await driveService.listFiles(20, pageToken as string | undefined);
      
      res.json(files);
    } catch (error) {
      console.error('Google Drive files error:', error);
      res.status(500).json({ error: 'Failed to fetch Google Drive files', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Google Drive file content
  app.get('/api/google-drive/file/:fileId', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { fileId } = req.params;
      
      const token = await storage.getOAuthToken(userId, 'google');

      if (!token) {
        return res.status(401).json({ error: 'Google Drive not connected', needsAuth: true });
      }

      const creds = await getGoogleCredentials();
      if (!creds) {
        return res.status(500).json({ error: 'Google integration not configured' });
      }
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
      const driveService = new GoogleDriveService(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      driveService.setTokens(
        token.accessToken,
        token.refreshToken || undefined,
        token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : undefined
      );
      
      // Pre-emptively refresh token if expiring soon
      const expiryTime = token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : 0;
      const now = Date.now();
      if (expiryTime && (expiryTime - now < 60000)) {
        const newTokens = await driveService.refreshTokenIfNeeded();
        await storage.updateOAuthToken(userId, 'google', {
          accessToken: newTokens.access_token!,
          refreshToken: newTokens.refresh_token || token.refreshToken,
          tokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
        });
      }
      
      const content = await driveService.getFileContent(fileId);
      const metadata = await driveService.getFileMetadata(fileId);
      
      res.json({
        content,
        metadata,
      });
    } catch (error) {
      console.error('Google Drive file content error:', error);
      res.status(500).json({ error: 'Failed to fetch file content', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Disconnect Google Drive
  app.delete('/api/google-drive/disconnect', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const accountLabel = String(req.query.label ?? 'default');
      const deleted = await storage.deleteOAuthToken(userId, 'google', accountLabel);

      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Google account not found' });
      }
    } catch (error) {
      console.error('Google Drive disconnect error:', error);
      res.status(500).json({ error: 'Failed to disconnect Google Drive', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // List all connected Google accounts for the current user
  app.get('/api/integrations/google/accounts', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const tokens = await storage.getOAuthTokens(userId, 'google');
      const accounts = tokens.map(t => ({
        label: t.accountLabel ?? 'default',
        connectedAt: t.createdAt ? t.createdAt.toISOString() : null,
        scopes: t.scopes ?? [],
      }));
      res.json({ accounts });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list Google accounts' });
    }
  });

  // Google Drive integration status
  app.get('/api/integrations/google-drive/status', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const token = await storage.getOAuthToken(userId, 'google');

      if (!token) {
        return res.json({ connected: false, needsAuth: true });
      }

      const hasDriveScope = token.scopes?.includes('https://www.googleapis.com/auth/drive.readonly');
      if (!hasDriveScope) {
        return res.json({ connected: false, needsAuth: true });
      }

      const creds = await getGoogleCredentials();
      if (!creds) {
        console.warn('Google OAuth credentials are not configured (env or platform settings).');
        return res.json({ connected: false, needsAuth: true, error: 'Google integration not configured' });
      }

      const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
      const driveService = new GoogleDriveService(
        creds.clientId,
        creds.clientSecret,
        redirectUri
      );

      driveService.setTokens(
        token.accessToken,
        token.refreshToken || undefined,
        token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : undefined
      );

      const expiryTime = token.tokenExpiry ? new Date(token.tokenExpiry).getTime() : null;
      if (expiryTime && expiryTime <= Date.now()) {
        if (!token.refreshToken) {
          return res.json({ connected: false, needsAuth: true, error: 'Google Drive session expired' });
        }

        try {
          const refreshedTokens = await driveService.refreshTokenIfNeeded();
          await storage.updateOAuthToken(userId, 'google', {
            accessToken: refreshedTokens.access_token!,
            refreshToken: refreshedTokens.refresh_token || token.refreshToken,
            tokenExpiry: refreshedTokens.expiry_date ? new Date(refreshedTokens.expiry_date) : null,
            scopes: refreshedTokens.scope ? refreshedTokens.scope.split(' ') : token.scopes,
          });
        } catch (refreshError) {
          console.error('Google Drive token refresh failed:', refreshError);
          return res.json({ connected: false, needsAuth: true, error: 'Token refresh failed' });
        }
      }

      res.json({ connected: true, needsAuth: false });
    } catch (error) {
      console.error('Google Drive status check error:', error);
      res.json({ connected: false, needsAuth: true, error: 'Failed to verify connection' });
    }
  });

  // Notion Integration Routes
  app.get('/api/integrations/notion/status', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const status = await checkNotionConnection(userId);
      res.json(status);
    } catch (error) {
      console.error('Notion status check error:', error);
      res.json({ connected: false, needsAuth: true, error: 'Failed to check connection' });
    }
  });

  app.get('/api/integrations/notion/databases', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const databases = await getNotionDatabases(userId);
      res.json({ databases });
    } catch (error: any) {
      console.error('Notion databases error:', error);
      if (error.message === NOTION_NOT_CONNECTED_ERROR) {
        return res.status(401).json({ error: NOTION_NOT_CONNECTED_ERROR, needsAuth: true });
      }
      res.status(500).json({ error: 'Failed to fetch Notion databases', detail: error instanceof Error ? error.message : undefined });
    }
  });

  app.get('/api/integrations/notion/pages', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const pages = await getNotionPages(userId);
      res.json({ pages });
    } catch (error: any) {
      console.error('Notion pages error:', error);
      if (error.message === NOTION_NOT_CONNECTED_ERROR) {
        return res.status(401).json({ error: NOTION_NOT_CONNECTED_ERROR, needsAuth: true });
      }
      res.status(500).json({ error: 'Failed to fetch Notion pages', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Gmail Integration Routes
  app.get('/api/integrations/gmail/status', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const token = await storage.getOAuthToken(userId, 'google');
      
      if (!token || !token.scopes?.includes('https://www.googleapis.com/auth/gmail.readonly')) {
        return res.json({ connected: false, needsAuth: true });
      }
      
      res.json({ connected: true });
    } catch (error) {
      console.error('Gmail status check error:', error);
      res.json({ connected: false, error: 'Failed to check connection' });
    }
  });

  // Calendar Integration Routes
  app.get('/api/integrations/calendar/status', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const token = await storage.getOAuthToken(userId, 'google');
      
      if (!token || !token.scopes?.includes('https://www.googleapis.com/auth/calendar.readonly')) {
        return res.json({ connected: false, needsAuth: true });
      }
      
      res.json({ connected: true });
    } catch (error) {
      console.error('Calendar status check error:', error);
      res.json({ connected: false, error: 'Failed to check connection' });
    }
  });

  // Recall AI Integration Routes
  app.get('/api/integrations/recall/status', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) {
        return res.json({ connected: false, needsConfig: true });
      }
      // Verify the API key works by listing bots
      const { RecallService } = await import('./recall-service');
      const region = recall.region || process.env.RECALL_REGION || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      await service.listBots({ limit: 1 });
      res.json({ connected: true });
    } catch (error: any) {
      console.error('Recall status check error:', error);
      res.json({ connected: false, error: error.message || 'Failed to connect to Recall AI' });
    }
  });

  app.get('/api/integrations/recall/meetings', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) {
        return res.status(401).json({ error: 'Recall AI not configured' });
      }
      const { RecallService } = await import('./recall-service');
      const region = recall.region || process.env.RECALL_REGION || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const daysBack = Math.min(Number(req.query.daysBack ?? 7), 30);
      const limit = Math.min(Number(req.query.limit ?? 10), 20);
      const joinAtAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const bots = await service.listBots({ joinAtAfter, limit });
      res.json({ meetings: bots });
    } catch (error: any) {
      console.error('Recall meetings error:', error);
      res.status(500).json({ error: 'Failed to fetch meetings', detail: error.message });
    }
  });

  app.get('/api/integrations/recall/meeting/:botId/transcript', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) {
        return res.status(401).json({ error: 'Recall AI not configured' });
      }
      const { RecallService } = await import('./recall-service');
      const region = recall.region || process.env.RECALL_REGION || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const transcript = await service.getBotTranscript(req.params.botId);
      const formatted = service.formatTranscript(transcript);
      res.json({ transcript: formatted, raw: transcript });
    } catch (error: any) {
      console.error('Recall transcript error:', error);
      res.status(500).json({ error: 'Failed to fetch transcript', detail: error.message });
    }
  });

  app.get('/api/integrations/recall/meeting/:botId/participants', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const participants = await service.getBotParticipants(req.params.botId);
      res.json({ participants });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch participants', detail: error.message });
    }
  });

  app.post('/api/integrations/recall/meeting/:botId/delete-media', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      await service.deleteMedia(req.params.botId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete media', detail: error.message });
    }
  });

  app.get('/api/integrations/recall/billing', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const usage = await service.getBillingUsage();
      res.json({ usage });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch billing usage', detail: error.message });
    }
  });

  // ── Recall Calendar V2 ──────────────────────────────────────────────────────

  app.get('/api/integrations/recall/calendar', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const calendars = await service.listCalendars();
      res.json({ calendars });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to list calendars', detail: error.message });
    }
  });

  // Connect calendar using stored Google OAuth tokens — no extra credentials needed from the UI
  app.post('/api/integrations/recall/calendar/connect', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });

      const platform = (req.body?.platform as string) || 'google';

      // Grab the user's stored OAuth tokens
      const oauthTokens = await storage.getOAuthTokens(req.user.id, platform === 'google' ? 'google' : platform);
      if (!oauthTokens?.refreshToken) {
        return res.status(400).json({ error: `No ${platform} account connected. Connect Google via your profile first.` });
      }

      // Get MelvinOS's Google OAuth client credentials
      const googleConfig = (settings?.data as any)?.integrations?.google;
      if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
        return res.status(400).json({ error: 'Google OAuth app not configured in Integrations settings.' });
      }

      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);

      // Calendar V2: pass OAuth credentials directly — no intermediate access-token exchange
      const calendar = await service.createCalendar(
        platform,
        oauthTokens.refreshToken,
        googleConfig.clientId,
        googleConfig.clientSecret,
      );
      res.status(201).json({ calendar });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to connect calendar', detail: error.message });
    }
  });

  app.delete('/api/integrations/recall/calendar/:calendarId', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      await service.deleteCalendar(req.params.calendarId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to disconnect calendar', detail: error.message });
    }
  });

  app.get('/api/integrations/recall/calendar/events', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const limit = Math.min(Number(req.query.limit ?? 20), 50);
      const startAfter = (req.query.startAfter as string) || new Date().toISOString();
      const events = await service.listCalendarEvents({ limit, startAfter });
      res.json({ events });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch calendar events', detail: error.message });
    }
  });

  app.post('/api/integrations/recall/calendar/events/:eventId/bot', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      const event = await service.scheduleEventBot(req.params.eventId, 'Melvin');
      res.json({ event });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to schedule bot', detail: error.message });
    }
  });

  app.delete('/api/integrations/recall/calendar/events/:eventId/bot', requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      if (!recall?.enabled || !recall?.apiKey) return res.status(401).json({ error: 'Recall AI not configured' });
      const { RecallService } = await import('./recall-service');
      const region = recall.region || 'us-west-2';
      const service = new RecallService(recall.apiKey, region);
      await service.unscheduleEventBot(req.params.eventId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to unschedule bot', detail: error.message });
    }
  });

  // ── Recall AI Webhook — fires when a bot finishes or fails ──────────────────
  // Register this URL in Recall dashboard: POST https://your-domain.com/api/webhooks/recall
  // Events: bot.done, bot.fatal
  app.post('/api/webhooks/recall', async (req, res) => {
    try {
      // ── HMAC signature verification ──────────────────────────────────────────
      const webhookSecret = process.env.RECALL_WEBHOOK_SECRET;
      if (webhookSecret) {
        const sigHeader = req.headers['recall-signature'] as string | undefined;
        if (!sigHeader) {
          return res.status(401).json({ error: 'Missing Recall-Signature header' });
        }
        const { createHmac } = await import('node:crypto');
        const expected = createHmac('sha256', webhookSecret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sigHeader !== expected) {
          console.warn('[recall-webhook] Invalid signature — request rejected');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      const body = req.body as any;
      const event = body?.event as string;

      // ── bot.fatal — log and notify ───────────────────────────────────────────
      if (event === 'bot.fatal') {
        const bot = body?.data?.bot;
        const errorMsg = body?.data?.data?.sub_code ?? 'unknown error';
        console.error(`[recall-webhook] Bot fatal: ${bot?.id} — ${errorMsg}`);
        void storage.logToolError({
          toolName: 'recall_bot',
          error: `Bot fatal (${errorMsg}): bot_id=${bot?.id}`,
          args: { bot_id: bot?.id, event: 'bot.fatal' },
          conversationId: null,
        }).catch(() => {});
        return res.json({ ok: true, handled: 'bot.fatal' });
      }

      // Only process bot.done beyond this point
      if (event !== 'bot.done') {
        return res.json({ ok: true, skipped: true });
      }

      const bot = body?.data?.bot;
      if (!bot?.id) return res.status(400).json({ error: 'No bot ID in payload' });

      // Load settings
      const settings = await storage.getPlatformSettings();
      const recall = (settings?.data as any)?.integrations?.recall;
      const notionToken = (settings?.data as any)?.integrations?.notion?.integrationToken;

      if (!recall?.enabled || !recall?.apiKey) {
        console.warn('[recall-webhook] Recall not configured, skipping');
        return res.json({ ok: true, skipped: 'recall_not_configured' });
      }
      if (!notionToken) {
        console.warn('[recall-webhook] Notion not configured, skipping');
        return res.json({ ok: true, skipped: 'notion_not_configured' });
      }

      // Respond immediately, process async
      res.json({ ok: true });

      // Async processing
      (async () => {
        try {
          const { RecallService } = await import('./recall-service');
          const region = recall.region || 'us-west-2';
          const service = new RecallService(recall.apiKey, region);

          // Fetch transcript
          let transcriptText = '';
          let speakers: string[] = [];
          try {
            const raw = await service.getBotTranscript(bot.id);
            transcriptText = service.formatTranscript(raw);
            // Extract unique speakers
            const speakerSet = new Set<string>();
            for (const entry of raw) {
              if (entry?.participant?.name) speakerSet.add(entry.participant.name);
            }
            speakers = Array.from(speakerSet);
          } catch (e) {
            console.warn('[recall-webhook] Could not fetch transcript:', e);
          }

          // Generate AI summary via Anthropic
          let summary = '';
          let actionItems = '';
          let gist = '';
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (anthropicKey && transcriptText) {
              const client = new Anthropic({ apiKey: anthropicKey });
              const summaryResp = await client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{
                  role: 'user',
                  content: `You are a meeting summarizer. Given this transcript, produce:\n1. GIST: One sentence summary (max 20 words)\n2. OVERVIEW: 3-5 bullet points of key discussion points\n3. ACTION ITEMS: Bullet list of concrete next steps (if any)\n\nTranscript:\n${transcriptText.slice(0, 8000)}\n\nRespond in this exact format:\nGIST: ...\nOVERVIEW:\n- ...\nACTION ITEMS:\n- ...`
                }]
              });
              const text = (summaryResp.content[0] as any)?.text ?? '';
              const gistMatch = text.match(/GIST:\s*(.+)/);
              gist = gistMatch?.[1]?.trim() ?? '';
              const overviewMatch = text.match(/OVERVIEW:\n([\s\S]*?)(?=ACTION ITEMS:|$)/);
              summary = overviewMatch?.[1]?.trim() ?? '';
              const actionMatch = text.match(/ACTION ITEMS:\n([\s\S]*?)$/);
              actionItems = actionMatch?.[1]?.trim() ?? '';
            }
          } catch (e) {
            console.warn('[recall-webhook] AI summary failed:', e);
          }

          // Build Notion page in the configured Recall Meetings DB
          const RECALL_DB_ID = '3204fda2-5d9a-81b3-8aaf-e13f739da17d';
          const meetingDate = bot.join_at ? new Date(bot.join_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
          const title = `${bot.bot_name ?? 'Recall Meeting'} — ${meetingDate}`;

          const richText = (text: string) => [{ type: 'text', text: { content: text.slice(0, 2000) } }];

          const notionBody: any = {
            parent: { database_id: RECALL_DB_ID },
            properties: {
              Title: { title: [{ text: { content: title } }] },
              Date: { date: { start: meetingDate } },
              Host: { rich_text: richText(bot.bot_name ?? 'Recall Bot') },
              Type: { rich_text: richText('Recall AI Recording') },
              Gist: { rich_text: richText(gist || 'Meeting recorded via Recall AI') },
              Overview: { rich_text: richText(summary) },
              'Action Items': { rich_text: richText(actionItems) },
              'New Summary': { rich_text: richText(summary) },
              'Bullet Notes': { rich_text: richText(transcriptText.slice(0, 2000)) },
            },
          };

          // Add Attendees as multi_select
          if (speakers.length > 0) {
            notionBody.properties.Attendees = {
              multi_select: speakers.slice(0, 10).map((name: string) => ({ name: name.slice(0, 100) }))
            };
          }

          // Add meeting URL as transcript link
          if (bot.meeting_url) {
            notionBody.properties.Transcript = { url: bot.meeting_url };
          }

          await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(notionBody),
          });

          console.log(`[recall-webhook] Created Notion entry for bot ${bot.id}: "${title}"`);
        } catch (err) {
          console.error('[recall-webhook] Async processing error:', err);
        }
      })();
    } catch (error: any) {
      console.error('[recall-webhook] Error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Knowledge Base Routes

  // Get all knowledge items for authenticated user
  app.get('/api/knowledge', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const items = await storage.getKnowledgeItems(userId);
      res.json(items);
    } catch (error) {
      console.error('Get knowledge items error:', error);
      res.status(500).json({ error: 'Failed to fetch knowledge items', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Upload file, extract text content, store in knowledge_items
  app.post('/api/knowledge/file', requireAuth, rateLimitMiddleware(20, 60_000, 'knowledge'), async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const userLimits = await authService.getUserLimits(userId);

      const fileUploadSchema = z.object({
        name: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        data: z.string(), // Base64 encoded file data
      });

      const { name, mimeType, data } = fileUploadSchema.parse(req.body);

      // Decode base64 data
      const buffer = Buffer.from(data, 'base64');

      // File size limit based on user plan
      const uploadValidation = validateUploadSizeForPlan(userLimits.plan, buffer.length, {
        fileUploadLimitMb: userLimits.fileUploadLimitMb,
      });
      if (uploadValidation) {
        return res.status(uploadValidation.status).json({
          error: uploadValidation.message,
        });
      }

      // Extract content from file
      let content: string;
      let metadata: any = {};
      
      try {
        const analysisResult = await fileAnalysisService.analyzeFile(buffer, name, mimeType);
        content = analysisResult.content;
        metadata = {
          ...analysisResult.metadata,
          summary: analysisResult.summary
        };
      } catch (analysisError) {
        console.error('File analysis failed:', analysisError);
        return res.status(400).json({ 
          error: `Failed to extract content from file: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}` 
        });
      }
      
      // Create knowledge item
      const knowledgeItem = await storage.createKnowledgeItem({
        userId,
        type: 'file',
        title: name,
        content,
        fileName: name,
        fileType: mimeType,
        fileSize: buffer.length.toString(),
        metadata
      });
      
      res.json(knowledgeItem);
    } catch (error) {
      console.error('File upload to knowledge base error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid file data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to upload file to knowledge base', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Fetch URL content, extract text, store in knowledge_items
  app.post('/api/knowledge/url', requireAuth, rateLimitMiddleware(20, 60_000, 'knowledge'), async (req, res) => {
    try {
      const userId = (req as any).user.id;
      
      const urlSchema = z.object({
        url: z.string().url(),
        title: z.string().min(1).max(255).optional(),
      });

      const { url, title } = urlSchema.parse(req.body);
      
      let fetchResponse: globalThis.Response;
      let finalUrl: URL;
      try {
        const result = await fetchWithSsrfProtection(url);
        fetchResponse = result.response;
        finalUrl = result.finalUrl;
      } catch (error) {
        if (error instanceof UnsafeRemoteURLError) {
          return res.status(400).json({ error: error.message });
        }
        if ((error as Error).name === 'AbortError') {
          return res.status(408).json({ error: 'Request timeout: URL took too long to respond' });
        }
        return res.status(500).json({
          error: `Failed to fetch URL: ${(error as Error).message || 'Network error'}`
        });
      }

      if (!fetchResponse.ok) {
        return res.status(fetchResponse.status).json({
          error: `Failed to fetch URL: ${fetchResponse.status} ${fetchResponse.statusText}`
        });
      }
      
      // Extract text from HTML
      let content: string;
      let pageTitle: string;

      try {
        const contentLengthHeader = fetchResponse.headers.get('content-length');
        if (contentLengthHeader) {
          const declaredSize = Number(contentLengthHeader);
          if (!Number.isNaN(declaredSize) && declaredSize > REMOTE_CONTENT_BYTE_LIMIT) {
            return res.status(413).json({
              error: 'Fetched content exceeds the 2MB safety limit.',
            });
          }
        }

        const reader = fetchResponse.body?.getReader();
        if (!reader) {
          return res.status(500).json({
            error: 'Unable to read remote content stream.',
            detail: 'Remote response did not expose a readable body.',
          });
        }

        const decoder = new TextDecoder();
        let received = 0;
        let html = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > REMOTE_CONTENT_BYTE_LIMIT) {
              return res.status(413).json({
                error: 'Fetched content exceeds the 2MB safety limit.',
              });
            }
            html += decoder.decode(value, { stream: true });
          }
        }
        html += decoder.decode();
        const contentType = fetchResponse.headers.get('content-type') || '';

        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          return res.status(400).json({
            error: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`
          });
        }
        
        // Extract title from HTML
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        pageTitle = titleMatch ? titleMatch[1].trim() : finalUrl.hostname;
        
        // Strip HTML tags and extract meaningful content
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
          .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
          .replace(/&nbsp;/g, ' ') // Replace &nbsp;
          .replace(/&amp;/g, '&') // Replace &amp;
          .replace(/&lt;/g, '<') // Replace &lt;
          .replace(/&gt;/g, '>') // Replace &gt;
          .replace(/&quot;/g, '"') // Replace &quot;
          .replace(/&#39;/g, "'") // Replace &#39;
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();
        
        if (!content || content.length < 10) {
          return res.status(400).json({ 
            error: 'Could not extract meaningful content from URL' 
          });
        }
      } catch (parseError) {
        console.error('HTML parsing error:', parseError);
        return res.status(500).json({
          error: 'Failed to parse URL content',
          detail: parseError instanceof Error ? parseError.message : undefined,
        });
      }
      
      // Create knowledge item
      const knowledgeItem = await storage.createKnowledgeItem({
        userId,
        type: 'url',
        title: title || pageTitle,
        content,
        sourceUrl: url,
        metadata: {
          fetchedAt: new Date().toISOString(),
          contentLength: content.length,
          url
        }
      });
      
      res.json(knowledgeItem);
    } catch (error) {
      console.error('URL fetch to knowledge base error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid URL data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to fetch URL content', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Store user-provided text directly in knowledge_items
  app.post('/api/knowledge/text', requireAuth, rateLimitMiddleware(20, 60_000, 'knowledge'), async (req, res) => {
    try {
      const userId = (req as any).user.id;
      
      const textSchema = insertKnowledgeItemSchema.pick({
        title: true,
        content: true,
      }).extend({
        title: z.string().min(1).max(255),
        content: z.string().min(1),
      });

      const { title, content } = textSchema.parse(req.body);
      
      // Create knowledge item
      const knowledgeItem = await storage.createKnowledgeItem({
        userId,
        type: 'text',
        title,
        content,
        metadata: {
          createdAt: new Date().toISOString(),
          contentLength: content.length,
        }
      });
      
      res.json(knowledgeItem);
    } catch (error) {
      console.error('Text storage to knowledge base error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid text data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to store text in knowledge base', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // Delete a knowledge item
  app.delete('/api/knowledge/:id', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;
      
      // Verify the item belongs to the user before deleting
      const item = await storage.getKnowledgeItem(id);
      
      if (!item) {
        return res.status(404).json({ error: 'Knowledge item not found' });
      }
      
      if (item.userId !== userId) {
        return res.status(403).json({ error: 'Not authorized to delete this knowledge item' });
      }
      
      const deleted = await storage.deleteKnowledgeItem(id);
      
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Knowledge item not found' });
      }
    } catch (error) {
      console.error('Delete knowledge item error:', error);
      res.status(500).json({ error: 'Failed to delete knowledge item', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // ============================================================================
  // PROJECT ROUTES
  // ============================================================================

  // 1. GET /api/projects - Get user's projects
  app.get('/api/projects', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const projects = await storage.getUserProjects(userId);
      res.json(projects);
    } catch (error) {
      console.error('Get projects error:', error);
      res.status(500).json({ error: 'Failed to get projects', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 2. POST /api/projects - Create new project
  app.post('/api/projects', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const projectData = insertProjectSchema.parse(req.body);
      
      const project = await storage.createProject(userId, projectData);
      res.status(201).json(project);
    } catch (error) {
      console.error('Create project error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid project data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create project', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 3. GET /api/projects/:id - Get project by ID (check ownership or public access)
  app.get('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      // Check access: owner or public project
      if (project.userId !== userId && project.isPublic !== 'true') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Sanitize response for non-owners
      if (project.userId !== userId) {
        const { shareToken, isPublic, ...publicProject } = project;
        return res.json(publicProject);
      }
      
      res.json(project);
    } catch (error) {
      console.error('Get project error:', error);
      res.status(500).json({ error: 'Failed to get project', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 4. PATCH /api/projects/:id - Update project (check ownership)
  app.patch('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Validate partial update with restrictive schema (only name, description, customInstructions)
      const updateData = updateProjectSchema.parse(req.body);
      
      const updatedProject = await storage.updateProject(id, updateData);
      
      if (!updatedProject) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      res.json(updatedProject);
    } catch (error) {
      console.error('Update project error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid project data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update project', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 5. DELETE /api/projects/:id - Delete project (check ownership)
  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const deleted = await storage.deleteProject(id);
      
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Project not found' });
      }
    } catch (error) {
      console.error('Delete project error:', error);
      res.status(500).json({ error: 'Failed to delete project', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 6. POST /api/projects/:id/share - Generate share token and make project public
  app.post('/api/projects/:id/share', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const shareToken = await storage.generateShareToken(id);

      if (!shareToken) {
        return res.status(500).json({
          error: 'Failed to generate share token',
          detail: 'The project did not return a share token after generation.',
        });
      }
      
      res.json({ shareToken, shareUrl: `/projects/shared/${shareToken}` });
    } catch (error) {
      console.error('Generate share token error:', error);
      res.status(500).json({ error: 'Failed to generate share token', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 6b. DELETE /api/projects/:id/share - Revoke share token and make project private
  app.delete('/api/projects/:id/share', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Set isPublic to false and clear shareToken
      const updated = await storage.updateProject(id, { isPublic: "false", shareToken: null });
      
      if (updated) {
        res.json({ success: true });
      } else {
        res.status(500).json({
          error: 'Failed to revoke share link',
          detail: 'The project record was not updated to remove its share token.',
        });
      }
    } catch (error) {
      console.error('Revoke share token error:', error);
      res.status(500).json({ error: 'Failed to revoke share link', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 7. GET /api/projects/shared/:shareToken - Get project via share token (no auth required)
  app.get('/api/projects/shared/:shareToken', async (req, res) => {
    try {
      const { shareToken } = req.params;
      
      const project = await storage.getProjectByShareToken(shareToken);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.isPublic !== 'true') {
        return res.status(403).json({ error: 'Project is not public' });
      }
      
      // Return sanitized response excluding sensitive fields
      res.json({
        id: project.id,
        name: project.name,
        description: project.description,
        customInstructions: project.customInstructions,
        userId: project.userId,
        createdAt: project.createdAt
      });
    } catch (error) {
      console.error('Get shared project error:', error);
      res.status(500).json({ error: 'Failed to get shared project', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 8. GET /api/projects/:id/knowledge - Get project knowledge items (check access)
  app.get('/api/projects/:id/knowledge', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      // Check access: owner or public project
      if (project.userId !== userId && project.isPublic !== 'true') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const knowledgeItems = await storage.getProjectKnowledge(id);
      res.json(knowledgeItems);
    } catch (error) {
      console.error('Get project knowledge error:', error);
      res.status(500).json({ error: 'Failed to get project knowledge', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 9. POST /api/projects/:id/knowledge/file - Upload file to project knowledge
  app.post('/api/projects/:id/knowledge/file', requireAuth, async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const fileUploadSchema = z.object({
        name: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        data: z.string(),
      });

      const { name, mimeType, data } = fileUploadSchema.parse(req.body);

      const buffer = Buffer.from(data, 'base64');

      const userLimits = await authService.getUserLimits(userId);
      const uploadValidation = validateUploadSizeForPlan(userLimits.plan, buffer.length, {
        fileUploadLimitMb: userLimits.fileUploadLimitMb,
      });
      if (uploadValidation) {
        return res.status(uploadValidation.status).json({
          error: uploadValidation.message,
        });
      }
      
      let content: string;
      let metadata: any;
      
      try {
        const analysisResult = await fileAnalysisService.analyzeFile(buffer, name, mimeType);
        content = analysisResult.content;
        metadata = {
          ...analysisResult.metadata,
          summary: analysisResult.summary
        };
      } catch (analysisError) {
        console.error('File analysis failed:', analysisError);
        return res.status(400).json({ 
          error: `Failed to extract content from file: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}` 
        });
      }
      
      const knowledgeItem = await storage.createProjectKnowledge({
        projectId,
        type: 'file',
        title: name,
        content,
        fileName: name,
        fileType: mimeType,
        fileSize: buffer.length.toString(),
        metadata
      });
      
      res.status(201).json(knowledgeItem);
    } catch (error) {
      console.error('File upload to project knowledge error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid file data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to upload file to project knowledge', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 10. POST /api/projects/:id/knowledge/url - Add URL to project knowledge
  app.post('/api/projects/:id/knowledge/url', requireAuth, async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const urlSchema = z.object({
        url: z.string().url(),
        title: z.string().min(1).max(255).optional(),
      });

      const { url, title } = urlSchema.parse(req.body);
      
      let fetchResponse: globalThis.Response;
      let finalUrl: URL;
      try {
        const result = await fetchWithSsrfProtection(url);
        fetchResponse = result.response;
        finalUrl = result.finalUrl;
      } catch (error) {
        if (error instanceof UnsafeRemoteURLError) {
          return res.status(400).json({ error: error.message });
        }
        if ((error as Error).name === 'AbortError') {
          return res.status(408).json({ error: 'Request timeout: URL took too long to respond' });
        }
        return res.status(500).json({
          error: `Failed to fetch URL: ${(error as Error).message || 'Network error'}`
        });
      }

      if (!fetchResponse.ok) {
        return res.status(fetchResponse.status).json({
          error: `Failed to fetch URL: ${fetchResponse.status} ${fetchResponse.statusText}`
        });
      }
      
      let content: string;
      let pageTitle: string;

      try {
        const contentLengthHeader = fetchResponse.headers.get('content-length');
        if (contentLengthHeader) {
          const declaredSize = Number(contentLengthHeader);
          if (!Number.isNaN(declaredSize) && declaredSize > REMOTE_CONTENT_BYTE_LIMIT) {
            return res.status(413).json({
              error: 'Fetched content exceeds the 2MB safety limit.',
            });
          }
        }

        const reader = fetchResponse.body?.getReader();
        if (!reader) {
          return res.status(500).json({
            error: 'Unable to read remote content stream.',
            detail: 'Remote response did not expose a readable body.',
          });
        }

        const decoder = new TextDecoder();
        let received = 0;
        let html = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > REMOTE_CONTENT_BYTE_LIMIT) {
              return res.status(413).json({
                error: 'Fetched content exceeds the 2MB safety limit.',
              });
            }
            html += decoder.decode(value, { stream: true });
          }
        }
        html += decoder.decode();
        const contentType = fetchResponse.headers.get('content-type') || '';

        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          return res.status(400).json({
            error: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`
          });
        }
        
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        pageTitle = titleMatch ? titleMatch[1].trim() : finalUrl.hostname;
        
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
        
        if (!content || content.length < 10) {
          return res.status(400).json({ 
            error: 'Could not extract meaningful content from URL' 
          });
        }
      } catch (parseError) {
        console.error('HTML parsing error:', parseError);
        return res.status(500).json({
          error: 'Failed to parse URL content',
          detail: parseError instanceof Error ? parseError.message : undefined,
        });
      }
      
      const knowledgeItem = await storage.createProjectKnowledge({
        projectId,
        type: 'url',
        title: title || pageTitle,
        content,
        sourceUrl: url,
        metadata: {
          fetchedAt: new Date().toISOString(),
          contentLength: content.length,
          url
        }
      });
      
      res.status(201).json(knowledgeItem);
    } catch (error) {
      console.error('URL fetch to project knowledge error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid URL data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to fetch URL content', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 11. POST /api/projects/:id/knowledge/text - Add text to project knowledge
  app.post('/api/projects/:id/knowledge/text', requireAuth, async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const textSchema = z.object({
        title: z.string().min(1).max(255),
        content: z.string().min(1),
      });

      const { title, content } = textSchema.parse(req.body);
      
      const knowledgeItem = await storage.createProjectKnowledge({
        projectId,
        type: 'text',
        title,
        content,
        metadata: {
          createdAt: new Date().toISOString(),
          contentLength: content.length,
        }
      });
      
      res.status(201).json(knowledgeItem);
    } catch (error) {
      console.error('Text storage to project knowledge error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid text data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to store text in project knowledge', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 12. DELETE /api/projects/:id/knowledge/:knowledgeId - Delete project knowledge item
  app.delete('/api/projects/:id/knowledge/:knowledgeId', requireAuth, async (req, res) => {
    try {
      const { id: projectId, knowledgeId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const deleted = await storage.deleteProjectKnowledge(knowledgeId);
      
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Knowledge item not found' });
      }
    } catch (error) {
      console.error('Delete project knowledge error:', error);
      res.status(500).json({ error: 'Failed to delete knowledge item', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 13. GET /api/projects/:id/files - Get project files (check access)
  app.get('/api/projects/:id/files', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      // Check access: owner or public project
      if (project.userId !== userId && project.isPublic !== 'true') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const files = await storage.getProjectFiles(id);
      res.json(files);
    } catch (error) {
      console.error('Get project files error:', error);
      res.status(500).json({ error: 'Failed to get project files', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 14. POST /api/projects/:id/files - Upload file to project
  app.post('/api/projects/:id/files', requireAuth, async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      // Get user's plan for file size limit
      const user = await storage.getUser(userId);
      const userPlan = normalizeUserPlan(user?.plan);
      
      const fileUploadSchema = z.object({
        fileUrl: z.string().url('A valid file URL is required'),
        fileName: z.string().min(1).max(255).optional(),
      });

      const fileData = fileUploadSchema.parse(req.body);

      let headResult: Awaited<ReturnType<typeof fetchProjectFileMetadata>>;
      try {
        headResult = await fetchProjectFileMetadata(fileData.fileUrl);
      } catch (fetchError) {
        if (fetchError instanceof UnsafeRemoteURLError) {
          return res.status(400).json({ error: fetchError.message });
        }
        if ((fetchError as Error).name === 'AbortError') {
          return res.status(408).json({ error: 'Request timeout: file metadata request took too long to respond' });
        }
        console.error('HEAD request for project file failed:', fetchError);
        return res.status(400).json({ error: 'Unable to verify uploaded file metadata' });
      }

      const { response: headResponse, finalUrl: resolvedUrl } = headResult;

      if (!headResponse.ok) {
        if (isOversizedProjectFileHeadResponse(headResponse)) {
          const oversize = buildProjectFileOversizeError(userPlan);
          return res.status(oversize.status).json({ error: oversize.message });
        }

        return res.status(400).json({ error: 'Unable to validate uploaded file metadata' });
      }

      try {
        const contentLengthHeader = headResponse.headers.get('content-length');
        if (!contentLengthHeader) {
          return res.status(400).json({ error: 'File size could not be verified' });
        }

        const fileSizeNum = Number.parseInt(contentLengthHeader, 10);
        if (!Number.isFinite(fileSizeNum) || fileSizeNum < 0) {
          return res.status(400).json({ error: 'File size is invalid' });
        }

        const uploadValidation = validateUploadSizeForPlan(userPlan, fileSizeNum);
        if (uploadValidation) {
          return res.status(uploadValidation.status).json({
            error: uploadValidation.message,
          });
        }

        const contentType = headResponse.headers.get('content-type') ?? 'application/octet-stream';
        const contentDisposition = headResponse.headers.get('content-disposition');

        let resolvedFileName = fileData.fileName ?? null;
        if (contentDisposition) {
          const encodedNameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
          const quotedNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
          const encodedValue = encodedNameMatch?.[1];
          const quotedValue = quotedNameMatch?.[1];
          if (encodedValue) {
            try {
              resolvedFileName = decodeURIComponent(encodedValue);
            } catch {
              resolvedFileName = encodedValue;
            }
          } else if (quotedValue) {
            resolvedFileName = quotedValue;
          }
        }

        if (!resolvedFileName) {
          try {
            const metadataUrl = resolvedUrl ?? new URL(fileData.fileUrl);
            const segments = metadataUrl.pathname.split('/').filter(Boolean);
            resolvedFileName = segments.pop() || 'file';
          } catch {
            resolvedFileName = 'file';
          }
        }

        if (resolvedFileName.length > 255) {
          resolvedFileName = resolvedFileName.slice(0, 255);
        }

        const projectFile = await storage.createProjectFile({
          projectId,
          fileName: resolvedFileName,
          fileType: contentType,
          fileSize: fileSizeNum.toString(),
          fileUrl: fileData.fileUrl,
        });

        res.status(201).json(projectFile);
      } finally {
        const body = headResponse.body;
        if (body) {
          try {
            await body.cancel();
          } catch {
            // ignore cancellation failures
          }
        }
      }
    } catch (error) {
      console.error('Upload project file error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid file data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to upload project file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 15. DELETE /api/projects/:id/files/:fileId - Delete project file
  app.delete('/api/projects/:id/files/:fileId', requireAuth, async (req, res) => {
    try {
      const { id: projectId, fileId } = req.params;
      const userId = (req as any).user.id;
      
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      if (project.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const deleted = await storage.deleteProjectFile(fileId);
      
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Project file not found' });
      }
    } catch (error) {
      console.error('Delete project file error:', error);
      res.status(500).json({ error: 'Failed to delete project file', detail: error instanceof Error ? error.message : undefined });
    }
  });

  // 16. POST /api/chats/:id/move - Move chat to/from project
  app.post('/api/chats/:id/move', requireAuth, async (req, res) => {
    try {
      const { id: chatId } = req.params;
      const userId = (req as any).user.id;
      
      const chat = await storage.getChat(chatId);
      
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      if (chat.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const moveSchema = z.object({
        projectId: z.string().nullable(),
      });

      const { projectId } = moveSchema.parse(req.body);
      
      // If moving to a project, verify project exists and user has access
      if (projectId) {
        const project = await storage.getProject(projectId);
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        if (project.userId !== userId) {
          return res.status(403).json({ error: 'Access denied to project' });
        }
      }
      
      const updatedChat = await storage.moveChatToProject(chatId, projectId);
      
      if (!updatedChat) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      res.json(updatedChat);
    } catch (error) {
      console.error('Move chat error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid move data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to move chat', detail: error instanceof Error ? error.message : undefined });
    }
  });

  const intervalMinutes = parsePositiveNumber(process.env.USAGE_SNAPSHOT_INTERVAL_MINUTES);
  const lookbackHours = parsePositiveNumber(process.env.USAGE_SNAPSHOT_LOOKBACK_HOURS);

  const usageScheduler = startUsageAggregationScheduler(storage, {
    intervalMs: (intervalMinutes ?? DEFAULT_USAGE_SNAPSHOT_INTERVAL_MINUTES) * 60 * 1000,
    lookbackMs: (lookbackHours ?? DEFAULT_USAGE_SNAPSHOT_LOOKBACK_HOURS) * 60 * 60 * 1000,
  });

  const httpServer = createServer(app);
  httpServer.on('close', () => {
    void usageScheduler.stop();
    void heartbeatScheduler.stop();
  });
  return httpServer;
}
