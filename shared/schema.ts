import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, unique, index, integer, bigint, boolean, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { UsageSummaryModelBreakdown, UsageSummaryTotals } from "./usage";

// Session storage table for Replit Auth
// (IMPORTANT) This table is mandatory for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const userRoleSchema = z.enum(['user', 'admin', 'super_admin']);
export const userStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export const USER_PLAN_VALUES = ['free', 'pro', 'enterprise'] as const;
export const userPlanEnum = pgEnum('user_plan', USER_PLAN_VALUES);
export const userPlanSchema = z.enum(USER_PLAN_VALUES);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username"), // Making nullable for Replit Auth users
  password: text("password"), // Hashed password - optional for Replit Auth
  email: text("email").unique(), // Unique for Replit Auth
  avatar: text("avatar"), // Deprecated - use profileImageUrl instead
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  plan: userPlanEnum("plan").notNull().default('free'), // 'free', 'pro', or 'enterprise'
  proAccessCode: text("pro_access_code"), // Special code for pro access
  role: text("role").notNull().default('user'),
  status: text("status").notNull().default('active'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const planTierSchema = z.object({
  messageLimitPerDay: z.number().int().nonnegative().nullable(),
  allowedModels: z.array(z.string()),
  features: z.array(z.string()),
  fileUploadLimitMb: z.number().int().nonnegative().nullable().default(null),
  chatHistoryEnabled: z.boolean().default(true),
});

export const knowledgeBaseSettingsSchema = z.object({
  enabled: z.boolean(),
  maxItems: z.number().int().nonnegative().nullable(),
  maxStorageMb: z.number().int().nonnegative().nullable(),
  allowUploads: z.boolean(),
});

export const memorySettingsSchema = z.object({
  enabled: z.boolean(),
  maxMemoriesPerUser: z.number().int().nonnegative().nullable(),
  retentionDays: z.number().int().positive().nullable(),
});

export const templateSettingsSchema = z.object({
  enabled: z.boolean(),
  maxTemplatesPerUser: z.number().int().nonnegative().nullable(),
});

export const projectSettingsSchema = z.object({
  enabled: z.boolean(),
  maxProjectsPerUser: z.number().int().nonnegative().nullable(),
  maxMembersPerProject: z.number().int().nonnegative().nullable(),
});

export const providerSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultApiKey: z.string().nullable(),
  allowedModels: z.array(z.string()),
  dailyRequestLimit: z.number().int().positive().nullable(),
});

export const mediaProviderSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultApiKey: z.string().nullable(),
  defaultModel: z.string().nullable().optional(),
  defaultVoice: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  displayName: z.string().optional(),
});

export const mediaRoutingCategorySchema = z.object({
  defaultProvider: z.string().nullable().default(null),
  fallbackProvider: z.string().nullable().default(null),
});

export const mediaRoutingSchema = z.object({
  image: mediaRoutingCategorySchema.default({}),
  video: mediaRoutingCategorySchema.default({}),
  tts: mediaRoutingCategorySchema.default({}),
  stt: mediaRoutingCategorySchema.default({}),
  coding: mediaRoutingCategorySchema.default({}),
});

export const customModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  provider: z.string(),
  endpoint: z.string().nullable().optional(),
});

export const googleOAuthAppSchema = z.object({
  label: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
});

export const oauthIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().nullable().default(null),
  clientSecret: z.string().nullable().default(null),
  additionalApps: z.array(googleOAuthAppSchema).default([]),
});

export const integrationSettingsSchema = z.object({
  google: oauthIntegrationSchema.default({}),
  notion: z.object({
    enabled: z.boolean().default(false),
    integrationToken: z.string().nullable().default(null),
  }).default({}),
  recall: z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string().nullable().default(null),
    region: z.string().default('us-west-2'),
  }).default({}),
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().nullable().default(null),
    allowedUserIds: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
  }).default({}),
  gamma: z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string().nullable().default(null),
  }).default({}),
});

export type IntegrationSettings = z.infer<typeof integrationSettingsSchema>;

export const skillCategorySchema = z.enum(['productivity', 'research', 'coding', 'communication', 'memory', 'general']);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

export const skillDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: skillCategorySchema,
  icon: z.string().optional(),
  enabled: z.boolean().default(true),
  requiresIntegration: z.string().nullable().optional(),
  isPlatformDefault: z.boolean().default(false),
  linkedTools: z.array(z.string()).default([]),
  type: z.enum(['built-in-tool', 'mcp', 'webhook', 'prompt-injection', 'info']).default('info'),
  /** For prompt-injection type: injected verbatim into the system prompt when enabled. */
  instructions: z.string().optional(),
});
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

// Agent-level skill: injected into the system prompt as instructions
export const agentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  category: skillCategorySchema.optional(),
  tools: z.array(z.string()).default([]),
});
export type AgentSkill = z.infer<typeof agentSkillSchema>;

// Stored in assistant.metadata for per-agent configuration
export const agentConfigMetadataSchema = z.object({
  enabledTools: z.array(z.string()).optional(),
  skills: z.array(agentSkillSchema).optional(),
  agentConfig: z.object({
    maxIterations: z.number().int().min(1).max(50).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(200000).optional(),
  }).optional(),
});
export type AgentConfigMetadata = z.infer<typeof agentConfigMetadataSchema>;

// ── Heartbeat scan protocol ──────────────────────────────────────────────────

export const heartbeatScanItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean().default(true),
});
export type HeartbeatScanItem = z.infer<typeof heartbeatScanItemSchema>;

export const heartbeatQuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  startTime: z.string().default('23:00'),
  endTime: z.string().default('08:00'),
  timezone: z.string().default('America/Chicago'),
});

export const heartbeatConstraintSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type HeartbeatConstraint = z.infer<typeof heartbeatConstraintSchema>;

export const heartbeatSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().min(15).max(1440).default(60),
  quietHours: heartbeatQuietHoursSchema.default({}),
  scanItems: z.array(heartbeatScanItemSchema).default([]),
  constraints: z.array(heartbeatConstraintSchema).default([]),
  deliveryChannel: z.enum(['telegram', 'in_app', 'sms']).default('telegram'),
  smsConfig: z.object({
    contactId: z.string().default(''),
    fromNumber: z.string().default(''),
    mcpServerId: z.string().default(''),
  }).default({}),
  quietResponse: z.string().max(200).default('HEARTBEAT_OK'),
  model: z.string().nullable().default(null),
});
export type HeartbeatSettings = z.infer<typeof heartbeatSettingsSchema>;

// ── Trigger Rules: phrase → tool/skill routing ──────────────────────────────

