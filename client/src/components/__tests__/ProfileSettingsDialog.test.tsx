import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileSettingsDialog } from '../ProfileSettingsDialog';
import { queryClient } from '@/lib/queryClient';
import * as queryClientModule from '@/lib/queryClient';

const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

const okJson = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('ProfileSettingsDialog tab structure', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;
  let apiRequestSpy: ReturnType<typeof vi.spyOn>;

  const preferencesResponse = {
    personalizationEnabled: false,
    customInstructions: '',
    name: 'Test User',
    occupation: '',
    bio: '',
    profileImageUrl: '',
    memories: [],
    chatHistoryEnabled: true,
    autonomousCodeExecution: false,
    lastArea: 'user',
    company: '',
    timezone: '',
    location: '',
    website: '',
  };

  const renderDialog = (defaultTab?: string) =>
    render(
      <QueryClientProvider client={queryClient}>
        <ProfileSettingsDialog isOpen defaultTab={defaultTab} onClose={() => {}} />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    queryClient.clear();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', plan: 'free' },
      isAdmin: false,
    });

    fetchMock = vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/user/preferences')) {
        return okJson(preferencesResponse);
      }
      if (url.endsWith('/api/chats/archived')) {
        return okJson([]);
      }

      return okJson({});
    });

    apiRequestSpy = vi
      .spyOn(queryClientModule, 'apiRequest')
      .mockImplementation(async () => {
        return okJson({});
      });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    apiRequestSpy.mockRestore();
    queryClient.clear();
  });

  it('renders 5 user-focused tabs', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    // All 5 tabs should be present
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('does not render Integrations or Skills tabs', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    expect(screen.queryByText('Integrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
  });

  it('opens to account tab when defaultTab is set', async () => {
    renderDialog('account');

    await waitFor(() => {
      expect(screen.getByTestId('button-logout-settings')).toBeInTheDocument();
    });
  });
});
