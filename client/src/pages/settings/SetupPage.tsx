import { useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { getAdminRouteById } from '@shared/adminRoutes';

interface HealthResponse {
  status: string;
  uptime: number;
  memoryUsage?: { rss: number; heapUsed: number; heapTotal: number };
  registeredTools?: string[];
  toolCount?: number;
  error?: string;
}

interface CheckItem {
  label: string;
  description: string;
  configured: boolean;
  configPath: string;
}

export default function SetupPage() {
  const [, setLocation] = useLocation();
  const { setHeader, resetHeader } = useAdminLayout();
  const { settings, isLoading: settingsLoading } = useAdminSettings();

  const { data: health, isLoading: healthLoading } = useQuery<HealthResponse>({
    queryKey: ['/api/health/heartbeat'],
    queryFn: async () => {
      const res = await fetch('/api/health/heartbeat');
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
    staleTime: 30000,
  });

  const routeMeta = getAdminRouteById('setup' as any);

  useEffect(() => {
    setHeader({
      title: routeMeta?.pageHeader?.title ?? 'Setup',
      description: routeMeta?.pageHeader?.description,
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, routeMeta]);

  const checks = useMemo<CheckItem[]>(() => {
    if (!settings) return [];

    const providers = settings.apiProviders ?? {};
    const hasLlmKey = Object.values(providers).some(
      (p: any) => p?.apiKey || p?.defaultApiKey,
    );

    const imageProviders = settings.imageProviders ?? {};
    const hasImageProvider = Object.values(imageProviders).some(
      (p: any) => p?.enabled && p?.defaultApiKey,
    );

    const ttsProviders = settings.ttsProviders ?? {};
    const hasTtsProvider = Object.values(ttsProviders).some(
      (p: any) => p?.enabled && p?.defaultApiKey,
    );

    const sttProviders = settings.sttProviders ?? {};
    const hasSttProvider = Object.values(sttProviders).some(
      (p: any) => p?.enabled && p?.defaultApiKey,
    );

    const integrations = settings.integrations ?? {};
    const hasGoogleIntegration = !!(integrations as any)?.google?.clientId;
    const hasNotionIntegration = !!(integrations as any)?.notion?.integrationToken
      || !!(settings.apiProviders?.notion as any)?.defaultApiKey;

    return [
      {
        label: 'LLM Provider',
        description: 'At least one AI model provider (Anthropic, OpenAI, etc.) is configured with an API key.',
        configured: hasLlmKey,
        configPath: '/settings/api-access',
      },
      {
        label: 'Image Generation',
        description: 'An image provider (e.g. DALL-E) is enabled with an API key for image generation.',
        configured: hasImageProvider,
        configPath: '/settings/api-access',
      },
      {
        label: 'Text-to-Speech',
        description: 'A TTS provider is enabled for voice output.',
        configured: hasTtsProvider,
        configPath: '/settings/api-access',
      },
      {
        label: 'Speech-to-Text',
        description: 'An STT provider is enabled for voice input transcription.',
        configured: hasSttProvider,
        configPath: '/settings/api-access',
      },
      {
        label: 'Google Integration',
        description: 'Google OAuth is configured for Gmail, Calendar, and Drive access.',
        configured: hasGoogleIntegration,
        configPath: '/settings/integrations',
      },
      {
        label: 'Notion Integration',
        description: 'Notion API key is set for workspace access.',
        configured: hasNotionIntegration,
        configPath: '/settings/integrations',
      },
    ];
  }, [settings]);

  const configuredCount = checks.filter((c) => c.configured).length;
  const totalCount = checks.length;
  const isLoading = settingsLoading || healthLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Health */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            System Health
            {health?.status === 'ok' ? (
              <Badge variant="default" className="bg-green-600">Healthy</Badge>
            ) : (
              <Badge variant="destructive">Degraded</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {health?.status === 'ok'
              ? `System running for ${formatUptime(health.uptime)}. ${health.toolCount ?? 0} tools registered.`
              : health?.error ?? 'Unable to reach health endpoint.'}
          </CardDescription>
        </CardHeader>
        {health?.status === 'ok' && health.memoryUsage && (
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">RSS Memory</span>
                <p className="font-medium">{health.memoryUsage.rss.toFixed(0)} MB</p>
              </div>
              <div>
                <span className="text-muted-foreground">Heap Used</span>
                <p className="font-medium">{health.memoryUsage.heapUsed.toFixed(0)} MB</p>
              </div>
              <div>
                <span className="text-muted-foreground">Heap Total</span>
                <p className="font-medium">{health.memoryUsage.heapTotal.toFixed(0)} MB</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Readiness Checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Readiness Checklist</CardTitle>
          <CardDescription>
            {configuredCount} of {totalCount} items configured.
            {configuredCount === totalCount
              ? ' All essential services are ready.'
              : ' Configure the remaining items to unlock full functionality.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {check.configured ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="text-xs text-muted-foreground">{check.description}</p>
                  </div>
                </div>
                {!check.configured && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLocation(check.configPath)}
                  >
                    Configure <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
