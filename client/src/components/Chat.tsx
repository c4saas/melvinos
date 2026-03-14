import { useState, useRef, useEffect, useMemo, useCallback, useReducer } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { SkillsPanel } from './SkillsPanel';
import { ChatMessages } from './ChatMessages';
import type { ChatMessagesHandle } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ThorModeOverlay } from './ThorModeOverlay';
import { CommandCenter } from './CommandCenter';
import { useTheme } from './ThemeProvider';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  getChatCapableModels,
  type Chat,
  type Message,
  type Attachment,
  type AIModel,
  getModelById,
  type UserPlan,
  DEFAULT_FILE_UPLOAD_LIMITS_MB,
  type AssistantType,
} from '@shared/schema';
import type { AssistantSelection } from '@/types/assistants';
import { useLastAreaPreference } from '@/hooks/useLastAreaPreference';
import {
  initialVoicePlaybackState,
  useVoicePlaybackController,
  voicePlaybackReducer,
} from '@/hooks/useVoicePlaybackController';
import { useConversationMode } from '@/hooks/useConversationMode';
import { VoiceConversationOverlay } from './VoiceConversationOverlay';
import { useBranding } from '@/hooks/useBranding';

interface FileAttachment {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'document' | 'other';
  uploadStatus?: 'pending' | 'uploading' | 'completed' | 'failed';
  uploadResult?: {
    url: string;
    size: number;
  };
}

type ChatRequestMetadata = {
  thorMode?: boolean;
  thinkingLevel?: 'off' | 'standard' | 'extended';
  outputTemplateId?: string | null;
  voiceMode?: boolean;
  preferredModelId?: string;
};

interface UserLimits {
  plan: UserPlan;
  messageLimitPerDay: number | null;
  allowedModels: string[];
  legacyModels?: string[];
  features?: string[];
  fileUploadLimitMb?: number | null;
  chatHistoryEnabled?: boolean;
  voiceEnabled?: boolean;
  voiceInputEnabled?: boolean;
  defaultModel?: string;
}

type StreamSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; lang: string; rawLang?: string };

interface StreamingAssistantState {
  id: string;
  segments: StreamSegment[];
  metadata?: Message['metadata'];
  isComplete?: boolean;
}

const segmentsToString = (segments: StreamSegment[]): string =>
  segments
    .map((segment) => {
      if (segment.type === 'code') {
        const langToken = segment.rawLang ?? (segment.lang === 'text' ? '' : segment.lang);
        return `\`\`\`${langToken}\n${segment.content}\n\`\`\``;
      }
      return segment.content;
    })
    .join('');

const decodeBase64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const normalized = base64.replace(/\s/g, '');
  const binary = atob(normalized);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

/** Map tool names to user-friendly streaming activity labels */
function getToolActivityLabel(toolName: string, args?: Record<string, unknown>): string {
  const query = typeof args?.query === 'string' ? args.query : '';
  const shortQuery = query.length > 40 ? query.slice(0, 40) + '...' : query;

  switch (toolName) {
    case 'web_search':
      return shortQuery ? `Searching the web: "${shortQuery}"` : 'Searching the web...';
    case 'deep_research':
      return shortQuery ? `Deep researching: "${shortQuery}"` : 'Running deep research...';
    case 'web_fetch':
      return 'Fetching web page...';
    case 'python_execute':
      return 'Running code...';
    case 'shell_execute':
      return 'Executing command...';
    case 'image_generate':
      return 'Generating image...';
    case 'video_generate':
      return 'Generating video...';
    case 'gmail_search':
      return 'Searching emails...';
    case 'gmail_read':
      return 'Reading email...';
    case 'gmail_send':
      return 'Sending email...';
    case 'gmail_modify':
      return 'Updating email...';
    case 'calendar_events':
      return 'Checking calendar...';
    case 'calendar_create_event':
      return 'Creating calendar event...';
    case 'calendar_update_event':
      return 'Updating calendar event...';
    case 'calendar_delete_event':
      return 'Deleting calendar event...';
    case 'notion_search':
      return 'Searching Notion...';
    case 'notion_read_page':
      return 'Reading Notion page...';
    case 'notion_create_page':
      return 'Creating Notion page...';
    case 'notion_update_page':
      return 'Updating Notion page...';
    case 'recall_search':
      return 'Searching meeting transcripts...';
    case 'recall_list_meetings':
      return 'Listing meetings...';
    case 'recall_create_bot':
      return 'Setting up meeting bot...';
    case 'drive_search':
      return 'Searching Google Drive...';
    case 'drive_read':
      return 'Reading from Drive...';
    case 'drive_write':
      return 'Writing to Drive...';
    case 'file_read':
      return 'Reading file...';
    case 'file_write':
      return 'Writing file...';
    case 'file_edit':
      return 'Editing file...';
    case 'memory_save':
      return 'Saving to memory...';
    case 'memory_search':
      return 'Searching memory...';
    case 'skill_update':
      return 'Updating skill...';
    case 'spawn_task':
      return 'Spawning subtask...';
    case 'claude_code': {
      const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
      const shortPrompt = prompt.length > 50 ? prompt.slice(0, 50) + '…' : prompt;
      return shortPrompt ? `Claude Code: ${shortPrompt}` : 'Claude Code working...';
    }
    // Claude Code sub-tools (cc_ prefix)
    case 'cc_Bash':
      return 'CC › Running command...';
    case 'cc_Read':
      return 'CC › Reading file...';
    case 'cc_Write':
      return 'CC › Writing file...';
    case 'cc_Edit':
      return 'CC › Editing file...';
    case 'cc_Glob':
      return 'CC › Searching files...';
    case 'cc_Grep':
      return 'CC › Searching content...';
    case 'cc_WebSearch':
      return 'CC › Searching the web...';
    case 'cc_WebFetch':
      return 'CC › Fetching URL...';
    case 'cc_Task':
      return 'CC › Spawning agent...';
    default:
      // Claude Code sub-tools with unknown name
      if (toolName.startsWith('cc_')) {
        const inner = toolName.slice(3).replace(/_/g, ' ');
        return `CC › ${inner}...`;
      }
      // MCP tools: mcp_{serverId}_{category}_{action} → friendly label
      if (toolName.startsWith('mcp_')) {
        const parts = toolName.split('_');
        const label = parts.slice(2).join(' \u2014 ')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return `${label}...`;
      }
      return `Using ${toolName.replace(/_/g, ' ')}...`;
  }
}

