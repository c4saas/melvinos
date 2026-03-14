import { useMemo, useCallback, useEffect, useState } from 'react';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Volume2, Mic, ImageIcon, Video, Code2, Plus, Trash2, Bot, Shield, Brain, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_MODELS } from '@shared/schema';
import type { AIModel, ProviderSettings, MediaProviderSettings, CustomModel, ModelReasoningConfig } from '@shared/schema';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { useBranding } from '@/hooks/useBranding';

// ── Media provider section config ─────────────────────────────────────────────

type MediaSectionKey = 'ttsProviders' | 'sttProviders' | 'imageProviders' | 'videoProviders' | 'codingProviders';

interface MediaProviderDef {
  id: string;
  name: string;
  hasEndpoint?: boolean;
}

interface MediaSection {
  key: MediaSectionKey;
  title: string;
  description: string;
  Icon: React.ElementType;
  providers: MediaProviderDef[];
}

const MEDIA_SECTIONS: MediaSection[] = [
  {
    key: 'ttsProviders',
    title: 'Text-to-Speech (TTS)',
    description: 'Configure voice synthesis providers for audio responses.',
    Icon: Volume2,
    providers: [
      { id: 'openai-realtime', name: 'OpenAI Realtime Voice' },
      { id: 'openai-tts', name: 'OpenAI TTS' },
      { id: 'elevenlabs', name: 'ElevenLabs' },
    ],
  },
  {
    key: 'sttProviders',
    title: 'Speech-to-Text (STT)',
    description: 'Configure audio transcription providers.',
    Icon: Mic,
    providers: [
      { id: 'groq-whisper', name: 'Groq Whisper' },
      { id: 'openai-whisper', name: 'OpenAI Whisper' },
      { id: 'whisper-local', name: 'Whisper (Local/Open Source)', hasEndpoint: true },
    ],
  },
  {
    key: 'imageProviders',
    title: 'Image Generation',
    description: 'Configure image generation providers.',
    Icon: ImageIcon,
    providers: [
      { id: 'dalle', name: 'DALL-E (OpenAI)' },
      { id: 'nano-banana', name: 'Nano Banana' },
    ],
  },
  {
    key: 'videoProviders',
    title: 'Video Generation',
    description: 'Configure video generation providers.',
    Icon: Video,
    providers: [
      { id: 'veo', name: 'Veo 3.1 (Google)' },
      { id: 'sora', name: 'Sora (OpenAI)' },
    ],
  },
  {
    key: 'codingProviders',
    title: 'Coding Tools',
    description: 'Configure AI coding assistant providers.',
    Icon: Code2,
    providers: [
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'codex', name: 'OpenAI Codex' },
    ],
  },
];

const emptyMediaProvider = (): MediaProviderSettings => ({
  enabled: false,
  defaultApiKey: null,
  endpoint: null,
});

const ROUTING_KEY_MAP: Record<MediaSectionKey, string> = {
  ttsProviders: 'tts',
  sttProviders: 'stt',
  imageProviders: 'image',
  videoProviders: 'video',
  codingProviders: 'coding',
};

// ── Custom model blank form ───────────────────────────────────────────────────

const blankCustomModel = (): Omit<CustomModel, 'id'> => ({
  name: '',
  displayName: '',
  provider: '',
  endpoint: null,
});

// ── Component ─────────────────────────────────────────────────────────────────

