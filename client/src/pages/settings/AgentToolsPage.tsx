import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import { BUILTIN_TOOL_GROUPS } from '@/lib/tool-groups';

export default function AgentToolsPage() {
  const { draft, setDraft, isLoading, isSaving, handleSave, isError, refetch } = useAdminSettings();
  const { setHeader, resetHeader } = useAdminLayout();
  const route = getAdminRouteById('agent-tools');

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const availableToolsQuery = useQuery<{ tools: { name: string; description: string }[] }>({
    queryKey: ['available-tools'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/available-tools');
      return res.json();
    },
    staleTime: 300000,
  });
  const availableTools = availableToolsQuery.data?.tools ?? [];

  const enabledAgentTools: string[] = (draft as any)?.enabledAgentTools ?? [];
  const allToolsEnabled = enabledAgentTools.length === 0;

  const handleToolToggle = useCallback((toolName: string, enabled: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current) as any;
      const allNames = availableTools.map(t => t.name);
      const currentEnabled: string[] = next.enabledAgentTools ?? [];
      const isAllEnabled = currentEnabled.length === 0;

      if (isAllEnabled) {
        next.enabledAgentTools = enabled ? allNames : allNames.filter((n: string) => n !== toolName);
      } else {
        next.enabledAgentTools = enabled
          ? [...currentEnabled, toolName]
          : currentEnabled.filter((n: string) => n !== toolName);
      }

      if (next.enabledAgentTools.length === allNames.length) {
        next.enabledAgentTools = [];
      }
      return next;
    });
  }, [setDraft, availableTools]);

  const headerActions = draft ? (
    <Button onClick={() => { void handleSave(); }} disabled={isSaving} className="gap-2">
      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      Save changes
    </Button>
  ) : null;

  useEffect(() => {
    setHeader({
      title: route.pageHeader?.title ?? 'Agent Tools',
      description: route.pageHeader?.description,
      ...(headerActions ? { actions: headerActions } : {}),
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, headerActions]);

  if (isError) {
    return (
      <AdminSettingsErrorState
        title="Couldn't load tool settings."
        description="Please check your connection and try again."
        onRetry={refetch}
        testId="admin-settings-error-state-agent-tools"
      />
    );
  }

  if (isLoading || !draft || availableToolsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toolMap = new Map(availableTools.map(t => [t.name, t]));

  const mcpServers: Record<string, string> = {};
  for (const s of (draft as any)?.mcpServers ?? []) mcpServers[s.id] = s.name;
  const mcpGroups: Record<string, typeof availableTools> = {};
  for (const t of availableTools.filter(t => t.name.startsWith('mcp_'))) {
    const serverId = t.name.split('_')[1];
    if (!mcpGroups[serverId]) mcpGroups[serverId] = [];
    mcpGroups[serverId].push(t);
  }

  const accountedFor = new Set(BUILTIN_TOOL_GROUPS.flatMap(g => g.toolNames));
  const ungroupedTools = availableTools.filter(t => !t.name.startsWith('mcp_') && !accountedFor.has(t.name));

  const renderToolItem = (tool: { name: string; description: string }) => {
    const isEnabled = allToolsEnabled || enabledAgentTools.includes(tool.name);
    const displayName = tool.name.startsWith('mcp_')
      ? tool.name.split('_').slice(2).join(' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return (
      <div key={tool.name} className={`flex items-center justify-between rounded-lg p-3 border ${isEnabled ? 'bg-card' : 'bg-muted/30 opacity-60'}`}>
        <div className="min-w-0 flex-1 mr-3">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{tool.description?.replace(/^\[.*?\]\s*/, '') ?? ''}</p>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => handleToolToggle(tool.name, checked)}
          className="flex-shrink-0"
        />
      </div>
    );
  };

  const renderGroup = (key: string, label: string, tools: { name: string; description: string }[]) => {
    if (tools.length === 0) return null;
    const isExpanded = expandedGroups.has(key);
    const enabledCount = tools.filter(t => allToolsEnabled || enabledAgentTools.includes(t.name)).length;
    const toggle = () => setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    return (
      <div key={key} className="border rounded-lg overflow-hidden">
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left px-3 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
          onClick={toggle}
        >
          <span className="text-sm font-medium flex-1">{label}</span>
          <span className="text-xs text-muted-foreground">
            {enabledCount}/{tools.length} enabled
          </span>
          {isExpanded
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-1" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
        </button>
        {isExpanded && (
          <div className="overflow-x-auto">
            <div className="p-3 grid gap-2 sm:grid-cols-2 min-w-[480px] sm:min-w-0">
              {tools.map(renderToolItem)}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Card>
          <CardContent className="pt-4 space-y-2">
            {BUILTIN_TOOL_GROUPS.map(g => renderGroup(
              `builtin-${g.label}`,
              g.label,
              g.toolNames.map(n => toolMap.get(n)).filter(Boolean) as typeof availableTools,
            ))}
            {ungroupedTools.length > 0 && renderGroup('builtin-other', 'Other', ungroupedTools)}
            {Object.entries(mcpGroups).map(([serverId, tools]) =>
              renderGroup(`mcp-${serverId}`, mcpServers[serverId] ?? serverId, tools)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
