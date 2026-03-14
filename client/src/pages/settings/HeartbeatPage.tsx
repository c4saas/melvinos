import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminSettings } from '@/hooks/use-admin-settings';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Plus, Trash2, Play, GripVertical } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useAdminLayout } from '@/components/AdminLayout';
import { AdminSettingsErrorState } from '@/components/admin';
import { getAdminRouteById } from '@shared/adminRoutes';
import { apiRequest } from '@/lib/queryClient';
import { useBranding } from '@/hooks/useBranding';

const INTERVAL_OPTIONS = [
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '120', label: 'Every 2 hours' },
  { value: '240', label: 'Every 4 hours' },
  { value: '480', label: 'Every 8 hours' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Every 24 hours' },
];

const TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'US/Hawaii',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'UTC',
];

export default function HeartbeatPage() {
  const { draft, setDraft, isLoading, isSaving, handleSave, isError, refetch } = useAdminSettings();
  const { agentName } = useBranding();
  const { setHeader, resetHeader } = useAdminLayout();
  const { toast } = useToast();
  const route = getAdminRouteById('heartbeat');
  const headerTitle = route.pageHeader?.title ?? route.label;
  const headerDescription = route.pageHeader?.description;

  const [isTesting, setIsTesting] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [newConstraint, setNewConstraint] = useState('');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [showAddItem, setShowAddItem] = useState(false);

  // Fetch last run status on mount
  useEffect(() => {
    apiRequest('GET', '/api/admin/heartbeat/status')
      .then((res) => res.json())
      .then((data: { lastRunAt?: string | null }) => {
        if (data.lastRunAt) setLastRun(data.lastRunAt);
      })
      .catch(() => {});
  }, []);

  // ── Draft updaters ────────────────────────────────────────────────

  const updateHeartbeat = useCallback(
    (updater: (hb: NonNullable<typeof draft>['heartbeat']) => void) => {
      setDraft((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        updater(next.heartbeat);
        return next;
      });
    },
    [setDraft],
  );

  const handleAddConstraint = useCallback(() => {
    const text = newConstraint.trim();
    if (!text) return;
    updateHeartbeat((hb) => {
      hb.constraints.push({ id: `c${Date.now()}`, text });
    });
    setNewConstraint('');
  }, [newConstraint, updateHeartbeat]);

  const handleRemoveConstraint = useCallback(
    (id: string) => {
      updateHeartbeat((hb) => {
        hb.constraints = hb.constraints.filter((c) => c.id !== id);
      });
    },
    [updateHeartbeat],
  );

  const handleAddScanItem = useCallback(() => {
    const label = newItemLabel.trim();
    const description = newItemDescription.trim();
    if (!label) return;
    updateHeartbeat((hb) => {
      hb.scanItems.push({ id: `si${Date.now()}`, label, description, enabled: true });
    });
    setNewItemLabel('');
    setNewItemDescription('');
    setShowAddItem(false);
  }, [newItemLabel, newItemDescription, updateHeartbeat]);

  const handleRemoveScanItem = useCallback(
    (id: string) => {
      updateHeartbeat((hb) => {
        hb.scanItems = hb.scanItems.filter((s) => s.id !== id);
      });
    },
    [updateHeartbeat],
  );

  const handleUpdateScanItem = useCallback(
    (id: string, field: 'label' | 'description', value: string) => {
      updateHeartbeat((hb) => {
        const item = hb.scanItems.find((s) => s.id === id);
        if (item) item[field] = value;
      });
    },
    [updateHeartbeat],
  );

  const handleTestNow = useCallback(async () => {
    setIsTesting(true);
    try {
      const res = await apiRequest('POST', '/api/admin/heartbeat/trigger');
      const data = await res.json();
      toast({
        title: 'Heartbeat triggered',
        description: data.message || 'Heartbeat scan is running.',
      });
      setLastRun(new Date().toISOString());
    } catch {
      toast({
        title: 'Heartbeat failed',
        description: 'Could not trigger the heartbeat scan. Check server logs.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  }, [toast]);

  // ── Header ────────────────────────────────────────────────────────

  const hasLoadedDraft = Boolean(draft);

  const headerActions = useMemo(() => {
    if (!hasLoadedDraft) return null;
    return (
      <Button
        onClick={() => { void handleSave('heartbeat'); }}
        disabled={isSaving}
        className="gap-2 whitespace-nowrap sm:w-auto"
        data-testid="button-save-heartbeat"
      >
        {isSaving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
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

  // ── States ────────────────────────────────────────────────────────

  if (isError) {
    return (
      <AdminSettingsErrorState
        title={`We couldn't load ${headerTitle} settings.`}
        description="Please check your connection and try again."
        onRetry={refetch}
        testId="admin-settings-error-state-heartbeat"
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

  const hb = draft.heartbeat;

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">

        {/* ── General ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Enable the heartbeat and set how often it runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <Label htmlFor="hb-enabled" className="text-sm font-medium">Enable heartbeat</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, {agentName} will periodically run an automated scan and report results.
                </p>
              </div>
              <Switch
                id="hb-enabled"
                checked={hb.enabled}
                onCheckedChange={(checked) => updateHeartbeat((h) => { h.enabled = checked; })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="hb-interval">Scan interval</Label>
              <Select
                value={String(hb.intervalMinutes)}
                onValueChange={(v) => updateHeartbeat((h) => { h.intervalMinutes = parseInt(v, 10); })}
              >
                <SelectTrigger id="hb-interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How often the heartbeat scan runs. Shorter intervals use more AI tokens.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Quiet Hours ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Quiet Hours</CardTitle>
            <CardDescription>
              Suppress heartbeat scans during off-hours. Only high-severity issues will trigger a report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <Label htmlFor="hb-quiet-enabled" className="text-sm font-medium">Enable quiet hours</Label>
                <p className="text-xs text-muted-foreground">
                  Skip automated scans during the configured time window.
                </p>
              </div>
              <Switch
                id="hb-quiet-enabled"
                checked={hb.quietHours.enabled}
                onCheckedChange={(checked) => updateHeartbeat((h) => { h.quietHours.enabled = checked; })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="hb-quiet-start">Start time</Label>
                <Input
                  id="hb-quiet-start"
                  type="time"
                  value={hb.quietHours.startTime}
                  onChange={(e) => updateHeartbeat((h) => { h.quietHours.startTime = e.target.value; })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hb-quiet-end">End time</Label>
                <Input
                  id="hb-quiet-end"
                  type="time"
                  value={hb.quietHours.endTime}
                  onChange={(e) => updateHeartbeat((h) => { h.quietHours.endTime = e.target.value; })}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="hb-timezone">Timezone</Label>
              <Select
                value={hb.quietHours.timezone}
                onValueChange={(v) => updateHeartbeat((h) => { h.quietHours.timezone = v; })}
              >
                <SelectTrigger id="hb-timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── Scan Checklist ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Scan Checklist</CardTitle>
                <CardDescription>
                  Define what the heartbeat inspects each run. Edit labels and descriptions directly, toggle items on or off, or remove them entirely.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setShowAddItem((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add item
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {hb.scanItems.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border bg-muted/30 p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  <Input
                    value={item.label}
                    onChange={(e) => handleUpdateScanItem(item.id, 'label', e.target.value)}
                    placeholder="Item label"
                    className="h-8 text-sm font-medium flex-1"
                  />
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={(checked) =>
                      updateHeartbeat((h) => {
                        const target = h.scanItems.find((s) => s.id === item.id);
                        if (target) target.enabled = checked;
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveScanItem(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={item.description}
                  onChange={(e) => handleUpdateScanItem(item.id, 'description', e.target.value)}
                  placeholder="Describe what this item checks and how to report it..."
                  className="text-xs text-muted-foreground resize-none min-h-[64px]"
                  rows={3}
                />
              </div>
            ))}

            {hb.scanItems.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No scan items yet. Add one to get started.
              </p>
            )}

            {showAddItem && (
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-3">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">New scan item</p>
                <div className="grid gap-2">
                  <Input
                    value={newItemLabel}
                    onChange={(e) => setNewItemLabel(e.target.value)}
                    placeholder="Label (e.g. Email Triage)"
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Textarea
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    placeholder="Describe what to check and how to format the output..."
                    className="text-xs resize-none min-h-[72px]"
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAddScanItem();
                      }
                    }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowAddItem(false); setNewItemLabel(''); setNewItemDescription(''); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddScanItem}
                    disabled={!newItemLabel.trim()}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add item
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Rules & Constraints ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Rules & Constraints</CardTitle>
            <CardDescription>
              Set rules the heartbeat must follow when generating reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hb.constraints.map((constraint) => (
              <div
                key={constraint.id}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
              >
                <p className="flex-1 text-sm">{constraint.text}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveConstraint(constraint.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a new rule..."
                value={newConstraint}
                onChange={(e) => setNewConstraint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddConstraint();
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={handleAddConstraint}
                disabled={!newConstraint.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Delivery ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
            <CardDescription>
              Choose how heartbeat reports are delivered and what to say when there's nothing to report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="hb-channel">Delivery channel</Label>
              <Select
                value={hb.deliveryChannel}
                onValueChange={(v) =>
                  updateHeartbeat((h) => {
                    h.deliveryChannel = v as 'telegram' | 'in_app' | 'sms';
                  })
                }
              >
                <SelectTrigger id="hb-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="in_app">In-App (chat sidebar)</SelectItem>
                  <SelectItem value="sms">SMS (via GHL)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Telegram sends to the same recipients configured in Integrations. In-App stores results in a dedicated conversation. SMS sends via GoHighLevel MCP.
              </p>
            </div>

            {hb.deliveryChannel === 'sms' && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm font-medium">SMS Configuration (GHL)</p>
                <div className="grid gap-2">
                  <Label htmlFor="hb-sms-contact">GHL Contact ID</Label>
                  <Input
                    id="hb-sms-contact"
                    value={hb.smsConfig?.contactId ?? ''}
                    onChange={(e) => updateHeartbeat((h) => {
                      if (!h.smsConfig) h.smsConfig = { contactId: '', fromNumber: '', mcpServerId: '' };
                      h.smsConfig.contactId = e.target.value;
                    })}
                    placeholder="abc123def456"
                  />
                  <p className="text-xs text-muted-foreground">Your contact ID in GoHighLevel (the recipient).</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="hb-sms-from">From Number</Label>
                  <Input
                    id="hb-sms-from"
                    value={hb.smsConfig?.fromNumber ?? ''}
                    onChange={(e) => updateHeartbeat((h) => {
                      if (!h.smsConfig) h.smsConfig = { contactId: '', fromNumber: '', mcpServerId: '' };
                      h.smsConfig.fromNumber = e.target.value;
                    })}
                    placeholder="+15551234567"
                  />
                  <p className="text-xs text-muted-foreground">{agentName}'s dedicated phone number in GHL. Leave blank to use the location default.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="hb-sms-mcp">MCP Server ID</Label>
                  <Input
                    id="hb-sms-mcp"
                    value={hb.smsConfig?.mcpServerId ?? ''}
                    onChange={(e) => updateHeartbeat((h) => {
                      if (!h.smsConfig) h.smsConfig = { contactId: '', fromNumber: '', mcpServerId: '' };
                      h.smsConfig.mcpServerId = e.target.value;
                    })}
                    placeholder="mcp-1772851899508-a69rih"
                  />
                  <p className="text-xs text-muted-foreground">The MCP server ID for the GHL account (find in Settings → MCP Servers).</p>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="hb-quiet-response">Quiet response</Label>
              <Input
                id="hb-quiet-response"
                value={hb.quietResponse}
                onChange={(e) => updateHeartbeat((h) => { h.quietResponse = e.target.value; })}
                placeholder="HEARTBEAT_OK"
              />
              <p className="text-xs text-muted-foreground">
                What to send when there's nothing meaningful to report.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Test heartbeat</p>
                <p className="text-xs text-muted-foreground">
                  Trigger a heartbeat scan right now to verify everything works.
                  {lastRun && (
                    <>
                      {' '}Last run: {new Date(lastRun).toLocaleString()}.
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleTestNow}
                disabled={isTesting}
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Test Now
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
