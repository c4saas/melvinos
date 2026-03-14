import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  MessageSquare,
  FolderOpen,
  Settings,
  Plus,
  Search,
  Zap,
  Key,
  Plug,
  Brain,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const navigate = useCallback((path: string) => {
    setLocation(path);
    setOpen(false);
  }, [setLocation]);

  const commands = useMemo<CommandItem[]>(() => [
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a new conversation',
      icon: Plus,
      action: () => { navigate('/app'); window.location.reload(); },
      keywords: ['new', 'chat', 'conversation'],
    },
    {
      id: 'go-chat',
      label: 'Go to Chat',
      icon: MessageSquare,
      action: () => navigate('/app'),
      keywords: ['chat', 'messages', 'conversation'],
    },
    {
      id: 'go-workspace',
      label: 'Go to Workspace',
      description: 'Browse agent files',
      icon: FolderOpen,
      action: () => navigate('/workspace'),
      keywords: ['workspace', 'files', 'browse'],
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      icon: Settings,
      action: () => navigate('/settings'),
      keywords: ['settings', 'config', 'admin'],
    },
    {
      id: 'go-providers',
      label: 'AI Providers',
      description: 'Configure API keys',
      icon: Key,
      action: () => navigate('/settings/api-access'),
      keywords: ['api', 'keys', 'providers', 'openai', 'anthropic', 'groq'],
    },
    {
      id: 'go-mcp',
      label: 'MCP Servers',
      description: 'Manage tool servers',
      icon: Plug,
      action: () => navigate('/settings/mcp-servers'),
      keywords: ['mcp', 'servers', 'tools', 'connect'],
    },
    {
      id: 'go-skills',
      label: 'Skills',
      description: 'Configure agent skills',
      icon: Zap,
      action: () => navigate('/settings/skills'),
      keywords: ['skills', 'tools', 'features'],
    },
    {
      id: 'go-prompts',
      label: 'System Prompts',
      description: 'Edit agent instructions',
      icon: Bot,
      action: () => navigate('/settings/system-prompts'),
      keywords: ['prompt', 'system', 'instructions'],
    },
    {
      id: 'go-assistants',
      label: 'Subagent Library',
      description: 'Manage subagents',
      icon: Brain,
      action: () => navigate('/settings/assistants'),
      keywords: ['assistants', 'subagents', 'agents'],
    },
  ], [navigate]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.description?.toLowerCase().includes(q) ||
      cmd.keywords?.some(k => k.includes(q))
    );
  }, [query, commands]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Arrow navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) item.action();
    }
  }, [filtered, selectedIndex]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-mono text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => item.action()}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-2 text-sm text-left transition-colors",
                    i === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.label}</span>
                    {item.description && (
                      <span className="ml-2 text-xs text-muted-foreground">{item.description}</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
