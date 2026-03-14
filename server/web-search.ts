// Web Search Service using Perplexity API
export interface WebSearchResult {
  query: string;
  answer: string;
  sources?: string[];
  usage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const PERPLEXITY_SEARCH_MODEL = 'sonar-pro';
const PERPLEXITY_DEEP_RESEARCH_MODEL = 'sonar-deep-research';

export async function performWebSearch(query: string, deepResearch?: boolean, externalApiKey?: string): Promise<WebSearchResult> {
  const apiKey = externalApiKey || process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('Perplexity API key is required for web search');
  }

  try {
    const response = await fetch(PERPLEXITY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: deepResearch ? PERPLEXITY_DEEP_RESEARCH_MODEL : PERPLEXITY_SEARCH_MODEL,
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: deepResearch ? 4000 : 500,
        temperature: deepResearch ? 0.1 : 0.2,
        ...(deepResearch ? { search_recency_filter: 'month' } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Web search error ${response.status}:`, errorText);
      throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const answer = data.choices[0]?.message?.content || '';
    const model = deepResearch ? PERPLEXITY_DEEP_RESEARCH_MODEL : PERPLEXITY_SEARCH_MODEL;

    return {
      query,
      answer,
      sources: data.citations || [],
      usage: data.usage ? {
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
      } : undefined,
    };
  } catch (error) {
    console.error('Web search error:', error);
    throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
