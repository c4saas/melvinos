import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, User, Settings, Trash2, Plus, Brain, History, Upload, Camera, LogOut, Book, FileText, ExternalLink, Type, Loader2, ChevronDown, Infinity, Sliders, Globe, MapPin, LinkIcon, CheckCircle2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { formatFileUploadLimitLabel, DEFAULT_FILE_UPLOAD_LIMITS_MB } from '@shared/schema';
import type { UserPlan } from '@shared/schema';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useBranding } from '@/hooks/useBranding';
import { TIMEZONES } from '@/lib/timezones';
import { useUserTimezone } from '@/hooks/useUserTimezone';
import { fmtDate } from '@/lib/dateUtils';

interface ProfileSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user?: {
    id: string;
    username: string;
    email?: string;
    plan?: string;
  };
  defaultTab?: string;
}

interface UserPreferences {
  personalizationEnabled: boolean;
  customInstructions: string;
  name: string;
  occupation: string;
  bio: string;
  profileImageUrl?: string;
  memories: string[];
  chatHistoryEnabled: boolean;
  autonomousCodeExecution: boolean;
  lastArea?: 'user' | 'admin';
  enabledSkills?: string[];
  company?: string;
  timezone?: string;
  location?: string;
  website?: string;
}

interface KnowledgeItem {
  id: string;
  type: 'file' | 'url' | 'text';
  title: string;
  content: string;
  createdAt?: string;
}

const themeOptions: Array<{ value: 'light' | 'dark' | 'system'; label: string; helper: string }> = [
  {
    value: 'system',
    label: 'Match system',
    helper: 'Follow your device appearance settings automatically.',
  },
  {
    value: 'light',
    label: 'Light',
    helper: 'Bright background with higher contrast for daylight environments.',
  },
  {
    value: 'dark',
    label: 'Dark',
    helper: 'Dimmed interface that is easier on the eyes at night.',
  },
];

