import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeWebhookAssistant, type WebhookInvocationPayload } from '../server/webhook-assistant.ts';

const basePayload: WebhookInvocationPayload = {
  assistant: {
    id: 'assistant-1',
    type: 'webhook',
    name: 'Webhook Agent',
    metadata: { timeoutMs: 5000 },
  },
  message: {
    text: 'Hello from tests',
    metadata: { foo: 'bar' },
  },
  chat: {
    id: 'chat-1',
    projectId: null,
  },
  user: {
    id: 'user-1',
  },
  context: {
    model: 'gpt-test',
    hasAttachments: false,
    hasContent: true,
    timestamp: new Date().toISOString(),
  },
};

test('invokeWebhookAssistant handles successful JSON responses', async () => {
  let receivedBody: any = null;
  const result = await invokeWebhookAssistant({
    url: 'https://example.com/webhook',
    payload: basePayload,
    fetchImpl: async (_input, init) => {
      receivedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response(JSON.stringify({ text: 'Webhook OK', metadata: { ack: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    validateUrl: async () => undefined,
  });

  assert.equal(receivedBody.message.text, basePayload.message.text);
  assert.equal(result.status, 'success');
  assert.equal(result.content, 'Webhook OK');
  assert.deepEqual(result.responseMetadata, { ack: true });
});

test('invokeWebhookAssistant captures error status codes', async () => {
  const result = await invokeWebhookAssistant({
    url: 'https://example.com/webhook',
    payload: basePayload,
    fetchImpl: async () =>
      new Response('failure', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    validateUrl: async () => undefined,
  });

  assert.equal(result.status, 'error');
  assert.equal(result.statusCode, 500);
  assert.equal(result.errorMessage, 'failure');
});

test('invokeWebhookAssistant reports timeout', async () => {
  const result = await invokeWebhookAssistant({
    url: 'https://example.com/webhook',
    payload: basePayload,
    timeoutMs: 10,
    fetchImpl: async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    },
    validateUrl: async () => undefined,
  });

  assert.equal(result.status, 'timeout');
  assert.equal(result.errorMessage, 'Webhook request timed out');
});
