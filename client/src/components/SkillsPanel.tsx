/**
 * SkillsPanel — quick-access right-side sheet for toggling platform skills
 * and built-in agent tools without leaving the chat.
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Wrench, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useBranding } from '@/hooks/useBranding';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import type { PlatformSettingsData, SkillDefinition, SkillCategory } from '@shared/schema';

// ── Types ────────────────────────────────────────────────────────────────────

interface AvailableTool {
  name: string;
  description: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  productivity: 'Productivity',
  research: 'Research',
  coding: 'Coding',
  communication: 'Communication',
  memory: 'Memory',
  general: 'General',
};

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  productivity: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  research:     'bg-purple-500/10 text-purple-400 border-purple-500/20',
  coding:       'bg-green-500/10 text-green-400 border-green-500/20',
  communication:'bg-orange-500/10 text-orange-400 border-orange-500/20',
  memory:       'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  general:      'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

const CATEGORY_ORDER: SkillCategory[] = [
  'productivity', 'communication', 'research', 'coding', 'memory', 'general',
];

// ── Main component ────────────────────────────────────────────────────────────

interface SkillsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SkillsPanel({ open, onClose }: SkillsPanelProps) {
  const { agentName } = useBranding();
  const queryClient = useQueryClient();

  // Track which sections are expanded (default: skills expanded, tools collapsed)
  const [toolsExpanded, setToolsExpanded] = useState(false);
  // Track optimistic in-flight saves per item key
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: settingsData, isLoading: settingsLoading } = useQuery<{ settings: { data: PlatformSettingsData } }>({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/settings');
      return res.json();
    },
    enabled: open,
  });

  const { data: toolsData, isLoading: toolsLoading } = useQuery<{ tools: AvailableTool[] }>({
    queryKey: ['available-tools'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/available-tools');
      return res.json();
    },
    enabled: open && toolsExpanded,
    staleTime: 300_000,
  });

  const settings = settingsData?.settings?.data;
  const skills: SkillDefinition[] = settings?.skills ?? [];
  const enabledAgentTools: string[] = settings?.enabledAgentTools ?? [];
  const availableTools: AvailableTool[] = toolsData?.tools ?? [];
  const allToolsEnabled = enabledAgentTools.length === 0;

  // ── Save mutation ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<PlatformSettingsData>) => {
      if (!settings) throw new Error('Settings not loaded');
      const payload = { ...settings, ...patch };
      const res = await apiRequest('PUT', '/api/admin/settings', payload);
      if (!res.ok) throw new Error('Save failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
  });

  // ── Skill toggle ───────────────────────────────────────────────────────────

  const handleSkillToggle = useCallback(async (id: string, enabled: boolean) => {
    if (!settings) return;
    const key = `skill-${id}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const updated = skills.map(s => s.id === id ? { ...s, enabled } : s);
      await saveMutation.mutateAsync({ skills: updated });
    } finally {
      setSaving(s => { const n = { ...s }; delete n[key]; return n; });
    }
  }, [settings, skills, saveMutation]);

  // ── Tool toggle ────────────────────────────────────────────────────────────

  const handleToolToggle = useCallback(async (toolName: string, enabled: boolean) => {
    if (!settings) return;
    const key = `tool-${toolName}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const allNames = availableTools.map(t => t.name);
      let next: string[];
      if (allToolsEnabled) {
        next = enabled ? allNames : allNames.filter(n => n !== toolName);
      } else {
        next = enabled
          ? [...enabledAgentTools, toolName]
          : enabledAgentTools.filter(n => n !== toolName);
      }
      // Reset to "all enabled" if every tool is on
      if (next.length === allNames.length) next = [];
      await saveMutation.mutateAsync({ enabledAgentTools: next });
    } finally {
      setSaving(s => { const n = { ...s }; delete n[key]; return n; });
    }
  }, [settings, availableTools, allToolsEnabled, enabledAgentTools, saveMutation]);

  // ── Computed stats ─────────────────────────────────────────────────────────

  const enabledSkillCount = skills.filter(s => s.enabled).length;
  const totalSkillCount = skills.length;
  const enabledToolCount = allToolsEnabled
    ? availableTools.length || '—'
    : enabledAgentTools.length;

  // ── Group skills by category ───────────────────────────────────────────────

  const grouped = CATEGORY_ORDER.reduce<Record<SkillCategory, SkillDefinition[]>>(
    (acc, cat) => {
      acc[cat] = skills.filter(s => s.category === cat);
      return acc;
    },
    {} as Record<SkillCategory, SkillDefinition[]>,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[340px] sm:w-[380px] flex flex-col gap-0 p-0 border-l border-border/60"
      >
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-primary" />
              Skills &amp; Tools
            </SheetTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Toggle what {agentName} can do. Changes save instantly.
          </p>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Skills section ── */}
          <section className="px-4 py-3 border-b border-border/40">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</span>
              </div>
              {totalSkillCount > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                  {enabledSkillCount}/{totalSkillCount} on
                </Badge>
              )}
            </div>

            {settingsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : totalSkillCount === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-xs text-muted-foreground">No skills configured.</p>
                <a
                  href="/settings/skills"
                  className="text-[11px] text-primary hover:underline mt-1 block"
                >
                  Add skills in Settings →
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {CATEGORY_ORDER.map((cat) => {
                  const catSkills = grouped[cat];
                  if (!catSkills?.length) return null;
                  return (
                    <div key={cat}>
                      <div className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold mb-1.5 border',
                        CATEGORY_COLORS[cat],
                      )}>
                        {CATEGORY_LABELS[cat]}
                      </div>
                      <div className="space-y-1">
                        {catSkills.map((skill) => {
                          const key = `skill-${skill.id}`;
                          const isSaving = !!saving[key];
                          return (
                            <div
                              key={skill.id}
                              className={cn(
                                'flex items-center justify-between gap-3 rounded-lg px-3 py-2 border transition-colors',
                                skill.enabled
                                  ? 'bg-card border-border/50'
                                  : 'bg-muted/20 border-border/30 opacity-60',
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{skill.name}</p>
                                {skill.description && (
                                  <p className="text-[11px] text-muted-foreground truncate leading-snug">
                                    {skill.description}
                                  </p>
                                )}
                                {skill.requiresIntegration && (
                                  <span className="text-[10px] text-amber-400/80">
                                    needs {skill.requiresIntegration}
                                  </span>
                                )}
                              </div>
                              {isSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                              ) : (
                                <Switch
                                  checked={skill.enabled}
                                  onCheckedChange={(checked) => handleSkillToggle(skill.id, checked)}
                                  className="flex-shrink-0 scale-90"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Tools section (collapsible) ── */}
          <section className="px-4 py-3">
            <button
              type="button"
              className="flex items-center justify-between w-full mb-2 group"
              onClick={() => setToolsExpanded(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground transition-colors">
                  Built-in Tools
                </span>
              </div>
              <div className="flex items-center gap-2">
                {availableTools.length > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                    {allToolsEnabled ? 'all on' : `${enabledToolCount} on`}
                  </Badge>
                )}
                {toolsExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </div>
            </button>

            {toolsExpanded && (
              toolsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-1">
                  {availableTools.map((tool) => {
                    const isEnabled = allToolsEnabled || enabledAgentTools.includes(tool.name);
                    const key = `tool-${tool.name}`;
                    const isSaving = !!saving[key];
                    return (
                      <div
                        key={tool.name}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-lg px-3 py-2 border transition-colors',
                          isEnabled
                            ? 'bg-card border-border/50'
                            : 'bg-muted/20 border-border/30 opacity-60',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {tool.name.startsWith('mcp_')
                              ? (() => {
                                  const parts = tool.name.split('_');
                                  return parts.slice(2).join(' \u2014 ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                })()
                              : tool.name.replace(/_/g, ' ')}
                          </p>
                          {tool.description && (
                            <p className="text-[11px] text-muted-foreground truncate leading-snug">
                              {tool.description.replace(/^\[.*?\]\s*/, '')}
                            </p>
                          )}
                        </div>
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                        ) : (
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => handleToolToggle(tool.name, checked)}
                            className="flex-shrink-0 scale-90"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {!toolsExpanded && !toolsLoading && availableTools.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Expand to manage individual tools.
              </p>
            )}
          </section>

        </div>

        {/* Footer: link to full settings */}
        <div className="px-4 py-2.5 border-t border-border/40 flex-shrink-0">
          <a
            href="/settings/skills"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Full skills &amp; tool settings →
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
