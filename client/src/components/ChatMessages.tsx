import { forwardRef, useState, useEffect, useImperativeHandle, useRef, useMemo, type ReactNode } from 'react';
import { User, Bot, Copy, RotateCcw, ThumbsUp, ThumbsDown, ChevronDown, ChevronRight, Brain, Globe, Code, BookOpen, ExternalLink, Loader2, CheckCircle2, AlertCircle, Workflow, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { parseMarkdownTable, looksLikeTableDivider, looksLikeTableRow } from '@/lib/markdownTable';
import type { MarkdownTableParseResult } from '@/lib/markdownTable';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { Message as MessageType, Reaction, MessageMetadata } from '@shared/schema';
import { CodeBlock } from './CodeBlock';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { VoicePlaybackControls } from './VoicePlaybackControls';
import { AtlasWelcomeIcon } from './icons/AtlasWelcomeIcon';
import { AtlasWelcome as AtlasWelcomeState } from './AtlasStatusIndicator';
import { AgentActivityPanel } from './AgentActivityPanel';
import type {
  VoicePlaybackController,
  VoicePlaybackState,
  VoicePlaybackClip,
} from '@/hooks/useVoicePlaybackController';
import { requestVoiceStream } from '@/lib/voice';
import { useBranding } from '@/hooks/useBranding';

interface Message extends MessageType {
  // Extended interface for any additional frontend properties
}

type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; lang?: string; rawLang?: string };

type ViewMode = 'formatted' | 'plain';

type ScrollBlockOption = 'start' | 'center' | 'end' | 'nearest';

type MetadataVoiceClip = NonNullable<MessageMetadata['audioClips']>[number];

interface HydratedClipsState {
  clips: VoicePlaybackClip[];
  isLoading: boolean;
}

const createClipDependencyKey = (clips: MetadataVoiceClip[] | undefined): string => {
  if (!clips || clips.length === 0) {
    return 'empty';
  }
  return clips
    .map(clip =>
      [
        clip.clipId,
        clip.audioUrl ?? 'no-url',
        clip.mimeType ?? 'unknown',
        typeof clip.durationMs === 'number' ? clip.durationMs : 'no-duration',
        typeof clip.sizeBytes === 'number' ? clip.sizeBytes : 'no-size',
      ].join('::'),
    )
    .join('|');
};

