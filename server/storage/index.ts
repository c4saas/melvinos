import {
  type User, type InsertUser, type UpsertUser, type Chat, type InsertChat, type Message, type InsertMessage,
  type Attachment, type Reaction, type InsertReaction, type UsageMetric, type InsertUsageMetric,
  type UsageSummarySnapshot, type InsertUsageSummarySnapshot,
  type OAuthToken, type InsertOAuthToken, type UserPreferences, type InsertUserPreferences,
  type KnowledgeItem, type InsertKnowledgeItem,
  type Project, type InsertProject, type ProjectKnowledge, type InsertProjectKnowledge,
  type ProjectFile, type InsertProjectFile,
  type UserApiKey, type InsertUserApiKey,
  type PlatformSettings, type PlatformSettingsData, type PlatformSettingsHistoryEntry,
  type Assistant, type InsertAssistant, type UpdateAssistant,
  type N8nAgent, type InsertN8nAgent,
  type Template, type InsertTemplate,
  type OutputTemplate, type InsertOutputTemplate,
  type SystemPrompt,
  type Release, type InsertRelease,
  type ToolPolicy, type InsertToolPolicy, type UpdateToolPolicy, type ToolPolicyProvider,
  type UserStatus, type UserPlan,
  type AgentMemory, type InsertAgentMemory,
  type AgentTask, type InsertAgentTask, type AgentTaskStatus,
  type CronJob, type InsertCronJob,
  defaultPlatformSettings, platformSettingsDataSchema, userPlanSchema,
  users,
  chats,
  messages,
  reactions,
  usageMetrics,
  usageSummarySnapshots,
  oauthTokens,
  userPreferences,
  knowledgeItems,
  projects,
  projectKnowledge,
  projectFiles,
  userApiKeys,
  platformSettings,
  templates,
  outputTemplates,
  systemPrompts,
  releases,
  assistants,
  toolPolicies,
  agentMemories,
  agentTasks,
  cronJobs,
  toolErrorLogs,
  platformSettingsHistory,
} from "@shared/schema";
import type { ToolErrorLog, InsertToolErrorLog } from "@shared/schema";
import { randomUUID } from "crypto";
import { nanoid } from "nanoid";
import { db } from "../db";
import { DEFAULT_SYSTEM_PROMPT } from "../system-prompts";
import { eq, and, gte, lte, desc, asc, sql, inArray, ne, or, isNull, ilike } from "drizzle-orm";
import {
  createFileStorage,
  type FileRecord,
  type FileStorageAdapter,
  InMemoryFileStorage,
} from "./file-store";
import { encryptSecret, decryptSecret } from "../security/secret-storage";

export type StoredFile = FileRecord;

// modify the interface with any CRUD methods
// you might need

export interface CreateReleaseOptions {
  label: string;
  systemPromptId?: string | null;
  assistantIds?: string[];
  templateIds?: string[];
  outputTemplateIds?: string[];
  toolPolicyIds?: string[];
  changeNotes?: string | null;
}

export interface ReleaseTransitionOptions {
  changeNotes: string;
  actorUserId?: string | null;
}

const hasOwn = <T extends object>(obj: T, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const DEFAULT_USER_PLAN: UserPlan = 'free';

const parseUserPlanOrDefault = (plan: unknown): UserPlan =>
  plan === undefined ? DEFAULT_USER_PLAN : userPlanSchema.parse(plan);

const parseUserPlanIfProvided = (plan: unknown): UserPlan | undefined =>
  plan === undefined ? undefined : userPlanSchema.parse(plan);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      target[key] = structuredClone(value);
      continue;
    }

    if (isPlainObject(value)) {
      const existing = isPlainObject(target[key]) ? (target[key] as Record<string, unknown>) : {};
      target[key] = existing;
      deepMerge(existing, value);
      continue;
    }

    target[key] = value as unknown;
  }
};

const mergeWithDefaultPlatformSettings = (input: unknown): PlatformSettingsData => {
  const merged = structuredClone(defaultPlatformSettings) as PlatformSettingsData;

  if (isPlainObject(input)) {
    deepMerge(merged as unknown as Record<string, unknown>, structuredClone(input));
  }

  return merged;
};

const normalizeProviderLimits = (data: PlatformSettingsData): void => {
  for (const settings of Object.values(data.apiProviders)) {
    const rawLimit = (settings as Record<string, unknown>).dailyRequestLimit;

    let normalized: number | null = null;
    if (rawLimit !== null && rawLimit !== undefined) {
      const numericLimit =
        typeof rawLimit === 'number' ? rawLimit : Number.parseInt(String(rawLimit), 10);

      if (Number.isFinite(numericLimit) && numericLimit > 0) {
        normalized = Math.trunc(numericLimit);
      }
    }

    settings.dailyRequestLimit = normalized;
  }
};

const parsePlatformSettingsData = (input: unknown): PlatformSettingsData => {
  const merged = mergeWithDefaultPlatformSettings(input ?? undefined);
  normalizeProviderLimits(merged);
  return platformSettingsDataSchema.parse(structuredClone(merged));
};

const preparePlatformSettingsPayload = (data: PlatformSettingsData): PlatformSettingsData => {
  return platformSettingsDataSchema.parse(structuredClone(data));
};

export interface CreateSystemPromptOptions {
  content: string;
  label?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  activate?: boolean;
  activatedByUserId?: string | null;
}

export interface UpdateSystemPromptOptions {
  content?: string;
  label?: string | null;
  notes?: string | null;
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  updateUserStatus(id: string, status: UserStatus): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>; // For Replit Auth
  hasAdminUser(): Promise<boolean>;
  
  // Chat methods
  getChat(id: string): Promise<Chat | undefined>;
  getUserChats(userId: string, includeArchived?: boolean, projectId?: string | null): Promise<Chat[]>;
  getArchivedChats(userId: string): Promise<Chat[]>;
  createChat(chat: InsertChat & { userId: string }): Promise<Chat>;
  updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined>;
  archiveChat(id: string): Promise<boolean>;
  deleteChat(id: string): Promise<boolean>;
  
