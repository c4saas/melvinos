import { GoogleDriveService } from '../../google-drive';
import type { ToolContext, GoogleAccount } from '../tool-registry';

/**
 * Build a GoogleDriveService for a single account.
 */
export function buildService(
  account: GoogleAccount,
  clientId: string,
  clientSecret: string,
): GoogleDriveService {
  const service = new GoogleDriveService(clientId, clientSecret, '');
  service.setTokens(account.accessToken, account.refreshToken);
  service.setTokenRefreshCallback(account.update);
  return service;
}

/**
 * Return all connected Google services (one per account).
 * Falls back to the legacy single-token fields for backwards compatibility.
 */
export function getGoogleServices(
  context: ToolContext,
): Array<{ label: string; service: GoogleDriveService }> {
  const clientId = context.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = context.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  if (context.googleAccounts && context.googleAccounts.length > 0) {
    return context.googleAccounts.map(acc => ({
      label: acc.label,
      service: buildService({ ...acc, clientId, clientSecret }, clientId, clientSecret),
    }));
  }

  // Backwards compat: single token on context
  if (!context.googleAccessToken) return [];
  const service = new GoogleDriveService(clientId, clientSecret, '');
  service.setTokens(context.googleAccessToken, context.googleRefreshToken);
  if (context.updateGoogleTokens) service.setTokenRefreshCallback(context.updateGoogleTokens);
  return [{ label: 'default', service }];
}

/**
 * Return a single Google service for write operations.
 * Prefers the account matching `preferredLabel`, falls back to primary.
 */
export function getGoogleService(
  context: ToolContext,
  preferredLabel?: string,
): { label: string; service: GoogleDriveService } | null {
  const all = getGoogleServices(context);
  if (all.length === 0) return null;
  if (preferredLabel) {
    const match = all.find(a => a.label.toLowerCase() === preferredLabel.toLowerCase());
    if (match) return match;
  }
  return all[0];
}
