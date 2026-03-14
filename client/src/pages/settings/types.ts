import type { PlatformSettingsData, ProviderSettings, UserStatus } from '@shared/schema';

export interface AdminSettingsResponse {
  settings: {
    id: string;
    data: PlatformSettingsData;
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface AdminTemplate {
  id: string;
  name: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  availableForFree: boolean;
  availableForPro: boolean;
  isActive: boolean;
  fileId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminTemplatesResponse {
  templates: AdminTemplate[];
}

export interface OutputTemplateSectionInput {
  key: string;
  title: string;
  description: string | null;
}

export interface AdminOutputTemplate {
  id: string;
  name: string;
  category: string;
  format: string;
  description: string | null;
  instructions: string | null;
  requiredSections: OutputTemplateSectionInput[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminOutputTemplatesResponse {
  templates: AdminOutputTemplate[];
}

export interface AdminAssistant {
  id: string;
  type: 'prompt' | 'webhook';
  name: string;
  description: string | null;
  promptContent: string | null;
  workflowId: string | null;
  webhookUrl: string | null;
  metadata: Record<string, unknown> | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminAssistantsResponse {
  assistants: AdminAssistant[];
}

export interface AdminAssistantMetricsResponse {
  totalAssistants: number;
  activeAssistants: number;
  inactiveAssistants: number;
  typeBreakdown: Array<{
    type: AdminAssistant['type'];
    total: number;
    active: number;
    inactive: number;
  }>;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  plan: string;
  role: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export type TicketStatus = 'open' | 'pending' | 'closed';

export interface AdminTicket {
  id: string;
  status?: TicketStatus | string | null;
  subject?: string | null;
  requester?: string | null;
  assignee?: string | null;
  priority?: string | null;
  updatedAt?: string | null;
}

export interface AdminTicketsResponse {
  tickets: AdminTicket[];
  total?: number;
  open?: number;
  pending?: number;
}

export interface AdminOrganization {
  id: string;
  name: string;
  members: number;
  notes?: string | null;
}

export interface AdminOrganizationsResponse {
  organizations: AdminOrganization[];
  orgs?: AdminOrganization[];
}

export interface AdminSystemPrompt {
  id: string;
  version: number;
  label: string | null;
  content: string;
  notes: string | null;
  createdByUserId: string | null;
  activatedByUserId: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  activatedAt?: string | null;
}

export interface AdminSystemPromptListResponse {
  systemPrompts: AdminSystemPrompt[];
  activeSystemPromptId: string | null;
}

export interface AdminSystemPromptMutationResponse extends AdminSystemPromptListResponse {
  systemPrompt: AdminSystemPrompt;
}

export type ReleaseStatus = 'draft' | 'active' | 'archived';

export interface AdminRelease {
  id: string;
  version: number;
  label: string;
  status: ReleaseStatus;
  changeNotes: string | null;
  systemPromptId: string | null;
  assistantIds: string[];
  templateIds: string[];
  outputTemplateIds: string[];
  toolPolicyIds: string[];
  isActive: boolean;
  publishedAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminReleasesResponse {
  releases: AdminRelease[];
  activeReleaseId: string | null;
}

export interface ReleaseFormState {
  label: string;
  systemPromptId: string | null;
  changeNotes: string;
  assistantIds: string[];
  templateIds: string[];
  outputTemplateIds: string[];
  toolPolicyIds: string[];
}

export type ReleaseFormSelectableField = keyof Pick<ReleaseFormState, 'assistantIds' | 'templateIds' | 'outputTemplateIds' | 'toolPolicyIds'>;

export interface AdminToolPolicySummary {
  id: string;
  provider: string;
  toolName: string;
  isEnabled: boolean;
  safetyNote?: string | null;
}

export interface AdminToolPoliciesResponse {
  toolPolicies: AdminToolPolicySummary[];
}