  // Message methods
  getMessage(id: string): Promise<Message | undefined>;
  getChatMessages(chatId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  getMessagesSince(userId: string, since: Date): Promise<Message[]>;
  
  // Reaction methods
  getMessageReactions(messageId: string): Promise<Reaction[]>;
  getUserReaction(messageId: string, userId: string): Promise<Reaction | undefined>;
  createReaction(reaction: InsertReaction): Promise<Reaction>;
  updateReaction(id: string, type: 'thumbs_up' | 'thumbs_down'): Promise<Reaction | undefined>;
  deleteReaction(id: string): Promise<boolean>;
  
  // Usage tracking methods
  createUsageMetric(metric: InsertUsageMetric): Promise<UsageMetric>;
  getUserUsageMetrics(userId: string, dateFrom?: Date, dateTo?: Date): Promise<UsageMetric[]>;
  getChatUsageMetrics(chatId: string): Promise<UsageMetric[]>;
  saveUsageSummarySnapshot(snapshot: InsertUsageSummarySnapshot): Promise<UsageSummarySnapshot>;
  getLatestUsageSummarySnapshot(userId: string): Promise<UsageSummarySnapshot | undefined>;
  
  // OAuth token methods
  getOAuthToken(userId: string, provider: string, accountLabel?: string): Promise<OAuthToken | undefined>;
  getOAuthTokens(userId: string, provider: string): Promise<OAuthToken[]>;
  listAllOAuthConnections(): Promise<{ userId: string; provider: string; accountLabel: string; createdAt: Date | null }[]>;
  saveOAuthToken(token: InsertOAuthToken): Promise<OAuthToken>;
  updateOAuthToken(userId: string, provider: string, updates: Partial<InsertOAuthToken>, accountLabel?: string): Promise<OAuthToken | undefined>;
  deleteOAuthToken(userId: string, provider: string, accountLabel?: string): Promise<boolean>;

  // User preferences methods
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  saveUserPreferences(userId: string, preferences: InsertUserPreferences): Promise<UserPreferences>;

  // N8N agent methods
  getN8nAgents(): Promise<N8nAgent[]>;
  createN8nAgent(agent: InsertN8nAgent): Promise<N8nAgent>;
  deleteN8nAgent(agentId: string): Promise<boolean>;

  // File methods
  saveFile(
    ownerId: string,
    buffer: Buffer,
    name: string,
    mimeType: string,
    analyzedContent?: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<Attachment>;
  getFileForUser(id: string, ownerId: string): Promise<StoredFile | undefined>;
  deleteFile(id: string, ownerId: string): Promise<boolean>;
  
  // Knowledge item methods
  getKnowledgeItems(userId: string): Promise<KnowledgeItem[]>;
  getKnowledgeItem(id: string): Promise<KnowledgeItem | undefined>;
  createKnowledgeItem(item: InsertKnowledgeItem): Promise<KnowledgeItem>;
  deleteKnowledgeItem(id: string): Promise<boolean>;
  
  // Project methods
  getProject(id: string): Promise<Project | undefined>;
  getProjectByShareToken(shareToken: string): Promise<Project | undefined>;
  getUserProjects(userId: string): Promise<Project[]>;
  createProject(userId: string, project: InsertProject): Promise<Project>;
  updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;
  generateShareToken(projectId: string): Promise<string | undefined>;
  
  // Project knowledge methods
  getProjectKnowledge(projectId: string): Promise<ProjectKnowledge[]>;
  createProjectKnowledge(item: InsertProjectKnowledge): Promise<ProjectKnowledge>;
  deleteProjectKnowledge(id: string): Promise<boolean>;
  
  // Project file methods
  getProjectFiles(projectId: string): Promise<ProjectFile[]>;
  createProjectFile(file: InsertProjectFile): Promise<ProjectFile>;
  deleteProjectFile(id: string): Promise<boolean>;
  
  // Chat migration methods
  moveChatToProject(chatId: string, projectId: string | null): Promise<Chat | undefined>;

  // Platform settings methods
  getPlatformSettings(): Promise<PlatformSettings>;
  upsertPlatformSettings(data: PlatformSettingsData, changedBy?: string): Promise<PlatformSettings>;
  getSettingsHistory(limit?: number): Promise<PlatformSettingsHistoryEntry[]>;
  restoreSettingsVersion(version: number, restoredBy?: string): Promise<PlatformSettings | undefined>;

  // System prompt methods
  listSystemPrompts(): Promise<SystemPrompt[]>;
  getSystemPrompt(id: string): Promise<SystemPrompt | undefined>;
  getActiveSystemPrompt(): Promise<SystemPrompt | undefined>;
  createSystemPrompt(options: CreateSystemPromptOptions): Promise<SystemPrompt>;
  updateSystemPrompt(id: string, updates: UpdateSystemPromptOptions): Promise<SystemPrompt | undefined>;
  activateSystemPrompt(id: string, activatedByUserId?: string | null): Promise<SystemPrompt | undefined>;
  deleteSystemPrompt(id: string): Promise<boolean>;

  // Release methods
  listReleases(): Promise<Release[]>;
  getRelease(id: string): Promise<Release | undefined>;
  getActiveRelease(): Promise<Release | undefined>;
  createRelease(options: CreateReleaseOptions): Promise<Release>;
  publishRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined>;
  rollbackRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined>;

  // Assistant methods
  listAssistants(): Promise<Assistant[]>;
  listActiveAssistants(): Promise<Assistant[]>;
  getAssistant(id: string): Promise<Assistant | undefined>;
  createAssistant(assistant: InsertAssistant): Promise<Assistant>;
  updateAssistant(id: string, updates: UpdateAssistant): Promise<Assistant | undefined>;
  deleteAssistant(id: string): Promise<boolean>;

  // Template methods
  listTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | undefined>;
  createTemplate(template: InsertTemplate): Promise<Template>;
  updateTemplate(id: string, updates: Partial<InsertTemplate>): Promise<Template | undefined>;
  deleteTemplate(id: string): Promise<boolean>;

  // Output template methods
  listOutputTemplates(): Promise<OutputTemplate[]>;
  getOutputTemplate(id: string): Promise<OutputTemplate | undefined>;
  createOutputTemplate(template: InsertOutputTemplate): Promise<OutputTemplate>;
  updateOutputTemplate(id: string, updates: Partial<InsertOutputTemplate>): Promise<OutputTemplate | undefined>;
  deleteOutputTemplate(id: string): Promise<boolean>;

  // Tool policy methods
  listToolPolicies(): Promise<ToolPolicy[]>;
  listToolPoliciesByProvider(provider: ToolPolicyProvider): Promise<ToolPolicy[]>;
  getToolPolicy(id: string): Promise<ToolPolicy | undefined>;
  createToolPolicy(policy: InsertToolPolicy): Promise<ToolPolicy>;
  updateToolPolicy(id: string, updates: UpdateToolPolicy): Promise<ToolPolicy | undefined>;
  deleteToolPolicy(id: string): Promise<boolean>;

  // Agent memory methods
  listAgentMemories(category?: string): Promise<AgentMemory[]>;
  searchAgentMemories(query: string, limit?: number): Promise<AgentMemory[]>;
  createAgentMemory(memory: InsertAgentMemory): Promise<AgentMemory>;
  updateAgentMemory(id: string, updates: Partial<InsertAgentMemory>): Promise<AgentMemory | undefined>;
  deleteAgentMemory(id: string): Promise<boolean>;

  // Agent task methods
  listAgentTasks(status?: AgentTaskStatus): Promise<AgentTask[]>;
  getAgentTask(id: string): Promise<AgentTask | undefined>;
  createAgentTask(task: InsertAgentTask): Promise<AgentTask>;
  updateAgentTask(id: string, updates: Partial<AgentTask>): Promise<AgentTask | undefined>;

  // Cron job methods
  listCronJobs(userId?: string): Promise<CronJob[]>;
  getCronJob(id: string): Promise<CronJob | undefined>;
  createCronJob(job: InsertCronJob): Promise<CronJob>;
  updateCronJob(id: string, updates: Partial<CronJob>): Promise<CronJob | undefined>;
  deleteCronJob(id: string): Promise<boolean>;
  getEnabledCronJobs(): Promise<CronJob[]>;

  // Tool error log methods
  logToolError(data: InsertToolErrorLog): Promise<ToolErrorLog>;
  listToolErrors(limit?: number): Promise<ToolErrorLog[]>;
  clearToolErrors(): Promise<void>;

}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private chats: Map<string, Chat>;
  private messages: Map<string, Message>;
  private reactions: Map<string, Reaction>;
  private usageMetrics: Map<string, UsageMetric>;
  private usageSummarySnapshots: Map<string, UsageSummarySnapshot[]>;
  private oauthTokens: Map<string, OAuthToken>;
  private userPreferences: Map<string, UserPreferences>;
  private knowledgeItems: Map<string, KnowledgeItem>;
  private projects: Map<string, Project>;
  private projectKnowledgeMap: Map<string, ProjectKnowledge>;
  private projectFilesMap: Map<string, ProjectFile>;
  private assistantsMap: Map<string, Assistant>;
  private fileStorage: InMemoryFileStorage;
  private platformSettings: PlatformSettings;
  private templatesMap: Map<string, Template>;
  private outputTemplatesMap: Map<string, OutputTemplate>;
  private toolPoliciesMap: Map<string, ToolPolicy>;
  private toolPolicyKeyIndex: Map<string, string>;
  private systemPromptsMap: Map<string, SystemPrompt>;
  private activeSystemPromptId: string | null;
  private systemPromptVersionCounter: number;
  private releasesMap: Map<string, Release>;
  private activeReleaseId: string | null;
  private releaseVersionCounter: number;

  constructor() {
    this.users = new Map();
    this.chats = new Map();
    this.messages = new Map();
    this.reactions = new Map();
    this.usageMetrics = new Map();
    this.usageSummarySnapshots = new Map();
    this.oauthTokens = new Map();
    this.userPreferences = new Map();
    this.knowledgeItems = new Map();
    this.projects = new Map();
    this.projectKnowledgeMap = new Map();
    this.projectFilesMap = new Map();
    this.assistantsMap = new Map();
    this.fileStorage = new InMemoryFileStorage();
    this.templatesMap = new Map();
    this.outputTemplatesMap = new Map();
    this.toolPoliciesMap = new Map();
    this.toolPolicyKeyIndex = new Map();
    this.systemPromptsMap = new Map();
    this.activeSystemPromptId = null;
    this.systemPromptVersionCounter = 0;
    this.releasesMap = new Map();
    this.activeReleaseId = null;
    this.releaseVersionCounter = 0;
    const now = new Date();
    this.platformSettings = {
      id: 'global',
      data: preparePlatformSettingsPayload(defaultPlatformSettings),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const superAdminId = randomUUID();
    const superAdminUser: User = {
      id: superAdminId,
      username: 'superadmin',
      password: null,
      email: 'superadmin@example.com',
      avatar: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      plan: 'pro',
      proAccessCode: null,
      role: 'super_admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(superAdminId, superAdminUser);

    const defaultPromptId = randomUUID();
    const defaultPrompt: SystemPrompt = {
      id: defaultPromptId,
      version: 1,
      label: 'Default prompt',
      content: DEFAULT_SYSTEM_PROMPT,
      notes: 'Seeded default system prompt',
      createdByUserId: null,
      activatedByUserId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
    };
    this.systemPromptsMap.set(defaultPromptId, defaultPrompt);
    this.activeSystemPromptId = defaultPromptId;
    this.systemPromptVersionCounter = 1;

    const defaultReleaseId = randomUUID();
    const defaultRelease: Release = {
      id: defaultReleaseId,
      version: 1,
      label: 'Seed release',
      status: 'active',
      changeNotes: 'Initial platform release',
      systemPromptId: defaultPromptId,
      assistantIds: [],
      templateIds: [],
      outputTemplateIds: [],
      toolPolicyIds: [],
      isActive: true,
      publishedAt: now,
      publishedByUserId: superAdminId,
      createdAt: now,
      updatedAt: now,
    };
    this.releasesMap.set(defaultReleaseId, defaultRelease);
    this.activeReleaseId = defaultReleaseId;
    this.releaseVersionCounter = 1;
  }

  private normalizeIdList(ids?: string[] | null): string[] {
    if (!ids) {
      return [];
    }

    const unique = new Set<string>();
    const normalized: string[] = [];
    for (const rawId of ids) {
      if (typeof rawId !== 'string') {
        continue;
      }
      const trimmed = rawId.trim();
      if (!trimmed) {
        continue;
      }
      if (!unique.has(trimmed)) {
        unique.add(trimmed);
        normalized.push(trimmed);
      }
    }

    return normalized;
  }

  private getToolPolicyKey(provider: string, toolName: string): string {
    return `${provider.trim().toLowerCase()}::${toolName.trim().toLowerCase()}`;
  }

  private normalizeIdList(ids?: string[] | null): string[] {
    if (!ids) {
      return [];
    }

    const unique = new Set<string>();
    const normalized: string[] = [];
    for (const rawId of ids) {
      if (typeof rawId !== 'string') {
        continue;
      }
      const trimmed = rawId.trim();
      if (!trimmed) {
        continue;
      }
      if (!unique.has(trimmed)) {
        unique.add(trimmed);
        normalized.push(trimmed);
      }
    }

    return normalized;
  }

  private cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
    return {
      ...policy,
      createdAt: new Date(policy.createdAt),
      updatedAt: new Date(policy.updatedAt),
    };
  }

  async listSystemPrompts(): Promise<SystemPrompt[]> {
    return Array.from(this.systemPromptsMap.values())
      .sort((a, b) => b.version - a.version)
      .map((prompt) => structuredClone(prompt));
  }

  async getSystemPrompt(id: string): Promise<SystemPrompt | undefined> {
    const prompt = this.systemPromptsMap.get(id);
    return prompt ? structuredClone(prompt) : undefined;
  }

  async getActiveSystemPrompt(): Promise<SystemPrompt | undefined> {
    if (this.activeReleaseId) {
      const release = this.releasesMap.get(this.activeReleaseId);
      if (release?.systemPromptId) {
        const prompt = this.systemPromptsMap.get(release.systemPromptId);
        if (prompt) {
          this.activeSystemPromptId = release.systemPromptId;
          return structuredClone(prompt);
        }
      }
    }

    if (this.activeSystemPromptId) {
      const prompt = this.systemPromptsMap.get(this.activeSystemPromptId);
      if (prompt) {
        return structuredClone(prompt);
      }
    }

    const active = Array.from(this.systemPromptsMap.values()).find((prompt) => prompt.isActive);
    return active ? structuredClone(active) : undefined;
  }

  async createSystemPrompt(options: CreateSystemPromptOptions): Promise<SystemPrompt> {
    const now = new Date();
    const id = randomUUID();
    const nextVersion = this.systemPromptVersionCounter + 1;
    const activatedBy = options.activate ? options.activatedByUserId ?? options.createdByUserId ?? null : null;

    if (options.activate) {
      for (const [key, prompt] of this.systemPromptsMap.entries()) {
        const updated: SystemPrompt = {
          ...prompt,
          isActive: false,
          activatedAt: null,
          activatedByUserId: null,
          updatedAt: now,
        };
        this.systemPromptsMap.set(key, updated);
      }
      this.activeSystemPromptId = id;
    }

    const record: SystemPrompt = {
      id,
      version: nextVersion,
      label: options.label ?? null,
      content: options.content,
      notes: options.notes ?? null,
      createdByUserId: options.createdByUserId ?? null,
      activatedByUserId: options.activate ? activatedBy : null,
      isActive: options.activate ?? false,
      createdAt: now,
      updatedAt: now,
      activatedAt: options.activate ? now : null,
    };

    this.systemPromptsMap.set(id, record);
    this.systemPromptVersionCounter = nextVersion;

    if (record.isActive) {
      this.activeSystemPromptId = id;
    }

    return structuredClone(record);
  }

  async updateSystemPrompt(id: string, updates: UpdateSystemPromptOptions): Promise<SystemPrompt | undefined> {
    const existing = this.systemPromptsMap.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: SystemPrompt = {
      ...existing,
      updatedAt: new Date(),
    };

    if (updates.content !== undefined) {
      updated.content = updates.content;
    }
    if (updates.label !== undefined) {
      updated.label = updates.label ?? null;
    }
    if (updates.notes !== undefined) {
      updated.notes = updates.notes ?? null;
    }

    this.systemPromptsMap.set(id, updated);

    if (updated.isActive) {
      this.activeSystemPromptId = id;
    }

    return structuredClone(updated);
  }

  async activateSystemPrompt(id: string, activatedByUserId?: string | null): Promise<SystemPrompt | undefined> {
    const target = this.systemPromptsMap.get(id);
    if (!target) {
      return undefined;
    }

    const now = new Date();
    for (const [key, prompt] of this.systemPromptsMap.entries()) {
      const isTarget = key === id;
      const updated: SystemPrompt = {
        ...prompt,
        isActive: isTarget,
        activatedAt: isTarget ? now : null,
        activatedByUserId: isTarget ? (activatedByUserId ?? null) : null,
        updatedAt: now,
      };
      this.systemPromptsMap.set(key, updated);
    }

    this.activeSystemPromptId = id;
    const activated = this.systemPromptsMap.get(id)!;
    return structuredClone(activated);
  }

  async deleteSystemPrompt(id: string): Promise<boolean> {
    const prompt = this.systemPromptsMap.get(id);
    if (!prompt || prompt.isActive) return false;
    this.systemPromptsMap.delete(id);
    return true;
  }

  async listReleases(): Promise<Release[]> {
    return Array.from(this.releasesMap.values())
      .sort((a, b) => b.version - a.version)
      .map((release) => structuredClone(release));
  }

  async getRelease(id: string): Promise<Release | undefined> {
    const release = this.releasesMap.get(id);
    return release ? structuredClone(release) : undefined;
  }

  async getActiveRelease(): Promise<Release | undefined> {
    if (this.activeReleaseId) {
      const release = this.releasesMap.get(this.activeReleaseId);
      if (release) {
        return structuredClone(release);
      }
    }

    const active = Array.from(this.releasesMap.values()).find((release) => release.isActive);
    if (active) {
      this.activeReleaseId = active.id;
      return structuredClone(active);
    }

    return undefined;
  }

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const now = new Date();
    const id = randomUUID();
    const nextVersion = this.releaseVersionCounter + 1;

    const release: Release = {
      id,
      version: nextVersion,
      label: options.label,
      status: 'draft',
      changeNotes: options.changeNotes ?? null,
      systemPromptId: options.systemPromptId ?? null,
      assistantIds: this.normalizeIdList(options.assistantIds),
      templateIds: this.normalizeIdList(options.templateIds),
      outputTemplateIds: this.normalizeIdList(options.outputTemplateIds),
      toolPolicyIds: this.normalizeIdList(options.toolPolicyIds),
      isActive: false,
      publishedAt: null,
      publishedByUserId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.releasesMap.set(id, release);
    this.releaseVersionCounter = nextVersion;
    return structuredClone(release);
  }

  async publishRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined> {
    const release = this.releasesMap.get(id);
    if (!release) {
      return undefined;
    }

    const now = new Date();

    if (this.activeReleaseId && this.activeReleaseId !== id) {
      const current = this.releasesMap.get(this.activeReleaseId);
      if (current) {
        this.releasesMap.set(current.id, {
          ...current,
          status: 'archived',
          isActive: false,
          updatedAt: now,
        });
      }
    }

    const updated: Release = {
      ...release,
      status: 'active',
      isActive: true,
      changeNotes: options.changeNotes,
      publishedAt: now,
      publishedByUserId: options.actorUserId ?? null,
      updatedAt: now,
    };

    this.releasesMap.set(id, updated);
    this.activeReleaseId = id;

    if (updated.systemPromptId) {
      for (const [key, prompt] of this.systemPromptsMap.entries()) {
        const isTarget = key === updated.systemPromptId;
        this.systemPromptsMap.set(key, {
          ...prompt,
          isActive: isTarget,
          activatedAt: isTarget ? now : null,
          activatedByUserId: isTarget ? options.actorUserId ?? null : null,
          updatedAt: now,
        });
      }
      this.activeSystemPromptId = updated.systemPromptId;
    } else {
      for (const [key, prompt] of this.systemPromptsMap.entries()) {
        this.systemPromptsMap.set(key, {
          ...prompt,
          isActive: false,
          activatedAt: null,
          activatedByUserId: null,
          updatedAt: now,
        });
      }
      this.activeSystemPromptId = null;
    }

    return structuredClone(updated);
  }

  async rollbackRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined> {
    return this.publishRelease(id, options);
  }

  private cloneAssistant(record: Assistant): Assistant {
    return structuredClone(record) as Assistant;
  }

  private normalizeAssistantForReturn(record: Assistant): Assistant {
    return this.cloneAssistant(record);
  }

  private normalizeN8nAgent(record: Assistant): N8nAgent {
    const assistant = this.normalizeAssistantForReturn(record);
    return {
      ...assistant,
      type: 'webhook',
      status: assistant.isActive ? 'active' : 'inactive',
    };
  }

  async listAssistants(): Promise<Assistant[]> {
    return Array.from(this.assistantsMap.values())
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((assistant) => this.normalizeAssistantForReturn(assistant));
  }

  async listActiveAssistants(): Promise<Assistant[]> {
    return Array.from(this.assistantsMap.values())
      .filter((assistant) => assistant.isActive)
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .map((assistant) => this.normalizeAssistantForReturn(assistant));
  }

  async getAssistant(id: string): Promise<Assistant | undefined> {
    const assistant = this.assistantsMap.get(id);
    return assistant ? this.normalizeAssistantForReturn(assistant) : undefined;
  }

  async createAssistant(insertAssistant: InsertAssistant): Promise<Assistant> {
    const now = new Date();
    const id = randomUUID();
    const record: Assistant = {
      id,
      type: insertAssistant.type ?? 'prompt',
      userId: insertAssistant.userId ?? null,
      name: insertAssistant.name,
      description: insertAssistant.description ?? null,
      promptContent: insertAssistant.promptContent ?? null,
      webhookUrl: insertAssistant.webhookUrl ?? null,
      workflowId: insertAssistant.workflowId ?? null,
      metadata: insertAssistant.metadata ? structuredClone(insertAssistant.metadata) : null,
      isActive: insertAssistant.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.assistantsMap.set(id, record);
    return this.normalizeAssistantForReturn(record);
  }

  async updateAssistant(id: string, updates: UpdateAssistant): Promise<Assistant | undefined> {
    const existing = this.assistantsMap.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: Assistant = {
      ...existing,
      updatedAt: new Date(),
    };

    if (updates.type !== undefined) {
      updated.type = updates.type;
    }
    if (updates.userId !== undefined) {
      updated.userId = updates.userId ?? null;
    }
    if (updates.name !== undefined) {
      updated.name = updates.name;
    }
    if (updates.description !== undefined) {
      updated.description = updates.description ?? null;
    }
    if (updates.promptContent !== undefined) {
      updated.promptContent = updates.promptContent ?? null;
    }
    if (updates.webhookUrl !== undefined) {
      updated.webhookUrl = updates.webhookUrl ?? null;
    }
    if (updates.workflowId !== undefined) {
      updated.workflowId = updates.workflowId ?? null;
    }
    if (updates.metadata !== undefined) {
      updated.metadata = updates.metadata ? structuredClone(updates.metadata) : null;
    }
    if (updates.isActive !== undefined) {
      updated.isActive = updates.isActive;
    }

    this.assistantsMap.set(id, updated);
    return this.normalizeAssistantForReturn(updated);
  }

  async deleteAssistant(id: string): Promise<boolean> {
    return this.assistantsMap.delete(id);
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values()).sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  async hasAdminUser(): Promise<boolean> {
    return Array.from(this.users.values()).some((user) => user.role === 'admin' || user.role === 'super_admin');
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
      username: insertUser.username ?? null,
      email: insertUser.email ?? null,
      avatar: insertUser.avatar ?? null,
      firstName: insertUser.firstName ?? null,
      lastName: insertUser.lastName ?? null,
      profileImageUrl: insertUser.profileImageUrl ?? null,
      plan: parseUserPlanOrDefault(insertUser.plan),
      password: insertUser.password ?? null,
      proAccessCode: insertUser.proAccessCode ?? null,
      role: insertUser.role ?? 'user',
      status: insertUser.status ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const existingUser = this.users.get(id);
    if (!existingUser) return undefined;

    const safeUpdates: Partial<User> = { ...updates };

    if (hasOwn(updates, 'plan')) {
      const parsedPlan = parseUserPlanIfProvided((updates as { plan?: unknown }).plan);
      if (parsedPlan === undefined) {
        delete (safeUpdates as Record<string, unknown>).plan;
      } else {
        safeUpdates.plan = parsedPlan;
      }
    }

    const updatedUser: User = {
      ...existingUser,
      ...safeUpdates,
      updatedAt: new Date(),
    };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async updateUserStatus(id: string, status: UserStatus): Promise<User | undefined> {
    return this.updateUser(id, { status });
  }
  
  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = userData.id ? await this.getUser(userData.id) : undefined;
    
    if (existingUser) {
      // Update existing user
      const safeUpdates = { ...userData } as Partial<User>;

      if (hasOwn(userData, 'plan')) {
        const parsedPlan = parseUserPlanIfProvided((userData as { plan?: unknown }).plan);
        if (parsedPlan === undefined) {
          delete (safeUpdates as Record<string, unknown>).plan;
        } else {
          safeUpdates.plan = parsedPlan;
        }
      }

      const updatedUser = {
        ...existingUser,
        ...safeUpdates,
        updatedAt: new Date()
      } as User;
      this.users.set(existingUser.id, updatedUser);
      return updatedUser;
    } else {
      // Create new user
      const id = userData.id || randomUUID();
      const newUser: User = {
        id,
        username: userData.username || null,
        password: userData.password || null,
        email: userData.email || null,
        avatar: userData.avatar || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        profileImageUrl: userData.profileImageUrl || null,
        plan: parseUserPlanOrDefault(userData.plan),
        proAccessCode: userData.proAccessCode || null,
        role: userData.role || 'user',
        status: userData.status || 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.users.set(id, newUser);
      return newUser;
    }
  }

  // Chat methods
  async getChat(id: string): Promise<Chat | undefined> {
    return this.chats.get(id);
  }

  async getUserChats(userId: string, includeArchived = false, projectId?: string | null): Promise<Chat[]> {
    return Array.from(this.chats.values()).filter(
      (chat) => {
        // Filter by user
        if (chat.userId !== userId) return false;
        
        // Filter by status
        const statusMatch = includeArchived ? chat.status !== 'deleted' : chat.status === 'active';
        if (!statusMatch) return false;
        
        // Filter by projectId
        // If projectId is undefined, return all chats regardless of project
        // If projectId is null, return only global chats (chat.projectId === null)
        // If projectId is a string, return only chats for that specific project
        if (projectId !== undefined) {
          if (projectId === null) {
            return chat.projectId === null;
          } else {
            return chat.projectId === projectId;
          }
        }
        
        return true;
      }
    ).sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime());
  }

  async getArchivedChats(userId: string): Promise<Chat[]> {
    return Array.from(this.chats.values()).filter(
      (chat) => chat.userId === userId && chat.status === 'archived'
    ).sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime());
  }

  async createChat(insertChat: InsertChat & { userId: string }): Promise<Chat> {
    const id = randomUUID();
    const now = new Date();
    const chat: Chat = {
      ...insertChat,
      id,
      userId: insertChat.userId,
      projectId: insertChat.projectId || null,
      model: insertChat.model || 'compound',
      status: 'active',
      createdAt: now,
      updatedAt: now
    };
    this.chats.set(id, chat);
    return chat;
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    const existingChat = this.chats.get(id);
    if (!existingChat) return undefined;
    
    const updatedChat: Chat = {
      ...existingChat,
      ...updates,
      updatedAt: new Date()
    };
    this.chats.set(id, updatedChat);
    return updatedChat;
  }

  async archiveChat(id: string): Promise<boolean> {
    const chat = this.chats.get(id);
    if (!chat) return false;
    
    const updatedChat: Chat = {
      ...chat,
      status: 'archived',
      updatedAt: new Date()
    };
    this.chats.set(id, updatedChat);
    return true;
  }

  async deleteChat(id: string): Promise<boolean> {
    const chat = this.chats.get(id);
    if (!chat) return false;
    
    const updatedChat: Chat = {
      ...chat,
      status: 'deleted',
      updatedAt: new Date()
    };
    this.chats.set(id, updatedChat);
    return true;
  }

  // Message methods
  async getMessage(id: string): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async getChatMessages(chatId: string): Promise<Message[]> {
    return Array.from(this.messages.values()).filter(
      (message) => message.chatId === chatId
    ).sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const message: Message = {
      ...insertMessage,
      id,
      attachments: insertMessage.attachments || null,
      metadata: insertMessage.metadata || null,
      createdAt: new Date()
    };
    this.messages.set(id, message);
    return message;
  }
  
  async getMessagesSince(userId: string, since: Date): Promise<Message[]> {
    // Get all chats for the user
    const userChats = await this.getUserChats(userId, true);
    const chatIds = userChats.map(chat => chat.id);
    
    // Get all messages from user's chats since the given date
    return Array.from(this.messages.values()).filter(
      message => chatIds.includes(message.chatId) && 
      new Date(message.createdAt!) >= since &&
      message.role === 'user' // Only count user messages for rate limiting
    );
  }

  // File methods
  async saveFile(
    ownerId: string,
    buffer: Buffer,
    name: string,
    mimeType: string,
    analyzedContent?: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<Attachment> {
    const record = await this.fileStorage.put({
      ownerId,
      buffer,
      name,
      mimeType,
      analyzedContent,
      metadata,
    });

    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      url: await this.fileStorage.getSignedUrl(record.id),
    };
  }

  async getFileForUser(id: string, ownerId: string): Promise<StoredFile | undefined> {
    const record = await this.fileStorage.get(id);
    if (!record || record.ownerId !== ownerId) {
      return undefined;
    }
    return record;
  }

  async deleteFile(id: string, ownerId: string): Promise<boolean> {
    const record = await this.fileStorage.get(id);
    if (!record || record.ownerId !== ownerId) {
      return false;
    }
    await this.fileStorage.delete(id);
    return true;
  }

  // Reaction methods
  async getMessageReactions(messageId: string): Promise<Reaction[]> {
    return Array.from(this.reactions.values()).filter(
      reaction => reaction.messageId === messageId
    );
  }

  async getUserReaction(messageId: string, userId: string): Promise<Reaction | undefined> {
    return Array.from(this.reactions.values()).find(
      reaction => reaction.messageId === messageId && reaction.userId === userId
    );
  }

  async createReaction(insertReaction: InsertReaction): Promise<Reaction> {
    const id = randomUUID();
    const reaction: Reaction = {
      ...insertReaction,
      id,
      createdAt: new Date()
    };
    this.reactions.set(id, reaction);
    return reaction;
  }

  async updateReaction(id: string, type: 'thumbs_up' | 'thumbs_down'): Promise<Reaction | undefined> {
    const reaction = this.reactions.get(id);
    if (!reaction) return undefined;
    
    const updatedReaction: Reaction = {
      ...reaction,
      type
    };
    this.reactions.set(id, updatedReaction);
    return updatedReaction;
  }

  async deleteReaction(id: string): Promise<boolean> {
    return this.reactions.delete(id);
  }

  // Usage tracking methods
  async createUsageMetric(insertMetric: InsertUsageMetric): Promise<UsageMetric> {
    const id = randomUUID();
    const metric: UsageMetric = {
      ...insertMetric,
      id,
      messageId: insertMetric.messageId || null,
      promptTokens: insertMetric.promptTokens || 0,
      completionTokens: insertMetric.completionTokens || 0,
      totalTokens: insertMetric.totalTokens || 0,
      createdAt: new Date()
    };
    this.usageMetrics.set(id, metric);
    return metric;
  }

  async getUserUsageMetrics(userId: string, dateFrom?: Date, dateTo?: Date): Promise<UsageMetric[]> {
    return Array.from(this.usageMetrics.values()).filter(metric => {
      if (metric.userId !== userId) return false;
      if (dateFrom && new Date(metric.createdAt!) < dateFrom) return false;
      if (dateTo && new Date(metric.createdAt!) > dateTo) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getChatUsageMetrics(chatId: string): Promise<UsageMetric[]> {
    return Array.from(this.usageMetrics.values()).filter(
      metric => metric.chatId === chatId
    ).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async saveUsageSummarySnapshot(snapshot: InsertUsageSummarySnapshot): Promise<UsageSummarySnapshot> {
    const record: UsageSummarySnapshot = {
      id: randomUUID(),
      userId: snapshot.userId,
      rangeStart: new Date(snapshot.rangeStart),
      rangeEnd: new Date(snapshot.rangeEnd),
      totals: structuredClone(snapshot.totals),
      modelBreakdown: structuredClone(snapshot.modelBreakdown ?? []),
      generatedAt: snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(),
    };

    const entries = this.usageSummarySnapshots.get(snapshot.userId) ?? [];
    const existingIndex = entries.findIndex((item) =>
      new Date(item.rangeStart).getTime() === record.rangeStart.getTime() &&
      new Date(item.rangeEnd).getTime() === record.rangeEnd.getTime(),
    );

    if (existingIndex >= 0) {
      entries[existingIndex] = record;
    } else {
      entries.push(record);
    }

    entries.sort((a, b) => new Date(b.generatedAt!).getTime() - new Date(a.generatedAt!).getTime());
    this.usageSummarySnapshots.set(snapshot.userId, entries);

    return structuredClone(record);
  }

  async getLatestUsageSummarySnapshot(userId: string): Promise<UsageSummarySnapshot | undefined> {
    const entries = this.usageSummarySnapshots.get(userId);
    if (!entries || entries.length === 0) {
      return undefined;
    }
    const [latest] = entries;
    return structuredClone(latest);
  }

  // OAuth token methods
  async getOAuthToken(userId: string, provider: string, accountLabel = 'default'): Promise<OAuthToken | undefined> {
    return Array.from(this.oauthTokens.values()).find(
      token => token.userId === userId && token.provider === provider && token.accountLabel === accountLabel
    ) ?? Array.from(this.oauthTokens.values()).find(
      token => token.userId === userId && token.provider === provider
    );
  }

  async getOAuthTokens(userId: string, provider: string): Promise<OAuthToken[]> {
    return Array.from(this.oauthTokens.values()).filter(
      token => token.userId === userId && token.provider === provider
    );
  }

  async saveOAuthToken(insertToken: InsertOAuthToken): Promise<OAuthToken> {
    const label = (insertToken as any).accountLabel ?? 'default';
    // Upsert: replace existing token for same (userId, provider, accountLabel)
    const existing = await this.getOAuthToken(insertToken.userId, insertToken.provider, label);
    const id = existing?.id ?? randomUUID();
    const now = new Date();
    const token: OAuthToken = {
      ...insertToken,
      accountLabel: label,
      id,
      refreshToken: insertToken.refreshToken || null,
      tokenExpiry: insertToken.tokenExpiry || null,
      scopes: insertToken.scopes || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.oauthTokens.set(id, token);
    return token;
  }

  async updateOAuthToken(userId: string, provider: string, updates: Partial<InsertOAuthToken>, accountLabel = 'default'): Promise<OAuthToken | undefined> {
    const existingToken = await this.getOAuthToken(userId, provider, accountLabel);
    if (!existingToken) return undefined;

    const updatedToken: OAuthToken = {
      ...existingToken,
      ...updates,
      updatedAt: new Date()
    };
    this.oauthTokens.set(existingToken.id, updatedToken);
    return updatedToken;
  }

  async listAllOAuthConnections(): Promise<{ userId: string; provider: string; accountLabel: string; createdAt: Date | null }[]> {
    return Array.from(this.oauthTokens.values()).map((t) => ({
      userId: t.userId,
      provider: t.provider,
      accountLabel: t.accountLabel ?? 'default',
      createdAt: t.createdAt ?? null,
    }));
  }

  async deleteOAuthToken(userId: string, provider: string, accountLabel = 'default'): Promise<boolean> {
    const token = await this.getOAuthToken(userId, provider, accountLabel);
    if (!token) return false;
    return this.oauthTokens.delete(token.id);
  }
  
  // User preferences methods
  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    return Array.from(this.userPreferences.values()).find(
      (prefs) => prefs.userId === userId
    );
  }
  
  async saveUserPreferences(userId: string, preferences: InsertUserPreferences): Promise<UserPreferences> {
    let existing = await this.getUserPreferences(userId);

    if (existing) {
      // Update existing preferences
      const lastArea =
        (typeof preferences.lastArea === 'string' && preferences.lastArea.trim().length > 0
          ? preferences.lastArea
          : existing.lastArea) ?? 'user';
      const updated: UserPreferences = {
        ...existing,
        ...preferences,
        userId,
        memories: preferences.memories as string[] || existing.memories || [],
        lastArea,
        updatedAt: new Date()
      };
      this.userPreferences.set(existing.id, updated);
      return updated;
    } else {
      // Create new preferences
      const id = randomUUID();
      const lastArea =
        typeof preferences.lastArea === 'string' && preferences.lastArea.trim().length > 0
          ? preferences.lastArea
          : 'user';
      const newPrefs: UserPreferences = {
        ...preferences,
        id,
        userId,
        personalizationEnabled: preferences.personalizationEnabled || "false",
        customInstructions: preferences.customInstructions || null,
        name: preferences.name || null,
        occupation: preferences.occupation || null,
        bio: preferences.bio || null,
        profileImageUrl: preferences.profileImageUrl || null,
        memories: preferences.memories as string[] || [],
        chatHistoryEnabled: preferences.chatHistoryEnabled || "true",
        autonomousCodeExecution: preferences.autonomousCodeExecution ?? "false",
        lastArea,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.userPreferences.set(id, newPrefs);
      return newPrefs;
    }
  }

  async getN8nAgents(): Promise<N8nAgent[]> {
    return Array.from(this.assistantsMap.values())
      .filter((assistant) => assistant.type === 'webhook' && assistant.userId == null)
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .map((assistant) => this.normalizeN8nAgent(assistant));
  }

  async createN8nAgent(agent: InsertN8nAgent): Promise<N8nAgent> {
    const isActive = (agent.status ?? 'inactive') === 'active';
    const existing = Array.from(this.assistantsMap.values()).find(
      (record) => record.type === 'webhook' && record.workflowId === agent.workflowId && record.userId == null,
    );

    if (existing) {
      const updated = await this.updateAssistant(existing.id, {
        name: agent.name,
        description: agent.description ?? null,
        webhookUrl: agent.webhookUrl ?? null,
        workflowId: agent.workflowId,
        ...(agent.metadata !== undefined ? { metadata: agent.metadata ?? null } : {}),
        isActive,
      });
      return this.normalizeN8nAgent(updated!);
    }

    const assistant = await this.createAssistant({
      type: 'webhook',
      userId: null,
      name: agent.name,
      description: agent.description ?? null,
      webhookUrl: agent.webhookUrl ?? null,
      workflowId: agent.workflowId,
      metadata: agent.metadata ?? null,
      isActive,
    });

    return this.normalizeN8nAgent(assistant);
  }

  async deleteN8nAgent(agentId: string): Promise<boolean> {
    const existing = this.assistantsMap.get(agentId);
    if (!existing || existing.type !== 'webhook' || existing.userId != null) {
      return false;
    }

    return this.deleteAssistant(agentId);
  }

  // Knowledge item methods
  async getKnowledgeItems(userId: string): Promise<KnowledgeItem[]> {
    return Array.from(this.knowledgeItems.values())
      .filter(item => item.userId === userId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getKnowledgeItem(id: string): Promise<KnowledgeItem | undefined> {
    return this.knowledgeItems.get(id);
  }

  async createKnowledgeItem(insertItem: InsertKnowledgeItem): Promise<KnowledgeItem> {
    const id = randomUUID();
    const now = new Date();
    const item: KnowledgeItem = {
      ...insertItem,
      id,
      sourceUrl: insertItem.sourceUrl || null,
      fileName: insertItem.fileName || null,
      fileType: insertItem.fileType || null,
      fileSize: insertItem.fileSize || null,
      metadata: insertItem.metadata || null,
      createdAt: now,
      updatedAt: now
    };
    this.knowledgeItems.set(id, item);
    return item;
  }

  async deleteKnowledgeItem(id: string): Promise<boolean> {
    return this.knowledgeItems.delete(id);
  }

  // Project methods
  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async getProjectByShareToken(shareToken: string): Promise<Project | undefined> {
    return Array.from(this.projects.values()).find(
      project => project.shareToken === shareToken
    );
  }

  async getUserProjects(userId: string): Promise<Project[]> {
    return Array.from(this.projects.values())
      .filter(project => project.userId === userId)
      .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime());
  }

  async createProject(userId: string, insertProject: InsertProject): Promise<Project> {
    const id = randomUUID();
    const now = new Date();
    const project: Project = {
      ...insertProject,
      id,
      userId,
      description: insertProject.description || null,
      customInstructions: insertProject.customInstructions || null,
      includeGlobalKnowledge: insertProject.includeGlobalKnowledge || "false",
      includeUserMemories: insertProject.includeUserMemories || "false",
      shareToken: null,
      isPublic: insertProject.isPublic || "false",
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(id, project);
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const existingProject = this.projects.get(id);
    if (!existingProject) return undefined;
    
    const updatedProject: Project = {
      ...existingProject,
      ...updates,
      updatedAt: new Date()
    };
    this.projects.set(id, updatedProject);
    return updatedProject;
  }

  async deleteProject(id: string): Promise<boolean> {
    const project = this.projects.get(id);
    if (!project) return false;
    
    Array.from(this.projectKnowledgeMap.values())
      .filter(item => item.projectId === id)
      .forEach(item => this.projectKnowledgeMap.delete(item.id));
    
    Array.from(this.projectFilesMap.values())
      .filter(file => file.projectId === id)
      .forEach(file => this.projectFilesMap.delete(file.id));
    
    return this.projects.delete(id);
  }

  async generateShareToken(projectId: string): Promise<string | undefined> {
    const project = this.projects.get(projectId);
    if (!project) return undefined;
    
    const shareToken = nanoid(16);
    const updatedProject: Project = {
      ...project,
      shareToken,
      isPublic: "true",
      updatedAt: new Date()
    };
    this.projects.set(projectId, updatedProject);
    return shareToken;
  }

  // Project knowledge methods
  async getProjectKnowledge(projectId: string): Promise<ProjectKnowledge[]> {
    return Array.from(this.projectKnowledgeMap.values())
      .filter(item => item.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async createProjectKnowledge(insertItem: InsertProjectKnowledge): Promise<ProjectKnowledge> {
    const id = randomUUID();
    const now = new Date();
    const item: ProjectKnowledge = {
      ...insertItem,
      id,
      sourceUrl: insertItem.sourceUrl || null,
      fileName: insertItem.fileName || null,
      fileType: insertItem.fileType || null,
      fileSize: insertItem.fileSize || null,
      metadata: insertItem.metadata || null,
      createdAt: now,
      updatedAt: now
    };
    this.projectKnowledgeMap.set(id, item);
    return item;
  }

  async deleteProjectKnowledge(id: string): Promise<boolean> {
    return this.projectKnowledgeMap.delete(id);
  }

  // Project file methods
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return Array.from(this.projectFilesMap.values())
      .filter(file => file.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async createProjectFile(insertFile: InsertProjectFile): Promise<ProjectFile> {
    const id = randomUUID();
    const file: ProjectFile = {
      ...insertFile,
      id,
      createdAt: new Date()
    };
    this.projectFilesMap.set(id, file);
    return file;
  }

  async deleteProjectFile(id: string): Promise<boolean> {
    return this.projectFilesMap.delete(id);
  }

  // Chat migration methods
  async moveChatToProject(chatId: string, projectId: string | null): Promise<Chat | undefined> {
    const chat = this.chats.get(chatId);
    if (!chat) return undefined;

    const updatedChat: Chat = {
      ...chat,
      projectId,
      updatedAt: new Date()
    };
    this.chats.set(chatId, updatedChat);
    return updatedChat;
  }

  async getPlatformSettings(): Promise<PlatformSettings> {
    const parsed = parsePlatformSettingsData(this.platformSettings.data);
    return {
      ...this.platformSettings,
      data: parsed,
    };
  }

  private settingsHistory: PlatformSettingsHistoryEntry[] = [];
  private settingsVersion = 1;

  async upsertPlatformSettings(data: PlatformSettingsData, changedBy?: string): Promise<PlatformSettings> {
    const now = new Date();
    // Save current state to history before overwriting
    this.settingsHistory.push({
      id: randomUUID(),
      version: this.settingsVersion,
      data: this.platformSettings.data as any,
      changedBy: changedBy ?? null,
      changedAt: now,
    });
    this.settingsVersion += 1;

    const payload = preparePlatformSettingsPayload(data);
    this.platformSettings = {
      ...this.platformSettings,
      data: payload,
      version: this.settingsVersion,
      updatedAt: now,
    };

    return this.getPlatformSettings();
  }

  async getSettingsHistory(limit: number = 20): Promise<PlatformSettingsHistoryEntry[]> {
    return this.settingsHistory
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
      .slice(0, limit);
  }

  async restoreSettingsVersion(version: number, restoredBy?: string): Promise<PlatformSettings | undefined> {
    const entry = this.settingsHistory.find(h => h.version === version);
    if (!entry) return undefined;
    return this.upsertPlatformSettings(entry.data as PlatformSettingsData, restoredBy);
  }

  async listTemplates(): Promise<Template[]> {
    return Array.from(this.templatesMap.values()).sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    return this.templatesMap.get(id);
  }

  async createTemplate(insertTemplate: InsertTemplate): Promise<Template> {
    const id = randomUUID();
    const now = new Date();
    const template: Template = {
      ...insertTemplate,
      id,
      description: insertTemplate.description ?? null,
      availableForFree: insertTemplate.availableForFree ?? false,
      availableForPro: insertTemplate.availableForPro ?? true,
      isActive: insertTemplate.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.templatesMap.set(id, template);
    return template;
  }

  async updateTemplate(id: string, updates: Partial<InsertTemplate>): Promise<Template | undefined> {
    const existing = this.templatesMap.get(id);
    if (!existing) {
      return undefined;
    }

    const next: Template = {
      ...existing,
      ...updates,
      description: updates.description ?? existing.description,
      availableForFree: updates.availableForFree ?? existing.availableForFree,
      availableForPro: updates.availableForPro ?? existing.availableForPro,
      isActive: updates.isActive ?? existing.isActive,
      updatedAt: new Date(),
    };
    this.templatesMap.set(id, next);
    return next;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templatesMap.delete(id);
  }

  async listOutputTemplates(): Promise<OutputTemplate[]> {
    return Array.from(this.outputTemplatesMap.values()).sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  async getOutputTemplate(id: string): Promise<OutputTemplate | undefined> {
    return this.outputTemplatesMap.get(id);
  }

  async createOutputTemplate(insertTemplate: InsertOutputTemplate): Promise<OutputTemplate> {
    const now = new Date();
    const record: OutputTemplate = {
      ...insertTemplate,
      id: randomUUID(),
      description: insertTemplate.description ?? null,
      instructions: insertTemplate.instructions ?? null,
      requiredSections: Array.isArray(insertTemplate.requiredSections) ? insertTemplate.requiredSections : [],
      isActive: insertTemplate.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.outputTemplatesMap.set(record.id, record);
    return record;
  }

  async updateOutputTemplate(id: string, updates: Partial<InsertOutputTemplate>): Promise<OutputTemplate | undefined> {
    const existing = this.outputTemplatesMap.get(id);
    if (!existing) {
      return undefined;
    }

    const next: OutputTemplate = {
      ...existing,
      ...updates,
      description: updates.description !== undefined ? updates.description ?? null : existing.description,
      instructions: updates.instructions !== undefined ? updates.instructions ?? null : existing.instructions,
      requiredSections: updates.requiredSections
        ? Array.isArray(updates.requiredSections)
          ? updates.requiredSections
          : existing.requiredSections
        : existing.requiredSections,
      isActive: updates.isActive !== undefined ? Boolean(updates.isActive) : existing.isActive,
      updatedAt: new Date(),
    };

    this.outputTemplatesMap.set(id, next);
    return next;
  }

  async deleteOutputTemplate(id: string): Promise<boolean> {
    return this.outputTemplatesMap.delete(id);
  }

  async listToolPolicies(): Promise<ToolPolicy[]> {
    const policies = Array.from(this.toolPoliciesMap.values()).map(policy => this.cloneToolPolicy(policy));
    return policies.sort((a, b) => {
      const providerCompare = a.provider.localeCompare(b.provider);
      if (providerCompare !== 0) {
        return providerCompare;
      }
      return a.toolName.localeCompare(b.toolName);
    });
  }

  async listToolPoliciesByProvider(provider: ToolPolicyProvider): Promise<ToolPolicy[]> {
    const normalizedProvider = provider.trim().toLowerCase();
    const policies = Array.from(this.toolPoliciesMap.values())
      .filter(policy => policy.provider.trim().toLowerCase() === normalizedProvider)
      .map(policy => this.cloneToolPolicy(policy));
    return policies.sort((a, b) => a.toolName.localeCompare(b.toolName));
  }

  async getToolPolicy(id: string): Promise<ToolPolicy | undefined> {
    const policy = this.toolPoliciesMap.get(id);
    return policy ? this.cloneToolPolicy(policy) : undefined;
  }

  async createToolPolicy(policy: InsertToolPolicy): Promise<ToolPolicy> {
    const now = new Date();
    const provider = policy.provider.trim();
    const toolName = policy.toolName.trim();
    const key = this.getToolPolicyKey(provider, toolName);

    if (this.toolPolicyKeyIndex.has(key)) {
      throw new Error('TOOL_POLICY_CONFLICT');
    }

    const record: ToolPolicy = {
      id: randomUUID(),
      provider,
      toolName,
      isEnabled: policy.isEnabled ?? true,
      safetyNote: policy.safetyNote?.trim() ? policy.safetyNote.trim() : null,
      createdAt: now,
      updatedAt: now,
    };

    this.toolPoliciesMap.set(record.id, record);
    this.toolPolicyKeyIndex.set(key, record.id);

    return this.cloneToolPolicy(record);
  }

  async updateToolPolicy(id: string, updates: UpdateToolPolicy): Promise<ToolPolicy | undefined> {
    const existing = this.toolPoliciesMap.get(id);
    if (!existing) {
      return undefined;
    }

    const provider = (updates.provider ?? existing.provider).trim();
    const toolName = (updates.toolName ?? existing.toolName).trim();
    const key = this.getToolPolicyKey(provider, toolName);
    const currentKey = this.getToolPolicyKey(existing.provider, existing.toolName);

    if (key !== currentKey && this.toolPolicyKeyIndex.has(key)) {
      throw new Error('TOOL_POLICY_CONFLICT');
    }

    const updated: ToolPolicy = {
      ...existing,
      provider,
      toolName,
      isEnabled: typeof updates.isEnabled === 'boolean' ? updates.isEnabled : existing.isEnabled,
      safetyNote: typeof updates.safetyNote === 'string'
        ? (updates.safetyNote.trim() ? updates.safetyNote.trim() : null)
        : updates.safetyNote === null
          ? null
          : existing.safetyNote,
      updatedAt: new Date(),
    };

    this.toolPoliciesMap.set(id, updated);
    if (key !== currentKey) {
      this.toolPolicyKeyIndex.delete(currentKey);
      this.toolPolicyKeyIndex.set(key, id);
    }

    return this.cloneToolPolicy(updated);
  }

  async deleteToolPolicy(id: string): Promise<boolean> {
    const existing = this.toolPoliciesMap.get(id);
    if (!existing) {
      return false;
    }
    const key = this.getToolPolicyKey(existing.provider, existing.toolName);
    this.toolPoliciesMap.delete(id);
    this.toolPolicyKeyIndex.delete(key);
    return true;
  }

  // Agent memory stubs — MemStorage is in-memory only; data is not persisted across restarts.
  // If these are called in production it means the DB connection failed — log a warning.
  async listAgentMemories(): Promise<AgentMemory[]> { return []; }
  async searchAgentMemories(): Promise<AgentMemory[]> { return []; }
  async createAgentMemory(memory: InsertAgentMemory): Promise<AgentMemory> {
    console.warn('[MemStorage] createAgentMemory called — running without DB, memory will not persist');
    return { id: randomUUID(), ...memory, relevanceScore: memory.relevanceScore ?? 50, source: memory.source ?? null, createdAt: new Date(), updatedAt: new Date() } as AgentMemory;
  }
  async updateAgentMemory(): Promise<AgentMemory | undefined> { return undefined; }
  async deleteAgentMemory(): Promise<boolean> { return false; }

  // Agent task stubs
  async listAgentTasks(): Promise<AgentTask[]> { return []; }
  async getAgentTask(): Promise<AgentTask | undefined> { return undefined; }
  async createAgentTask(task: InsertAgentTask): Promise<AgentTask> {
    console.warn('[MemStorage] createAgentTask called — running without DB, task will not persist');
    return { id: randomUUID(), ...task, status: 'pending', progress: 0, error: null, output: null, startedAt: null, completedAt: null, createdAt: new Date() } as AgentTask;
  }
  async updateAgentTask(): Promise<AgentTask | undefined> { return undefined; }

  // Cron job stubs
  async listCronJobs(): Promise<CronJob[]> { return []; }
  async getCronJob(): Promise<CronJob | undefined> { return undefined; }
  async createCronJob(job: InsertCronJob): Promise<CronJob> {
    console.warn('[MemStorage] createCronJob called — running without DB, job will not persist');
    return { id: randomUUID(), ...job, lastRunAt: null, createdAt: new Date(), updatedAt: new Date() } as CronJob;
  }
  async updateCronJob(): Promise<CronJob | undefined> { return undefined; }
  async deleteCronJob(): Promise<boolean> { return false; }
  async getEnabledCronJobs(): Promise<CronJob[]> { return []; }
  async logToolError(data: InsertToolErrorLog): Promise<ToolErrorLog> {
    return { id: randomUUID(), ...data, args: data.args ?? null, conversationId: data.conversationId ?? null, createdAt: new Date() } as ToolErrorLog;
  }
  async listToolErrors(): Promise<ToolErrorLog[]> { return []; }
  async clearToolErrors(): Promise<void> {}
}

export class DatabaseStorage implements IStorage {
  // Platform settings TTL cache — avoids repeated DB hits within the same request cycle
  private _settingsCache: { value: PlatformSettings; expiresAt: number } | null = null;
  private static SETTINGS_TTL_MS = 5000; // 5 seconds

  private invalidateSettingsCache(): void {
    this._settingsCache = null;
  }

  private mapAssistantRowToN8nAgent(row: Assistant): N8nAgent {
    return {
      ...row,
      type: 'webhook',
      status: row.isActive ? 'active' : 'inactive',
    };
  }

  private readonly fileStorage: FileStorageAdapter;

  constructor(fileStorage: FileStorageAdapter = createFileStorage()) {
    this.fileStorage = fileStorage;
  }

  private normalizeOutputTemplate(row: OutputTemplate): OutputTemplate {
    const sections = Array.isArray(row.requiredSections) ? row.requiredSections : [];
    return {
      ...row,
      description: row.description ?? null,
      instructions: row.instructions ?? null,
      requiredSections: sections,
    };
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async listUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async hasAdminUser(): Promise<boolean> {
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(users)
      .where(inArray(users.role, ['admin', 'super_admin']))
      .limit(1);

    const count = row?.count ?? 0;
    return Number(count) > 0;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users)
      .values({
        ...insertUser,
        plan: parseUserPlanOrDefault(insertUser.plan),
        role: insertUser.role ?? 'user',
        status: insertUser.status ?? 'active',
      })
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const safeUpdates: Partial<User> = { ...updates };

    if (hasOwn(updates, 'plan')) {
      const parsedPlan = parseUserPlanIfProvided((updates as { plan?: unknown }).plan);
      if (parsedPlan === undefined) {
        delete (safeUpdates as Record<string, unknown>).plan;
      } else {
        safeUpdates.plan = parsedPlan;
      }
    }

    const [user] = await db.update(users)
      .set({
        ...safeUpdates,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateUserStatus(id: string, status: UserStatus): Promise<User | undefined> {
    return this.updateUser(id, { status });
  }
  
  async upsertUser(userData: UpsertUser): Promise<User> {
    const insertValues = {
      ...userData,
      plan: parseUserPlanOrDefault(userData.plan),
      role: userData.role ?? 'user',
      status: userData.status ?? 'active',
    } satisfies UpsertUser;

    const updateValues: Partial<UpsertUser> = {
      ...userData,
      role: userData.role ?? 'user',
      status: userData.status ?? 'active',
      updatedAt: new Date(),
    };

    if (hasOwn(userData, 'plan')) {
      const parsedPlan = parseUserPlanIfProvided((userData as { plan?: unknown }).plan);
      if (parsedPlan === undefined) {
        delete (updateValues as Record<string, unknown>).plan;
      } else {
        updateValues.plan = parsedPlan;
      }
    } else {
      delete (updateValues as Record<string, unknown>).plan;
    }

    const [user] = await db
      .insert(users)
      .values(insertValues)
      .onConflictDoUpdate({
        target: users.id,
        set: updateValues,
      })
      .returning();
    return user;
  }

  // Chat methods
  async getChat(id: string): Promise<Chat | undefined> {
    const [chat] = await db.select().from(chats).where(eq(chats.id, id));
    return chat || undefined;
  }

  async getUserChats(userId: string, includeArchived = false, projectId?: string | null): Promise<Chat[]> {
    const conditions = [eq(chats.userId, userId)];
    
    // Add status filter
    if (includeArchived) {
      conditions.push(ne(chats.status, 'deleted'));
    } else {
      conditions.push(eq(chats.status, 'active'));
    }
    
    // Add projectId filter
    // If projectId is undefined, don't filter by project (return all)
    // If projectId is null, return only global chats (chat.projectId IS NULL)
    // If projectId is a string, return only chats for that specific project
    if (projectId !== undefined) {
      if (projectId === null) {
        conditions.push(sql`${chats.projectId} IS NULL`);
      } else {
        conditions.push(eq(chats.projectId, projectId));
      }
    }
    
    return await db.select().from(chats)
      .where(and(...conditions))
      .orderBy(desc(chats.updatedAt));
  }

  async getArchivedChats(userId: string): Promise<Chat[]> {
    return await db.select().from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.status, 'archived')))
      .orderBy(desc(chats.updatedAt));
  }

  async createChat(insertChat: InsertChat & { userId: string }): Promise<Chat> {
    const [chat] = await db.insert(chats).values({
      ...insertChat,
      userId: insertChat.userId,
      projectId: insertChat.projectId || null,
      status: 'active'
    }).returning();
    return chat;
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    const [chat] = await db.update(chats)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chats.id, id))
      .returning();
    return chat || undefined;
  }

  async archiveChat(id: string): Promise<boolean> {
    const result = await db.update(chats)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(chats.id, id));
    return (result.rowCount || 0) > 0;
  }

  async deleteChat(id: string): Promise<boolean> {
    const result = await db.update(chats)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(chats.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Message methods
  async getMessage(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message || undefined;
  }

  async getChatMessages(chatId: string): Promise<Message[]> {
    return await db.select().from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.createdAt);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }
  
  async getMessagesSince(userId: string, since: Date): Promise<Message[]> {
    // Get all messages from user's chats since the given date
    const userChats = await this.getUserChats(userId, true);
    const chatIds = userChats.map(chat => chat.id);
    
    if (chatIds.length === 0) return [];
    
    return await db.select().from(messages)
      .where(and(
        inArray(messages.chatId, chatIds),
        gte(messages.createdAt, since),
        eq(messages.role, 'user')
      ))
      .orderBy(messages.createdAt);
  }

  // Reaction methods
  async getMessageReactions(messageId: string): Promise<Reaction[]> {
    return await db.select().from(reactions).where(eq(reactions.messageId, messageId));
  }

  async getUserReaction(messageId: string, userId: string): Promise<Reaction | undefined> {
    const [reaction] = await db.select().from(reactions)
      .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, userId)));
    return reaction || undefined;
  }

  async createReaction(insertReaction: InsertReaction): Promise<Reaction> {
    const [reaction] = await db.insert(reactions).values(insertReaction).returning();
    return reaction;
  }

  async updateReaction(id: string, type: 'thumbs_up' | 'thumbs_down'): Promise<Reaction | undefined> {
    const [reaction] = await db.update(reactions)
      .set({ type })
      .where(eq(reactions.id, id))
      .returning();
    return reaction || undefined;
  }

  async deleteReaction(id: string): Promise<boolean> {
    const result = await db.delete(reactions).where(eq(reactions.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Usage tracking methods
  async createUsageMetric(insertMetric: InsertUsageMetric): Promise<UsageMetric> {
    const [metric] = await db.insert(usageMetrics).values(insertMetric).returning();
    return metric;
  }

  async getUserUsageMetrics(userId: string, dateFrom?: Date, dateTo?: Date): Promise<UsageMetric[]> {
    const whereConditions = [eq(usageMetrics.userId, userId)];
    
    if (dateFrom) {
      whereConditions.push(gte(usageMetrics.createdAt, dateFrom));
    }
    if (dateTo) {
      whereConditions.push(lte(usageMetrics.createdAt, dateTo));
    }
    
    return await db.select().from(usageMetrics)
      .where(and(...whereConditions))
      .orderBy(desc(usageMetrics.createdAt));
  }

  async getChatUsageMetrics(chatId: string): Promise<UsageMetric[]> {
    return await db.select().from(usageMetrics)
      .where(eq(usageMetrics.chatId, chatId))
      .orderBy(desc(usageMetrics.createdAt));
  }

  async saveUsageSummarySnapshot(snapshot: InsertUsageSummarySnapshot): Promise<UsageSummarySnapshot> {
    const payload: typeof usageSummarySnapshots.$inferInsert = {
      ...snapshot,
      rangeStart: new Date(snapshot.rangeStart),
      rangeEnd: new Date(snapshot.rangeEnd),
      totals: structuredClone(snapshot.totals),
      modelBreakdown: structuredClone(snapshot.modelBreakdown ?? []),
      generatedAt: snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(),
    };

    const [record] = await db
      .insert(usageSummarySnapshots)
      .values(payload)
      .onConflictDoUpdate({
        target: [usageSummarySnapshots.userId, usageSummarySnapshots.rangeStart, usageSummarySnapshots.rangeEnd],
        set: {
          totals: payload.totals,
          modelBreakdown: payload.modelBreakdown,
          generatedAt: payload.generatedAt,
        },
      })
      .returning();

    return record;
  }

  async getLatestUsageSummarySnapshot(userId: string): Promise<UsageSummarySnapshot | undefined> {
    const [snapshot] = await db
      .select()
      .from(usageSummarySnapshots)
      .where(eq(usageSummarySnapshots.userId, userId))
      .orderBy(desc(usageSummarySnapshots.generatedAt))
      .limit(1);

    return snapshot || undefined;
  }

  // OAuth token methods
  async getOAuthToken(userId: string, provider: string, accountLabel = 'default'): Promise<OAuthToken | undefined> {
    const [byLabel] = await db.select().from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider), eq(oauthTokens.accountLabel, accountLabel)));
    if (byLabel) return byLabel;
    // Fallback: return any token for this provider (backwards compat)
    const [any] = await db.select().from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)));
    return any || undefined;
  }

  async getOAuthTokens(userId: string, provider: string): Promise<OAuthToken[]> {
    return db.select().from(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
      .orderBy(oauthTokens.createdAt);
  }

  async saveOAuthToken(insertToken: InsertOAuthToken): Promise<OAuthToken> {
    const label = (insertToken as any).accountLabel ?? 'default';
    const [token] = await db.insert(oauthTokens)
      .values({ ...insertToken, accountLabel: label })
      .onConflictDoUpdate({
        target: [oauthTokens.userId, oauthTokens.provider, oauthTokens.accountLabel],
        set: {
          accessToken: insertToken.accessToken,
          refreshToken: insertToken.refreshToken ?? null,
          tokenExpiry: insertToken.tokenExpiry ?? null,
          scopes: insertToken.scopes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return token;
  }

  async updateOAuthToken(userId: string, provider: string, updates: Partial<InsertOAuthToken>, accountLabel = 'default'): Promise<OAuthToken | undefined> {
    const [token] = await db.update(oauthTokens)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider), eq(oauthTokens.accountLabel, accountLabel)))
      .returning();
    return token || undefined;
  }

  async listAllOAuthConnections(): Promise<{ userId: string; provider: string; accountLabel: string; createdAt: Date | null }[]> {
    const rows = await db.select({
      userId: oauthTokens.userId,
      provider: oauthTokens.provider,
      accountLabel: oauthTokens.accountLabel,
      createdAt: oauthTokens.createdAt,
    }).from(oauthTokens).orderBy(oauthTokens.createdAt);
    return rows;
  }

  async deleteOAuthToken(userId: string, provider: string, accountLabel = 'default'): Promise<boolean> {
    const result = await db.delete(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider), eq(oauthTokens.accountLabel, accountLabel)));
    return (result.rowCount || 0) > 0;
  }
  
  // User preferences methods
  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return prefs || undefined;
  }
  
  async saveUserPreferences(userId: string, preferences: InsertUserPreferences): Promise<UserPreferences> {
    const existing = await this.getUserPreferences(userId);

    if (existing) {
      // Update existing preferences
      const lastArea =
        (typeof preferences.lastArea === 'string' && preferences.lastArea.trim().length > 0
          ? preferences.lastArea
          : existing.lastArea) ?? 'user';
      const [updated] = await db.update(userPreferences)
        .set({
          ...preferences,
          memories: preferences.memories as string[] || existing.memories,
          lastArea,
          updatedAt: new Date()
        })
        .where(eq(userPreferences.userId, userId))
        .returning();
      return updated;
    } else {
      // Create new preferences
      const lastArea =
        typeof preferences.lastArea === 'string' && preferences.lastArea.trim().length > 0
          ? preferences.lastArea
          : 'user';
      const [created] = await db.insert(userPreferences)
        .values({
          userId,
          personalizationEnabled: preferences.personalizationEnabled || "false",
          customInstructions: preferences.customInstructions,
          name: preferences.name,
          occupation: preferences.occupation,
          bio: preferences.bio,
          profileImageUrl: preferences.profileImageUrl,
          memories: preferences.memories as string[] || [],
          chatHistoryEnabled: preferences.chatHistoryEnabled || "true",
          autonomousCodeExecution: preferences.autonomousCodeExecution || "true",
          lastArea
        })
        .returning();
      return created;
    }
  }

  async getN8nAgents(): Promise<N8nAgent[]> {
    const rows = await db
      .select()
      .from(assistants)
      .where(and(eq(assistants.type, 'webhook'), isNull(assistants.userId)))
      .orderBy(desc(assistants.updatedAt));

    return rows.map((row) => this.mapAssistantRowToN8nAgent(row));
  }

  async createN8nAgent(agent: InsertN8nAgent): Promise<N8nAgent> {
    const isActive = (agent.status ?? 'inactive') === 'active';

    const [existing] = await db
      .select()
      .from(assistants)
      .where(and(eq(assistants.type, 'webhook'), isNull(assistants.userId), eq(assistants.workflowId, agent.workflowId)))
      .limit(1);

    if (existing) {
      const updateSet: Record<string, unknown> = {
        name: agent.name,
        workflowId: agent.workflowId,
        isActive,
        updatedAt: new Date(),
      };

      if (typeof agent.description !== 'undefined') {
        updateSet.description = agent.description ?? null;
      }

      if (typeof agent.webhookUrl !== 'undefined') {
        updateSet.webhookUrl = agent.webhookUrl ?? null;
      }

      if (typeof agent.metadata !== 'undefined') {
        updateSet.metadata = agent.metadata ?? null;
      }

      const [updated] = await db
        .update(assistants)
        .set(updateSet)
        .where(eq(assistants.id, existing.id))
        .returning();

      return this.mapAssistantRowToN8nAgent(updated);
    }

    const [record] = await db
      .insert(assistants)
      .values({
        type: 'webhook',
        userId: null,
        workflowId: agent.workflowId,
        name: agent.name,
        description: agent.description ?? null,
        promptContent: null,
        isActive,
        webhookUrl: agent.webhookUrl ?? null,
        metadata: agent.metadata ?? null,
      })
      .returning();

    return this.mapAssistantRowToN8nAgent(record);
  }

  async deleteN8nAgent(agentId: string): Promise<boolean> {
    const result = await db
      .delete(assistants)
      .where(and(eq(assistants.id, agentId), eq(assistants.type, 'webhook'), isNull(assistants.userId)));
    return (result.rowCount || 0) > 0;
  }

  // File methods
  async saveFile(
    ownerId: string,
    buffer: Buffer,
    name: string,
    mimeType: string,
    analyzedContent?: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<Attachment> {
    const record = await this.fileStorage.put({
      ownerId,
      buffer,
      name,
      mimeType,
      analyzedContent,
      metadata,
    });

    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      url: await this.fileStorage.getSignedUrl(record.id),
    };
  }

  async getFileForUser(id: string, ownerId: string): Promise<StoredFile | undefined> {
    const record = await this.fileStorage.get(id);
    if (!record || record.ownerId !== ownerId) {
      return undefined;
    }
    return record;
  }

  async deleteFile(id: string, ownerId: string): Promise<boolean> {
    const record = await this.fileStorage.get(id);
    if (!record || record.ownerId !== ownerId) {
      return false;
    }
    await this.fileStorage.delete(id);
    return true;
  }

  // Knowledge item methods
  async getKnowledgeItems(userId: string): Promise<KnowledgeItem[]> {
    return await db.select().from(knowledgeItems)
      .where(eq(knowledgeItems.userId, userId))
      .orderBy(desc(knowledgeItems.createdAt));
  }

  async getKnowledgeItem(id: string): Promise<KnowledgeItem | undefined> {
    const [item] = await db.select().from(knowledgeItems)
      .where(eq(knowledgeItems.id, id));
    return item || undefined;
  }

  async createKnowledgeItem(insertItem: InsertKnowledgeItem): Promise<KnowledgeItem> {
    const [item] = await db.insert(knowledgeItems).values(insertItem).returning();
    return item;
  }

  async deleteKnowledgeItem(id: string): Promise<boolean> {
    const result = await db.delete(knowledgeItems)
      .where(eq(knowledgeItems.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Project methods
  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects)
      .where(eq(projects.id, id));
    return project || undefined;
  }

  async getProjectByShareToken(shareToken: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects)
      .where(eq(projects.shareToken, shareToken));
    return project || undefined;
  }

  async getUserProjects(userId: string): Promise<Project[]> {
    return await db.select().from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));
  }

  async createProject(userId: string, insertProject: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values({
      ...insertProject,
      userId
    }).returning();
    return project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined> {
    const [project] = await db.update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return project || undefined;
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await db.delete(projects)
      .where(eq(projects.id, id));
    return (result.rowCount || 0) > 0;
  }

  async generateShareToken(projectId: string): Promise<string | undefined> {
    const shareToken = nanoid(16);
    const [project] = await db.update(projects)
      .set({ shareToken, isPublic: "true", updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    return project?.shareToken || undefined;
  }

  // Project knowledge methods
  async getProjectKnowledge(projectId: string): Promise<ProjectKnowledge[]> {
    return await db.select().from(projectKnowledge)
      .where(eq(projectKnowledge.projectId, projectId))
      .orderBy(desc(projectKnowledge.createdAt));
  }

  async createProjectKnowledge(insertItem: InsertProjectKnowledge): Promise<ProjectKnowledge> {
    const [item] = await db.insert(projectKnowledge).values(insertItem).returning();
    return item;
  }

  async deleteProjectKnowledge(id: string): Promise<boolean> {
    const result = await db.delete(projectKnowledge)
      .where(eq(projectKnowledge.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Project file methods
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return await db.select().from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(desc(projectFiles.createdAt));
  }

  async createProjectFile(insertFile: InsertProjectFile): Promise<ProjectFile> {
    const [file] = await db.insert(projectFiles).values(insertFile).returning();
    return file;
  }

  async deleteProjectFile(id: string): Promise<boolean> {
    const result = await db.delete(projectFiles)
      .where(eq(projectFiles.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Chat migration methods
  async moveChatToProject(chatId: string, projectId: string | null): Promise<Chat | undefined> {
    const [chat] = await db.update(chats)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning();
    return chat || undefined;
  }
  
  async getPlatformSettings(): Promise<PlatformSettings> {
    // Return cached value if still fresh
    if (this._settingsCache && Date.now() < this._settingsCache.expiresAt) {
      return this._settingsCache.value;
    }

    const [settings] = await db.select().from(platformSettings).limit(1);

    if (settings) {
      const result = {
        ...settings,
        data: parsePlatformSettingsData(settings.data),
      };
      this._settingsCache = { value: result, expiresAt: Date.now() + DatabaseStorage.SETTINGS_TTL_MS };
      return result;
    }

    const [created] = await db
      .insert(platformSettings)
      .values({
        id: 'global',
        data: preparePlatformSettingsPayload(defaultPlatformSettings),
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      const result = {
        ...created,
        data: parsePlatformSettingsData(created.data),
      };
      this._settingsCache = { value: result, expiresAt: Date.now() + DatabaseStorage.SETTINGS_TTL_MS };
      return result;
    }

    const [existing] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, 'global'))
      .limit(1);

    if (!existing) {
      throw new Error('Failed to initialize platform settings');
    }

    const result = {
      ...existing,
      data: parsePlatformSettingsData(existing.data),
    };
    this._settingsCache = { value: result, expiresAt: Date.now() + DatabaseStorage.SETTINGS_TTL_MS };
    return result;
  }

  async upsertPlatformSettings(data: PlatformSettingsData, changedBy?: string): Promise<PlatformSettings> {
    this.invalidateSettingsCache();
    const now = new Date();
    const payload = preparePlatformSettingsPayload(data);

    // Save current settings to history before overwriting
    try {
      const [current] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'global')).limit(1);
      if (current) {
        await db.insert(platformSettingsHistory).values({
          version: current.version ?? 1,
          data: current.data,
          changedBy: changedBy ?? null,
          changedAt: now,
        });
      }
    } catch (histErr) {
      console.error('[settings] Failed to save settings history:', histErr);
    }

    const [settings] = await db
      .insert(platformSettings)
      .values({
        id: 'global',
        data: payload,
        version: sql`COALESCE((SELECT version FROM platform_settings WHERE id = 'global'), 0) + 1`,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: {
          data: payload,
          version: sql`COALESCE(platform_settings.version, 0) + 1`,
          updatedAt: now,
        },
      })
      .returning();

    return {
      ...settings,
      data: parsePlatformSettingsData(settings.data),
    };
  }

  async getSettingsHistory(limit: number = 20): Promise<PlatformSettingsHistoryEntry[]> {
    return db
      .select()
      .from(platformSettingsHistory)
      .orderBy(desc(platformSettingsHistory.version))
      .limit(limit);
  }

  async restoreSettingsVersion(version: number, restoredBy?: string): Promise<PlatformSettings | undefined> {
    const [entry] = await db
      .select()
      .from(platformSettingsHistory)
      .where(eq(platformSettingsHistory.version, version))
      .limit(1);

    if (!entry) return undefined;
    return this.upsertPlatformSettings(entry.data as PlatformSettingsData, restoredBy);
  }

  async listSystemPrompts(): Promise<SystemPrompt[]> {
    return await db.select().from(systemPrompts).orderBy(desc(systemPrompts.version));
  }

  async getSystemPrompt(id: string): Promise<SystemPrompt | undefined> {
    const [prompt] = await db.select().from(systemPrompts).where(eq(systemPrompts.id, id));
    return prompt || undefined;
  }

  async getActiveSystemPrompt(): Promise<SystemPrompt | undefined> {
    const release = await this.getActiveRelease();
    if (release?.systemPromptId) {
      const prompt = await this.getSystemPrompt(release.systemPromptId);
      if (prompt) {
        return prompt;
      }
    }

    const [prompt] = await db
      .select()
      .from(systemPrompts)
      .where(eq(systemPrompts.isActive, true))
      .limit(1);
    return prompt || undefined;
  }

  async createSystemPrompt(options: CreateSystemPromptOptions): Promise<SystemPrompt> {
    const now = new Date();
    return await db.transaction(async (tx) => {
      const [result] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${systemPrompts.version}), 0)` })
        .from(systemPrompts);
      const nextVersion = (result?.max ?? 0) + 1;

      if (options.activate) {
        await tx
          .update(systemPrompts)
          .set({
            isActive: false,
            activatedAt: null,
            activatedByUserId: null,
            updatedAt: now,
          });
      }

      const [created] = await tx
        .insert(systemPrompts)
        .values({
          version: nextVersion,
          label: options.label ?? null,
          content: options.content,
          notes: options.notes ?? null,
          createdByUserId: options.createdByUserId ?? null,
          activatedByUserId: options.activate
            ? options.activatedByUserId ?? options.createdByUserId ?? null
            : null,
          isActive: options.activate ?? false,
          createdAt: now,
          updatedAt: now,
          activatedAt: options.activate ? now : null,
        })
        .returning();

      return created;
    });
  }

  async updateSystemPrompt(id: string, updates: UpdateSystemPromptOptions): Promise<SystemPrompt | undefined> {
    const payload: Partial<typeof systemPrompts.$inferInsert> = { updatedAt: new Date() };
    if (updates.content !== undefined) {
      payload.content = updates.content;
    }
    if (updates.label !== undefined) {
      payload.label = updates.label ?? null;
    }
    if (updates.notes !== undefined) {
      payload.notes = updates.notes ?? null;
    }

    const [updated] = await db
      .update(systemPrompts)
      .set(payload)
      .where(eq(systemPrompts.id, id))
      .returning();

    return updated || undefined;
  }

  async activateSystemPrompt(id: string, activatedByUserId?: string | null): Promise<SystemPrompt | undefined> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(systemPrompts).where(eq(systemPrompts.id, id)).limit(1);
      if (!existing) {
        return undefined;
      }

      const now = new Date();

      await tx
        .update(systemPrompts)
        .set({
          isActive: false,
          activatedAt: null,
          activatedByUserId: null,
          updatedAt: now,
        })
        .where(ne(systemPrompts.id, id));

      const [activated] = await tx
        .update(systemPrompts)
        .set({
          isActive: true,
          activatedAt: now,
          activatedByUserId: activatedByUserId ?? null,
          updatedAt: now,
        })
        .where(eq(systemPrompts.id, id))
        .returning();

      return activated || undefined;
    });
  }

  async deleteSystemPrompt(id: string): Promise<boolean> {
    const [deleted] = await db
      .delete(systemPrompts)
      .where(and(eq(systemPrompts.id, id), eq(systemPrompts.isActive, false)))
      .returning();
    return !!deleted;
  }

  async listReleases(): Promise<Release[]> {
    return await db.select().from(releases).orderBy(desc(releases.version));
  }

  async getRelease(id: string): Promise<Release | undefined> {
    const [release] = await db.select().from(releases).where(eq(releases.id, id));
    return release || undefined;
  }

  async getActiveRelease(): Promise<Release | undefined> {
    const [release] = await db
      .select()
      .from(releases)
      .where(eq(releases.isActive, true))
      .limit(1);
    return release || undefined;
  }

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const now = new Date();
    const assistantIds = this.normalizeIdList(options.assistantIds);
    const templateIds = this.normalizeIdList(options.templateIds);
    const outputTemplateIds = this.normalizeIdList(options.outputTemplateIds);
    const toolPolicyIds = this.normalizeIdList(options.toolPolicyIds);

    return await db.transaction(async (tx) => {
      const [result] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${releases.version}), 0)` })
        .from(releases);
      const nextVersion = (result?.max ?? 0) + 1;

      const [created] = await tx
        .insert(releases)
        .values({
          version: nextVersion,
          label: options.label,
          status: 'draft',
          changeNotes: options.changeNotes ?? null,
          systemPromptId: options.systemPromptId ?? null,
          assistantIds,
          templateIds,
          outputTemplateIds,
          toolPolicyIds,
          isActive: false,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return created;
    });
  }

  async publishRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined> {
    const now = new Date();

    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(releases).where(eq(releases.id, id)).limit(1);
      if (!existing) {
        return undefined;
      }

      await tx
        .update(releases)
        .set({
          status: 'archived',
          isActive: false,
          updatedAt: now,
        })
        .where(eq(releases.isActive, true));

      const [updated] = await tx
        .update(releases)
        .set({
          status: 'active',
          isActive: true,
          changeNotes: options.changeNotes,
          publishedAt: now,
          publishedByUserId: options.actorUserId ?? null,
          updatedAt: now,
        })
        .where(eq(releases.id, id))
        .returning();

      if (!updated) {
        return undefined;
      }

      if (updated.systemPromptId) {
        await tx
          .update(systemPrompts)
          .set({
            isActive: false,
            activatedAt: null,
            activatedByUserId: null,
            updatedAt: now,
          });

        await tx
          .update(systemPrompts)
          .set({
            isActive: true,
            activatedAt: now,
            activatedByUserId: options.actorUserId ?? null,
            updatedAt: now,
          })
          .where(eq(systemPrompts.id, updated.systemPromptId));
      } else {
        await tx
          .update(systemPrompts)
          .set({
            isActive: false,
            activatedAt: null,
            activatedByUserId: null,
            updatedAt: now,
          });
      }

      return updated;
    });
  }

  async rollbackRelease(id: string, options: ReleaseTransitionOptions): Promise<Release | undefined> {
    return this.publishRelease(id, options);
  }

  async listAssistants(): Promise<Assistant[]> {
    return await db.select().from(assistants).orderBy(desc(assistants.createdAt));
  }

  async listActiveAssistants(): Promise<Assistant[]> {
    return await db
      .select()
      .from(assistants)
      .where(eq(assistants.isActive, true))
      .orderBy(desc(assistants.createdAt));
  }

  async getAssistant(id: string): Promise<Assistant | undefined> {
    const [assistant] = await db.select().from(assistants).where(eq(assistants.id, id));
    return assistant || undefined;
  }

  async createAssistant(insertAssistant: InsertAssistant): Promise<Assistant> {
    const [assistant] = await db
      .insert(assistants)
      .values({
        ...insertAssistant,
        metadata: insertAssistant.metadata ?? null,
        userId: insertAssistant.userId ?? null,
        promptContent: insertAssistant.promptContent ?? null,
        webhookUrl: insertAssistant.webhookUrl ?? null,
        workflowId: insertAssistant.workflowId ?? null,
      })
      .returning();
    return assistant;
  }

  async updateAssistant(id: string, updates: UpdateAssistant): Promise<Assistant | undefined> {
    const normalized: Record<string, unknown> = { ...updates, updatedAt: new Date() };

    if (updates.metadata !== undefined) {
      normalized.metadata = updates.metadata ?? null;
    }

    if (updates.userId !== undefined) {
      normalized.userId = updates.userId ?? null;
    }

    if (updates.promptContent !== undefined) {
      normalized.promptContent = updates.promptContent ?? null;
    }

    if (updates.webhookUrl !== undefined) {
      normalized.webhookUrl = updates.webhookUrl ?? null;
    }

    if (updates.workflowId !== undefined) {
      normalized.workflowId = updates.workflowId ?? null;
    }

    const [assistant] = await db
      .update(assistants)
      .set(normalized)
      .where(eq(assistants.id, id))
      .returning();
    return assistant || undefined;
  }

  async deleteAssistant(id: string): Promise<boolean> {
    const result = await db.delete(assistants).where(eq(assistants.id, id));
    return (result.rowCount || 0) > 0;
  }

  async listTemplates(): Promise<Template[]> {
    return await db.select().from(templates).orderBy(desc(templates.createdAt));
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(eq(templates.id, id));
    return template || undefined;
  }

  async createTemplate(insertTemplate: InsertTemplate): Promise<Template> {
    const [template] = await db.insert(templates).values(insertTemplate).returning();
    return template;
  }

  async updateTemplate(id: string, updates: Partial<InsertTemplate>): Promise<Template | undefined> {
    const [template] = await db
      .update(templates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    return template || undefined;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result = await db.delete(templates).where(eq(templates.id, id));
    return (result.rowCount || 0) > 0;
  }

  async listOutputTemplates(): Promise<OutputTemplate[]> {
    const rows = await db.select().from(outputTemplates).orderBy(desc(outputTemplates.createdAt));
    return rows.map(row => this.normalizeOutputTemplate(row));
  }

  async getOutputTemplate(id: string): Promise<OutputTemplate | undefined> {
    const [row] = await db.select().from(outputTemplates).where(eq(outputTemplates.id, id));
    return row ? this.normalizeOutputTemplate(row) : undefined;
  }

  async createOutputTemplate(insertTemplate: InsertOutputTemplate): Promise<OutputTemplate> {
    const [row] = await db.insert(outputTemplates).values(insertTemplate).returning();
    return this.normalizeOutputTemplate(row);
  }

  async updateOutputTemplate(id: string, updates: Partial<InsertOutputTemplate>): Promise<OutputTemplate | undefined> {
    const [row] = await db
      .update(outputTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(outputTemplates.id, id))
      .returning();

    return row ? this.normalizeOutputTemplate(row) : undefined;
  }

  async deleteOutputTemplate(id: string): Promise<boolean> {
    const result = await db.delete(outputTemplates).where(eq(outputTemplates.id, id));
    return (result.rowCount || 0) > 0;
  }

  async listToolPolicies(): Promise<ToolPolicy[]> {
    return await db
      .select()
      .from(toolPolicies)
      .orderBy(asc(toolPolicies.provider), asc(toolPolicies.toolName));
  }

  async listToolPoliciesByProvider(provider: ToolPolicyProvider): Promise<ToolPolicy[]> {
    return await db
      .select()
      .from(toolPolicies)
      .where(eq(toolPolicies.provider, provider))
      .orderBy(asc(toolPolicies.toolName));
  }

  async getToolPolicy(id: string): Promise<ToolPolicy | undefined> {
    const [policy] = await db.select().from(toolPolicies).where(eq(toolPolicies.id, id));
    return policy || undefined;
  }

  async createToolPolicy(policy: InsertToolPolicy): Promise<ToolPolicy> {
    const now = new Date();
    const [created] = await db
      .insert(toolPolicies)
      .values({
        provider: policy.provider.trim(),
        toolName: policy.toolName.trim(),
        isEnabled: policy.isEnabled ?? true,
        safetyNote: policy.safetyNote?.trim() ? policy.safetyNote.trim() : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }

  async updateToolPolicy(id: string, updates: UpdateToolPolicy): Promise<ToolPolicy | undefined> {
    const payload: Partial<typeof toolPolicies.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof updates.provider === 'string') {
      payload.provider = updates.provider.trim();
    }
    if (typeof updates.toolName === 'string') {
      payload.toolName = updates.toolName.trim();
    }
    if (typeof updates.isEnabled === 'boolean') {
      payload.isEnabled = updates.isEnabled;
    }
    if (updates.safetyNote === null) {
      payload.safetyNote = null;
    } else if (typeof updates.safetyNote === 'string') {
      payload.safetyNote = updates.safetyNote.trim() ? updates.safetyNote.trim() : null;
    }

    const [updated] = await db
      .update(toolPolicies)
      .set(payload)
      .where(eq(toolPolicies.id, id))
      .returning();

    return updated || undefined;
  }

  async deleteToolPolicy(id: string): Promise<boolean> {
    const result = await db.delete(toolPolicies).where(eq(toolPolicies.id, id));
    return (result.rowCount || 0) > 0;
  }

  // ── Agent Memory methods ─────────────────────────────────────────────────

  async listAgentMemories(category?: string, limit?: number): Promise<AgentMemory[]> {
    const q = db.select().from(agentMemories);
    if (category) {
      const rows = await q
        .where(eq(agentMemories.category, category))
        .orderBy(desc(agentMemories.relevanceScore), desc(agentMemories.updatedAt))
        .limit(limit ?? 200);
      return rows;
    }
    return q
      .orderBy(desc(agentMemories.relevanceScore), desc(agentMemories.updatedAt))
      .limit(limit ?? 200);
  }

  async searchAgentMemories(query: string, limit = 20): Promise<AgentMemory[]> {
    return db.select().from(agentMemories)
      .where(ilike(agentMemories.content, `%${query}%`))
      .orderBy(desc(agentMemories.relevanceScore))
      .limit(limit);
  }

  async createAgentMemory(memory: InsertAgentMemory): Promise<AgentMemory> {
    const [created] = await db.insert(agentMemories).values(memory).returning();
    return created;
  }

  async updateAgentMemory(id: string, updates: Partial<InsertAgentMemory>): Promise<AgentMemory | undefined> {
    const [updated] = await db.update(agentMemories)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(agentMemories.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAgentMemory(id: string): Promise<boolean> {
    const result = await db.delete(agentMemories).where(eq(agentMemories.id, id));
    return (result.rowCount || 0) > 0;
  }

  // ── Agent Task methods ───────────────────────────────────────────────────

  async listAgentTasks(status?: AgentTaskStatus): Promise<AgentTask[]> {
    if (status) {
      return db.select().from(agentTasks)
        .where(eq(agentTasks.status, status))
        .orderBy(desc(agentTasks.createdAt));
    }
    return db.select().from(agentTasks).orderBy(desc(agentTasks.createdAt));
  }

  async getAgentTask(id: string): Promise<AgentTask | undefined> {
    const [task] = await db.select().from(agentTasks).where(eq(agentTasks.id, id));
    return task || undefined;
  }

  async createAgentTask(task: InsertAgentTask): Promise<AgentTask> {
    const [created] = await db.insert(agentTasks).values(task).returning();
    return created;
  }

  async updateAgentTask(id: string, updates: Partial<AgentTask>): Promise<AgentTask | undefined> {
    const [updated] = await db.update(agentTasks)
      .set(updates)
      .where(eq(agentTasks.id, id))
      .returning();
    return updated || undefined;
  }

  // Cron job methods
  async listCronJobs(userId?: string): Promise<CronJob[]> {
    if (userId) {
      return db.select().from(cronJobs).where(eq(cronJobs.userId, userId)).orderBy(desc(cronJobs.createdAt));
    }
    return db.select().from(cronJobs).orderBy(desc(cronJobs.createdAt));
  }

  async getCronJob(id: string): Promise<CronJob | undefined> {
    const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, id));
    return job || undefined;
  }

  async createCronJob(job: InsertCronJob): Promise<CronJob> {
    const [created] = await db.insert(cronJobs).values(job).returning();
    return created;
  }

  async updateCronJob(id: string, updates: Partial<CronJob>): Promise<CronJob | undefined> {
    const [updated] = await db.update(cronJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(cronJobs.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCronJob(id: string): Promise<boolean> {
    const result = await db.delete(cronJobs).where(eq(cronJobs.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getEnabledCronJobs(): Promise<CronJob[]> {
    return db.select().from(cronJobs).where(eq(cronJobs.enabled, true)).orderBy(asc(cronJobs.nextRunAt));
  }

  async logToolError(data: InsertToolErrorLog): Promise<ToolErrorLog> {
    const [created] = await db.insert(toolErrorLogs).values(data).returning();
    // Cap at 500 rows — fire-and-forget trim
    void db.execute(sql`
      DELETE FROM tool_error_logs
      WHERE id NOT IN (SELECT id FROM tool_error_logs ORDER BY created_at DESC LIMIT 500)
    `).catch((e: unknown) => console.warn('[tool-error-log] Trim failed:', e));
    return created;
  }

  async listToolErrors(limit = 100): Promise<ToolErrorLog[]> {
    return db.select().from(toolErrorLogs)
      .orderBy(desc(toolErrorLogs.createdAt))
      .limit(Math.min(limit, 500));
  }

  async clearToolErrors(): Promise<void> {
    await db.delete(toolErrorLogs);
  }
}

export const storage = new DatabaseStorage();