export const triggerRuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  phrases: z.array(z.string().min(1).max(200)).min(1).max(20),
  matchMode: z.enum(['exact', 'contains']).default('contains'),
  priority: z.number().int().min(0).max(100).default(50),
  routeType: z.enum(['skill', 'tool']).default('tool'),
  routeTarget: z.string(),
  hintMessage: z.string().max(500).optional(),
});
export type TriggerRule = z.infer<typeof triggerRuleSchema>;

export const modelReasoningConfigSchema = z.object({
  reasoningLevel: z.enum(['off', 'low', 'medium', 'high', 'max']).default('medium'),
  maxOutputTokens: z.number().int().min(256).max(200000).nullable().default(null),
});
export type ModelReasoningConfig = z.infer<typeof modelReasoningConfigSchema>;

export const sshServerSchema = z.object({
  id: z.string(),
  label: z.string(),
  host: z.string(),
  port: z.number().int().default(22),
  username: z.string(),
  privateKey: z.string().default(''),
  enabled: z.boolean().default(true),
});
export type SshServer = z.infer<typeof sshServerSchema>;

export const platformSettingsDataSchema = z.object({
  planTiers: z.object({
    free: planTierSchema,
    pro: planTierSchema,
    enterprise: planTierSchema,
  }),
  knowledgeBase: knowledgeBaseSettingsSchema,
  memory: memorySettingsSchema,
  templates: templateSettingsSchema,
  projects: projectSettingsSchema,
  apiProviders: z.record(providerSettingsSchema),
  legacyModels: z.array(z.string()).default([]),
  // New media provider categories
  ttsProviders: z.record(mediaProviderSettingsSchema).default({}),
  sttProviders: z.record(mediaProviderSettingsSchema).default({}),
  imageProviders: z.record(mediaProviderSettingsSchema).default({}),
  videoProviders: z.record(mediaProviderSettingsSchema).default({}),
  codingProviders: z.record(mediaProviderSettingsSchema).default({}),
  // Media provider routing (default + fallback per category)
  mediaRouting: mediaRoutingSchema.default({}),
  // Custom/additional models
  customModels: z.array(customModelSchema).default([]),
  // Platform integration OAuth credentials
  integrations: integrationSettingsSchema.default({}),
  // Skills catalog
  skills: z.array(skillDefinitionSchema).default([]),
  // MCP server connections
  mcpServers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    transport: z.enum(['stdio', 'sse', 'streamable-http']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    enabled: z.boolean().default(true),
  })).default([]),
  // Main agent: which built-in tools are enabled (empty = all enabled)
  enabledAgentTools: z.array(z.string()).default([]),
  // Default model for new chat conversations (admin-configurable)
  defaultModel: z.string().nullable().default(null),
  // Fallback model when primary model fails (rate limit, quota, etc.)
  fallbackModel: z.string().nullable().default(null),
  // Heartbeat: periodic executive scan protocol
  heartbeat: heartbeatSettingsSchema.default({}),
  // Per-model reasoning level + output token defaults
  modelConfig: z.record(modelReasoningConfigSchema).default({}),
  // Trigger Rules: phrase → tool/skill deterministic routing
  triggerRules: z.array(triggerRuleSchema).default([]),
  // Data consolidation: ISO timestamp of last successful run (enables incremental mode)
  lastConsolidationAt: z.string().nullable().optional(),
  // SSH server connections
  sshServers: z.array(sshServerSchema).default([]),
});

export const templates = pgTable("templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  fileId: varchar("file_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  availableForFree: boolean("available_for_free").notNull().default(false),
  availableForPro: boolean("available_for_pro").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const outputTemplateCategorySchema = z.enum(['how_to', 'executive_brief', 'json_report']);
export const outputTemplateFormatSchema = z.enum(['markdown', 'json']);
export const outputTemplateSectionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Section key is required')
    .max(100, 'Section key must be 100 characters or fewer')
    .regex(/^[a-z0-9_\-]+$/i, 'Section key must be alphanumeric and may include dashes or underscores'),
  title: z
    .string()
    .trim()
    .min(1, 'Section title is required')
    .max(200, 'Section title must be 200 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(2000, 'Section description must be 2000 characters or fewer')
    .optional()
    .nullable(),
});

