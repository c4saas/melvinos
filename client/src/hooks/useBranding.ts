import { useQuery } from '@tanstack/react-query';

interface Branding {
  agentName: string;
  agentNameUpper: string;
  platformName: string;
}

const DEFAULT_AGENT_NAME = 'Atlas';
const DEFAULT_PLATFORM_NAME = 'Atlas AI Platform';

/**
 * Provides whitelabel-safe branding values sourced from user preferences.
 * All UI text should use these values instead of hardcoded "Melvin" / "Atlas".
 */
export function useBranding(): Branding {
  const { data } = useQuery<{ aiName?: string }>({
    queryKey: ['/api/user/preferences'],
    enabled: false, // Don't fetch — piggyback on existing fetches
  });

  const agentName = data?.aiName || DEFAULT_AGENT_NAME;

  return {
    agentName,
    agentNameUpper: agentName.toUpperCase(),
    platformName: DEFAULT_PLATFORM_NAME,
  };
}
