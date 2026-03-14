import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { saveToWorkspace, timestampedName } from './workspace-save';

const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations';

function resolveApiKey(context?: ToolContext): string | null {
  const settings = context?.platformSettings;
  const routing = settings?.mediaRouting?.image;
  const providers = settings?.imageProviders ?? {};

  const tryProvider = (id: string | null | undefined) => {
    if (!id) return null;
    const p = (providers as Record<string, any>)[id];
    return (p?.enabled && p?.defaultApiKey) ? p.defaultApiKey : null;
  };

  // Routing: default → fallback → any enabled → env var
  return tryProvider(routing?.defaultProvider)
    ?? tryProvider(routing?.fallbackProvider)
    ?? Object.values(providers).find((p: any) => p?.enabled && p?.defaultApiKey)?.defaultApiKey
    ?? process.env.OPENAI_API_KEY
    ?? null;
}

export const imageGenerateTool: ToolDefinition = {
  name: 'image_generate',
  description:
    'Generate an image from a text description using DALL-E. Returns the image URL. Use this when the user asks you to create, generate, draw, or make an image or picture.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'A detailed description of the image to generate',
      },
      size: {
        type: 'string',
        description: 'Image dimensions (default: 1024x1024)',
        enum: ['1024x1024', '1024x1792', '1792x1024'],
      },
    },
    required: ['prompt'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const prompt = String(args.prompt ?? '');
    const size = String(args.size ?? '1024x1024');

    if (!prompt.trim()) {
      return { output: '', error: 'Image prompt cannot be empty' };
    }

    const apiKey = resolveApiKey(context);
    if (!apiKey) {
      return {
        output: '',
        error: 'Image generation is not configured. Set OPENAI_API_KEY or enable DALL-E in AI Providers settings.',
      };
    }

    try {
      const response = await fetch(OPENAI_IMAGES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size,
          response_format: 'url',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[image_generate] DALL-E error ${response.status}:`, errorText);
        return {
          output: '',
          error: `Image generation failed: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const externalUrl = data.data?.[0]?.url;
      const revisedPrompt = data.data?.[0]?.revised_prompt;

      if (!externalUrl) {
        return { output: '', error: 'No image was returned from DALL-E' };
      }

      // Download and cache locally so the URL never expires
      let imageUrl = externalUrl;
      const imgFileName = timestampedName('image', 'png');
      let imageBuf: Buffer | null = null;

      try {
        const imgRes = await fetch(externalUrl);
        if (imgRes.ok) {
          imageBuf = Buffer.from(await imgRes.arrayBuffer());
          if (context.saveFile) {
            imageUrl = await context.saveFile(imageBuf, imgFileName, 'image/png');
          }
        }
      } catch (cacheErr) {
        console.warn('[image_generate] Failed to cache image locally, using external URL:', cacheErr);
      }

      // Save to workspace for browsing
      if (imageBuf) {
        await saveToWorkspace(context.workspacePath, 'media/images', imgFileName, imageBuf);
      }

      let output = `![Generated Image](${imageUrl})`;
      if (revisedPrompt) {
        output += `\n\nRevised prompt: ${revisedPrompt}`;
      }

      return {
        output,
        artifacts: [
          { type: 'image', name: imgFileName, content: imageUrl, mimeType: 'image/png' },
        ],
      };
    } catch (err: any) {
      return { output: '', error: `Image generation failed: ${err.message}` };
    }
  },
};
