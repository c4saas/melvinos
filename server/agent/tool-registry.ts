import type { JSONSchema7 } from './types';

export interface ToolResult {
  output: string;
  error?: string;
  artifacts?: ToolArtifact[];
  /** Optional token usage from external API calls (e.g. Perplexity search) */
  usage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolArtifact {
  type: 'file' | 'image' | 'video' | 'code';
  name: string;
  path?: string;
  content?: string;
  mimeType?: string;
}

export interface GoogleAccount {
  label: string;
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  update: (accessToken: string, refreshToken?: string | null, expiryDate?: number | null) => Promise<void>;
}

export interface ToolContext {
  userId: string;
  conversationId?: string;
  workspacePath: string;
  model?: string;
  thorMode?: boolean;
  /** All connected Google accounts — use for fan-out reads */
  googleAccounts?: GoogleAccount[];
  /** Primary/default Google account tokens (backwards compat) */
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  recallApiKey?: string;
  recallRegion?: string;
  platformSettings?: Record<string, any>;
  /** Save a buffer to permanent file storage, returns a stable `/api/files/:id` URL. */
  saveFile?: (buffer: Buffer, name: string, mimeType: string) => Promise<string>;
  /** Persist refreshed Google OAuth tokens back to storage so they survive across sessions. */
  updateGoogleTokens?: (accessToken: string, refreshToken?: string | null, expiryDate?: number | null) => Promise<void>;
  /** Emit a streaming sub-event (e.g. Claude Code sub-tool calls) to the active SSE stream. */
  emitEvent?: (event: { type: string; [key: string]: unknown }) => void;
  /** Session-level Claude Code model override (e.g. 'claude-opus-4-6'). */
  ccModel?: string;
  /** Session-level Claude Code effort level: 'low' | 'medium' | 'high'. */
  ccEffort?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema7;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
  requiresApproval?: boolean;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema7;
  };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JSONSchema7;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { output: '', error: `Unknown tool: ${toolName}` };
    }
    // Long-running tools get extended timeouts; everything else gets 60s
    const LONG_TOOLS = new Set(['deep_research', 'claude_code', 'gamma_create', 'video_generate']);
    const timeoutMs = LONG_TOOLS.has(toolName) ? 180_000 : 60_000;
    try {
      return await Promise.race([
        tool.execute(args, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: '', error: `Tool "${toolName}" failed: ${message}` };
    }
  }

  toOpenAITools(filter?: string[]): OpenAITool[] {
    const tools = filter
      ? filter.map((n) => this.tools.get(n)).filter(Boolean) as ToolDefinition[]
      : this.list();

    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  toAnthropicTools(filter?: string[]): AnthropicTool[] {
    const tools = filter
      ? filter.map((n) => this.tools.get(n)).filter(Boolean) as ToolDefinition[]
      : this.list();

    return tools.map((t) => {
      // Ensure input_schema is always a valid object schema — Anthropic rejects missing/empty schemas
      const schema = t.parameters && typeof t.parameters === 'object' && t.parameters.type
        ? t.parameters
        : { type: 'object' as const, properties: {}, ...t.parameters };
      return {
        name: t.name,
        description: t.description,
        input_schema: schema,
      };
    });
  }
}

// Singleton registry
export const toolRegistry = new ToolRegistry();
