import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { ChevronLeft, Cloud, FileText, Download, Loader2, CloudOff, Plus, Trash2, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { formatDistanceToNow } from 'date-fns';
import { useLastAreaPreference } from '@/hooks/useLastAreaPreference';
import { useBranding } from '@/hooks/useBranding';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: number;
  iconLink?: string;
  webViewLink?: string;
}

interface DriveFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

interface GoogleAccount {
  label: string;
  connectedAt: string | null;
  scopes: string[];
}

const GOOGLE_QUERY_KEYS = [
  '/api/integrations/google-drive/status',
  '/api/google-drive/files',
  '/api/integrations/gmail/status',
  '/api/integrations/calendar/status',
  '/api/integrations/google/accounts',
];

async function refreshGoogleQueries() {
  await Promise.all(GOOGLE_QUERY_KEYS.map(k => queryClient.invalidateQueries({ queryKey: [k] })));
  await Promise.all(GOOGLE_QUERY_KEYS.map(k => queryClient.refetchQueries({ queryKey: [k] })));
}

export default function GoogleDrivePage() {
  const { agentName } = useBranding();
  useLastAreaPreference('user');
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: GoogleAccount[] }>({
    queryKey: ['/api/integrations/google/accounts'],
    retry: false,
  });

  const accounts = accountsData?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  const { data: driveStatus } = useQuery<{ connected: boolean; needsAuth?: boolean; error?: string }>({
    queryKey: ['/api/integrations/google-drive/status'],
    retry: false,
  });

  const isConnected = driveStatus?.connected === true;

  const { data: filesData, isLoading: filesLoading, error: filesError } = useQuery<DriveFilesResponse>({
    queryKey: ['/api/google-drive/files'],
    enabled: isConnected,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      const label = params.get('label') ?? 'default';
      toast({
        title: 'Connected',
        description: `Google account "${label}" connected successfully`,
      });
      window.history.replaceState({}, '', '/google-drive');
      void refreshGoogleQueries();
      setAddingAccount(false);
      setNewLabel('');
    } else if (params.get('error')) {
      toast({
        title: 'Connection Failed',
        description: 'Failed to connect Google account. Please try again.',
        variant: 'destructive',
      });
      window.history.replaceState({}, '', '/google-drive');
    }
  }, [toast]);

  const { data: fileContent, isLoading: contentLoading } = useQuery<{ content: string; metadata: any }>({
    queryKey: ['/api/google-drive/file', selectedFile?.id],
    enabled: !!selectedFile && isConnected,
  });

  const handleConnectAccount = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    window.location.href = `/auth/google?label=${encodeURIComponent(trimmed)}`;
  };

  const handleDisconnect = async (label: string) => {
    try {
      const response = await apiRequest('DELETE', `/api/google-drive/disconnect?label=${encodeURIComponent(label)}`);
      if (!response.ok) throw new Error('Failed to disconnect');

      if (selectedFile) setSelectedFile(null);
      toast({ title: 'Disconnected', description: `Google account "${label}" disconnected` });
      void refreshGoogleQueries();
    } catch {
      toast({ title: 'Error', description: 'Failed to disconnect account', variant: 'destructive' });
    }
  };

  const handleFileClick = (file: DriveFile) => setSelectedFile(file);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const unauthorizedError = useMemo(() => {
    if (!filesError) return false;
    const error = filesError as any;
    return !!(error?.data?.needsAuth || error?.needsAuth || error?.status === 401 ||
      (typeof error?.message === 'string' && error.message.includes('401')));
  }, [filesError]);

  const needsAuth = driveStatus ? (!driveStatus.connected || unauthorizedError) : true;

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between p-6 border-b">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={() => navigate('/')}
            data-testid="button-back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Google Drive</h1>
          </div>
        </div>
        {hasAccounts && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAddingAccount(v => !v)}
          >
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        )}
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        {accountsLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAccounts ? (
          /* ── No accounts: onboarding state ── */
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="rounded-full bg-muted p-6">
              <CloudOff className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center max-w-md">
              <h2 className="text-2xl font-semibold mb-2">Connect Google Drive</h2>
              <p className="text-muted-foreground mb-6">
                Connect your Google accounts so {agentName} can access Drive, Gmail, and Calendar across all of them.
              </p>
              {addingAccount ? (
                <div className="flex flex-col gap-3 items-center">
                  <Input
                    placeholder="Account label (e.g. Work, Personal)"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    className="max-w-xs"
                    onKeyDown={e => e.key === 'Enter' && handleConnectAccount(newLabel)}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleConnectAccount(newLabel)}
                      disabled={!newLabel.trim()}
                      className="gap-2"
                    >
                      <Cloud className="h-4 w-4" />
                      Connect
                    </Button>
                    <Button variant="ghost" onClick={() => { setAddingAccount(false); setNewLabel(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => setAddingAccount(true)} className="gap-2" data-testid="button-connect-drive">
                  <Cloud className="h-4 w-4" />
                  Connect Google Account
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* ── Connected accounts list ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connected Accounts</CardTitle>
                <CardDescription>{agentName} can access Drive, Gmail, and Calendar from all of these accounts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {accounts.map(acc => (
                  <div key={acc.label} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserCircle2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{acc.label}</div>
                        {acc.connectedAt && (
                          <div className="text-xs text-muted-foreground">
                            Connected {formatDistanceToNow(new Date(acc.connectedAt), { addSuffix: true })}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {acc.scopes.includes('https://www.googleapis.com/auth/drive.readonly') && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">Drive</Badge>
                          )}
                          {acc.scopes.some(s => s.includes('gmail')) && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">Gmail</Badge>
                          )}
                          {acc.scopes.some(s => s.includes('calendar')) && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">Calendar</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive flex-shrink-0"
                      onClick={() => handleDisconnect(acc.label)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {/* Add account inline */}
                {addingAccount ? (
                  <div className="flex gap-2 items-center pt-1">
                    <Input
                      placeholder="Account label (e.g. Agency, Personal)"
                      value={newLabel}
                      onChange={e => setNewLabel(e.target.value)}
                      className="flex-1"
                      onKeyDown={e => e.key === 'Enter' && handleConnectAccount(newLabel)}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => handleConnectAccount(newLabel)}
                      disabled={!newLabel.trim()}
                    >
                      Connect
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setAddingAccount(false); setNewLabel(''); }}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* ── Files browser (primary account) ── */}
            {!needsAuth && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="flex flex-col">
                  <CardHeader>
                    <CardTitle>Your Files</CardTitle>
                    <CardDescription>From your primary connected account</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto">
                    {filesLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : filesError ? (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        Unable to load Drive files.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filesData?.files?.map((file) => (
                          <div
                            key={file.id}
                            onClick={() => handleFileClick(file)}
                            className={`p-3 rounded-lg border cursor-pointer transition-colors hover-elevate ${
                              selectedFile?.id === file.id ? 'bg-accent' : ''
                            }`}
                            data-testid={`file-item-${file.id}`}
                          >
                            <div className="flex items-start gap-3">
                              {file.iconLink ? (
                                <img src={file.iconLink} alt="" className="w-5 h-5 mt-0.5" />
                              ) : (
                                <FileText className="w-5 h-5 mt-0.5 text-muted-foreground" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate" data-testid={`file-name-${file.id}`}>
                                  {file.name}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {formatFileSize(file.size)}
                                  {file.modifiedTime && (
                                    <> · Modified {formatDistanceToNow(new Date(file.modifiedTime), { addSuffix: true })}</>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="flex flex-col">
                  <CardHeader>
                    <CardTitle>File Content</CardTitle>
                    <CardDescription>
                      {selectedFile ? selectedFile.name : 'Select a file to view'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto">
                    {!selectedFile ? (
                      <div className="flex items-center justify-center h-32 text-muted-foreground">
                        <p>No file selected</p>
                      </div>
                    ) : contentLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : fileContent ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-muted-foreground">{fileContent.metadata.mimeType}</div>
                          {selectedFile.webViewLink && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(selectedFile.webViewLink, '_blank')}
                              className="gap-2"
                              data-testid="button-open-in-drive"
                            >
                              <Download className="h-3 w-3" />
                              Open in Drive
                            </Button>
                          )}
                        </div>
                        <div className="p-4 bg-muted rounded-lg">
                          <pre className="whitespace-pre-wrap text-sm font-mono" data-testid="file-content">
                            {fileContent.content}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 text-muted-foreground">
                        <p>Failed to load file content</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
