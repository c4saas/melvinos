import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Workflow,
  Clock,
  CheckCircle2,
  Circle,
  ArrowRight,
  Sparkles,
  Calendar,
  Mail,
  TrendingUp,
  Shield,
  FileText,
  Bot,
  Database,
  Loader2,
  Play,
} from 'lucide-react';

import { useUserTimezone } from '@/hooks/useUserTimezone';
import { cronScheduleLabel, fmtDateTime } from '@/lib/dateUtils';

interface WorkflowStep {
  order: number;
  name: string;
  description: string;
  tool: string;
  icon: string;
}

interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  schedule: string;
  scheduleHuman: string;
  jobTimezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  steps: WorkflowStep[];
  outputs: string[];
}

function StepIcon({ name }: { name: string }): JSX.Element {
  switch (name) {
    case 'calendar': return <Calendar className="h-4 w-4 text-blue-500" />;
    case 'mail': return <Mail className="h-4 w-4 text-red-500" />;
    case 'pipeline': return <TrendingUp className="h-4 w-4 text-green-500" />;
    case 'system': return <Shield className="h-4 w-4 text-emerald-500" />;
    case 'database': return <Database className="h-4 w-4 text-purple-500" />;
    case 'agent': return <Bot className="h-4 w-4 text-amber-500" />;
    case 'report': return <FileText className="h-4 w-4 text-blue-500" />;
    default: return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}


export default function WorkflowsPage() {
  const userTz = useUserTimezone();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: workflows, isLoading } = useQuery<WorkflowDefinition[]>({
    queryKey: ['/api/workflows'],
    staleTime: 60000,
  });

  const runWorkflow = useMutation({
    mutationFn: async (workflowId: string) => {
      const res = await apiRequest('POST', `/api/workflows/${workflowId}/run`);
      return res.json();
    },
    onSuccess: (_data, _vars) => {
      toast({ title: 'Workflow triggered', description: 'Running now. Check your chat for results.' });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to trigger workflow', description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="icon">
              <Link href="/">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Workflow className="h-5 w-5 text-primary" />
                Melvin's Workflows
              </h1>
              <p className="text-sm text-muted-foreground">
                Automated processes that run on a schedule. Review what Melvin does and when.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {(!workflows || workflows.length === 0) ? (
          <div className="text-center py-20 text-muted-foreground">
            No workflows configured yet.
          </div>
        ) : (
          workflows.map((wf) => (
            <Card key={wf.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-base">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {wf.name}
                      <Badge variant={wf.enabled ? 'default' : 'secondary'} className="text-xs">
                        {wf.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{wf.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={runWorkflow.isPending}
                      onClick={() => runWorkflow.mutate(wf.id)}
                      title="Run now"
                    >
                      {runWorkflow.isPending && runWorkflow.variables === wf.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Play className="h-4 w-4" />}
                    </Button>
                    <div className="text-right">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {cronScheduleLabel(wf.schedule, wf.nextRunAt, userTz)}
                      </div>
                      {wf.lastRunAt && (
                        <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                          Last: {fmtDateTime(wf.lastRunAt, userTz)}
                        </div>
                      )}
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Step-by-step pipeline */}
                <div className="space-y-0">
                  {wf.steps.map((step, i) => (
                    <div key={step.order} className="flex items-start gap-3">
                      {/* Vertical connector */}
                      <div className="flex flex-col items-center">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                          i === 0 ? 'border-primary bg-primary/10' : 'border-border bg-muted/50'
                        }`}>
                          <StepIcon name={step.icon} />
                        </div>
                        {i < wf.steps.length - 1 && (
                          <div className="w-0.5 h-8 bg-border" />
                        )}
                      </div>

                      {/* Step content */}
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground tabular-nums">
                            Step {step.order}
                          </span>
                          <span className="text-sm font-medium">{step.name}</span>
                          <Badge variant="outline" className="text-[10px] font-mono">{step.tool}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Outputs */}
                {wf.outputs.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground">Outputs:</span>
                      {wf.outputs.map((out, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{out}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
