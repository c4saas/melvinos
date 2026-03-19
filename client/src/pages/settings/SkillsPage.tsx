import { useMemo, useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Plus, Trash2, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import type { SkillDefinition, SkillCategory } from '@shared/schema';
import { useBranding } from '@/hooks/useBranding';
import { BUILTIN_TOOL_GROUPS } from '@/lib/tool-groups';

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  productivity: 'Productivity',
  research: 'Research',
  coding: 'Coding',
  communication: 'Communication',
  memory: 'Memory',
  general: 'General',
};

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  productivity: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  research: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  coding: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  communication: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  memory: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  general: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
};

// BUILTIN_TOOL_GROUPS imported from @/lib/tool-groups — used for linked-tool picker

const blankSkill = (): Omit<SkillDefinition, 'id'> & { linkedTools: string[]; type: string; instructions: string } => ({
  name: '',
  description: '',
  category: 'general',
  icon: '',
  enabled: true,
  requiresIntegration: null,
  isPlatformDefault: false,
  linkedTools: [],
  type: 'prompt-injection',
  instructions: '',
});

export default function SkillsPage() {
  const { draft, setDraft, isLoading, isSaving, handleSave, isError, refetch } = useAdminSettings();
  const { agentName } = useBranding();
  const { setHeader, resetHeader } = useAdminLayout();
  const route = getAdminRouteById('skills');
  const headerTitle = route.pageHeader?.title ?? route.label;
  const headerDescription = route.pageHeader?.description;

  const [isAdding, setIsAdding] = useState(false);
  const [newSkill, setNewSkill] = useState(blankSkill);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<SkillCategory>>(
    new Set(Object.keys(CATEGORY_LABELS) as SkillCategory[])
  );
  // Per-skill linked-tool group expand state; key format: '<skillId>:<groupLabel>'
  const [expandedSkillToolGroups, setExpandedSkillToolGroups] = useState<Set<string>>(new Set());

  // Fetch available built-in tools
  const availableToolsQuery = useQuery<{ tools: { name: string; description: string }[] }>({
    queryKey: ['available-tools'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/available-tools');
      return response.json();
    },
    staleTime: 300000,
  });
  const availableTools = availableToolsQuery.data?.tools ?? [];

  const skills = draft?.skills ?? [];

  // Group skills by category
  const grouped = useMemo(() => {
    const map: Partial<Record<SkillCategory, SkillDefinition[]>> = {};
    for (const skill of skills) {
      if (!map[skill.category]) map[skill.category] = [];
      map[skill.category]!.push(skill);
    }
    return map;
  }, [skills]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleToggleSkill = useCallback((id: string, enabled: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const idx = next.skills.findIndex((s) => s.id === id);
      if (idx !== -1) next.skills[idx].enabled = enabled;
      return next;
    });
  }, [setDraft]);

  const handleDeleteSkill = useCallback((id: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      next.skills = next.skills.filter((s) => s.id !== id);
      return next;
    });
  }, [setDraft]);

  const handleAddSkill = useCallback(() => {
    if (!newSkill.name.trim()) return;
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const id = `skill-${Date.now()}`;
      const skill = { id, ...newSkill } as any;
      // Ensure prompt-injection skills without instructions are flagged info instead
      if (skill.type === 'prompt-injection' && !skill.instructions?.trim()) {
        skill.type = 'info';
      }
      next.skills = [...next.skills, skill];
      return next;
    });
    setNewSkill(blankSkill());
    setIsAdding(false);
  }, [newSkill, setDraft]);

  const handleLinkedToolToggle = useCallback((skillId: string, toolName: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const idx = next.skills.findIndex((s) => s.id === skillId);
      if (idx === -1) return current;
      const skill = next.skills[idx] as any;
      const linked: string[] = skill.linkedTools ?? [];
      skill.linkedTools = linked.includes(toolName)
        ? linked.filter((t: string) => t !== toolName)
        : [...linked, toolName];
      return next;
    });
  }, [setDraft]);


  // ── Save / header ──────────────────────────────────────────────────────────

  const hasLoadedDraft = Boolean(draft);

  const headerActions = useMemo(() => {
    if (!hasLoadedDraft) return null;
    return (
      <Button
        onClick={() => { void handleSave(); }}
        disabled={isSaving}
        className="gap-2 whitespace-nowrap sm:w-auto"
        data-testid="button-save-skills"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save changes
      </Button>
    );
  }, [hasLoadedDraft, handleSave, isSaving]);

  useEffect(() => {
    setHeader({
      title: headerTitle,
      description: headerDescription,
      ...(headerActions ? { actions: headerActions } : {}),
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, headerActions, headerTitle, headerDescription]);

  // ── Loading / error ────────────────────────────────────────────────────────

  if (isError) {
    return (
      <AdminSettingsErrorState
        title={`We couldn't load ${headerTitle} settings.`}
        description="Please check your connection and try again."
        onRetry={refetch}
        testId="admin-settings-error-state-skills"
      />
    );
  }

  if (isLoading || !draft) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">

        {/* ── Skill groups by category ── */}
        {(Object.keys(CATEGORY_LABELS) as SkillCategory[]).map((category) => {
          const categorySkills = grouped[category];
          if (!categorySkills?.length) return null;
          const isCollapsed = collapsedCategories.has(category);
          const toggleCategory = () => setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
          });
          return (
            <section key={category} className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 w-full text-left group"
                onClick={toggleCategory}
              >
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CATEGORY_COLORS[category]}`}>
                  {CATEGORY_LABELS[category]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {categorySkills.length} skill{categorySkills.length !== 1 ? 's' : ''}
                </span>
                {isCollapsed
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                  : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto" />}
              </button>
              {!isCollapsed && (
                <div className="space-y-2">
                  {categorySkills.map((skill) => (
                  <Card key={skill.id} className={!skill.enabled ? 'opacity-60' : ''}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{skill.name}</p>
                            {(skill as any).type && (skill as any).type !== 'info' && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {(skill as any).type}
                              </Badge>
                            )}
                            {skill.isPlatformDefault && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">built-in</Badge>
                            )}
                            {skill.requiresIntegration && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                needs {skill.requiresIntegration}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={skill.enabled}
                            onCheckedChange={(checked) => handleToggleSkill(skill.id, checked)}
                            data-testid={`switch-skill-${skill.id}-enabled`}
                          />
                          {!skill.isPlatformDefault && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteSkill(skill.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {availableTools.length > 0 && (() => {
                        const linked = ((skill as any).linkedTools as string[] | undefined) ?? [];
                        const toolMap = new Map(availableTools.map(t => [t.name, t]));
                        // MCP groups from connected servers
                        const mcpServers: Record<string, string> = {};
                        for (const s of (draft as any)?.mcpServers ?? []) mcpServers[s.id] = s.name;
                        const mcpGroupMap: Record<string, string[]> = {};
                        for (const t of availableTools.filter(t => t.name.startsWith('mcp_'))) {
                          const sid = t.name.split('_')[1];
                          if (!mcpGroupMap[sid]) mcpGroupMap[sid] = [];
                          mcpGroupMap[sid].push(t.name);
                        }
                        const accountedFor = new Set(BUILTIN_TOOL_GROUPS.flatMap(g => g.toolNames));
                        const ungrouped = availableTools.filter(t => !t.name.startsWith('mcp_') && !accountedFor.has(t.name));

                        const allGroups: { key: string; label: string; toolNames: string[] }[] = [
                          ...BUILTIN_TOOL_GROUPS.map(g => ({ key: `${skill.id}:${g.label}`, label: g.label, toolNames: g.toolNames.filter(n => toolMap.has(n)) })),
                          ...(ungrouped.length > 0 ? [{ key: `${skill.id}:Other`, label: 'Other', toolNames: ungrouped.map(t => t.name) }] : []),
                          ...Object.entries(mcpGroupMap).map(([sid, names]) => ({ key: `${skill.id}:mcp-${sid}`, label: mcpServers[sid] ?? sid, toolNames: names })),
                        ].filter(g => g.toolNames.length > 0);

                        const renderTag = (toolName: string) => {
                          const isLinked = linked.includes(toolName);
                          const displayName = toolName.startsWith('mcp_')
                            ? toolName.split('_').slice(2).join(' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                            : toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          return (
                            <button
                              key={toolName}
                              type="button"
                              onClick={() => handleLinkedToolToggle(skill.id, toolName)}
                              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                                isLinked
                                  ? 'bg-primary/10 border-primary/40 text-primary'
                                  : 'bg-muted/30 border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:border-border'
                              }`}
                              title={`${isLinked ? 'Remove' : 'Add'} ${toolName}`}
                            >
                              {displayName}
                            </button>
                          );
                        };

                        return (
                          <div className="mt-3 space-y-1">
                            {allGroups.map(group => {
                              const isExpanded = expandedSkillToolGroups.has(group.key);
                              const linkedCount = group.toolNames.filter(n => linked.includes(n)).length;
                              return (
                                <div key={group.key} className="rounded-md border overflow-hidden">
                                  <button
                                    type="button"
                                    className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors"
                                    onClick={() => setExpandedSkillToolGroups(prev => {
                                      const next = new Set(prev);
                                      if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                                      return next;
                                    })}
                                  >
                                    <span className="text-[11px] font-medium flex-1 text-foreground/80">{group.label}</span>
                                    {linkedCount > 0 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                                        {linkedCount} linked
                                      </span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground">{group.toolNames.length}</span>
                                    {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                                  </button>
                                  {isExpanded && (
                                    <div className="px-2.5 py-2 flex flex-wrap gap-1 bg-background">
                                      {group.toolNames.map(renderTag)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {skills.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Zap className="mx-auto mb-2 h-5 w-5 opacity-40" />
            No skills configured yet. Add your first skill below.
          </div>
        )}

        {/* ── Add custom skill ── */}
        {!isAdding ? (
          <Button variant="outline" className="gap-2 self-start" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4" />
            Add custom skill
          </Button>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New custom skill</CardTitle>
              <CardDescription>Define a custom capability for {agentName} to offer users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. HubSpot CRM"
                    value={newSkill.name}
                    onChange={(e) => setNewSkill((s) => ({ ...s, name: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select
                    value={newSkill.category}
                    onValueChange={(v) => setNewSkill((s) => ({ ...s, category: v as SkillCategory }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(CATEGORY_LABELS) as [SkillCategory, string][]).map(([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    placeholder="Describe what this skill does for users..."
                    rows={2}
                    value={newSkill.description}
                    onChange={(e) => setNewSkill((s) => ({ ...s, description: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={(newSkill as any).type ?? 'prompt-injection'}
                    onValueChange={(v) => setNewSkill((s) => ({ ...s, type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prompt-injection">Prompt Injection (active behavior)</SelectItem>
                      <SelectItem value="info">Info (capability label only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Requires integration (optional)</Label>
                  <Input
                    placeholder="e.g. google, notion, recall"
                    value={newSkill.requiresIntegration ?? ''}
                    onChange={(e) => setNewSkill((s) => ({ ...s, requiresIntegration: e.target.value || null }))}
                  />
                </div>
                {(newSkill as any).type === 'prompt-injection' && (
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label className="text-xs">Instructions <span className="text-destructive">*</span></Label>
                    <Textarea
                      placeholder="Write the instructions injected into the system prompt. Describe exactly how the agent should behave when this skill is active..."
                      rows={6}
                      value={(newSkill as any).instructions ?? ''}
                      onChange={(e) => setNewSkill((s) => ({ ...s, instructions: e.target.value }))}
                    />
                    <p className="text-[10px] text-muted-foreground">These instructions are injected into the system prompt on every conversation when this skill is enabled.</p>
                  </div>
                )}
                {availableTools.length > 0 && (
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label className="text-xs">Linked tools</Label>
                    <div className="flex flex-wrap gap-1">
                      {availableTools.map((tool) => {
                        const isLinked = newSkill.linkedTools?.includes(tool.name) ?? false;
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onClick={() => setNewSkill((s) => ({
                              ...s,
                              linkedTools: isLinked
                                ? (s.linkedTools ?? []).filter((t) => t !== tool.name)
                                : [...(s.linkedTools ?? []), tool.name],
                            }))}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                              isLinked
                                ? 'bg-primary/10 border-primary/40 text-primary'
                                : 'bg-muted/30 border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:border-border'
                            }`}
                          >
                            {tool.name.startsWith('mcp_')
                              ? (() => { const p = tool.name.split('_'); return p.slice(2).join(' \u2014 ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); })()
                              : tool.name.replace(/_/g, ' ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={handleAddSkill}
                  disabled={!newSkill.name.trim()}
                >
                  <Plus className="h-4 w-4" />
                  Add skill
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setIsAdding(false); setNewSkill(blankSkill()); }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
