import { Menu, ChevronDown, Activity, MessageSquarePlus, Cpu, Zap, AlertTriangle, Brain } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getModelById, type ModelProvider, type AIModel } from '@shared/schema';
import { useUsageSnapshot } from '@/hooks/useUsageSnapshot';
import { useBranding } from '@/hooks/useBranding';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ChatHeaderProps {
  onToggleSidebar: () => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  className?: string;
  availableModels: AIModel[];
  onHomeClick: () => void;
  showNewChatButton?: boolean;
  onNewChat?: () => void;
  isCreatingNewChat?: boolean;
  /** Optional streaming/thinking status to show in header */
  agentStatus?: 'idle' | 'thinking' | 'streaming';
  streamingActivity?: string | null;
  /** Skills panel */
  onOpenSkills?: () => void;
  enabledSkillsCount?: number;
  /** Thinking level control */
  thinkingLevel?: 'off' | 'standard' | 'extended';
  onThinkingLevelChange?: (level: 'off' | 'standard' | 'extended') => void;
}

const providerOrder: ModelProvider[] = ['OpenAI', 'Anthropic', 'Google', 'Groq', 'Perplexity', 'Ollama'];
const providerLabels: Partial<Record<ModelProvider, string>> = {
  OpenAI: 'OpenAI',
  Anthropic: 'Claude',
  Google: 'Google',
  Ollama: 'Ollama',
  Groq: 'Groq',
  Perplexity: 'Perplexity',
};

/** Color accent for each provider */
const providerDot: Partial<Record<ModelProvider, string>> = {
  OpenAI:     'bg-emerald-400',
  Anthropic:  'bg-amber-400',
  Google:     'bg-red-400',
  Groq:       'bg-blue-400',
  Perplexity: 'bg-violet-400',
  Ollama:     'bg-cyan-400',
};

