import { describe, expect, it } from 'vitest';

import { generateStructuredChatTitle } from '../server/conversation-title';

describe('generateStructuredChatTitle', () => {
  it('creates structured title from dash-separated prompt', () => {
    const title = generateStructuredChatTitle([
      { role: 'user', content: 'DYS Construction – Knowledge Base\nOverview of services' },
    ]);

    expect(title).toBe('DYS Construction | Knowledge Base');
  });

  it('uses second user prompt when additional structure missing', () => {
    const title = generateStructuredChatTitle([
      { role: 'user', content: 'Help me plan marketing' },
      { role: 'user', content: 'Focus on social media strategy for Q4 campaigns' },
    ]);

    expect(title).toBe('Help Me Plan Marketing | Focus On Social Media Strategy For Q4 Campaigns');
  });

  it('ensures uniqueness by appending counter', () => {
    const title = generateStructuredChatTitle([
      { role: 'user', content: 'Weekly Report Summary' },
    ], {
      existingTitles: ['Weekly Report Summary'],
    });

    expect(title).toBe('Weekly Report Summary #2');
  });

  it('falls back gracefully when no user messages exist', () => {
    const title = generateStructuredChatTitle([
      { role: 'assistant', content: 'Hello! How can I help you today?' },
    ], {
      fallbackTitle: 'New Conversation',
    });

    expect(title).toBe('New Conversation');
  });
});
