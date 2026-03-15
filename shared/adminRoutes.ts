import { PERMISSIONS, type Permission } from './constants';

export type AdminIconName =
  | 'Settings'
  | 'Package'
  | 'Bot'
  | 'Key'
  | 'FileText'
  | 'Users'
  | 'Building2'
  | 'CreditCard'
  | 'Brain'
  | 'LifeBuoy'
  | 'Mic'
  | 'Volume2'
  | 'Image'
  | 'Video'
  | 'Code2'
  | 'Network'
  | 'Puzzle'
  | 'Link2'
  | 'Globe'
  | 'Zap'
  | 'Search'
  | 'Plug'
  | 'Activity'
  | 'LayoutDashboard'
  | 'Rocket'
  | 'Wrench'
  | 'Monitor'
  | 'BookOpen'
  | 'Terminal';

export interface AdminApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
}

export type AdminRouteGroupId =
  | 'overview'
  | 'setup'
  | 'melvinos'
  | 'subagents'
  | 'knowledge'
  | 'tools-skills'
  | 'advanced'
  | 'monitoring';

export interface AdminDashboardCardContent {
  title: string;
  description: string;
  actionLabel: string;
  icon: AdminIconName;
}

export interface AdminRouteDefinition {
  id: string;
  label: string;
  path: string;
  requiredPermission: Permission;
  apis: AdminApiEndpoint[];
  groupId?: AdminRouteGroupId;
  pageHeader?: {
    title: string;
    description?: string;
  };
  dashboardCards?: {
    system?: AdminDashboardCardContent;
    workspace?: AdminDashboardCardContent;
  };
}

export interface AdminRouteGroupDefinition {
  id: AdminRouteGroupId;
  label: string;
  icon: AdminIconName;
  requiredPermission: Permission;
  routeIds: string[];
}

