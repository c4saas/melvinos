import { useState, useRef, KeyboardEvent, useCallback, useEffect, useMemo } from 'react';
import { Send, Paperclip, X, FileText, Image as ImageIcon, File, Upload, CheckCircle2, AlertCircle, Plus, Search, FileUp, MessageSquare, Shield, Zap, LayoutTemplate, BarChart2, Terminal, ChevronRight, Microscope } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { ensureCsrfToken, getCsrfToken } from '@/lib/csrf';
import { type AssistantSummary, type AssistantType, formatFileUploadLimitLabel } from '@shared/schema';
import type { AssistantSelection } from '@/types/assistants';
import { useToast } from '@/hooks/use-toast';
import { AtlasVoiceIcon } from './icons/AtlasVoiceIcon';
import { useBranding } from '@/hooks/useBranding';

// Slash command definitions
interface SlashCommand {
  name: string;
  description: string;
  icon: any;
  action: () => void;
}

const CC_MODEL_OPTIONS = [
  { id: null as string | null, label: 'Default', desc: 'Container default (claude-sonnet-4-6)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Balanced — speed and quality' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Strongest reasoning, slower' },
];

const CC_EFFORT_OPTIONS = [
  { id: null as string | null, label: 'Default', desc: 'High effort (Claude Code default)' },
  { id: 'low', label: 'Low', desc: 'Faster — fewer thinking tokens' },
  { id: 'medium', label: 'Medium', desc: 'Balanced thinking' },
  { id: 'high', label: 'High', desc: 'Maximum reasoning (~32k tokens)' },
];

const createSlashCommands = (handlers: {
  onAddKnowledge: () => void;
  onNewProject: () => void;
  onSummarize: () => void;
  onSearch: () => void;
  onUsage: () => void;
  onClause: () => void;
  onProposal: () => void;
  onSteve: () => void;
  onCCModel: () => void;
  onCCEffort: () => void;
}, ccModel: string | null, ccEffort: string | null): SlashCommand[] => [
  {
    name: '/knowledge',
    description: 'Add knowledge to your knowledge base',
    icon: FileUp,
    action: handlers.onAddKnowledge,
  },
  {
    name: '/newproject',
    description: 'Create a new project',
    icon: Plus,
    action: handlers.onNewProject,
  },
  {
    name: '/summarize',
    description: 'Summarize the current conversation',
    icon: MessageSquare,
    action: handlers.onSummarize,
  },
  {
    name: '/search',
    description: 'Start a web search query',
    icon: Search,
    action: handlers.onSearch,
  },
  {
    name: '/usage',
    description: 'Show Claude Max plan usage and account info',
    icon: BarChart2,
    action: handlers.onUsage,
  },
  {
    name: '/clause',
    description: 'Delegate a coding task to Claude Code',
    icon: Terminal,
    action: handlers.onClause,
  },
  {
    name: '/proposal',
    description: 'Create a Gamma proposal or presentation',
    icon: LayoutTemplate,
    action: handlers.onProposal,
  },
  {
    name: '/steve',
    description: 'Deep research a topic using Perplexity sonar-deep-research',
    icon: Microscope,
    action: handlers.onSteve,
  },
  {
    name: '/cc-model',
    description: ccModel ? `Claude Code model: ${CC_MODEL_OPTIONS.find(o => o.id === ccModel)?.label ?? ccModel}` : 'Set Claude Code model (default: Sonnet 4.6)',
    icon: Terminal,
    action: handlers.onCCModel,
  },
  {
    name: '/cc-effort',
    description: ccEffort ? `Claude Code effort: ${ccEffort}` : 'Set Claude Code effort level (default: high)',
    icon: Zap,
    action: handlers.onCCEffort,
  },
];

interface FileAttachment {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'document' | 'other';
  uploadStatus: 'pending' | 'uploading' | 'completed' | 'failed';
  uploadProgress?: number;
  analysisResult?: {
    hasAnalysis: boolean;
    contentPreview?: string;
    metadata?: any;
  };
  uploadResult?: {
    url: string;
    size: number;
  };
  error?: string;
}

interface OutputTemplateSummary {
  id: string;
  name: string;
  category: string;
  format: string;
  description: string | null;
  instructions: string | null;
  requiredSections: Array<{ key: string; title: string; description?: string | null }>;
}

type ThinkingLevel = 'off' | 'standard' | 'extended';

interface ChatRequestMetadata {
  thorMode?: boolean;
  thinkingLevel?: ThinkingLevel;
  outputTemplateId?: string | null;
  voiceMode?: boolean;
  preferredModelId?: string;
  ccModel?: string;
  ccEffort?: 'low' | 'medium' | 'high';
}

const OUTPUT_TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  how_to: 'How-To',
  executive_brief: 'Executive Brief',
  json_report: 'JSON',
};

