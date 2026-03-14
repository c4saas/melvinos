import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw, ArrowRight, Activity, Clock, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import { useBranding } from '@/hooks/useBranding';

interface HealthResponse {
  status: string;
  uptime: number;
  memoryUsage?: { rss: number; heapUsed: number; heapTotal: number };
  activeTaskCount?: number;
  lastAgentRunAt?: number | null;
  registeredTools?: string[];
  toolCount?: number;
  error?: string;
}

interface HeartbeatStatus {
  lastRunAt: string | null;
  nextRunAt: string | null;
  intervalMs: number | null;
  running: boolean;
}

interface KnowledgeSummary {
  knowledgeItems: number;
  memoryItems: number;
}

interface AgentTask {
  id: string;
  type: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  conversationId: string | null;
  startedAt: string | null;
  createdAt: string;
  error: string | null;
}

interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  recurring: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface ToolErrorLog {
  id: string;
  toolName: string;
  error: string;
  args: Record<string, unknown> | null;
  conversationId: string | null;
  createdAt: string;
}

export default function MonitoringPage() {
  const [, setLocation] = useLocation();
  const { agentName } = useBranding();
  const { setHeader, resetHeader } = useAdminLayout();
  const queryClient = useQueryClient();

  const routeMeta = getAdminRouteById('monitoring' as any);

  useEffect(() => {
    setHeader({
      title: routeMeta?.pageHeader?.title ?? 'Monitoring',
      description: routeMeta?.pageHeader?.description,
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, routeMeta]);

  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery<HealthResponse>({
    queryKey: ['/api/health/heartbeat'],
    queryFn: async () => {
      const res = await fetch('/api/health/heartbeat');
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: heartbeatStatus, isLoading: heartbeatLoading } = useQuery<HeartbeatStatus>({
    queryKey: ['/api/admin/heartbeat/status'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/heartbeat/status');
      return res.json();
    },
    staleTime: 15000,
  });

  const { data: knowledge, isLoading: knowledgeLoading } = useQuery<KnowledgeSummary>({
    queryKey: ['/api/admin/knowledge'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/knowledge');
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: activeTasks = [] } = useQuery<AgentTask[]>({
    queryKey: ['/api/agent/tasks/active'],
    queryFn: async () => {
      const [runningRes, pendingRes] = await Promise.all([
        apiRequest('GET', '/api/agent/tasks?status=running'),
        apiRequest('GET', '/api/agent/tasks?status=pending'),
      ]);
      const [running, pending] = await Promise.all([runningRes.json(), pendingRes.json()]);
      return [...(running.tasks ?? []), ...(pending.tasks ?? [])];
    },
    refetchInterval: 5000,
  });

  const { data: cronData, refetch: refetchCrons } = useQuery<{ jobs: CronJob[] }>({
    queryKey: ['/api/cron-jobs'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/cron-jobs');
      return res.json();
    },
    refetchInterval: 30000,
  });
  const cronJobs = cronData?.jobs ?? [];

  const deleteCronMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/cron-jobs/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/cron-jobs'] }),
  });

  const toggleCronMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await apiRequest('PATCH', `/api/cron-jobs/${id}`, { enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/cron-jobs'] }),
  });

  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  const { data: toolErrorData } = useQuery<{ errors: ToolErrorLog[] }>({
    queryKey: ['/api/admin/tool-errors'],
    queryFn: async () => (await apiRequest('GET', '/api/admin/tool-errors?limit=100')).json(),
    refetchInterval: 30000,
  });
  const toolErrors = toolErrorData?.errors ?? [];

  const clearErrorsMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/admin/tool-errors'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/admin/tool-errors'] }),
  });

  // Tick every second so durations update live
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (activeTasks.length > 0) {
      tickRef.current = setInterval(() => setTick(t => t + 1), 1000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeTasks.length]);

  const isLoading = healthLoading || heartbeatLoading || knowledgeLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              System Status
              {health?.status === 'ok' ? (
                <Badge variant="default" className="bg-green-600">Healthy</Badge>
              ) : (
                <Badge variant="destructive">Degraded</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {health?.status === 'ok'
                ? `Uptime: ${formatUptime(health.uptime)}`
                : health?.error ?? 'Unable to reach health endpoint.'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchHealth()}>
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </CardHeader>
        {health?.status === 'ok' && (
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              {health.memoryUsage && (
                <>
                  <div>
                    <span className="text-muted-foreground">RSS Memory</span>
                    <p className="font-medium">{health.memoryUsage.rss.toFixed(0)} MB</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Heap Used / Total</span>
                    <p className="font-medium">
                      {health.memoryUsage.heapUsed.toFixed(0)} / {health.memoryUsage.heapTotal.toFixed(0)} MB
                    </p>
                  </div>
                </>
              )}
              <div>
                <span className="text-muted-foreground">Active Tasks</span>
                <p className="font-medium">{health.activeTaskCount ?? 0}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Registered Tools</span>
                <p className="font-medium">{health.toolCount ?? 0}</p>
              </div>
            </div>
            {health.lastAgentRunAt && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last agent run: {new Date(health.lastAgentRunAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Heartbeat Scheduler */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Heartbeat Scheduler</CardTitle>
            <CardDescription>Periodic automated scan status.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocation('/settings/heartbeat')}>
            Configure <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">
                {heartbeatStatus?.running ? (
                  <Badge variant="default" className="bg-green-600">Running</Badge>
                ) : (
                  <Badge variant="secondary">Stopped</Badge>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Run</span>
              <p className="font-medium">
                {heartbeatStatus?.lastRunAt
                  ? new Date(heartbeatStatus.lastRunAt).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Next Run</span>
              <p className="font-medium">
                {heartbeatStatus?.nextRunAt
                  ? new Date(heartbeatStatus.nextRunAt).toLocaleString()
                  : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Interval</span>
              <p className="font-medium">
                {heartbeatStatus?.intervalMs
                  ? `${Math.round(heartbeatStatus.intervalMs / 60000)} min`
                  : 'Not set'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Cron Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Scheduled Tasks
              {cronJobs.length > 0 ? (
                <Badge variant="default" className="bg-blue-600">{cronJobs.length}</Badge>
              ) : (
                <Badge variant="secondary">0</Badge>
              )}
            </CardTitle>
            <CardDescription>Persistent cron jobs created by {agentName} or manually.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchCrons()}>
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {cronJobs.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No scheduled tasks. Ask {agentName} to schedule a recurring task using <code className="text-xs bg-muted px-1 rounded">schedule_task</code>.
            </p>
          ) : (
            <div className="divide-y">
              {cronJobs.map((job) => (
                <div key={job.id} className="flex items-start gap-3 py-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{job.name}</span>
                      {job.enabled ? (
                        <Badge variant="default" className="bg-green-600 text-[10px] px-1.5 py-0">active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">paused</Badge>
                      )}
                      {!job.recurring && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">one-shot</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{job.cronExpression}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{job.prompt}</p>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>Next: {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'}</span>
                      <span>Last: {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'never'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => toggleCronMutation.mutate({ id: job.id, enabled: !job.enabled })}
                    >
                      {job.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => deleteCronMutation.mutate(job.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Active Tasks
            {activeTasks.length > 0 ? (
              <Badge variant="default" className="bg-green-600">{activeTasks.length}</Badge>
            ) : (
              <Badge variant="secondary">0</Badge>
            )}
          </CardTitle>
          <CardDescription>Background agent tasks currently running or queued.</CardDescription>
        </CardHeader>
        <CardContent>
          {activeTasks.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No active tasks.</p>
          ) : (
            <div className="divide-y">
              {activeTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{task.type}</Badge>
                      {task.conversationId && (
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                          {task.conversationId}
                        </span>
                      )}
                    </div>
                    {task.progress > 0 && (
                      <Progress value={task.progress} className="h-1 mt-2" />
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant={task.status === 'running' ? 'default' : 'secondary'}
                      className={task.status === 'running' ? 'bg-green-600' : ''}
                    >
                      {task.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDuration(task.startedAt ?? task.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Knowledge & Memory Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Knowledge & Memory</CardTitle>
          <CardDescription>Current stored data summary.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Knowledge Items</span>
              <p className="text-2xl font-semibold">{knowledge?.knowledgeItems ?? 0}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Memory Items</span>
              <p className="text-2xl font-semibold">{knowledge?.memoryItems ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Registered Tools */}
      {health?.registeredTools && health.registeredTools.length > 0 && (
        <Card>
          <CardHeader
            className="flex flex-row items-center justify-between cursor-pointer select-none"
            onClick={() => setToolsExpanded((v) => !v)}
          >
            <div>
              <CardTitle className="flex items-center gap-2">
                Registered Tools
                <Badge variant="secondary">{health.registeredTools.length}</Badge>
              </CardTitle>
              <CardDescription>
                {toolsExpanded ? 'All tools available to the agent.' : `${health.registeredTools.length} tools — click to expand.`}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={(e) => { e.stopPropagation(); setToolsExpanded((v) => !v); }}>
              {toolsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CardHeader>
          {toolsExpanded && (
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {health.registeredTools.map((tool) => (
                  <Badge key={tool} variant="outline" className="text-xs">
                    {tool}
                  </Badge>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Tool Error Log */}
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between cursor-pointer select-none"
          onClick={() => setErrorsExpanded((v) => !v)}
        >
          <div>
            <CardTitle className="flex items-center gap-2">
              Tool Error Log
              {toolErrors.length > 0 ? (
                <Badge variant="destructive">{toolErrors.length}</Badge>
              ) : (
                <Badge variant="secondary">0</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {errorsExpanded
                ? 'Last 100 failed tool calls.'
                : `${toolErrors.length} error${toolErrors.length !== 1 ? 's' : ''} recorded — click to expand.`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {toolErrors.length > 0 && errorsExpanded && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
                onClick={(e) => { e.stopPropagation(); clearErrorsMutation.mutate(); }}
                disabled={clearErrorsMutation.isPending}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Clear All
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={(e) => { e.stopPropagation(); setErrorsExpanded((v) => !v); }}
            >
              {errorsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        {errorsExpanded && (
          <CardContent>
            {toolErrors.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No tool errors recorded.</p>
            ) : (
              <div className="divide-y">
                {toolErrors.map((err) => (
                  <div key={err.id} className="py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <Badge variant="outline" className="text-xs shrink-0">{err.toolName}</Badge>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(err.createdAt).toLocaleString()}
                        </span>
                        {err.conversationId && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                            {err.conversationId}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] shrink-0"
                        onClick={() => setExpandedErrorId(expandedErrorId === err.id ? null : err.id)}
                      >
                        {expandedErrorId === err.id ? 'Collapse' : 'Details'}
                      </Button>
                    </div>
                    <p className="text-xs text-destructive font-mono">
                      {expandedErrorId === err.id ? err.error : err.error.slice(0, 120) + (err.error.length > 120 ? '…' : '')}
                    </p>
                    {expandedErrorId === err.id && err.args && Object.keys(err.args).length > 0 && (
                      <pre className="text-[10px] bg-muted rounded p-2 overflow-x-auto max-h-32">
                        {JSON.stringify(err.args, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function formatDuration(since: string | null): string {
  if (!since) return '—';
  const secs = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
