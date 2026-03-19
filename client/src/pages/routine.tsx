import { useState, useEffect, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useUserTimezone } from '@/hooks/useUserTimezone';
import { todayLabel, fmtTime } from '@/lib/dateUtils';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Mail,
  TrendingUp,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Circle,
  RefreshCw,
  Loader2,
  Sparkles,
  Target,
  BarChart3,
  ListChecks,
  Zap,
  Plus,
  StickyNote,
  RotateCcw,
} from 'lucide-react';

interface RoutineData {
  context: {
    meetings: { time: string; title: string; attendees?: string[] }[];
    criticalEmails: { from: string; subject: string; receivedAt?: string }[];
    pipelineMovements: { contact: string; deal: string; stage: string; daysSinceMove?: number }[];
    ghlTasks?: { title: string; dueDate: string; contact: string; status: string; subAccount: string }[];
    systemStatus: { healthy: boolean; issues: string[] };
    carryForward: { item: string; fromDate: string }[];
  };
  blocks: { key: string; name: string; time: string; checked: boolean; checkedAt: string | null }[];
  scoreboard: Record<string, { actual: number | boolean | null; target: number | boolean; validated: boolean }>;
  actionQueue: { id: string; item: string; detail: string; type: string; priority: string; resolved: boolean; source?: string }[];
  escalations: { trigger: string; condition: string; active: boolean; resolvedAt: string | null }[];
  nonNegotiables: { key: string; label: string; checked: boolean }[];
  notes?: string;
}

interface RoutineEntry {
  id: string;
  userId: string;
  date: string;
  data: RoutineData;
  createdAt: string;
  updatedAt: string;
}

const SCOREBOARD_LABELS: Record<string, { label: string; unit: string }> = {
  deepWorkHours: { label: 'Deep Work Hours', unit: 'hrs' },
  leadsTouched: { label: 'Leads Touched', unit: '' },
  dealsMoved: { label: 'Deals Moved', unit: '' },
  deliverablesShipped: { label: 'Deliverables Shipped', unit: '' },
  inboxZero: { label: 'Inbox Zero', unit: '' },
  blockersEscalated: { label: 'Blockers Escalated', unit: '' },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
  high: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  medium: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  low: 'bg-muted text-muted-foreground border-border',
};

