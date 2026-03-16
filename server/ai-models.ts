// AI Model Configuration and Mapping
// Maps UI model IDs to actual API model names

export interface ModelConfig {
  id: string;
  apiModel: string; // Actual model name for API calls
  provider: 'openai' | 'anthropic' | 'groq' | 'perplexity' | 'google' | 'ollama';
  apiKeyEnvVar: string;
  endpoint?: string; // Optional custom endpoint
  maxTokens?: number;
  contextLength?: number; // Ollama: passed as num_ctx to override 4096 default
  supportsFunctions?: boolean;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
  supportsWebSearch?: boolean;
  supportsThinking?: boolean;
  supportsCodeInterpreter?: boolean;
}

export const STANDARD_TEMPERATURE = 0.7;

export function getModelTemperature(modelId: string): number {
  const config = getModelConfig(modelId);

  if (!config) {
    return STANDARD_TEMPERATURE;
  }

  if (modelId === 'gpt-5.4') {
    return 1.0;
  }

  if (modelId === 'compound') {
    return 0.6;
  }

  if (config.provider === 'perplexity') {
    return 0.2;
  }

  return STANDARD_TEMPERATURE;
}

export const MODEL_CONFIG: Record<string, ModelConfig> = {
  // OpenAI Models
  'gpt-5.4': {
    id: 'gpt-5.4',
    apiModel: 'gpt-5.4',
    provider: 'openai',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxTokens: 200000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: true,
  },

  // Anthropic / Claude Models
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    apiModel: 'claude-sonnet-4-6',
    provider: 'anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxTokens: 200000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: true,
  },
  'claude-opus-4-6': {
    id: 'claude-opus-4-6',
    apiModel: 'claude-opus-4-6',
    provider: 'anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxTokens: 200000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: true,
  },

  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    apiModel: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxTokens: 200000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: false,
    supportsThinking: false,
    supportsCodeInterpreter: false,
  },

  // Groq Models
  'compound': {
    id: 'compound',
    apiModel: 'compound-beta',
    provider: 'groq',
    apiKeyEnvVar: 'GROQ_API_KEY',
    maxTokens: 32768,
    supportsFunctions: true,
    supportsVision: false,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: false,
    supportsCodeInterpreter: true,
  },
  'os-120b': {
    id: 'os-120b',
    apiModel: 'openai/gpt-oss-120b',
    provider: 'groq',
    apiKeyEnvVar: 'GROQ_API_KEY',
    maxTokens: 65536,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: false,
    supportsCodeInterpreter: true,
  },
  'llama-3.1-8b-instant': {
    id: 'llama-3.1-8b-instant',
    apiModel: 'llama-3.1-8b-instant',
    provider: 'groq',
    apiKeyEnvVar: 'GROQ_API_KEY',
    maxTokens: 32768,
    supportsFunctions: true,
    supportsVision: false,
    supportsStreaming: true,
    supportsWebSearch: false,
    supportsThinking: false,
    supportsCodeInterpreter: false,
  },

  // Google Models
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    apiModel: 'gemini-3.1-pro',
    provider: 'google',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    maxTokens: 1000000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: true,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    apiModel: 'gemini-2.5-flash',
    provider: 'google',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    maxTokens: 1000000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: false,
    supportsCodeInterpreter: true,
  },

  // Perplexity Models
  'sonar-deep-research': {
    id: 'sonar-deep-research',
    apiModel: 'sonar-deep-research',
    provider: 'perplexity',
    apiKeyEnvVar: 'PERPLEXITY_API_KEY',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    maxTokens: 4096,
    supportsFunctions: false,
    supportsVision: false,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: false,
  },
  'sonar-pro': {
    id: 'sonar-pro',
    apiModel: 'sonar-pro',
    provider: 'perplexity',
    apiKeyEnvVar: 'PERPLEXITY_API_KEY',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    maxTokens: 8000,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: false,
    supportsCodeInterpreter: false,
  },

  // Ollama Cloud Models
  'qwen3.5-397b': {
    id: 'qwen3.5-397b',
    apiModel: 'qwen3.5:397b',
    provider: 'ollama',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    endpoint: 'https://ollama.com/v1',
    maxTokens: 32768,
    contextLength: 65536,
    supportsFunctions: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsWebSearch: true,
    supportsThinking: true,
    supportsCodeInterpreter: true,
  },
};

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_CONFIG[modelId];
}

export function modelSupportsFunctions(modelId: string): boolean {
  return getModelConfig(modelId)?.supportsFunctions === true;
}

export function isModelAvailable(modelId: string): boolean {
  const config = MODEL_CONFIG[modelId];
  if (!config) return false;

  const apiKey = process.env[config.apiKeyEnvVar];
  return !!apiKey;
}

export function getAvailableModels(): string[] {
  return Object.keys(MODEL_CONFIG).filter(modelId => isModelAvailable(modelId));
}

export function getDefaultModel(): string {
  if (isModelAvailable('gpt-5.4')) return 'gpt-5.4';
  if (isModelAvailable('compound')) return 'compound';

  const available = getAvailableModels();
  return available[0] || 'compound';
}
