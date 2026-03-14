import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CommandCenter } from '@/components/CommandCenter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FolderOpen,
  File,
  FileText,
  FileCode,
  Image,
  Trash2,
  Download,
  Eye,
  Loader2,
  RefreshCw,
  ArrowLeft,
  ChevronLeft,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return Image;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'sh', 'json', 'yaml', 'yml', 'toml'].includes(ext)) return FileCode;
  if (['md', 'txt', 'csv', 'log'].includes(ext)) return FileText;
  return File;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WorkspacePage() {
  const [currentPath, setCurrentPath] = useState('');
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<{ entries: WorkspaceEntry[] }>({
    queryKey: ['workspace-files', currentPath],
    queryFn: async () => {
      const params = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
      const res = await apiRequest('GET', `/api/workspace/files${params}`);
      return res.json();
    },
  });

  const entries = data?.entries ?? [];
  const dirs = entries.filter(e => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => e.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

  const previewMutation = useMutation({
    mutationFn: async (filePath: string) => {
      const res = await apiRequest('GET', `/api/workspace/files/read?path=${encodeURIComponent(filePath)}`);
      return res.json();
    },
    onSuccess: (data) => {
      setPreviewFile(data);
    },
    onError: (err: Error) => {
      toast({ title: 'Cannot preview file', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (filePath: string) => {
      await apiRequest('DELETE', `/api/workspace/files?path=${encodeURIComponent(filePath)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-files'] });
      setDeleteConfirm(null);
      toast({ title: 'File deleted' });
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to delete', description: err.message, variant: 'destructive' });
    },
  });

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const goUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  }, [currentPath]);

  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <CommandCenter>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/">
              <button className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent transition-colors -ml-1" aria-label="Back">
                <ChevronLeft className="h-5 w-5" />
              </button>
            </Link>
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">Workspace</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Files created by the agent during conversations
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 border-b px-6 py-2 text-sm">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCurrentPath('')}
          >
            workspace
          </button>
          {breadcrumbs.map((part, i) => {
            const pathUpTo = breadcrumbs.slice(0, i + 1).join('/');
            return (
              <span key={pathUpTo} className="flex items-center gap-1.5">
                <span className="text-muted-foreground/50">/</span>
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setCurrentPath(pathUpTo)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm font-medium">No files yet</p>
              <p className="text-xs mt-1">Files created by the agent will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {currentPath && (
                <button
                  onClick={goUp}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-accent/50 transition-colors text-sm"
                >
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">..</span>
                </button>
              )}
              {dirs.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigateTo(entry.path)}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-accent/50 transition-colors text-sm"
                >
                  <FolderOpen className="h-4 w-4 text-blue-500" />
                  <span className="flex-1 text-left font-medium">{entry.name}</span>
                </button>
              ))}
              {files.map((entry) => {
                const Icon = getFileIcon(entry.name);
                return (
                  <div
                    key={entry.path}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-accent/50 transition-colors text-sm group"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-left">{entry.name}</span>
                    <span className="text-xs text-muted-foreground">{formatSize(entry.size)}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => previewMutation.mutate(entry.path)}
                        title="Preview"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          window.open(`/api/workspace/files/download?path=${encodeURIComponent(entry.path)}`, '_blank');
                        }}
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirm(entry.path)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewFile !== null} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{previewFile?.path}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh] rounded-md bg-muted p-4">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {previewFile?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <code className="font-mono text-xs">{deleteConfirm}</code>.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommandCenter>
  );
}