const formatOutputTemplateCategory = (category: string): string => {
  return OUTPUT_TEMPLATE_CATEGORY_LABELS[category] ?? category;
};

interface ChatInputProps {
  onSendMessage: (
    message: string,
    files?: FileAttachment[],
    metadata?: ChatRequestMetadata
  ) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  selectedModel?: string;
  selectedAssistant?: AssistantSelection | null;
  onAssistantChange?: (assistant: AssistantSelection | null) => void;
  onOpenKnowledgeDialog?: () => void;
  onOpenNewProjectDialog?: () => void;
  maxFileSizeBytes?: number;
  onHeightChange?: (height: number) => void;
  voiceEnabled?: boolean;
  thorModeEnabled?: boolean;
  onThorModeChange?: (enabled: boolean) => void;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  onStartConversationMode?: () => Promise<void>;
}

export function ChatInput({
  onSendMessage,
  isLoading = false,
  placeholder = "Type your message...",
  className,
  selectedModel = 'compound',
  selectedAssistant = null,
  onAssistantChange,
  onOpenKnowledgeDialog,
  onOpenNewProjectDialog,
  maxFileSizeBytes = 10 * 1024 * 1024,
  onHeightChange,
  voiceEnabled = true,
  thorModeEnabled = false,
  onThorModeChange,
  thinkingLevel: externalThinkingLevel,
  onThinkingLevelChange,
  onStartConversationMode,
}: ChatInputProps) {
  const { agentName } = useBranding();
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  // Claude Code session settings
  const [ccModel, setCCModel] = useState<string | null>(null);
  const [ccEffort, setCCEffort] = useState<'low' | 'medium' | 'high' | null>(null);
  const [ccPickerMode, setCCPickerMode] = useState<'none' | 'model' | 'effort'>('none');
  const [selectedOutputTemplateId, setSelectedOutputTemplateId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevLoadingRef = useRef(isLoading);
  const voicePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  // Restore focus when loading completes (textarea is re-enabled after being disabled)
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      textareaRef.current?.focus();
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  const maxFileSizeLabel = useMemo(() => {
    if (!Number.isFinite(maxFileSizeBytes)) {
      return 'Unlimited';
    }
    const limitMb = maxFileSizeBytes / (1024 * 1024);
    return `${formatFileUploadLimitLabel(limitMb)} per file`;
  }, [maxFileSizeBytes]);
  
  // Feature toggles — thinkingLevel is controlled externally when props are provided
  const [internalThinkingLevel, setInternalThinkingLevel] = useState<ThinkingLevel>('off');
  const thinkingLevel = externalThinkingLevel ?? internalThinkingLevel;
  const setThinkingLevel = onThinkingLevelChange ?? setInternalThinkingLevel;

  // Fetch available assistants
  const { data: assistantsData } = useQuery<{ assistants: AssistantSummary[] }>({
    queryKey: ['/api/assistants'],
    staleTime: 60000, // 1 minute
  });
  const assistants = assistantsData?.assistants ?? [];
  const promptAssistants = useMemo(() => assistants.filter(assistant => assistant.type === 'prompt'), [assistants]);
  const webhookAssistants = useMemo(() => assistants.filter(assistant => assistant.type === 'webhook'), [assistants]);

  const resolveAssistantName = useCallback((assistantId: string | null | undefined) => {
    if (!assistantId) {
      return null;
    }
    const match = assistants.find(entry => entry.id === assistantId);
    return match?.name ?? null;
  }, [assistants]);

  const handleAssistantSelect = useCallback((value: string) => {
    if (!onAssistantChange) {
      return;
    }

    if (value === 'none') {
      onAssistantChange(null);
      return;
    }

    const selected = assistants.find(assistant => assistant.id === value);
    if (!selected) {
      return;
    }

    onAssistantChange({
      id: selected.id,
      type: selected.type as AssistantType,
      name: selected.name,
    });
  }, [assistants, onAssistantChange]);

  const { data: outputTemplatesData } = useQuery<{ templates: OutputTemplateSummary[] }>({
    queryKey: ['/api/output-templates'],
    staleTime: 300000,
  });

  const outputTemplates = outputTemplatesData?.templates ?? [];
  const selectedOutputTemplate = selectedOutputTemplateId
    ? outputTemplates.find(template => template.id === selectedOutputTemplateId) ?? null
    : null;



  // Slash command handlers
  const commandHandlers = {
    onAddKnowledge: () => {
      if (onOpenKnowledgeDialog) {
        onOpenKnowledgeDialog();
      } else {
        console.log('Knowledge dialog handler not provided');
      }
      setMessage('');
      setShowAutocomplete(false);
    },
    onNewProject: () => {
      if (onOpenNewProjectDialog) {
        onOpenNewProjectDialog();
      } else {
        console.log('New project dialog handler not provided');
      }
      setMessage('');
      setShowAutocomplete(false);
    },
    onSummarize: () => {
      setMessage('Please summarize our conversation so far.');
      setShowAutocomplete(false);
      textareaRef.current?.focus();
    },
    onSearch: () => {
      setMessage('Search: ');
      setShowAutocomplete(false);
      textareaRef.current?.focus();
    },
    onUsage: () => {
      onSendMessage('/usage');
      setMessage('');
      setShowAutocomplete(false);
    },
    onClause: () => {
      setMessage('Use Claude Code to: ');
      setShowAutocomplete(false);
      textareaRef.current?.focus();
    },
    onProposal: () => {
      setMessage('Create a Gamma proposal: ');
      setShowAutocomplete(false);
      textareaRef.current?.focus();
    },
    onSteve: () => {
      setMessage('Deep research: ');
      setShowAutocomplete(false);
      textareaRef.current?.focus();
    },
    onCCModel: () => {
      setMessage('');
      setShowAutocomplete(false);
      setCCPickerMode('model');
    },
    onCCEffort: () => {
      setMessage('');
      setShowAutocomplete(false);
      setCCPickerMode('effort');
    },
  };

  const slashCommands = createSlashCommands(commandHandlers, ccModel, ccEffort);

  const isVoiceToggleDisabled = isLoading || !speechSupported || !voiceEnabled;

  // Check if audio recording is supported
  useEffect(() => {
    const checkAudioSupport = async () => {
      try {
        if (
          navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
        ) {
          setSpeechSupported(true);
        }
      } catch {
        setSpeechSupported(false);
      }
    };
    checkAudioSupport();
  }, []);

  const showVoiceUnavailableNotice = useCallback(() => {
    toast({
      title: 'Voice input unavailable',
      description: 'Enable a TTS provider (e.g. ElevenLabs) in Settings → API Access to use voice.',
    });
  }, [toast]);

  const handleVoiceUnavailableInteraction = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
      showVoiceUnavailableNotice();
    },
    [showVoiceUnavailableNotice],
  );

  const buildMetadataPayload = useCallback(
    (additional?: Partial<ChatRequestMetadata>) => {
      const metadata: ChatRequestMetadata = {};

      if (thorModeEnabled) {
        metadata.thorMode = true;
      }

      if (thinkingLevel !== 'off') {
        metadata.thinkingLevel = thinkingLevel;
      }

      if (selectedOutputTemplateId) {
        metadata.outputTemplateId = selectedOutputTemplateId;
      }

      if (ccModel) metadata.ccModel = ccModel;
      if (ccEffort) metadata.ccEffort = ccEffort;

      if (additional) {
        Object.assign(metadata, additional);
      }

      return Object.keys(metadata).length > 0 ? metadata : undefined;
    },
    [thorModeEnabled, thinkingLevel, selectedOutputTemplateId, ccModel, ccEffort],
  );

  const handleVoiceToggleRef = useRef<() => Promise<void>>(async () => {});

  const handleVoicePointerDown = useCallback(() => {
    if (!voiceEnabled || !onStartConversationMode) return;
    voicePressTimerRef.current = setTimeout(() => {
      voicePressTimerRef.current = null;
      void onStartConversationMode();
    }, 500);
  }, [voiceEnabled, onStartConversationMode]);

  const handleVoicePointerUp = useCallback(() => {
    if (voicePressTimerRef.current !== null) {
      clearTimeout(voicePressTimerRef.current);
      voicePressTimerRef.current = null;
      void handleVoiceToggleRef.current();
    }
  }, []);

  const handleVoiceToggle = useCallback(async () => {
    if (!voiceEnabled) {
      showVoiceUnavailableNotice();
      return;
    }

    if (!speechSupported) {
      console.warn('Audio recording not supported');
      return;
    }

    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        mediaRecorderRef.current = null;

        const reader = new FileReader();
        reader.onloadend = async () => {
          const resultString = reader.result as string | null;
          if (!resultString) {
            return;
          }
          const base64Audio = resultString.split(',')[1];

          try {
            const response = await apiRequest('POST', '/api/transcribe', {
              audio: base64Audio,
              format: 'webm',
            });

            if (!response.ok) {
              const errBody = await response.json().catch(() => ({}));
              throw new Error((errBody as any).error || (errBody as any).message || 'Transcription failed');
            }

            const transcription = await response.json();
            const transcriptText = typeof transcription.text === 'string' ? transcription.text.trim() : '';

            if (transcriptText) {
              const metadataPayload = buildMetadataPayload({ voiceMode: true });
              onSendMessage(transcriptText, undefined, metadataPayload);
            } else {
              toast({ title: 'No speech detected', description: 'Try speaking clearly and closer to the microphone.', variant: 'default' });
            }
          } catch (error) {
            console.error('Transcription error:', error);
            toast({ title: 'Transcription failed', description: error instanceof Error ? error.message : 'Could not transcribe audio.', variant: 'destructive' });
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsRecording(false);
      toast({ title: 'Microphone error', description: error instanceof Error ? error.message : 'Could not access microphone.', variant: 'destructive' });
    }
  }, [buildMetadataPayload, isRecording, onSendMessage, showVoiceUnavailableNotice, speechSupported, toast, voiceEnabled]);

  // Keep ref current for long-press handler
  handleVoiceToggleRef.current = handleVoiceToggle;

  const handleSend = () => {
    if ((message.trim() || attachments.length > 0) && !isLoading) {
      const metadataPayload = buildMetadataPayload();

      onSendMessage(
        message.trim(),
        attachments.length > 0 ? attachments : undefined,
        metadataPayload
      );
      
      // Revoke object URLs to prevent memory leaks
      attachments.forEach(attachment => {
        if (attachment.preview) {
          URL.revokeObjectURL(attachment.preview);
        }
      });
      
      setMessage('');
      setAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Close CC sub-picker on Escape
    if (ccPickerMode !== 'none') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setCCPickerMode('none');
        return;
      }
    }
    // Handle autocomplete navigation
    if (showAutocomplete && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev => 
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev => prev > 0 ? prev - 1 : prev);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const selectedCommand = filteredCommands[selectedCommandIndex];
        if (selectedCommand) {
          selectedCommand.action();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }
    
    // Normal enter to send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    
    // Detect slash commands
    const trimmedValue = value.trim();
    if (trimmedValue.startsWith('/')) {
      const query = trimmedValue.toLowerCase();
      const filtered = slashCommands.filter(cmd => 
        cmd.name.toLowerCase().startsWith(query)
      );
      setFilteredCommands(filtered);
      setShowAutocomplete(filtered.length > 0);
      setSelectedCommandIndex(0);
    } else {
      setShowAutocomplete(false);
      setFilteredCommands([]);
    }
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const getFileType = (file: File): 'image' | 'document' | 'other' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.includes('pdf') || file.type.includes('document') || file.type.includes('text')) return 'document';
    return 'other';
  };

  // File type validation
  const validateFileType = (file: File): { valid: boolean; error?: string } => {
    const maxSize = maxFileSizeBytes;
    if (file.size > maxSize) {
      return { valid: false, error: `File too large (max ${maxFileSizeLabel})` };
    }
    
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: 'Unsupported file type' };
    }
    
    return { valid: true };
  };

  // Upload file to backend
  const uploadFile = async (attachment: FileAttachment): Promise<void> => {
    setAttachments(prev => prev.map(a => 
      a.id === attachment.id 
        ? { ...a, uploadStatus: 'uploading', uploadProgress: 0 }
        : a
    ));

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data:type;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(attachment.file);
      });

      // Simulate upload progress
      setAttachments(prev => prev.map(a => 
        a.id === attachment.id ? { ...a, uploadProgress: 50 } : a
      ));

      // Upload to backend
      const csrfToken = getCsrfToken() || await ensureCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch('/api/uploads', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          name: attachment.file.name,
          mimeType: attachment.file.type,
          data: base64,
          analyze: true
        })
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = `Upload failed (${response.status})`;
        try { errorMsg = JSON.parse(text).error || errorMsg; } catch { /* response was not JSON */ }
        throw new Error(errorMsg);
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error('Server returned an invalid response. Please try again.');
      }

      // Update attachment with server response
      setAttachments(prev => prev.map(a => 
        a.id === attachment.id 
          ? { 
              ...a, 
              uploadStatus: 'completed',
              uploadProgress: 100,
              id: result.id, // Use server-generated ID
              analysisResult: {
                hasAnalysis: result.hasAnalysis || false,
                contentPreview: result.contentPreview,
                metadata: result.metadata
              },
              uploadResult: {
                url: result.url,
                size: result.size,
              }
            }
          : a
      ));
    } catch (error) {
      console.error('Upload failed:', error);
      setAttachments(prev => prev.map(a => 
        a.id === attachment.id 
          ? { 
              ...a, 
              uploadStatus: 'failed',
              error: error instanceof Error ? error.message : 'Upload failed'
            }
          : a
      ));
    }
  };

  const processFiles = useCallback(async (files: FileList) => {
    const newAttachments: FileAttachment[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Validate file
      const validation = validateFileType(file);
      if (!validation.valid) {
        console.warn(`File ${file.name} rejected: ${validation.error}`);
        continue;
      }
      
      const fileType = getFileType(file);
      
      // Generate unique ID
      const id = `temp-${Date.now()}-${i}`;
      
      // Create preview for images
      let preview: string | undefined;
      if (fileType === 'image') {
        preview = URL.createObjectURL(file);
      }
      
      const attachment: FileAttachment = {
        id,
        file,
        preview,
        type: fileType,
        uploadStatus: 'pending'
      };
      
      newAttachments.push(attachment);
    }
    
    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
      
      // Auto-upload files
      for (const attachment of newAttachments) {
        uploadFile(attachment);
      }
    }
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const attachment = prev.find(a => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFiles(files);
    }
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const getFileIcon = (type: FileAttachment['type']) => {
    switch (type) {
      case 'image': return ImageIcon;
      case 'document': return FileText;
      default: return File;
    }
  };

  useEffect(() => {
    if (!onHeightChange || !containerRef.current) {
      return;
    }

    const notify = () => {
      if (containerRef.current) {
        onHeightChange(containerRef.current.offsetHeight);
      }
    };

    notify();

    const observer = new ResizeObserver(() => {
      notify();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [onHeightChange]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'sticky bottom-0 left-0 right-0 border-t border-border/50 bg-background/90 backdrop-blur-xl',
        className
      )}
    >
      <div className="relative mx-auto flex w-full max-w-[800px] flex-col gap-2 px-3 py-2 sm:px-4 sm:py-3">
        {/* Assistant Selection */}
        {assistants.length > 0 && onAssistantChange && (
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <Select
              value={selectedAssistant?.id || 'none'}
              onValueChange={handleAssistantSelect}
            >
              <SelectTrigger className="h-9 w-full sm:w-[280px]" data-testid="select-assistant">
                <SelectValue placeholder="Choose assistant (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No assistant</SelectItem>
                {promptAssistants.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Prompt assistants</SelectLabel>
                    {promptAssistants.map((assistant) => (
                      <SelectItem key={assistant.id} value={assistant.id} data-testid={`assistant-option-${assistant.id}`}>
                        {assistant.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {promptAssistants.length > 0 && webhookAssistants.length > 0 && <SelectSeparator />}
                {webhookAssistants.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Webhook assistants</SelectLabel>
                    {webhookAssistants.map((assistant) => (
                      <SelectItem key={assistant.id} value={assistant.id} data-testid={`assistant-option-${assistant.id}`}>
                        {assistant.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        )}


        {/* CC Sub-picker (model / effort) */}
        {ccPickerMode !== 'none' && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-violet-500/30 rounded-lg shadow-lg overflow-hidden z-50">
            <div className="p-2 border-b bg-violet-500/10 flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-violet-400" />
              <p className="text-xs text-violet-300 font-medium">
                {ccPickerMode === 'model' ? 'Claude Code — Select Model' : 'Claude Code — Select Effort'}
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {(ccPickerMode === 'model' ? CC_MODEL_OPTIONS : CC_EFFORT_OPTIONS).map((opt) => {
                const isActive = ccPickerMode === 'model' ? ccModel === opt.id : ccEffort === opt.id;
                return (
                  <button
                    key={String(opt.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                      isActive ? 'bg-violet-500/20' : 'hover:bg-muted/50',
                    )}
                    onClick={() => {
                      if (ccPickerMode === 'model') setCCModel(opt.id);
                      else setCCEffort(opt.id as 'low' | 'medium' | 'high' | null);
                      setCCPickerMode('none');
                      textareaRef.current?.focus();
                    }}
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-violet-400' : 'text-muted-foreground/40')} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium', isActive && 'text-violet-300')}>{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                    {isActive && <span className="text-[10px] text-violet-400 font-medium shrink-0">active</span>}
                  </button>
                );
              })}
            </div>
            <div className="p-2 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground">Click to select · Esc to cancel</p>
            </div>
          </div>
        )}

        {/* Slash Command Autocomplete */}
        {showAutocomplete && filteredCommands.length > 0 && (
          <div
            className="absolute bottom-full left-0 right-0 mb-2 bg-card border rounded-lg shadow-lg overflow-hidden z-50"
            data-testid="slash-command-autocomplete"
          >
            <div className="p-2 border-b bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium">Slash Commands</p>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredCommands.map((command, index) => {
                const Icon = command.icon;
                const isSelected = index === selectedCommandIndex;
                return (
                  <button
                    key={command.name}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                      isSelected ? "bg-accent" : "hover-elevate"
                    )}
                    onClick={() => {
                      command.action();
                    }}
                    data-testid={`slash-command-${command.name.slice(1)}`}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{command.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {command.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="p-2 border-t bg-muted/50">
              <p className="text-xs text-muted-foreground">
                Use ↑↓ to navigate, Enter to select, Esc to close
              </p>
            </div>
          </div>
        )}

        {/* Active Claude Code settings badges */}
        {(ccModel || ccEffort) && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-muted-foreground font-medium">CC:</span>
            {ccModel && (
              <button
                onClick={() => setCCModel(null)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-violet-500/15 text-violet-300 border border-violet-500/20 hover:bg-violet-500/25 transition-colors"
              >
                <Terminal className="h-3 w-3" />
                {CC_MODEL_OPTIONS.find(o => o.id === ccModel)?.label ?? ccModel}
                <X className="h-2.5 w-2.5 opacity-60" />
              </button>
            )}
            {ccEffort && (
              <button
                onClick={() => setCCEffort(null)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-violet-500/15 text-violet-300 border border-violet-500/20 hover:bg-violet-500/25 transition-colors"
              >
                <Zap className="h-3 w-3" />
                {ccEffort}
                <X className="h-2.5 w-2.5 opacity-60" />
              </button>
            )}
          </div>
        )}

        {/* File Attachments Preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => {
              const IconComponent = getFileIcon(attachment.type);
              const getStatusIcon = () => {
                switch (attachment.uploadStatus) {
                  case 'completed': return <CheckCircle2 className="h-3 w-3 text-green-600" />;
                  case 'failed': return <AlertCircle className="h-3 w-3 text-red-600" />;
                  case 'uploading': return <Upload className="h-3 w-3 text-blue-600 animate-pulse" />;
                  default: return null;
                }
              };
              
              return (
                <div
                  key={attachment.id}
                  className={cn(
                    "relative flex flex-col gap-2 p-3 bg-card border rounded-lg max-w-xs",
                    attachment.uploadStatus === 'failed' && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                  )}
                  data-testid={`attachment-${attachment.id}`}
                >
                  {/* Header with file info and status */}
                  <div className="flex items-center gap-2">
                    {attachment.type === 'image' && attachment.preview ? (
                      <img
                        src={attachment.preview}
                        alt={attachment.file.name}
                        className="w-8 h-8 object-cover rounded"
                      />
                    ) : (
                      <IconComponent className="w-6 h-6 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-medium truncate">{attachment.file.name}</p>
                        {getStatusIcon()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(attachment.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeAttachment(attachment.id)}
                      data-testid={`remove-attachment-${attachment.id}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Upload Progress */}
                  {attachment.uploadStatus === 'uploading' && (
                    <div className="space-y-1">
                      <Progress 
                        value={attachment.uploadProgress || 0} 
                        className="h-1"
                        data-testid={`upload-progress-${attachment.id}`}
                      />
                      <p className="text-xs text-muted-foreground">
                        Uploading and analyzing...
                      </p>
                    </div>
                  )}

                  {/* Error Message */}
                  {attachment.uploadStatus === 'failed' && attachment.error && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {attachment.error}
                    </p>
                  )}

                  {/* Analysis Result Preview */}
                  {attachment.uploadStatus === 'completed' && attachment.analysisResult?.hasAnalysis && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs px-1 py-0">
                          Analyzed
                        </Badge>
                        {attachment.analysisResult.metadata?.pages && (
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            {attachment.analysisResult.metadata.pages} pages
                          </Badge>
                        )}
                      </div>
                      {attachment.analysisResult.contentPreview && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {attachment.analysisResult.contentPreview}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Active Selections Chips */}
        {(selectedAssistant || selectedOutputTemplateId) && (
          <div className="flex flex-wrap items-center gap-2">
            {selectedAssistant && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 pl-2 pr-1 py-1"
                data-testid="chip-assistant"
              >
                <Shield className="h-3 w-3" />
                <span className="text-xs">
                  Assistant: {selectedAssistant.name ?? resolveAssistantName(selectedAssistant.id) ?? 'Custom assistant'} • {selectedAssistant.type === 'webhook' ? 'Webhook' : 'Prompt'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={() => onAssistantChange?.(null)}
                  data-testid="button-clear-assistant"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}
            {selectedOutputTemplateId && selectedOutputTemplate && (
              <Badge 
                variant="secondary" 
                className="flex items-center gap-1 pl-2 pr-1 py-1"
                data-testid="chip-template"
              >
                <FileText className="h-3 w-3" />
                <span className="text-xs">Template: {selectedOutputTemplate.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={() => setSelectedOutputTemplateId(null)}
                  data-testid="button-clear-template"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            )}
          </div>
        )}

        <div
          className={cn(
            'os-input-area relative flex w-full items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3 sm:py-2',
            isDragOver && 'border-primary/60 bg-primary/5 shadow-os-glow-sm'
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="file-input"
          />

          {/* Attachment button */}
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0 rounded-lg p-0 h-11 w-11 sm:h-10 sm:w-10"
            disabled={isLoading}
            data-testid="button-attach-file"
            onClick={handleFileSelect}
          >
            <Paperclip className="h-5 w-5" />
          </Button>

          {/* Output Template picker */}
          {outputTemplates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={selectedOutputTemplateId ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'flex-shrink-0 gap-1 px-2 transition-colors h-11 sm:h-10 sm:px-2.5 sm:gap-1.5',
                    selectedOutputTemplateId
                      ? 'bg-teal-900 text-teal-200 hover:bg-teal-800 border-teal-500/50'
                      : ''
                  )}
                  data-testid="toggle-output-template"
                  aria-label="Output template"
                  title={selectedOutputTemplate ? `Template: ${selectedOutputTemplate.name}` : 'Set output template'}
                >
                  <LayoutTemplate className={cn('h-4 w-4', selectedOutputTemplateId && 'fill-current opacity-80')} />
                  <span className="hidden text-xs font-medium sm:inline">
                    {selectedOutputTemplate ? selectedOutputTemplate.name : 'Format'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Output format</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setSelectedOutputTemplateId(null)}
                  className={cn('text-sm', !selectedOutputTemplateId && 'font-medium text-primary')}
                >
                  No template
                </DropdownMenuItem>
                {outputTemplates.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    onClick={() => setSelectedOutputTemplateId(template.id)}
                    className={cn('flex flex-col items-start gap-0.5 text-sm', selectedOutputTemplateId === template.id && 'font-medium text-primary')}
                    data-testid={`output-template-${template.id}`}
                  >
                    <span>{template.name}</span>
                    <span className="text-[11px] text-muted-foreground">{formatOutputTemplateCategory(template.category)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Thor Mode toggle */}
          <Button
            variant={thorModeEnabled ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex-shrink-0 gap-1 px-2 transition-colors h-11 sm:h-10 sm:px-3 sm:gap-1.5',
              thorModeEnabled && 'bg-blue-900 text-yellow-400 hover:bg-blue-800 border-yellow-400/50'
            )}
            onClick={() => onThorModeChange?.(!thorModeEnabled)}
            data-testid="toggle-thor-mode"
            aria-pressed={thorModeEnabled}
            aria-label="Toggle Thor Mode"
            title="Thor Mode — Max performance"
          >
            <Zap className={cn('h-5 w-5', thorModeEnabled && 'fill-yellow-400')} />
            <span className="sr-only sm:hidden">Thor</span>
            <span className="hidden text-xs font-medium sm:inline">Thor</span>
          </Button>

          {/* Text input */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyPress}
            placeholder={placeholder}
            disabled={isLoading}
            className="flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm leading-6 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 scrollbar-thin min-h-[1.75rem] max-h-[160px] sm:text-[15px]"
            style={{ height: 'auto' }}
            rows={1}
            data-testid="textarea-message-input"
          />

          {/* Voice input button */}
          {voiceEnabled ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'flex-shrink-0 rounded-lg p-0 h-11 w-11 sm:h-10 sm:w-10 text-muted-foreground transition-colors',
                isRecording
                  ? 'bg-primary/15 text-primary hover:bg-primary/25 animate-pulse'
                  : 'hover:text-primary'
              )}
              disabled={isVoiceToggleDisabled}
              data-testid="button-voice-input"
              onPointerDown={onStartConversationMode ? handleVoicePointerDown : undefined}
              onPointerUp={onStartConversationMode ? handleVoicePointerUp : undefined}
              onClick={onStartConversationMode ? undefined : handleVoiceToggle}
              aria-pressed={isRecording}
              aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording (hold for conversation mode)'}
            >
              <AtlasVoiceIcon className="h-5 w-5" />
            </Button>
          ) : (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    onClick={handleVoiceUnavailableInteraction}
                    onTouchEnd={handleVoiceUnavailableInteraction}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'flex-shrink-0 rounded-lg p-0 h-11 w-11 sm:h-10 sm:w-10 text-muted-foreground transition-colors cursor-not-allowed',
                        isRecording
                          ? 'bg-primary/15 text-primary'
                          : ''
                      )}
                      disabled={isVoiceToggleDisabled}
                      data-testid="button-voice-input"
                      aria-pressed={isRecording}
                      aria-label="Voice input unavailable"
                    >
                      <AtlasVoiceIcon className="h-5 w-5" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="max-w-xs text-center">
                  Voice input is disabled. Enable a TTS provider (e.g. ElevenLabs) in Settings → API Access.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={(!message.trim() && attachments.length === 0) || isLoading}
            className={cn(
              "flex-shrink-0 rounded-lg p-0 h-9 w-9",
              "bg-blue-600 hover:bg-blue-500 text-white border-0",
              "disabled:bg-muted disabled:text-muted-foreground",
              "shadow-none transition-all",
              (!message.trim() && attachments.length === 0) || isLoading
                ? ""
                : "shadow-os-glow-sm"
            )}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/5">
              <p className="text-sm font-medium text-primary">Drop files to attach</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-[11px] text-muted-foreground/40">
            {agentName} can make mistakes. Verify important information.
          </p>
        </div>
      </div>
      <div className="safe-area-spacer" aria-hidden="true" />
    </div>
  );
}