export const outputTemplates = pgTable("output_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  format: text("format").notNull(),
  instructions: text("instructions"),
  requiredSections: jsonb("required_sections")
    .$type<z.infer<typeof outputTemplateSectionSchema>[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const outputTemplateValidationSchema = z.object({
  status: z.enum(['pass', 'fail']),
  missingSections: z.array(z.string()),
  checkedAt: z.string().datetime({ offset: true }),
});

export const platformSettings = pgTable("platform_settings", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").$type<z.infer<typeof platformSettingsDataSchema>>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const platformSettingsHistory = pgTable("platform_settings_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  version: integer("version").notNull(),
  data: jsonb("data").$type<z.infer<typeof platformSettingsDataSchema>>().notNull(),
  changedBy: varchar("changed_by").references(() => users.id, { onDelete: 'set null' }),
  changedAt: timestamp("changed_at").defaultNow(),
});

export const TOOL_POLICY_PROVIDERS = ['openai', 'anthropic', 'groq', 'perplexity'] as const;
export const toolPolicyProviderSchema = z.enum(TOOL_POLICY_PROVIDERS);
export type ToolPolicyProvider = z.infer<typeof toolPolicyProviderSchema>;

export const toolPolicyToolNameSchema = z
  .string()
  .trim()
  .min(1, 'Tool name must be provided')
  .max(100, 'Tool name must be 100 characters or less');

export const toolPolicies = pgTable(
  "tool_policies",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    toolName: text("tool_name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    safetyNote: text("safety_note"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("tool_policies_provider_tool_name_idx").on(table.provider, table.toolName),
    index("tool_policies_provider_idx").on(table.provider),
  ],
);

export const insertToolPolicySchema = createInsertSchema(toolPolicies, {
  provider: toolPolicyProviderSchema,
  toolName: toolPolicyToolNameSchema,
  isEnabled: z.boolean().default(true),
  safetyNote: z.string().trim().max(1000, 'Safety note must be 1000 characters or less').optional().nullable(),
});

export const updateToolPolicySchema = insertToolPolicySchema
  .extend({
    provider: toolPolicyProviderSchema.optional(),
    toolName: toolPolicyToolNameSchema.optional(),
    isEnabled: z.boolean().optional(),
    safetyNote: z.string().trim().max(1000, 'Safety note must be 1000 characters or less').optional().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const toolPolicyCreateSchema = z.object({
  provider: toolPolicyProviderSchema,
  toolName: toolPolicyToolNameSchema,
  isEnabled: z.boolean().default(true),
  safetyNote: z.string().trim().max(1000, 'Safety note must be 1000 characters or less').optional().nullable(),
});

export const toolPolicyUpdateSchema = z
  .object({
    provider: toolPolicyProviderSchema.optional(),
    toolName: toolPolicyToolNameSchema.optional(),
    isEnabled: z.boolean().optional(),
    safetyNote: z.string().trim().max(1000, 'Safety note must be 1000 characters or less').optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const toolPolicyResponseSchema = z.object({
  id: z.string(),
  provider: toolPolicyProviderSchema,
  toolName: toolPolicyToolNameSchema,
  isEnabled: z.boolean(),
  safetyNote: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const systemPrompts = pgTable(
  "system_prompts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    version: integer("version").notNull(),
    label: text("label"),
    content: text("content").notNull(),
    notes: text("notes"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: 'set null' }),
    activatedByUserId: varchar("activated_by_user_id").references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    activatedAt: timestamp("activated_at"),
  },
  (table) => [
    unique("system_prompts_version_key").on(table.version),
    index("system_prompts_active_idx").on(table.isActive),
    uniqueIndex("system_prompts_single_active_idx").on(table.isActive).where(sql`${table.isActive} = true`),
  ],
);

export const releaseStatusSchema = z.enum(['draft', 'active', 'archived']);

export const releases = pgTable(
  "releases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    version: integer("version").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default('draft'),
    changeNotes: text("change_notes"),
    systemPromptId: varchar("system_prompt_id").references(() => systemPrompts.id, { onDelete: 'set null' }),
    assistantIds: jsonb("assistant_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    templateIds: jsonb("template_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outputTemplateIds: jsonb("output_template_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    toolPolicyIds: jsonb("tool_policy_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(false),
    publishedAt: timestamp("published_at"),
    publishedByUserId: varchar("published_by_user_id").references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("releases_version_key").on(table.version),
    index("releases_active_idx").on(table.isActive),
  ],
);

export const releaseAssetsSchema = z.object({
  systemPromptId: z.string().trim().min(1, 'System prompt is required').nullable().optional(),
  assistantIds: z.array(z.string()).optional(),
  templateIds: z.array(z.string()).optional(),
  outputTemplateIds: z.array(z.string()).optional(),
  toolPolicyIds: z.array(z.string()).optional(),
});

export const releaseCreateSchema = releaseAssetsSchema.extend({
  label: z
    .string()
    .trim()
    .min(1, 'Release label is required')
    .max(120, 'Release label must be 120 characters or less'),
  changeNotes: z
    .string()
    .trim()
    .min(1, 'Change notes are required')
    .max(1000, 'Change notes must be 1000 characters or less')
    .optional(),
});

export const releaseTransitionSchema = z.object({
  changeNotes: z
    .string()
    .trim()
    .min(1, 'Change notes are required')
    .max(1000, 'Change notes must be 1000 characters or less'),
});

export const ASSISTANT_TYPE_VALUES = ['prompt', 'webhook'] as const;
export const assistantTypeEnum = pgEnum('assistant_type', ASSISTANT_TYPE_VALUES);
export const assistantTypeSchema = z.enum(ASSISTANT_TYPE_VALUES);

export const assistants = pgTable(
  "assistants",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    type: assistantTypeEnum("type").notNull().default('prompt'),
    userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }),
    name: text("name").notNull(),
    description: text("description"),
    promptContent: text("prompt_content"),
    webhookUrl: text("webhook_url"),
    workflowId: text("workflow_id"),
    metadata: jsonb("metadata"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("assistants_user_id_idx").on(table.userId),
    index("assistants_type_idx").on(table.type),
    index("assistants_active_idx").on(table.isActive),
    uniqueIndex("assistants_user_workflow_idx").on(table.userId, table.workflowId),
  ],
);

export const assistantMetadataSchema = z.record(z.string(), z.unknown());

const assistantBaseSchema = createInsertSchema(assistants, {
  type: assistantTypeSchema.default('prompt'),
  name: z
    .string()
    .trim()
    .min(1, 'Assistant name is required')
    .max(120, 'Assistant name must be 120 characters or less'),
  description: z.string().trim().max(500, 'Description must be 500 characters or less').optional().nullable(),
  promptContent: z
    .string()
    .trim()
    .min(1, 'Prompt content is required for prompt assistants')
    .optional()
    .nullable(),
  webhookUrl: z
    .string()
    .trim()
    .url('Webhook URL must be a valid URL')
    .optional()
    .nullable(),
  workflowId: z
    .string()
    .trim()
    .min(1, 'Workflow ID is required for webhook assistants')
    .optional()
    .nullable(),
  metadata: assistantMetadataSchema.optional().nullable(),
  userId: z.string().trim().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

const refineAssistantSchema = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((data, ctx) => {
    if (data.type === 'prompt') {
      if (!data.promptContent || data.promptContent.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['promptContent'],
          message: 'Prompt content is required for prompt assistants',
        });
      }
    }

    if (data.type === 'webhook') {
      if (!data.webhookUrl || data.webhookUrl.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['webhookUrl'],
          message: 'Webhook URL is required for webhook assistants',
        });
      }
      if (!data.workflowId || data.workflowId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workflowId'],
          message: 'Workflow ID is required for webhook assistants',
        });
      }
    }
  });

export const insertAssistantSchema = refineAssistantSchema(assistantBaseSchema);

export const updateAssistantSchema = z.object({
  type: assistantTypeSchema.optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Assistant name is required')
    .max(120, 'Assistant name must be 120 characters or less')
    .optional(),
  description: z.string().trim().max(500, 'Description must be 500 characters or less').optional().nullable(),
  promptContent: z
    .string()
    .trim()
    .min(1, 'Prompt content is required for prompt assistants')
    .optional()
    .nullable(),
  webhookUrl: z
    .string()
    .trim()
    .url('Webhook URL must be a valid URL')
    .optional()
    .nullable(),
  workflowId: z
    .string()
    .trim()
    .min(1, 'Workflow ID is required for webhook assistants')
    .optional()
    .nullable(),
  metadata: assistantMetadataSchema.optional().nullable(),
  userId: z.string().trim().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'prompt') {
    if (data.promptContent !== undefined && data.promptContent !== null && data.promptContent.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promptContent'],
        message: 'Prompt content is required for prompt assistants',
      });
    }
  }

  if (data.type === 'webhook') {
    if (data.webhookUrl !== undefined && data.webhookUrl !== null && data.webhookUrl.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['webhookUrl'],
        message: 'Webhook URL is required for webhook assistants',
      });
    }
    if (data.workflowId !== undefined && data.workflowId !== null && data.workflowId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflowId'],
        message: 'Workflow ID is required for webhook assistants',
      });
    }
  }
});

export type Assistant = typeof assistants.$inferSelect;

export const assistantWebhookConfigSchema = z.object({
  url: z.string().url().optional().nullable(),
  workflowId: z.string().optional().nullable(),
  metadata: assistantMetadataSchema.optional().nullable(),
  timeoutMs: z.number().int().positive().optional(),
  headers: z.record(z.string(), z.string()).optional(),
}).optional().nullable();

