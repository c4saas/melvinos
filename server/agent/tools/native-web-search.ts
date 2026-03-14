// Native web search implementations for providers that support built-in search
// Falls back to Perplexity sonar-pro for providers without native search

import { getModelConfig } from '../../ai-models';
import type { ToolContext } from '../tool-registry';

// Anthropic web search tool version — update when Anthropic releases a new version
// Latest: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
const ANTHROPIC_WEB_SEARCH_TOOL = 'web_search_20250305';

export interface NativeSearchResult {
  answer: string;
  sources?: string[];
  usage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Human-readable label for streaming activity, e.g. "Searching with GPT-5.2" */
  searchLabel: string;
}

/** Models that support native web search through their provider API */
const NATIVE_SEARCH_MODELS: Record<string, string> = {
  'gpt-5.2': 'openai',
  'claude-sonnet-4-6': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'gemini-3.1-pro': 'google',
  'gemini-2.5-flash': 'google',
  'compound': 'groq',
};

export function hasNativeSearch(model: string): boolean {
  return model in NATIVE_SEARCH_MODELS;
}

function resolveApiKey(context: ToolContext, provider: string): string | undefined {
  const settings = context.platformSettings as any;
  const providerKey = settings?.apiProviders?.[provider]?.defaultApiKey;
  if (providerKey) return providerKey;

  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  return envKeys[provider];
}

// ─── OpenAI Native Search (GPT-5.2) ────────────────────────────────────────

async function searchWithOpenAI(query: string, apiKey: string): Promise<NativeSearchResult> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5.2',
      tools: [{ type: 'web_search_preview' }],
      input: query,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Extract text output from response items
  let answer = '';
  const sources: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text') {
          answer += content.text;
          // Extract inline annotations as sources
          for (const annotation of content.annotations ?? []) {
            if (annotation.type === 'url_citation' && annotation.url) {
              sources.push(annotation.url);
            }
          }
        }
      }
    }
  }

  return {
    answer,
    sources: [...new Set(sources)], // deduplicate
    usage: data.usage ? {
      model: 'gpt-5.2',
      promptTokens: data.usage.input_tokens ?? 0,
      completionTokens: data.usage.output_tokens ?? 0,
      totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
    } : undefined,
    searchLabel: 'Searching with GPT-5.2',
  };
}

// ─── Anthropic Native Search (Claude) ───────────────────────────────────────

async function searchWithAnthropic(query: string, model: string, apiKey: string): Promise<NativeSearchResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      tools: [{
        type: ANTHROPIC_WEB_SEARCH_TOOL,
        name: 'web_search',
        max_uses: 5,
      }],
      messages: [{ role: 'user', content: query }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  let answer = '';
  const sources: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === 'text') {
      answer += block.text;
    } else if (block.type === 'web_search_tool_result') {
      for (const result of block.content ?? []) {
        if (result.type === 'web_search_result' && result.url) {
          sources.push(result.url);
        }
      }
    }
  }

  const displayName = model === 'claude-opus-4-6' ? 'Claude Opus' : 'Claude Sonnet';
  return {
    answer,
    sources: [...new Set(sources)],
    usage: data.usage ? {
      model,
      promptTokens: data.usage.input_tokens ?? 0,
      completionTokens: data.usage.output_tokens ?? 0,
      totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
    } : undefined,
    searchLabel: `Searching with ${displayName}`,
  };
}

// ─── Google Native Search (Gemini + Grounding) ─────────────────────────────

async function searchWithGoogle(query: string, model: string, apiKey: string): Promise<NativeSearchResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  let answer = '';
  const sources: string[] = [];

  // Extract text from content parts
  for (const part of candidate?.content?.parts ?? []) {
    if (part.text) answer += part.text;
  }

  // Extract grounding sources
  const grounding = candidate?.groundingMetadata;
  if (grounding?.groundingChunks) {
    for (const chunk of grounding.groundingChunks) {
      if (chunk.web?.uri) sources.push(chunk.web.uri);
    }
  }

  const usage = data.usageMetadata;
  const displayName = model === 'gemini-3.1-pro' ? 'Gemini Pro' : 'Gemini Flash';
  return {
    answer,
    sources: [...new Set(sources)],
    usage: usage ? {
      model,
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
    } : undefined,
    searchLabel: `Searching with ${displayName}`,
  };
}

// ─── Groq Compound Search ──────────────────────────────────────────────────

async function searchWithGroqCompound(query: string, apiKey: string): Promise<NativeSearchResult> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'groq/compound',
      messages: [{ role: 'user', content: query }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq Compound search failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content ?? '';

  // Compound includes executed tool results in the response but doesn't expose sources separately
  return {
    answer,
    sources: [],
    usage: data.usage ? {
      model: 'compound',
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      totalTokens: data.usage.total_tokens ?? (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
    } : undefined,
    searchLabel: 'Searching with Groq Compound',
  };
}

// ─── Main Router ────────────────────────────────────────────────────────────

export async function performNativeSearch(
  query: string,
  model: string,
  context: ToolContext,
): Promise<NativeSearchResult> {
  const provider = NATIVE_SEARCH_MODELS[model];
  if (!provider) {
    throw new Error(`No native search available for model: ${model}`);
  }

  const apiKey = resolveApiKey(context, provider);
  if (!apiKey) {
    throw new Error(`No API key available for ${provider} native search`);
  }

  switch (provider) {
    case 'openai':
      return searchWithOpenAI(query, apiKey);
    case 'anthropic':
      return searchWithAnthropic(query, model, apiKey);
    case 'google':
      return searchWithGoogle(query, model, apiKey);
    case 'groq':
      return searchWithGroqCompound(query, apiKey);
    default:
      throw new Error(`Unsupported native search provider: ${provider}`);
  }
}
