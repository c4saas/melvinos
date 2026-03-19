import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Globe, BookOpen, Mic2, Check, Send, ChevronDown, ChevronUp, Settings2, Presentation, Plus, Trash2, Calendar, RefreshCw, Video, VideoOff, Unlink } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import type { IntegrationSettings } from '@shared/schema';
import { useBranding } from '@/hooks/useBranding';
import { useUserTimezone } from '@/hooks/useUserTimezone';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/dateUtils';

// ── Integration card configs ──────────────────────────────────────────────────

interface IntegrationDef {
  key: keyof IntegrationSettings;
  name: string;
  description: string;
  Icon: React.ElementType;
  fields: Array<{
    fieldKey: string;
    label: string;
    placeholder: string;
    type?: string;
  }>;
  docsUrl?: string;
}

const getIntegrations = (agentName: string): IntegrationDef[] => [
  {
    key: 'google',
    name: 'Google (OAuth)',
    description: 'Enable Google Drive, Gmail, and Calendar access for your users. Create an OAuth 2.0 app in Google Cloud Console and paste the credentials below.',
    Icon: Globe,
    fields: [
      { fieldKey: 'clientId', label: 'Client ID', placeholder: 'xxxxxxxx.apps.googleusercontent.com' },
      { fieldKey: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
    ],
  },
  {
    key: 'notion',
    name: 'Notion',
    description: `Connect your Notion workspace to let ${agentName} read and write pages and databases. Create an internal integration at notion.so/my-integrations.`,
    Icon: BookOpen,
    fields: [
      { fieldKey: 'integrationToken', label: 'Integration Token', placeholder: 'secret_...', type: 'password' },
    ],
  },
  {
    key: 'recall',
    name: 'Recall AI',
    description: 'Enable meeting transcription and recall capabilities via Recall AI. Get your API key at recall.ai.',
    Icon: Mic2,
    fields: [
      { fieldKey: 'apiKey', label: 'API Key', placeholder: 'recall_...', type: 'password' },
      { fieldKey: 'region', label: 'Region', placeholder: 'us-west-2 (default)' },
      { fieldKey: 'meetingsDatabaseId', label: 'Notion Meetings Database ID', placeholder: 'Notion DB ID for meeting notes (optional)' },
    ],
  },
  {
    key: 'telegram',
    name: 'Telegram Bot',
    description: `Connect ${agentName} to Telegram. Create a bot via @BotFather, paste the token below, and enable.`,
    Icon: Send,
    fields: [
      { fieldKey: 'botToken', label: 'Bot Token', placeholder: '123456789:ABCdef...', type: 'password' },
      { fieldKey: 'allowedUserIds', label: 'Allowed User IDs (optional)', placeholder: '123456789, 987654321' },
      { fieldKey: 'model', label: 'Model (optional)', placeholder: 'e.g. claude-sonnet-4-6 (blank = default)' },
    ],
  },
  {
    key: 'gamma',
    name: 'Gamma',
    description: 'Generate AI-powered presentations, documents, and webpages with Gamma. Get your API key at gamma.app → Settings → API.',
    Icon: Presentation,
    fields: [
      { fieldKey: 'apiKey', label: 'API Key', placeholder: 'sk-gamma-...', type: 'password' },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

function TelegramBotStatus() {
  const { data } = useQuery<{ status: string; error: string | null; botUsername: string | null }>({
    queryKey: ['telegram-bot-status'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/telegram/status');
      return res.json();
    },
    refetchInterval: 5000,
  });

  if (!data) return null;

  const isRunning = data.status === 'running';
  const isError = data.status === 'error';

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          isRunning ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-yellow-500'
        }`}
      />
      <span className="text-muted-foreground">
        {isRunning && data.botUsername
          ? <>Bot running as <span className="font-medium text-foreground">@{data.botUsername}</span></>
          : isError
            ? <>Bot error: {data.error || 'Unknown'}</>
            : <>Bot {data.status}</>}
      </span>
    </div>
  );
}

function RecallPanel() {
  const queryClient = useQueryClient();

  const { data: billingData, isLoading: billingLoading } = useQuery<{ usage: Record<string, unknown> }>({
    queryKey: ['recall-billing'],
    queryFn: async () => { const r = await apiRequest('GET', '/api/integrations/recall/billing'); return r.json(); },
    staleTime: 60000,
  });

  const { data: calendarData, isLoading: calendarLoading, refetch: refetchCalendars } = useQuery<{ calendars: any[] }>({
    queryKey: ['recall-calendars'],
    queryFn: async () => { const r = await apiRequest('GET', '/api/integrations/recall/calendar'); return r.json(); },
  });

  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<{ events: any[] }>({
    queryKey: ['recall-events'],
    queryFn: async () => { const r = await apiRequest('GET', '/api/integrations/recall/calendar/events?limit=15'); return r.json(); },
    staleTime: 30000,
  });

  const calendars = calendarData?.calendars ?? [];
  const events = eventsData?.events ?? [];
  const usage = billingData?.usage;

  const connectMutation = useMutation({
    mutationFn: async (platform: string) => {
      const r = await apiRequest('POST', '/api/integrations/recall/calendar/connect', { platform });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed to connect'); }
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recall-calendars'] }); queryClient.invalidateQueries({ queryKey: ['recall-events'] }); },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (calendarId: string) => {
      const r = await apiRequest('DELETE', `/api/integrations/recall/calendar/${calendarId}`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed to disconnect'); }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recall-calendars'] }); queryClient.invalidateQueries({ queryKey: ['recall-events'] }); },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const r = await apiRequest('POST', `/api/integrations/recall/calendar/events/${eventId}/bot`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed to schedule'); }
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recall-events'] }),
  });

  const unscheduleMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const r = await apiRequest('DELETE', `/api/integrations/recall/calendar/events/${eventId}/bot`);
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed to unschedule'); }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recall-events'] }),
  });

  // Track which calendars have auto-join enabled locally — Recall's list endpoint
  // doesn't reliably return default_bot_config so we can't infer it from the response.
  const [autoJoinCalendars, setAutoJoinCalendars] = useState<Set<string>>(new Set());

  // Seed autoJoinCalendars from server data when calendars load (if field is present)
  const prevCalendarIds = useRef<string>('');
  useEffect(() => {
    if (!calendarData?.calendars) return;
    const ids = calendarData.calendars.map((c: any) => c.id).join(',');
    if (ids === prevCalendarIds.current) return;
    prevCalendarIds.current = ids;
    setAutoJoinCalendars(prev => {
      const next = new Set(prev);
      for (const cal of calendarData.calendars) {
        if (cal.default_bot_config) next.add(cal.id);
      }
      return next;
    });
  }, [calendarData]);

  const enableAutoJoinMutation = useMutation({
    mutationFn: async (calendarId: string) => {
      const r = await apiRequest('PATCH', `/api/integrations/recall/calendar/${calendarId}/auto-join`, { enabled: true });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed to enable auto-join'); }
      return r.json();
    },
    onSuccess: (_data, calendarId) => {
      setAutoJoinCalendars(prev => new Set([...prev, calendarId]));
      queryClient.invalidateQueries({ queryKey: ['recall-events'] });
    },
  });

  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = async (platform: string) => {
    setConnectError(null);
    try { await connectMutation.mutateAsync(platform); }
    catch (e: any) { setConnectError(e.message); }
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Billing */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usage This Period</p>
        {billingLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
        ) : usage ? (
          <div className="flex flex-wrap gap-4 rounded-lg bg-muted/40 px-3 py-2 text-xs">
            {usage.bot_minutes !== undefined && (
              <div>
                <span className="text-muted-foreground">Bot minutes used</span>
                <p className="font-medium">{String(usage.bot_minutes)}{usage.bot_minutes_limit ? ` / ${usage.bot_minutes_limit}` : ''}</p>
              </div>
            )}
            {usage.bot_hours !== undefined && (
              <div>
                <span className="text-muted-foreground">Bot hours used</span>
                <p className="font-medium">{String(usage.bot_hours)}{usage.bot_hours_limit ? ` / ${usage.bot_hours_limit}` : ''}</p>
              </div>
            )}
            {usage.billing_period_start && (
              <div>
                <span className="text-muted-foreground">Period</span>
                <p className="font-medium">
                  {fmtDate(String(usage.billing_period_start), userTz)} –{' '}
                  {usage.billing_period_end ? fmtDate(String(usage.billing_period_end), userTz) : '…'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Unable to load billing data.</p>
        )}
      </div>

      {/* Calendar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected Calendars</p>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { refetchCalendars(); refetchEvents(); }}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {calendarLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
        ) : calendars.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {calendars.map((cal: any) => {
              const hasAutoJoin = autoJoinCalendars.has(cal.id) || Boolean(cal.default_bot_config);
              return (
                <div key={cal.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium capitalize">{cal.platform?.replace('_calendar', '') ?? cal.platform}</p>
                      {cal.email && <p className="text-[10px] text-muted-foreground">{cal.email}</p>}
                    </div>
                    <Badge variant="default" className="bg-green-600 text-[10px] px-1.5 py-0">connected</Badge>
                    {hasAutoJoin
                      ? <Badge variant="default" className="bg-blue-600 text-[10px] px-1.5 py-0 gap-1"><Video className="h-2.5 w-2.5" />auto-join on</Badge>
                      : (
                        <Button
                          variant="outline" size="sm" className="h-5 px-1.5 text-[10px] gap-1"
                          disabled={enableAutoJoinMutation.isPending}
                          onClick={() => enableAutoJoinMutation.mutate(cal.id)}
                          title="Enable automatic bot joining for all meetings"
                        >
                          {enableAutoJoinMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Video className="h-2.5 w-2.5" />}
                          Enable auto-join
                        </Button>
                      )
                    }
                  </div>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    disabled={disconnectMutation.isPending}
                    onClick={() => disconnectMutation.mutate(cal.id)}
                    title="Disconnect calendar"
                  >
                    <Unlink className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No calendars connected. Connect one below to enable auto-join.</p>
        )}

        {connectError && <p className="text-xs text-destructive">{connectError}</p>}

        <Button
          variant="outline" size="sm" className="gap-1.5 text-xs h-8"
          disabled={connectMutation.isPending}
          onClick={() => handleConnect('google')}
        >
          {connectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Connect Google Calendar
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Uses your connected Google account. Make sure Google is connected in your profile first.
        </p>
      </div>

      {/* Upcoming events */}
      {calendars.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming Events</p>
          {eventsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No upcoming events found.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {events.map((evt: any) => {
                const hasMeetingUrl = Boolean(evt.meeting_url);
                const isScheduled = Boolean(evt.bot_scheduled || evt.bot?.id);
                const isMutating =
                  (scheduleMutation.isPending || unscheduleMutation.isPending);
                return (
                  <div key={evt.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-xs font-medium truncate">{evt.summary || 'Untitled Event'}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {evt.start_time ? fmtDateTime(evt.start_time, userTz) : '—'}
                        {evt.end_time ? ` – ${fmtTime(evt.end_time, userTz)}` : ''}
                      </p>
                      {hasMeetingUrl && (
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{evt.meeting_url}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!hasMeetingUrl ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">no video link</Badge>
                      ) : isScheduled ? (
                        <>
                          <Badge variant="default" className="bg-green-600 text-[10px] px-1.5 py-0 gap-1">
                            <Video className="h-2.5 w-2.5" /> auto-join on
                          </Badge>
                          <Button
                            variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground"
                            disabled={isMutating}
                            onClick={() => unscheduleMutation.mutate(evt.id)}
                            title="Turn off auto-join"
                          >
                            <VideoOff className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                          disabled={isMutating}
                          onClick={() => scheduleMutation.mutate(evt.id)}
                        >
                          {isMutating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Video className="h-2.5 w-2.5" />}
                          Auto-join
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  const { draft, setDraft, isLoading, isSaving, handleSave, isError, refetch } = useAdminSettings();
  const { agentName } = useBranding();
  const { setHeader, resetHeader } = useAdminLayout();
  const userTz = useUserTimezone();
  const route = getAdminRouteById('integrations');
  const [expandedIntegrations, setExpandedIntegrations] = useState<Set<string>>(new Set());
  const [addingGoogleApp, setAddingGoogleApp] = useState(false);
  const [newGoogleApp, setNewGoogleApp] = useState({ label: '', clientId: '', clientSecret: '' });
  const headerTitle = route.pageHeader?.title ?? route.label;
  const headerDescription = route.pageHeader?.description;

  // Per-user OAuth connection status
  const { data: connectionsData } = useQuery<{ connections: { userId: string; provider: string; createdAt: string }[] }>({
    queryKey: ['admin-integrations-connections'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/integrations/connections');
      return res.json();
    },
  });
  const connections = connectionsData?.connections ?? [];

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleIntegrationToggle = useCallback((key: keyof IntegrationSettings, enabled: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      (next.integrations as Record<string, Record<string, unknown>>)[key as string].enabled = enabled;
      return next;
    });
  }, [setDraft]);

  const handleIntegrationField = useCallback(
    (key: keyof IntegrationSettings, fieldKey: string, value: string) => {
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        (next.integrations as Record<string, Record<string, unknown>>)[key as string][fieldKey] = value || null;
        return next;
      });
    },
    [setDraft],
  );

  const handleAddGoogleApp = useCallback(() => {
    if (!newGoogleApp.label.trim() || !newGoogleApp.clientId.trim() || !newGoogleApp.clientSecret.trim()) return;
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const g = (next.integrations as any).google;
      g.additionalApps = [...(g.additionalApps ?? []), { ...newGoogleApp }];
      return next;
    });
    setNewGoogleApp({ label: '', clientId: '', clientSecret: '' });
    setAddingGoogleApp(false);
  }, [newGoogleApp, setDraft]);

  const handleRemoveGoogleApp = useCallback((index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const g = (next.integrations as any).google;
      g.additionalApps = (g.additionalApps ?? []).filter((_: any, i: number) => i !== index);
      return next;
    });
  }, [setDraft]);

  const handleGoogleAppField = useCallback((index: number, fieldKey: string, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const g = (next.integrations as any).google;
      g.additionalApps[index][fieldKey] = value;
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
        data-testid="button-save-integrations"
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
        testId="admin-settings-error-state-integrations"
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

  const integrationSettings = draft.integrations ?? {};

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">

        {/* ── Integration config cards ── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Platform Connections</h2>
            <p className="text-sm text-muted-foreground">
              Configure OAuth credentials and API keys for platform-wide integrations. These settings apply to all users.
            </p>
          </div>
          <div className="space-y-4">
            {getIntegrations(agentName).map(({ key, name, description, Icon, fields }) => {
              const config = (integrationSettings as Record<string, Record<string, unknown>>)[key as string] ?? {};
              const isEnabled = Boolean(config.enabled);
              const isExpanded = expandedIntegrations.has(key as string);
              const toggleExpanded = () => setExpandedIntegrations(prev => {
                const next = new Set(prev);
                if (next.has(key as string)) next.delete(key as string);
                else next.add(key as string);
                return next;
              });

              return (
                <Card key={key} data-testid={`card-integration-${key}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                        <span>{name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => handleIntegrationToggle(key, checked)}
                          data-testid={`switch-integration-${key}-enabled`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-muted-foreground h-8 px-2"
                          onClick={toggleExpanded}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          Configure
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="space-y-4 pt-0">
                      {key === 'google' ? (
                        <>
                          {/* Primary credentials */}
                          <div className="space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default App</p>
                            {fields.map(({ fieldKey, label, placeholder, type = 'text' }) => (
                              <div key={fieldKey} className="grid gap-1.5">
                                <Label htmlFor={`${key}-${fieldKey}`} className="text-sm">{label}</Label>
                                <Input
                                  id={`${key}-${fieldKey}`}
                                  type={type}
                                  placeholder={placeholder}
                                  value={(config[fieldKey] as string | null) ?? ''}
                                  onChange={(e) => handleIntegrationField(key, fieldKey, e.target.value)}
                                />
                              </div>
                            ))}
                          </div>

                          {/* Additional apps */}
                          {((config.additionalApps as any[]) ?? []).length > 0 && (
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional Apps</p>
                              {((config.additionalApps as any[]) ?? []).map((app: any, idx: number) => (
                                <div key={idx} className="rounded-lg border p-3 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium">{app.label || `App ${idx + 1}`}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                      onClick={() => handleRemoveGoogleApp(idx)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label className="text-xs">Label</Label>
                                    <Input className="h-8 text-sm" value={app.label} onChange={(e) => handleGoogleAppField(idx, 'label', e.target.value)} placeholder="e.g. Agency Account" />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label className="text-xs">Client ID</Label>
                                    <Input className="h-8 text-sm" value={app.clientId} onChange={(e) => handleGoogleAppField(idx, 'clientId', e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label className="text-xs">Client Secret</Label>
                                    <Input className="h-8 text-sm" type="password" value={app.clientSecret} onChange={(e) => handleGoogleAppField(idx, 'clientSecret', e.target.value)} placeholder="GOCSPX-..." />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add app form */}
                          {addingGoogleApp ? (
                            <div className="rounded-lg border border-dashed p-3 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New App</p>
                              <div className="grid gap-1.5">
                                <Label className="text-xs">Label</Label>
                                <Input className="h-8 text-sm" value={newGoogleApp.label} onChange={(e) => setNewGoogleApp(v => ({ ...v, label: e.target.value }))} placeholder="e.g. Agency Account" autoFocus />
                              </div>
                              <div className="grid gap-1.5">
                                <Label className="text-xs">Client ID</Label>
                                <Input className="h-8 text-sm" value={newGoogleApp.clientId} onChange={(e) => setNewGoogleApp(v => ({ ...v, clientId: e.target.value }))} placeholder="xxxxxxxx.apps.googleusercontent.com" />
                              </div>
                              <div className="grid gap-1.5">
                                <Label className="text-xs">Client Secret</Label>
                                <Input className="h-8 text-sm" type="password" value={newGoogleApp.clientSecret} onChange={(e) => setNewGoogleApp(v => ({ ...v, clientSecret: e.target.value }))} placeholder="GOCSPX-..." />
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" className="h-7 text-xs gap-1" onClick={handleAddGoogleApp} disabled={!newGoogleApp.label.trim() || !newGoogleApp.clientId.trim() || !newGoogleApp.clientSecret.trim()}>
                                  <Check className="h-3 w-3" /> Add App
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddingGoogleApp(false); setNewGoogleApp({ label: '', clientId: '', clientSecret: '' }); }}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => setAddingGoogleApp(true)}>
                              <Plus className="h-3.5 w-3.5" /> Add Another OAuth App
                            </Button>
                          )}

                          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            <span className="font-medium">Redirect URI to set in Google Cloud:</span>{' '}
                            <code className="font-mono">{window.location.origin}/auth/google/callback</code>
                          </div>
                        </>
                      ) : (
                        <>
                          {fields.map(({ fieldKey, label, placeholder, type = 'text' }) => (
                            <div key={fieldKey} className="grid gap-1.5">
                              <Label htmlFor={`${key}-${fieldKey}`} className="text-sm">{label}</Label>
                              <Input
                                id={`${key}-${fieldKey}`}
                                type={type}
                                placeholder={placeholder}
                                value={(config[fieldKey] as string | null) ?? ''}
                                onChange={(e) => handleIntegrationField(key, fieldKey, e.target.value)}
                                data-testid={`input-integration-${key}-${fieldKey}`}
                              />
                            </div>
                          ))}
                          {key === 'telegram' && isEnabled && <TelegramBotStatus />}
                          {key === 'recall' && isEnabled && <RecallPanel />}
                        </>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        </section>

        {/* ── User connections ── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">User Connections</h2>
            <p className="text-sm text-muted-foreground">
              OAuth integrations connected by users across your workspace.
            </p>
          </div>
          <Card>
            <CardContent className="pt-4">
              {connections.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No users have connected any integrations yet.
                </p>
              ) : (
                <div className="divide-y">
                  {connections.map((conn, i) => (
                    <div key={i} className="flex items-center justify-between py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium font-mono">{conn.userId}</span>
                        <span className="text-xs text-muted-foreground">
                          Connected {conn.createdAt ? fmtDate(conn.createdAt, userTz) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize gap-1">
                          <Check className="h-3 w-3 text-green-500" />
                          {conn.provider}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
