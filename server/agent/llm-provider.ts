import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig, getModelTemperature, modelSupportsFunctions, type ModelConfig } from '../ai-models';
import type { IStorage } from '../storage';
import type { LLMProvider } from './agent-loop';
import type { AgentConfig } from './types';
import type { OpenAITool } from './tool-registry';

// SDK client caches — reuse connections across calls within same process
const openaiClientCache = new Map<string, OpenAI>();
const anthropicClientCache = new Map<string, Anthropic>();

function getCachedOpenAI(apiKey: string, baseURL?: string): OpenAI {
  const cacheKey = `${apiKey}::${baseURL || ''}`;
  let client = openaiClientCache.get(cacheKey);
  if (!client) {
    const opts: Record<string, any> = { apiKey };
    if (baseURL) opts.baseURL = baseURL;
    client = new OpenAI(opts);
    openaiClientCache.set(cacheKey, client);
  }
  return client;
}

function getCachedAnthropic(apiKey: string): Anthropic {
  let client = anthropicClientCache.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    anthropicClientCache.set(apiKey, client);
  }
  return client;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface LLMCompletionResult {
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  thinkingContent?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

async function resolveApiKey(
  storage: IStorage,
  userId: string,
  provider: ModelConfig['provider'],
  modelId: string,
): Promise<string> {
  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    ollama: process.env.OLLAMA_API_KEY,
  };

  // Try platform settings
  const settingsRecord = await storage.getPlatformSettings();
  const providerSettings = settingsRecord.data.apiProviders[provider];
  if (providerSettings?.defaultApiKey) return providerSettings.defaultApiKey;

  // Fall back to env
  const envKey = envKeys[provider];
  if (envKey) return envKey;

  throw new Error(`No API key available for ${provider} (model: ${modelId})`);
}

function applyOpenAIModelParams(
  params: Record<string, any>,
  config: ModelConfig,
  agentConfig: AgentConfig,
): void {
  const isGpt5 = config.apiModel.startsWith('gpt-5');
  const tokenLimit = agentConfig.maxTokens ?? 4000;

  if (isGpt5) {
    delete params.max_tokens;
    params.max_completion_tokens = tokenLimit;

    // Map thinking config to OpenAI reasoning effort
    if (config.supportsThinking && agentConfig.thinkingEnabled === true) {
      const budget = agentConfig.thinkingBudget ?? 4000;
      if (budget >= 10000) params.reasoning_effort = 'high';
      else if (budget >= 4000) params.reasoning_effort = 'medium';
      else params.reasoning_effort = 'low';
    }
  } else {
    params.max_tokens = tokenLimit;
  }
}