export function ChatHeader({
  onToggleSidebar,
  selectedModel,
  onModelChange,
  className,
  availableModels,
  onHomeClick,
  showNewChatButton,
  onNewChat,
  isCreatingNewChat,
  agentStatus = 'idle',
  streamingActivity,
  onOpenSkills,
  enabledSkillsCount,
  thinkingLevel = 'off',
  onThinkingLevelChange,
}: ChatHeaderProps) {
  const { snapshot, isLoading: isUsageLoading, isFetching: isUsageFetching, error: usageError } = useUsageSnapshot();
  const { agentNameUpper } = useBranding();

  const primaryGroups = useMemo(() => (
    providerOrder
      .map(provider => ({
        provider,
        label: providerLabels[provider],
        dot: providerDot[provider],
        models: availableModels
          .filter(model => model.provider === provider && model.status !== 'legacy')
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(group => group.models.length > 0)
  ), [availableModels]);

  const legacyModels = useMemo(() => (
    availableModels
      .filter(model => model.status === 'legacy')
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [availableModels]);

  const fallbackModel = primaryGroups[0]?.models[0] || legacyModels[0] || availableModels[0] || getModelById(selectedModel);
  const currentModel = availableModels.find(model => model.id === selectedModel) || fallbackModel;

  const tokensFormatter = useMemo(() => new Intl.NumberFormat('en-US'), []);
  const totalTokens = snapshot?.totals.totalTokens ?? 0;
  const tokensLabel = tokensFormatter.format(Math.max(0, Math.round(totalTokens)));
  const isUsageSyncing = isUsageLoading || isUsageFetching;

  // Current provider dot color
  const currentProviderDot = useMemo(() => {
    const provider = currentModel?.provider as ModelProvider | undefined;
    return provider ? providerDot[provider] ?? 'bg-blue-400' : 'bg-blue-400';
  }, [currentModel]);

  const agentStatusLabel = agentStatus === 'streaming'
    ? (streamingActivity ?? 'Generating...')
    : agentStatus === 'thinking'
    ? 'Processing...'
    : 'Ready';

  const modelSupportsTools = currentModel?.capabilities?.includes('tools') ?? false;

  return (
    <header
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0',
        className,
      )}
    >
      {/* Left: Sidebar toggle + MelvinOS identity */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/60 lg:hidden"
          onClick={onToggleSidebar}
          data-testid="button-sidebar-toggle"
        >
          <Menu className="h-4 w-4" />
        </Button>

        {/* MelvinOS logo + status */}
        <button
          type="button"
          onClick={onHomeClick}
          className="hidden sm:flex items-center gap-2 group"
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <div className="relative flex items-center justify-center w-7 h-7">
            <div className="absolute inset-0 rounded-lg bg-blue-500/10 group-hover:bg-blue-500/15 transition-colors" />
            <svg viewBox="0 0 24 24" fill="none" className="relative w-4 h-4" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="url(#header-grad)" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="3" fill="url(#header-grad)" />
              <defs>
                <linearGradient id="header-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#60a5fa" /><stop offset="1" stopColor="#818cf8" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="hidden md:block text-sm font-semibold tracking-wide os-gradient-text">{agentNameUpper}</span>
        </button>

        {/* Agent status pill — hidden on mobile */}
        <div className={cn(
          "hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium",
          agentStatus === 'idle'
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-blue-500/10 border-blue-500/20 text-blue-400"
        )}>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            agentStatus === 'idle' ? "bg-emerald-400" : "bg-blue-400 animate-pulse-dot"
          )} />
          {agentStatusLabel}
        </div>

        {/* Thinking toggle — icon-only on mobile */}
        {onThinkingLevelChange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'flex items-center gap-1 h-7 rounded-full text-[11px] font-medium border transition-colors',
                  'px-1.5 sm:px-2',
                  thinkingLevel === 'off'
                    ? 'border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/60'
                    : thinkingLevel === 'standard'
                    ? 'bg-violet-500/15 border-violet-500/30 text-violet-400 hover:bg-violet-500/25'
                    : 'bg-purple-500/15 border-purple-500/30 text-purple-400 hover:bg-purple-500/25',
                )}
                onClick={() => {
                  const next = thinkingLevel === 'off' ? 'standard' : thinkingLevel === 'standard' ? 'extended' : 'off';
                  onThinkingLevelChange(next);
                }}
                data-testid="toggle-thinking"
                aria-label={`Thinking: ${thinkingLevel}`}
              >
                <Brain className={cn('h-3 w-3', thinkingLevel !== 'off' && 'fill-current')} />
                <span className="hidden sm:inline">
                  {thinkingLevel === 'off' ? 'Think' : thinkingLevel === 'standard' ? 'Think' : 'Deep Think'}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {thinkingLevel === 'off'
                ? 'Enable thinking — model reasons before responding'
                : thinkingLevel === 'standard'
                ? 'Standard thinking · Click for extended'
                : 'Extended thinking · Click to turn off'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Center: Model selector */}
      <div className="flex flex-1 min-w-0 justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="flex items-center gap-1.5 sm:gap-2 h-8 px-2 sm:px-3 rounded-lg text-xs border-border/60 bg-card/50 hover:bg-card hover:border-border max-w-[180px] sm:max-w-[280px]"
              data-testid="button-model-selector"
            >
              <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", currentProviderDot)} />
              <span className="truncate font-medium text-foreground/90">
                {currentModel?.name ?? 'Select model'}
              </span>
              {!modelSupportsTools && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertTriangle className="h-3 w-3 flex-shrink-0 text-amber-500" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                    This model doesn't support tools. Calendar, Gmail, Drive, and other integrations won't work. Switch to Claude or GPT to use them.
                  </TooltipContent>
                </Tooltip>
              )}
              <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-72 rounded-xl shadow-os-panel border border-border/60">
            {primaryGroups.map((group, index) => (
              <div key={group.provider}>
                {index > 0 && <DropdownMenuSeparator className="border-border/40" />}
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase text-muted-foreground/70 py-2"
                  data-testid={`section-label-${group.provider.toLowerCase()}`}
                >
                  <div className={cn("w-1.5 h-1.5 rounded-full", group.dot)} />
                  {group.label}
                </DropdownMenuLabel>
                {group.models.map(model => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => onModelChange(model.id)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg',
                      selectedModel === model.id && 'bg-primary/10 text-primary'
                    )}
                    data-testid={`model-option-${model.id}`}
                  >
                    <div className="font-medium text-sm leading-tight">{model.name}</div>
                    {model.description && (
                      <div className="text-[11px] leading-snug text-muted-foreground">{model.description}</div>
                    )}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
            {legacyModels.length > 0 && (
              <>
                <DropdownMenuSeparator className="border-border/40" />
                <DropdownMenuLabel className="text-xs font-semibold tracking-wide uppercase text-muted-foreground/70 py-2"
                  data-testid="section-label-legacy"
                >
                  Legacy
                </DropdownMenuLabel>
                {legacyModels.map(model => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => onModelChange(model.id)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg',
                      selectedModel === model.id && 'bg-primary/10 text-primary'
                    )}
                    data-testid={`model-option-${model.id}`}
                  >
                    <div className="font-medium text-sm">{model.name}</div>
                    {model.description && (
                      <div className="text-[11px] text-muted-foreground">{model.description}</div>
                    )}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: Usage + actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Token usage (compact) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href="/usage">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs",
                  "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
                data-testid="button-usage-tracking"
              >
                <Cpu className="h-3.5 w-3.5" />
                {!isUsageSyncing && !usageError && snapshot ? (
                  <span className="font-medium" data-testid="usage-tokens">{tokensLabel}</span>
                ) : (
                  <span>Usage</span>
                )}
              </Button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isUsageSyncing ? 'Syncing...' : usageError ? 'Unavailable' : `${tokensLabel} tokens · View usage`}
          </TooltipContent>
        </Tooltip>

        {/* Skills quick-panel trigger */}
        {onOpenSkills && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="relative h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
                onClick={onOpenSkills}
                aria-label="Skills & Tools"
                data-testid="button-skills-panel"
              >
                <Zap className="h-4 w-4" />
                {enabledSkillsCount != null && enabledSkillsCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {enabledSkillsCount > 9 ? '9+' : enabledSkillsCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Skills &amp; Tools{enabledSkillsCount != null ? ` · ${enabledSkillsCount} active` : ''}
            </TooltipContent>
          </Tooltip>
        )}

        {showNewChatButton && onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
                onClick={onNewChat}
                disabled={isCreatingNewChat}
                aria-label="New chat"
                data-testid="button-new-chat-header"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">New chat</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
