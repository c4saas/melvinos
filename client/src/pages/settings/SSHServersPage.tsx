import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Terminal,
  Plus,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Loader2,
  Wifi,
  WifiOff,
  Key,
} from 'lucide-react';
import { useAdminLayout } from '@/components/AdminLayout';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useBranding } from '@/hooks/useBranding';

interface SshServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  hasKey: boolean;
  enabled: boolean;
}

interface SshServerForm {
  label: string;
  host: string;
  port: string;
  username: string;
  privateKey: string;
}

const EMPTY_FORM: SshServerForm = {
  label: '',
  host: '',
  port: '22',
  username: 'root',
  privateKey: '',
};

export default function SSHServersPage() {
  const { setHeader, resetHeader } = useAdminLayout();
  const { agentName } = useBranding();
  const route = getAdminRouteById('ssh-servers' as any);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setHeader({
      title: route?.pageHeader?.title ?? 'SSH Servers',
      description: route?.pageHeader?.description,
    });
    return () => resetHeader();
  }, [setHeader, resetHeader, route]);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SshServerForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message?: string; error?: string }>>({});

  const { data, isLoading } = useQuery<{ servers: SshServer[] }>({
    queryKey: ['/api/admin/ssh-servers'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/ssh-servers');
      return res.json();
    },
  });
  const servers = data?.servers ?? [];

  const createMutation = useMutation({
    mutationFn: async (body: SshServerForm) => {
      const res = await apiRequest('POST', '/api/admin/ssh-servers', {
        ...body,
        port: Number(body.port) || 22,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/ssh-servers'] });
      setShowDialog(false);
      setForm(EMPTY_FORM);
      toast({ title: 'SSH server added' });
    },
    onError: () => toast({ title: 'Failed to add server', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: SshServerForm }) => {
      const res = await apiRequest('PUT', `/api/admin/ssh-servers/${id}`, {
        ...body,
        port: Number(body.port) || 22,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/ssh-servers'] });
      setShowDialog(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast({ title: 'SSH server updated' });
    },
    onError: () => toast({ title: 'Failed to update server', variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiRequest('PUT', `/api/admin/ssh-servers/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/admin/ssh-servers'] }),
    onError: () => toast({ title: 'Failed to update server', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/admin/ssh-servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/ssh-servers'] });
      setDeleteId(null);
      toast({ title: 'SSH server removed' });
    },
    onError: () => toast({ title: 'Failed to delete server', variant: 'destructive' }),
  });

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await apiRequest('POST', `/api/admin/ssh-servers/${id}/test`);
      const result = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { success: false, error: 'Request failed' } }));
    } finally {
      setTestingId(null);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowDialog(true);
  };

  const openEdit = (server: SshServer) => {
    setEditingId(server.id);
    setForm({
      label: server.label,
      host: server.host,
      port: String(server.port),
      username: server.username,
      privateKey: '',
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!form.label.trim() || !form.host.trim() || !form.username.trim()) {
      toast({ title: 'Label, host, and username are required', variant: 'destructive' });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, body: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              SSH Servers
              {servers.length > 0 && (
                <Badge variant="secondary">{servers.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Add remote servers so {agentName} can run commands via the <code className="text-xs bg-muted px-1 rounded">ssh_execute</code> tool.
            </CardDescription>
          </div>
          <Button onClick={openAdd} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Terminal className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No SSH servers configured.</p>
              <p className="text-xs text-muted-foreground mt-1">Add a server to let {agentName} connect via SSH.</p>
              <Button onClick={openAdd} variant="outline" size="sm" className="mt-4 gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add your first server
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {servers.map((server) => {
                const result = testResults[server.id];
                return (
                  <div key={server.id} className="flex items-start gap-4 py-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{server.label}</span>
                        {server.enabled ? (
                          <Badge variant="default" className="bg-green-600 text-[10px] px-1.5 py-0">active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">disabled</Badge>
                        )}
                        {server.hasKey ? (
                          <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
                            <Key className="h-2.5 w-2.5" /> key set
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">no key</Badge>
                        )}
                        {result && (
                          result.success ? (
                            <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0 border-green-500 text-green-500">
                              <CheckCircle2 className="h-2.5 w-2.5" /> connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0 border-destructive text-destructive">
                              <XCircle className="h-2.5 w-2.5" /> failed
                            </Badge>
                          )
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {server.username}@{server.host}:{server.port}
                      </p>
                      {result && !result.success && result.error && (
                        <p className="text-[11px] text-destructive font-mono mt-1 break-all">{result.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        disabled={testingId === server.id || !server.hasKey}
                        onClick={() => handleTest(server.id)}
                        title={!server.hasKey ? 'Add a private key first' : 'Test connection'}
                      >
                        {testingId === server.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wifi className="h-3 w-3" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => openEdit(server)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: server.id, enabled })}
                        className="scale-75"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(server.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage hint */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How to use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Once configured, ask {agentName} to run commands on your server using natural language:</p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li><em>"Check disk space on Hostinger"</em></li>
            <li><em>"Restart the nginx service on Production"</em></li>
            <li><em>"Show me the last 50 lines of /var/log/app.log on Staging"</em></li>
          </ul>
          <p className="text-xs">
            Server labels must match what you use in conversation (case-insensitive).
            Private keys should be in PEM format (<code className="bg-muted px-1 rounded">-----BEGIN ... PRIVATE KEY-----</code>).
          </p>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditingId(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit SSH Server' : 'Add SSH Server'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update connection details. Leave the private key blank to keep the existing key.'
                : `Configure a remote server connection for ${agentName} to use.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Label</Label>
                <Input
                  placeholder="Hostinger, Production…"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  placeholder="22"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Host</Label>
              <Input
                placeholder="server.example.com or 192.168.1.100"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                placeholder="root"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5" />
                Private Key (PEM)
              </Label>
              <Textarea
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                className="font-mono text-xs h-32 resize-none"
                value={form.privateKey}
                onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
              />
              {editingId && (
                <p className="text-xs text-muted-foreground">Leave blank to keep the existing key.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditingId(null); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving} className="gap-1.5">
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editingId ? 'Save Changes' : 'Add Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove SSH server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the server and its private key from Atlas. {agentName} will no longer be able to connect to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
