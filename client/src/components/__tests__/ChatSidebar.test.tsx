import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ChatSidebar } from '../ChatSidebar';
import { getQueryFn } from '@/lib/queryClient';

const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('ChatSidebar assistants section', () => {
  const okJson = (data: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  let assistantsResponse: {
    assistants: Array<Record<string, unknown>>;
  };

  beforeEach(() => {
    assistantsResponse = {
      assistants: [
        {
          id: 'prompt-1',
          name: 'Prompt Helper',
          description: 'Helps with prompts',
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
          name: 'Webhook Agent',
          description: 'Triggers workflows',
          type: 'webhook',
          promptContent: null,
          metadata: { timeoutMs: 1000 },
          webhookUrl: 'https://example.com/hook',
          workflowId: 'wf-123',
          webhook: { url: 'https://example.com/hook', workflowId: 'wf-123' },
          isActive: true,
        },
        {
          id: 'webhook-inactive',
          name: 'Legacy Agent',
          description: 'Inactive workflow',
          type: 'webhook',
          promptContent: null,
          metadata: null,
          webhookUrl: 'https://example.com/legacy',
          workflowId: 'wf-inactive',
          webhook: { url: 'https://example.com/legacy', workflowId: 'wf-inactive' },
          isActive: false,
        },
      ],
    };

    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        plan: 'pro',
      },
      isAdmin: true,
    });

    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url;

      if (url.includes('/api/user/preferences')) {
        return okJson({ name: 'Test User' });
      }
      if (url.includes('/api/projects')) {
        return okJson([]);
      }
      if (url.includes('/api/templates')) {
        return okJson({ templates: [] });
      }
      if (url.includes('/api/assistants')) {
        return okJson(assistantsResponse);
      }

      return okJson({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderSidebar = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: getQueryFn({ on401: 'throw' }),
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ChatSidebar
          isOpen
          onNewChat={vi.fn()}
          chats={[]}
          activeChat={null}
          onChatSelect={vi.fn()}
          onChatArchive={vi.fn()}
          onChatDelete={vi.fn()}
        />
      </QueryClientProvider>,
    );
  };

  it('renders the consolidated AI Assistants accordion with the Manage N8N CTA', async () => {
    renderSidebar();

    await waitFor(() => expect(screen.getByTestId('card-manage-n8n')).toBeVisible());
    expect(screen.getByText('Open integrations')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('assistant-item-prompt-1')).toBeVisible());
    await waitFor(() => expect(screen.getByTestId('assistant-item-webhook-1')).toBeVisible());
    await waitFor(() => expect(screen.getByTestId('assistant-item-webhook-inactive')).toBeVisible());

    expect(screen.queryByText('AI Agents')).not.toBeInTheDocument();
  });

  it('hides the Manage N8N CTA and unpublished assistants for non-admin users', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        plan: 'pro',
      },
      isAdmin: false,
    });

    renderSidebar();

    await waitFor(() => expect(screen.queryByTestId('card-manage-n8n')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('assistant-item-prompt-1')).toBeVisible());
    await waitFor(() => expect(screen.getByTestId('assistant-item-webhook-1')).toBeVisible());
    expect(screen.queryByTestId('assistant-item-webhook-inactive')).not.toBeInTheDocument();
  });

  it('shows the empty state when no published assistants are available to non-admins', async () => {
    assistantsResponse = {
      assistants: [
        {
          id: 'webhook-inactive',
          name: 'Legacy Agent',
          description: 'Inactive workflow',
          type: 'webhook',
          promptContent: null,
          metadata: null,
          webhookUrl: 'https://example.com/legacy',
          workflowId: 'wf-inactive',
          webhook: { url: 'https://example.com/legacy', workflowId: 'wf-inactive' },
          isActive: false,
        },
      ],
    };

    mockUseAuth.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        plan: 'pro',
      },
      isAdmin: false,
    });

    renderSidebar();

    await waitFor(() => expect(screen.getByText(/No assistants available yet\./i)).toBeVisible());
  });
});
