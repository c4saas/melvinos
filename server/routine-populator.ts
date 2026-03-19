/**
 * Daily Routine Populator
 *
 * Creates/refreshes today's routine entry:
 * 1. Pulls carry-forward from yesterday's unchecked items
 * 2. Preserves strategic notes and manual items across refreshes
 * 3. Spawns agent task to populate live data (Calendar, Gmail, GHL, system health)
 */

import type { IStorage } from './storage';
import type { DailyRoutineEntry } from '@shared/schema';
import { buildDefaultRoutineData } from '@shared/routine-defaults';
import { randomUUID } from 'crypto';

/**
 * Pull carry-forward items from yesterday's unfinished work.
 */
async function getCarryForward(storage: IStorage, userId: string): Promise<{ item: string; fromDate: string }[]> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const yesterdayEntry = await storage.getRoutineEntry(userId, yesterdayStr);
  if (!yesterdayEntry) return [];

  const yd = yesterdayEntry.data as Record<string, any>;
  const items: { item: string; fromDate: string }[] = [];

  // Unresolved action items
  const actions = Array.isArray(yd.actionQueue) ? yd.actionQueue : [];
  for (const a of actions) {
    if (!a.resolved) {
      items.push({ item: `${a.item}: ${a.detail}`, fromDate: yesterdayStr });
    }
  }

  // Unchecked execution blocks
  const blocks = Array.isArray(yd.blocks) ? yd.blocks : [];
  for (const b of blocks) {
    if (!b.checked) {
      items.push({ item: `Missed block: ${b.name} (${b.time})`, fromDate: yesterdayStr });
    }
  }

  // Existing carry-forward items that were never resolved (cascading carry-forward, max 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().split('T')[0];

  const prevCarry = yd.context?.carryForward ?? [];
  for (const cf of prevCarry) {
    if (cf.item && (!cf.fromDate || cf.fromDate >= cutoff)) {
      items.push({ item: cf.item, fromDate: cf.fromDate ?? yesterdayStr });
    }
  }

  return items;
}

/**
 * Load knowledge items tagged for routine context (strategic plans, priorities).
 */
async function getKnowledgeContext(storage: IStorage, userId: string): Promise<string> {
  try {
    const items = await storage.getKnowledgeItems(userId);
    const routineItems = items.filter((k: any) =>
      k.title?.toLowerCase().includes('strategic') ||
      k.title?.toLowerCase().includes('priority') ||
      k.title?.toLowerCase().includes('routine') ||
      k.title?.toLowerCase().includes('goal') ||
      (k.metadata as any)?.routineContext === true
    );
    if (routineItems.length === 0) return '';
    return '\n\nStrategic context from Knowledge Base:\n' +
      routineItems.map((k: any) => `- **${k.title}**: ${(k.content || '').slice(0, 500)}`).join('\n');
  } catch {
    return '';
  }
}

/**
 * Creates/refreshes today's routine entry.
 * Spawns an agent task that uses tools (calendar, gmail, GHL tasks, etc.) to populate live data.
 */
export async function populateRoutine(storage: IStorage, userId: string): Promise<DailyRoutineEntry> {
  const today = new Date().toISOString().split('T')[0];
  const todayFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Preserve existing state if entry already exists
  const existing = await storage.getRoutineEntry(userId, today);
  const existingData = existing?.data as Record<string, any> | undefined;

  // Pull carry-forward from yesterday
  const carryForward = await getCarryForward(storage, userId);

  // Pull strategic context from knowledge base
  const knowledgeContext = await getKnowledgeContext(storage, userId);

  // Preserve manual items (user-created action items, notes) across refreshes
  const existingManualActions = existingData?.actionQueue?.filter((a: any) => a.source === 'manual') ?? [];
  const existingNotes = existingData?.notes ?? '';

  // Build the structure from shared defaults
  const defaults = buildDefaultRoutineData();
  const data: Record<string, unknown> = {
    ...defaults,
    context: { ...defaults.context, carryForward },
    blocks: existingData?.blocks ?? defaults.blocks,
    scoreboard: existingData?.scoreboard ?? defaults.scoreboard,
    actionQueue: existingManualActions,
    nonNegotiables: existingData?.nonNegotiables ?? defaults.nonNegotiables,
    notes: existingNotes,
  };

  // Save skeleton immediately
  const entry = await storage.upsertRoutineEntry(userId, today, data);

  // Build carry-forward context for the prompt
  const carryForwardText = carryForward.length > 0
    ? `\n\nYesterday's carry-forward (include in carryForward and actionQueue):\n${carryForward.map(c => `- ${c.item} (from ${c.fromDate})`).join('\n')}`
    : '';

  // Spawn agent task to populate live data
  const prompt = `You are populating Austin's Daily Success Routine for ${todayFormatted}.

Use your tools to gather live data, then respond with a JSON object. No markdown, no explanation - ONLY the JSON.

Required JSON structure:
{
  "context": {
    "meetings": [{"time": "HH:MM AM/PM", "title": "meeting title", "attendees": ["name1"]}],
    "criticalEmails": [{"from": "sender", "subject": "subject", "receivedAt": "time"}],
    "pipelineMovements": [{"contact": "name", "deal": "deal name", "stage": "stage", "daysSinceMove": N}],
    "ghlTasks": [{"title": "task", "dueDate": "date", "contact": "name", "status": "status", "subAccount": "account name"}],
    "systemStatus": {"healthy": true, "issues": []},
    "carryForward": ${JSON.stringify(carryForward)}
  },
  "actionQueue": [{"id": "unique-id", "item": "title", "detail": "description", "type": "tactical|strategic|operational", "priority": "critical|high|medium|low", "resolved": false, "source": "auto"}],
  "escalations": [{"trigger": "name", "condition": "description", "active": true, "resolvedAt": null}]
}

Research steps (use each tool):
1. calendar_events - Get today's meetings with time, title, attendees.
2. gmail_search query "is:unread newer_than:1d" - Find unread emails. Flag client/vendor/team emails as critical.
3. For each connected HighLevel account, search for tasks assigned to Austin that are due today or overdue.
4. Check for pipeline opportunities that have been stalled >7 days.
5. Build actionQueue from: meetings needing prep, emails needing response, GHL tasks due, pipeline follow-ups.
6. Set escalations for: meetings <30 min away, critical emails unread >4h, deals stalled >7 days, overdue GHL tasks.
${carryForwardText}${knowledgeContext}

CRITICAL: Each actionQueue item MUST have a unique "id" field and "source": "auto". Return ONLY valid JSON.`;

  try {
    await storage.createAgentTask({
      type: 'agent_autonomous',
      title: `[Daily Routine] Populate ${todayFormatted}`,
      status: 'pending',
      input: {
        prompt,
        userId,
        routineDate: today,
        routineEntryId: entry.id,
      },
      conversationId: null,
    });
    console.log(`[routine-populator] Agent task created for ${today} (${carryForward.length} carry-forward items)`);
  } catch (err) {
    console.error('[routine-populator] Failed to create agent task:', err);
  }

  return entry;
}