export const assistantSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: assistantTypeSchema,
  promptContent: z.string().nullable().optional(),
  metadata: assistantMetadataSchema.optional().nullable(),
  webhookUrl: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
  webhook: assistantWebhookConfigSchema,
  isActive: z.boolean().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type AssistantSummary = z.infer<typeof assistantSummarySchema>;
export type InsertAssistant = z.infer<typeof insertAssistantSchema>;
export type UpdateAssistant = z.infer<typeof updateAssistantSchema>;

export const systemPromptCreateSchema = z.object({
  label: z.string().trim().max(120, 'Label must be 120 characters or less').optional().nullable(),
  notes: z.string().trim().max(2000, 'Notes must be 2000 characters or less').optional().nullable(),
  content: z
    .string()
    .trim()
    .min(10, 'System prompt must be at least 10 characters long')
    .max(20000, 'System prompt must be 20000 characters or less'),
  activate: z.boolean().optional(),
});

export const systemPromptUpdateSchema = z
  .object({
    label: z.string().trim().max(120, 'Label must be 120 characters or less').optional().nullable(),
    notes: z.string().trim().max(2000, 'Notes must be 2000 characters or less').optional().nullable(),
    content: z
      .string()
      .trim()
      .min(10, 'System prompt must be at least 10 characters long')
      .max(20000, 'System prompt must be 20000 characters or less')
      .optional(),
    activate: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.activate === true ||
      data.content !== undefined ||
      data.label !== undefined ||
      data.notes !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export const defaultPlatformSettings: z.infer<typeof platformSettingsDataSchema> = {
  planTiers: {
    free: {
      messageLimitPerDay: 50,
      allowedModels: ['compound'],
      features: [],
      fileUploadLimitMb: 50,
      chatHistoryEnabled: true,
    },
    pro: {
      messageLimitPerDay: null,
      allowedModels: [
        'gpt-5.4',
        'claude-sonnet-4-6',
        'compound',
        'sonar-pro',
        'sonar-deep-research',
      ],
      features: ['deep-research'],
      fileUploadLimitMb: 100,
      chatHistoryEnabled: true,
    },
    enterprise: {
      messageLimitPerDay: null,
      allowedModels: [
        'gpt-5.4',
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'compound',
        'os-120b',
        'gemini-3.1-pro',
        'gemini-2.5-flash',
        'sonar-pro',
        'sonar-deep-research',
      ],
      features: ['deep-research'],
      fileUploadLimitMb: null,
      chatHistoryEnabled: true,
    },
  },
  knowledgeBase: {
    enabled: true,
    maxItems: 200,
    maxStorageMb: 2048,
    allowUploads: true,
  },
  memory: {
    enabled: true,
    maxMemoriesPerUser: 500,
    retentionDays: null,
  },
  templates: {
    enabled: true,
    maxTemplatesPerUser: 200,
  },
  projects: {
    enabled: true,
    maxProjectsPerUser: 100,
    maxMembersPerProject: 20,
  },
  apiProviders: {
    openai: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: ['gpt-5.4'],
      dailyRequestLimit: null,
    },
    anthropic: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
      dailyRequestLimit: null,
    },
    groq: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: ['compound', 'os-120b'],
      dailyRequestLimit: null,
    },
    perplexity: {
      enabled: false,
      defaultApiKey: null,
      allowedModels: [],
      dailyRequestLimit: null,
    },
    n8n: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: [],
      dailyRequestLimit: null,
    },
    notion: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: [],
      dailyRequestLimit: null,
    },
    google: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: ['gemini-3.1-pro', 'gemini-2.5-flash'],
      dailyRequestLimit: null,
    },
    ollama: {
      enabled: true,
      defaultApiKey: null,
      allowedModels: ['qwen3.5-397b'],
      dailyRequestLimit: null,
    },
  },
  legacyModels: [
    'llama-3.1-8b-instant',
  ],
  ttsProviders: {
    'openai-realtime': { enabled: false, defaultApiKey: null, displayName: 'OpenAI Realtime Voice' },
    'openai-tts': { enabled: false, defaultApiKey: null, displayName: 'OpenAI TTS' },
    elevenlabs: { enabled: false, defaultApiKey: null, displayName: 'ElevenLabs' },
  },
  sttProviders: {
    'groq-whisper': { enabled: false, defaultApiKey: null, displayName: 'Groq Whisper' },
    'openai-whisper': { enabled: false, defaultApiKey: null, displayName: 'OpenAI Whisper' },
    'whisper-local': { enabled: false, defaultApiKey: null, endpoint: null, displayName: 'Whisper (Local/Open Source)' },
  },
  imageProviders: {
    dalle: { enabled: false, defaultApiKey: null, displayName: 'DALL-E (OpenAI)' },
    'nano-banana': { enabled: false, defaultApiKey: null, displayName: 'Nano Banana' },
  },
  videoProviders: {
    veo: { enabled: false, defaultApiKey: null, displayName: 'Veo 3.1 (Google)' },
    sora: { enabled: false, defaultApiKey: null, displayName: 'Sora (OpenAI)' },
  },
  codingProviders: {
    'claude-code': { enabled: false, defaultApiKey: null, displayName: 'Claude Code' },
    codex: { enabled: false, defaultApiKey: null, displayName: 'OpenAI Codex' },
  },
  mediaRouting: {
    image: { defaultProvider: 'dalle', fallbackProvider: null },
    video: { defaultProvider: 'sora', fallbackProvider: 'veo' },
    tts: { defaultProvider: 'openai-realtime', fallbackProvider: 'openai-tts' },
    stt: { defaultProvider: 'groq-whisper', fallbackProvider: 'openai-whisper' },
    coding: { defaultProvider: 'python', fallbackProvider: null },
  },
  customModels: [],
  integrations: {
    google: { enabled: false, clientId: null, clientSecret: null },
    notion: { enabled: false, integrationToken: null },
    recall: { enabled: false, apiKey: null, region: 'us-west-2' },
    telegram: { enabled: false, botToken: null, allowedUserIds: null },
  },
  skills: [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      description: 'Full Google Workspace access: Gmail (search, read, send, organize), Calendar (view, create, update, delete events), and Drive (search, read, create docs/sheets/folders).',
      category: 'productivity',
      icon: 'Globe',
      enabled: true,
      requiresIntegration: 'google',
      isPlatformDefault: true,
      linkedTools: ['gmail_search', 'gmail_read', 'gmail_send', 'gmail_modify', 'calendar_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'drive_search', 'drive_read', 'drive_write'],
    },
    {
      id: 'notion',
      name: 'Notion',
      description: 'Full Notion access: search, read, create, update, and archive pages and databases.',
      category: 'productivity',
      icon: 'BookOpen',
      enabled: true,
      requiresIntegration: 'notion',
      isPlatformDefault: true,
      linkedTools: ['notion_search', 'notion_read_page', 'notion_create_page', 'notion_update_page'],
    },
    {
      id: 'recall-ai',
      name: 'Recall AI',
      description: 'Record meetings with a bot, search transcripts, and list past recordings.',
      category: 'memory',
      icon: 'Mic',
      enabled: true,
      requiresIntegration: 'recall',
      isPlatformDefault: true,
      linkedTools: ['recall_search', 'recall_meetings', 'recall_create_bot'],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Execute and debug code, run terminal commands, and manage files via Claude Code.',
      category: 'coding',
      icon: 'Code2',
      enabled: true,
      requiresIntegration: null,
      isPlatformDefault: true,
      linkedTools: ['shell_execute', 'file_read', 'file_write', 'file_edit', 'python_execute'],
    },
    {
      id: 'deep-research',
      name: 'Deep Research',
      description: 'Run multi-step web research workflows to produce comprehensive reports.',
      category: 'research',
      icon: 'Search',
      enabled: true,
      requiresIntegration: null,
      isPlatformDefault: true,
      linkedTools: ['deep_research', 'web_search', 'web_fetch'],
    },
    {
      id: 'video-generation',
      name: 'Video Generation',
      description: 'Generate videos from text descriptions using OpenAI Sora or Google Veo 3.1.',
      category: 'general',
      icon: 'Video',
      enabled: true,
      requiresIntegration: null,
      isPlatformDefault: true,
      linkedTools: ['video_generate'],
      type: 'built-in-tool',
    },
    {
      id: 'n8n-automations',
      name: 'n8n Automations',
      description: 'Trigger and manage n8n automation workflows directly from chat.',
      category: 'general',
      icon: 'Network',
      enabled: true,
      requiresIntegration: 'n8n',
      isPlatformDefault: true,
      linkedTools: [],
    },
  ],
  heartbeat: {
    enabled: false,
    intervalMinutes: 60,
    quietHours: {
      enabled: false,
      startTime: '23:00',
      endTime: '08:00',
      timezone: 'America/Chicago',
    },
    scanItems: [
      {
        id: 'operational-risk',
        label: 'Operational Risk',
        description: 'Check for core service failures, broken automations, message delivery issues, or uptime problems. Only report confirmed issues.',
        enabled: true,
      },
      {
        id: 'calendar-deadlines',
        label: 'Calendar & Deadlines',
        description: 'Scan the next 24 hours for meetings, events, or deadlines requiring preparation. Skip if none found.',
        enabled: true,
      },
      {
        id: 'active-workstreams',
        label: 'Active Workstreams',
        description: 'Infer up to 3 active workstreams from recent messages and memory. For each: current status (one line), next action (one line), blocker (only if real).',
        enabled: true,
      },
      {
        id: 'high-leverage-suggestions',
        label: 'High-Leverage Suggestions',
        description: 'Propose up to 3 concrete, actionable improvements that save time, reduce complexity, increase automation leverage, or reduce risk. Skip if nothing qualifies.',
        enabled: false,
      },
      {
        id: 'memory-review',
        label: 'Memory Review & Synthesis',
        description: 'Use memory_search to scan your saved memories. Identify clusters of related memories and synthesize them into higher-level procedure or fact memories using memory_save. Delete or note outdated entries. Report how many were reviewed and any new insights added.',
        enabled: false,
      },
    ],
    constraints: [
      { id: 'c1', text: 'No noise. No repetition if nothing changed.' },
      { id: 'c2', text: 'Keep the report under 500 words.' },
      { id: 'c3', text: 'If nothing meaningful to report, respond with the quiet response only.' },
    ],
    deliveryChannel: 'telegram' as const,
    quietResponse: 'HEARTBEAT_OK',
    model: null,
  },
  modelConfig: {
    'claude-opus-4-6': { reasoningLevel: 'high', maxOutputTokens: null },
    'claude-sonnet-4-6': { reasoningLevel: 'medium', maxOutputTokens: null },
    'gpt-5.4': { reasoningLevel: 'medium', maxOutputTokens: null },
    'gemini-3.1-pro': { reasoningLevel: 'medium', maxOutputTokens: null },
    'sonar-deep-research': { reasoningLevel: 'medium', maxOutputTokens: null },
    'compound': { reasoningLevel: 'off', maxOutputTokens: null },
  },
  triggerRules: [
    {
      id: 'trigger-image',
      name: 'Image Generation',
      enabled: true,
      phrases: ['create an image', 'make a picture', 'generate a photo', 'generate an image', 'draw me', 'make me an image'],
      matchMode: 'contains' as const,
      priority: 80,
      routeType: 'tool' as const,
      routeTarget: 'image_generate',
    },
    {
      id: 'trigger-video',
      name: 'Video Generation',
      enabled: true,
      phrases: ['generate a video', 'create a video', 'make a video', 'make me a video', 'video of', 'animate this', 'create a clip'],
      matchMode: 'contains' as const,
      priority: 85,
      routeType: 'tool' as const,
      routeTarget: 'video_generate',
    },
    {
      id: 'trigger-deep-research',
      name: 'Deep Research',
      enabled: true,
      phrases: ['deep research', 'research this thoroughly', 'do a deep dive'],
      matchMode: 'contains' as const,
      priority: 70,
      routeType: 'tool' as const,
      routeTarget: 'deep_research',
    },
  ],
};

