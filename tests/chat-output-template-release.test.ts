import test from 'node:test';
import assert from 'node:assert/strict';
import type { Assistant, OutputTemplate, Release } from '@shared/schema';
import type { IStorage } from '../server/storage';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/test';

const { createPrepareChatCompletionRequest } = await import('../server/routes');

const noopDate = new Date();

test('rejects chat request when output template is not allowed by active release', async () => {
  const template: OutputTemplate = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test Template',
    category: 'general',
    description: null,
    format: 'markdown',
    instructions: null,
    requiredSections: [],
    isActive: true,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const release: Release = {
    id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    label: 'v1',
    status: 'active',
    changeNotes: null,
    systemPromptId: null,
    assistantIds: [],
    templateIds: [],
    outputTemplateIds: ['33333333-3333-4333-8333-333333333333'],
    toolPolicyIds: [],
    isActive: true,
    publishedAt: noopDate,
    publishedByUserId: null,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const storageStub: Pick<IStorage, 'getChat' | 'getFileForUser' | 'getOutputTemplate' | 'getActiveRelease' | 'getAssistant'> = {
    async getChat() {
      return undefined;
    },
    async getFileForUser() {
      return undefined;
    },
    async getOutputTemplate(id: string) {
      return id === template.id ? template : undefined;
    },
    async getActiveRelease() {
      return release;
    },
    async getAssistant() {
      return undefined;
    },
  };

  const prepare = createPrepareChatCompletionRequest({
    storage: storageStub,
    authService: {
      async checkRateLimit() {
        return { allowed: true, remaining: 1, limit: 100 };
      },
    },
  });

  const request = {
    body: {
      model: 'compound',
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: { outputTemplateId: template.id },
    },
    user: { id: 'user-1', plan: 'pro' },
  } as any;

  await assert.rejects(
    () => prepare(request),
    (error: any) => {
      assert.equal(error?.status, 400);
      assert.equal(error?.message, 'Selected output template is not available');
      return true;
    },
  );
});

test('rejects chat request when assistant is not allowed by active release', async () => {
  const assistant: Assistant = {
    id: '44444444-4444-4444-8444-444444444444',
    type: 'prompt',
    userId: null,
    name: 'Prompt Pilot',
    description: 'Guides conversations with curated prompts.',
    promptContent: 'Always keep responses concise and structured.',
    webhookUrl: null,
    workflowId: null,
    metadata: null,
    isActive: true,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const release: Release = {
    id: '55555555-5555-4555-8555-555555555555',
    version: 2,
    label: 'v2',
    status: 'active',
    changeNotes: null,
    systemPromptId: null,
    assistantIds: ['99999999-9999-4999-8999-999999999999'],
    templateIds: [],
    outputTemplateIds: [],
    toolPolicyIds: [],
    isActive: true,
    publishedAt: noopDate,
    publishedByUserId: null,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const storageStub: Pick<IStorage, 'getChat' | 'getFileForUser' | 'getOutputTemplate' | 'getActiveRelease' | 'getAssistant'> = {
    async getChat() {
      return undefined;
    },
    async getFileForUser() {
      return undefined;
    },
    async getOutputTemplate() {
      return undefined;
    },
    async getActiveRelease() {
      return release;
    },
    async getAssistant(id: string) {
      return id === assistant.id ? assistant : undefined;
    },
  };

  const prepare = createPrepareChatCompletionRequest({
    storage: storageStub,
    authService: {
      async checkRateLimit() {
        return { allowed: true, remaining: 1, limit: 100 };
      },
    },
  });

  const request = {
    body: {
      model: 'compound',
      messages: [{ role: 'user', content: 'Hello' }],
      assistantId: assistant.id,
    },
    user: { id: 'user-1', plan: 'pro' },
  } as any;

  await assert.rejects(
    () => prepare(request),
    (error: any) => {
      assert.equal(error?.status, 400);
      assert.equal(error?.message, 'Selected assistant is not available');
      return true;
    },
  );
});

test('rejects chat request when assistant is inactive', async () => {
  const assistant: Assistant = {
    id: '66666666-6666-4666-8666-666666666666',
    type: 'prompt',
    userId: null,
    name: 'Inactive Prompt',
    description: 'This assistant is disabled.',
    promptContent: 'Respond politely.',
    webhookUrl: null,
    workflowId: null,
    metadata: null,
    isActive: false,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const release: Release = {
    id: '77777777-7777-4777-8777-777777777777',
    version: 3,
    label: 'v3',
    status: 'active',
    changeNotes: null,
    systemPromptId: null,
    assistantIds: [assistant.id],
    templateIds: [],
    outputTemplateIds: [],
    toolPolicyIds: [],
    isActive: true,
    publishedAt: noopDate,
    publishedByUserId: null,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const storageStub: Pick<IStorage, 'getChat' | 'getFileForUser' | 'getOutputTemplate' | 'getActiveRelease' | 'getAssistant'> = {
    async getChat() {
      return undefined;
    },
    async getFileForUser() {
      return undefined;
    },
    async getOutputTemplate() {
      return undefined;
    },
    async getActiveRelease() {
      return release;
    },
    async getAssistant(id: string) {
      return id === assistant.id ? assistant : undefined;
    },
  };

  const prepare = createPrepareChatCompletionRequest({
    storage: storageStub,
    authService: {
      async checkRateLimit() {
        return { allowed: true, remaining: 1, limit: 100 };
      },
    },
  });

  const request = {
    body: {
      model: 'compound',
      messages: [{ role: 'user', content: 'Hello' }],
      assistantId: assistant.id,
    },
    user: { id: 'user-1', plan: 'pro' },
  } as any;

  await assert.rejects(
    () => prepare(request),
    (error: any) => {
      assert.equal(error?.status, 400);
      assert.equal(error?.message, 'Selected assistant is not available');
      return true;
    },
  );
});

test('returns assistant id and type when assistant passes release checks', async () => {
  const assistant: Assistant = {
    id: '88888888-8888-4888-8888-888888888888',
    type: 'prompt',
    userId: null,
    name: 'Prompt Guide',
    description: 'Active assistant',
    promptContent: 'Provide guidance.',
    webhookUrl: null,
    workflowId: null,
    metadata: null,
    isActive: true,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const release: Release = {
    id: '99999999-9999-4999-8999-999999999999',
    version: 4,
    label: 'v4',
    status: 'active',
    changeNotes: null,
    systemPromptId: null,
    assistantIds: [assistant.id],
    templateIds: [],
    outputTemplateIds: [],
    toolPolicyIds: [],
    isActive: true,
    publishedAt: noopDate,
    publishedByUserId: null,
    createdAt: noopDate,
    updatedAt: noopDate,
  };

  const storageStub: Pick<IStorage, 'getChat' | 'getFileForUser' | 'getOutputTemplate' | 'getActiveRelease' | 'getAssistant'> = {
    async getChat() {
      return undefined;
    },
    async getFileForUser() {
      return undefined;
    },
    async getOutputTemplate() {
      return undefined;
    },
    async getActiveRelease() {
      return release;
    },
    async getAssistant(id: string) {
      return id === assistant.id ? assistant : undefined;
    },
  };

  const prepare = createPrepareChatCompletionRequest({
    storage: storageStub,
    authService: {
      async checkRateLimit() {
        return { allowed: true, remaining: 1, limit: 100 };
      },
    },
  });

  const request = {
    body: {
      model: 'compound',
      messages: [{ role: 'user', content: 'Hello' }],
      assistantId: assistant.id,
    },
    user: { id: 'user-2', plan: 'pro' },
  } as any;

  const prepared = await prepare(request);

  assert.equal(prepared.assistantId, assistant.id);
  assert.equal(prepared.assistantType, 'prompt');
});