interface AgentMemory {
  id: string;
  category: string;
  content: string;
  source?: string;
  createdAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  fact: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  procedure: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  context: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

function AgentMemoriesSection() {
  const { toast } = useToast();
  const { agentName } = useBranding();
  const [newMemory, setNewMemory] = useState('');

  const { data, isLoading, refetch } = useQuery<{ memories: AgentMemory[] }>({
    queryKey: ['/api/agent/memories'],
    queryFn: () => apiRequest('GET', '/api/agent/memories').then(r => r.json()),
  });

  const memories = data?.memories ?? [];

  const createMutation = useMutation({
    mutationFn: (content: string) =>
      apiRequest('POST', '/api/agent/memories', { content, category: 'fact', source: 'user' }).then(r => r.json()),
    onSuccess: () => {
      setNewMemory('');
      refetch();
    },
    onError: () => toast({ title: 'Failed to save memory', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('DELETE', `/api/agent/memories/${id}`).then(r => r.json()),
    onSuccess: () => refetch(),
    onError: () => toast({ title: 'Failed to delete memory', variant: 'destructive' }),
  });

  const handleAdd = () => {
    if (newMemory.trim()) createMutation.mutate(newMemory.trim());
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs sm:text-sm">Saved Memories ({memories.length})</Label>
        {memories.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{memories.length} total</span>
        )}
      </div>

      <ScrollArea className="h-[180px] rounded-lg border p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : memories.length === 0 ? (
          <p className="text-xs sm:text-sm text-muted-foreground">
            No memories saved yet. {agentName} will save things here automatically as you chat.
          </p>
        ) : (
          <div className="space-y-2">
            {memories.map((memory) => (
              <div key={memory.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-muted/50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium capitalize', CATEGORY_COLORS[memory.category] ?? 'bg-muted text-muted-foreground')}>
                      {memory.category}
                    </span>
                    {memory.source && memory.source !== 'user' && (
                      <span className="text-[10px] text-muted-foreground">via {memory.source}</span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm">{memory.content}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(memory.id)}
                  disabled={deleteMutation.isPending}
                  className="h-6 w-6 p-0 shrink-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="flex gap-2">
        <Input
          placeholder="Add a memory manually..."
          value={newMemory}
          onChange={(e) => setNewMemory(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button
          onClick={handleAdd}
          size="sm"
          disabled={!newMemory.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function ConnectedAccountsCard() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ accounts: { label: string; email?: string | null; connectedAt: string | null }[] }>({
    queryKey: ['google-accounts'],
    queryFn: async () => { const r = await apiRequest('GET', '/api/integrations/google/accounts'); return r.json(); },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', '/api/google-drive/disconnect');
    },
    onSuccess: () => { refetch(); toast({ title: 'Google account disconnected' }); },
    onError: () => { toast({ title: 'Failed to disconnect', variant: 'destructive' }); },
  });

  const accounts = data?.accounts ?? [];
  const isConnected = accounts.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm sm:text-lg">Connected Accounts</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Link external accounts to enable Google Calendar, Gmail, and Drive access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 p-3 sm:p-4">
          <div className="flex items-center gap-3 min-w-0">
            <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium">Google</p>
              {isConnected ? (
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  {accounts[0].email || (accounts[0].label !== 'default' ? accounts[0].label : 'Connected')}
                </p>
              ) : (
                <p className="text-[10px] sm:text-xs text-muted-foreground">Not connected</p>
              )}
            </div>
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
          ) : isConnected ? (
            <div className="flex items-center gap-2 flex-shrink-0">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Disconnect'}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 flex-shrink-0"
              onClick={() => { window.location.href = '/auth/google'; }}
            >
              Connect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileSettingsDialog({ isOpen, onClose, user, defaultTab }: ProfileSettingsDialogProps) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { agentName } = useBranding();
  const userTz = useUserTimezone();
  const [activeTab, setActiveTab] = useState('profile');
  const { theme, setTheme } = useTheme();
  const selectedThemeOption = themeOptions.find((option) => option.value === theme) ?? themeOptions[0];

  // Form state
  const [preferences, setPreferences] = useState<UserPreferences>({
    personalizationEnabled: false,
    customInstructions: '',
    name: '',
    occupation: '',
    bio: '',
    profileImageUrl: '',
    memories: [],
    chatHistoryEnabled: true,
    autonomousCodeExecution: true,
    lastArea: 'user',
    enabledSkills: [],
    company: '',
    timezone: '',
    location: '',
    website: '',
  });

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordChangeExpanded, setIsPasswordChangeExpanded] = useState(false);

  // Archived chats state
  const [isArchivedChatsExpanded, setIsArchivedChatsExpanded] = useState(false);

  // Knowledge tab state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [knowledgeUrl, setKnowledgeUrl] = useState('');
  const [knowledgeUrlTitle, setKnowledgeUrlTitle] = useState('');
  const [knowledgeTextTitle, setKnowledgeTextTitle] = useState('');
  const [knowledgeTextContent, setKnowledgeTextContent] = useState('');
  const [uploadFileOpen, setUploadFileOpen] = useState(false);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [addTextOpen, setAddTextOpen] = useState(false);
  const knowledgeFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab, isOpen]);

  // Fetch user preferences
  const { data: fetchedPreferences } = useQuery<UserPreferences>({
    queryKey: ['/api/user/preferences'],
    enabled: isOpen,
  });

  // Fetch knowledge items
  const { data: knowledgeItems, isLoading: knowledgeLoading } = useQuery<KnowledgeItem[]>({
    queryKey: ['/api/knowledge'],
    enabled: isOpen && activeTab === 'context',
  });

  // Fetch archived chats
  const { data: archivedChats, isLoading: archivedLoading } = useQuery<any[]>({
    queryKey: ['/api/chats/archived'],
  });

  // File upload limit
  const resolvePlan = (value?: string | null): UserPlan => (value === 'pro' || value === 'enterprise' ? value : 'free');
  const planFromUser: UserPlan = resolvePlan(user?.plan);
  const effectiveFileUploadLimitMb = DEFAULT_FILE_UPLOAD_LIMITS_MB[planFromUser] ?? DEFAULT_FILE_UPLOAD_LIMITS_MB.free ?? null;
  const knowledgeFileLimitLabel =
    effectiveFileUploadLimitMb === null
      ? 'Unlimited per file'
      : `${formatFileUploadLimitLabel(effectiveFileUploadLimitMb)} per file`;

  // Update local state when preferences are fetched
  useEffect(() => {
    if (fetchedPreferences) {
      setPreferences({
        ...fetchedPreferences,
        lastArea: fetchedPreferences.lastArea ?? 'user',
        enabledSkills: fetchedPreferences.enabledSkills ?? [],
      });
    }
  }, [fetchedPreferences]);

  // Save preferences mutation
  const savePreferencesMutation = useMutation({
    mutationFn: async (prefs: UserPreferences) => {
      const response = await apiRequest('POST', '/api/user/preferences', prefs);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/preferences'] });
      toast({
        title: 'Settings saved',
        description: 'Your preferences have been updated successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save preferences. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    savePreferencesMutation.mutate(preferences);
  };

  // Upload file mutation
  const uploadFileMutation = useMutation({
    mutationFn: async (payload: { name: string; mimeType: string; data: string }) => {
      return await apiRequest('POST', '/api/knowledge/file', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      setSelectedFile(null);
      setUploadFileOpen(false);
      if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = '';
      toast({
        title: 'File uploaded',
        description: 'Your file has been added to your personal context.',
      });
    },
    onError: (error: unknown) => {
      const description =
        error instanceof Error ? error.message : 'Failed to upload file. Please try again.';
      toast({
        title: 'Upload failed',
        description,
        variant: 'destructive',
      });
    },
  });

  // Add URL mutation
  const addUrlMutation = useMutation({
    mutationFn: async (data: { url: string; title?: string }) => {
      return await apiRequest('POST', '/api/knowledge/url', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      setKnowledgeUrl('');
      setKnowledgeUrlTitle('');
      setAddUrlOpen(false);
      toast({
        title: 'URL added',
        description: 'The URL has been added to your personal context.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to add URL',
        description: 'Failed to add URL. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Add text mutation
  const addTextMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; type: 'text' }) => {
      return await apiRequest('POST', '/api/knowledge/text', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      setKnowledgeTextTitle('');
      setKnowledgeTextContent('');
      setAddTextOpen(false);
      toast({
        title: 'Text added',
        description: 'Your text has been added to your personal context.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to add text',
        description: 'Failed to add text. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Delete knowledge mutation
  const deleteKnowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge'] });
      toast({
        title: 'Item deleted',
        description: 'The context item has been removed.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to delete',
        description: 'Failed to delete item. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      return await apiRequest('POST', '/api/auth/change-password', data);
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordChangeExpanded(false);
      toast({
        title: 'Password changed',
        description: 'Your password has been successfully updated.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to change password',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: 'Missing information',
        description: 'Please fill in all password fields.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'New password and confirm password must match.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: 'Password too short',
        description: 'Password must be at least 8 characters.',
        variant: 'destructive',
      });
      return;
    }

    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  // Restore archived chat mutation
  const restoreChatMutation = useMutation({
    mutationFn: async (chatId: string) => {
      return await apiRequest('PATCH', `/api/chats/${chatId}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats/archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      toast({
        title: 'Chat restored',
        description: 'The chat has been restored to your active chats.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to restore',
        description: 'Failed to restore chat. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Permanently delete chat mutation
  const permanentDeleteChatMutation = useMutation({
    mutationFn: async (chatId: string) => {
      return await apiRequest('DELETE', `/api/chats/${chatId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats/archived'] });
      toast({
        title: 'Chat deleted',
        description: 'The chat has been permanently deleted.',
      });
    },
    onError: () => {
      toast({
        title: 'Delete failed',
        description: 'Failed to delete item. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 10MB.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsUploadingImage(true);

      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxSize = 400;

        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }

        const base64String = canvas.toDataURL('image/jpeg', 0.85);

        setPreferences(prev => ({
          ...prev,
          profileImageUrl: base64String,
        }));
        setIsUploadingImage(false);
      };

      img.onerror = () => {
        toast({
          title: 'Upload failed',
          description: 'Failed to process image file.',
          variant: 'destructive',
        });
        setIsUploadingImage(false);
      };

      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        toast({
          title: 'Upload failed',
          description: 'Failed to read image file.',
          variant: 'destructive',
        });
        setIsUploadingImage(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Image upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'An error occurred while uploading the image.',
        variant: 'destructive',
      });
      setIsUploadingImage(false);
    }
  };

  const handleRemoveImage = () => {
    setPreferences(prev => ({
      ...prev,
      profileImageUrl: '',
    }));
  };

  const getInitials = () => {
    if (preferences.name) {
      return preferences.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    }
    return user?.email?.[0]?.toUpperCase() || '?';
  };

  // Knowledge handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload PDF, DOC, or TXT files only.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleUploadFile = () => {
    if (!selectedFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Content = e.target?.result as string | undefined;
      if (!base64Content) {
        toast({
          title: 'Upload failed',
          description: 'Failed to process file contents.',
          variant: 'destructive',
        });
        return;
      }

      const commaIndex = base64Content.indexOf(',');
      const base64Data = commaIndex !== -1 ? base64Content.substring(commaIndex + 1) : base64Content;

      if (!base64Data) {
        toast({
          title: 'Upload failed',
          description: 'File data was empty after processing.',
          variant: 'destructive',
        });
        return;
      }

      uploadFileMutation.mutate({
        name: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        data: base64Data,
      });
    };
    reader.onerror = () => {
      toast({
        title: 'Upload failed',
        description: 'Failed to read file.',
        variant: 'destructive',
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleAddUrl = () => {
    if (!knowledgeUrl.trim()) return;

    try {
      new URL(knowledgeUrl);
      addUrlMutation.mutate({
        url: knowledgeUrl,
        title: knowledgeUrlTitle || undefined,
      });
    } catch {
      toast({
        title: 'Invalid URL',
        description: 'Please enter a valid URL.',
        variant: 'destructive',
      });
    }
  };

  const handleAddText = () => {
    if (!knowledgeTextTitle.trim() || !knowledgeTextContent.trim()) return;

    addTextMutation.mutate({
      title: knowledgeTextTitle,
      content: knowledgeTextContent,
      type: 'text',
    });
  };

  const getKnowledgeIcon = (type: string) => {
    switch (type) {
      case 'file':
        return FileText;
      case 'url':
        return ExternalLink;
      case 'text':
        return Type;
      default:
        return FileText;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex flex-col gap-0 w-[calc(100vw-2rem)] sm:max-w-3xl h-[90vh] sm:h-[85vh] p-0 rounded-2xl overflow-hidden">
        <DialogHeader className="flex-shrink-0 p-4 sm:p-6 pb-3">
          <DialogTitle className="text-base sm:text-2xl font-semibold">Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-shrink-0 px-4 sm:px-6 overflow-x-auto scrollbar-none border-b border-border/40">
            <TabsList className="inline-flex w-auto sm:grid sm:grid-cols-5 text-[11px] sm:text-sm gap-0.5 sm:gap-0 mb-0">
              <TabsTrigger value="profile" className="gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                <User className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>Profile</span>
              </TabsTrigger>
              <TabsTrigger value="memory" className="gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                <History className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>Memories</span>
              </TabsTrigger>
              <TabsTrigger value="context" className="gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                <Book className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>Knowledge</span>
              </TabsTrigger>
              <TabsTrigger value="agent-prefs" className="gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                <Sliders className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>Agent</span>
              </TabsTrigger>
              <TabsTrigger value="account" className="gap-1 sm:gap-2 whitespace-nowrap px-2 sm:px-3">
                <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>Account</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 min-h-0">

            {/* ═══════════════ TAB 1: PROFILE ═══════════════ */}
            <TabsContent value="profile" className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6 mt-4 sm:mt-6 overflow-x-hidden">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Profile Information</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Help {agentName} understand who you are and your background
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 sm:space-y-5">
                  {/* Profile Picture Upload */}
                  <div>
                    <Label>Profile Picture</Label>
                    <div className="flex items-center gap-4 mt-2">
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={preferences.profileImageUrl} />
                        <AvatarFallback className="text-xl">{getInitials()}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                          data-testid="input-profile-image"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingImage}
                          data-testid="button-upload-image"
                        >
                          <Camera className="h-4 w-4 mr-2" />
                          {isUploadingImage ? 'Uploading...' : 'Upload photo'}
                        </Button>
                        {preferences.profileImageUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleRemoveImage}
                            className="text-destructive"
                            data-testid="button-remove-image"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Maximum file size: 10MB. Images will be optimized automatically.
                    </p>
                  </div>

                  <Separator />

                  <div>
                    <Label htmlFor="name" className="text-xs sm:text-sm">Name</Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      value={preferences.name}
                      onChange={(e) => setPreferences(prev => ({ ...prev, name: e.target.value }))}
                      className="mt-1"
                      data-testid="input-name"
                    />
                  </div>

                  {/* Timezone + Location — top priority so agent always uses correct context */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                    <div>
                      <Label htmlFor="timezone" className="text-xs sm:text-sm flex items-center gap-1.5 font-medium">
                        <Globe className="h-3 w-3 text-blue-500" />
                        Timezone <span className="text-blue-500 text-xs font-normal">(used by all AI features)</span>
                      </Label>
                      <Select
                        value={preferences.timezone ?? ''}
                        onValueChange={(v) => setPreferences(prev => ({ ...prev, timezone: v }))}
                      >
                        <SelectTrigger id="timezone" className="mt-1" data-testid="select-timezone">
                          <SelectValue placeholder="Select your timezone..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="location" className="text-xs sm:text-sm flex items-center gap-1.5 font-medium">
                        <MapPin className="h-3 w-3 text-blue-500" />
                        Location <span className="text-blue-500 text-xs font-normal">(city or region)</span>
                      </Label>
                      <Input
                        id="location"
                        placeholder="e.g., Dallas, TX"
                        value={preferences.location ?? ''}
                        onChange={(e) => setPreferences(prev => ({ ...prev, location: e.target.value }))}
                        className="mt-1"
                        data-testid="input-location"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="occupation" className="text-xs sm:text-sm">Occupation / Role</Label>
                    <Input
                      id="occupation"
                      placeholder="e.g., Software Engineer, Marketing Director, Student"
                      value={preferences.occupation}
                      onChange={(e) => setPreferences(prev => ({ ...prev, occupation: e.target.value }))}
                      className="mt-1"
                      data-testid="input-occupation"
                    />
                  </div>

                  <div>
                    <Label htmlFor="company" className="text-xs sm:text-sm">Company or Brand</Label>
                    <Input
                      id="company"
                      placeholder="e.g., Acme Corp, My Brand"
                      value={preferences.company ?? ''}
                      onChange={(e) => setPreferences(prev => ({ ...prev, company: e.target.value }))}
                      className="mt-1"
                      data-testid="input-company"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="about-me" className="text-xs sm:text-sm">About Me</Label>
                    <Textarea
                      id="about-me"
                      placeholder={`Tell ${agentName} about your interests, goals, or anything that helps personalize your experience...`}
                      value={preferences.bio}
                      onChange={(e) => setPreferences(prev => ({ ...prev, bio: e.target.value }))}
                      className="mt-1 min-h-[80px]"
                      data-testid="textarea-about-me"
                    />
                  </div>

                  <Separator />

                  <div>
                    <Label htmlFor="website" className="text-xs sm:text-sm flex items-center gap-1.5">
                      <LinkIcon className="h-3 w-3" />
                      Website
                    </Label>
                    <Input
                      id="website"
                      placeholder="https://yoursite.com"
                      value={preferences.website ?? ''}
                      onChange={(e) => setPreferences(prev => ({ ...prev, website: e.target.value }))}
                      className="mt-1"
                      data-testid="input-website"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══════════════ TAB 2: MEMORY & CONTEXT ═══════════════ */}
            <TabsContent value="memory" className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6 mt-4 sm:mt-6 overflow-x-hidden">
              {/* Personalization Toggle */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <div>
                      <CardTitle className="text-sm sm:text-lg">Enable Personalization</CardTitle>
                      <CardDescription className="mt-1 text-xs sm:text-sm">
                        Allow {agentName} to remember information about you to provide personalized responses
                      </CardDescription>
                    </div>
                    <Switch
                      checked={preferences.personalizationEnabled}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, personalizationEnabled: checked }))}
                      data-testid="switch-personalization"
                    />
                  </div>
                </CardHeader>
              </Card>

              {/* Memory Management */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">{`What ${agentName} Remembers`}</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Memories {agentName} has saved during conversations, plus notes you add manually
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={preferences.chatHistoryEnabled}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, chatHistoryEnabled: checked }))}
                      data-testid="switch-chat-history"
                    />
                    <Label htmlFor="chat-history" className="cursor-pointer text-xs sm:text-sm">
                      <div className="flex items-center gap-2">
                        <History className="h-3 w-3 sm:h-4 sm:w-4" />
                        Reference chat history
                      </div>
                    </Label>
                  </div>

                  <Separator />

                  <AgentMemoriesSection />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══════════════ TAB 3: PERSONAL CONTEXT ═══════════════ */}
            <TabsContent value="context" className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6 mt-4 sm:mt-6 overflow-x-hidden">
              {/* Context Items List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Files and Notes</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Documents, URLs, and notes that {agentName} can reference when helping you
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  {knowledgeLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : knowledgeItems && knowledgeItems.length > 0 ? (
                    <div className="space-y-2">
                      {knowledgeItems.map((item) => {
                        const ItemIcon = getKnowledgeIcon(item.type);
                        return (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-3 p-3 rounded-lg border hover-elevate"
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <ItemIcon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0">
                                <h4 className="text-xs sm:text-sm font-medium truncate">{item.title}</h4>
                                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {item.content?.substring(0, 80)}...
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteKnowledgeMutation.mutate(item.id)}
                              disabled={deleteKnowledgeMutation.isPending}
                              className="flex-shrink-0"
                            >
                              <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 sm:py-8">
                      <Book className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground/50 mb-2 sm:mb-3" />
                      <p className="text-xs sm:text-sm text-muted-foreground">No personal context added yet</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                        Add files, URLs, or notes to give {agentName} more background about you
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Upload File */}
              <Collapsible open={uploadFileOpen} onOpenChange={setUploadFileOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          <div>
                            <CardTitle className="text-sm sm:text-lg">Upload File</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">
                              Upload PDF, DOC, or TXT files ({knowledgeFileLimitLabel})
                            </CardDescription>
                          </div>
                        </div>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', uploadFileOpen && 'rotate-180')} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3 sm:space-y-4 pt-0">
                      <input
                        ref={knowledgeFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.txt"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      {selectedFile && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                          <FileText className="h-4 w-4" />
                          <span className="text-xs sm:text-sm flex-1 truncate">{selectedFile.name}</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground">
                            {(selectedFile.size / 1024).toFixed(1)} KB
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedFile(null);
                              if (knowledgeFileInputRef.current) knowledgeFileInputRef.current.value = '';
                            }}
                            className="h-6 w-6 p-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => knowledgeFileInputRef.current?.click()}
                        >
                          Choose File
                        </Button>
                        <Button
                          onClick={handleUploadFile}
                          disabled={!selectedFile || uploadFileMutation.isPending}
                        >
                          {uploadFileMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 mr-2" />
                          )}
                          Upload
                        </Button>
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Add URL */}
              <Collapsible open={addUrlOpen} onOpenChange={setAddUrlOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-4 w-4" />
                          <div>
                            <CardTitle className="text-sm sm:text-lg">Add URL</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">
                              Add a URL for {agentName} to reference
                            </CardDescription>
                          </div>
                        </div>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', addUrlOpen && 'rotate-180')} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3 sm:space-y-4 pt-0">
                      <div>
                        <Label htmlFor="knowledge-url" className="text-xs sm:text-sm">URL</Label>
                        <Input
                          id="knowledge-url"
                          placeholder="https://example.com"
                          value={knowledgeUrl}
                          onChange={(e) => setKnowledgeUrl(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="knowledge-url-title" className="text-xs sm:text-sm">Title (optional)</Label>
                        <Input
                          id="knowledge-url-title"
                          placeholder="Enter a custom title"
                          value={knowledgeUrlTitle}
                          onChange={(e) => setKnowledgeUrlTitle(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <Button
                        onClick={handleAddUrl}
                        disabled={!knowledgeUrl.trim() || addUrlMutation.isPending}
                      >
                        {addUrlMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        Add URL
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Add Text */}
              <Collapsible open={addTextOpen} onOpenChange={setAddTextOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Type className="h-4 w-4" />
                          <div>
                            <CardTitle className="text-sm sm:text-lg">Add Text</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">
                              Add custom notes or text for {agentName} to reference
                            </CardDescription>
                          </div>
                        </div>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', addTextOpen && 'rotate-180')} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3 sm:space-y-4 pt-0">
                      <div>
                        <Label htmlFor="knowledge-text-title" className="text-xs sm:text-sm">Title</Label>
                        <Input
                          id="knowledge-text-title"
                          placeholder="Enter a title"
                          value={knowledgeTextTitle}
                          onChange={(e) => setKnowledgeTextTitle(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="knowledge-text-content" className="text-xs sm:text-sm">Content</Label>
                        <Textarea
                          id="knowledge-text-content"
                          placeholder="Enter your text content..."
                          value={knowledgeTextContent}
                          onChange={(e) => setKnowledgeTextContent(e.target.value)}
                          className="mt-1 min-h-[200px] font-mono text-sm"
                        />
                      </div>
                      <Button
                        onClick={handleAddText}
                        disabled={!knowledgeTextTitle.trim() || !knowledgeTextContent.trim() || addTextMutation.isPending}
                      >
                        {addTextMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-2" />
                        )}
                        Add Text
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </TabsContent>

            {/* ═══════════════ TAB 4: AGENT PREFERENCES ═══════════════ */}
            <TabsContent value="agent-prefs" className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6 mt-4 sm:mt-6 overflow-x-hidden">
              {/* Custom Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg flex items-center gap-2">
                    <Brain className="h-3 w-3 sm:h-4 sm:w-4" />
                    Custom Instructions
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Tell {agentName} how you'd like it to respond (e.g., "Be concise", "Explain like I'm a developer")
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <Textarea
                    placeholder="I prefer detailed technical explanations with code examples..."
                    value={preferences.customInstructions}
                    onChange={(e) => setPreferences(prev => ({ ...prev, customInstructions: e.target.value }))}
                    className="min-h-[220px]"
                    data-testid="textarea-custom-instructions"
                  />
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Infinity className="h-3 w-3" />
                    <span>No character limit</span>
                  </div>
                </CardContent>
              </Card>

              {/* Execution Preferences */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Execution Preferences</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Control how {agentName} handles code execution and task delegation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="autonomous-code" className="text-sm font-medium">
                        Autonomous Code Execution
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Allow {agentName} to run code automatically when Code Bytes is enabled
                      </p>
                    </div>
                    <Switch
                      id="autonomous-code"
                      checked={preferences.autonomousCodeExecution}
                      onCheckedChange={(checked) =>
                        setPreferences(prev => ({ ...prev, autonomousCodeExecution: checked }))}
                      data-testid="switch-autonomous-code-execution"
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="multi-agent" className="text-sm font-medium">
                        Allow Delegation to Subagents
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Let {agentName} delegate tasks to specialized subagents for better results
                      </p>
                    </div>
                    <Switch
                      id="multi-agent"
                      checked={(preferences as any).multiAgentEnabled !== false}
                      onCheckedChange={(checked) =>
                        setPreferences((prev: any) => ({ ...prev, multiAgentEnabled: checked }))
                      }
                      data-testid="switch-multi-agent-enabled"
                    />
                  </div>

                  <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50">
                    <p>
                      When code execution is enabled, {agentName} can run Python code automatically for calculations, data analysis, and other tasks.
                      When delegation is enabled, {agentName} can route complex tasks to specialized subagents.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ═══════════════ TAB 5: ACCOUNT ═══════════════ */}
            <TabsContent value="account" className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6 mt-4 sm:mt-6 overflow-x-hidden">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Account Details</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Your account information
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2 sm:gap-3 min-w-0">
                      <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Username</span>
                      <span className="text-xs sm:text-sm font-medium truncate">{user?.username || 'Not set'}</span>
                    </div>
                    <div className="flex justify-between gap-2 sm:gap-3 min-w-0">
                      <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">Email</span>
                      <span className="text-xs sm:text-sm font-medium truncate">{user?.email || 'Not set'}</span>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-4 rounded-lg border border-border/50 bg-muted/30 p-3 sm:p-4">
                    <div className="space-y-1">
                      <Label htmlFor="open-admin-default" className="text-xs sm:text-sm font-medium">
                        Open to Admin by default
                      </Label>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">
                        Start from the admin area after signing in when your role allows it.
                      </p>
                    </div>
                    <Switch
                      id="open-admin-default"
                      checked={preferences.lastArea === 'admin'}
                      onCheckedChange={(checked) =>
                        setPreferences((prev) => ({
                          ...prev,
                          lastArea: checked ? 'admin' : 'user',
                        }))
                      }
                      data-testid="switch-open-admin-default"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Change Password</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Update your password to keep your account secure
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  {!isPasswordChangeExpanded ? (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => setIsPasswordChangeExpanded(true)}
                      data-testid="button-show-change-password"
                    >
                      <Settings className="h-4 w-4" />
                      Change Password
                    </Button>
                  ) : (
                    <div className="space-y-3 sm:space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="current-password" className="text-xs sm:text-sm">Current Password</Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                          data-testid="input-current-password"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password" className="text-xs sm:text-sm">New Password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password"
                          data-testid="input-new-password-settings"
                        />
                        <p className="text-[10px] sm:text-xs text-muted-foreground">
                          Password must be at least 8 characters with uppercase, lowercase, and number
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password" className="text-xs sm:text-sm">Confirm New Password</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                          data-testid="input-confirm-password-settings"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setIsPasswordChangeExpanded(false);
                            setCurrentPassword('');
                            setNewPassword('');
                            setConfirmPassword('');
                          }}
                          className="flex-1"
                          data-testid="button-cancel-change-password"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleChangePassword}
                          disabled={changePasswordMutation.isPending}
                          className="flex-1"
                          data-testid="button-change-password"
                        >
                          {changePasswordMutation.isPending ? (
                            <>
                              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-2 animate-spin" />
                              <span className="text-xs sm:text-sm">Changing...</span>
                            </>
                          ) : (
                            <span className="text-xs sm:text-sm">Change Password</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <ConnectedAccountsCard />

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">View Archived Chats</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Restore or permanently delete archived conversations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 sm:space-y-4">
                  {!isArchivedChatsExpanded ? (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => setIsArchivedChatsExpanded(true)}
                      data-testid="button-show-archived-chats"
                    >
                      <History className="h-4 w-4" />
                      View Archived Chats
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2">
                        <span className="text-xs sm:text-sm font-medium">
                          {archivedChats?.length || 0} archived chat{archivedChats?.length !== 1 ? 's' : ''}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsArchivedChatsExpanded(false)}
                          data-testid="button-hide-archived-chats"
                        >
                          Hide
                        </Button>
                      </div>
                      {archivedLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : archivedChats && archivedChats.length > 0 ? (
                        <div className="space-y-2">
                          {archivedChats.map((chat) => (
                            <div
                              key={chat.id}
                              className="flex items-center justify-between gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border hover-elevate"
                              data-testid={`archived-chat-${chat.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium truncate text-xs sm:text-sm">{chat.title}</h4>
                                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                                  {fmtDate(chat.updatedAt, userTz)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => restoreChatMutation.mutate(chat.id)}
                                  disabled={restoreChatMutation.isPending}
                                  data-testid={`button-restore-chat-${chat.id}`}
                                  title="Restore chat"
                                >
                                  <Upload className="h-3 w-3 sm:h-4 sm:w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm('Are you sure you want to permanently delete this chat? This action cannot be undone.')) {
                                      permanentDeleteChatMutation.mutate(chat.id);
                                    }
                                  }}
                                  disabled={permanentDeleteChatMutation.isPending}
                                  data-testid={`button-delete-chat-${chat.id}`}
                                  title="Delete permanently"
                                >
                                  <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 sm:py-8">
                          <History className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground/50 mb-2 sm:mb-3" />
                          <p className="text-xs sm:text-sm text-muted-foreground">No archived chats</p>
                          <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                            Archive chats from the chat list to see them here
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm sm:text-lg">Account Actions</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Manage your account settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="theme-select" className="text-sm font-medium">
                        Appearance
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Choose how {agentName} looks across this device.
                      </p>
                    </div>
                    <Select
                      value={theme}
                      onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
                    >
                      <SelectTrigger id="theme-select" className="w-full" data-testid="select-theme">
                        <SelectValue placeholder="Select theme" />
                      </SelectTrigger>
                      <SelectContent>
                        {themeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="text-sm">
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] sm:text-xs text-muted-foreground">
                      {selectedThemeOption.helper}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={async () => {
                      try {
                        await apiRequest('POST', '/api/auth/logout');
                        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
                        window.location.href = '/';
                      } catch (error) {
                        console.error('Logout error:', error);
                      }
                    }}
                    data-testid="button-logout-settings"
                  >
                    <LogOut className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="text-xs sm:text-sm">Log out</span>
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

          </ScrollArea>
        </Tabs>

        <div className="flex-shrink-0 p-4 sm:p-6 pt-3 border-t">
          <div className="flex justify-end gap-2 sm:gap-3">
            <Button variant="outline" onClick={onClose} size="sm" className="text-xs sm:text-sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={savePreferencesMutation.isPending}
              data-testid="button-save-settings"
              size="sm"
              className="text-xs sm:text-sm"
            >
              {savePreferencesMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