export const PLAN_LABELS = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
} as const satisfies Record<z.infer<typeof userPlanSchema>, string>;

export const DEFAULT_FILE_UPLOAD_LIMITS_MB = {
  free: defaultPlatformSettings.planTiers.free.fileUploadLimitMb,
  pro: defaultPlatformSettings.planTiers.pro.fileUploadLimitMb,
  enterprise: defaultPlatformSettings.planTiers.enterprise.fileUploadLimitMb,
} as const satisfies Record<z.infer<typeof userPlanSchema>, number | null>;

export const getDefaultFileUploadLimitMb = (plan: z.infer<typeof userPlanSchema>): number | null =>
  DEFAULT_FILE_UPLOAD_LIMITS_MB[plan] ?? null;

export const formatFileUploadLimitLabel = (limitMb: number | null | undefined): string => {
  if (limitMb === null || limitMb === undefined) {
    return 'Unlimited';
  }

  if (!Number.isFinite(limitMb)) {
    return 'Unlimited';
  }

  if (limitMb >= 1024) {
    const gb = limitMb / 1024;
    const formattedGb = Number.isInteger(gb) ? `${gb}` : `${parseFloat(gb.toFixed(1))}`;
    return `${formattedGb}GB`;
  }

  const formattedMb = Number.isInteger(limitMb) ? `${limitMb}` : `${parseFloat(limitMb.toFixed(1))}`;
  return `${formattedMb}MB`;
};

