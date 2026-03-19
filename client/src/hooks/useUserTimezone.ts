import { useQuery } from '@tanstack/react-query';

interface UserPrefs { timezone?: string; }

/**
 * Returns the user's configured IANA timezone string (e.g. 'America/Chicago').
 * Falls back to browser timezone, then 'UTC'.
 * Cached for 5 minutes.
 */
export function useUserTimezone(): string {
  const { data } = useQuery<UserPrefs>({
    queryKey: ['/api/user/preferences'],
    staleTime: 300_000,
  });
  return data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
