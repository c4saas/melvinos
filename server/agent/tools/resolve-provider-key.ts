/**
 * Shared utility — resolve an LLM provider API key from ToolContext.
 * Checks platform settings (apiProviders) first, then env var fallback.
 * Used by tools that need provider keys but only have ToolContext available.
 */
import type { ToolContext } from '../tool-registry';

const ENV_KEYS: Record<string, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  groq: process.env.GROQ_API_KEY,
  google: process.env.GOOGLE_API_KEY,
  perplexity: process.env.PERPLEXITY_API_KEY,
  ollama: process.env.OLLAMA_API_KEY,
};

export function resolveProviderKey(context: ToolContext, provider: string): string | undefined {
  const settings = context.platformSettings as any;
  const platformKey = settings?.apiProviders?.[provider]?.defaultApiKey;
  if (platformKey) return platformKey;
  return ENV_KEYS[provider];
}