export const chats = pgTable("chats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: 'set null' }), // Optional - null for regular chats, set for project chats
  title: text("title").notNull(),
  model: text("model").notNull().default("compound"),
  status: text("status").notNull().default("active"), // 'active', 'archived', 'deleted'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("chats_project_id_idx").on(table.projectId),
  index("chats_user_id_idx").on(table.userId),
]);

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: 'cascade' }),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  attachments: jsonb("attachments"), // For storing file attachment data
  metadata: jsonb("metadata"), // For storing additional data like tokens, etc.
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("messages_chat_id_idx").on(table.chatId),
]);

export const reactions = pgTable("reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // 'thumbs_up' or 'thumbs_down'
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Unique constraint: one reaction per user per message
  uniqueUserMessage: unique().on(table.messageId, table.userId),
}));

export const usageMetrics = pgTable("usage_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: 'cascade' }),
  messageId: varchar("message_id").references(() => messages.id, { onDelete: 'cascade' }),
  model: text("model").notNull(),
  promptTokens: bigint("prompt_tokens", { mode: 'number' }).notNull().default(0),
  completionTokens: bigint("completion_tokens", { mode: 'number' }).notNull().default(0),
  totalTokens: bigint("total_tokens", { mode: 'number' }).notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usageSummarySnapshots = pgTable(
  "usage_summary_snapshots",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    rangeStart: timestamp("range_start").notNull(),
    rangeEnd: timestamp("range_end").notNull(),
    totals: jsonb("totals").$type<UsageSummaryTotals>().notNull(),
    modelBreakdown: jsonb("model_breakdown").$type<UsageSummaryModelBreakdown[]>().notNull(),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (table) => [
    index("usage_summary_snapshots_user_id_idx").on(table.userId),
    index("usage_summary_snapshots_user_generated_at_idx").on(table.userId, table.generatedAt),
    unique("usage_summary_snapshots_window_idx").on(table.userId, table.rangeStart, table.rangeEnd),
  ],
);

export const oauthTokens = pgTable("oauth_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text("provider").notNull(), // 'google', 'microsoft', etc.
  accountLabel: text("account_label").notNull().default("default"), // e.g. 'Work', 'Agency', 'Personal'
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  scopes: text("scopes").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueUserProviderLabel: unique().on(table.userId, table.provider, table.accountLabel),
}));

export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  personalizationEnabled: text("personalization_enabled").notNull().default("false"),
  customInstructions: text("custom_instructions"),
  name: text("name"),
  occupation: text("occupation"),
  bio: text("about_me"),
  profileImageUrl: text("profile_image_url"),
  memories: jsonb("memories").$type<string[]>().default(sql`'[]'::jsonb`),
  chatHistoryEnabled: text("chat_history_enabled").notNull().default("true"),
  autonomousCodeExecution: text("autonomous_code_execution").notNull().default("true"),
  lastArea: text("last_area").default("user"),
  // AI Identity - user can name their AI and set an avatar
  aiName: text("ai_name").default("Melvin"),
  aiAvatarUrl: text("ai_avatar_url"),
  // Multi-agent settings
  multiAgentEnabled: text("multi_agent_enabled").notNull().default("true"),
  aiCanCreateSubagents: text("ai_can_create_subagents").notNull().default("false"),
  // Enabled skills for this user
  enabledSkills: jsonb("enabled_skills").$type<string[]>().default(sql`'[]'::jsonb`),
  // Extended profile fields
  company: text("company"),
  timezone: text("timezone"),
  location: text("location"),
  website: text("website"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userApiKeys = pgTable("user_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  apiKeyLastFour: text("api_key_last_four").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueUserProvider: unique().on(table.userId, table.provider),
  userIdIdx: index("user_api_keys_user_id_idx").on(table.userId),
}));

export const n8nAgentStatusSchema = z.enum(['inactive', 'active']);

export const insertN8nAgentSchema = z.object({
    workflowId: z.string().trim().min(1, 'Workflow ID is required'),
    name: z
      .string()
      .trim()
      .min(1, 'Agent name is required')
      .max(120, 'Agent name must be 120 characters or less'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or less')
      .optional()
      .nullable(),
    status: n8nAgentStatusSchema.optional(),
    webhookUrl: z
      .string()
      .trim()
      .url('Webhook URL must be a valid URL')
      .optional()
      .nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  });

// Knowledge base for file uploads, URLs, and text that provides context to AI
export const knowledgeItems = pgTable("knowledge_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // 'file', 'url', 'text'
  title: text("title").notNull(),
  content: text("content").notNull(), // Extracted/processed content for AI context
  sourceUrl: text("source_url"), // Original URL if type is 'url'
  fileName: text("file_name"), // Original filename if type is 'file'
  fileType: text("file_type"), // MIME type if type is 'file'
  fileSize: text("file_size"), // Size in bytes if type is 'file'
  metadata: jsonb("metadata"), // Additional metadata (page count, word count, etc.)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("knowledge_items_user_id_idx").on(table.userId),
]);

// Projects - isolated workspaces with their own knowledge and context
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  customInstructions: text("custom_instructions"), // Project-specific AI instructions
  includeGlobalKnowledge: text("include_global_knowledge").notNull().default("false"),
  includeUserMemories: text("include_user_memories").notNull().default("false"),
  shareToken: varchar("share_token").unique(), // For shareable links - unique constraint creates index automatically
  isPublic: text("is_public").notNull().default("false"), // Whether project is accessible via share link
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
]);

// Project-specific knowledge (isolated from global knowledge)
export const projectKnowledge = pgTable("project_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // 'file', 'url', 'text'
  title: text("title").notNull(),
  content: text("content").notNull(), // Extracted/processed content for AI context
  sourceUrl: text("source_url"), // Original URL if type is 'url'
  fileName: text("file_name"), // Original filename if type is 'file'
  fileType: text("file_type"), // MIME type if type is 'file'
  fileSize: text("file_size"), // Size in bytes if type is 'file'
  metadata: jsonb("metadata"), // Additional metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("project_knowledge_project_id_idx").on(table.projectId),
]);

// Project files - attachments associated with projects
export const projectFiles = pgTable("project_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // MIME type
  fileSize: text("file_size").notNull(), // Size in bytes
  fileUrl: text("file_url").notNull(), // Storage URL or base64
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("project_files_project_id_idx").on(table.projectId),
]);


// ── Agent Memory ──────────────────────────────────────────────────────────────

export const agentMemories = pgTable("agent_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(), // e.g. 'preference', 'fact', 'procedure', 'context'
  content: text("content").notNull(),
  source: text("source"), // which conversation/tool created this
  relevanceScore: integer("relevance_score").default(50), // 0-100
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("agent_memories_category_idx").on(table.category),
]);

// ── Agent Tasks (background task queue) ──────────────────────────────────────