export default function APIAccessPage() {
  const { draft, setDraft, isLoading, isSaving, handleSave, isError, refetch } = useAdminSettings();
  const { agentName } = useBranding();
  const { setHeader, resetHeader } = useAdminLayout();
  const route = getAdminRouteById('api-access');
  const headerTitle = route.pageHeader?.title ?? route.label;
  const headerDescription = route.pageHeader?.description;

  const [newModel, setNewModel] = useState<Omit<CustomModel, 'id'>>(blankCustomModel);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [modelDefaultsCollapsed, setModelDefaultsCollapsed] = useState(true);
  const [expandedMediaProviders, setExpandedMediaProviders] = useState<Set<string>>(new Set());

  // ── LLM provider helpers ───────────────────────────────────────────────────

  const providerModelMap = useMemo(() => {
    const groups: Record<string, AIModel[]> = {};
    for (const model of AI_MODELS) {
      const key = model.provider.toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, []);

  const orderedProviders = useMemo(() => {
    return ['anthropic', 'openai', 'groq', 'google', 'perplexity', 'ollama'] as const;
  }, []);

  const capabilityLabels: Partial<Record<string, string>> = {
    search: 'Search',
    code: 'Code',
    thinking: 'Reasoning',
    vision: 'Vision',
  };
  const highlightCapabilities = ['search', 'code', 'thinking'] as const;

  const sortProviderModelIds = useCallback((provider: string, ids: Set<string>) => {
    const knownOrder = (providerModelMap[provider] ?? []).map((model) => model.id);
    const sorted = knownOrder.filter((id) => ids.has(id));
    const extras = Array.from(ids).filter((id) => !knownOrder.includes(id));
    return [...sorted, ...extras];
  }, [providerModelMap]);

  const handleProviderUpdate = useCallback((provider: string, updater: (s: ProviderSettings) => ProviderSettings) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      next.apiProviders[provider] = updater(next.apiProviders[provider]);
      return next;
    });
  }, [setDraft]);

  const handleToggleProviderEnabled = useCallback((provider: string, checked: boolean) => {
    handleProviderUpdate(provider, (s) => ({ ...s, enabled: checked }));
  }, [handleProviderUpdate]);

  const handleApiKeyChange = useCallback((provider: string, value: string) => {
    handleProviderUpdate(provider, (s) => ({ ...s, defaultApiKey: value || null }));
  }, [handleProviderUpdate]);

  const handleDailyLimitChange = useCallback((provider: string, value: string) => {
    handleProviderUpdate(provider, (s) => {
      const parsed = value === '' ? null : parseInt(value, 10);
      return { ...s, dailyRequestLimit: isNaN(parsed as number) ? null : parsed };
    });
  }, [handleProviderUpdate]);

  const toggleProviderModel = useCallback((provider: string, modelId: string) => {
    handleProviderUpdate(provider, (s) => {
      const ids = new Set(s.allowedModels);
      ids.has(modelId) ? ids.delete(modelId) : ids.add(modelId);
      return { ...s, allowedModels: sortProviderModelIds(provider, ids) };
    });
  }, [handleProviderUpdate, sortProviderModelIds]);

  // ── Media provider helpers ─────────────────────────────────────────────────

  const handleMediaProviderUpdate = useCallback(
    (sectionKey: MediaSectionKey, providerId: string, updater: (s: MediaProviderSettings) => MediaProviderSettings) => {
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        const section = next[sectionKey] as Record<string, MediaProviderSettings>;
        section[providerId] = updater(section[providerId] ?? emptyMediaProvider());
        return next;
      });
    },
    [setDraft],
  );

  const handleMediaToggle = useCallback(
    (sectionKey: MediaSectionKey, providerId: string, checked: boolean) => {
      handleMediaProviderUpdate(sectionKey, providerId, (s) => ({ ...s, enabled: checked }));
    },
    [handleMediaProviderUpdate],
  );

  const handleMediaApiKey = useCallback(
    (sectionKey: MediaSectionKey, providerId: string, value: string) => {
      handleMediaProviderUpdate(sectionKey, providerId, (s) => ({ ...s, defaultApiKey: value || null }));
    },
    [handleMediaProviderUpdate],
  );

  const handleMediaEndpoint = useCallback(
    (sectionKey: MediaSectionKey, providerId: string, value: string) => {
      handleMediaProviderUpdate(sectionKey, providerId, (s) => ({ ...s, endpoint: value || null }));
    },
    [handleMediaProviderUpdate],
  );

  const handleRoutingChange = useCallback(
    (sectionKey: MediaSectionKey, field: 'defaultProvider' | 'fallbackProvider', value: string | null) => {
      const routingKey = ROUTING_KEY_MAP[sectionKey];
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        const routing = (next as any).mediaRouting ?? {};
        routing[routingKey] = {
          ...(routing[routingKey] ?? {}),
          [field]: value || null,
        };
        (next as any).mediaRouting = routing;
        return next;
      });
    },
    [setDraft],
  );

  // ── Custom model helpers ───────────────────────────────────────────────────

  const handleAddCustomModel = useCallback(() => {
    if (!newModel.name.trim() || !newModel.provider.trim()) return;
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const id = `custom-${Date.now()}`;
      next.customModels = [...(next.customModels ?? []), { id, ...newModel }];
      return next;
    });
    setNewModel(blankCustomModel());
  }, [newModel, setDraft]);

  const handleRemoveCustomModel = useCallback((id: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      next.customModels = (next.customModels ?? []).filter((m) => m.id !== id);
      return next;
    });
  }, [setDraft]);

  // ── Model reasoning config helpers ──────────────────────────────────────────

  const REASONING_LEVELS = [
    { value: 'off', label: 'Off' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
  ] as const;

  const handleModelConfigUpdate = useCallback((modelId: string, updater: (c: ModelReasoningConfig) => ModelReasoningConfig) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current) as any;
      if (!next.modelConfig) next.modelConfig = {};
      const existing: ModelReasoningConfig = next.modelConfig[modelId] ?? { reasoningLevel: 'medium', maxOutputTokens: null };
      next.modelConfig[modelId] = updater(existing);
      return next;
    });
  }, [setDraft]);

  const activeModels = useMemo(() => AI_MODELS.filter((m) => m.status !== 'legacy'), []);

  const formatContextWindow = (tokens?: number) => {
    if (!tokens) return '';
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M context`;
    return `${(tokens / 1000).toFixed(0)}K context`;
  };

  // ── Save / header ──────────────────────────────────────────────────────────

  const hasLoadedDraft = Boolean(draft);

  const headerActions = useMemo(() => {
    if (!hasLoadedDraft) return null;
    return (
      <Button
        onClick={() => { void handleSave(); }}
        disabled={isSaving}
        className="gap-2 whitespace-nowrap sm:w-auto"
        data-testid="button-save-api-access"
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

  // ── Loading / error states ─────────────────────────────────────────────────

  if (isError) {
    return (
      <AdminSettingsErrorState
        title={`We couldn't load ${headerTitle} settings.`}
        description="Please check your connection and try again."
        onRetry={refetch}
        testId="admin-settings-error-state-api-access"
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">

        {/* ── LLM Providers ── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">LLM Providers</h2>
            <p className="text-sm text-muted-foreground">Configure language model providers, API keys, and model access.</p>
          </div>
          <div className="space-y-6">
            {orderedProviders.map((provider) => {
              const config = draft.apiProviders[provider];
              if (!config) return null;
              const providerName = provider === 'openai' ? 'OpenAI'
                : provider === 'anthropic' ? 'Anthropic'
                : provider === 'groq' ? 'Groq'
                : provider === 'google' ? 'Google (Gemini)'
                : provider.charAt(0).toUpperCase() + provider.slice(1);

              const isExpanded = expandedProviders.has(provider);
              const toggleProvider = () => setExpandedProviders(prev => {
                const next = new Set(prev);
                if (next.has(provider)) next.delete(provider);
                else next.add(provider);
                return next;
              });

              return (
                <Card key={provider} data-testid={`card-api-provider-${provider}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span>{providerName}</span>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={(checked) => handleToggleProviderEnabled(provider, checked)}
                          data-testid={`switch-provider-${provider}-enabled`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-muted-foreground h-8 px-2"
                          onClick={toggleProvider}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          Configure
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription>
                      {config.allowedModels.length > 0
                        ? `${config.allowedModels.length} model${config.allowedModels.length !== 1 ? 's' : ''} enabled`
                        : 'No models enabled'}
                      {config.defaultApiKey ? ' · API key set' : ' · No API key'}
                    </CardDescription>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="space-y-6 pt-0">
                      <div className="grid gap-2">
                        <Label htmlFor={`${provider}-api-key`}>Default API key</Label>
                        <Input
                          id={`${provider}-api-key`}
                          type="password"
                          placeholder="Enter platform API key"
                          value={config.defaultApiKey ?? ''}
                          onChange={(e) => handleApiKeyChange(provider, e.target.value)}
                          data-testid={`input-provider-${provider}-api-key`}
                        />
                        <p className="text-xs text-muted-foreground">
                          API key used for all requests to this provider.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Allowed models</Label>
                          <span className="text-xs text-muted-foreground">Click to toggle</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(providerModelMap[provider] ?? []).map((model) => {
                            const isEnabled = config.allowedModels.includes(model.id);
                            const capabilitySummary = highlightCapabilities
                              .filter((cap) => model.capabilities.includes(cap))
                              .map((cap) => capabilityLabels[cap] ?? cap)
                              .join(' • ');
                            return (
                              <Button
                                key={model.id}
                                type="button"
                                variant={isEnabled ? 'default' : 'outline'}
                                size="sm"
                                className="h-auto rounded-full px-3 py-1.5 text-xs font-medium"
                                onClick={() => toggleProviderModel(provider, model.id)}
                                data-testid={`toggle-provider-${provider}-model-${model.id}`}
                              >
                                <div className="flex flex-col items-start gap-0">
                                  <span>{model.name}</span>
                                  {capabilitySummary && (
                                    <span className="text-[10px] font-normal text-muted-foreground">{capabilitySummary}</span>
                                  )}
                                </div>
                              </Button>
                            );
                          })}
                        </div>
                        {(providerModelMap[provider] ?? []).length === 0 && (
                          <p className="text-xs text-muted-foreground">No models catalogued for this provider yet.</p>
                        )}
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor={`${provider}-daily-limit`}>Daily request cap</Label>
                        <Input
                          id={`${provider}-daily-limit`}
                          type="number"
                          min={0}
                          placeholder="Leave blank for unlimited"
                          value={config.dailyRequestLimit ?? ''}
                          onChange={(e) => handleDailyLimitChange(provider, e.target.value)}
                          data-testid={`input-provider-${provider}-daily-limit`}
                        />
                        <p className="text-xs text-muted-foreground">
                          Maximum API requests per day across all users. Blank = unlimited.
                        </p>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        </section>

        {/* ── Default Model ── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Default Model</h2>
              <p className="text-sm text-muted-foreground">
                The model used for new chat conversations by default. Users can switch models per-chat.
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="pt-4">
              <Select
                value={(draft as any)?.defaultModel ?? ''}
                onValueChange={(value) => {
                  setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current) as any;
                    next.defaultModel = value === 'auto' ? null : (value || null);
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="Auto-detect (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect (default)</SelectItem>
                  {AI_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </section>

        {/* ── Fallback Model ── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Fallback Model</h2>
              <p className="text-sm text-muted-foreground">
                If the primary model fails (rate limit, quota, or server error), {agentName} will automatically retry with this model.
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="pt-4">
              <Select
                value={(draft as any)?.fallbackModel ?? ''}
                onValueChange={(value) => {
                  setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current) as any;
                    next.fallbackModel = value === 'none' ? null : (value || null);
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="No fallback (disabled)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No fallback (disabled)</SelectItem>
                  {AI_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </section>

        {/* ── Model Defaults (Reasoning & Output Limits) ── */}
        <section className="space-y-4">
          <button
            type="button"
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setModelDefaultsCollapsed(prev => !prev)}
          >
            <Brain className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Model Defaults</h2>
              <p className="text-sm text-muted-foreground">
                Set default reasoning levels and output token limits per model. These apply globally to all conversations.
              </p>
            </div>
            {modelDefaultsCollapsed
              ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              : <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>
          {!modelDefaultsCollapsed && (
          <div className="space-y-3">
            {activeModels.map((model) => {
              const hasThinking = model.capabilities.includes('thinking');
              const cfg: ModelReasoningConfig = (draft as any)?.modelConfig?.[model.id] ?? { reasoningLevel: hasThinking ? 'medium' : 'off', maxOutputTokens: null };
              return (
                <Card key={model.id} data-testid={`card-model-config-${model.id}`}>
                  <CardContent className="pt-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Model info */}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{model.name}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{model.provider}</span>
                          {model.maxTokens && (
                            <span className="text-[10px] text-muted-foreground">{formatContextWindow(model.maxTokens)}</span>
                          )}
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-4">
                        {/* Reasoning level */}
                        <div className="grid gap-1">
                          <Label className="text-[10px] text-muted-foreground">Reasoning</Label>
                          <Select
                            value={cfg.reasoningLevel}
                            disabled={!hasThinking}
                            onValueChange={(value) => {
                              handleModelConfigUpdate(model.id, (c) => ({
                                ...c,
                                reasoningLevel: value as ModelReasoningConfig['reasoningLevel'],
                              }));
                            }}
                          >
                            <SelectTrigger className="h-8 w-[100px] text-xs" data-testid={`select-model-reasoning-${model.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {REASONING_LEVELS.map((level) => (
                                <SelectItem key={level.value} value={level.value}>
                                  {level.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Max output tokens */}
                        <div className="grid gap-1">
                          <Label className="text-[10px] text-muted-foreground">Max output tokens</Label>
                          <Input
                            type="number"
                            min={256}
                            max={200000}
                            placeholder="Default"
                            className="h-8 w-[120px] text-xs"
                            value={cfg.maxOutputTokens ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              handleModelConfigUpdate(model.id, (c) => ({
                                ...c,
                                maxOutputTokens: val !== null && !isNaN(val) ? val : null,
                              }));
                            }}
                            data-testid={`input-model-max-tokens-${model.id}`}
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          )}
        </section>

        {/* ── Media Provider Sections ── */}
        {MEDIA_SECTIONS.map(({ key, title, description, Icon, providers }) => {
          const sectionData = (draft[key] ?? {}) as Record<string, MediaProviderSettings>;
          const routingKey = ROUTING_KEY_MAP[key];
          const routing = ((draft as any).mediaRouting ?? {})[routingKey] ?? {};
          return (
            <section key={key} className="space-y-4">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs font-medium">Default Provider</Label>
                  <Select
                    value={routing.defaultProvider ?? ''}
                    onValueChange={(v) => handleRoutingChange(key, 'defaultProvider', v || null)}
                  >
                    <SelectTrigger className="h-9" data-testid={`select-routing-${routingKey}-default`}>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs font-medium">Fallback Provider</Label>
                  <Select
                    value={routing.fallbackProvider ?? '_none'}
                    onValueChange={(v) => handleRoutingChange(key, 'fallbackProvider', v === '_none' ? null : v)}
                  >
                    <SelectTrigger className="h-9" data-testid={`select-routing-${routingKey}-fallback`}>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {providers.map(({ id, name, hasEndpoint }) => {
                  const config = sectionData[id] ?? emptyMediaProvider();
                  const provKey = `${key}-${id}`;
                  const isProvExpanded = expandedMediaProviders.has(provKey);
                  const toggleProv = () => setExpandedMediaProviders(prev => {
                    const next = new Set(prev);
                    if (next.has(provKey)) next.delete(provKey);
                    else next.add(provKey);
                    return next;
                  });
                  return (
                    <Card key={id} data-testid={`card-media-${key}-${id}`}>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center justify-between text-base">
                          <span>{name}</span>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={config.enabled}
                              onCheckedChange={(checked) => handleMediaToggle(key, id, checked)}
                              data-testid={`switch-media-${key}-${id}-enabled`}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 px-0 text-muted-foreground"
                              onClick={toggleProv}
                            >
                              {isProvExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      {isProvExpanded && (
                        <CardContent className="space-y-3 pt-0">
                          <div className="grid gap-1.5">
                            <Label htmlFor={`${key}-${id}-apikey`} className="text-xs">API Key</Label>
                            <Input
                              id={`${key}-${id}-apikey`}
                              type="password"
                              placeholder="Enter API key"
                              value={config.defaultApiKey ?? ''}
                              onChange={(e) => handleMediaApiKey(key, id, e.target.value)}
                              data-testid={`input-media-${key}-${id}-apikey`}
                            />
                          </div>
                          {hasEndpoint && (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`${key}-${id}-endpoint`} className="text-xs">Endpoint URL</Label>
                              <Input
                                id={`${key}-${id}-endpoint`}
                                type="url"
                                placeholder="http://localhost:8080"
                                value={config.endpoint ?? ''}
                                onChange={(e) => handleMediaEndpoint(key, id, e.target.value)}
                                data-testid={`input-media-${key}-${id}-endpoint`}
                              />
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* ── Custom Models ── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Custom Models</h2>
            <p className="text-sm text-muted-foreground">
              Add any model not listed above. Provide a model ID, display name, provider name, and optional endpoint.
            </p>
          </div>

          {/* Existing custom models */}
          {(draft.customModels ?? []).length > 0 && (
            <div className="space-y-2">
              {(draft.customModels ?? []).map((model) => (
                <div key={model.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{model.displayName || model.name}</span>
                    <span className="text-xs text-muted-foreground">{model.provider} · {model.name}</span>
                    {model.endpoint && (
                      <span className="text-xs text-muted-foreground truncate max-w-xs">{model.endpoint}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveCustomModel(model.id)}
                    data-testid={`btn-remove-custom-model-${model.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add new custom model form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add custom model</CardTitle>
              <CardDescription>Enter the model ID exactly as required by the provider's API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-model-id" className="text-xs">Model ID <span className="text-destructive">*</span></Label>
                  <Input
                    id="custom-model-id"
                    placeholder="e.g. meta-llama/llama-4-maverick"
                    value={newModel.name}
                    onChange={(e) => setNewModel((m) => ({ ...m, name: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-model-display" className="text-xs">Display name</Label>
                  <Input
                    id="custom-model-display"
                    placeholder="e.g. Llama 4 Maverick"
                    value={newModel.displayName}
                    onChange={(e) => setNewModel((m) => ({ ...m, displayName: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-model-provider" className="text-xs">Provider <span className="text-destructive">*</span></Label>
                  <Input
                    id="custom-model-provider"
                    placeholder="e.g. Together AI, Replicate, Ollama"
                    value={newModel.provider}
                    onChange={(e) => setNewModel((m) => ({ ...m, provider: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="custom-model-endpoint" className="text-xs">Endpoint URL (optional)</Label>
                  <Input
                    id="custom-model-endpoint"
                    type="url"
                    placeholder="https://api.together.ai/v1"
                    value={newModel.endpoint ?? ''}
                    onChange={(e) => setNewModel((m) => ({ ...m, endpoint: e.target.value || null }))}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={handleAddCustomModel}
                disabled={!newModel.name.trim() || !newModel.provider.trim()}
              >
                <Plus className="h-4 w-4" />
                Add model
              </Button>
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
