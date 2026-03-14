import type { Message } from '@shared/schema';

interface BasicMessage {
  role: Message['role'];
  content: Message['content'];
}

interface GenerateTitleOptions {
  fallbackTitle?: string;
  existingTitles?: string[];
}

const DEFAULT_FALLBACK_TITLE = 'New Conversation';

const TITLE_MAX_LENGTH = 80;
const SEGMENT_MAX_LENGTH = 48;
const SECONDARY_MAX_LENGTH = 60;
const MAX_WORDS_PER_SEGMENT = 8;

const SEPARATOR_PATTERN = /\s*[\u2013\u2014|:]\s*/; // en dash, em dash, pipe, colon

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

const sanitizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const trimPunctuation = (value: string): string => value.replace(/[\s.,;:!?_-]+$/u, '').trim();

const truncateAtWordBoundary = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace).trim();
  }

  return truncated;
};

const limitWords = (value: string, maxWords: number): string => {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return value;
  }
  return words.slice(0, maxWords).join(' ');
};

const titleize = (value: string): string =>
  value
    .split(' ')
    .map(word => {
      if (word.length === 0) {
        return word;
      }

      const upper = word.toUpperCase();
      if (word === upper) {
        return word;
      }

      if (word === word.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      if (/[A-Z]/.test(word.slice(1))) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

const cleanSegment = (segment: string, maxLength: number): string => {
  const whitespaceNormalized = sanitizeWhitespace(segment);
  const limitedWords = limitWords(whitespaceNormalized, MAX_WORDS_PER_SEGMENT);
  const truncated = truncateAtWordBoundary(limitedWords, maxLength);
  const trimmed = trimPunctuation(truncated);
  return titleize(trimmed);
};

const collectSegments = (content: string): string[] => {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const primaryLine = lines[0];
  const segments = primaryLine.split(SEPARATOR_PATTERN).map(part => part.trim()).filter(Boolean);

  if (segments.length >= 2) {
    return segments;
  }

  const sentences = primaryLine.split(SENTENCE_BOUNDARY).map(part => part.trim()).filter(Boolean);
  if (segments.length === 1 && sentences.length >= 2) {
    return [segments[0], sentences[1]];
  }

  if (segments.length === 1 && lines.length >= 2) {
    return [segments[0], lines[1]];
  }

  if (segments.length === 0 && sentences.length > 0) {
    return sentences;
  }

  if (segments.length === 0 && lines.length > 1) {
    return [primaryLine, lines[1]];
  }

  return segments;
};

const makeUniqueTitle = (baseTitle: string, existingTitles: Set<string>): string => {
  const normalizedBase = baseTitle.trim() || DEFAULT_FALLBACK_TITLE;
  let candidate = normalizedBase;
  let counter = 2;

  while (existingTitles.has(candidate.toLowerCase())) {
    candidate = `${normalizedBase} #${counter}`;
    counter += 1;
  }

  return candidate;
};

const extractUserMessages = (messages: BasicMessage[]): BasicMessage[] =>
  messages.filter(message => message.role === 'user' && typeof message.content === 'string' && message.content.trim().length > 0);

export const generateStructuredChatTitle = (
  messages: BasicMessage[],
  options: GenerateTitleOptions = {},
): string => {
  const fallbackTitle = options.fallbackTitle ?? DEFAULT_FALLBACK_TITLE;
  const existingTitles = new Set(
    (options.existingTitles ?? [])
      .map(title => sanitizeWhitespace(title).toLowerCase())
      .filter(Boolean),
  );

  const userMessages = extractUserMessages(messages);
  if (userMessages.length === 0) {
    return makeUniqueTitle(fallbackTitle, existingTitles);
  }

  const primarySegments = collectSegments(userMessages[0].content);
  let primary = primarySegments[0] ?? userMessages[0].content;
  let secondary: string | undefined = primarySegments[1];

  if (!secondary && userMessages.length > 1) {
    const secondarySegments = collectSegments(userMessages[1].content);
    secondary = secondarySegments[0];
  }

  primary = cleanSegment(primary, SEGMENT_MAX_LENGTH) || fallbackTitle;
  if (secondary) {
    secondary = cleanSegment(secondary, SECONDARY_MAX_LENGTH);
  }

  if (secondary && secondary.length === 0) {
    secondary = undefined;
  }

  if (secondary && secondary.toLowerCase() === primary.toLowerCase()) {
    secondary = undefined;
  }

  let baseTitle = secondary ? `${primary} | ${secondary}` : primary;
  baseTitle = truncateAtWordBoundary(baseTitle, TITLE_MAX_LENGTH);

  return makeUniqueTitle(baseTitle || fallbackTitle, existingTitles);
};

export type { GenerateTitleOptions };
