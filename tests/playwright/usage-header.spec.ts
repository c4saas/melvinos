import { test, expect } from '@playwright/test';

test('chat header displays the latest usage snapshot', async ({ page }) => {
  await page.addInitScript(() => {
    const okJson = (data, init = {}) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          ...init,
        }),
      );

    const now = Date.now();
    const usagePayload = {
      rangeStart: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      rangeEnd: new Date(now).toISOString(),
      generatedAt: new Date(now).toISOString(),
      totals: {
        messages: 3,
        promptTokens: 3200,
        completionTokens: 6800,
        totalTokens: 10000,
        totalCost: 2.5,
        avgTokensPerMessage: 3333.33,
        avgCostPerMessage: 0.833,
      },
      models: [],
      source: 'snapshot',
    };

    const preferencesPayload = {
      personalizationEnabled: false,
      customInstructions: '',
      name: 'Test User',
      occupation: '',
      bio: '',
      profileImageUrl: '',
      memories: [],
      chatHistoryEnabled: true,
      autonomousCodeExecution: true,
      lastArea: 'user',
    };

    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/auth/user')) {
        return okJson({ id: 'user-1', name: 'Test User', role: 'user' });
      }

      if (url.endsWith('/api/users/me/limits')) {
        return okJson({
          plan: 'pro',
          messageLimitPerDay: null,
          allowedModels: ['compound'],
          features: [],
          chatHistoryEnabled: true,
        });
      }

      if (url.endsWith('/api/usage/user/latest')) {
        return okJson(usagePayload);
      }

      if (url.endsWith('/api/user/preferences')) {
        return okJson(preferencesPayload);
      }

      if (url.endsWith('/api/projects')) {
        return okJson([]);
      }

      if (url.endsWith('/api/templates')) {
        return okJson({ templates: [] });
      }

      if (url.endsWith('/api/assistants')) {
        return okJson({ assistants: [] });
      }

      if (url.endsWith('/api/chats') && method === 'GET') {
        return okJson([]);
      }

      if (url.endsWith('/api/chats') && method === 'POST') {
        return okJson({ id: 'chat-1', title: 'Chat 1', createdAt: new Date().toISOString() });
      }

      if (url.endsWith('/api/csrf')) {
        return okJson({ token: 'csrf-token' });
      }

      return originalFetch(input, init);
    };
  });

  await page.goto('/app');

  await expect(page.getByTestId('usage-tokens')).toHaveText('10,000 tokens');
  await expect(page.getByTestId('usage-updated')).toContainText('Updated');
  await expect(page.getByTestId('usage-cta')).toHaveAttribute('href', '/usage');
});