const ADMIN_ROUTE_CATALOG: Record<string, AdminRouteDefinition> = {
  'system-prompts': {
    id: 'system-prompts',
    label: 'System Prompts',
    path: '/settings/system-prompts',
    requiredPermission: PERMISSIONS.SYSTEM_PROMPTS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/system-prompts' },
      { method: 'POST', path: '/api/admin/system-prompts' },
      { method: 'PATCH', path: '/api/admin/system-prompts/:id' },
    ],
    groupId: 'melvinos',
    dashboardCards: {
      system: {
        title: 'System Prompts',
        description: 'Define the default operating instructions used across every agent.',
        actionLabel: 'Manage prompts',
        icon: 'Bot',
      },
    },
  },
  'output-templates': {
    id: 'output-templates',
    label: 'Output Templates',
    path: '/settings/output-templates',
    requiredPermission: PERMISSIONS.OUTPUT_TEMPLATES_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/output-templates' },
      { method: 'POST', path: '/api/admin/output-templates' },
      { method: 'PATCH', path: '/api/admin/output-templates/:id' },
      { method: 'DELETE', path: '/api/admin/output-templates/:id' },
    ],
    groupId: 'melvinos',
    dashboardCards: {
      system: {
        title: 'Output Templates',
        description: 'Standardize structured responses and reusable formatting blocks.',
        actionLabel: 'Manage templates',
        icon: 'FileText',
      },
    },
  },
  'tool-policies': {
    id: 'tool-policies',
    label: 'Tool Policies',
    path: '/settings/tool-policies',
    requiredPermission: PERMISSIONS.TOOL_POLICIES_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/tool-policies' },
      { method: 'POST', path: '/api/admin/tool-policies' },
      { method: 'PATCH', path: '/api/admin/tool-policies/:id' },
      { method: 'DELETE', path: '/api/admin/tool-policies/:id' },
      { method: 'GET', path: '/api/admin/releases' },
      { method: 'POST', path: '/api/admin/releases' },
      { method: 'POST', path: '/api/admin/releases/:id/publish' },
      { method: 'POST', path: '/api/admin/releases/:id/rollback' },
    ],
    groupId: 'tools-skills',
    dashboardCards: {
      system: {
        title: 'Tool Policies',
        description: 'Control access to tools and publish safety or release updates.',
        actionLabel: 'Manage policies',
        icon: 'Settings',
      },
    },
  },
  'knowledge-base': {
    id: 'knowledge-base',
    label: 'Knowledge Base',
    path: '/settings/knowledge-base',
    requiredPermission: PERMISSIONS.KNOWLEDGE_BASE_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
      { method: 'GET', path: '/api/admin/knowledge' },
    ],
    groupId: 'knowledge',
    pageHeader: {
      title: 'Knowledge Base',
      description: 'Configure knowledge base access, storage limits, and upload permissions.',
    },
  },
  memory: {
    id: 'memory',
    label: 'Memory',
    path: '/settings/memory',
    requiredPermission: PERMISSIONS.MEMORY_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
      { method: 'GET', path: '/api/admin/knowledge' },
    ],
    groupId: 'knowledge',
    pageHeader: {
      title: 'Memory & Personalization',
      description: 'Configure long-term memory retention and personalization settings for AI assistants.',
    },
    dashboardCards: {
      workspace: {
        title: 'User Knowledge & Memory',
        description: 'Audit stored knowledge bases and memories.',
        actionLabel: 'Review memory',
        icon: 'Brain',
      },
    },
  },
  'templates-projects': {
    id: 'templates-projects',
    label: 'Templates & Projects',
    path: '/settings/templates-projects',
    requiredPermission: PERMISSIONS.TEMPLATES_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/templates' },
      { method: 'POST', path: '/api/admin/templates' },
      { method: 'PATCH', path: '/api/admin/templates/:id' },
      { method: 'DELETE', path: '/api/admin/templates/:id' },
      { method: 'GET', path: '/api/admin/templates/:id/file' },
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
    ],
    groupId: 'knowledge',
    pageHeader: {
      title: 'Templates & Projects',
      description: 'Configure reusable templates and collaborative project workspaces for your teams.',
    },
  },
  'assistant-library': {
    id: 'assistant-library',
    label: 'Subagent Library',
    path: '/settings/assistants',
    requiredPermission: PERMISSIONS.ASSISTANT_LIBRARY_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/assistants' },
      { method: 'POST', path: '/api/admin/assistants' },
      { method: 'PATCH', path: '/api/admin/assistants/:id' },
      { method: 'DELETE', path: '/api/admin/assistants/:id' },
      { method: 'GET', path: '/api/admin/assistant-metrics' },
    ],
    groupId: 'subagents',
    pageHeader: {
      title: 'Subagent Library',
      description: 'Configure specialized subagents called upon by the agent to handle domain-specific tasks.',
    },
    dashboardCards: {
      system: {
        title: 'Subagent Library',
        description: 'Configure specialized workers: coding, research, sales, marketing, and more.',
        actionLabel: 'Manage subagents',
        icon: 'Network',
      },
      workspace: {
        title: 'Subagent Library',
        description: 'Review which subagents are active across user workspaces.',
        actionLabel: 'Review subagents',
        icon: 'Network',
      },
    },
  },
  'api-access': {
    id: 'api-access',
    label: 'AI Providers',
    path: '/settings/api-access',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
    ],
    groupId: 'advanced',
    pageHeader: {
      title: 'AI Providers',
      description: 'Configure AI API providers, model availability, and usage limits.',
    },
    dashboardCards: {
      system: {
        title: 'AI Providers',
        description: 'Configure LLM, TTS, STT, image, and video generation providers.',
        actionLabel: 'Manage providers',
        icon: 'Key',
      },
    },
  },
  'skills': {
    id: 'skills',
    label: 'Skills',
    path: '/settings/skills',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
    ],
    groupId: 'tools-skills',
    pageHeader: {
      title: 'Skills',
      description: 'Configure the skills the agent can use to help users — from coding to research to productivity tools.',
    },
    dashboardCards: {
      system: {
        title: 'Skills',
        description: 'Enable and configure agent skills like Deep Research, Claude Code, and Google Workspace.',
        actionLabel: 'Manage skills',
        icon: 'Zap',
      },
    },
  },
  'trigger-rules': {
    id: 'trigger-rules',
    label: 'Trigger Rules',
    path: '/settings/trigger-rules',
    requiredPermission: PERMISSIONS.TOOL_POLICIES_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
    ],
    groupId: 'tools-skills',
    pageHeader: {
      title: 'Trigger Rules',
      description: 'Map phrases to tools and skills for deterministic routing.',
    },
    dashboardCards: {
      system: {
        title: 'Trigger Rules',
        description: 'Configure phrase-to-tool routing for reliable tool invocation.',
        actionLabel: 'Manage triggers',
        icon: 'Zap',
      },
    },
  },
  'heartbeat': {
    id: 'heartbeat',
    label: 'Heartbeat',
    path: '/settings/heartbeat',
    requiredPermission: PERMISSIONS.SYSTEM_PROMPTS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
      { method: 'POST', path: '/api/admin/heartbeat/trigger' },
      { method: 'GET', path: '/api/admin/heartbeat/status' },
    ],
    groupId: 'advanced',
    pageHeader: {
      title: 'Heartbeat',
      description: 'Configure a periodic executive scan that checks system health, deadlines, and active workstreams.',
    },
    dashboardCards: {
      system: {
        title: 'Heartbeat',
        description: 'Set up periodic automated scans with configurable checklist and delivery channels.',
        actionLabel: 'Configure heartbeat',
        icon: 'Activity',
      },
    },
  },
  'integrations': {
    id: 'integrations',
    label: 'Integrations',
    path: '/settings/integrations',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings' },
      { method: 'GET', path: '/api/admin/integrations/connections' },
    ],
    groupId: 'advanced',
    pageHeader: {
      title: 'Integrations',
      description: 'Configure OAuth apps and third-party platform connections for your workspace.',
    },
    dashboardCards: {
      system: {
        title: 'Integrations',
        description: 'Set up Google, Notion, and Recall AI for your entire workspace.',
        actionLabel: 'Manage integrations',
        icon: 'Globe',
      },
    },
  },
  'setup': {
    id: 'setup',
    label: 'Setup Wizard',
    path: '/settings/setup',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'GET', path: '/api/health/heartbeat' },
    ],
    groupId: 'setup',
    pageHeader: {
      title: 'Setup',
      description: 'Check system readiness and configure essential settings.',
    },
    dashboardCards: {
      system: {
        title: 'Setup',
        description: 'Check system readiness and configure essential settings.',
        actionLabel: 'Open setup',
        icon: 'Rocket',
      },
    },
  },
  'monitoring': {
    id: 'monitoring',
    label: 'System Monitor',
    path: '/settings/monitoring',
    requiredPermission: PERMISSIONS.SYSTEM_PROMPTS_VIEW,
    apis: [
      { method: 'GET', path: '/api/health/heartbeat' },
      { method: 'GET', path: '/api/admin/knowledge' },
    ],
    groupId: 'monitoring',
    pageHeader: {
      title: 'Monitoring',
      description: 'System health, resource usage, and operational status.',
    },
    dashboardCards: {
      system: {
        title: 'Monitoring',
        description: 'View system health, resource usage, and operational status.',
        actionLabel: 'View status',
        icon: 'Monitor',
      },
    },
  },
  'ssh-servers': {
    id: 'ssh-servers',
    label: 'SSH Servers',
    path: '/settings/ssh-servers',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/ssh-servers' },
      { method: 'POST', path: '/api/admin/ssh-servers' },
      { method: 'PUT', path: '/api/admin/ssh-servers/:id' },
      { method: 'DELETE', path: '/api/admin/ssh-servers/:id' },
      { method: 'POST', path: '/api/admin/ssh-servers/:id/test' },
    ],
    groupId: 'advanced',
    pageHeader: {
      title: 'SSH Servers',
      description: 'Configure remote server connections so the agent can execute commands via SSH.',
    },
    dashboardCards: {
      system: {
        title: 'SSH Servers',
        description: 'Connect remote servers so the agent can run commands and manage infrastructure.',
        actionLabel: 'Manage servers',
        icon: 'Terminal',
      },
    },
  },
  'mcp-servers': {
    id: 'mcp-servers',
    label: 'MCP Servers',
    path: '/settings/mcp-servers',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    apis: [
      { method: 'GET', path: '/api/admin/mcp/servers' },
      { method: 'POST', path: '/api/admin/mcp/servers' },
      { method: 'PATCH', path: '/api/admin/mcp/servers/:id' },
      { method: 'DELETE', path: '/api/admin/mcp/servers/:id' },
    ],
    groupId: 'tools-skills',
    pageHeader: {
      title: 'MCP Servers',
      description: 'Connect external tool servers using the Model Context Protocol to extend agent capabilities.',
    },
    dashboardCards: {
      system: {
        title: 'MCP Servers',
        description: 'Connect external tool servers to extend agent capabilities.',
        actionLabel: 'Manage servers',
        icon: 'Plug',
      },
    },
  },
};

