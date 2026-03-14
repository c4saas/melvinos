import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Save, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { DEFAULT_SYSTEM_PROMPT, PERMISSIONS } from '@shared/constants';
import { usePermissions } from '@/hooks/use-permissions';
import type { AdminSystemPrompt, AdminSystemPromptListResponse, AdminSystemPromptMutationResponse } from './types';
import { useBranding } from '@/hooks/useBranding';
import { useAdminLayout } from '@/components/AdminLayout';

export default function SystemPromptsPage() {
  const { toast } = useToast();
  const { agentName } = useBranding();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: isAuthLoading } = useAuth();
  const { canEdit } = usePermissions();
  const [, setLocation] = useLocation();
  const { setHeader, resetHeader } = useAdminLayout();

  const canEditSystemPrompts = canEdit(PERMISSIONS.SYSTEM_PROMPTS_VIEW);
  const isViewOnly = !canEditSystemPrompts;

  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const query = useQuery<AdminSystemPromptListResponse>({
    queryKey: ['admin-system-prompts'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/system-prompts');
      return res.json() as Promise<AdminSystemPromptListResponse>;
    },
    enabled: isAdmin,
  });

  const prompts = query.data?.systemPrompts ?? [];
  const activeId = query.data?.activeSystemPromptId ?? null;
  const activePrompt = prompts.find((p) => p.id === activeId) ?? prompts[0] ?? null;
  const stalePrompts = prompts.filter((p) => p.id !== activeId);

  // Load active content into editor on first fetch
  useEffect(() => {
    if (activePrompt && !isDirty) {
      setContent(activePrompt.content);
    }
  }, [activePrompt?.id]);

  useEffect(() => {
    setHeader({ title: 'System Prompt', description: `The instructions ${agentName} follows in every conversation.` });
    return () => resetHeader();
  }, [setHeader, resetHeader]);

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) setLocation('/');
  }, [isAdmin, isAuthLoading, setLocation]);

  // Save: update active prompt in-place, or create if none exists
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (activePrompt) {
        // Update the existing active prompt in-place — no new version created
        const res = await apiRequest('PATCH', `/api/admin/system-prompts/${activePrompt.id}`, {
          content,
          activate: true,
        });
        return res.json() as Promise<AdminSystemPromptMutationResponse>;
      } else {
        // First-time setup — create and activate
        const res = await apiRequest('POST', '/api/admin/system-prompts', {
          content,
          activate: true,
        });
        return res.json() as Promise<AdminSystemPromptMutationResponse>;
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<AdminSystemPromptListResponse>(['admin-system-prompts'], {
        systemPrompts: result.systemPrompts,
        activeSystemPromptId: result.activeSystemPromptId,
      });
      setIsDirty(false);
      toast({ title: 'System prompt saved', description: `${agentName} will use this prompt in all future conversations.` });
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  });

  // Delete all old (non-active) versions
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      for (const p of stalePrompts) {
        await apiRequest('DELETE', `/api/admin/system-prompts/${p.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-system-prompts'] });
      toast({ title: `Cleared ${stalePrompts.length} old version${stalePrompts.length === 1 ? '' : 's'}` });
    },
    onError: () => toast({ title: 'Cleanup failed', variant: 'destructive' }),
  });

  if (query.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-lg">System Prompt</CardTitle>
                <CardDescription>
                  This is the core instruction set {agentName} follows in every conversation, across all channels.
                </CardDescription>
              </div>
              {isViewOnly && <Badge variant="secondary">View Only</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isViewOnly && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  You have view-only access. Only Super Admins can edit the system prompt.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="system-prompt-content">Prompt content</Label>
                {!isViewOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground h-7 text-xs"
                    onClick={() => { setContent(DEFAULT_SYSTEM_PROMPT); setIsDirty(true); }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset to default
                  </Button>
                )}
              </div>
              <Textarea
                id="system-prompt-content"
                value={content}
                onChange={(e) => { setContent(e.target.value); setIsDirty(true); }}
                className="min-h-[420px] font-mono text-xs"
                disabled={isViewOnly}
              />
            </div>

            {!isViewOnly && (
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  {stalePrompts.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground text-xs"
                      onClick={() => cleanupMutation.mutate()}
                      disabled={cleanupMutation.isPending}
                    >
                      {cleanupMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Trash2 className="h-3 w-3" />}
                      Clear {stalePrompts.length} old version{stalePrompts.length === 1 ? '' : 's'}
                    </Button>
                  )}
                </div>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !isDirty || !content.trim()}
                  className="gap-2"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
