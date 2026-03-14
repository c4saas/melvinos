export type VoiceStreamTarget = 'assistant' | 'preview' | 'phone';

export interface VoiceStreamRequest {
  text: string;
  voice?: string;
  model?: string;
  format?: 'mp3' | 'wav';
  target?: VoiceStreamTarget;
  signal?: AbortSignal;
}

export interface VoiceStreamResponse {
  clipId: string;
  mimeType: string;
  buffer: ArrayBuffer;
  text: string;
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

const decodeBase64 = (value: string): string => {
  if (typeof atob === 'function') {
    return atob(value);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf-8');
  }

  return value;
};

export async function requestVoiceStream({
  text,
  voice,
  model,
  format,
  target = 'assistant',
  signal,
}: VoiceStreamRequest): Promise<VoiceStreamResponse> {
  const response = await fetch('/api/voice/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice, model, format, target }),
    signal,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const payload = await response.json();
        detail = payload.error || detail;
      } catch {
        // ignore parse failure
      }
    }
    throw new Error(`Voice stream request failed: ${detail}`);
  }

  const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';
  const clipId = response.headers.get('x-voice-clip-id') ?? `clip-${Date.now()}`;
  const textHeader = response.headers.get('x-voice-text');
  const resolvedText = textHeader ? decodeBase64(textHeader) : text;

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return { clipId, mimeType, buffer, text: resolvedText };
  }

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const merged = concatChunks(chunks, totalLength);
  return { clipId, mimeType, buffer: merged.buffer, text: resolvedText };
}
