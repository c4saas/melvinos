import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const GAMMA_API_BASE = 'https://public-api.gamma.app/v1.0';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes

function resolveApiKey(context?: ToolContext): string | null {
  const gamma = (context?.platformSettings?.integrations as Record<string, any>)?.gamma;
  return (gamma?.enabled && gamma?.apiKey) ? gamma.apiKey : null;
}

async function pollGeneration(
  generationId: string,
  apiKey: string,
): Promise<{ gammaUrl: string; creditsDeducted: number; creditsRemaining: number }> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${GAMMA_API_BASE}/generations/${generationId}`, {
      headers: { 'X-API-KEY': apiKey },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gamma poll failed (${res.status}): ${text}`);
    }

    const data = await res.json();

    if (data.status === 'completed' && data.gammaUrl) {
      return {
        gammaUrl: data.gammaUrl,
        creditsDeducted: data.credits?.deducted ?? 0,
        creditsRemaining: data.credits?.remaining ?? 0,
      };
    }

    if (data.status === 'failed') {
      throw new Error(`Gamma generation failed: ${data.message ?? 'Unknown error'}`);
    }
    // status === 'pending' — keep polling
  }

  throw new Error('Gamma generation timed out after 2 minutes.');
}

export const gammaCreateTool: ToolDefinition = {
  name: 'gamma_create',
  description:
    'Create a presentation, document, or webpage using Gamma. Provide a topic or detailed content and Gamma will generate a polished deck. Returns a shareable Gamma URL. Use this when the user asks to make a presentation, deck, slideshow, or Gamma doc.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The topic, outline, or full content to generate the presentation from. Can be a short topic ("Best practices for remote teams") or detailed bullet points/text.',
      },
      format: {
        type: 'string',
        enum: ['presentation', 'document', 'webpage'],
        description: 'Output format (default: "presentation")',
      },
      numCards: {
        type: 'number',
        description: 'Number of slides/cards to generate (default: 10, max: 60)',
      },
      textMode: {
        type: 'string',
        enum: ['generate', 'condense', 'preserve'],
        description:
          '"generate" = AI writes the content (default), "condense" = shorten provided text, "preserve" = keep text as-is',
      },
      tone: {
        type: 'string',
        description: 'Tone of writing, e.g. "professional", "casual", "inspirational", "educational"',
      },
      audience: {
        type: 'string',
        description: 'Target audience, e.g. "executives", "developers", "general public"',
      },
      additionalInstructions: {
        type: 'string',
        description: 'Extra design or content instructions (max 2000 chars)',
      },
    },
    required: ['content'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const content = String(args.content ?? '').trim();
    if (!content) return { output: '', error: 'content is required' };

    const apiKey = resolveApiKey(context);
    if (!apiKey) {
      return {
        output: '',
        error:
          'Gamma is not configured. Enable it and add your API key in Settings → Integrations.',
      };
    }

    const format = String(args.format ?? 'presentation');
    const textMode = String(args.textMode ?? 'generate');
    const numCards = typeof args.numCards === 'number' ? Math.min(Math.max(1, Math.floor(args.numCards)), 60) : 10;

    const body: Record<string, unknown> = {
      inputText: content,
      textMode,
      format,
      numCards,
    };

    const textOptions: Record<string, string> = {};
    if (args.tone) textOptions.tone = String(args.tone);
    if (args.audience) textOptions.audience = String(args.audience);
    if (Object.keys(textOptions).length > 0) body.textOptions = textOptions;

    if (args.additionalInstructions) {
      body.additionalInstructions = String(args.additionalInstructions).slice(0, 2000);
    }

    // Step 1: Kick off generation
    const initRes = await fetch(`${GAMMA_API_BASE}/generations`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error(`[gamma_create] init error ${initRes.status}:`, errText);
      return {
        output: '',
        error: `Gamma creation failed (${initRes.status}): ${errText}`,
      };
    }

    const { generationId } = await initRes.json();
    if (!generationId) {
      return { output: '', error: 'Gamma did not return a generationId.' };
    }

    // Step 2: Poll until complete
    try {
      const { gammaUrl, creditsDeducted, creditsRemaining } = await pollGeneration(generationId, apiKey);

      const output = [
        `**Gamma ${format} created!**`,
        ``,
        `**Link:** ${gammaUrl}`,
        ``,
        `_Credits used: ${creditsDeducted} | Remaining: ${creditsRemaining}_`,
      ].join('\n');

      return { output };
    } catch (err: any) {
      return { output: '', error: err.message };
    }
  },
};
