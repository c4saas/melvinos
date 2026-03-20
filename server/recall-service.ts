/**
 * Recall.ai API service — bots, transcripts, participants, billing, Calendar V2.
 * Docs: https://docs.recall.ai/reference
 */

interface RecallBot {
  id: string;
  meeting_url: string;
  bot_name: string;
  join_at: string;
  status_changes: Array<{ code: string; created_at: string; sub_code?: string | null }>;
}

interface RecallTranscriptEntry {
  participant: {
    id: number;
    name: string;
    is_host: boolean;
    platform: string;
  };
  words: Array<{
    text: string;
    start_timestamp: { relative: number; absolute: string };
    end_timestamp: { relative: number; absolute: string };
  }>;
}

interface RecallPaginatedResponse<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface RecallParticipant {
  id: number;
  name: string;
  is_host: boolean;
  platform: string;
}

export interface RecallCalendar {
  id: string;
  platform: 'google' | 'microsoft_teams' | string;
  email?: string;
  status?: string;
  created_at?: string;
}

export interface RecallCalendarEvent {
  id: string;
  external_id?: string;
  calendar?: string;
  summary?: string;
  start_time?: string;
  end_time?: string;
  meeting_url?: string | null;
  bot_scheduled?: boolean;
  bot?: { id: string } | null;
}

export interface RecallBillingUsage {
  bot_minutes?: number;
  bot_minutes_limit?: number;
  bot_hours?: number;
  bot_hours_limit?: number;
  billing_period_start?: string;
  billing_period_end?: string;
  [key: string]: unknown;
}

export class RecallService {
  private baseUrl: string;   // v1 — bots, transcripts
  private baseUrlV2: string; // v2 — calendars, calendar events
  private apiKey: string;

