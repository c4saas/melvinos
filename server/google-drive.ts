import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class GoogleDriveService {
  private oauth2Client: OAuth2Client;
  private drive: any;
  private gmail: any;
  private calendar: any;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  getAuthUrl(state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
      ],
      prompt: 'consent',
      state,
    });
  }

  async exchangeCodeForTokens(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  setTokens(accessToken: string, refreshToken?: string, expiryDate?: number) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate,
    });
  }

  async refreshTokenIfNeeded() {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      return credentials;
    } catch (error) {
      throw new Error('Token refresh failed: ' + (error as Error).message);
    }
  }

  /**
   * Register a callback that fires whenever google-auth-library refreshes tokens.
   * Use this to persist the new access token back to storage so it survives across sessions.
   */
  setTokenRefreshCallback(
    callback: (accessToken: string, refreshToken?: string | null, expiryDate?: number | null) => Promise<void>,
  ): void {
    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.access_token) {
        callback(tokens.access_token, tokens.refresh_token ?? null, tokens.expiry_date ?? null).catch((err) => {
          console.error('[google] Failed to persist refreshed tokens:', err);
        });
      }
    });
  }

  async listFiles(pageSize: number = 20, pageToken?: string): Promise<any> {
    try {
      const response = await this.drive.files.list({
        pageSize,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, size, iconLink, webViewLink)',
        orderBy: 'modifiedTime desc',
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.listFiles(pageSize, pageToken);
      }
      throw error;
    }
  }

  async getFileContent(fileId: string): Promise<string> {
    try {
      const file = await this.drive.files.get({
        fileId,
        fields: 'mimeType, name',
      });

      const mimeType = file.data.mimeType;

      // Handle Google Docs
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain',
        });
        return response.data;
      }

      // Handle Google Sheets
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/csv',
        });
        return response.data;
      }

      // Handle regular files
      const response = await this.drive.files.get({
        fileId,
        alt: 'media',
      }, {
        responseType: 'text',
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.getFileContent(fileId);
      }
      throw error;
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      const response = await this.drive.files.get({
        fileId,
        alt: 'media',
      }, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.downloadFile(fileId);
      }
      throw error;
    }
  }

  async getFileMetadata(fileId: string): Promise<any> {
    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, createdTime, modifiedTime, size, iconLink, webViewLink',
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.getFileMetadata(fileId);
      }
      throw error;
    }
  }

  // ── Drive Write Methods ────────────────────────────────────────────────────

  async searchFiles(query: string, pageSize: number = 10): Promise<any> {
    try {
      const response = await this.drive.files.list({
        q: query,
        pageSize,
        fields: 'files(id, name, mimeType, createdTime, modifiedTime, size, webViewLink, parents)',
        orderBy: 'modifiedTime desc',
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.searchFiles(query, pageSize);
      }
      throw error;
    }
  }

  async createFile(name: string, mimeType: string, content?: string, parentFolderId?: string): Promise<any> {
    try {
      const requestBody: any = { name, mimeType };
      if (parentFolderId) requestBody.parents = [parentFolderId];

      const params: any = { requestBody, fields: 'id, name, mimeType, webViewLink' };
      if (content) {
        params.media = { mimeType: 'text/plain', body: content };
      }

      const response = await this.drive.files.create(params);
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.createFile(name, mimeType, content, parentFolderId);
      }
      throw error;
    }
  }

  async createFolder(name: string, parentFolderId?: string): Promise<any> {
    return this.createFile(name, 'application/vnd.google-apps.folder', undefined, parentFolderId);
  }

  async moveFile(fileId: string, newParentId: string, removeFromParentId?: string): Promise<any> {
    try {
      const params: any = { fileId, addParents: newParentId, fields: 'id, name, parents' };
      if (removeFromParentId) params.removeParents = removeFromParentId;
      const response = await this.drive.files.update(params);
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.moveFile(fileId, newParentId, removeFromParentId);
      }
      throw error;
    }
  }

  async updateFileContent(fileId: string, content: string, mimeType: string = 'text/plain'): Promise<any> {
    try {
      const response = await this.drive.files.update({
        fileId,
        media: { mimeType, body: content },
        fields: 'id, name, mimeType, modifiedTime, webViewLink',
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.updateFileContent(fileId, content, mimeType);
      }
      throw error;
    }
  }

  // ── Gmail Methods ──────────────────────────────────────────────────────────

  async listEmails(query: string = '', maxResults: number = 10): Promise<any> {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });
      const messages = response.data.messages ?? [];
      if (messages.length === 0) return { messages: [], resultSizeEstimate: 0 };

      // Fetch full message details for each
      const detailed = await Promise.all(
        messages.slice(0, maxResults).map(async (msg: any) => {
          const detail = await this.gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          });
          const headers = detail.data.payload?.headers ?? [];
          const getHeader = (name: string) =>
            headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
          return {
            id: msg.id,
            threadId: msg.threadId,
            from: getHeader('From'),
            to: getHeader('To'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: detail.data.snippet ?? '',
          };
        }),
      );

      return { messages: detailed, resultSizeEstimate: response.data.resultSizeEstimate ?? 0 };
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.listEmails(query, maxResults);
      }
      throw error;
    }
  }

  async getEmail(messageId: string): Promise<any> {
    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });
      const msg = response.data;
      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      // Extract plain text body
      let body = '';
      const extractText = (part: any): string => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
        if (part.parts) {
          return part.parts.map(extractText).join('\n');
        }
        return '';
      };
      body = extractText(msg.payload);

      return {
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        body: body.slice(0, 5000), // Limit body size
        snippet: msg.snippet ?? '',
      };
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.getEmail(messageId);
      }
      throw error;
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    body: string,
    options?: { cc?: string; bcc?: string; replyToMessageId?: string; threadId?: string },
  ): Promise<any> {
    try {
      const lines: string[] = [];
      lines.push(`To: ${to}`);
      if (options?.cc) lines.push(`Cc: ${options.cc}`);
      if (options?.bcc) lines.push(`Bcc: ${options.bcc}`);
      lines.push(`Subject: ${subject}`);
      if (options?.replyToMessageId) {
        lines.push(`In-Reply-To: ${options.replyToMessageId}`);
        lines.push(`References: ${options.replyToMessageId}`);
      }
      lines.push('Content-Type: text/plain; charset=utf-8');
      lines.push('');
      lines.push(body);

      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
      const params: any = { userId: 'me', requestBody: { raw } };
      if (options?.threadId) params.requestBody.threadId = options.threadId;

      const response = await this.gmail.users.messages.send(params);
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.sendEmail(to, subject, body, options);
      }
      throw error;
    }
  }

  async createDraft(to: string, subject: string, body: string): Promise<any> {
    try {
      const message = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
      const raw = Buffer.from(message).toString('base64url');
      const response = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.createDraft(to, subject, body);
      }
      throw error;
    }
  }

  async modifyEmail(messageId: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<any> {
    try {
      const response = await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { addLabelIds: addLabelIds ?? [], removeLabelIds: removeLabelIds ?? [] },
      });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.modifyEmail(messageId, addLabelIds, removeLabelIds);
      }
      throw error;
    }
  }

  async trashEmail(messageId: string): Promise<any> {
    try {
      const response = await this.gmail.users.messages.trash({ userId: 'me', id: messageId });
      return response.data;
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.trashEmail(messageId);
      }
      throw error;
    }
  }

  // ── Calendar Methods ───────────────────────────────────────────────────────

  async listCalendarEvents(
    timeMin?: string,
    timeMax?: string,
    maxResults: number = 20,
  ): Promise<any> {
    try {
      const now = new Date();
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin ?? now.toISOString(),
        timeMax: timeMax ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });
      const events = (response.data.items ?? []).map((e: any) => ({
        id: e.id,
        summary: e.summary ?? '(No title)',
        description: e.description ?? '',
        location: e.location ?? '',
        start: e.start?.dateTime ?? e.start?.date ?? '',
        end: e.end?.dateTime ?? e.end?.date ?? '',
        status: e.status,
        htmlLink: e.htmlLink,
        organizer: e.organizer?.email ?? '',
        attendees: (e.attendees ?? []).map((a: any) => a.email).slice(0, 10),
        meetLink: e.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri
          ?? e.hangoutLink ?? '',
      }));
      return { events };
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.listCalendarEvents(timeMin, timeMax, maxResults);
      }
      throw error;
    }
  }

  async createCalendarEvent(event: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
    addMeetLink?: boolean;
  }): Promise<any> {
    try {
      const requestBody: any = {
        summary: event.summary,
        start: { dateTime: event.start, timeZone: 'America/Chicago' },
        end: { dateTime: event.end, timeZone: 'America/Chicago' },
      };
      if (event.description) requestBody.description = event.description;
      if (event.location) requestBody.location = event.location;
      if (event.attendees?.length) {
        requestBody.attendees = event.attendees.map(email => ({ email }));
      }
      if (event.addMeetLink) {
        requestBody.conferenceData = {
          createRequest: { requestId: `melvin-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        };
      }

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody,
        conferenceDataVersion: event.addMeetLink ? 1 : 0,
      });
      const e = response.data;
      return {
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        htmlLink: e.htmlLink,
        meetLink: e.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri
          ?? e.hangoutLink ?? '',
      };
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.createCalendarEvent(event);
      }
      throw error;
    }
  }

  async updateCalendarEvent(eventId: string, updates: {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    attendees?: string[];
  }): Promise<any> {
    try {
      const requestBody: any = {};
      if (updates.summary) requestBody.summary = updates.summary;
      if (updates.start) requestBody.start = { dateTime: updates.start, timeZone: 'America/Chicago' };
      if (updates.end) requestBody.end = { dateTime: updates.end, timeZone: 'America/Chicago' };
      if (updates.description !== undefined) requestBody.description = updates.description;
      if (updates.location !== undefined) requestBody.location = updates.location;
      if (updates.attendees) requestBody.attendees = updates.attendees.map(email => ({ email }));

      const response = await this.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody,
      });
      const e = response.data;
      return {
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        htmlLink: e.htmlLink,
      };
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.updateCalendarEvent(eventId, updates);
      }
      throw error;
    }
  }

  async deleteCalendarEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({ calendarId: 'primary', eventId });
    } catch (error: any) {
      if (error.code === 401) {
        await this.refreshTokenIfNeeded();
        return this.deleteCalendarEvent(eventId);
      }
      throw error;
    }
  }
}