// OpenAI-compatible provider (works for OpenAI and Groq)
function createOpenAIProvider(storage: IStorage): LLMProvider {
  return {
    async complete(
      messages: LLMMessage[],
      tools: OpenAITool[],
      config: AgentConfig,
    ): Promise<LLMCompletionResult> {
      const modelConfig = getModelConfig(config.model);
      if (!modelConfig) throw new Error(`Unknown model: ${config.model}`);

      const apiKey = await resolveApiKey(storage, config.userId, modelConfig.provider, config.model);

      let baseURL: string | undefined;
      if (modelConfig.provider === 'groq') {
        baseURL = 'https://api.groq.com/openai/v1';
      } else if (modelConfig.provider === 'google') {
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      } else if (modelConfig.provider === 'ollama') {
        baseURL = modelConfig.endpoint || 'https://ollama.com/v1';
      }
      const client = getCachedOpenAI(apiKey, baseURL);

      const temperature = config.temperature ?? getModelTemperature(config.model);
      const isOllama = modelConfig.provider === 'ollama';
      const params: any = {
        model: modelConfig.apiModel,
        messages: messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
          }
          if (m.tool_calls) {
            return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls };
          }
          return { role: m.role, content: m.content };
        }),
        temperature,
        tools: modelSupportsFunctions(config.model) && tools.length > 0 ? tools : undefined,
        stream: false,
        ...(isOllama && modelConfig.contextLength ? { options: { num_ctx: modelConfig.contextLength } } : {}),
      };
      if (!isOllama) applyOpenAIModelParams(params, modelConfig, config);

      const completion = await client.chat.completions.create(params);
      const choice = completion.choices[0];

      // Extract reasoning/thinking from Ollama's Qwen-style responses
      const reasoning = isOllama ? (choice.message as any).reasoning as string | undefined : undefined;

      return {
        content: choice.message.content ?? '',
        toolCalls: choice.message.tool_calls?.map((tc) => {
          const fn = (tc as any).function as { name: string; arguments: string };
          return { id: tc.id, type: 'function' as const, function: { name: fn.name, arguments: fn.arguments } };
        }),
        thinkingContent: reasoning || undefined,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        } : undefined,
      };
    },

    async *stream(
      messages: LLMMessage[],
      config: AgentConfig,
    ): AsyncGenerator<{ text?: string; thinking?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
      const modelConfig = getModelConfig(config.model);
      if (!modelConfig) throw new Error(`Unknown model: ${config.model}`);

      const apiKey = await resolveApiKey(storage, config.userId, modelConfig.provider, config.model);

      let baseURL: string | undefined;
      if (modelConfig.provider === 'groq') {
        baseURL = 'https://api.groq.com/openai/v1';
      } else if (modelConfig.provider === 'google') {
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      } else if (modelConfig.provider === 'ollama') {
        baseURL = modelConfig.endpoint || 'https://ollama.com/v1';
      }
      const client = getCachedOpenAI(apiKey, baseURL);

      const temperature = config.temperature ?? getModelTemperature(config.model);
      const isOllama = modelConfig.provider === 'ollama';
      const params: any = {
        model: modelConfig.apiModel,
        messages: messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
          }
          return { role: m.role, content: m.content };
        }),
        temperature,
        stream: true,
        ...(isOllama ? {} : { stream_options: { include_usage: true } }),
        ...(isOllama && modelConfig.contextLength ? { options: { num_ctx: modelConfig.contextLength } } : {}),
      };
      if (!isOllama) applyOpenAIModelParams(params, modelConfig, config);

      const stream = client.chat.completions.create(params) as unknown as AsyncIterable<import('openai/resources/chat/completions').ChatCompletionChunk>;
      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield { text: content };
          }
          // Final chunk contains usage when stream_options.include_usage is true
          if (chunk.usage) {
            yield {
              usage: {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              },
            };
          }
        }
      } catch (err) {
        throw new Error(`OpenAI streaming failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

// Anthropic provider
function createAnthropicProvider(storage: IStorage): LLMProvider {
  return {
    async complete(
      messages: LLMMessage[],
      tools: OpenAITool[],
      config: AgentConfig,
    ): Promise<LLMCompletionResult> {
      const modelConfig = getModelConfig(config.model);
      if (!modelConfig) throw new Error(`Unknown model: ${config.model}`);

      const apiKey = await resolveApiKey(storage, config.userId, 'anthropic', config.model);
      const client = getCachedAnthropic(apiKey);

      const systemMessage = messages.find((m) => m.role === 'system')?.content || '';

      // Convert messages to Anthropic format
      const anthropicMessages = convertToAnthropicMessages(messages);

      // Convert tools to Anthropic format
      const anthropicTools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
      }));

      const temperature = config.temperature ?? getModelTemperature(config.model);
      // Only enable thinking when explicitly requested (true), not when undefined
      const useThinking = modelConfig.supportsThinking && config.thinkingEnabled === true;
      const thinkingBudget = config.thinkingBudget ?? Math.min(config.maxTokens ?? 4000, 10000);

      const requestParams: Record<string, any> = {
        model: modelConfig.apiModel,
        ...(systemMessage ? { system: systemMessage } : {}),
        messages: anthropicMessages,
        max_tokens: config.maxTokens ?? 4000,
        tools: modelSupportsFunctions(config.model) && anthropicTools.length > 0 ? anthropicTools : undefined,
      };

      if (useThinking) {
        // Anthropic requires max_tokens > budget_tokens
        const minMaxTokens = thinkingBudget + 4096;
        requestParams.max_tokens = Math.max(requestParams.max_tokens, minMaxTokens);
        requestParams.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        // Anthropic requires temperature=1 when thinking is enabled
        requestParams.temperature = 1;
      } else {
        requestParams.temperature = temperature;
      }

      const response = await client.messages.create(requestParams as any);

      // Extract text and tool use from response
      let content = '';
      let thinkingContent = '';
      const toolCalls: LLMCompletionResult['toolCalls'] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'thinking') {
          thinkingContent += (block as any).thinking;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        thinkingContent: thinkingContent || undefined,
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        } : undefined,
      };
    },

    async *stream(
      messages: LLMMessage[],
      config: AgentConfig,
    ): AsyncGenerator<{ text?: string; thinking?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
      const modelConfig = getModelConfig(config.model);
      if (!modelConfig) throw new Error(`Unknown model: ${config.model}`);

      const apiKey = await resolveApiKey(storage, config.userId, 'anthropic', config.model);
      const client = getCachedAnthropic(apiKey);

      const systemMessage = messages.find((m) => m.role === 'system')?.content || '';
      const anthropicMessages = convertToAnthropicMessages(messages);

      const temperature = config.temperature ?? getModelTemperature(config.model);
      // Only enable thinking when explicitly requested (true), not when undefined
      const useThinking = modelConfig.supportsThinking && config.thinkingEnabled === true;
      const thinkingBudget = config.thinkingBudget ?? Math.min(config.maxTokens ?? 4000, 10000);

      const streamParams: Record<string, any> = {
        model: modelConfig.apiModel,
        ...(systemMessage ? { system: systemMessage } : {}),
        messages: anthropicMessages,
        max_tokens: config.maxTokens ?? 4000,
        stream: true,
      };

      if (useThinking) {
        // Anthropic requires max_tokens > budget_tokens
        const minMaxTokens = thinkingBudget + 4096;
        streamParams.max_tokens = Math.max(streamParams.max_tokens, minMaxTokens);
        streamParams.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        streamParams.temperature = 1;
      } else {
        streamParams.temperature = temperature;
      }

      const stream = await client.messages.create(streamParams as any);

      let inputTokens = 0;
      let outputTokens = 0;

      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta') {
            if (chunk.delta.type === 'text_delta') {
              yield { text: chunk.delta.text };
            } else if ((chunk.delta as any).type === 'thinking_delta') {
              yield { thinking: (chunk.delta as any).thinking };
            }
          } else if (chunk.type === 'message_start' && (chunk as any).message?.usage) {
            inputTokens = (chunk as any).message.usage.input_tokens ?? 0;
          } else if (chunk.type === 'message_delta' && (chunk as any).usage) {
            outputTokens = (chunk as any).usage.output_tokens ?? 0;
          }
        }
        // Yield accumulated usage at the end
        if (inputTokens > 0 || outputTokens > 0) {
          yield {
            usage: {
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
          };
        }
      } catch (err) {
        throw new Error(`Anthropic streaming failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function convertToAnthropicMessages(
  messages: LLMMessage[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content || ' ' });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant message with tool use
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* empty */ }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        result.push({ role: 'assistant', content });
      } else {
        // Anthropic rejects null/undefined content — fall back to empty string
        result.push({ role: 'assistant', content: msg.content || '' });
      }
    } else if (msg.role === 'tool') {
      // Anthropic expects tool results as user messages with tool_result content blocks
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id!,
            content: msg.content || '',
          },
        ],
      });
    }
  }

  return result;
}