export type AdminRouteId = keyof typeof ADMIN_ROUTE_CATALOG;
export interface AdminRouteMapEntry {
  path: string;
  api?: string;
}

export type AdminRouteScope = 'system' | 'user';
export type AdminRoutesMap = Record<AdminRouteScope, Partial<Record<AdminRouteId, AdminRouteMapEntry>>>;

export const ADMIN_ROUTE_GROUPS: readonly AdminRouteGroupDefinition[] = [
  {
    id: 'setup',
    label: 'Setup',
    icon: 'Rocket',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    routeIds: ['setup'],
  },
  {
    id: 'melvinos',
    label: 'MelvinOS',
    icon: 'Bot',
    requiredPermission: PERMISSIONS.SYSTEM_PROMPTS_VIEW,
    routeIds: ['system-prompts', 'output-templates'],
  },
  {
    id: 'subagents',
    label: 'Subagents',
    icon: 'Network',
    requiredPermission: PERMISSIONS.ASSISTANT_LIBRARY_VIEW,
    routeIds: ['assistant-library'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: 'BookOpen',
    requiredPermission: PERMISSIONS.KNOWLEDGE_BASE_VIEW,
    routeIds: ['knowledge-base', 'memory', 'templates-projects'],
  },
  {
    id: 'tools-skills',
    label: 'Tools & Skills',
    icon: 'Wrench',
    requiredPermission: PERMISSIONS.TOOL_POLICIES_VIEW,
    routeIds: ['tool-policies', 'skills', 'trigger-rules', 'mcp-servers'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: 'Settings',
    requiredPermission: PERMISSIONS.API_ACCESS_VIEW,
    routeIds: ['api-access', 'integrations', 'heartbeat', 'ssh-servers'],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: 'Monitor',
    requiredPermission: PERMISSIONS.SYSTEM_PROMPTS_VIEW,
    routeIds: ['monitoring'],
  },
] as const;

export const ADMIN_NAV_GROUPS = ADMIN_ROUTE_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  icon: group.icon,
  requiredPermission: group.requiredPermission,
  items: group.routeIds
    .map((routeId) => ADMIN_ROUTE_CATALOG[routeId])
    .filter(Boolean)
    .map((route) => ({
      id: route.id,
      label: route.label,
      path: route.path,
      requiredPermission: route.requiredPermission,
    })),
}));

