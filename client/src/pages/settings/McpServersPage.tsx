import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, RefreshCw, Plug, Wrench, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useBranding } from '@/hooks/useBranding';

// ── Types ──────────────────────────────────────────────────────────────────────

interface McpServerInfo {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  tools: string[];
}

interface NewServerForm {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
}

const EMPTY_FORM: NewServerForm = {
  name: '',
  transport: 'sse',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function McpServersPage() {
  const { setHeader, resetHeader } = useAdminLayout();
  const { agentName } = useBranding();
  const route = getAdminRouteById('mcp-servers');
  const headerTitle = route.pageHeader?.title ?? route.label;
  const headerDescription = route.pageHeader?.description;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState<NewServerForm>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedToolsIds, setExpandedToolsIds] = useState<Set<string>>(new Set());

  // ── Fetch servers ──────────────────────────────────────────────────────────

  const { data, isLoading, isError, refetch } = useQuery<{ servers: McpServerInfo[] }>({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/mcp/servers');
      return res.json();
    },
  });

  const servers = data?.servers ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest('POST', '/api/admin/mcp/servers', body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      setShowAddDialog(false);
      setForm(EMPTY_FORM);
      toast({ title: 'MCP server added', description: 'The server is being connected.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to add server', description: err.message, variant: 'destructive' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiRequest('PATCH', `/api/admin/mcp/servers/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to update server', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/admin/mcp/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      setDeleteConfirmId(null);
      toast({ title: 'MCP server removed' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to remove server', description: err.message, variant: 'destructive' });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('PATCH', `/api/admin/mcp/servers/${id}`, { enabled: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      toast({ title: 'Reconnecting...' });
    },
  });

  // ── Add handler ────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      transport: form.transport,
      enabled: true,
    };

    if (form.transport === 'stdio') {
      body.command = form.command.trim();
      if (form.args.trim()) {
        body.args = form.args.split('\n').map((a) => a.trim()).filter(Boolean);
      }
    } else {
      body.url = form.url.trim();
    }

    if (form.env.trim()) {
      try {
        body.env = JSON.parse(form.env);
      } catch {
        toast({ title: 'Invalid JSON in environment variables', variant: 'destructive' });
        return;
      }
    }

    if (form.headers.trim()) {
      try {
        body.headers = JSON.parse(form.headers);
      } catch {
        toast({ title: 'Invalid JSON in headers', variant: 'destructive' });
        return;
      }
    }

    addMutation.mutate(body);
  }, [form, addMutation, toast]);

  // ── Header ─────────────────────────────────────────────────────────────────

  const headerActions = useMemo(
    () => (
      <Button onClick={() => setShowAddDialog(true)} className="gap-2">
        <Plus className="h-4 w-4" />
        Add Server
      </Button>
    ),
    [],
  );

  useEffect(() => {
    setHeader({
      title: headerTitle,
      description: headerDescription,
      actions: headerActions,
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, headerActions, headerTitle, headerDescription]);

  // ── Loading / error ────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 py-12">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load MCP servers.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        {/* Server list */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Connected Servers</h2>
            <p className="text-sm text-muted-foreground">
              MCP servers extend {agentName} with additional tools. Each server can provide multiple tools
              that the agent can use during conversations.
            </p>
          </div>

          {servers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Plug className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No MCP servers configured</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Add an MCP server to extend the agent with external tools.
                </p>
                <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4" />
                  Add your first server
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {servers.map((server) => (
                <Card key={server.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <Plug className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <span className="text-base">{server.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {server.transport}
                            </Badge>
                            {server.connected ? (
                              <Badge variant="secondary" className="text-[10px] gap-1 text-emerald-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                                Connected
                              </Badge>
                            ) : server.enabled ? (
                              <Badge variant="secondary" className="text-[10px] gap-1 text-amber-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                                Disconnected
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                                Disabled
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => reconnectMutation.mutate(server.id)}
                          disabled={reconnectMutation.isPending}
                          title="Reconnect"
                        >
                          <RefreshCw className={`h-4 w-4 ${reconnectMutation.isPending ? 'animate-spin' : ''}`} />
                        </Button>
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: server.id, enabled: checked })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmId(server.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription className="text-xs font-mono mt-1 break-all">
                      {server.transport === 'stdio'
                        ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim()
                        : server.url ?? ''}
                    </CardDescription>
                  </CardHeader>

                  {server.tools.length > 0 && (
                    <CardContent className="pt-0">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left hover:opacity-70 transition-opacity"
                        onClick={() => setExpandedToolsIds(prev => {
                          const next = new Set(prev);
                          if (next.has(server.id)) next.delete(server.id);
                          else next.add(server.id);
                          return next;
                        })}
                      >
                        <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">
                          {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''} available
                        </span>
                        {expandedToolsIds.has(server.id)
                          ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                      </button>
                      {expandedToolsIds.has(server.id) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {server.tools.map((tool) => {
                            const label = tool.startsWith('mcp_')
                              ? (() => {
                                  const parts = tool.split('_');
                                  return parts.slice(2).join(' \u2014 ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                })()
                              : tool.replace(/_/g, ' ');
                            return (
                              <Badge key={tool} variant="outline" className="text-[11px]">
                                {label}
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Add Server Dialog ── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>
              Connect to an MCP-compatible tool server via stdio or SSE transport.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                placeholder="e.g. filesystem, github"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Transport</Label>
              <Select
                value={form.transport}
                onValueChange={(v) => setForm((f) => ({ ...f, transport: v as 'stdio' | 'sse' | 'streamable-http' }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio (local process)</SelectItem>
                  <SelectItem value="sse">SSE (remote HTTP)</SelectItem>
                  <SelectItem value="streamable-http">Streamable HTTP (modern)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-command">Command</Label>
                  <Input
                    id="mcp-command"
                    placeholder="e.g. npx, uvx, node"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-args">Arguments (one per line)</Label>
                  <textarea
                    id="mcp-args"
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/app/workspace"}
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-url">Server URL</Label>
                  <Input
                    id="mcp-url"
                    placeholder={form.transport === 'streamable-http' ? 'https://example.com/mcp/' : 'http://localhost:3100/sse'}
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-headers">Headers (JSON, optional)</Label>
                  <textarea
                    id="mcp-headers"
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={'{"Authorization": "Bearer ...", "locationId": "..."}'}
                    value={form.headers}
                    onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="mcp-env">Environment Variables (JSON, optional)</Label>
              <Input
                id="mcp-env"
                placeholder='{"API_KEY": "..."}'
                value={form.env}
                onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={
                !form.name.trim() ||
                (form.transport === 'stdio' && !form.command.trim()) ||
                (form.transport !== 'stdio' && !form.url.trim()) ||
                addMutation.isPending
              }
            >
              {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove MCP Server</DialogTitle>
            <DialogDescription>
              This will disconnect the server and remove all its tools. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
