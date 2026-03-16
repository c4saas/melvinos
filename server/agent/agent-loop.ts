import type { AgentConfig, AgentEvent, ToolCallRecord } from './types';
import type { ToolContext } from './tool-registry';
import { toolRegistry } from './tool-registry';
import { modelSupportsFunctions } from '../ai-models';
import { storage } from '../storage/index';

const SENSITIVE_KEYS = new Set([
  'api_key', 'apiKey', 'token', 'secret', 'password', 'auth',
  'authorization', 'credential', 'credentials', 'key', 'private_key',
  'privateKey', 'access_token', 'accessToken', 'refresh_token', 'refreshToken',
]);

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object' && !Array.isArray(v))
      out[k] = sanitizeArgs(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface LLMCompletionResult {
  content: string;
  toolCalls?: LLMToolCall[];
  thinkingContent?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Provider-agnostic interface for making LLM calls with tools
export interface LLMProvider {
  complete(
    messages: LLMMessage[],
    tools: ReturnType<typeof toolRegistry.toOpenAITools>,
    config: AgentConfig,
  ): Promise<LLMCompletionResult>;

  stream(
    messages: LLMMessage[],
    config: AgentConfig,
  ): AsyncGenerator<{ text?: string; thinking?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
}

const WORKSPACE_PATH = process.env.AGENT_WORKSPACE_PATH || '/app/workspace';

export async function* runAgentLoop(
  config: AgentConfig,
  messages: LLMMessage[],
  provider: LLMProvider,
  enabledTools?: string[],
  extraContext?: Partial<ToolContext>,
  /** Optional callback to send sub-events (e.g. CC sub-tools) to the client in real time */
  onLiveEvent?: (event: AgentEvent) => void,
): AsyncGenerator<AgentEvent> {
  const toolCallHistory: ToolCallRecord[] = [];
  const conversationMessages = [...messages];
  let fullContent = '';
  const accumulatedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const toolUsageRecords: Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number }> = [];

  const rawToolDefs = toolRegistry.toOpenAITools(enabledTools);
  // Anthropic enforces a 128-tool limit; slice to stay within it
  const toolDefs = modelSupportsFunctions(config.model) ? rawToolDefs.slice(0, 128) : [];

  // Sub-events emitted by tools (e.g. Claude Code sub-tool calls).
  // When onLiveEvent is provided, events are sent immediately (real-time streaming).
  // Otherwise, they are queued and yielded after each tool batch completes.
  const pendingSubEvents: AgentEvent[] = [];

  const context: ToolContext = {
    userId: config.userId,
    conversationId: config.conversationId,
    workspacePath: WORKSPACE_PATH,
    model: config.model,
    thorMode: config.thorMode,
    ...extraContext,
    emitEvent: (event) => {
      const agentEvent = event as AgentEvent;
      if (onLiveEvent) {
        onLiveEvent(agentEvent);
      } else {
        pendingSubEvents.push(agentEvent);
      }
    },
  };

  // config.maxIterations is the safety circuit breaker — not a task limit.
  // The loop runs until the model naturally stops calling tools (returns a text response
  // with no tool calls). The circuit breaker only fires if something goes wrong (infinite
  // loop, model stuck in a cycle, etc.) and injects a message asking the model to summarize
  // what was completed and what still needs to be done.
  const circuitBreaker = config.maxIterations;

  for (let iteration = 1; ; iteration++) {
    yield {
      type: 'agent_status',
      iteration,
      maxIterations: circuitBreaker,
    };

    if (toolDefs.length > 0) {
      // Circuit breaker: inject a warning and force a final summary response
      if (iteration > circuitBreaker) {
        console.warn(`[agent-loop] Circuit breaker tripped at iteration ${iteration} — forcing final response`);
        conversationMessages.push({
          role: 'user',
          content: `[SYSTEM: Safety limit of ${circuitBreaker} steps reached. Do not call any more tools. Summarize exactly what you have completed so far and clearly state what still needs to be done so the user can continue.]`,
        });
        // Fall through to streaming final response below
      } else {
        let result: LLMCompletionResult;
        try {
          result = await provider.complete(conversationMessages, toolDefs, config);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          yield { type: 'error', message: `LLM call failed: ${message}` };
          return;
        }

        if (result.usage) {
          accumulatedUsage.promptTokens += result.usage.promptTokens;
          accumulatedUsage.completionTokens += result.usage.completionTokens;
          accumulatedUsage.totalTokens += result.usage.totalTokens;
        }

        if (result.thinkingContent) {
          yield { type: 'thinking', text: result.thinkingContent };
        }

        // No tool calls — natural completion
        if (!result.toolCalls || result.toolCalls.length === 0) {
          fullContent = result.content;
          if (result.content) {
            yield { type: 'text_delta', text: result.content };
          }
          break;
        }

        // Process tool calls
        const assistantMessage: LLMMessage = {
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls,
        };
        conversationMessages.push(assistantMessage);

        // Parse all tool calls upfront
        const parsedCalls = result.toolCalls.map((tc) => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { console.warn(`[agent-loop] Failed to parse tool args for ${tc.function.name}:`, tc.function.arguments); args = { _raw: tc.function.arguments }; }
          return { toolCall: tc, name: tc.function.name, args, id: tc.id };
        });

        // Emit all tool_call events immediately
        for (const pc of parsedCalls) {
          yield { type: 'tool_call', id: pc.id, tool: pc.name, args: pc.args };
        }

        // Execute tools in parallel (isolated — one failure won't kill others)
        const executionPromises = parsedCalls.map(async (pc) => {
          const startTime = Date.now();
          const toolResult = await toolRegistry.execute(pc.name, pc.args, context);
          const durationMs = Date.now() - startTime;
          // toolRegistry.execute never throws — errors are returned as toolResult.error
          if (toolResult.error) {
            void storage.logToolError({
              toolName: pc.name,
              error: toolResult.error,
              args: sanitizeArgs(pc.args),
              conversationId: context.conversationId ?? null,
            }).catch((e: unknown) => console.warn('[agent-loop] Failed to persist tool error:', e));
          }
          return { pc, toolResult, durationMs };
        });

        const results = await Promise.all(executionPromises);

        // Yield any sub-events emitted by tools during execution (e.g. Claude Code sub-tools)
        // (Only populated when onLiveEvent is NOT provided — live events are sent directly)
        for (const subEvent of pendingSubEvents) {
          yield subEvent;
        }
        pendingSubEvents.length = 0;

        // Emit results and build conversation messages in order
        for (const { pc, toolResult, durationMs } of results) {
          const record: ToolCallRecord = {
            id: pc.id,
            tool: pc.name,
            args: pc.args,
            output: toolResult.output,
            error: toolResult.error,
            durationMs,
          };
          toolCallHistory.push(record);

          if (toolResult.usage) {
            toolUsageRecords.push(toolResult.usage);
          }

          yield {
            type: 'tool_result',
            id: pc.id,
            tool: pc.name,
            output: toolResult.output,
            error: toolResult.error,
            artifacts: toolResult.artifacts,
            usage: toolResult.usage,
          };

          const toolOutput = toolResult.error
            ? `Error: ${toolResult.error}\n${toolResult.output}`.trim()
            : toolResult.output;

          conversationMessages.push({
            role: 'tool',
            content: toolOutput,
            tool_call_id: pc.id,
          });
        }

        // Continue loop — LLM will see tool results and decide next action
        continue;
      }
    }

    // No tools, or circuit breaker tripped: stream the final response
    try {
      for await (const delta of provider.stream(conversationMessages, config)) {
        if (delta.thinking) {
          yield { type: 'thinking', text: delta.thinking };
        }
        if (delta.text) {
          fullContent += delta.text;
          yield { type: 'text_delta', text: delta.text };
        }
        if (delta.usage) {
          accumulatedUsage.promptTokens += delta.usage.promptTokens;
          accumulatedUsage.completionTokens += delta.usage.completionTokens;
          accumulatedUsage.totalTokens += delta.usage.totalTokens;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: `Streaming failed: ${message}` };
      return;
    }
    break;
  }

  yield {
    type: 'done',
    content: fullContent,
    iterations: toolCallHistory.length > 0 ? toolCallHistory.length + 1 : 1,
    toolCalls: toolCallHistory,
    usage: accumulatedUsage.totalTokens > 0 ? accumulatedUsage : undefined,
    toolUsage: toolUsageRecords.length > 0 ? toolUsageRecords : undefined,
  };
}