const ADMIN_ROUTE_LIST = Object.values(ADMIN_ROUTE_CATALOG);

const buildScopedAdminRoutes = (): AdminRoutesMap => {
  return ADMIN_ROUTE_LIST.reduce<AdminRoutesMap>(
    (accumulator, route) => {
      const primaryApi = route.apis[0]?.path;

      if (route.dashboardCards?.system) {
        accumulator.system[route.id as AdminRouteId] = { path: route.path, api: primaryApi };
      }

      if (route.dashboardCards?.workspace) {
        accumulator.user[route.id as AdminRouteId] = { path: route.path, api: primaryApi };
      }

      return accumulator;
    },
    { system: {}, user: {} } as AdminRoutesMap,
  );
};

export const ADMIN_ROUTES: AdminRoutesMap = buildScopedAdminRoutes();

export const ADMIN_ROUTES_BY_PATH: Record<string, AdminRouteDefinition> = ADMIN_ROUTE_LIST.reduce(
  (accumulator, route) => {
    accumulator[route.path] = route;
    return accumulator;
  },
  {} as Record<string, AdminRouteDefinition>,
);

export function getAdminRouteById(routeId: AdminRouteId): AdminRouteDefinition {
  return ADMIN_ROUTE_CATALOG[routeId];
}

export function findAdminRouteByPath(path: string): AdminRouteDefinition | undefined {
  return ADMIN_ROUTES_BY_PATH[path];
}

export function getDashboardRoutes(category: 'system' | 'workspace'): AdminRouteDefinition[] {
  return ADMIN_ROUTE_LIST.filter((route) => route.dashboardCards?.[category]);
}

export function getRouteDashboardCard(
  route: AdminRouteDefinition,
  category: 'system' | 'workspace',
): AdminDashboardCardContent | undefined {
  return route.dashboardCards?.[category];
}

export function getAdminRouteGroupById(
  groupId: AdminRouteGroupId,
): AdminRouteGroupDefinition | undefined {
  return ADMIN_ROUTE_GROUPS.find((group) => group.id === groupId);
}

export { ADMIN_ROUTE_CATALOG };
