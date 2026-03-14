import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { saveToWorkspace, timestampedName } from './workspace-save';

// ── Provider endpoints ──────────────────────────────────────────────
const SORA_VIDEOS_ENDPOINT = 'https://api.openai.com/v1/videos';
const VEO_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning';

// ── Polling constants ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 8_000;
const MAX_POLL_ATTEMPTS = 60; // ~8 minutes max wait

// ── Concurrency lock — one video at a time ──────────────────────────
let videoGenerationLocked = false;

// ── Types ───────────────────────────────────────────────────────────
interface VideoProviderConfig {
  apiKey: string;
  provider: 'sora' | 'veo';
}

// ── API key resolution (mirrors image-generate pattern) ─────────────
function resolveProvider(
  context?: ToolContext,
  preferredProvider?: string,
): VideoProviderConfig | null {
  const settings = context?.platformSettings;
  const routing = settings?.mediaRouting?.video;
  const providers = (settings?.videoProviders ?? {}) as Record<
    string,
    { enabled?: boolean; defaultApiKey?: string | null }
  >;

  const tryProvider = (
    id: string | null | undefined,
  ): VideoProviderConfig | null => {
    if (!id) return null;
    const p = providers[id];
    if (p?.enabled && p?.defaultApiKey) {
      return { apiKey: p.defaultApiKey, provider: id as 'sora' | 'veo' };
    }
    return null;
  };

  // If the user explicitly asked for a provider, try that first
  if (preferredProvider) {
    const explicit = tryProvider(preferredProvider);
    if (explicit) return explicit;
  }

  // Routing order: default → fallback → any enabled → env var fallback
  return (
    tryProvider(routing?.defaultProvider) ??
    tryProvider(routing?.fallbackProvider) ??
    (() => {
      for (const [id, p] of Object.entries(providers)) {
        if (p?.enabled && p?.defaultApiKey) {
          return { apiKey: p.defaultApiKey, provider: id as 'sora' | 'veo' };
        }
      }
      return null;
    })() ??
    // Env var fallbacks
    (process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY, provider: 'sora' as const }
      : null) ??
    (process.env.GEMINI_API_KEY
      ? { apiKey: process.env.GEMINI_API_KEY, provider: 'veo' as const }
      : null) ??
    null
  );
}

// ── Sora implementation ─────────────────────────────────────────────
async function generateWithSora(
  apiKey: string,
  prompt: string,
  duration: string,
  aspectRatio: string,
  context: ToolContext,
): Promise<ToolResult> {
  // Map aspect ratio to Sora size format
  const sizeMap: Record<string, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '1024x1024',
  };
  const size = sizeMap[aspectRatio] || '1280x720';

  // Sora uses multipart/form-data
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model', 'sora-2');
  formData.append('size', size);
  formData.append('seconds', duration);

  const createRes = await fetch(SORA_VIDEOS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    console.error(`[video_generate] Sora create error ${createRes.status}:`, errText);
    return {
      output: '',
      error: `Sora video creation failed (${createRes.status}): ${errText.slice(0, 300)}`,
    };
  }

  const job = (await createRes.json()) as {
    id: string;
    status: string;
    [k: string]: unknown;
  };

  // Poll until complete
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${SORA_VIDEOS_ENDPOINT}/${job.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => '');
      return {
        output: '',
        error: `Sora polling failed (${pollRes.status}): ${errText.slice(0, 300)}`,
      };
    }

    const status = (await pollRes.json()) as {
      id: string;
      status: string;
      url?: string;
      expires_at?: string;
      [k: string]: unknown;
    };

    if (status.status === 'completed' || status.status === 'succeeded') {
      // Try to get video URL from status response or content endpoint
      let videoUrl = status.url;

      if (!videoUrl) {
        // Fetch from content endpoint
        const contentRes = await fetch(
          `${SORA_VIDEOS_ENDPOINT}/${job.id}/content`,
          { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'follow' },
        );
        if (contentRes.ok && contentRes.headers.get('content-type')?.includes('json')) {
          const contentData = (await contentRes.json()) as { url?: string };
          videoUrl = contentData.url;
        } else if (contentRes.ok) {
          // Direct binary — use the content endpoint URL itself as the video URL
          videoUrl = `${SORA_VIDEOS_ENDPOINT}/${job.id}/content`;
        }
      }

      if (!videoUrl) {
        return { output: '', error: 'Sora completed but no video URL was returned.' };
      }

      // Download and cache locally so URL never expires
      let servedUrl = videoUrl;
      const videoFileName = timestampedName('sora-video', 'mp4');
      let videoBuf: Buffer | null = null;

      try {
        const dlRes = await fetch(videoUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (dlRes.ok) {
          videoBuf = Buffer.from(await dlRes.arrayBuffer());
          if (context.saveFile) {
            servedUrl = await context.saveFile(videoBuf, videoFileName, 'video/mp4');
          }
        }
      } catch (cacheErr) {
        console.warn('[video_generate] Failed to cache Sora video locally:', cacheErr);
      }

      // Save to workspace for browsing
      if (videoBuf) {
        await saveToWorkspace(context.workspacePath, 'media/videos', videoFileName, videoBuf);
      }

      const output = `<video controls src="${servedUrl}" style="max-width:100%;border-radius:8px"></video>\n\n[Download Video](${servedUrl})`;
      return {
        output,
        artifacts: [
          { type: 'video' as const, name: videoFileName, content: servedUrl, mimeType: 'video/mp4' },
        ],
      };
    }

    if (status.status === 'failed') {
      return { output: '', error: 'Sora video generation failed.' };
    }

    // Still in progress — continue polling
  }

  return { output: '', error: 'Sora video generation timed out after polling.' };
}

