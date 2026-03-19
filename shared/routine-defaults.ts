/**
 * Shared default routine data structure.
 * Used by both server/routes.ts and server/routine-populator.ts
 */

export const DEFAULT_BLOCKS = [
  { key: 'morning_brief', name: 'Morning Brief Review', time: '7:15-9:00 AM', checked: false, checkedAt: null },
  { key: 'deep_work_1', name: 'Deep Work Block 1', time: '9:00-11:30 AM', checked: false, checkedAt: null },
  { key: 'midday_check', name: 'Midday Check', time: '11:30 AM-12:30 PM', checked: false, checkedAt: null },
  { key: 'deep_work_2', name: 'Deep Work Block 2', time: '12:30-3:30 PM', checked: false, checkedAt: null },
  { key: 'shutdown', name: 'Shutdown Ritual', time: '3:30-4:00 PM', checked: false, checkedAt: null },
] as const;

export const DEFAULT_CHECKLIST = [
  { key: 'brief_reviewed', label: 'Morning Brief reviewed', checked: false },
  { key: 'dw1_completed', label: 'Deep Work Block 1 completed', checked: false },
  { key: 'midday_completed', label: 'Midday Check completed', checked: false },
  { key: 'dw2_completed', label: 'Deep Work Block 2 completed', checked: false },
  { key: 'shutdown_completed', label: 'Shutdown Ritual completed', checked: false },
  { key: 'scoreboard_validated', label: 'Scoreboard metrics validated', checked: false },
  { key: 'blockers_escalated', label: 'Blockers escalated (if any)', checked: false },
  { key: 'tomorrow_reviewed', label: 'Tomorrow preview reviewed', checked: false },
] as const;

export const DEFAULT_SCOREBOARD = {
  deepWorkHours: { actual: null, target: 2.5, validated: false },
  leadsTouched: { actual: null, target: 10, validated: false },
  dealsMoved: { actual: null, target: 2, validated: false },
  deliverablesShipped: { actual: null, target: 1, validated: false },
  inboxZero: { actual: null, target: true, validated: false },
  blockersEscalated: { actual: null, target: 0, validated: false },
} as const;

export function buildDefaultRoutineData() {
  return {
    context: {
      meetings: [] as { time: string; title: string; attendees?: string[] }[],
      criticalEmails: [] as { from: string; subject: string; receivedAt?: string }[],
      pipelineMovements: [] as { contact: string; deal: string; stage: string; daysSinceMove?: number }[],
      ghlTasks: [] as { title: string; dueDate: string; contact: string; status: string; subAccount: string }[],
      systemStatus: { healthy: true, issues: [] as string[] },
      carryForward: [] as { item: string; fromDate: string }[],
    },
    blocks: DEFAULT_BLOCKS.map(b => ({ ...b })),
    scoreboard: JSON.parse(JSON.stringify(DEFAULT_SCOREBOARD)),
    actionQueue: [] as Record<string, unknown>[],
    escalations: [] as Record<string, unknown>[],
    nonNegotiables: DEFAULT_CHECKLIST.map(n => ({ ...n })),
    notes: '',
  };
}
