import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import AssistantsPage from '../AssistantsPage';
import * as queryClientModule from '@/lib/queryClient';

const toastMock = vi.fn();

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, isLoading: false }),
}));

vi.mock('@/components/AdminLayout', () => ({
  useAdminLayout: () => ({
    setHeader: vi.fn(),
    resetHeader: vi.fn(),
  }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['', vi.fn()],
}));

const okJson = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('AssistantsPage status toggle', () => {
  let apiRequestSpy: ReturnType<typeof vi.spyOn>;
  let queryClient: QueryClient;

  const baseAssistant = {
    id: 'assistant-1',
    type: 'prompt' as const,
    name: 'Test Assistant',
    description: 'Test description',
    promptContent: 'Prompt',
    workflowId: null,
    webhookUrl: null,
    metadata: null,
    isActive: true,
  };

  const renderPage = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AssistantsPage />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    toastMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    apiRequestSpy = vi
      .spyOn(queryClientModule, 'apiRequest')
      .mockImplementation(async (method: string, url: string, body?: unknown) => {
        if (method === 'GET' && url === '/api/admin/assistants') {
          return okJson({ assistants: [baseAssistant] });
        }

        if (method === 'PATCH' && url === `/api/admin/assistants/${baseAssistant.id}`) {
          const updates = body as { isActive: boolean };
          return okJson({ assistant: { ...baseAssistant, isActive: updates.isActive } });
        }

        return okJson({});
      });
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    queryClient.clear();
  });

  it('sends PATCH request with new status and shows success toast', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('assistant-assistant-1')).toBeInTheDocument());

    const toggle = screen.getByTestId('switch-assistant-active-assistant-1');
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = apiRequestSpy.mock.calls.find(
        ([method, url]) => method === 'PATCH' && url === `/api/admin/assistants/${baseAssistant.id}`,
      );
      expect(patchCall).toBeDefined();
      expect(patchCall?.[2]).toEqual({ isActive: false });
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Assistant deactivated',
        }),
      );
    });
  });

  it('shows error toast and reverts status when PATCH fails', async () => {
    apiRequestSpy.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === 'GET' && url === '/api/admin/assistants') {
        return okJson({ assistants: [baseAssistant] });
      }

      if (method === 'PATCH' && url === `/api/admin/assistants/${baseAssistant.id}`) {
        return okJson({ error: 'Nope' }, 500);
      }

      return okJson({});
    });

    renderPage();

    await waitFor(() => expect(screen.getByTestId('assistant-assistant-1')).toBeInTheDocument());

    const toggle = screen.getByTestId('switch-assistant-active-assistant-1');
    expect(toggle).toHaveAttribute('data-state', 'checked');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to update assistant status',
          variant: 'destructive',
        }),
      );
    });

    await waitFor(() => {
      const refreshedToggle = screen.getByTestId('switch-assistant-active-assistant-1');
      expect(refreshedToggle).toHaveAttribute('data-state', 'checked');
    });
  });
});
