import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import { getEnv } from './voice-env.ts';

export interface ClauseInput {
  id?: string;
  text: string;
  voiceId?: string;
  format?: 'mp3' | 'wav';
}

export interface OpenAIVoiceOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  format?: 'mp3' | 'wav';
  organization?: string;
  baseUrl?: string;
  onChunk?: (chunk: Buffer) => void;
}

export interface OpenAIAudioClip {
  clipId: string;
  audio: Buffer;
  mimeType: string;
  durationMs?: number;
  sizeBytes: number;
  text: string;
}

interface OpenAIRealtimeEvent {
  type?: string;
  [key: string]: unknown;
}

interface AudioDeltaEvent extends OpenAIRealtimeEvent {
  type: 'response.output_audio.delta';
  delta?: {
    audio?: string;
    duration_ms?: number;
  };
}

interface AudioCompletedEvent extends OpenAIRealtimeEvent {
  type: 'response.completed' | 'response.output_audio.done';
}

interface ErrorEvent extends OpenAIRealtimeEvent {
  type: 'error' | 'response.error';
  error?: { message?: string };
}

const FALLBACK_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

function getRealtimeBaseUrl(): string {
  const env = getEnv();
  return env.OPENAI_VOICE_REALTIME_URL ?? FALLBACK_REALTIME_URL;
}

export function getVoiceRuntimeConfig(): {
  apiKey?: string;
  model: string;
  voice: string;
  format: 'mp3' | 'wav';
  realtime: { enabled: boolean; baseUrl: string };
} {
  const env = getEnv();
  return {
    apiKey: env.OPENAI_VOICE_API_KEY,
    model: env.OPENAI_VOICE_MODEL,
    voice: env.OPENAI_VOICE_NAME,
    format: env.OPENAI_VOICE_FORMAT,
    realtime: {
      enabled: env.OPENAI_VOICE_REALTIME_ENABLED,
      baseUrl: getRealtimeBaseUrl(),
    },
  };
}

function resolveMimeType(format: 'mp3' | 'wav'): string {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/mpeg';
  }
}

function buildRealtimeUrl(model: string, baseUrl?: string): string {
  const endpoint = (baseUrl ?? getRealtimeBaseUrl()).replace(/\/?$/, '');
  const encodedModel = encodeURIComponent(model);
  return `${endpoint}?model=${encodedModel}`;
}

// Known realtime-capable models (Realtime WebSocket API)
const REALTIME_MODELS = new Set([
  'gpt-4o-realtime-preview',
  'gpt-4o-realtime-preview-2024-12-17',
  'gpt-4o-mini-realtime-preview',
  'gpt-4o-mini-realtime-preview-2024-12-17',
]);

function isRealtimeModel(model: string): boolean {
  return REALTIME_MODELS.has(model) || model.includes('realtime');
}

