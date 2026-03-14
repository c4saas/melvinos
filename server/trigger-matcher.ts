import type { TriggerRule } from '../shared/schema';

export interface TriggerMatch {
  rule: TriggerRule;
  matchedPhrase: string;
}

/**
 * Match a user message against configured trigger rules.
 * Returns the highest-priority matching rule, or null if no match.
 */
export function matchTriggerRules(
  userMessage: string,
  rules: TriggerRule[],
): TriggerMatch | null {
  const normalized = userMessage.toLowerCase().trim();
  if (!normalized) return null;

  // Sort by priority descending (higher priority wins)
  const sorted = [...rules]
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    for (const phrase of rule.phrases) {
      const normalizedPhrase = phrase.toLowerCase().trim();
      if (!normalizedPhrase) continue;

      if (rule.matchMode === 'exact') {
        if (normalized === normalizedPhrase) {
          return { rule, matchedPhrase: phrase };
        }
      } else {
        // 'contains' match
        if (normalized.includes(normalizedPhrase)) {
          return { rule, matchedPhrase: phrase };
        }
      }
    }
  }

  return null;
}

/**
 * Build the system hint message for a matched trigger rule.
 */
export function buildTriggerHint(match: TriggerMatch): string {
  if (match.rule.hintMessage) return match.rule.hintMessage;
  return `The user's request matches a configured trigger rule "${match.rule.name}". You MUST use the ${match.rule.routeTarget} tool to fulfill this request. Do not respond without using the tool.`;
}