export function createLLMProvider(
  storage: IStorage,
  model: string,
): LLMProvider {
  const modelConfig = getModelConfig(model);
  if (!modelConfig) throw new Error(`Unknown model: ${model}`);

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropicProvider(storage);
    case 'openai':
    case 'groq':
    case 'google':
    case 'ollama':
      return createOpenAIProvider(storage);
    default:
      // Fallback to OpenAI-compatible
      return createOpenAIProvider(storage);
  }
}

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('402') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('overloaded') ||
    msg.includes('capacity');
}

export function createFallbackAwareProvider(
  storage: IStorage,
  primaryModel: string,
  fallbackModel: string | null,
): LLMProvider {
  const primaryProvider = createLLMProvider(storage, primaryModel);

  if (!fallbackModel || fallbackModel === primaryModel) {
    return primaryProvider;
  }

  const fallbackProvider = createLLMProvider(storage, fallbackModel);

  return {
    async complete(messages, tools, config) {
      try {
        return await primaryProvider.complete(messages, tools, config);
      } catch (err) {
        if (isRetriableError(err)) {
          console.warn(`[llm-fallback] Primary model "${primaryModel}" failed, trying fallback "${fallbackModel}"`);
          const fallbackConfig = { ...config, model: fallbackModel };
          return await fallbackProvider.complete(messages, tools, fallbackConfig);
        }
        throw err;
      }
    },

    async *stream(messages, config) {
      try {
        yield* primaryProvider.stream(messages, config);
      } catch (err) {
        if (isRetriableError(err)) {
          console.warn(`[llm-fallback] Primary stream "${primaryModel}" failed, trying fallback "${fallbackModel}"`);
          const fallbackConfig = { ...config, model: fallbackModel };
          yield* fallbackProvider.stream(messages, fallbackConfig);
        } else {
          throw err;
        }
      }
    },
  };
}
