import test from 'node:test';
import assert from 'node:assert/strict';

import { AIService } from '../server/ai-service.ts';

const voiceSentences = ['Hello world.', 'Next sentence?'];

const groqChunks = ['Hello', ' world.', ' Next', ' sentence?'];

await test('streamGroqCompletion yields text and voice deltas per sentence', async () => {
  const requestedClauses: string[] = [];
  const storedClips: Array<{ ownerId: string; name: string; mimeType: string }> = [];

  const storageStub: any = {
    saveFile: async (
      ownerId: string,
      buffer: Buffer,
      name: string,
      mimeType: string,
    ) => {
      storedClips.push({ ownerId, name, mimeType });
      return {
        id: 'file-' + name,
        name,
        mimeType,
        size: buffer.byteLength,
        url: `/files/${name}`,
      };
    },
  };

  const service: any = new AIService(storageStub, {
    createGroqClient: () => ({
      chat: {
        completions: {
          create: async () =>
            (async function* () {
              for (const content of groqChunks) {
                yield { choices: [{ delta: { content } }] };
              }
            })(),
        },
      },
    }),
    synthesizeClauses: async (clauses: Array<{ text: string; id?: string }>) => {
      clauses.forEach(clause => requestedClauses.push(clause.text));
      return clauses.map((clause, index) => {
        const audio = Buffer.from(`audio-${index + 1}`);
        return {
          clipId: clause.id ?? `clip-${index + 1}`,
          audio,
          mimeType: 'audio/mpeg',
          durationMs: 500,
          sizeBytes: audio.byteLength,
          text: clause.text,
        };
      });
    },
  });

  const stream = (service as any).streamGroqCompletion(
    [{ role: 'user', content: 'Hello world' }],
    {
      id: 'test-model',
      apiModel: 'test-model',
      provider: 'groq',
      apiKeyEnvVar: 'GROQ_API_KEY',
      supportsStreaming: true,
      supportsWebSearch: false,
      supportsThinking: false,
      supportsCodeInterpreter: false,
    },
    {
      messages: [],
      model: 'test-model',
      userId: 'user-1',
      metadata: { voiceMode: true },
    },
    'fake-key',
    new Map(),
  );

  const deltas: Array<{ text?: string; audioChunk?: { text: string }; audioError?: string }> = [];

  for await (const delta of stream) {
    deltas.push(delta);
  }

  const textParts = deltas.filter(delta => delta.text).map(delta => delta.text);
  assert.deepEqual(textParts, groqChunks, 'text deltas should mirror Groq chunks');

  assert.deepEqual(requestedClauses, voiceSentences, 'OpenAI voice service should receive complete sentences');

  const audioTexts = deltas
    .filter(delta => delta.audioChunk)
    .map(delta => delta.audioChunk?.text);
  assert.deepEqual(audioTexts, voiceSentences, 'audio chunks should align with sentences');

  assert.equal(storedClips.length, 2, 'voice clips should be stored for each clause');
  const audioUrls = deltas
    .filter(delta => delta.audioChunk)
    .map(delta => delta.audioChunk?.audioUrl);
  assert.deepEqual(
    audioUrls,
    ['/files/groq-clause-1.mp3', '/files/groq-clause-2.mp3'],
    'audio chunks should include persisted URLs',
  );
});

await test('streamGroqCompletion yields audio error delta when synthesis fails', async () => {
  const storageStub: any = {
    saveFile: async () => {
      throw new Error('should not persist audio when synthesis fails');
    },
  };

  let synthesisAttempts = 0;

  const service: any = new AIService(storageStub, {
    createGroqClient: () => ({
      chat: {
        completions: {
          create: async () =>
            (async function* () {
              yield { choices: [{ delta: { content: 'Voice failure test.' } }] };
            })(),
        },
      },
    }),
    synthesizeClauses: async () => {
      synthesisAttempts += 1;
      throw new Error('OpenAI voice outage');
    },
  });

  const stream = (service as any).streamGroqCompletion(
    [{ role: 'user', content: 'Trigger voice failure' }],
    {
      id: 'test-model',
      apiModel: 'test-model',
      provider: 'groq',
      apiKeyEnvVar: 'GROQ_API_KEY',
      supportsStreaming: true,
      supportsWebSearch: false,
      supportsThinking: false,
      supportsCodeInterpreter: false,
    },
    {
      messages: [],
      model: 'test-model',
      userId: 'user-1',
      metadata: { voiceMode: true },
    },
    'fake-key',
    new Map(),
  );

  const deltas: Array<{ text?: string; audioChunk?: { text: string }; audioError?: string }> = [];
  for await (const delta of stream) {
    deltas.push(delta);
  }

  const audioErrorMessages = deltas.filter(delta => delta.audioError).map(delta => delta.audioError);
  assert.deepEqual(audioErrorMessages, ['OpenAI voice outage'], 'audio error delta should include failure message');
  assert.equal(
    deltas.some(delta => delta.audioChunk),
    false,
    'no audio chunks should be emitted after a synthesis failure',
  );
  assert.equal(synthesisAttempts, 1, 'synthesis should stop after the first failure');
});