// ── Veo 3.1 implementation (Gemini API) ─────────────────────────────
async function generateWithVeo(
  apiKey: string,
  prompt: string,
  duration: string,
  aspectRatio: string,
  context: ToolContext,
): Promise<ToolResult> {
  const createRes = await fetch(VEO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio,
        durationSeconds: parseInt(duration, 10) || 8,
        sampleCount: 1,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    console.error(`[video_generate] Veo create error ${createRes.status}:`, errText);
    return {
      output: '',
      error: `Veo video creation failed (${createRes.status}): ${errText.slice(0, 300)}`,
    };
  }

  const operation = (await createRes.json()) as { name?: string; done?: boolean; response?: any };

  if (!operation.name) {
    // Possibly synchronous completion
    if (operation.done && operation.response) {
      return extractVeoResult(operation.response, apiKey, context);
    }
    return { output: '', error: 'Veo returned no operation name.' };
  }

  // Poll the long-running operation
  const pollBase = 'https://generativelanguage.googleapis.com/v1beta';

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${pollBase}/${operation.name}`, {
      headers: { 'x-goog-api-key': apiKey },
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => '');
      return {
        output: '',
        error: `Veo polling failed (${pollRes.status}): ${errText.slice(0, 300)}`,
      };
    }

    const status = (await pollRes.json()) as {
      name: string;
      done?: boolean;
      response?: any;
      error?: { message?: string };
    };

    if (status.done) {
      if (status.error) {
        return { output: '', error: `Veo error: ${status.error.message || 'Unknown error'}` };
      }
      return extractVeoResult(status.response, apiKey, context);
    }

    // Still running — continue polling
  }

  return { output: '', error: 'Veo video generation timed out after polling.' };
}

async function extractVeoResult(response: any, apiKey: string, context: ToolContext): Promise<ToolResult> {
  const samples =
    response?.generateVideoResponse?.generatedSamples ??
    response?.generatedSamples ??
    [];

  const videoUri = samples?.[0]?.video?.uri;

  if (!videoUri) {
    return { output: '', error: 'Veo completed but no video URI was returned.' };
  }

  // Append API key for authenticated download
  const separator = videoUri.includes('?') ? '&' : '?';
  const externalUrl = `${videoUri}${separator}key=${apiKey}`;

  // Download and cache locally so URL never expires
  let servedUrl = externalUrl;
  const videoFileName = timestampedName('veo-video', 'mp4');
  let videoBuf: Buffer | null = null;

  try {
    const dlRes = await fetch(externalUrl);
    if (dlRes.ok) {
      videoBuf = Buffer.from(await dlRes.arrayBuffer());
      if (context.saveFile) {
        servedUrl = await context.saveFile(videoBuf, videoFileName, 'video/mp4');
      }
    }
  } catch (cacheErr) {
    console.warn('[video_generate] Failed to cache Veo video locally:', cacheErr);
  }

  // Save to workspace for browsing
  if (videoBuf) {
    await saveToWorkspace(context.workspacePath, 'media/videos', videoFileName, videoBuf);
  }

  const output = `<video controls src="${servedUrl}" style="max-width:100%;border-radius:8px"></video>\n\n[Download Video](${servedUrl})`;
  return {
    output,
    artifacts: [
      { type: 'video' as const, name: videoFileName, content: servedUrl, mimeType: 'video/mp4' },
    ],
  };
}

// ── Utility ─────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Tool definition ─────────────────────────────────────────────────
export const videoGenerateTool: ToolDefinition = {
  name: 'video_generate',
  description:
    'Generate a video from a text description using AI video models (OpenAI Sora or Google Veo). ' +
    'Use this when the user asks you to create, generate, or make a video, clip, or animation.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'A detailed description of the video to generate. Be specific about scene, motion, camera angle, lighting, and style.',
      },
      provider: {
        type: 'string',
        description: 'Which provider to use. Defaults to the configured routing preference.',
        enum: ['sora', 'veo'],
      },
      duration: {
        type: 'string',
        description: 'Video duration in seconds. Sora supports 4/8/12; Veo supports 4-8.',
        enum: ['4', '8', '12'],
      },
      aspect_ratio: {
        type: 'string',
        description: 'Aspect ratio of the video (default: 16:9).',
        enum: ['16:9', '9:16', '1:1'],
      },
    },
    required: ['prompt'],
  },

  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const prompt = String(args.prompt ?? '').trim();
    const preferredProvider = args.provider ? String(args.provider) : undefined;
    const duration = String(args.duration ?? '8');
    const aspectRatio = String(args.aspect_ratio ?? '16:9');

    if (!prompt) {
      return { output: '', error: 'Video prompt cannot be empty.' };
    }

    const resolved = resolveProvider(context, preferredProvider);
    if (!resolved) {
      return {
        output: '',
        error:
          'Video generation is not configured. Enable Sora or Veo in Settings → AI Providers and add an API key.',
      };
    }

    if (videoGenerationLocked) {
      return {
        output: '',
        error: 'A video is already being generated. Please wait for it to finish before starting another.',
      };
    }

    videoGenerationLocked = true;
    console.log(
      `[video_generate] Using provider=${resolved.provider}, duration=${duration}s, aspect=${aspectRatio}`,
    );

    try {
      if (resolved.provider === 'sora') {
        return await generateWithSora(resolved.apiKey, prompt, duration, aspectRatio, context);
      }
      return await generateWithVeo(resolved.apiKey, prompt, duration, aspectRatio, context);
    } catch (err: any) {
      console.error(`[video_generate] ${resolved.provider} error:`, err);
      return { output: '', error: `Video generation failed: ${err.message}` };
    } finally {
      videoGenerationLocked = false;
    }
  },
};
