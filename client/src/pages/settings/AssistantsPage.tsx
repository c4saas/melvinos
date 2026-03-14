import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Shield, Loader2, Save, Trash2, Workflow, Link as LinkIcon, Bot, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { ASSISTANT_TYPE_VALUES } from '@shared/schema';
import type { AdminAssistant, AdminAssistantsResponse, AdminOutputTemplate, AdminOutputTemplatesResponse } from './types';
import { useAdminLayout } from '@/components/AdminLayout';

type AssistantType = (typeof ASSISTANT_TYPE_VALUES)[number];

const BUILTIN_GROUPS: { label: string; toolNames: string[] }[] = [
  { label: 'Google', toolNames: ['gmail_search', 'gmail_read', 'gmail_send', 'gmail_modify', 'calendar_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'drive_search', 'drive_read', 'drive_write'] },
  { label: 'Notion', toolNames: ['notion_search', 'notion_read_page', 'notion_create_page', 'notion_update_page'] },
  { label: 'Recall AI', toolNames: ['recall_search', 'recall_meetings', 'recall_create_bot'] },
  { label: 'Gamma', toolNames: ['gamma_create'] },
  { label: 'Research & Web', toolNames: ['web_search', 'web_fetch', 'deep_research'] },
  { label: 'Files & Code', toolNames: ['file_read', 'file_write', 'file_edit', 'python_execute', 'shell_execute', 'claude_code'] },
  { label: 'Memory', toolNames: ['memory_save', 'memory_search', 'memory_delete'] },
  { label: 'Media', toolNames: ['image_generate', 'video_generate'] },
  { label: 'Tasks & Automation', toolNames: ['spawn_task', 'schedule_task', 'list_scheduled_tasks', 'delete_scheduled_task'] },
  { label: 'Remote Access', toolNames: ['ssh_execute'] },
  { label: 'System', toolNames: ['consolidate_data', 'skill_update'] },
];

interface SkillFormEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[];
}

interface AssistantFormState {
  type: AssistantType;
  name: string;
  description: string;
  promptContent: string;
  workflowId: string;
  webhookUrl: string;
  metadata: Record<string, unknown> | null;
  isActive: boolean;
  isSubAgent: boolean;
  outputTemplateId: string;
  // Agent config (prompt assistants only)
  enabledTools: string[];
  skills: SkillFormEntry[];
  maxIterations: number;
  temperature: number;
}

interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  versionId: string | null;
  tags: string[];
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  webhookUrls: string[];
}

interface AssistantMutationPayload {
  type: AssistantType;
  name: string;
  description: string | null;
  promptContent?: string | null;
  workflowId?: string | null;
  webhookUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
}

const createEmptyAssistantForm = (): AssistantFormState => ({
  type: 'prompt',
  name: '',
  description: '',
  promptContent: '',
  workflowId: '',
  webhookUrl: '',
  metadata: null,
  isActive: true,
  isSubAgent: false,
  outputTemplateId: '',
  enabledTools: [],
  skills: [],
  maxIterations: 10,
  temperature: 0.7,
});

const createEmptySkill = (): SkillFormEntry => ({
  id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  description: '',
  instructions: '',
  tools: [],
});