export default function RoutinePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userTz = useUserTimezone();

  const { data: entry, isLoading } = useQuery<RoutineEntry>({
    queryKey: ['/api/routine/today'],
    refetchInterval: 60000,
  });

  const populateMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('POST', '/api/routine/populate');
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] });
      toast({ title: 'Routine populated with live data' });
    },
    onError: () => {
      toast({ title: 'Failed to populate routine', variant: 'destructive' });
    },
  });

  const toggleBlock = useMutation({
    mutationFn: async ({ key, checked }: { key: string; checked: boolean }) => {
      const r = await apiRequest('PATCH', `/api/routine/today/block/${key}`, { checked });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] }),
  });

  const toggleChecklist = useMutation({
    mutationFn: async ({ key, checked }: { key: string; checked: boolean }) => {
      const r = await apiRequest('PATCH', `/api/routine/today/checklist/${key}`, { checked });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] }),
  });

  const updateScoreboard = useMutation({
    mutationFn: async ({ key, actual, validated }: { key: string; actual?: number | boolean; validated?: boolean }) => {
      const r = await apiRequest('PATCH', `/api/routine/today/scoreboard/${key}`, { actual, validated });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] }),
  });

  const resolveAction = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const r = await apiRequest('PATCH', `/api/routine/today/action/${id}`, { resolved });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] }),
  });

  const addAction = useMutation({
    mutationFn: async (action: { item: string; detail: string; type: string; priority: string }) => {
      const r = await apiRequest('POST', '/api/routine/today/action', action);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] });
      setNewActionItem('');
      setNewActionDetail('');
      setNewActionPriority('medium');
      setNewActionType('tactical');
      setShowAddAction(false);
    },
  });

  const saveNotes = useMutation({
    mutationFn: async (notes: string) => {
      const r = await apiRequest('PATCH', '/api/routine/today/notes', { notes });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routine/today'] }),
  });

  const [showAddAction, setShowAddAction] = useState(false);
  const [newActionItem, setNewActionItem] = useState('');
  const [newActionDetail, setNewActionDetail] = useState('');
  const [newActionPriority, setNewActionPriority] = useState('medium');
  const [newActionType, setNewActionType] = useState('tactical');
  const [notesValue, setNotesValue] = useState<string | null>(null);
  const [notesTimeout, setNotesTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (notesTimeout) clearTimeout(notesTimeout); };
  }, [notesTimeout]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = entry?.data;
  if (!data) return null;

  const today = todayLabel(userTz);
  const blocksCompleted = data.blocks.filter(b => b.checked).length;
  const blocksTotal = data.blocks.length;
  const checklistCompleted = data.nonNegotiables.filter(n => n.checked).length;
  const checklistTotal = data.nonNegotiables.length;
  const overallProgress = Math.round(((blocksCompleted + checklistCompleted) / (blocksTotal + checklistTotal)) * 100);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" size="icon">
                <Link href="/">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  Daily Success Routine
                </h1>
                <p className="text-sm text-muted-foreground">{today} &middot; Work Hours: 9:00 AM - 3:30 PM</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right mr-2">
                <div className="text-2xl font-bold">{overallProgress}%</div>
                <div className="text-xs text-muted-foreground">Complete</div>
              </div>
              <Progress value={overallProgress} className="w-24 h-2" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => populateMutation.mutate()}
                disabled={populateMutation.isPending}
              >
                {populateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-2">Refresh Data</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {/* Section 1: Today's Context */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" />
              Today's Context
              <Badge variant="secondary" className="ml-auto text-xs font-normal">Auto-populated</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <ContextCard
                icon={<Calendar className="h-4 w-4 text-blue-500" />}
                label="Meetings"
                value={data.context.meetings.length > 0
                  ? `${data.context.meetings.length} (${data.context.meetings.map(m => m.time).join(', ')})`
                  : 'None scheduled'}
              />
              <ContextCard
                icon={<Mail className="h-4 w-4 text-red-500" />}
                label="Critical Emails"
                value={data.context.criticalEmails.length > 0
                  ? `${data.context.criticalEmails.length} unread`
                  : 'All clear'}
              />
              <ContextCard
                icon={<TrendingUp className="h-4 w-4 text-green-500" />}
                label="Pipeline"
                value={data.context.pipelineMovements.length > 0
                  ? `${data.context.pipelineMovements.length} deals need touch`
                  : 'No action needed'}
              />
              <ContextCard
                icon={<Shield className="h-4 w-4 text-emerald-500" />}
                label="System Status"
                value={data.context.systemStatus.healthy ? 'All green' : `${data.context.systemStatus.issues.length} issue(s)`}
                status={data.context.systemStatus.healthy ? 'green' : 'red'}
              />
              <ContextCard
                icon={<Clock className="h-4 w-4 text-amber-500" />}
                label="Carry-Forward"
                value={data.context.carryForward.length > 0
                  ? `${data.context.carryForward.length} items`
                  : 'Clean slate'}
              />
              {(data.context.ghlTasks ?? []).length > 0 && (
                <ContextCard
                  icon={<ListChecks className="h-4 w-4 text-purple-500" />}
                  label="GHL Tasks"
                  value={`${data.context.ghlTasks!.length} due`}
                />
              )}
            </div>
            {/* Carry-forward details */}
            {data.context.carryForward.length > 0 && (
              <>
                <Separator className="my-3" />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-600">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Carry-Forward from Previous Days
                  </div>
                  {data.context.carryForward.map((cf, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
                      <span className="flex-1">{cf.item}</span>
                      <span className="text-xs text-muted-foreground shrink-0">from {cf.fromDate}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* GHL Tasks details */}
            {(data.context.ghlTasks ?? []).length > 0 && (
              <>
                <Separator className="my-3" />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-purple-600">
                    <ListChecks className="h-3.5 w-3.5" />
                    HighLevel Tasks
                  </div>
                  {data.context.ghlTasks!.map((task, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="flex-1 font-medium">{task.title}</span>
                      {task.contact && <span className="text-xs text-muted-foreground">{task.contact}</span>}
                      <Badge variant="outline" className="text-xs">{task.subAccount}</Badge>
                      <span className="text-xs text-muted-foreground shrink-0">Due: {task.dueDate}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Execution Blocks */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              Execution Blocks
              <Badge variant="secondary" className="ml-auto text-xs font-normal">{blocksCompleted}/{blocksTotal}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.blocks.map((block) => (
                <div
                  key={block.key}
                  className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors ${
                    block.checked ? 'bg-muted/50 border-muted' : 'bg-card hover:bg-muted/30'
                  }`}
                >
                  <Checkbox
                    checked={block.checked}
                    onCheckedChange={(checked) => toggleBlock.mutate({ key: block.key, checked: !!checked })}
                  />
                  <div className="flex-1">
                    <span className={`font-medium ${block.checked ? 'line-through text-muted-foreground' : ''}`}>
                      {block.name}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">{block.time}</span>
                  {block.checked && block.checkedAt && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {fmtTime(block.checkedAt, userTz)}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 3: Scoreboard */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-primary" />
                Daily Scoreboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(data.scoreboard).map(([key, metric]) => {
                  const info = SCOREBOARD_LABELS[key] ?? { label: key, unit: '' };
                  const isBool = typeof metric.target === 'boolean';
                  return (
                    <div key={key} className="flex items-center gap-3 rounded-lg border px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{info.label}</div>
                        <div className="text-xs text-muted-foreground">
                          Target: {isBool ? (metric.target ? 'Yes' : 'No') : `${metric.target}${info.unit ? `+ ${info.unit}` : '+'}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isBool ? (
                          <Button
                            variant={metric.actual ? 'default' : 'outline'}
                            size="sm"
                            className="h-8"
                            onClick={() => updateScoreboard.mutate({ key, actual: !metric.actual, validated: true })}
                          >
                            {metric.actual ? 'Yes' : 'No'}
                          </Button>
                        ) : (
                          <Input
                            type="number"
                            className="w-16 h-8 text-center"
                            placeholder="--"
                            value={metric.actual !== null && metric.actual !== undefined ? metric.actual : ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : Number(e.target.value);
                              updateScoreboard.mutate({ key, actual: val as number });
                            }}
                          />
                        )}
                        <Button
                          variant={metric.validated ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => updateScoreboard.mutate({ key, validated: !metric.validated })}
                        >
                          {metric.validated ? <CheckCircle2 className="h-3 w-3" /> : 'Validate'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Section 4: Action Queue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-primary" />
                Action Queue
                {data.actionQueue.filter(a => !a.resolved).length > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {data.actionQueue.filter(a => !a.resolved).length} pending
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 ml-2"
                  onClick={() => setShowAddAction(!showAddAction)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showAddAction && (
                <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 mb-3 space-y-2">
                  <Input
                    placeholder="Action item title"
                    value={newActionItem}
                    onChange={(e) => setNewActionItem(e.target.value)}
                    className="h-8"
                  />
                  <Input
                    placeholder="Details (optional)"
                    value={newActionDetail}
                    onChange={(e) => setNewActionDetail(e.target.value)}
                    className="h-8"
                  />
                  <div className="flex gap-2">
                    <Select value={newActionPriority} onValueChange={setNewActionPriority}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={newActionType} onValueChange={setNewActionType}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tactical">Tactical</SelectItem>
                        <SelectItem value="strategic">Strategic</SelectItem>
                        <SelectItem value="operational">Operational</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-8 ml-auto"
                      disabled={!newActionItem.trim() || addAction.isPending}
                      onClick={() => addAction.mutate({ item: newActionItem, detail: newActionDetail, type: newActionType, priority: newActionPriority })}
                    >
                      {addAction.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                    </Button>
                  </div>
                </div>
              )}
              {data.actionQueue.length === 0 && !showAddAction ? (
                <div className="text-sm text-muted-foreground text-center py-8">No action items. Populate data or add manually.</div>
              ) : (
                <div className="space-y-2">
                  {data.actionQueue.map((action) => (
                    <div
                      key={action.id}
                      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                        action.resolved ? 'opacity-50' : ''
                      }`}
                    >
                      <Checkbox
                        checked={action.resolved}
                        onCheckedChange={(checked) => resolveAction.mutate({ id: action.id, resolved: !!checked })}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${action.resolved ? 'line-through' : ''}`}>{action.item}</div>
                        <div className="text-xs text-muted-foreground">{action.detail}</div>
                      </div>
                      {action.source === 'manual' && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">manual</Badge>
                      )}
                      <Badge variant="outline" className={`text-xs shrink-0 ${PRIORITY_COLORS[action.priority] ?? ''}`}>
                        {action.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Section 5: Escalation Triggers */}
        {data.escalations.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                Escalation Triggers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.escalations.map((esc, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{esc.trigger}</div>
                      <div className="text-xs text-muted-foreground">{esc.condition}</div>
                    </div>
                    {esc.active ? (
                      <Badge variant="destructive" className="text-xs">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Resolved</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 6: Completion Checkboxes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Daily Non-Negotiables
              <Badge variant="secondary" className="ml-auto text-xs font-normal">{checklistCompleted}/{checklistTotal}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.nonNegotiables.map((item) => (
                <div
                  key={item.key}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors ${
                    item.checked ? 'bg-muted/50 border-muted' : 'hover:bg-muted/30'
                  }`}
                >
                  <Checkbox
                    checked={item.checked}
                    onCheckedChange={(checked) => toggleChecklist.mutate({ key: item.key, checked: !!checked })}
                  />
                  <span className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : ''}`}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Section 7: Strategic Notes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4 text-primary" />
              Strategic Notes
              <span className="ml-auto text-xs text-muted-foreground font-normal">
                Auto-saves as you type
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Write strategic priorities, tactical plans, notes for Melvin, or anything that doesn't live in email/Notion/GHL. This feeds into tomorrow's routine context."
              className="min-h-[120px] resize-y"
              value={notesValue ?? data.notes ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setNotesValue(val);
                if (notesTimeout) clearTimeout(notesTimeout);
                setNotesTimeout(setTimeout(() => saveNotes.mutate(val), 1000));
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ContextCard({ icon, label, value, status }: { icon: ReactNode; label: string; value: string; status?: 'green' | 'red' }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium flex items-center gap-1.5">
        {status && (
          <span className={`h-2 w-2 rounded-full shrink-0 ${status === 'green' ? 'bg-emerald-500' : 'bg-red-500'}`} />
        )}
        {value}
      </div>
    </div>
  );
}
