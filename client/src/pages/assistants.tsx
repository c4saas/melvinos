import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Shield, Bot, Workflow, Link as LinkIcon, Network, Code2, Megaphone, TrendingUp, Search, Users2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssistantSummary } from "@shared/schema";
import { useLastAreaPreference } from "@/hooks/useLastAreaPreference";
import { useBranding } from '@/hooks/useBranding';

const SUBAGENT_EXAMPLES = [
  { label: "Coding", icon: Code2, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { label: "GHL Expert", icon: Network, color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  { label: "Social Media", icon: Megaphone, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { label: "Sales", icon: TrendingUp, color: "bg-green-500/10 text-green-400 border-green-500/20" },
  { label: "Research", icon: Search, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { label: "Marketing", icon: Users2, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
];

export default function SubagentsPage() {
  const { agentName } = useBranding();
  useLastAreaPreference('user');
  const { data: assistantsData, isLoading } = useQuery<{ assistants: AssistantSummary[] }>({
    queryKey: ['/api/assistants'],
    staleTime: 60000,
  });

  const assistants = assistantsData?.assistants ?? [];

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="border-b border-border/40 px-6 py-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <Network className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Subagents</h1>
            <p className="text-sm text-muted-foreground">
              Specialized workers called upon by {agentName} to handle complex, domain-specific tasks
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="space-y-6">
          {/* Subagent categories */}
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Subagent Types</h2>
            <div className="flex flex-wrap gap-2">
              {SUBAGENT_EXAMPLES.map(({ label, icon: Icon, color }) => (
                <div
                  key={label}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${color}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Active subagents */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Card key={n} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <Skeleton className="h-12 w-12 rounded-lg mb-3" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full mt-2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !assistants || assistants.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center">
              <Bot className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-medium text-muted-foreground">No subagents configured</h2>
              <p className="text-sm text-muted-foreground/80 mt-1">
                Subagents will appear here once they're added by your administrator
              </p>
            </div>
          ) : (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Active Subagents</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {assistants.map((assistant) => (
                  <Card
                    key={assistant.id}
                    className="overflow-hidden hover:shadow-lg transition-shadow border-muted/50"
                    data-testid={`assistant-card-${assistant.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Shield className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{assistant.name}</CardTitle>
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                              {assistant.type === "webhook" ? "Webhook" : "Prompt"}
                            </Badge>
                          </div>
                          {assistant.isActive && (
                            <div className="flex items-center gap-1 mt-1">
                              <Sparkles className="h-3 w-3 text-green-500" />
                              <span className="text-xs text-green-500 font-medium">Active</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {assistant.description && (
                        <CardDescription className="mt-2 text-sm">
                          {assistant.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    {assistant.type === "webhook" && (
                      <CardContent className="pt-0">
                        <div className="space-y-2 text-xs text-muted-foreground">
                          {assistant.workflowId && (
                            <div className="flex items-center gap-1.5">
                              <Workflow className="h-3 w-3" />
                              <span className="truncate">Workflow: {assistant.workflowId}</span>
                            </div>
                          )}
                          {assistant.webhookUrl && (
                            <div className="flex items-center gap-1.5">
                              <LinkIcon className="h-3 w-3" />
                              <span className="truncate">{assistant.webhookUrl}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