function useHydratedVoiceClips(clips: MetadataVoiceClip[] | undefined): HydratedClipsState {
  const [state, setState] = useState<HydratedClipsState>({ clips: [], isLoading: false });
  const dependencyKey = useMemo(() => createClipDependencyKey(clips), [clips]);

  useEffect(() => {
    const descriptors = clips ?? [];
    if (descriptors.length === 0) {
      setState({ clips: [], isLoading: false });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setState(current => ({ clips: current.clips, isLoading: true }));

    (async () => {
      const hydrated: VoicePlaybackClip[] = [];

      for (const clip of descriptors) {
        try {
          if (clip.audioUrl) {
            const response = await fetch(clip.audioUrl, { signal: controller.signal });
            if (!response.ok) {
              throw new Error(`Failed to fetch audio clip ${clip.clipId}: ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            hydrated.push({
              clipId: clip.clipId,
              mimeType: clip.mimeType ?? 'audio/webm',
              buffers: [buffer],
              text: clip.text,
              durationMs: clip.durationMs,
              sizeBytes: clip.sizeBytes,
              isComplete: true,
            });
            continue;
          }

          if (!clip.text) {
            continue;
          }

          const inferredFormat = clip.mimeType?.includes('wav') ? 'wav' : 'mp3';
          const stream = await requestVoiceStream({
            text: clip.text,
            voice: undefined,
            model: undefined,
            format: inferredFormat,
            target: 'assistant',
            signal: controller.signal,
          });

          hydrated.push({
            clipId: clip.clipId || stream.clipId,
            mimeType: clip.mimeType ?? stream.mimeType,
            buffers: [stream.buffer],
            text: clip.text ?? stream.text,
            durationMs: clip.durationMs,
            sizeBytes: clip.sizeBytes ?? stream.buffer.byteLength,
            isComplete: true,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
          console.error('Failed to load voice clip audio', error);
        }
      }

      if (!cancelled) {
        setState({ clips: hydrated, isLoading: false });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [clips, dependencyKey]);

  return state;
}

interface AssistantVoicePlaybackPanelProps {
  clips: MetadataVoiceClip[] | undefined;
  transcripts: string[];
}

function AssistantVoicePlaybackPanel({ clips, transcripts }: AssistantVoicePlaybackPanelProps) {
  const { clips: hydratedClips, isLoading } = useHydratedVoiceClips(clips);
  const totalDurationMs = useMemo(
    () => (clips ?? []).reduce((total, clip) => total + (clip.durationMs ?? 0), 0),
    [clips],
  );

  return (
    <div className="mb-3">
      <VoicePlaybackControls
        status="idle"
        progressMs={0}
        totalDurationMs={totalDurationMs}
        onPlay={noopAsync}
        onPause={noopAsync}
        clips={hydratedClips}
        disabled={hydratedClips.length === 0 || isLoading}
        transcripts={transcripts}
      />
    </div>
  );
}

export interface ChatMessagesHandle {
  scrollToBottom: (options?: ScrollToOptions) => void;
  scrollToTop: (options?: ScrollToOptions) => void;
  scrollToMessage: (messageId: string, options?: { behavior?: ScrollBehavior; block?: ScrollBlockOption }) => void;
}

const CODE_BLOCK_REGEX = /```([\w+-]*)\s*\n([\s\S]*?)```/g;

function parseMessageContent(content: string): ContentSegment[] {
  if (!content) {
    return [];
  }

  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textPortion = content.slice(lastIndex, match.index);
      if (textPortion) {
        segments.push({ type: 'text', content: textPortion });
      }
    }

    const rawLang = (match[1] || '').trim();
    segments.push({
      type: 'code',
      content: match[2],
      lang: rawLang || undefined,
      rawLang: rawLang || undefined,
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remainder = content.slice(lastIndex);
    if (remainder) {
      segments.push({ type: 'text', content: remainder });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', content }];
}

const segmentsToString = (segments: ContentSegment[]): string =>
  segments
    .map((segment) => {
      if (segment.type === 'code') {
        const langToken = segment.rawLang ?? segment.lang ?? '';
        return `\`\`\`${langToken}\n${segment.content}\n\`\`\``;
      }
      return segment.content;
    })
    .join('');

interface ParsedSource {
  id: string;
  label: string;
  href?: string;
  raw: string;
}

const SOURCE_SECTION_REGEX = /(?:\r?\n){1,}\s*\**\s*Sources:\s*\**\s*(?:\r?\n)([\s\S]+)$/i;

function parseSourceLine(line: string, index: number): ParsedSource {
  const cleaned = line.replace(/^\s*\d+[.)-]?\s*/, '').trim();
  const markdownLink = cleaned.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  if (markdownLink) {
    return {
      id: `${index}`,
      label: markdownLink[1].trim(),
      href: markdownLink[2],
      raw: line,
    };
  }

  const urlMatch = cleaned.match(/(https?:\/\/\S+)/);
  if (urlMatch) {
    const label = cleaned.replace(urlMatch[1], '').trim();
    return {
      id: `${index}`,
      label: label || urlMatch[1],
      href: urlMatch[1],
      raw: line,
    };
  }

  return {
    id: `${index}`,
    label: cleaned || `Source ${index + 1}`,
    raw: line,
  };
}

function extractSources(content: string): { body: string; sources: ParsedSource[] } {
  const match = content.match(SOURCE_SECTION_REGEX);
  if (!match) {
    return { body: content, sources: [] };
  }

  const body = content.slice(0, match.index).trimEnd();
  const sourcesText = match[1].trim();
  if (!sourcesText) {
    return { body, sources: [] };
  }

  const lines = sourcesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    body,
    sources: lines.map((line, index) => parseSourceLine(line, index)),
  };
}

type InlinePatternType = 'image' | 'link' | 'url' | 'bold' | 'italic' | 'underline' | 'code';

interface InlinePattern {
  type: InlinePatternType;
  create: () => RegExp;
}

const INLINE_PATTERNS: InlinePattern[] = [
  { type: 'image', create: () => /!\[([^\]]*)\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)/ },
  { type: 'link', create: () => /\[([^\]]+)\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)/ },
  { type: 'url', create: () => /(https?:\/\/[^\s)]+)/ },
  { type: 'bold', create: () => /\*\*(.+?)\*\*/ },
  { type: 'bold', create: () => /__(.+?)__/ },
  { type: 'underline', create: () => /\+\+(.+?)\+\+/ },
  { type: 'italic', create: () => /\*(.+?)\*/ },
  { type: 'italic', create: () => /_(.+?)_/ },
  { type: 'code', create: () => /`([^`]+)`/ },
];

const tableAlignmentClassMap: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function renderTableBlock(
  table: MarkdownTableParseResult,
  key: string,
  isUser: boolean,
  keyPrefix: string,
): ReactNode {
  const headerKeyBase = `${keyPrefix}-table-header`;
  const bodyKeyBase = `${keyPrefix}-table-body`;
  return (
    <div
      key={key}
      className={cn(
        'table-responsive',
        isUser ? 'table-responsive-user' : 'table-responsive-assistant'
      )}
    >
      <div className="table-scroll">
        <table className="min-w-full border-collapse table-auto font-[Inter,system-ui,sans-serif]">
          <thead className="bg-muted/60">
            <tr>
              {table.headers.map((header, headerIndex) => (
                <th
                  key={`${headerKeyBase}-${headerIndex}`}
                  className={cn(
                    'px-3 py-2 text-[11px] sm:text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-muted-foreground',
                    tableAlignmentClassMap[table.alignments[headerIndex] ?? 'left'],
                  )}
                >
                  {parseInlineMarkdown(header, `${headerKeyBase}-${headerIndex}-content`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {table.rows.map((row, rowIndex) => (
              <tr key={`${bodyKeyBase}-${rowIndex}`} className={isUser ? 'bg-primary/20' : 'bg-card'}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${bodyKeyBase}-${rowIndex}-${cellIndex}`}
                    className={cn(
                      'px-3 py-2 align-top min-w-[6rem] text-[11px] leading-4 sm:text-[13px] sm:leading-5',
                      isUser ? 'text-foreground' : 'text-card-foreground',
                      tableAlignmentClassMap[table.alignments[cellIndex] ?? 'left'],
                    )}
                  >
                    {parseInlineMarkdown(cell, `${bodyKeyBase}-${rowIndex}-${cellIndex}-content`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-stacked">
        {table.rows.map((row, rowIndex) => (
          <div key={`${bodyKeyBase}-stacked-${rowIndex}`} className="table-stacked-row">
            {row.map((cell, cellIndex) => (
              <div key={`${bodyKeyBase}-stacked-${rowIndex}-${cellIndex}`} className="table-stacked-cell">
                <div className="table-stacked-label">
                  {parseInlineMarkdown(table.headers[cellIndex] ?? '', `${headerKeyBase}-stacked-${cellIndex}`)}
                </div>
                <div
                  className={cn(
                    'table-stacked-value',
                    isUser ? 'text-foreground' : 'text-card-foreground'
                  )}
                >
                  {parseInlineMarkdown(cell, `${bodyKeyBase}-stacked-${rowIndex}-${cellIndex}-content`)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  // Convert <br>, <br/>, <br /> tags to actual line breaks before parsing
  const segments = text.split(/<br\s*\/?>/gi);
  if (segments.length > 1) {
    const result: ReactNode[] = [];
    segments.forEach((seg, i) => {
      if (i > 0) result.push(<br key={`${keyPrefix}-br-${i}`} />);
      result.push(...parseInlineMarkdown(seg, `${keyPrefix}-seg-${i}`));
    });
    return result;
  }

  const nodes: ReactNode[] = [];
  let remaining = text;
  let partIndex = 0;

  while (remaining.length > 0) {
    let earliest: { index: number; pattern: InlinePattern; match: RegExpExecArray } | null = null;

    for (const pattern of INLINE_PATTERNS) {
      const regex = pattern.create();
      const match = regex.exec(remaining);
      if (match) {
        const matchIndex = match.index;
        if (!earliest || matchIndex < earliest.index) {
          earliest = { index: matchIndex, pattern, match };
        }
      }
    }

    if (!earliest) {
      nodes.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      nodes.push(remaining.slice(0, earliest.index));
    }

    const matchedText = earliest.match[0];
    const content = earliest.match[1] ?? '';
    const key = `${keyPrefix}-inline-${partIndex++}`;

    switch (earliest.pattern.type) {
      case 'image': {
        const alt = content || 'Generated image';
        const src = earliest.match[2];
        nodes.push(
          <img
            key={key}
            src={src}
            alt={alt}
            className="inline-block max-w-full rounded-lg border border-border/40 shadow-sm my-1"
            style={{ maxHeight: '384px' }}
            loading="lazy"
          />,
        );
        break;
      }
      case 'link': {
        const label = content;
        const href = earliest.match[2];
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            {parseInlineMarkdown(label, `${key}-label`)}
          </a>,
        );
        break;
      }
      case 'url': {
        nodes.push(
          <a
            key={key}
            href={matchedText}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            {matchedText}
          </a>,
        );
        break;
      }
      case 'bold': {
        nodes.push(
          <strong key={key} className="font-semibold">
            {parseInlineMarkdown(content, `${key}-bold`)}
          </strong>,
        );
        break;
      }
      case 'italic': {
        nodes.push(
          <em key={key} className="italic">
            {parseInlineMarkdown(content, `${key}-italic`)}
          </em>,
        );
        break;
      }
      case 'underline': {
        nodes.push(
          <span key={key} className="underline">
            {parseInlineMarkdown(content, `${key}-underline`)}
          </span>,
        );
        break;
      }
      case 'code': {
        nodes.push(
          <code
            key={key}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
          >
            {content}
          </code>,
        );
        break;
      }
    }

    remaining = remaining.slice(earliest.index + matchedText.length);
  }

  return nodes;
}

function renderMarkdownBlocks(content: string, keyPrefix: string, isUser: boolean): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: ReactNode[] = [];
  let listBuffer: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let blockquoteBuffer: string[] | null = null;
  let blockIndex = 0;

  const textColor = isUser ? 'text-foreground' : 'text-card-foreground';

  const flushList = () => {
    if (!listBuffer) return;
    const listKey = `${keyPrefix}-list-${blockIndex++}`;
    if (listBuffer.type === 'ul') {
      elements.push(
        <ul key={listKey} className={cn('list-disc space-y-2 pl-5 text-[15px] leading-7 text-pretty', textColor)}>
          {listBuffer.items.map((item, idx) => (
            <li key={`${listKey}-item-${idx}`} className="break-words">
              {parseInlineMarkdown(item, `${listKey}-item-${idx}`)}
            </li>
          ))}
        </ul>,
      );
    } else {
      elements.push(
        <ol key={listKey} className={cn('list-decimal space-y-2 pl-5 text-[15px] leading-7 text-pretty', textColor)}>
          {listBuffer.items.map((item, idx) => (
            <li key={`${listKey}-item-${idx}`} className="break-words">
              {parseInlineMarkdown(item, `${listKey}-item-${idx}`)}
            </li>
          ))}
        </ol>,
      );
    }
    listBuffer = null;
  };

  const flushBlockquote = () => {
    if (!blockquoteBuffer) return;
    const quoteKey = `${keyPrefix}-quote-${blockIndex++}`;
    elements.push(
      <div
        key={quoteKey}
        className="rounded-xl border border-primary/30 bg-muted/40 px-4 py-3 text-muted-foreground"
      >
        <div className="space-y-1">
          {blockquoteBuffer.map((line, idx) => (
            <p key={`${quoteKey}-line-${idx}`} className="text-[15px] leading-7 text-pretty">
              {parseInlineMarkdown(line, `${quoteKey}-line-${idx}`)}
            </p>
          ))}
        </div>
      </div>,
    );
    blockquoteBuffer = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushBlockquote();
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLine = trimmed.replace(/^>\s?/, '');
      if (!blockquoteBuffer) {
        blockquoteBuffer = [];
      }
      blockquoteBuffer.push(quoteLine);
      continue;
    }

    flushBlockquote();

    if (
      looksLikeTableRow(line) &&
      lineIndex + 1 < lines.length &&
      looksLikeTableDivider(lines[lineIndex + 1])
    ) {
      flushList();
      const parsedTable = parseMarkdownTable(lines, lineIndex);
      if (parsedTable) {
        const tableKey = `${keyPrefix}-table-${blockIndex++}`;
        elements.push(renderTableBlock(parsedTable, tableKey, isUser, keyPrefix));
        lineIndex = parsedTable.nextIndex - 1;
        continue;
      }
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = Math.min(headingMatch[1].length, 4);
      const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3' | 'h4';
      const headingKey = `${keyPrefix}-heading-${blockIndex++}`;
      const sizeClass =
        level === 1
          ? 'text-2xl'
          : level === 2
            ? 'text-xl'
            : level === 3
              ? 'text-lg'
              : 'text-base';
      const marginClass = elements.length === 0 ? 'mt-0' : 'mt-6';
      elements.push(
        <Tag
          key={headingKey}
          className={cn(
            sizeClass,
            marginClass,
            'font-semibold tracking-tight text-pretty',
            isUser ? 'text-foreground' : 'text-foreground',
          )}
        >
          {parseInlineMarkdown(headingMatch[2].trim(), `${headingKey}-content`)}
        </Tag>,
      );
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushList();
      const ruleKey = `${keyPrefix}-rule-${blockIndex++}`;
      elements.push(<hr key={ruleKey} className="my-6 border-border/50" />);
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      if (!listBuffer || listBuffer.type !== 'ol') {
        flushList();
        listBuffer = { type: 'ol', items: [] };
      }
      listBuffer.items.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      if (!listBuffer || listBuffer.type !== 'ul') {
        flushList();
        listBuffer = { type: 'ul', items: [] };
      }
      listBuffer.items.push(unorderedMatch[1]);
      continue;
    }

    // Image: ![alt](url) on its own line
    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(((?:https?:\/\/|\/api\/)[^\s)]+)\)$/);
    if (imageMatch) {
      flushList();
      const imgKey = `${keyPrefix}-img-${blockIndex++}`;
      elements.push(
        <div key={imgKey} className="my-3">
          <img
            src={imageMatch[2]}
            alt={imageMatch[1] || 'Generated image'}
            className="max-w-full rounded-lg border border-border/40 shadow-sm"
            style={{ maxHeight: '512px' }}
            loading="lazy"
          />
          {imageMatch[1] && imageMatch[1] !== 'Generated image' && (
            <p className="mt-1 text-xs text-muted-foreground">{imageMatch[1]}</p>
          )}
        </div>,
      );
      continue;
    }

    // HTML <video> tag (from video generation tools)
    const htmlVideoMatch = trimmed.match(/^<video[^>]*\ssrc="((?:https?:\/\/|\/api\/)[^"]+)"[^>]*><\/video>$/);
    if (htmlVideoMatch) {
      flushList();
      const vidKey = `${keyPrefix}-vid-${blockIndex++}`;
      elements.push(
        <div key={vidKey} className="my-3">
          <video
            src={htmlVideoMatch[1]}
            controls
            className="max-w-full rounded-lg border border-border/40 shadow-sm"
            style={{ maxHeight: '512px' }}
            preload="metadata"
          />
        </div>,
      );
      continue;
    }

    // Video link: [Watch Video](url) where URL points to video content
    const videoMatch = trimmed.match(/^\[([^\]]*)\]\(((?:https?:\/\/|\/api\/)[^\s)]+(?:\.mp4[^\s)]*)?)\)$/);
    if (videoMatch && (videoMatch[2].includes('.mp4') || videoMatch[2].includes('/api/files/'))) {
      flushList();
      const vidKey = `${keyPrefix}-vid-${blockIndex++}`;
      elements.push(
        <div key={vidKey} className="my-3">
          <video
            src={videoMatch[2]}
            controls
            className="max-w-full rounded-lg border border-border/40 shadow-sm"
            style={{ maxHeight: '512px' }}
            preload="metadata"
          />
          {videoMatch[1] && (
            <p className="mt-1 text-xs text-muted-foreground">{videoMatch[1]}</p>
          )}
        </div>,
      );
      continue;
    }

    flushList();
    const paragraphKey = `${keyPrefix}-paragraph-${blockIndex++}`;
    elements.push(
      <p
        key={paragraphKey}
        className={cn('text-[15px] leading-7 whitespace-pre-wrap break-words text-pretty', textColor)}
      >
        {parseInlineMarkdown(trimmed, `${paragraphKey}-content`)}
      </p>,
    );
  }

  flushBlockquote();
  flushList();

  return elements;
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
  onCopyMessage: (content: string) => void;
  onRegenerateResponse: (messageId: string) => void;
  className?: string;
  pendingUserMessage?: Message;
  streamingAssistantMessage?: {
    id: string;
    segments: ContentSegment[];
    metadata?: MessageMetadata;
    isComplete?: boolean;
  } | null;
  isDarkMode?: boolean;
  streamingActivity?: string | null;
  bottomOffset?: number;
  voicePlaybackState: VoicePlaybackState;
  voicePlaybackController: VoicePlaybackController;
}

// Hook for managing message reactions
function useMessageReactions(messageId: string) {
  const queryClient = useQueryClient();

  // Get current user to find their reactions
  const { data: user } = useQuery<{ id: string; username: string }>({
    queryKey: ['/api/user'],
  });

  const { data: reactions = [] } = useQuery<Reaction[]>({
    queryKey: ['/api/messages', messageId, 'reactions'],
    enabled: !!messageId,
  });

  const userReaction = user ? reactions.find((r) => r.userId === user.id) : undefined;

  const reactionMutation = useMutation({
    mutationFn: async (type: 'thumbs_up' | 'thumbs_down') => {
      const response = await apiRequest('POST', `/api/messages/${messageId}/reactions`, {
        type, // userId is now determined by backend auth
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/messages', messageId, 'reactions'] });
    },
  });

  const deleteReactionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', `/api/messages/${messageId}/reactions`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/messages', messageId, 'reactions'] });
    },
  });

  const handleReaction = (type: 'thumbs_up' | 'thumbs_down') => {
    if (userReaction) {
      if (userReaction.type === type) {
        // Same reaction - remove it
        deleteReactionMutation.mutate();
      } else {
        // Different reaction - update it
        reactionMutation.mutate(type);
      }
    } else {
      // No existing reaction - create it
      reactionMutation.mutate(type);
    }
  };

  return {
    userReaction,
    handleReaction,
    isUpdating: reactionMutation.isPending || deleteReactionMutation.isPending,
  };
}