export const cronJobs = pgTable("cron_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull(),
  prompt: text("prompt").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  recurring: boolean("recurring").notNull().default(true),
  conversationId: varchar("conversation_id"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cron_jobs_user_idx").on(table.userId),
  index("cron_jobs_enabled_idx").on(table.enabled),
]);

export const insertCronJobSchema = createInsertSchema(cronJobs).omit({ id: true, createdAt: true, updatedAt: true, lastRunAt: true });
export type CronJob = typeof cronJobs.$inferSelect;
export type InsertCronJob = z.infer<typeof insertCronJobSchema>;

export const agentTaskStatusEnum = pgEnum('agent_task_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const agentTasks = pgTable("agent_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // e.g. 'deep_research', 'batch_process'
  title: text("title").notNull(),
  status: agentTaskStatusEnum("status").notNull().default('pending'),
  input: jsonb("input"), // task-specific parameters
  output: jsonb("output"), // task result
  error: text("error"),
  conversationId: varchar("conversation_id"),
  progress: integer("progress").default(0), // 0-100
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_tasks_status_idx").on(table.status),
  index("agent_tasks_conversation_idx").on(table.conversationId),
]);

// ── Tool Error Logs ───────────────────────────────────────────────────────────

export const toolErrorLogs = pgTable("tool_error_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  toolName: text("tool_name").notNull(),
  error: text("error").notNull(),
  args: jsonb("args"),
  conversationId: varchar("conversation_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("tool_error_logs_created_idx").on(table.createdAt),
  index("tool_error_logs_tool_name_idx").on(table.toolName),
]);

export const insertToolErrorLogSchema = createInsertSchema(toolErrorLogs).omit({ id: true, createdAt: true });
export type ToolErrorLog = typeof toolErrorLogs.$inferSelect;
export type InsertToolErrorLog = z.infer<typeof insertToolErrorLogSchema>;

export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  });
export const chatStatusSchema = z.enum(['active', 'archived', 'deleted']);
export const insertChatSchema = createInsertSchema(chats).omit({ id: true, createdAt: true, updatedAt: true, status: true, userId: true }).extend({
  status: chatStatusSchema.optional()
});
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const reactionTypeSchema = z.enum(['thumbs_up', 'thumbs_down']);
export const insertReactionSchema = createInsertSchema(reactions).omit({ id: true, createdAt: true }).extend({
  type: reactionTypeSchema
});
export const insertUsageMetricSchema = createInsertSchema(usageMetrics).omit({ id: true, createdAt: true });
export const insertUsageSummarySnapshotSchema = createInsertSchema(usageSummarySnapshots)
  .omit({ id: true, generatedAt: true });
export const oauthProviderSchema = z.enum(['google', 'microsoft']);
export const insertOAuthTokenSchema = createInsertSchema(oauthTokens).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  provider: oauthProviderSchema
});
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserApiKeySchema = createInsertSchema(userApiKeys).omit({ id: true, createdAt: true, updatedAt: true });
export const knowledgeItemTypeSchema = z.enum(['file', 'url', 'text']);
export const insertKnowledgeItemSchema = createInsertSchema(knowledgeItems).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  type: knowledgeItemTypeSchema
});
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true, updatedAt: true, userId: true, shareToken: true });
export const projectKnowledgeTypeSchema = z.enum(['file', 'url', 'text']);
export const insertProjectKnowledgeSchema = createInsertSchema(projectKnowledge).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  type: projectKnowledgeTypeSchema
});
export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({ id: true, createdAt: true });
export const insertAgentMemorySchema = createInsertSchema(agentMemories).omit({ id: true, createdAt: true, updatedAt: true });
export const agentTaskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export const insertTemplateSchema = createInsertSchema(templates)
  .omit({ id: true, createdAt: true, updatedAt: true });