async function streamTextToSpeechRest(
  clause: ClauseInput,
  options: Required<Pick<OpenAIVoiceOptions, 'apiKey'>> &
    Omit<OpenAIVoiceOptions, 'apiKey'>,
): Promise<OpenAIAudioClip> {
  const env = getEnv();
  const clipId = clause.id ?? randomUUID();
  const voice = clause.voiceId ?? options.voice ?? env.OPENAI_VOICE_NAME;
  const format = clause.format ?? options.format ?? env.OPENAI_VOICE_FORMAT;
  const model = options.model ?? env.OPENAI_VOICE_MODEL;
  const mimeType = resolveMimeType(format);

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      ...(options.organization ? { 'OpenAI-Organization': options.organization } : {}),
    },
    body: JSON.stringify({
      model,
      input: clause.text,
      voice,
      response_format: format,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS REST API error (${response.status}): ${errorBody}`);
  }

  const audioChunks: Buffer[] = [];
  let totalBytes = 0;

  if (response.body) {
    const reader = (response.body as any)[Symbol.asyncIterator]
      ? response.body
      : response.body;
    for await (const chunk of reader as AsyncIterable<Uint8Array>) {
      const buf = Buffer.from(chunk);
      audioChunks.push(buf);
      totalBytes += buf.length;
      if (typeof options.onChunk === 'function') {
        try { options.onChunk(buf); } catch { /* ignore */ }
      }
    }
  }

  return {
    clipId,
    audio: Buffer.concat(audioChunks),
    mimeType,
    durationMs: undefined,
    sizeBytes: totalBytes,
    text: clause.text,
  };
}

async function streamTextToSpeech(
  clause: ClauseInput,
  options: Required<Pick<OpenAIVoiceOptions, 'apiKey'>> &
    Omit<OpenAIVoiceOptions, 'apiKey'>,
): Promise<OpenAIAudioClip> {
  const env = getEnv();
  const clipId = clause.id ?? randomUUID();
  const voice = clause.voiceId ?? options.voice ?? env.OPENAI_VOICE_NAME;
  const format = clause.format ?? options.format ?? env.OPENAI_VOICE_FORMAT;
  const model = options.model ?? env.OPENAI_VOICE_MODEL;

  // Use REST API for non-realtime TTS models
  if (!isRealtimeModel(model)) {
    return streamTextToSpeechRest(clause, options);
  }

  const mimeType = resolveMimeType(format);
  const url = buildRealtimeUrl(model, options.baseUrl ?? env.OPENAI_VOICE_REALTIME_URL);

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
      ...(options.organization ? { 'OpenAI-Organization': options.organization } : {}),
    },
  });

  const audioChunks: Buffer[] = [];
  let totalBytes = 0;
  let durationMs: number | undefined;

  let closed = false;

  const closeSocket = () => {
    if (!closed) {
      closed = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  };

  const result = await new Promise<OpenAIAudioClip>((resolve, reject) => {
    const rejectWithCleanup = (error: unknown) => {
      closeSocket();
      reject(error);
    };

    ws.on('open', () => {
      try {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              voice,
              modalities: ['audio'],
              audio_format: format,
            },
          }),
        );
        ws.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio'],
              audio: {
                voice,
                format,
              },
              instructions: clause.text,
            },
          }),
        );
      } catch (error) {
        rejectWithCleanup(error);
      }
    });

    ws.on('message', data => {
      let event: OpenAIRealtimeEvent | null = null;
      try {
        event = JSON.parse(data.toString()) as OpenAIRealtimeEvent;
      } catch {
        return;
      }

      if (!event) {
        return;
      }

      if ((event as AudioDeltaEvent).type === 'response.output_audio.delta') {
        const delta = (event as AudioDeltaEvent).delta;
        if (delta?.audio) {
          const chunk = Buffer.from(delta.audio, 'base64');
          audioChunks.push(chunk);
          totalBytes += chunk.length;
          if (typeof options.onChunk === 'function') {
            try {
              options.onChunk(chunk);
            } catch (callbackError) {
              console.warn('OpenAI voice chunk callback failed', callbackError);
            }
          }
        }
        if (typeof delta?.duration_ms === 'number') {
          durationMs = delta.duration_ms;
        }
        return;
      }

      if ((event as AudioCompletedEvent).type === 'response.output_audio.done') {
        return;
      }

      if ((event as AudioCompletedEvent).type === 'response.completed') {
        closeSocket();
        resolve({
          clipId,
          audio: Buffer.concat(audioChunks),
          mimeType,
          durationMs,
          sizeBytes: totalBytes,
          text: clause.text,
        });
        return;
      }

      if ((event as ErrorEvent).type === 'error' || (event as ErrorEvent).type === 'response.error') {
        const message =
          (event as ErrorEvent).error?.message ||
          (typeof (event as any).message === 'string' ? (event as any).message : 'OpenAI realtime error');
        rejectWithCleanup(new Error(message));
      }
    });

    ws.on('error', error => {
      rejectWithCleanup(error);
    });

    ws.on('close', () => {
      if (!closed) {
        closed = true;
        if (audioChunks.length > 0) {
          resolve({
            clipId,
            audio: Buffer.concat(audioChunks),
            mimeType,
            durationMs,
            sizeBytes: totalBytes,
            text: clause.text,
          });
        } else {
          reject(new Error('OpenAI realtime connection closed before audio was received'));
        }
      }
    });
  });

  return result;
}

export class OpenAIVoiceClient {
  private readonly apiKey: string;
  private readonly defaultVoice: string;
  private readonly defaultFormat: 'mp3' | 'wav';
  private readonly defaultModel: string;
  private readonly organization?: string;
  private readonly baseUrl?: string;

  constructor(options: OpenAIVoiceOptions = {}) {
    const env = getEnv();
    const apiKey = options.apiKey ?? env.OPENAI_VOICE_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI voice API key is not configured');
    }

    this.apiKey = apiKey;
    this.defaultVoice = options.voice ?? env.OPENAI_VOICE_NAME;
    this.defaultFormat = options.format ?? env.OPENAI_VOICE_FORMAT;
    this.defaultModel = options.model ?? env.OPENAI_VOICE_MODEL;
    this.organization = options.organization ?? process.env.OPENAI_ORGANIZATION;
    this.baseUrl = options.baseUrl ?? env.OPENAI_VOICE_REALTIME_URL;
  }

  async synthesizeClauses(
    clauses: ClauseInput[],
    options: OpenAIVoiceOptions = {},
  ): Promise<OpenAIAudioClip[]> {
    if (clauses.length === 0) {
      return [];
    }

    const results: OpenAIAudioClip[] = [];
    for (const clause of clauses) {
      const clip = await streamTextToSpeech(
        clause,
        {
          apiKey: this.apiKey,
          model: options.model ?? this.defaultModel,
          voice: options.voice ?? this.defaultVoice,
          format: options.format ?? this.defaultFormat,
          organization: this.organization,
          baseUrl: this.baseUrl,
          onChunk: options.onChunk,
        },
      );
      results.push(clip);
    }
    return results;
  }

  async streamClause(
    clause: ClauseInput,
    options: OpenAIVoiceOptions = {},
  ): Promise<OpenAIAudioClip> {
    return streamTextToSpeech(clause, {
      apiKey: this.apiKey,
      model: options.model ?? this.defaultModel,
      voice: options.voice ?? this.defaultVoice,
      format: options.format ?? this.defaultFormat,
      organization: this.organization,
      baseUrl: this.baseUrl,
      onChunk: options.onChunk,
    });
  }
}

let sharedClient: OpenAIVoiceClient | null = null;
let sharedClientKey: string | undefined;

function getSharedClient(apiKeyOverride?: string): OpenAIVoiceClient {
  const effectiveKey = apiKeyOverride || undefined;
  if (!sharedClient || effectiveKey !== sharedClientKey) {
    sharedClient = new OpenAIVoiceClient(effectiveKey ? { apiKey: effectiveKey } : {});
    sharedClientKey = effectiveKey;
  }
  return sharedClient;
}

export async function synthesizeClauses(
  clauses: ClauseInput[],
  options?: OpenAIVoiceOptions,
): Promise<OpenAIAudioClip[]> {
  const client = getSharedClient(options?.apiKey);
  return client.synthesizeClauses(clauses, options);
}

export async function streamClause(
  clause: ClauseInput,
  options?: OpenAIVoiceOptions,
): Promise<OpenAIAudioClip> {
  const client = getSharedClient(options?.apiKey);
  return client.streamClause(clause, options);
}