// Component for message reaction buttons
function MessageReactionButtons({ messageId }: { messageId: string }) {
  const { userReaction, handleReaction, isUpdating } = useMessageReactions(messageId);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm',
          userReaction?.type === 'thumbs_up' && 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700'
        )}
        onClick={() => handleReaction('thumbs_up')}
        disabled={isUpdating}
        data-testid={`button-like-${messageId}`}
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm',
          userReaction?.type === 'thumbs_down' && 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700'
        )}
        onClick={() => handleReaction('thumbs_down')}
        disabled={isUpdating}
        data-testid={`button-dislike-${messageId}`}
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
    </>
  );
}

// Component to display AI thinking/reasoning process
function ThinkingSection({ thinkingContent, messageId }: { thinkingContent: string; messageId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleCopyThinking = () => {
    navigator.clipboard.writeText(thinkingContent);
  };

  return (
    <Collapsible 
      open={isOpen} 
      onOpenChange={setIsOpen}
      className="mb-3"
    >
      <CollapsibleTrigger 
        className="flex items-center gap-2 text-xs text-muted-foreground hover-elevate px-2 py-1 rounded-md w-full"
        data-testid={`button-thinking-toggle-${messageId}`}
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" />
        <span>Thinking Process</span>
      </CollapsibleTrigger>
      <CollapsibleContent 
        className="mt-2 pt-2 border-t"
        data-testid={`section-thinking-${messageId}`}
      >
        <div className="relative">
          <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed pr-8">
            {thinkingContent}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-0 right-0 h-6 w-6 p-0"
            onClick={handleCopyThinking}
            data-testid={`button-copy-thinking-${messageId}`}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StreamingStatusPill({ activity }: { activity?: string | null }) {
  if (!activity) {
    return null;
  }

  return (
    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{activity}</span>
    </div>
  );
}

function SourcesPopover({ sources, messageId }: { sources: ParsedSource[]; messageId: string }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-primary/40 bg-background/80 px-2 text-xs text-primary shadow-sm"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Sources
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-4" align="end">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</div>
        <ul className="space-y-2 text-sm">
          {sources.map((source, index) => (
            <li key={`${messageId}-source-${index}`} className="flex items-start gap-2">
              <span className="mt-0.5 text-xs font-semibold text-muted-foreground">{index + 1}.</span>
              {source.href ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-start gap-1 text-primary hover:underline"
                >
                  <span className="flex-1 break-words">{source.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                </a>
              ) : (
                <span className="flex-1 break-words text-muted-foreground">{source.label}</span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const ChatMessages = forwardRef<ChatMessagesHandle, ChatMessagesProps>(({ 
  messages,
  isLoading,
  onCopyMessage,
  onRegenerateResponse,
  className,
  pendingUserMessage,
  streamingAssistantMessage,
  isDarkMode = false,
  streamingActivity,
  bottomOffset = 0,
  voicePlaybackState,
  voicePlaybackController,
}, ref) => {
  const { agentName } = useBranding();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>({});
  const contentBottomPadding = Math.max(bottomOffset + 48, 160);

  // Fetch user preferences for profile picture
  const { data: userPreferences } = useQuery<{
    personalizationEnabled: boolean;
    customInstructions: string;
    name: string;
    occupation: string;
    bio: string;
    profileImageUrl?: string;
    memories: string[];
    chatHistoryEnabled: boolean;
  }>({
    queryKey: ['/api/user/preferences'],
  });
  const formatTime = (dateString: string | Date | null) => {
    if (!dateString) return '';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const registerMessageRef = (messageId: string) => (element: HTMLDivElement | null) => {
    if (element) {
      messageRefs.current.set(messageId, element);
    } else {
      messageRefs.current.delete(messageId);
    }
  };

  const getViewMode = (messageId: string): ViewMode => viewModes[messageId] ?? 'formatted';

  const toggleViewMode = (messageId: string) => {
    setViewModes(prev => {
      const current = prev[messageId] ?? 'formatted';
      const next: ViewMode = current === 'formatted' ? 'plain' : 'formatted';
      return { ...prev, [messageId]: next };
    });
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    onCopyMessage(content);
  };

  const getViewport = () => {
    if (!scrollAreaRef.current) {
      return null;
    }
    return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
  };

  const scrollToBottom = (options?: ScrollToOptions) => {
    const viewport = getViewport();
    if (!viewport) {
      return;
    }
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: options?.behavior ?? 'smooth',
    });
  };

  const scrollToTop = (options?: ScrollToOptions) => {
    const viewport = getViewport();
    if (!viewport) {
      return;
    }
    viewport.scrollTo({
      top: 0,
      behavior: options?.behavior ?? 'smooth',
    });
  };

  const scrollToMessage = (
    messageId: string,
    options?: { behavior?: ScrollBehavior; block?: ScrollBlockOption },
  ) => {
    const viewport = getViewport();
    if (!viewport) {
      return;
    }
    const target = messageRefs.current.get(messageId);
    if (!target) {
      return;
    }

    const behavior = options?.behavior ?? 'smooth';
    const block = options?.block ?? 'start';

    if (block === 'nearest') {
      target.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' });
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const elementTop = targetRect.top - viewportRect.top + viewport.scrollTop;
    const elementHeight = targetRect.height;

    let scrollTop = elementTop;
    if (block === 'center') {
      scrollTop = elementTop - viewport.clientHeight / 2 + elementHeight / 2;
    } else if (block === 'end') {
      scrollTop = elementTop - viewport.clientHeight + elementHeight;
    }

    viewport.scrollTo({
      top: Math.max(0, scrollTop),
      behavior,
    });
  };

  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToTop,
    scrollToMessage,
  }));

  // Track whether user has scrolled up from bottom — show scroll-to-bottom button
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const THRESHOLD = 200; // px from bottom before showing button

    const handleScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setShowScrollButton(distanceFromBottom > THRESHOLD);
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  const messageContainerBaseClasses =
    'relative flex-1 min-w-0 w-full max-w-[calc(100vw-2rem)] sm:max-w-[85vw] md:max-w-[760px] px-4 py-3 sm:px-5 sm:py-4 break-words overflow-hidden rounded-2xl';

  const mergeTranscriptTexts = (metadata?: MessageMetadata): string[] => {
    const metadataTexts = metadata?.audioClips
      ?.map(clip => clip.text)
      .filter((text): text is string => Boolean(text && text.trim())) ?? [];

    return Array.from(new Set(metadataTexts));
  };

  const noopAsync = async () => {};

  const renderAssistantBadges = (metadata: MessageMetadata | undefined, messageId: string) => {
    if (!metadata) {
      return null;
    }

    const executedTools = metadata.executedTools || [];
    const webSearchUsed = executedTools.some(tool => tool.toLowerCase().includes('search'));
    const codeUsed = executedTools.some(tool => tool.toLowerCase().includes('code') || tool === 'python_execute');
    const templateName = metadata.outputTemplateName;
    const templateValidation = metadata.outputTemplateValidation;
    const assistantType = metadata.assistantType;
    const webhookMetadata = metadata.webhook && typeof metadata.webhook === 'object'
      ? metadata.webhook as Record<string, unknown>
      : undefined;
    const webhookStatus = typeof webhookMetadata?.status === 'string' ? webhookMetadata.status : undefined;
    const webhookError = typeof webhookMetadata?.errorMessage === 'string' ? webhookMetadata.errorMessage : undefined;

    return (
      <>
        {webSearchUsed && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700"
            data-testid={`badge-web-search-${messageId}`}
          >
            <Globe className="h-2.5 w-2.5" />
            Web Search
          </Badge>
        )}
        {codeUsed && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700"
            data-testid={`badge-code-execution-${messageId}`}
          >
            <Code className="h-2.5 w-2.5" />
            Code Execution
          </Badge>
        )}
        {templateName && (
          <Badge
            variant={templateValidation?.status === 'fail' ? 'destructive' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-4 gap-0.5"
            data-testid={`badge-output-template-${messageId}`}
            title={templateValidation?.status === 'fail'
              ? templateValidation.missingSections.length > 0
                ? `Missing sections: ${templateValidation.missingSections.join(', ')}`
                : 'Template requirements not met'
              : 'Template requirements satisfied'}
          >
            {templateValidation?.status === 'fail' ? (
              <AlertCircle className="h-2.5 w-2.5" />
            ) : (
              <CheckCircle2 className="h-2.5 w-2.5" />
            )}
            Template: {templateName}
          </Badge>
        )}
        {assistantType === 'webhook' && (
          <Badge
            variant={webhookStatus === 'error' ? 'destructive' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-4 gap-0.5"
            data-testid={`badge-webhook-${messageId}`}
            title={webhookError || undefined}
          >
            <Workflow className="h-2.5 w-2.5" />
            {webhookStatus === 'timeout'
              ? 'Webhook Timeout'
              : webhookStatus === 'error'
                ? 'Webhook Error'
                : 'Webhook'}
          </Badge>
        )}
      </>
    );
  };

  const renderMessageSegments = (segments: ContentSegment[], keyPrefix: string, isUser: boolean) => (
    <div className="space-y-3 text-pretty sm:space-y-4">
      {segments.map((segment, index) => {
        const key = `${keyPrefix}-segment-${index}`;
        if (segment.type === 'code') {
          return (
            <CodeBlock
              key={key}
              code={segment.content}
              lang={segment.rawLang ?? segment.lang}
              isDarkMode={isDarkMode}
            />
          );
        }

        const blocks = renderMarkdownBlocks(segment.content, key, isUser);
        if (blocks.length === 0) {
          return (
            <p
              key={key}
              className={cn(
                'm-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[12px] leading-5 text-pretty sm:text-[15px] sm:leading-7',
                isUser ? 'text-foreground' : 'text-card-foreground'
              )}
            >
              {segment.content}
            </p>
          );
        }

        return (
          <div key={key} className="space-y-2">
            {blocks}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative flex-1 h-full min-h-0">
    <ScrollArea className={cn('flex-1 h-full min-h-0', className)} ref={scrollAreaRef}>
      <div
        className="px-4 pt-6 sm:px-6 lg:px-8 overflow-x-hidden"
        style={{ paddingBottom: contentBottomPadding }}
      >
        <div className="mx-auto w-full max-w-[800px] space-y-0">
          {messages.length === 0 && !isLoading && !pendingUserMessage && !streamingAssistantMessage && (
            <AtlasWelcomeState />
          )}

          {messages.map((message) => {
            const metadata = message.metadata as MessageMetadata | undefined;
            const templateValidation = metadata?.outputTemplateValidation;
            const rawContent = message.content;
            const safeContent = typeof rawContent === 'string'
              ? rawContent
              : typeof rawContent === 'object' && rawContent !== null
                ? (rawContent as any).message ?? JSON.stringify(rawContent)
                : String(rawContent ?? '');
            const { body, sources } = extractSources(safeContent);
            const segments = parseMessageContent(body);
            const messageCopy = safeContent;
            const isUser = message.role === 'user';
            const viewMode = getViewMode(message.id);
            const metadataVoiceClips = !isUser ? metadata?.audioClips ?? [] : undefined;
            const hasStoredVoiceClips = (metadataVoiceClips?.length ?? 0) > 0;
            const isVoiceMessage = !isUser && hasStoredVoiceClips;
            const historyTranscripts = isVoiceMessage ? mergeTranscriptTexts(metadata) : [];
            const historyVoicePanel = isVoiceMessage ? (
              <AssistantVoicePlaybackPanel clips={metadataVoiceClips} transcripts={historyTranscripts} />
            ) : null;

            const userInitials = userPreferences?.name
              ? userPreferences.name
                  .split(' ')
                  .map(part => part[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)
              : 'U';

            const assistantDisplayName = isUser
              ? 'You'
              : typeof metadata?.assistantName === 'string'
                ? metadata.assistantName
                : agentName;

            return (
              <div
                key={message.id}
                ref={registerMessageRef(message.id)}
                className={cn(
                  'group flex gap-2 px-2 py-2 sm:gap-4 sm:px-6 sm:py-3',
                  isUser
                    ? 'justify-end sm:ml-6 md:ml-12'
                    : 'justify-start sm:mr-6 md:mr-12'
                )}
                data-testid={`message-${message.id}`}
              >
                {!isUser ? (
                  <div className="hidden sm:flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="9" stroke="url(#msg-grad)" strokeWidth="1.5" />
                      <circle cx="12" cy="12" r="3" fill="url(#msg-grad)" />
                      <defs>
                        <linearGradient id="msg-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#60a5fa" /><stop offset="1" stopColor="#818cf8" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                ) : (
                  <Avatar className="hidden sm:flex h-8 w-8 flex-shrink-0 order-1">
                    {userPreferences?.profileImageUrl ? (
                      <AvatarImage src={userPreferences.profileImageUrl} alt="User profile" />
                    ) : null}
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                )}

                <div
                  className={cn(
                    messageContainerBaseClasses,
                    isUser ? 'os-message-user' : 'os-message-assistant'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {!isUser ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-foreground">{assistantDisplayName}</span>
                      </div>
                    ) : (
                      <span className="font-semibold text-xs text-primary/90">You</span>
                    )}
                    <span className="text-xs text-muted-foreground/60">
                      {formatTime(message.createdAt)}
                    </span>
                    {!isUser && renderAssistantBadges(metadata, message.id)}
                  </div>

                  {!isUser && metadata?.thinkingContent ? (
                    <ThinkingSection
                      thinkingContent={metadata.thinkingContent}
                      messageId={message.id}
                    />
                  ) : null}

                  {!isUser && (metadata as any)?.agentMode && Array.isArray((metadata as any)?.toolCalls) && (metadata as any).toolCalls.length > 0 ? (
                    <AgentActivityPanel
                      toolCalls={(metadata as any).toolCalls}
                      iteration={(metadata as any)?.agentIteration}
                      maxIterations={(metadata as any)?.agentMaxIterations}
                    />
                  ) : null}

                  {viewMode === 'formatted' ? (
                    <div className="formatted-response sm:text-base">
                      {historyVoicePanel}
                      {renderMessageSegments(segments, message.id, isUser)}

                      {!isUser && sources.length > 0 && (
                        <div className="pt-1">
                          <SourcesPopover sources={sources} messageId={message.id} />
                        </div>
                      )}
                      {!isUser && templateValidation?.status === 'fail' && (
                        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                          <p className="font-semibold">Template validation failed</p>
                          {templateValidation.missingSections.length > 0 && (
                            <p className="mt-1 text-destructive/80">
                              Missing sections: {templateValidation.missingSections.join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {historyVoicePanel}
                      <pre
                        className={cn(
                          'max-h-[60vh] overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/40 p-4 text-[13px] leading-6 text-pretty font-mono',
                          isUser ? 'text-foreground' : 'text-card-foreground'
                        )}
                      >
                        {messageCopy}
                      </pre>

                      {!isUser && sources.length > 0 && (
                        <div className="pt-1">
                          <SourcesPopover sources={sources} messageId={message.id} />
                        </div>
                      )}
                      {!isUser && templateValidation?.status === 'fail' && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                          <p className="font-semibold">Template validation failed</p>
                          {templateValidation.missingSections.length > 0 && (
                            <p className="mt-1 text-destructive/80">
                              Missing sections: {templateValidation.missingSections.join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm text-xs font-medium',
                        isUser && 'text-foreground'
                      )}
                      onClick={() => toggleViewMode(message.id)}
                      data-testid={`button-toggle-view-${message.id}`}
                    >
                      {viewMode === 'formatted' ? 'Plain Text' : 'Formatted'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm',
                        isUser && 'text-foreground'
                      )}
                      onClick={() => handleCopy(messageCopy)}
                      data-testid={`button-copy-${message.id}`}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>

                    {!isUser && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm"
                          onClick={() => onRegenerateResponse(message.id)}
                          data-testid={`button-regenerate-${message.id}`}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                        <MessageReactionButtons messageId={message.id} />
                      </>
                    )}
                  </div>
                </div>

              </div>
            );
          })}

          {pendingUserMessage && (
            <div
              key={pendingUserMessage.id}
              ref={registerMessageRef(pendingUserMessage.id)}
              className="group flex gap-2 px-2 py-2 sm:px-6 sm:gap-4 sm:py-3 justify-end"
              data-testid={`message-${pendingUserMessage.id}`}
            >
              <div className={cn(messageContainerBaseClasses, 'os-message-user opacity-90')}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-medium text-xs text-primary/90">You</span>
                  <span className="text-xs text-muted-foreground">{formatTime(new Date())}</span>
                </div>
                <div className="formatted-response sm:text-base">
                  {renderMessageSegments(parseMessageContent(pendingUserMessage.content || ''), pendingUserMessage.id, true)}
                </div>
              </div>
              <Avatar className="hidden sm:flex h-8 w-8 flex-shrink-0">
                <AvatarImage src="" alt="User" />
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
            </div>
          )}

          {streamingAssistantMessage && (
            <div
              key={streamingAssistantMessage.id}
              ref={registerMessageRef(streamingAssistantMessage.id)}
              className="group flex gap-2 px-2 py-2 sm:px-6 sm:gap-4 sm:py-3 justify-start"
              data-testid={`message-${streamingAssistantMessage.id}`}
            >
              <div className="hidden sm:flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="9" stroke="url(#stream-grad)" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="3" fill="url(#stream-grad)" />
                  <defs>
                    <linearGradient id="stream-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#60a5fa" /><stop offset="1" stopColor="#818cf8" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <div className={cn(messageContainerBaseClasses, 'os-message-assistant')}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" />
                    <span className="font-semibold text-xs text-foreground">
                      {typeof streamingAssistantMessage.metadata?.assistantName === 'string'
                        ? streamingAssistantMessage.metadata.assistantName
                        : agentName}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground/60">{formatTime(new Date())}</span>
                  {renderAssistantBadges(streamingAssistantMessage.metadata, streamingAssistantMessage.id)}
                </div>

                {(() => {
                  const streamingViewMode = getViewMode(streamingAssistantMessage.id);
                  const fallbackSegments: ContentSegment[] = [
                    { type: 'text', content: '...' },
                  ];
                  const segmentsToRender =
                    streamingAssistantMessage.segments.length > 0
                      ? streamingAssistantMessage.segments
                      : fallbackSegments;
                  const streamingTemplateValidation = streamingAssistantMessage.metadata?.outputTemplateValidation;
                  const streamingClips = voicePlaybackState.clips;
                  const hasStreamingAudio = voicePlaybackController.hasAudio || streamingClips.length > 0;
                  const streamingTranscripts = mergeTranscriptTexts(streamingAssistantMessage.metadata);
                  const showStreamingVoice = Boolean(
                    hasStreamingAudio &&
                      (streamingAssistantMessage.metadata?.voiceMode || voicePlaybackState.isVoiceActive),
                  );
                  const streamingVoicePanel = showStreamingVoice ? (
                    <div className="mb-3">
                      <VoicePlaybackControls
                        status={voicePlaybackController.status}
                        progressMs={voicePlaybackController.progressMs}
                        totalDurationMs={voicePlaybackController.totalDurationMs}
                        onPlay={voicePlaybackController.play}
                        onPause={voicePlaybackController.pause}
                        clips={streamingClips}
                        disabled={!voicePlaybackController.hasAudio}
                        transcripts={streamingTranscripts}
                        isStreaming={!streamingAssistantMessage.isComplete}
                      />
                    </div>
                  ) : null;

                  const streamingMeta = streamingAssistantMessage.metadata as any;
                  const streamingToolCalls = streamingMeta?.agentMode && Array.isArray(streamingMeta?.toolCalls)
                    ? streamingMeta.toolCalls
                    : [];

                  return (
                    <>
                      {streamingViewMode === 'formatted' ? (
                        <div className="formatted-response sm:text-base">
                          <StreamingStatusPill activity={streamingActivity} />
                          {streamingMeta?.agentIteration != null && streamingMeta?.agentMaxIterations != null && streamingToolCalls.length === 0 && (
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider my-1">
                              Agent Step {streamingMeta.agentIteration}/{streamingMeta.agentMaxIterations}
                            </p>
                          )}
                          {streamingToolCalls.length > 0 && (
                            <AgentActivityPanel
                              toolCalls={streamingToolCalls}
                              iteration={streamingMeta?.agentIteration}
                              maxIterations={streamingMeta?.agentMaxIterations}
                            />
                          )}
                          {streamingVoicePanel}
                          {renderMessageSegments(segmentsToRender, streamingAssistantMessage.id, false)}
                          {streamingTemplateValidation?.status === 'fail' && (
                            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                              <p className="font-semibold">Template validation failed</p>
                              {streamingTemplateValidation.missingSections.length > 0 && (
                                <p className="mt-1 text-destructive/80">
                                  Missing sections: {streamingTemplateValidation.missingSections.join(', ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <StreamingStatusPill activity={streamingActivity} />
                          {streamingVoicePanel}
                          <pre className="max-h-[60vh] overflow-x-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 p-4 text-[13px] leading-6 text-pretty font-mono">
                            {segmentsToString(segmentsToRender)}
                          </pre>
                          {streamingTemplateValidation?.status === 'fail' && (
                            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                              <p className="font-semibold">Template validation failed</p>
                              {streamingTemplateValidation.missingSections.length > 0 && (
                                <p className="mt-1 text-destructive/80">
                                  Missing sections: {streamingTemplateValidation.missingSections.join(', ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm text-xs font-medium"
                          onClick={() => toggleViewMode(streamingAssistantMessage.id)}
                          data-testid={`button-toggle-view-${streamingAssistantMessage.id}`}
                        >
                          {streamingViewMode === 'formatted' ? 'Plain Text' : 'Formatted'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 bg-background/80 backdrop-blur-sm border shadow-sm"
                          onClick={() => handleCopy(segmentsToString(streamingAssistantMessage.segments))}
                          data-testid={`button-copy-${streamingAssistantMessage.id}`}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingAssistantMessage && (
            <div className="group flex gap-2 px-2 py-2 sm:px-6 sm:gap-4 sm:py-3 justify-start">
              <div className="hidden sm:flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="9" stroke="url(#load-grad)" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="3" fill="url(#load-grad)" />
                  <defs>
                    <linearGradient id="load-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#60a5fa" /><stop offset="1" stopColor="#818cf8" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <div className={cn(messageContainerBaseClasses, 'os-message-assistant')}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" />
                    <span className="font-semibold text-xs text-foreground">{agentName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground/60">{streamingActivity ?? 'Thinking...'}</span>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  <div className="os-typing-dot" />
                  <div className="os-typing-dot" />
                  <div className="os-typing-dot" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>

    {/* Scroll-to-bottom floating button */}
    {showScrollButton && (
      <button
        onClick={() => scrollToBottom({ behavior: 'smooth' })}
        className="absolute left-1/2 -translate-x-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/90 shadow-lg backdrop-blur-sm transition-all hover:bg-accent hover:shadow-xl active:scale-95"
        style={{ bottom: `${bottomOffset + 16}px` }}
        aria-label="Scroll to bottom"
      >
        <ArrowDown className="h-4 w-4 text-muted-foreground" />
      </button>
    )}
    </div>
  );
});

ChatMessages.displayName = 'ChatMessages';

export { ChatMessages };