export function Chat() {
  const { agentName } = useBranding();
  useLastAreaPreference('user');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 768;
  });
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('compound');
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantSelection | null>(null);
  const [triggerKnowledgeDialog, setTriggerKnowledgeDialog] = useState(false);
  const [triggerNewProjectDialog, setTriggerNewProjectDialog] = useState(false);
  const [currentLocation, navigate] = useLocation();
  const [settingsTrigger, setSettingsTrigger] = useState<{ tab?: string } | null>(null);
  const { theme, setCcActive } = useTheme();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const chatMessagesRef = useRef<ChatMessagesHandle | null>(null);
  const [inputHeight, setInputHeight] = useState(0);
  const hasUserSelectedModel = useRef(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(null);
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState<StreamingAssistantState | null>(null);
  const streamingStartedAtRef = useRef<number | null>(null);
  const [streamingStatus, setStreamingStatus] = useState<'idle' | 'streaming' | 'completed'>('idle');
  const [streamingActivity, setStreamingActivity] = useState<string | null>(null);
  const streamingActivityTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [voicePlayback, dispatchVoicePlayback] = useReducer(voicePlaybackReducer, initialVoicePlaybackState);
  const voicePlaybackController = useVoicePlaybackController({ state: voicePlayback, dispatch: dispatchVoicePlayback });
  const voiceSessionActiveRef = useRef(false);

  const handleSendMessageRef = useRef<(content: string, files?: FileAttachment[], metadata?: ChatRequestMetadata) => Promise<void>>(async () => {});

  const initialScrollDoneRef = useRef(false);
  const [thorModeEnabled, setThorModeEnabled] = useState(false);
  const [showThorOverlay, setShowThorOverlay] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'standard' | 'extended'>('off');

  const clearStreamingActivityTimers = () => {
    streamingActivityTimersRef.current.forEach(clearTimeout);
    streamingActivityTimersRef.current = [];
  };

  const scheduleStreamingActivity = (message: string | null, delay: number) => {
    const timer = setTimeout(() => setStreamingActivity(message), delay);
    streamingActivityTimersRef.current.push(timer);
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (streamingAssistantMessage) {
      chatMessagesRef.current?.scrollToMessage(streamingAssistantMessage.id, {
        behavior,
        block: 'start',
      });
      return;
    }

    if (pendingUserMessage) {
      chatMessagesRef.current?.scrollToMessage(pendingUserMessage.id, {
        behavior,
        block: 'end',
      });
      return;
    }

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      chatMessagesRef.current?.scrollToMessage(lastMessage.id, {
        behavior,
        block: lastMessage.role === 'assistant' ? 'start' : 'end',
      });
      return;
    }

    chatMessagesRef.current?.scrollToTop({ behavior });
  };

  const scrollMessagesToTop = (behavior: ScrollBehavior = 'smooth') => {
    chatMessagesRef.current?.scrollToTop({ behavior });
  };

  useEffect(() => {
    return () => {
      clearStreamingActivityTimers();
    };
  }, []);

  useEffect(() => {
    const queryIndex = currentLocation.indexOf('?');
    if (queryIndex === -1) {
      return;
    }

    const search = currentLocation.slice(queryIndex + 1);
    if (!search) {
      return;
    }

    const params = new URLSearchParams(search);
    const settingsParam = params.get('settings');

    if (!settingsParam) {
      return;
    }

    setSettingsTrigger({
      tab: settingsParam,
    });

    const basePath = currentLocation.slice(0, queryIndex) || '/';
    navigate(basePath, { replace: true });
  }, [currentLocation, navigate]);

  const { user, isAdmin } = useAuth();

  // Skills panel state
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);
  const { data: skillsSettingsData } = useQuery<{ settings: { data: { skills?: { enabled: boolean }[] } } }>({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/settings');
      return res.json();
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const enabledSkillsCount = (skillsSettingsData?.settings?.data?.skills ?? []).filter(s => s.enabled).length;

  const { data: userLimits } = useQuery<UserLimits>({
    queryKey: ['user-limits'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/users/me/limits');
      return response.json() as Promise<UserLimits>;
    },
  });

  const resolvePlan = (value?: string | null): UserPlan => (value === 'pro' || value === 'enterprise' ? value : 'free');
  const plan: UserPlan = userLimits ? resolvePlan(userLimits.plan) : resolvePlan(user?.plan);
  const isPaidPlan = plan !== 'free';
  const voiceEnabled = userLimits?.voiceEnabled ?? false;
  const voiceInputEnabled = userLimits?.voiceInputEnabled ?? false;

  const chatCapableModels = useMemo(() => getChatCapableModels(), []);
  const defaultLegacyIds = useMemo(
    () => chatCapableModels.filter(model => model.status === 'legacy').map(model => model.id),
    [chatCapableModels],
  );
  const legacyModelSet = useMemo(
    () => new Set(userLimits?.legacyModels ?? defaultLegacyIds),
    [defaultLegacyIds, userLimits?.legacyModels],
  );
  const modelsWithStatus = useMemo(
    () => chatCapableModels.map(model => ({
      ...model,
      status: legacyModelSet.has(model.id) ? 'legacy' : undefined,
    })),
    [chatCapableModels, legacyModelSet],
  );

  const availableModels: AIModel[] = useMemo(() => {
    if (userLimits?.allowedModels && userLimits.allowedModels.length > 0) {
      const allowedIds = new Set(userLimits.allowedModels);
      const filtered = modelsWithStatus.filter(model => allowedIds.has(model.id));
      return filtered.length > 0 ? filtered : modelsWithStatus;
    }
    if (isPaidPlan) {
      return modelsWithStatus;
    }
    return modelsWithStatus.filter(model => model.provider === 'Groq');
  }, [modelsWithStatus, plan, userLimits]);

  const fallbackFileUploadLimitMb = DEFAULT_FILE_UPLOAD_LIMITS_MB[plan] ?? DEFAULT_FILE_UPLOAD_LIMITS_MB.free ?? null;
  const configuredFileUploadLimitMb = userLimits?.fileUploadLimitMb ?? null;
  const effectiveFileUploadLimitMb =
    configuredFileUploadLimitMb ?? fallbackFileUploadLimitMb ?? DEFAULT_FILE_UPLOAD_LIMITS_MB.free ?? null;
  const maxFileSizeBytes =
    effectiveFileUploadLimitMb === null ? Number.POSITIVE_INFINITY : effectiveFileUploadLimitMb * 1024 * 1024;

  const currentModel = useMemo(() => availableModels.find(m => m.id === selectedModel), [availableModels, selectedModel]);
  const supportsThinking = currentModel?.capabilities.includes('thinking') ?? false;

  // Reset thinking level when switching to a model that doesn't support it
  useEffect(() => {
    if (!supportsThinking && thinkingLevel !== 'off') {
      setThinkingLevel('off');
    }
  }, [supportsThinking, thinkingLevel]);

  const isDarkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    } else {
      setIsSidebarOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    const defaultModelId = userLimits?.defaultModel || userLimits?.allowedModels?.[0] || 'compound';

    if (availableModels.length === 0) return;

    const allowedIds = new Set(availableModels.map(model => model.id));

    // If current selection is invalid, snap to default
    if (!allowedIds.has(selectedModel)) {
      setSelectedModel(allowedIds.has(defaultModelId) ? defaultModelId : availableModels[0].id);
      return;
    }

    // On initial load or when defaultModel changes, snap to the configured default
    if (allowedIds.has(defaultModelId) && selectedModel !== defaultModelId && !hasUserSelectedModel.current) {
      setSelectedModel(defaultModelId);
    }
  }, [availableModels, selectedModel, userLimits?.defaultModel, userLimits?.allowedModels]);

  // Fetch chats for the authenticated user
  const { data: chats = [], isLoading: isLoadingChats } = useQuery<Chat[]>({
    queryKey: ['/api/chats'],
    queryFn: async () => {
      const response = await fetch('/api/chats', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch chats');
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch messages for active chat
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['/api/chats', activeChat, 'messages'],
    enabled: !!activeChat,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Refetch messages when activeChat changes to ensure fresh data
  useEffect(() => {
    if (activeChat) {
      queryClient.invalidateQueries({ queryKey: ['/api/chats', activeChat, 'messages'] });
    }
  }, [activeChat, queryClient]);

  // Sync selected assistant with active chat's last assistant message
  useEffect(() => {
    if (!activeChat || messages.length === 0) {
      setSelectedAssistant(null);
      return;
    }

    // Find the last assistant message with assistantId in metadata
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((msg: Message) => msg.role === 'assistant' && msg.metadata?.assistantId);

    if (lastAssistantMessage?.metadata?.assistantId) {
      const metadata = lastAssistantMessage.metadata as Message['metadata'] & {
        assistantType?: AssistantType;
        assistantName?: string;
      };

      const assistantType = (metadata.assistantType as AssistantType) ?? 'prompt';
      const assistantName = typeof metadata.assistantName === 'string' ? metadata.assistantName : null;

      setSelectedAssistant({
        id: metadata.assistantId as string,
        type: assistantType,
        name: assistantName,
      });
    } else {
      setSelectedAssistant(null);
    }
  }, [activeChat, messages]);

  const currentChat = chats.find((chat: Chat) => chat.id === activeChat);

  // Restore the model selector from the loaded chat's model field
  useEffect(() => {
    if (!activeChat || !chats.length) return;
    const chat = chats.find((c: Chat) => c.id === activeChat);
    if (chat?.model) {
      setSelectedModel(chat.model);
    }
  }, [activeChat, chats]);

  // Create new chat mutation
  const createChatMutation = useMutation({
    mutationFn: async (data: { title: string; model: string; projectId?: string | null }) => {
      const response = await apiRequest('POST', '/api/chats', {
        title: data.title,
        model: data.model,
        projectId: data.projectId ?? undefined,
      });
      return response.json();
    },
    onSuccess: (newChat) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      setActiveChat(newChat.id);
      toast({
        title: 'New chat created',
        description: 'Started a new conversation.',
        duration: 2000,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to create new chat.',
        variant: 'destructive',
      });
      console.error('Failed to create chat:', error);
    },
  });

  // Archive chat mutation
  const archiveChatMutation = useMutation({
    mutationFn: async (chatId: string) => {
      await apiRequest('PATCH', `/api/chats/${chatId}/archive`);
    },
    onSuccess: (_, archivedChatId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats/archived'] });
      if (activeChat === archivedChatId) {
        setActiveChat(null);
      }
      toast({
        title: 'Chat archived',
        description: 'The conversation has been archived.',
        duration: 2000,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to archive chat.',
        variant: 'destructive',
      });
      console.error('Failed to archive chat:', error);
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (chatId: string) => {
      await apiRequest('DELETE', `/api/chats/${chatId}`);
    },
    onSuccess: (_, deletedChatId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats/archived'] });
      if (activeChat === deletedChatId) {
        setActiveChat(null);
      }
      toast({
        title: 'Chat deleted',
        description: 'The conversation has been permanently removed.',
        duration: 2000,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to delete chat.',
        variant: 'destructive',
      });
      console.error('Failed to delete chat:', error);
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (data: {
      chatId: string;
      content: string;
      model: string;
      assistantId?: string | null;
      assistantType?: AssistantType | null;
      assistantName?: string | null;
      attachments?: Attachment[];
      metadata?: ChatRequestMetadata;
      history: Message[];
    }) => {
      const effectiveModelId = data.metadata?.preferredModelId ?? data.model;
      const baseMessages = data.history.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const requestBody = {
        model: effectiveModelId,
        messages: [
          ...baseMessages,
          { role: 'user' as const, content: data.content }
        ],
        chatId: data.chatId,
        userId: 'default-user',
        assistantId: data.assistantId,
        assistantType: data.assistantType,
        attachments: data.attachments,
        metadata: data.metadata,
      };

      const streamingId = `stream-${Date.now()}`;
      const userMessage: Message = {
        id: `temp-user-${Date.now()}`,
        chatId: data.chatId,
        role: 'user',
        content: data.content,
        createdAt: new Date().toISOString(),
        metadata: data.metadata as Message['metadata'],
      } as Message;

      setPendingUserMessage(userMessage);
      dispatchVoicePlayback({ type: 'reset' });
      voiceSessionActiveRef.current = false;
      const initialAssistantMetadata = data.assistantId
        ? ({
            assistantId: data.assistantId,
            ...(data.assistantType ? { assistantType: data.assistantType } : {}),
            ...(data.assistantName ? { assistantName: data.assistantName } : {}),
          } as Message['metadata'])
        : undefined;

      setStreamingAssistantMessage({ id: streamingId, segments: [], metadata: initialAssistantMetadata, isComplete: false });
      streamingStartedAtRef.current = Date.now();
      setStreamingStatus('streaming');

      const modelDetails = getModelById(effectiveModelId);
      const hasAttachments = (data.attachments?.length ?? 0) > 0;
      clearStreamingActivityTimers();

      if (hasAttachments) {
        setStreamingActivity('Reviewing your attachments...');
      } else {
        setStreamingActivity('Understanding your request...');
      }

      scheduleStreamingActivity('Preparing response...', 3000);

      const response = await apiRequest('POST', '/api/chat/completions/stream', requestBody);

      if (!response.body) {
        throw new Error('Streaming not supported by server response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let donePayload: { content?: string; metadata?: Message['metadata'] } | null = null;
      let lastSegments: StreamSegment[] = [];

      const updateSegments = (updater: (segments: StreamSegment[]) => StreamSegment[]) => {
        setStreamingAssistantMessage((prev) => {
          const base = prev && prev.id === streamingId
            ? prev
            : { id: streamingId, segments: [], metadata: undefined, isComplete: false };
          const nextSegments = updater(base.segments);
          lastSegments = nextSegments;
          return { ...base, id: streamingId, segments: nextSegments };
        });
      };

      const appendText = (text: string) => {
        if (!text) return;
        updateSegments((segments) => {
          if (segments.length > 0 && segments[segments.length - 1].type === 'text') {
            const next = [...segments];
            const last = next[next.length - 1] as Extract<StreamSegment, { type: 'text' }>;
            next[next.length - 1] = { ...last, content: last.content + text };
            return next;
          }
          return [...segments, { type: 'text', content: text }];
        });
      };

      const appendCode = (payload: { text?: string; lang?: string; rawLang?: string }) => {
        const text = payload.text ?? '';
        if (!text && !payload.lang && !payload.rawLang) {
          return;
        }

        updateSegments((segments) => {
          if (segments.length > 0 && segments[segments.length - 1].type === 'code') {
            const next = [...segments];
            const last = next[next.length - 1] as Extract<StreamSegment, { type: 'code' }>;
            next[next.length - 1] = {
              ...last,
              content: last.content + text,
            };
            return next;
          }

          return [
            ...segments,
            {
              type: 'code',
              content: text,
              lang: payload.lang || 'text',
              rawLang: payload.rawLang,
            },
          ];
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });

          let boundaryIndex: number;
          while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + 2);

            if (!rawEvent.trim()) {
              continue;
            }

            const lines = rawEvent.split('\n');
            let eventType = 'text_delta';
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }

            const dataString = dataLines.join('\n');
            let payload: any = {};
            if (dataString) {
              try {
                payload = JSON.parse(dataString);
              } catch {
                payload = { text: dataString };
              }
            }

            switch (eventType) {
              case 'text_delta': {
                const delta = payload.text ?? '';
                appendText(typeof delta === 'string' ? delta : String(delta));
                break;
              }
              case 'voice_chunk': {
                const clipId = typeof payload.clipId === 'string' ? payload.clipId : null;
                const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : null;
                const chunkData = typeof payload.data === 'string' ? payload.data : null;

                if (clipId && mimeType && chunkData) {
                  try {
                    const buffer = decodeBase64ToArrayBuffer(chunkData);
                    dispatchVoicePlayback({ type: 'start_session', sessionId: streamingId });
                    voiceSessionActiveRef.current = true;
                    dispatchVoicePlayback({
                      type: 'enqueue_chunk',
                      sessionId: streamingId,
                      clipId,
                      mimeType,
                      buffer,
                      text: typeof payload.text === 'string' ? payload.text : undefined,
                    });
                  } catch (error) {
                    console.error('Failed to decode voice chunk', error);
                  }
                }

                break;
              }
              case 'voice_end': {
                const clipId = typeof payload.clipId === 'string' ? payload.clipId : null;
                if (clipId) {
                  dispatchVoicePlayback({
                    type: 'finalize_clip',
                    sessionId: streamingId,
                    clipId,
                    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
                    sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : undefined,
                    text: typeof payload.text === 'string' ? payload.text : undefined,
                    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
                  });
                }

                break;
              }
              case 'voice_error': {
                const message =
                  typeof payload.message === 'string' && payload.message.trim().length > 0
                    ? payload.message
                    : 'Voice playback is unavailable for this response.';
                toast({
                  title: 'Voice playback unavailable',
                  description: message,
                  variant: 'destructive',
                });
                dispatchVoicePlayback({ type: 'reset' });
                voiceSessionActiveRef.current = false;
                break;
              }
              case 'code_start':
                updateSegments((segments) => [
                  ...segments,
                  {
                    type: 'code',
                    content: '',
                    lang: payload.lang || 'text',
                    rawLang: payload.rawLang,
                  },
                ]);
                break;
              case 'code_delta':
                appendCode(payload);
                break;
              case 'code_end':
                break;
              case 'done':
                // Safety fallback — always clear CC mode when stream ends
                setCcActive(false);
                donePayload = {
                  content: payload.content,
                  metadata: payload.metadata as Message['metadata'] | undefined,
                };
                setStreamingAssistantMessage((prev) =>
                  prev && prev.id === streamingId
                    ? { ...prev, metadata: payload.metadata, isComplete: true }
                    : prev,
                );
                if (!payload.metadata?.voiceMode && !voiceSessionActiveRef.current) {
                  dispatchVoicePlayback({ type: 'reset' });
                }
                break;
              case 'agent_status': {
                const iteration = typeof payload.iteration === 'number' ? payload.iteration : 0;
                const maxIter = typeof payload.maxIterations === 'number' ? payload.maxIterations : 1;
                setStreamingActivity(`Agent working... (step ${iteration}/${maxIter})`);
                setStreamingAssistantMessage((prev) =>
                  prev && prev.id === streamingId
                    ? {
                        ...prev,
                        metadata: {
                          ...prev.metadata,
                          agentIteration: iteration,
                          agentMaxIterations: maxIter,
                        } as Message['metadata'],
                      }
                    : prev,
                );
                break;
              }
              case 'thinking': {
                const text = typeof payload.text === 'string' ? payload.text : '';
                setStreamingAssistantMessage((prev) =>
                  prev && prev.id === streamingId
                    ? {
                        ...prev,
                        metadata: {
                          ...prev.metadata,
                          thinkingContent: ((prev.metadata as any)?.thinkingContent ?? '') + text,
                        } as Message['metadata'],
                      }
                    : prev,
                );
                break;
              }
              case 'tool_call': {
                clearStreamingActivityTimers();
                const toolName = typeof payload.tool === 'string' ? payload.tool : 'unknown';
                setStreamingActivity(getToolActivityLabel(toolName, payload.args));
                // Flip theme when Claude Code starts
                if (toolName === 'claude_code') {
                  setCcActive(true);
                }
                setStreamingAssistantMessage((prev) => {
                  if (!prev || prev.id !== streamingId) return prev;
                  const toolCalls = ((prev.metadata as any)?.toolCalls ?? []) as Array<Record<string, unknown>>;
                  return {
                    ...prev,
                    metadata: {
                      ...prev.metadata,
                      agentMode: true,
                      toolCalls: [...toolCalls, { id: payload.id, tool: toolName, args: payload.args, status: 'running' }],
                    } as Message['metadata'],
                  };
                });
                break;
              }
              case 'tool_result': {
                clearStreamingActivityTimers();
                setStreamingActivity('Processing results...');
                // Revert theme when Claude Code finishes
                if (typeof payload.tool === 'string' && payload.tool === 'claude_code') {
                  setCcActive(false);
                }
                setStreamingAssistantMessage((prev) => {
                  if (!prev || prev.id !== streamingId) return prev;
                  const toolCalls = ((prev.metadata as any)?.toolCalls ?? []) as Array<Record<string, unknown>>;
                  const updated = toolCalls.map((tc) =>
                    tc.id === payload.id
                      ? { ...tc, status: 'done', output: payload.output, error: payload.error }
                      : tc,
                  );
                  return {
                    ...prev,
                    metadata: { ...prev.metadata, toolCalls: updated } as Message['metadata'],
                  };
                });
                break;
              }
              case 'cc_text': {
                // Show CC assistant text as streaming activity so user sees CC's work
                const ccText = typeof payload.text === 'string' ? payload.text : '';
                if (ccText) {
                  const preview = ccText.length > 80 ? ccText.slice(0, 80) + '…' : ccText;
                  setStreamingActivity(`CC › ${preview}`);
                }
                break;
              }
              case 'error':
                throw new Error(typeof payload.message === 'string' ? payload.message : 'Streaming error');
              default:
                if (payload.text) {
                  appendText(typeof payload.text === 'string' ? payload.text : String(payload.text));
                }
                break;
            }
          }
        }

        if (done) {
          break;
        }
      }

      if (buffer.trim()) {
        appendText(buffer);
      }

      setStreamingStatus('completed');

      const finalSegments = lastSegments;
      const finalContent = donePayload?.content ?? segmentsToString(finalSegments);
      const finalMetadata = donePayload?.metadata;

      return { content: finalContent, metadata: finalMetadata };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats', activeChat, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
    },
    onError: (error) => {
      let description = 'Failed to send message. Please try again.';
      if (error instanceof Error) {
        const message = error.message || '';
        const jsonStart = message.indexOf('{');
        if (jsonStart !== -1) {
          try {
            const parsed = JSON.parse(message.slice(jsonStart));
            if (parsed && typeof parsed === 'object') {
              const err = parsed.error;
              const msg = parsed.message;
              description =
                (typeof err === 'string' ? err : null) ??
                (typeof msg === 'string' ? msg : null) ??
                (typeof err === 'object' && err ? err.message ?? JSON.stringify(err) : null) ??
                description;
            }
          } catch {
            const fallback = message.slice(message.indexOf(':') + 1).trim();
            if (fallback) {
              description = fallback;
            }
          }
        } else if (message) {
          description = message;
        }
      }

      toast({
        title: 'Error',
        description,
        variant: 'destructive',
      });
      dispatchVoicePlayback({ type: 'reset' });
      voiceSessionActiveRef.current = false;
      setCcActive(false); // Ensure CC theme resets on error
      setPendingUserMessage(null);
      setStreamingAssistantMessage(null);
      setStreamingStatus('idle');
      streamingStartedAtRef.current = null;
      clearStreamingActivityTimers();
      setStreamingActivity(null);
      console.error('Failed to send message:', error);
    },
  });

  const conversationMode = useConversationMode({
    onTranscript: (text) => {
      void handleSendMessageRef.current(text, undefined, { voiceMode: true });
    },
    isAgentResponding: sendMessageMutation.isPending,
    playbackStatus: voicePlaybackController.status,
    playbackHasAudio: voicePlaybackController.hasAudio,
    voiceEnabled: Boolean(voiceInputEnabled),
    stopPlayback: voicePlaybackController.stop,
  });

  useEffect(() => {
    const behavior: ScrollBehavior = initialScrollDoneRef.current ? 'smooth' : 'auto';
    scrollMessagesToBottom(behavior);
    initialScrollDoneRef.current = true;
  }, [messages, pendingUserMessage, streamingAssistantMessage]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    scrollMessagesToBottom('auto');
  }, [activeChat]);

  // Reset user model selection flag when switching chats
  useEffect(() => {
    hasUserSelectedModel.current = false;
  }, [activeChat]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Only scroll when the visual viewport shrinks (mobile keyboard appearing),
    // not on every focusin — that was causing scroll jumps on every button click.
    let lastHeight = window.visualViewport?.height ?? window.innerHeight;
    const handleViewportResize = () => {
      const currentHeight = window.visualViewport?.height ?? window.innerHeight;
      if (currentHeight < lastHeight) {
        scrollMessagesToBottom('auto');
      }
      lastHeight = currentHeight;
    };

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', handleViewportResize);

    return () => {
      viewport?.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  const getTimestamp = (value: unknown): number => {
    if (!value) return 0;
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const getMessageTimestamp = (message: Message): number => {
    const anyMessage = message as any;
    return getTimestamp(anyMessage?.updatedAt) || getTimestamp(anyMessage?.createdAt);
  };

  useEffect(() => {
    if (streamingStatus !== 'completed') {
      return;
    }

    const startedAt = streamingStartedAtRef.current;

    const hasAssistantUpdate = messages.some((msg: Message) => {
      if (msg.role !== 'assistant') return false;
      if (!startedAt) return true;
      return getMessageTimestamp(msg) >= startedAt;
    });

    if (hasAssistantUpdate) {
      setStreamingAssistantMessage(null);
      setStreamingStatus('idle');
      streamingStartedAtRef.current = null;
    }

    const hasUserEcho = messages.some((msg: Message) => {
      if (msg.role !== 'user') return false;
      if (!startedAt) return true;
      return getMessageTimestamp(msg) >= startedAt;
    });

    if (hasUserEcho) {
      setPendingUserMessage(null);
    }
  }, [messages, streamingStatus]);

  useEffect(() => {
    const executedTools = streamingAssistantMessage?.metadata?.executedTools;
    if (!executedTools || executedTools.length === 0) {
      return;
    }

    const normalized = executedTools.map(tool => tool.toLowerCase());
    if (normalized.some(tool => tool.includes('search'))) {
      clearStreamingActivityTimers();
      setStreamingActivity('Reviewing web research to cite sources...');
    } else if (normalized.some(tool => tool.includes('python'))) {
      clearStreamingActivityTimers();
      setStreamingActivity('Processing code results for insights...');
    }
  }, [streamingAssistantMessage?.metadata?.executedTools]);

  useEffect(() => {
    if (streamingStatus === 'idle') {
      clearStreamingActivityTimers();
      setStreamingActivity(null);
    }
  }, [streamingStatus]);

  useEffect(() => {
    setPendingUserMessage(null);
    setStreamingAssistantMessage(null);
    setStreamingStatus('idle');
    streamingStartedAtRef.current = null;
    clearStreamingActivityTimers();
    setStreamingActivity(null);
  }, [activeChat]);

  // Set initial active chat when chats are loaded
  useEffect(() => {
    if (chats.length > 0 && !activeChat) {
      setActiveChat(chats[0].id);
    }
  }, [chats, activeChat]);

  const handleInputHeightChange = useCallback((height: number) => {
    setInputHeight(height);
  }, []);

  const handleScrollToTop = () => {
    scrollMessagesToTop();
  };

  const handleNewChat = (projectId?: string | null) => {
    createChatMutation.mutate({
      title: 'New Conversation',
      model: selectedModel,
      projectId: projectId ?? undefined,
    });
  };

  const handleChatSelect = (chatId: string) => {
    setActiveChat(chatId);
  };

  const handleChatArchive = (chatId: string) => {
    archiveChatMutation.mutate(chatId);
  };

  const handleChatDelete = (chatId: string) => {
    deleteChatMutation.mutate(chatId);
  };

  const handleSendMessage = async (
    content: string,
    files?: FileAttachment[],
    metadata?: ChatRequestMetadata
  ) => {
    if (sendMessageMutation.isPending) {
      return;
    }

    let attachments: Attachment[] = [];

    // Map already-uploaded files to Attachment objects (ChatInput handles the actual upload)
    if (files && files.length > 0) {
      const uploaded = files.filter(f => f.uploadStatus === 'completed');
      if (uploaded.length !== files.length) {
        toast({
          title: 'Upload Incomplete',
          description: 'Some files are still uploading. Please wait.',
          variant: 'destructive',
        });
        return;
      }

      attachments = uploaded.map(f => ({
        id: f.id,
        name: f.file.name,
        mimeType: f.file.type,
        size: f.uploadResult?.size ?? f.file.size,
        url: f.uploadResult?.url ?? `/api/files/${f.id}`,
      }));
    }
    
    // If no active chat, create a new one first
    if (!activeChat) {
      try {
        const newChat = await createChatMutation.mutateAsync({
          title: content.slice(0, 50) + (content.length > 50 ? '...' : ''),
          model: selectedModel,
        });
        
        // Send message to the new chat
        sendMessageMutation.mutate({
          chatId: newChat.id,
          content,
          model: selectedModel,
          assistantId: selectedAssistant?.id ?? null,
          assistantType: selectedAssistant?.type ?? null,
          assistantName: selectedAssistant?.name ?? null,
          attachments: attachments.length > 0 ? attachments : undefined,
          metadata,
          history: [],
        });
      } catch (error) {
        console.error('Failed to create chat and send message:', error);
      }
    } else {
      // Send to existing chat
      sendMessageMutation.mutate({
        chatId: activeChat,
        content,
        model: selectedModel,
        assistantId: selectedAssistant?.id ?? null,
        assistantType: selectedAssistant?.type ?? null,
        assistantName: selectedAssistant?.name ?? null,
        attachments: attachments.length > 0 ? attachments : undefined,
        metadata,
        history: messages,
      });
    }
  };

  // Keep ref current so conversation mode can call it without stale closure
  handleSendMessageRef.current = handleSendMessage;

  const handleCopyMessage = (content: string) => {
    toast({
      title: 'Copied!',
      description: 'Message copied to clipboard.',
    });
  };

  const handleRegenerateResponse = (messageId: string) => {
    console.log('Regenerating response for message:', messageId);
    toast({
      title: 'Regenerating...',
      description: 'Creating a new response.',
    });
  };

  const handleOpenKnowledgeDialog = () => {
    setTriggerKnowledgeDialog(true);
  };

  const handleOpenNewProjectDialog = () => {
    setTriggerNewProjectDialog(true);
  };

  const sidebarContent = (
    <ChatSidebar
      isOpen={isSidebarOpen}
      onNewChat={() => handleNewChat(null)}
      chats={chats.map((chat: Chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt || chat.createdAt,
        projectId: chat.projectId ?? null,
      }))}
      activeChat={activeChat}
      onChatSelect={handleChatSelect}
      onChatArchive={handleChatArchive}
      onChatDelete={handleChatDelete}
      triggerOpenKnowledgeDialog={triggerKnowledgeDialog}
      onKnowledgeDialogOpened={() => setTriggerKnowledgeDialog(false)}
      triggerOpenNewProjectDialog={triggerNewProjectDialog}
      onNewProjectDialogOpened={() => setTriggerNewProjectDialog(false)}
      triggerOpenSettings={settingsTrigger}
      onSettingsTriggerHandled={() => setSettingsTrigger(null)}
    />
  );

  return (
    <CommandCenter
      sidebar={sidebarContent}
      sidebarOpen={isSidebarOpen}
      onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
    >
      {/* Thor Mode overlay animation */}
      {showThorOverlay && <ThorModeOverlay onComplete={() => setShowThorOverlay(false)} />}

      {/* Header */}
      <ChatHeader
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        selectedModel={selectedModel}
        onModelChange={(model) => {
          hasUserSelectedModel.current = true;
          setSelectedModel(model);
        }}
        availableModels={availableModels}
        onHomeClick={handleScrollToTop}
        showNewChatButton={!isSidebarOpen}
        onNewChat={() => handleNewChat(null)}
        isCreatingNewChat={createChatMutation.isPending}
        agentStatus={sendMessageMutation.isPending ? (streamingAssistantMessage ? 'streaming' : 'thinking') : 'idle'}
        streamingActivity={streamingActivity}
        onOpenSkills={isAdmin ? () => setIsSkillsPanelOpen(true) : undefined}
        enabledSkillsCount={isAdmin ? enabledSkillsCount : undefined}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={supportsThinking ? setThinkingLevel : undefined}
      />
      <SkillsPanel open={isSkillsPanelOpen} onClose={() => setIsSkillsPanelOpen(false)} />

      {/* Messages */}
      <div className={cn("flex flex-1 min-h-0 flex-col overflow-hidden transition-colors duration-500", thorModeEnabled && "thor-mode-active")}>
        <ChatMessages
          ref={chatMessagesRef}
          messages={messages}
          pendingUserMessage={pendingUserMessage ?? undefined}
          streamingAssistantMessage={streamingAssistantMessage}
          isLoading={sendMessageMutation.isPending && !streamingAssistantMessage}
          onCopyMessage={handleCopyMessage}
          onRegenerateResponse={handleRegenerateResponse}
          isDarkMode={isDarkMode}
          streamingActivity={streamingActivity}
          bottomOffset={inputHeight}
          voicePlaybackState={voicePlayback}
          voicePlaybackController={voicePlaybackController}
        />
      </div>

      {/* Input — hidden when voice conversation overlay is active */}
      {!conversationMode.isConversationMode && (
        <ChatInput
          key={activeChat ?? 'new-chat'}
          onSendMessage={handleSendMessage}
          isLoading={sendMessageMutation.isPending}
          placeholder={`Message ${agentName}...`}
          selectedModel={selectedModel}
          selectedAssistant={selectedAssistant}
          onAssistantChange={setSelectedAssistant}
          onOpenKnowledgeDialog={handleOpenKnowledgeDialog}
          onOpenNewProjectDialog={handleOpenNewProjectDialog}
          maxFileSizeBytes={maxFileSizeBytes}
          onHeightChange={handleInputHeightChange}
          voiceEnabled={voiceInputEnabled}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={setThinkingLevel}
          thorModeEnabled={thorModeEnabled}
          onThorModeChange={(enabled) => {
            setThorModeEnabled(enabled);
            if (enabled) {
              setShowThorOverlay(true);
              setTimeout(() => setShowThorOverlay(false), 3000);
            }
          }}
          onStartConversationMode={conversationMode.startConversation}
        />
      )}

      {/* Voice conversation overlay */}
      {conversationMode.isConversationMode && (
        <VoiceConversationOverlay
          listenState={conversationMode.listenState}
          isAgentResponding={sendMessageMutation.isPending}
          playbackStatus={voicePlaybackController.status}
          onEnd={conversationMode.endConversation}
          onInterrupt={conversationMode.interrupt}
        />
      )}
    </CommandCenter>
  );
}