export default function AssistantsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: isAuthLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { setHeader, resetHeader } = useAdminLayout();

  const assistantsQuery = useQuery<AdminAssistantsResponse>({
    queryKey: ['admin-assistants'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/assistants');
      return response.json();
    },
    enabled: isAdmin,
  });

  const [assistantForm, setAssistantForm] = useState<AssistantFormState>(createEmptyAssistantForm);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(null);
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(new Set());

  const assistants = assistantsQuery.data?.assistants ?? [];

  const workflowsQuery = useQuery<{ baseUrl: string; workflows: N8nWorkflowSummary[] }>({
    queryKey: ['n8n-workflows'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/integrations/n8n/workflows');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Unable to load n8n workflows');
      }
      return response.json() as Promise<{ baseUrl: string; workflows: N8nWorkflowSummary[] }>;
    },
    enabled: isAdmin && assistantForm.type === 'webhook',
    retry: false,
  });

  const workflows = workflowsQuery.data?.workflows ?? [];

  const availableToolsQuery = useQuery<{ tools: { name: string; description: string }[] }>({
    queryKey: ['available-tools'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/available-tools');
      return response.json();
    },
    enabled: isAdmin && assistantForm.type === 'prompt',
    staleTime: 300000,
  });
  const availableTools = availableToolsQuery.data?.tools ?? [];

  const settingsQuery = useQuery<{ settings: { data: { mcpServers?: { id: string; name: string }[] } } }>({
    queryKey: ['admin-settings-mcp'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/settings');
      return response.json();
    },
    enabled: isAdmin && assistantForm.type === 'prompt',
    staleTime: 300000,
  });
  const mcpServerNames: Record<string, string> = Object.fromEntries(
    (settingsQuery.data?.settings?.data?.mcpServers ?? []).map(s => [s.id, s.name])
  );

  const outputTemplatesQuery = useQuery<AdminOutputTemplatesResponse>({
    queryKey: ['admin-output-templates'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/output-templates');
      return response.json();
    },
    enabled: isAdmin,
    staleTime: 300000,
  });
  const outputTemplates = outputTemplatesQuery.data?.templates ?? [];

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      setLocation('/');
    }
  }, [isAdmin, isAuthLoading, setLocation]);

  useEffect(() => {
    setHeader({
      title: 'Subagent Library',
      description: 'Create AI assistants that can use prompt templates or trigger external workflows.',
    });
    return () => resetHeader();
  }, [setHeader, resetHeader]);

  useEffect(() => {
    if (assistantForm.type !== 'webhook') {
      return;
    }

    const workflow = workflows.find((item) => item.id === assistantForm.workflowId);
    if (!workflow) {
      return;
    }

    setAssistantForm((current) => {
      if (current.type !== 'webhook' || current.workflowId !== workflow.id) {
        return current;
      }

      const nextMetadata = {
        workflowName: workflow.name,
        active: workflow.active,
        tags: workflow.tags,
        versionId: workflow.versionId,
        webhookUrls: workflow.webhookUrls,
      } as Record<string, unknown>;

      const shouldUpdateMetadata =
        !current.metadata || JSON.stringify(current.metadata) !== JSON.stringify(nextMetadata);
      const shouldUpdateWebhookUrl = !current.webhookUrl && workflow.webhookUrls.length > 0;

      if (!shouldUpdateMetadata && !shouldUpdateWebhookUrl) {
        return current;
      }

      return {
        ...current,
        metadata: shouldUpdateMetadata ? nextMetadata : current.metadata,
        webhookUrl: shouldUpdateWebhookUrl ? workflow.webhookUrls[0] ?? '' : current.webhookUrl,
      };
    });
  }, [assistantForm.type, assistantForm.workflowId, workflows]);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === assistantForm.workflowId) ?? null,
    [assistantForm.workflowId, workflows],
  );

  const assistantCreateMutation = useMutation({
    mutationFn: async (payload: AssistantMutationPayload) => {
      const response = await apiRequest('POST', '/api/admin/assistants', payload);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to create assistant');
      }
      return response.json() as Promise<{ assistant: AdminAssistant }>;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<AdminAssistantsResponse | undefined>(['admin-assistants'], (current) => {
        if (!current) {
          return { assistants: [result.assistant] };
        }
        return { assistants: [result.assistant, ...current.assistants] };
      });
      setAssistantForm(createEmptyAssistantForm());
      setEditingAssistantId(null);
      toast({
        title: 'Assistant created',
        description: `${result.assistant.name} is now available to users.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to create assistant',
        description: error instanceof Error ? error.message : 'Please try again later.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-assistants'] });
    },
  });

  const assistantUpdateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AssistantMutationPayload }) => {
      const response = await apiRequest('PATCH', `/api/admin/assistants/${id}`, updates);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to update assistant');
      }
      return response.json() as Promise<{ assistant: AdminAssistant }>;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<AdminAssistantsResponse | undefined>(['admin-assistants'], (current) => {
        if (!current) {
          return { assistants: [result.assistant] };
        }
        return {
          assistants: current.assistants.map((assistant) =>
            assistant.id === result.assistant.id ? result.assistant : assistant,
          ),
        };
      });
      setAssistantForm(createEmptyAssistantForm());
      setEditingAssistantId(null);
      toast({
        title: 'Assistant updated',
        description: `${result.assistant.name} has been updated successfully.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update assistant',
        description: error instanceof Error ? error.message : 'Please try again later.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-assistants'] });
    },
  });

  const assistantStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const response = await apiRequest('PATCH', `/api/admin/assistants/${id}`, { isActive });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to update assistant status');
      }
      return response.json() as Promise<{ assistant: AdminAssistant }>;
    },
    onMutate: async ({ id, isActive }) => {
      setStatusUpdatingId(id);
      await queryClient.cancelQueries({ queryKey: ['admin-assistants'] });
      const previousAssistants = queryClient.getQueryData<AdminAssistantsResponse>(['admin-assistants']);
      queryClient.setQueryData<AdminAssistantsResponse | undefined>(['admin-assistants'], (current) => {
        if (!current) {
          return current;
        }
        return {
          assistants: current.assistants.map((assistant) =>
            assistant.id === id ? { ...assistant, isActive } : assistant,
          ),
        };
      });

      let previousForm: AssistantFormState | null = null;
      if (editingAssistantId === id) {
        setAssistantForm((current) => {
          previousForm = current;
          return { ...current, isActive };
        });
      }

      return { previousAssistants, previousForm };
    },
    onError: (error, variables, context) => {
      if (context?.previousAssistants) {
        queryClient.setQueryData(['admin-assistants'], context.previousAssistants);
      }
      if (editingAssistantId === variables.id && context?.previousForm) {
        setAssistantForm(context.previousForm);
      }
      toast({
        title: 'Failed to update assistant status',
        description: error instanceof Error ? error.message : 'Please try again later.',
        variant: 'destructive',
      });
    },
    onSuccess: (result, variables) => {
      queryClient.setQueryData<AdminAssistantsResponse | undefined>(['admin-assistants'], (current) => {
        if (!current) {
          return { assistants: [result.assistant] };
        }
        return {
          assistants: current.assistants.map((assistant) =>
            assistant.id === result.assistant.id ? result.assistant : assistant,
          ),
        };
      });

      if (editingAssistantId === variables.id) {
        setAssistantForm((current) => ({ ...current, isActive: result.assistant.isActive }));
      }

      toast({
        title: result.assistant.isActive ? 'Assistant activated' : 'Assistant deactivated',
        description: `${result.assistant.name} is now ${result.assistant.isActive ? 'active' : 'inactive'}.`,
      });
    },
    onSettled: () => {
      setStatusUpdatingId(null);
      queryClient.invalidateQueries({ queryKey: ['admin-assistants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-assistant-metrics'] });
    },
  });

  const assistantDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/admin/assistants/${id}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to delete assistant');
      }
      return response.json() as Promise<{ success: boolean }>;
    },
    onMutate: (id) => {
      setDeletingAssistantId(id);
    },
    onSuccess: (_result, id) => {
      queryClient.setQueryData<AdminAssistantsResponse | undefined>(['admin-assistants'], (current) => {
        if (!current) {
          return { assistants: [] };
        }
        return {
          assistants: current.assistants.filter((assistant) => assistant.id !== id),
        };
      });
      toast({
        title: 'Assistant removed',
        description: 'Assistant deleted successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to delete assistant',
        description: error instanceof Error ? error.message : 'Please try again later.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setDeletingAssistantId(null);
      queryClient.invalidateQueries({ queryKey: ['admin-assistants'] });
    },
  });

  const handleTypeChange = (value: AssistantType) => {
    setAssistantForm((current) => ({
      ...current,
      type: value,
      promptContent: value === 'prompt' ? current.promptContent : '',
      workflowId: value === 'webhook' ? current.workflowId : '',
      webhookUrl: value === 'webhook' ? current.webhookUrl : '',
      metadata: value === 'webhook' ? current.metadata : null,
      enabledTools: value === 'prompt' ? current.enabledTools : [],
      skills: value === 'prompt' ? current.skills : [],
      maxIterations: value === 'prompt' ? current.maxIterations : 10,
      temperature: value === 'prompt' ? current.temperature : 0.7,
    }));
  };

  const handleWorkflowSelect = (value: string) => {
    setAssistantForm((current) => ({
      ...current,
      workflowId: value,
      metadata: current.metadata,
    }));
  };

  const handleSubmit = () => {
    const trimmedName = assistantForm.name.trim();
    if (!trimmedName) {
      toast({
        title: 'Assistant name required',
        description: 'Give your assistant a clear name.',
        variant: 'destructive',
      });
      return;
    }

    const trimmedDescription = assistantForm.description.trim();
    const basePayload: AssistantMutationPayload = {
      type: assistantForm.type,
      name: trimmedName,
      description: trimmedDescription ? trimmedDescription : null,
      isActive: assistantForm.isActive,
    };

    if (assistantForm.type === 'prompt') {
      const trimmedPrompt = assistantForm.promptContent.trim();
      if (!trimmedPrompt) {
        toast({
          title: 'Assistant prompt required',
          description: 'Define the assistant prompt before saving.',
          variant: 'destructive',
        });
        return;
      }
      basePayload.promptContent = trimmedPrompt;
      basePayload.webhookUrl = null;
      basePayload.workflowId = null;

      // Build agent config metadata
      const agentMeta: Record<string, unknown> = {};
      if (assistantForm.enabledTools.length > 0) {
        agentMeta.enabledTools = assistantForm.enabledTools;
      }
      const validSkills = assistantForm.skills.filter(s => s.name.trim() && s.instructions.trim());
      if (validSkills.length > 0) {
        agentMeta.skills = validSkills.map(s => ({
          id: s.id,
          name: s.name.trim(),
          description: s.description.trim(),
          instructions: s.instructions.trim(),
          tools: s.tools,
        }));
      }
      const agentConfig: Record<string, unknown> = {};
      if (assistantForm.maxIterations !== 10) agentConfig.maxIterations = assistantForm.maxIterations;
      if (assistantForm.temperature !== 0.7) agentConfig.temperature = assistantForm.temperature;
      if (Object.keys(agentConfig).length > 0) agentMeta.agentConfig = agentConfig;
      if (assistantForm.isSubAgent) agentMeta.isSubAgent = true;
      if (assistantForm.outputTemplateId) agentMeta.outputTemplateId = assistantForm.outputTemplateId;

      basePayload.metadata = Object.keys(agentMeta).length > 0 ? agentMeta : null;
    } else {
      const trimmedWorkflowId = assistantForm.workflowId.trim();
      const trimmedWebhookUrl = assistantForm.webhookUrl.trim();
      if (!trimmedWorkflowId) {
        toast({
          title: 'Workflow required',
          description: 'Select or enter an n8n workflow ID.',
          variant: 'destructive',
        });
        return;
      }
      if (!trimmedWebhookUrl) {
        toast({
          title: 'Webhook URL required',
          description: 'Provide a webhook URL to trigger this assistant.',
          variant: 'destructive',
        });
        return;
      }
      basePayload.workflowId = trimmedWorkflowId;
      basePayload.webhookUrl = trimmedWebhookUrl;
      basePayload.promptContent = null;
      const webhookMeta: Record<string, unknown> = assistantForm.metadata ?? (selectedWorkflow
        ? {
            workflowName: selectedWorkflow.name,
            active: selectedWorkflow.active,
            tags: selectedWorkflow.tags,
            versionId: selectedWorkflow.versionId,
            webhookUrls: selectedWorkflow.webhookUrls,
          }
        : {});
      if (assistantForm.isSubAgent) webhookMeta.isSubAgent = true;
      if (assistantForm.outputTemplateId) webhookMeta.outputTemplateId = assistantForm.outputTemplateId;
      basePayload.metadata = Object.keys(webhookMeta).length > 0 ? webhookMeta : null;
    }

    if (editingAssistantId) {
      assistantUpdateMutation.mutate({ id: editingAssistantId, updates: basePayload });
    } else {
      assistantCreateMutation.mutate(basePayload);
    }
  };

  if (assistantsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" data-testid="loading-assistants">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card data-testid="card-assistants">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-4 w-4 text-primary" />
              Subagent Library
            </CardTitle>
            <CardDescription>
              Create AI assistants that can be prompt-driven or webhook-triggered workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assistant-name">Assistant name</Label>
                  <Input
                    id="assistant-name"
                    type="text"
                    placeholder="e.g., Code Reviewer, Creative Writer"
                    value={assistantForm.name}
                    onChange={(e) => setAssistantForm((current) => ({ ...current, name: e.target.value }))}
                    data-testid="input-assistant-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-description">Description (optional)</Label>
                  <Input
                    id="assistant-description"
                    type="text"
                    placeholder="Brief description of the assistant's role"
                    value={assistantForm.description}
                    onChange={(e) => setAssistantForm((current) => ({ ...current, description: e.target.value }))}
                    data-testid="input-assistant-description"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assistant-type">Assistant type</Label>
                  <Select value={assistantForm.type} onValueChange={(value) => handleTypeChange(value as AssistantType)}>
                    <SelectTrigger id="assistant-type" data-testid="select-assistant-type">
                      <SelectValue placeholder="Select assistant type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prompt">Prompt</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Active</p>
                    <p className="text-xs text-muted-foreground">Make assistant available to users</p>
                  </div>
                  <Switch
                    checked={assistantForm.isActive}
                    onCheckedChange={(checked) =>
                      setAssistantForm((current) => ({ ...current, isActive: checked }))
                    }
                    data-testid="switch-assistant-active"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Sub-agent</p>
                    <p className="text-xs text-muted-foreground">Internal agent called via triggers — hidden from chat selector</p>
                  </div>
                  <Switch
                    checked={assistantForm.isSubAgent}
                    onCheckedChange={(checked) =>
                      setAssistantForm((current) => ({ ...current, isSubAgent: checked }))
                    }
                    data-testid="switch-assistant-subagent"
                  />
                </div>
              </div>

              {/* Output Template */}
              <div className="space-y-2">
                <Label htmlFor="assistant-output-template">Output template (optional)</Label>
                <Select
                  value={assistantForm.outputTemplateId || 'none'}
                  onValueChange={(value) =>
                    setAssistantForm((current) => ({ ...current, outputTemplateId: value === 'none' ? '' : value }))
                  }
                >
                  <SelectTrigger id="assistant-output-template" data-testid="select-assistant-output-template">
                    <SelectValue placeholder="No template — free-form output" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template — free-form output</SelectItem>
                    {outputTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">When set, this agent will follow the selected template structure for all responses.</p>
              </div>

              {assistantForm.type === 'prompt' ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="assistant-prompt">Assistant prompt</Label>
                    <Textarea
                      id="assistant-prompt"
                      placeholder="Define the assistant's personality, expertise, and response style..."
                      value={assistantForm.promptContent}
                      onChange={(e) => setAssistantForm((current) => ({ ...current, promptContent: e.target.value }))}
                      rows={6}
                      className="resize-none font-mono text-xs"
                      data-testid="input-assistant-prompt"
                    />
                  </div>

                  {/* Agent Settings */}
                  <div className="space-y-4 rounded-lg border p-4">
                    <p className="text-sm font-medium">Agent Settings</p>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Max iterations: {assistantForm.maxIterations}</Label>
                        <Slider
                          min={1}
                          max={50}
                          step={1}
                          value={[assistantForm.maxIterations]}
                          onValueChange={([v]) => setAssistantForm(c => ({ ...c, maxIterations: v }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Maximum tool-calling rounds per message (default: 10)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Temperature: {assistantForm.temperature.toFixed(1)}</Label>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={[assistantForm.temperature]}
                          onValueChange={([v]) => setAssistantForm(c => ({ ...c, temperature: Math.round(v * 10) / 10 }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Response creativity (default: 0.7)
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Tools */}
                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Enabled Tools</p>
                      <p className="text-xs text-muted-foreground">
                        Leave all unchecked to enable every tool. Check specific tools to restrict this agent.
                      </p>
                    </div>
                    {availableTools.length > 0 ? (() => {
                      const toolMap = new Map(availableTools.map(t => [t.name, t]));
                      const mcpGroups: Record<string, typeof availableTools> = {};
                      for (const t of availableTools.filter(t => t.name.startsWith('mcp_'))) {
                        const sid = t.name.split('_')[1];
                        if (!mcpGroups[sid]) mcpGroups[sid] = [];
                        mcpGroups[sid].push(t);
                      }
                      const accountedFor = new Set(BUILTIN_GROUPS.flatMap(g => g.toolNames));
                      const ungrouped = availableTools.filter(t => !t.name.startsWith('mcp_') && !accountedFor.has(t.name));

                      const renderToolItem = (tool: { name: string; description: string }) => {
                        const isChecked = assistantForm.enabledTools.includes(tool.name);
                        const displayName = tool.name.startsWith('mcp_')
                          ? tool.name.split('_').slice(2).join(' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          : tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return (
                          <label key={tool.name} className="flex items-center gap-2 rounded-lg p-2 border hover:bg-muted/50 cursor-pointer">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(checked) => {
                                setAssistantForm(c => ({
                                  ...c,
                                  enabledTools: checked
                                    ? [...c.enabledTools, tool.name]
                                    : c.enabledTools.filter(t => t !== tool.name),
                                }));
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium">{displayName}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{tool.description?.replace(/^\[.*?\]\s*/, '') ?? ''}</p>
                            </div>
                          </label>
                        );
                      };

                      const renderGroup = (key: string, label: string, tools: { name: string; description: string }[]) => {
                        if (tools.length === 0) return null;
                        const isExpanded = expandedToolGroups.has(key);
                        const checkedCount = tools.filter(t => assistantForm.enabledTools.includes(t.name)).length;
                        const toggle = () => setExpandedToolGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                        return (
                          <div key={key} className="border rounded-lg overflow-hidden">
                            <button type="button" className="flex items-center gap-2 w-full text-left px-3 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors" onClick={toggle}>
                              <span className="text-sm font-medium flex-1">{label}</span>
                              {checkedCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">{checkedCount} selected</span>
                              )}
                              <span className="text-xs text-muted-foreground">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-1" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
                            </button>
                            {isExpanded && (
                              <div className="p-3 grid gap-2 sm:grid-cols-2">
                                {tools.map(renderToolItem)}
                              </div>
                            )}
                          </div>
                        );
                      };

                      return (
                        <div className="space-y-2">
                          {BUILTIN_GROUPS.map(g => renderGroup(
                            `builtin-${g.label}`,
                            g.label,
                            g.toolNames.map(n => toolMap.get(n)).filter(Boolean) as typeof availableTools,
                          ))}
                          {ungrouped.length > 0 && renderGroup('builtin-other', 'Other', ungrouped)}
                          {Object.entries(mcpGroups).map(([sid, tools]) =>
                            renderGroup(`mcp-${sid}`, mcpServerNames[sid] ?? sid, tools)
                          )}
                        </div>
                      );
                    })() : (
                      <p className="text-xs text-muted-foreground">Loading tools...</p>
                    )}
                  </div>

                  {/* Skills */}
                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Skills</p>
                        <p className="text-xs text-muted-foreground">
                          Specialized prompt blocks injected into this agent's system prompt.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => setAssistantForm(c => ({ ...c, skills: [...c.skills, createEmptySkill()] }))}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Skill
                      </Button>
                    </div>
                    {assistantForm.skills.map((skill, idx) => (
                      <div key={skill.id} className="space-y-3 rounded-lg border bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="grid flex-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Skill name</Label>
                              <Input
                                placeholder="e.g., Web Researcher"
                                value={skill.name}
                                onChange={(e) => {
                                  const updated = [...assistantForm.skills];
                                  updated[idx] = { ...updated[idx], name: e.target.value };
                                  setAssistantForm(c => ({ ...c, skills: updated }));
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Description</Label>
                              <Input
                                placeholder="Brief description"
                                value={skill.description}
                                onChange={(e) => {
                                  const updated = [...assistantForm.skills];
                                  updated[idx] = { ...updated[idx], description: e.target.value };
                                  setAssistantForm(c => ({ ...c, skills: updated }));
                                }}
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setAssistantForm(c => ({
                              ...c,
                              skills: c.skills.filter((_, i) => i !== idx),
                            }))}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Instructions</Label>
                          <Textarea
                            placeholder="Full prompt instructions for this skill..."
                            value={skill.instructions}
                            onChange={(e) => {
                              const updated = [...assistantForm.skills];
                              updated[idx] = { ...updated[idx], instructions: e.target.value };
                              setAssistantForm(c => ({ ...c, skills: updated }));
                            }}
                            rows={3}
                            className="resize-none font-mono text-xs"
                          />
                        </div>
                        {availableTools.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs">Linked tools</Label>
                            <div className="flex flex-wrap gap-2">
                              {availableTools.map((tool) => (
                                <label key={tool.name} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={skill.tools.includes(tool.name)}
                                    onCheckedChange={(checked) => {
                                      const updated = [...assistantForm.skills];
                                      updated[idx] = {
                                        ...updated[idx],
                                        tools: checked
                                          ? [...updated[idx].tools, tool.name]
                                          : updated[idx].tools.filter(t => t !== tool.name),
                                      };
                                      setAssistantForm(c => ({ ...c, skills: updated }));
                                    }}
                                  />
                                  {tool.name}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {assistantForm.skills.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        No skills added. Click "Add Skill" to create one.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="assistant-workflow">n8n workflow</Label>
                    <Select
                      value={selectedWorkflow ? selectedWorkflow.id : ''}
                      onValueChange={handleWorkflowSelect}
                      disabled={workflowsQuery.isLoading || workflowsQuery.isFetching || workflows.length === 0}
                    >
                      <SelectTrigger id="assistant-workflow" data-testid="select-assistant-workflow">
                        <SelectValue placeholder={workflowsQuery.isLoading ? 'Loading workflows...' : 'Select workflow'} />
                      </SelectTrigger>
                      <SelectContent>
                        {workflows.map((workflow) => (
                          <SelectItem key={workflow.id} value={workflow.id}>
                            {workflow.name || workflow.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {workflowsQuery.error && (
                      <p className="text-xs text-destructive">
                        {workflowsQuery.error instanceof Error
                          ? workflowsQuery.error.message
                          : 'Unable to load workflows. Ensure the n8n integration is configured.'}
                      </p>
                    )}
                    {workflowsQuery.data?.baseUrl && (
                      <p className="text-xs text-muted-foreground">
                        Connected to: {workflowsQuery.data.baseUrl}
                      </p>
                    )}
                    {workflows.length === 0 && !workflowsQuery.isLoading && !workflowsQuery.error && (
                      <p className="text-xs text-muted-foreground">
                        No workflows detected yet. Configure the n8n integration and refresh this page.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="assistant-workflow-id">Workflow ID</Label>
                      <Input
                        id="assistant-workflow-id"
                        type="text"
                        placeholder="n8n workflow identifier"
                        value={assistantForm.workflowId}
                        onChange={(e) => setAssistantForm((current) => ({ ...current, workflowId: e.target.value }))}
                        data-testid="input-assistant-workflow-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="assistant-webhook">Webhook URL</Label>
                      <Input
                        id="assistant-webhook"
                        type="url"
                        placeholder="https://n8n.example.com/webhook/..."
                        value={assistantForm.webhookUrl}
                        onChange={(e) => setAssistantForm((current) => ({ ...current, webhookUrl: e.target.value }))}
                        data-testid="input-assistant-webhook"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Metadata preview</Label>
                    <p className="text-xs text-muted-foreground">
                      Stored with the assistant for auditability. Pulled from n8n when a workflow is selected.
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                      {assistantForm.metadata
                        ? JSON.stringify(assistantForm.metadata, null, 2)
                        : 'No metadata available yet.'}
                    </pre>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {editingAssistantId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAssistantForm(createEmptyAssistantForm());
                      setEditingAssistantId(null);
                    }}
                    data-testid="button-cancel-assistant"
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={assistantCreateMutation.isPending || assistantUpdateMutation.isPending}
                  className="gap-2"
                  data-testid={editingAssistantId ? 'button-update-assistant' : 'button-create-assistant'}
                >
                  {assistantCreateMutation.isPending || assistantUpdateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {editingAssistantId ? 'Update assistant' : 'Create assistant'}
                </Button>
              </div>
            </div>

            <Separator />

            {assistantsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : assistants.length > 0 ? (
              <div className="space-y-3">
                {assistants.map((assistant) => {
                  const isDeleting = deletingAssistantId === assistant.id && assistantDeleteMutation.isPending;
                  const assistantMetadata = assistant.metadata as Record<string, unknown> | null;

                  return (
                    <div
                      key={assistant.id}
                      className="space-y-3 rounded-lg border bg-card p-3"
                      data-testid={`assistant-${assistant.id}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1 flex-1">
                          <p className="text-sm font-medium leading-none">{assistant.name}</p>
                          {assistant.description && (
                            <p className="text-xs text-muted-foreground">{assistant.description}</p>
                          )}
                          {assistant.type === 'prompt' ? (
                            <p className="text-xs text-muted-foreground font-mono line-clamp-2">
                              {assistant.promptContent ?? 'No prompt configured.'}
                            </p>
                          ) : (
                            <div className="space-y-1 text-xs text-muted-foreground">
                              {assistant.workflowId && (
                                <div className="flex items-center gap-2">
                                  <Workflow className="h-3 w-3" />
                                  <span className="font-medium text-foreground">{assistant.workflowId}</span>
                                </div>
                              )}
                              {assistant.webhookUrl && (
                                <div className="flex items-center gap-2">
                                  <LinkIcon className="h-3 w-3" />
                                  <a
                                    href={assistant.webhookUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate text-primary hover:underline"
                                  >
                                    {assistant.webhookUrl}
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                          {assistant.type === 'webhook' && assistantMetadata && (
                            <pre className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground">
                              {JSON.stringify(assistantMetadata, null, 2)}
                            </pre>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{assistant.type === 'webhook' ? 'Webhook' : 'Prompt'}</Badge>
                          {(assistantMetadata as Record<string, unknown>)?.isSubAgent && (
                            <Badge variant="secondary" className="text-[10px]">Sub-agent</Badge>
                          )}
                          {(assistantMetadata as Record<string, unknown>)?.outputTemplateId && (() => {
                            const tpl = outputTemplates.find(t => t.id === (assistantMetadata as Record<string, unknown>).outputTemplateId);
                            return tpl ? <Badge variant="outline" className="text-[10px]">Template: {tpl.name}</Badge> : null;
                          })()}
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={assistant.isActive}
                              onCheckedChange={(checked) =>
                                assistantStatusMutation.mutate({ id: assistant.id, isActive: checked })
                              }
                              disabled={
                                assistantStatusMutation.isPending && statusUpdatingId === assistant.id
                              }
                              data-testid={`switch-assistant-active-${assistant.id}`}
                              aria-label={`Toggle assistant ${assistant.name} status`}
                            />
                            <Badge variant={assistant.isActive ? 'default' : 'secondary'}>
                              {assistant.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => {
                            const meta = assistantMetadata ?? {};
                            const enabledTools = Array.isArray(meta.enabledTools) ? (meta.enabledTools as string[]) : [];
                            const skills = Array.isArray(meta.skills)
                              ? (meta.skills as SkillFormEntry[]).map(s => ({
                                  id: s.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                  name: s.name || '',
                                  description: s.description || '',
                                  instructions: s.instructions || '',
                                  tools: Array.isArray(s.tools) ? s.tools : [],
                                }))
                              : [];
                            const agentConf = (meta.agentConfig ?? {}) as Record<string, unknown>;
                            setAssistantForm({
                              type: assistant.type,
                              name: assistant.name,
                              description: assistant.description ?? '',
                              promptContent: assistant.promptContent ?? '',
                              workflowId: assistant.workflowId ?? '',
                              webhookUrl: assistant.webhookUrl ?? '',
                              metadata: assistantMetadata ?? null,
                              isActive: assistant.isActive,
                              isSubAgent: Boolean(meta.isSubAgent),
                              outputTemplateId: typeof meta.outputTemplateId === 'string' ? meta.outputTemplateId : '',
                              enabledTools,
                              skills,
                              maxIterations: typeof agentConf.maxIterations === 'number' ? agentConf.maxIterations : 10,
                              temperature: typeof agentConf.temperature === 'number' ? agentConf.temperature : 0.7,
                            });
                            setEditingAssistantId(assistant.id);
                          }}
                          data-testid={`button-edit-assistant-${assistant.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive hover:text-destructive"
                          disabled={isDeleting}
                          onClick={() => assistantDeleteMutation.mutate(assistant.id)}
                          data-testid={`button-delete-assistant-${assistant.id}`}
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                <Bot className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No assistants created yet</p>
                  <p className="text-xs text-muted-foreground">
                    Start by creating a prompt or webhook-based assistant above.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
