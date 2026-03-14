import { test, expect } from '@playwright/test';

test('prompt and webhook assistants route messages correctly', async ({ page }) => {
  await page.addInitScript(() => {
    const okJson = (data: unknown, init: ResponseInit = {}) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          ...init,
        }),
      );

    (window as any).__chatRequests = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase();

      if (url.endsWith('/api/auth/user')) {
        return okJson({ id: 'user-1', name: 'Test User', role: 'user' });
      }

      if (url.includes('/api/users/me/limits')) {
        return okJson({
          plan: 'pro',
          messageLimitPerDay: null,
          allowedModels: ['compound'],
          features: [],
          chatHistoryEnabled: true,
        });
      }

      if (url.includes('/api/assistants')) {
        return okJson({
          assistants: [
            {
              id: 'prompt-1',
              name: 'Prompt Pro',
              description: 'High quality prompt assistant',
              type: 'prompt',
              promptContent: 'You are helpful.',
              metadata: null,
              webhookUrl: null,
              workflowId: null,
              webhook: null,
              isActive: true,
            },
            {
              id: 'webhook-1',
              name: 'Webhook Sales',
              description: 'Routes to sales webhook',
              type: 'webhook',
              promptContent: null,
              metadata: { timeoutMs: 5000 },
              webhookUrl: 'https://example.com/hook',
              workflowId: 'workflow-123',
              webhook: { url: 'https://example.com/hook', workflowId: 'workflow-123', metadata: { timeoutMs: 5000 } },
              isActive: true,
            },
          ],
        });
      }

      if (url.includes('/api/output-templates')) {
        return okJson({ templates: [] });
      }

      if (url.includes('/api/chats') && method === 'GET') {
        return okJson([]);
      }

      if (url.includes('/api/chats') && method === 'POST') {
        return okJson({ id: 'chat-1', title: 'New Chat', createdAt: new Date().toISOString() });
      }

      if (url.includes('/api/csrf')) {
        return okJson({ token: 'csrf-token' });
      }

      if (url.includes('/api/chat/completions/stream')) {
        const bodyText = init?.body ? String(init.body) : '{}';
        const body = JSON.parse(bodyText);
        (window as any).__chatRequests.push(body);

        const encoder = new TextEncoder();
        const events: string[] = [];

        if (body.assistantType === 'webhook') {
          events.push(
            'event: text_delta\n' +
              'data: {"text":"Webhook response"}\n\n',
          );
          events.push(
            'event: done\n' +
              'data: ' +
              JSON.stringify({
                content: 'Webhook response',
                metadata: {
                  assistantId: body.assistantId,
                  assistantType: 'webhook',
                  assistantName: 'Webhook Sales',
                  webhook: {
                    status: 'error',
                    url: 'https://example.com/hook',
                    errorMessage: 'Failed to reach upstream',
                  },
                },
              }) +
              '\n\n',
          );
        } else {
          events.push(
            'event: text_delta\n' +
              'data: {"text":"Prompt response"}\n\n',
          );
          events.push(
            'event: done\n' +
              'data: ' +
              JSON.stringify({
                content: 'Prompt response',
                metadata: {
                  assistantId: body.assistantId,
                  assistantType: 'prompt',
                  assistantName: 'Prompt Pro',
                },
              }) +
              '\n\n',
          );
        }

        const stream = new ReadableStream({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(event));
            }
            controller.close();
          },
        });

        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        );
      }

      return originalFetch(input, init);
    };
  });

  await page.goto('/app');

  // Select prompt assistant and send a message
  await page.getByTestId('select-assistant').click();
  await page.getByTestId('assistant-option-prompt-1').click();
  await page.getByPlaceholder('Ask anything').fill('Hello prompt');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Prompt response')).toBeVisible();
  await expect(page.getByText('Prompt Pro')).toBeVisible();

  // Switch to webhook assistant and send a message
  await page.getByTestId('select-assistant').click();
  await page.getByTestId('assistant-option-webhook-1').click();
  await page.getByPlaceholder('Ask anything').fill('Webhook please');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Webhook response')).toBeVisible();
  await expect(page.getByText('Webhook Sales')).toBeVisible();
  await expect(page.getByTestId(/badge-webhook-/).last()).toHaveText(/Webhook (Error|Timeout)/);

  const recorded = await page.evaluate(() => (window as any).__chatRequests);
  expect(recorded).toHaveLength(2);
  expect(recorded[0].assistantType).toBe('prompt');
  expect(recorded[1].assistantType).toBe('webhook');
});