export const insertPlatformSettingsSchema = createInsertSchema(platformSettings)
  .omit({ createdAt: true, updatedAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserPlan = z.infer<typeof userPlanSchema>;
export type UpsertUser = typeof users.$inferInsert; // For Replit Auth upsert operations
export type UserStatus = z.infer<typeof userStatusSchema>;
export type PlanTierConfig = z.infer<typeof planTierSchema>;
export type KnowledgeBaseSettings = z.infer<typeof knowledgeBaseSettingsSchema>;
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export type TemplateSettings = z.infer<typeof templateSettingsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export type PlatformSettingsData = z.infer<typeof platformSettingsDataSchema>;
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type PlatformSettingsHistoryEntry = typeof platformSettingsHistory.$inferSelect;
export type UserRole = z.infer<typeof userRoleSchema>;
export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chats.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertReaction = z.infer<typeof insertReactionSchema>;
export type Reaction = typeof reactions.$inferSelect;
export type InsertUsageMetric = z.infer<typeof insertUsageMetricSchema>;
export type UsageMetric = typeof usageMetrics.$inferSelect;
export type InsertUsageSummarySnapshot = z.infer<typeof insertUsageSummarySnapshotSchema>;
export type UsageSummarySnapshot = typeof usageSummarySnapshots.$inferSelect;
export type InsertOAuthToken = z.infer<typeof insertOAuthTokenSchema>;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserApiKey = z.infer<typeof insertUserApiKeySchema>;
export type UserApiKey = typeof userApiKeys.$inferSelect;
export type InsertKnowledgeItem = z.infer<typeof insertKnowledgeItemSchema>;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProjectKnowledge = z.infer<typeof insertProjectKnowledgeSchema>;
export type ProjectKnowledge = typeof projectKnowledge.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasks.$inferSelect;
export type OutputTemplateCategory = z.infer<typeof outputTemplateCategorySchema>;
export type OutputTemplateFormat = z.infer<typeof outputTemplateFormatSchema>;
export type OutputTemplateSection = z.infer<typeof outputTemplateSectionSchema>;
export type OutputTemplate = typeof outputTemplates.$inferSelect;
export type InsertOutputTemplate = typeof outputTemplates.$inferInsert;
export type OutputTemplateValidation = z.infer<typeof outputTemplateValidationSchema>;
export type Release = typeof releases.$inferSelect;
export type InsertRelease = typeof releases.$inferInsert;
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;
export type N8nAgentStatus = z.infer<typeof n8nAgentStatusSchema>;
export type InsertN8nAgent = z.infer<typeof insertN8nAgentSchema>;
export type AssistantType = z.infer<typeof assistantTypeSchema>;
export type N8nAgent = Assistant & { type: 'webhook'; status: N8nAgentStatus };
export type InsertToolPolicy = z.infer<typeof insertToolPolicySchema>;
export type ToolPolicy = typeof toolPolicies.$inferSelect;
export type UpdateToolPolicy = z.infer<typeof updateToolPolicySchema>;
export type InsertSystemPrompt = typeof systemPrompts.$inferInsert;
export type SystemPrompt = typeof systemPrompts.$inferSelect;
export type SystemPromptCreateInput = z.infer<typeof systemPromptCreateSchema>;
export type SystemPromptUpdateInput = z.infer<typeof systemPromptUpdateSchema>;

// File Attachment Schema
export const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

// Message Metadata Schema - for tracking feature toggles and usage
export const voiceAudioClipSchema = z.object({
  clipId: z.string(),
  mimeType: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  audioUrl: z.string().optional(),
  text: z.string().optional(),
});

export const messageMetadataSchema = z
  .object({
    // Feature toggles for this message
    thorMode: z.boolean().optional(), // Thor Mode: max thinking, tokens, deep research
    thinkingLevel: z.enum(['off', 'standard', 'extended']).optional(), // Thinking/reasoning level
    voiceMode: z.boolean().optional(),
    preferredModelId: z.string().optional(),

    // Token usage (if tracked per-message)
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),

    // Other metadata
    model: z.string().optional(),
    executedTools: z.array(z.string()).optional(), // Track which tools were actually used
    thinkingContent: z.string().optional(), // AI reasoning/thinking process
    outputTemplateId: z.string().uuid().optional(),
    outputTemplateName: z.string().optional(),
    outputTemplateCategory: outputTemplateCategorySchema.optional(),
    outputTemplateFormat: outputTemplateFormatSchema.optional(),
    outputTemplateValidation: outputTemplateValidationSchema.optional(),
    audioClips: z.array(voiceAudioClipSchema).optional(),
    assistantId: z.string().optional(),
    assistantType: assistantTypeSchema.optional(),
    assistantName: z.string().optional(),
    webhook: z
      .object({
        url: z.string().url().optional().nullable(),
        workflowId: z.string().optional().nullable(),
        status: z.enum(['success', 'error', 'timeout']).optional(),
        statusCode: z.number().int().optional(),
        latencyMs: z.number().int().nonnegative().optional(),
        errorMessage: z.string().optional(),
        response: z.unknown().optional(),
      })
      .optional(),
  })
  .optional();

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export const apiProviderSchema = z.enum(['openai', 'anthropic', 'groq', 'perplexity', 'google', 'ollama', 'n8n', 'notion']);
export type ApiProvider = z.infer<typeof apiProviderSchema>;

// AI Model Configuration
export type ModelProvider = 'OpenAI' | 'Anthropic' | 'Groq' | 'Perplexity' | 'Google' | 'Ollama';

export type MediaProviderSettings = z.infer<typeof mediaProviderSettingsSchema>;
export type CustomModel = z.infer<typeof customModelSchema>;

export type ModelCapability = 'chat' | 'vision' | 'audio' | 'search' | 'thinking' | 'code' | 'tools';
export type ModelStatus = 'current' | 'legacy';

export interface AIModel {
  id: string;
  name: string;
  description: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
  maxTokens?: number;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
  status?: ModelStatus;
}

export const AI_MODELS: AIModel[] = [
  // OpenAI Models
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Latest OpenAI flagship with enhanced reasoning and instruction-following',
    provider: 'OpenAI',
    capabilities: ['chat', 'vision', 'search', 'thinking', 'code', 'tools'],
    maxTokens: 200000,
  },

  // Anthropic / Claude Models
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    description: 'Claude Sonnet 4.6 — balanced intelligence and speed for complex tasks',
    provider: 'Anthropic',
    capabilities: ['chat', 'vision', 'search', 'thinking', 'code', 'tools'],
    maxTokens: 200000,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    description: 'Claude Opus 4.6 — most powerful Claude model for highly complex tasks',
    provider: 'Anthropic',
    capabilities: ['chat', 'vision', 'search', 'thinking', 'code', 'tools'],
    maxTokens: 200000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Claude Haiku 4.5 — fastest and most compact Claude model for lightweight tasks',
    provider: 'Anthropic',
    capabilities: ['chat', 'vision', 'code', 'tools'],
    maxTokens: 200000,
  },

  // Groq Models
  {
    id: 'compound',
    name: 'Titan-V',
    description: "MelvinOS flagship model that blends fast inference with autonomous research, web tools, and code execution.",
    provider: 'Groq',
    capabilities: ['chat', 'search', 'code'],
    maxTokens: 32768,
  },
  {
    id: 'os-120b',
    name: 'GPT OS 120B',
    description: 'Open-source 120B parameter model served via Groq for high-quality fast inference',
    provider: 'Groq',
    capabilities: ['chat', 'vision', 'search', 'code', 'tools'],
    maxTokens: 65536,
  },

  // Google Models
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    description: 'Google\'s latest Gemini model with advanced reasoning and multimodal capabilities',
    provider: 'Google',
    capabilities: ['chat', 'vision', 'search', 'thinking', 'code', 'tools'],
    maxTokens: 1000000,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast and efficient Gemini model optimized for speed and cost',
    provider: 'Google',
    capabilities: ['chat', 'vision', 'search', 'code', 'tools'],
    maxTokens: 1000000,
  },

  // Perplexity Models
  {
    id: 'sonar-deep-research',
    name: 'Sonar Deep Research',
    description: 'Perplexity multi-hop research model with exhaustive web search and reasoning',
    provider: 'Perplexity',
    capabilities: ['chat', 'search', 'thinking'],
    maxTokens: 4096,
  },
  {
    id: 'sonar-pro',
    name: 'Sonar Pro',
    description: 'Perplexity advanced search model with tool use, vision, and 200K context',
    provider: 'Perplexity',
    capabilities: ['chat', 'vision', 'search', 'tools'],
    maxTokens: 8000,
  },

  // Ollama Cloud Models
  {
    id: 'qwen3.5-397b',
    name: 'Qwen 3.5 397B',
    description: 'Qwen 3.5 MoE 397B — frontier-class reasoning, tool calling, and code generation via Ollama Cloud',
    provider: 'Ollama',
    capabilities: ['chat', 'vision', 'search', 'thinking', 'code', 'tools'],
    maxTokens: 32768,
  },

  // Legacy Models
  {
    id: 'llama-3.1-8b-instant',
    name: 'Vega-3',
    description: 'Legacy high-speed inference model optimized for rapid responses',
    provider: 'Groq',
    capabilities: ['chat', 'code', 'tools'],
    maxTokens: 32768,
    status: 'legacy',
  },
];

export interface FeatureToggle {
  id: string;
  label: string;
  description: string;
  requiresModelIds?: string[];
  requiresCapabilities?: ModelCapability[];
}

export const FEATURE_TOGGLES: FeatureToggle[] = [];

// Helper functions for models
export const getChatCapableModels = () => AI_MODELS.filter(model => model.capabilities.includes('chat'));

export const getModelsByProvider = (provider: ModelProvider) => AI_MODELS.filter(model => model.provider === provider);

export const getModelById = (id: string) => AI_MODELS.find(model => model.id === id);

export const getDefaultModel = () => AI_MODELS.find(model => model.id === 'compound') || AI_MODELS[0];
