import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Wrench, CheckCircle2, XCircle, Loader2, Terminal, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCallInfo {
  id?: string;
  tool: string;
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
  status?: string;
  durationMs?: number;
}

interface AgentActivityPanelProps {
  toolCalls: ToolCallInfo[];
  iteration?: number;
  maxIterations?: number;
  className?: string;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web Search',
  web_fetch: 'Fetch Web Page',
  python_execute: 'Python',
  file_read: 'Read File',
  file_write: 'Write File',
  file_edit: 'Edit File',
  shell_execute: 'Shell',
  memory_save: 'Save Memory',
  memory_search: 'Search Memory',
  deep_research: 'Deep Research',
  image_generate: 'Generate Image',
  gmail_search: 'Search Gmail',
  calendar_events: 'Calendar Events',
  recall_search: 'Search Meetings',
  recall_meetings: 'List Meetings',
  recall_create_bot: 'Record Meeting',
  notion_search: 'Notion Search',
  notion_read_page: 'Read Notion Page',
  notion_create_page: 'Create Notion Page',
  notion_update_page: 'Update Notion Page',
  gmail_read: 'Read Email',
  gmail_send: 'Send Email',
  gmail_modify: 'Manage Email',
  calendar_create_event: 'Create Event',
  calendar_update_event: 'Update Event',
  calendar_delete_event: 'Delete Event',
  drive_search: 'Search Drive',
  drive_read: 'Read Drive File',
  drive_write: 'Create Drive File',
  video_generate: 'Generate Video',
  consolidate_data: 'Consolidate Data',
  spawn_task: 'Spawn Task',
  claude_code: 'Claude Code',
  cc_Bash: 'Bash',
  cc_Read: 'Read',
  cc_Write: 'Write',
  cc_Edit: 'Edit',
  cc_Glob: 'Glob',
  cc_Grep: 'Grep',
  cc_WebSearch: 'Web Search',
  cc_WebFetch: 'Fetch URL',
  cc_TodoWrite: 'Update Todos',
  cc_TodoRead: 'Read Todos',
  cc_LS: 'List Dir',
  cc_NotebookRead: 'Read Notebook',
  cc_NotebookEdit: 'Edit Notebook',
  cc_Task: 'Spawn Agent',
};

