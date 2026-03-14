import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Plus, Trash2, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import type { TriggerRule } from '@shared/schema';
import { useBranding } from '@/hooks/useBranding';

interface AvailableTool {
  name: string;
  description: string;
}

const EMPTY_RULE: Omit<TriggerRule, 'id'> = {
  name: '',
  enabled: true,
  phrases: [],
  matchMode: 'contains',
  priority: 50,
  routeType: 'tool',
  routeTarget: '',
};

export default function TriggerRulesPage() {
  const { setHeader, resetHeader } = useAdminLayout();
  const { agentName } = useBranding();
  const { settings, draft, setDraft, isLoading, isError, isSaving, handleSave, hasChanges } =
    useAdminSettings();

  const [phrasesText, setPhrasesText] = useState('');
  const [newRule, setNewRule] = useState<Omit<TriggerRule, 'id'>>(EMPTY_RULE);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const routeMeta = getAdminRouteById('trigger-rules' as any);

  useEffect(() => {
    setHeader({
      title: routeMeta?.pageHeader?.title ?? 'Trigger Rules',
      description: routeMeta?.pageHeader?.description,
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, routeMeta]);

  const { data: toolsData } = useQuery<{ tools: AvailableTool[] }>({
    queryKey: ['/api/admin/available-tools'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/available-tools');
      return res.json();
    },
  });

  const availableTools = toolsData?.tools ?? [];
  const availableSkills = useMemo(
    () => (settings?.skills ?? []).map(s => ({ id: s.id, name: s.name })),
    [settings?.skills],
  );

  const rules: TriggerRule[] = useMemo(
    () => [...(draft?.triggerRules ?? [])].sort((a, b) => b.priority - a.priority),
    [draft?.triggerRules],
  );

  const updateRules = useCallback(
    (updater: (prev: TriggerRule[]) => TriggerRule[]) => {
      setDraft(prev => {
        if (!prev) return prev;
        return { ...prev, triggerRules: updater(prev.triggerRules ?? []) };
      });
    },
    [setDraft],
  );

  const handleAddRule = useCallback(() => {
    const phrases = phrasesText
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);
    if (!newRule.name.trim() || !newRule.routeTarget || phrases.length === 0) return;

    const rule: TriggerRule = {
      ...newRule,
      id: `trigger-${Date.now()}`,
      phrases,
    };

    updateRules(prev => [...prev, rule]);
    setNewRule(EMPTY_RULE);
    setPhrasesText('');
    setShowAddForm(false);
  }, [newRule, phrasesText, updateRules]);

  const handleDeleteRule = useCallback(
    (id: string) => {
      updateRules(prev => prev.filter(r => r.id !== id));
    },
    [updateRules],
  );

  const handleToggleRule = useCallback(
    (id: string) => {
      updateRules(prev =>
        prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
      );
    },
    [updateRules],
  );

  const handleUpdateRule = useCallback(
    (id: string, updates: Partial<TriggerRule>) => {
      updateRules(prev =>
        prev.map(r => (r.id === id ? { ...r, ...updates } : r)),
      );
    },
    [updateRules],
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return <AdminSettingsErrorState />;
  }

  return (
    <div className="space-y-6">
      {/* Save bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-sm">
          <span className="text-sm text-muted-foreground">You have unsaved changes.</span>
          <Button onClick={() => handleSave()} disabled={isSaving} size="sm">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      )}

      {/* Section header with Add button */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Map phrases to tools and skills for deterministic routing.
        </p>
        {!showAddForm && (
          <Button onClick={() => setShowAddForm(true)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            Add Trigger Rule
          </Button>
        )}
      </div>

      {/* Add Rule Form (shows above rules list) */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              New Trigger Rule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={newRule.name}
                  onChange={e => setNewRule(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Image Generation"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority (0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={newRule.priority}
                  onChange={e => setNewRule(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Match Mode</Label>
                <Select
                  value={newRule.matchMode}
                  onValueChange={v => setNewRule(prev => ({ ...prev, matchMode: v as 'exact' | 'contains' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="exact">Exact Match</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Route Type</Label>
                <Select
                  value={newRule.routeType}
                  onValueChange={v => setNewRule(prev => ({ ...prev, routeType: v as 'skill' | 'tool', routeTarget: '' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tool">Tool</SelectItem>
                    <SelectItem value="skill">Skill</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Route Target</Label>
              <Select
                value={newRule.routeTarget}
                onValueChange={v => setNewRule(prev => ({ ...prev, routeTarget: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select target..." /></SelectTrigger>
                <SelectContent>
                  {newRule.routeType === 'tool'
                    ? availableTools.map(t => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))
                    : availableSkills.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Trigger Phrases (one per line)</Label>
              <Textarea
                rows={4}
                value={phrasesText}
                onChange={e => setPhrasesText(e.target.value)}
                placeholder="create an image&#10;make a picture&#10;generate a photo"
              />
            </div>
            <div className="space-y-2">
              <Label>Custom Hint (optional)</Label>
              <Textarea
                rows={2}
                value={newRule.hintMessage ?? ''}
                onChange={e => setNewRule(prev => ({ ...prev, hintMessage: e.target.value || undefined }))}
                placeholder="Override the default system hint sent to the agent..."
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddRule} disabled={!newRule.name.trim() || !newRule.routeTarget || !phrasesText.trim()}>
                <Plus className="mr-2 h-4 w-4" /> Add Rule
              </Button>
              <Button variant="outline" onClick={() => { setShowAddForm(false); setNewRule(EMPTY_RULE); setPhrasesText(''); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules list */}
      <div className="space-y-3">
        {rules.length === 0 && !showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No trigger rules configured</CardTitle>
              <CardDescription>
                Add trigger rules to ensure {agentName} reliably routes specific phrases to the correct tool or skill.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {rules.map(rule => {
          const isExpanded = expandedRuleId === rule.id;
          return (
            <Card key={rule.id} className={!rule.enabled ? 'opacity-60' : ''}>
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggleRule(rule.id)}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{rule.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {rule.matchMode}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          P{rule.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {rule.routeType === 'tool' ? 'Tool' : 'Skill'}: {rule.routeTarget}
                        {' \u2022 '}
                        {rule.phrases.length} phrase{rule.phrases.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedRuleId(isExpanded ? null : rule.id)}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="pt-0 pb-4 px-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={rule.name}
                        onChange={e => handleUpdateRule(rule.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Priority (0-100)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={rule.priority}
                        onChange={e => handleUpdateRule(rule.id, { priority: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Match Mode</Label>
                      <Select
                        value={rule.matchMode}
                        onValueChange={v => handleUpdateRule(rule.id, { matchMode: v as 'exact' | 'contains' })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">Contains</SelectItem>
                          <SelectItem value="exact">Exact Match</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Route Type</Label>
                      <Select
                        value={rule.routeType}
                        onValueChange={v => handleUpdateRule(rule.id, { routeType: v as 'skill' | 'tool', routeTarget: '' })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tool">Tool</SelectItem>
                          <SelectItem value="skill">Skill</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Route Target</Label>
                    <Select
                      value={rule.routeTarget}
                      onValueChange={v => handleUpdateRule(rule.id, { routeTarget: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select target..." /></SelectTrigger>
                      <SelectContent>
                        {rule.routeType === 'tool'
                          ? availableTools.map(t => (
                              <SelectItem key={t.name} value={t.name}>
                                {t.name}
                              </SelectItem>
                            ))
                          : availableSkills.map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Trigger Phrases (one per line)</Label>
                    <Textarea
                      rows={4}
                      value={rule.phrases.join('\n')}
                      onChange={e =>
                        handleUpdateRule(rule.id, {
                          phrases: e.target.value
                            .split('\n')
                            .map(p => p.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="create an image&#10;make a picture&#10;generate a photo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Custom Hint (optional)</Label>
                    <Textarea
                      rows={2}
                      value={rule.hintMessage ?? ''}
                      onChange={e =>
                        handleUpdateRule(rule.id, {
                          hintMessage: e.target.value || undefined,
                        })
                      }
                      placeholder="Override the default system hint sent to the agent..."
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

    </div>
  );
}
