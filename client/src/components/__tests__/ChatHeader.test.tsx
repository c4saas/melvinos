import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Router } from 'wouter';
import { ChatHeader } from '../ChatHeader';
import type { UsageSnapshotResponse } from '@/hooks/useUsageSnapshot';
import type { AIModel } from '@shared/schema';

const mockUseUsageSnapshot = vi.fn();

vi.mock('@/hooks/useUsageSnapshot', () => ({
  useUsageSnapshot: () => mockUseUsageSnapshot(),
}));

const baseModels: AIModel[] = [
  {
    id: 'model-1',
    name: 'Model One',
    description: 'A reliable default model',
    provider: 'OpenAI',
    capabilities: ['chat'],
    status: 'current',
  },
];

const defaultSnapshot = (overrides: Partial<UsageSnapshotResponse> = {}): UsageSnapshotResponse => ({
  rangeStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  rangeEnd: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  totals: {
    messages: 12,
    promptTokens: 4000,
    completionTokens: 6000,
    totalTokens: 10000,
    totalCost: 4.5,
    avgTokensPerMessage: 833.33,
    avgCostPerMessage: 0.375,
  },
  models: [],
  source: 'snapshot',
  ...overrides,
});

const renderHeader = () =>
  render(
    <Router>
      <ChatHeader
        onToggleSidebar={vi.fn()}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        availableModels={baseModels}
        onHomeClick={vi.fn()}
        showNewChatButton={false}
      />
    </Router>,
  );

describe('ChatHeader usage snapshot', () => {
  beforeEach(() => {
    mockUseUsageSnapshot.mockReset();
  });

  it('renders the latest usage totals and timestamp', () => {
    mockUseUsageSnapshot.mockReturnValue({
      snapshot: defaultSnapshot(),
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    renderHeader();

    expect(screen.getByTestId('usage-tokens')).toHaveTextContent('10,000 tokens');
    expect(screen.getByTestId('usage-updated')).toHaveTextContent(/Updated/);
    expect(screen.getByTestId('usage-cta')).toHaveAttribute('href', '/usage');
  });

  it('renders a loading indicator while the snapshot is syncing', () => {
    mockUseUsageSnapshot.mockReturnValue({
      snapshot: null,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    });

    renderHeader();

    expect(screen.getByTestId('usage-loading')).toHaveTextContent('Syncing usage…');
  });

  it('shows an error state when the snapshot fails to load', () => {
    mockUseUsageSnapshot.mockReturnValue({
      snapshot: null,
      isLoading: false,
      isFetching: false,
      error: new Error('offline'),
      refetch: vi.fn(),
    });

    renderHeader();

    expect(screen.getByTestId('usage-error')).toHaveTextContent('Usage unavailable');
    expect(screen.getByTestId('usage-cta')).toHaveAttribute('href', '/usage');
  });
});