function formatToolLabel(rawName: string): string {
  if (TOOL_LABELS[rawName]) return TOOL_LABELS[rawName];
  if (rawName.startsWith('cc_')) {
    const inner = rawName.slice(3);
    return inner.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (rawName.startsWith('mcp_')) {
    const parts = rawName.split('_');
    return parts
      .slice(2)
      .join(' \u2014 ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return rawName;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function ToolCallItem({ call }: { call: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const label = formatToolLabel(call.tool);
  const isRunning = call.status === 'running';
  const hasError = Boolean(call.error);
  const isSub = call.tool.startsWith('cc_');
  const isCC = call.tool === 'claude_code';

  return (
    <div
      className={cn(
        'border rounded-md overflow-hidden',
        isSub ? 'border-violet-500/20 ml-4' : 'border-border/40',
        isCC && 'border-violet-500/40 bg-violet-500/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
        ) : hasError ? (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              isCC || isSub ? 'text-violet-400' : 'text-emerald-400',
            )}
          />
        )}

        {isCC ? (
          <Terminal className="h-3 w-3 text-violet-400 shrink-0" />
        ) : (
          <Wrench
            className={cn(
              'h-3 w-3 shrink-0',
              isSub ? 'text-violet-400/70' : 'text-muted-foreground',
            )}
          />
        )}

        <span className={cn('font-medium truncate', isCC ? 'text-violet-300' : isSub ? 'text-foreground/80' : 'text-foreground')}>
          {isCC ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-violet-400 font-semibold shrink-0">Claude Code</span>
              {call.args?.prompt && (
                <span className="text-muted-foreground font-normal truncate">
                  — {String(call.args.prompt).slice(0, 60)}{String(call.args.prompt).length > 60 ? '…' : ''}
                </span>
              )}
            </span>
          ) : isSub ? (
            <span className="flex items-center gap-1">
              <span className="text-violet-400/60 text-[10px] font-mono shrink-0">CC</span>
              <span className="text-muted-foreground shrink-0">›</span>
              <span>{label}</span>
            </span>
          ) : (
            label
          )}
        </span>

        {call.durationMs != null && (
          <span className="text-muted-foreground ml-auto mr-1 shrink-0">{formatDuration(call.durationMs)}</span>
        )}
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 py-2 border-t border-border/30 bg-muted/20 space-y-2">
          {call.args && Object.keys(call.args).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Input</p>
              <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Output</p>
              {call.tool === 'image_generate' && call.output.match(/!\[.*?\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)/) ? (
                <div className="space-y-2">
                  <img
                    src={call.output.match(/!\[.*?\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)/)?.[1] ?? ''}
                    alt="Generated image"
                    className="max-w-full rounded-md border border-border/30"
                    style={{ maxHeight: '256px' }}
                    loading="lazy"
                  />
                  {call.output.includes('Revised prompt:') && (
                    <p className="text-[11px] text-muted-foreground">
                      {call.output.split('Revised prompt:')[1]?.trim()}
                    </p>
                  )}
                </div>
              ) : call.tool === 'video_generate' && call.output.match(/<video[^>]*src="((?:https?:\/\/|\/api\/)[^"]+)"/) ? (
                <div className="space-y-2">
                  <video
                    src={call.output.match(/<video[^>]*src="((?:https?:\/\/|\/api\/)[^"]+)"/)?.[1] ?? ''}
                    controls
                    className="max-w-full rounded-md border border-border/30"
                    style={{ maxHeight: '256px' }}
                    preload="metadata"
                  />
                </div>
              ) : (
                <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                  {call.output.length > 500 ? call.output.slice(0, 500) + '...' : call.output}
                </pre>
              )}
            </div>
          )}
          {call.error && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-red-400 mb-1">Error</p>
              <pre className="text-[11px] text-red-300 whitespace-pre-wrap break-all">{call.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentActivityPanel({ toolCalls, iteration, maxIterations, className }: AgentActivityPanelProps) {
  const count = toolCalls.length;
  const isAnyRunning = toolCalls.some(t => t.status === 'running');
  const totalMs = toolCalls.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  // Start expanded while streaming; start collapsed for completed historical messages
  const [isOpen, setIsOpen] = useState(isAnyRunning);

  // Auto-expand when tools start running (live streaming)
  useEffect(() => {
    if (isAnyRunning) setIsOpen(true);
  }, [isAnyRunning]);

  if (count === 0) return null;

  // Single tool — render as before, no wrapper needed
  if (count === 1) {
    return (
      <div className={cn('space-y-1.5 my-2', className)}>
        {iteration != null && maxIterations != null && (
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Agent Step {iteration}/{maxIterations}
          </p>
        )}
        <ToolCallItem call={toolCalls[0]} />
      </div>
    );
  }

  // Multiple tools — collapsible summary
  const hasErrors = toolCalls.some(t => Boolean(t.error));

  return (
    <div className={cn('my-2', className)}>
      <button
        onClick={() => setIsOpen(v => !v)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 rounded-md border text-xs transition-colors',
          hasErrors
            ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
            : 'border-border/40 bg-muted/20 hover:bg-muted/40',
        )}
      >
        {isAnyRunning ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
        ) : (
          <Zap className={cn('h-3.5 w-3.5 shrink-0', hasErrors ? 'text-red-400' : 'text-amber-400')} />
        )}

        <span className="font-medium text-foreground">
          {isAnyRunning
            ? `Running ${count} action${count !== 1 ? 's' : ''}…`
            : `Ran ${count} action${count !== 1 ? 's' : ''}`}
        </span>

        {!isAnyRunning && totalMs > 0 && (
          <span className="text-muted-foreground">· {formatDuration(totalMs)} total</span>
        )}

        {hasErrors && !isAnyRunning && (
          <span className="text-red-400 text-[10px]">· {toolCalls.filter(t => t.error).length} error{toolCalls.filter(t => t.error).length !== 1 ? 's' : ''}</span>
        )}

        <span className="ml-auto shrink-0 text-muted-foreground">
          {isOpen
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {isOpen && (
        <div className="mt-1.5 space-y-1.5">
          {iteration != null && maxIterations != null && (
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
              Agent Step {iteration}/{maxIterations}
            </p>
          )}
          {toolCalls.map((call, i) => (
            <ToolCallItem key={call.id || `tc-${i}`} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