  constructor(apiKey: string, region: string = 'us-west-2') {
    this.apiKey = apiKey;
    this.baseUrl = `https://${region}.recall.ai/api/v1`;
    this.baseUrlV2 = `https://${region}.recall.ai/api/v2`;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Token ${this.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  // ── Bots ────────────────────────────────────────────────────────────────────

  /** List bots (meetings) — optionally filter by join_at_after */
  async listBots(opts?: { joinAtAfter?: string; limit?: number }): Promise<RecallBot[]> {
    const params = new URLSearchParams();
    if (opts?.joinAtAfter) params.set('join_at_after', opts.joinAtAfter);

    const url = `${this.baseUrl}/bot/${params.toString() ? '?' + params.toString() : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);

    const data: RecallPaginatedResponse<RecallBot> = await res.json();
    const limit = opts?.limit ?? 20;
    return data.results.slice(0, limit);
  }

  /** Create a bot and send it to a meeting URL.
   *  Note: bot.status_change webhooks must be configured at the workspace level
   *  in the Recall dashboard — they are no longer supported as per-bot realtime_endpoints.
   */
  async createBot(meetingUrl: string, botName?: string, joinAt?: string, webhookUrl?: string): Promise<RecallBot> {
    const body: Record<string, unknown> = {
      meeting_url: meetingUrl,
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              language_code: 'en',
              mode: 'prioritize_low_latency',
            },
          },
        },
      },
    };
    if (botName) body.bot_name = botName;
    if (joinAt) body.join_at = joinAt;
    if (webhookUrl) body.webhook_url = webhookUrl;

    const res = await fetch(`${this.baseUrl}/bot/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Get a specific bot by ID */
  async getBot(botId: string): Promise<RecallBot & { recordings?: any[] }> {
    const res = await fetch(`${this.baseUrl}/bot/${botId}/`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Delete media files (video/audio) for a bot — keeps the bot record & transcript */
  async deleteMedia(botId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/bot/${botId}/delete-media/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
  }

  // ── Transcripts & Participants ───────────────────────────────────────────────

  /** Get transcript for a bot.
   *  The legacy /bot/{id}/transcript/ endpoint is deprecated (HTTP 400).
   *  New approach: fetch bot detail → recording media_shortcuts.transcript.download_url → download content.
   *
   *  Recall processes transcripts asynchronously after bot.done fires. Poll with retries
   *  to wait for the transcript download URL to become available.
   */
  async getBotTranscript(botId: string, opts?: { retries?: number; retryDelayMs?: number }): Promise<RecallTranscriptEntry[]> {
    const maxRetries = opts?.retries ?? 6;
    const delayMs = opts?.retryDelayMs ?? 20000; // 20 seconds between retries (up to ~2 min total)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      const bot = await this.getBot(botId);
      const recordings = (bot as any).recordings ?? [];

      for (const recording of recordings) {
        const transcriptShortcut = recording?.media_shortcuts?.transcript;
        const downloadUrl = transcriptShortcut?.data?.download_url;
        if (downloadUrl) {
          const res = await fetch(downloadUrl);
          if (!res.ok) throw new Error(`Failed to download transcript: ${res.status}`);
          return res.json();
        }
      }

      // Transcript not ready yet — retry if attempts remain
      if (attempt < maxRetries) {
        console.log(`[recall] Transcript not ready for bot ${botId} (attempt ${attempt + 1}/${maxRetries + 1}) — retrying in ${delayMs / 1000}s`);
      }
    }

    return []; // Transcript never became available
  }

  /** Extract unique participants from a bot's transcript */
  async getBotParticipants(botId: string): Promise<RecallParticipant[]> {
    const transcript = await this.getBotTranscript(botId);
    const seen = new Map<number, RecallParticipant>();
    for (const entry of transcript) {
      const p = entry.participant;
      if (!seen.has(p.id)) {
        seen.set(p.id, { id: p.id, name: p.name, is_host: p.is_host, platform: p.platform });
      }
    }
    return Array.from(seen.values());
  }

  /** Format transcript entries into readable text */
  formatTranscript(entries: RecallTranscriptEntry[]): string {
    return entries.map(entry => {
      const speaker = entry.participant.name || `Speaker ${entry.participant.id}`;
      const text = entry.words.map(w => w.text).join(' ');
      return `**${speaker}**: ${text}`;
    }).join('\n\n');
  }

  /** Search transcripts across recent bots for a keyword */
  async searchTranscripts(query: string, opts?: { joinAtAfter?: string; limit?: number }): Promise<Array<{
    botId: string;
    botName: string;
    meetingUrl: string;
    joinAt: string;
    matches: string[];
  }>> {
    const bots = await this.listBots({ joinAtAfter: opts?.joinAtAfter, limit: opts?.limit ?? 10 });
    const results: Array<{ botId: string; botName: string; meetingUrl: string; joinAt: string; matches: string[] }> = [];
    const queryLower = query.toLowerCase();

    for (const bot of bots) {
      const lastStatus = bot.status_changes[bot.status_changes.length - 1];
      if (!lastStatus || !['done', 'call_ended'].includes(lastStatus.code)) continue;

      try {
        const transcript = await this.getBotTranscript(bot.id);
        const matches: string[] = [];

        for (const entry of transcript) {
          const fullText = entry.words.map(w => w.text).join(' ');
          if (fullText.toLowerCase().includes(queryLower)) {
            const speaker = entry.participant.name || `Speaker ${entry.participant.id}`;
            matches.push(`${speaker}: ${fullText}`);
          }
        }

        if (matches.length > 0) {
          results.push({
            botId: bot.id,
            botName: bot.bot_name,
            meetingUrl: bot.meeting_url,
            joinAt: bot.join_at,
            matches: matches.slice(0, 5),
          });
        }
      } catch {
        continue;
      }
    }

    return results;
  }

  // ── Billing ─────────────────────────────────────────────────────────────────

  /** Get billing/usage stats for the current billing period */
  async getBillingUsage(): Promise<RecallBillingUsage> {
    const res = await fetch(`${this.baseUrl}/billing/usage/`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // ── Calendar V2 ─────────────────────────────────────────────────────────────

  /** List all connected calendars */
  async listCalendars(): Promise<RecallCalendar[]> {
    const res = await fetch(`${this.baseUrlV2}/calendars/`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    const data: RecallPaginatedResponse<RecallCalendar> = await res.json();
    return data.results ?? [];
  }

  /**
   * Connect a calendar (Calendar V2).
   * In API v2 there is no separate access-token exchange step —
   * OAuth credentials are passed directly to POST /api/v2/calendars/.
   *
   * Pass defaultBotConfig to enable automatic bot scheduling for ALL events
   * with a meeting URL (Zoom, Meet, Teams, Webex). Without it, bots must be
   * scheduled manually per event.
   */
  async createCalendar(
    platform: string,
    oauthRefreshToken: string,
    oauthClientId: string,
    oauthClientSecret: string,
    defaultBotConfig?: Record<string, unknown>,
  ): Promise<RecallCalendar> {
    const body: Record<string, unknown> = {
      platform,
      oauth_client_id: oauthClientId,
      oauth_client_secret: oauthClientSecret,
      oauth_refresh_token: oauthRefreshToken,
    };
    if (defaultBotConfig) body.default_bot_config = defaultBotConfig;
    const res = await fetch(`${this.baseUrlV2}/calendars/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /**
   * Update an existing calendar's default_bot_config (or other settings).
   * Use this to enable auto-join on a calendar that was connected without it.
   */
  async updateCalendar(calendarId: string, updates: Record<string, unknown>): Promise<RecallCalendar> {
    const res = await fetch(`${this.baseUrlV2}/calendars/${calendarId}/`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Disconnect (delete) a connected calendar */
  async deleteCalendar(calendarId: string): Promise<void> {
    const res = await fetch(`${this.baseUrlV2}/calendars/${calendarId}/`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    }
  }

  /** List upcoming calendar events. Events with a meeting_url can have bots auto-scheduled. */
  async listCalendarEvents(opts?: { limit?: number; startAfter?: string }): Promise<RecallCalendarEvent[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.startAfter) params.set('start_time__gte', opts.startAfter);
    const url = `${this.baseUrlV2}/calendar-events/${params.toString() ? '?' + params : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    const data: RecallPaginatedResponse<RecallCalendarEvent> = await res.json();
    return data.results ?? [];
  }

  /** Schedule a bot for a specific calendar event (Melvin auto-joins when it starts) */
  async scheduleEventBot(eventId: string, botName?: string): Promise<RecallCalendarEvent> {
    const body: Record<string, unknown> = {};
    if (botName) body.bot_name = botName;
    const res = await fetch(`${this.baseUrlV2}/calendar-events/${eventId}/bot/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Remove a scheduled bot from a calendar event */
  async unscheduleEventBot(eventId: string): Promise<void> {
    const res = await fetch(`${this.baseUrlV2}/calendar-events/${eventId}/bot/`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Recall API error ${res.status}: ${await res.text()}`);
    }
  }
}
