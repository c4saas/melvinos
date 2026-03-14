export interface ModelPricing {
  promptCostPer1k: number;
  completionCostPer1k?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-5.2': { promptCostPer1k: 0.01, completionCostPer1k: 0.03 },
  // Anthropic
  'claude-sonnet-4-6': { promptCostPer1k: 0.003, completionCostPer1k: 0.015 },
  'claude-opus-4-6': { promptCostPer1k: 0.015, completionCostPer1k: 0.075 },
  // Groq
  compound: { promptCostPer1k: 0.002, completionCostPer1k: 0.002 },
  'os-120b': { promptCostPer1k: 0.003, completionCostPer1k: 0.003 },
  'llama-3.1-8b-instant': { promptCostPer1k: 0.00005, completionCostPer1k: 0.00008 },
  // Google
  'gemini-3.1-pro': { promptCostPer1k: 0.00125, completionCostPer1k: 0.005 },
  'gemini-2.5-flash': { promptCostPer1k: 0.00015, completionCostPer1k: 0.0006 },
  // Perplexity
  'sonar-pro': { promptCostPer1k: 0.003, completionCostPer1k: 0.015 },
  'sonar-deep-research': { promptCostPer1k: 0.005, completionCostPer1k: 0.005 },
  // Ollama Cloud
  'qwen3.5-397b': { promptCostPer1k: 0, completionCostPer1k: 0 },
};

export const DEFAULT_PRICING: Required<ModelPricing> = {
  promptCostPer1k: 0.002,
  completionCostPer1k: 0.002,
};

export function estimateCostForModel(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const promptRate = pricing.promptCostPer1k ?? DEFAULT_PRICING.promptCostPer1k;
  const completionRate =
    pricing.completionCostPer1k ?? pricing.promptCostPer1k ?? DEFAULT_PRICING.completionCostPer1k;

  return (promptTokens / 1000) * promptRate + (completionTokens / 1000) * completionRate;
}

export interface UsageSummaryTotals {
  messages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerMessage: number;
  avgCostPerMessage: number;
}

export interface UsageSummaryModelBreakdown {
  model: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  avgTokensPerMessage: number;
  costPerMessage: number;
  tokenShare: number;
  costShare: number;
}

export interface UsageSummaryDailyUsage {
  date: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageSummary {
  totals: UsageSummaryTotals;
  models: UsageSummaryModelBreakdown[];
  daily: UsageSummaryDailyUsage[];
  dateRange: {
    from?: string;
    to?: string;
  };
}

export const EMPTY_USAGE_SUMMARY: UsageSummary = {
  totals: {
    messages: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    avgTokensPerMessage: 0,
    avgCostPerMessage: 0,
  },
  models: [],
  daily: [],
  dateRange: {},
};
