/**
 * Seed default platform skills and trigger rules on startup.
 * Only inserts skills/rules that don't already exist (by ID).
 */
import type { IStorage } from './storage';

interface SkillDef {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  isPlatformDefault: boolean;
  category: string;
  linkedTools?: string[];
  requiresIntegration?: string | null;
  instructions: string;
  icon?: string;
}

interface TriggerRule {
  id: string;
  name: string;
  enabled: boolean;
  phrases: string[];
  matchMode: 'exact' | 'contains';
  priority: number;
  routeType: 'skill' | 'tool';
  routeTarget: string;
  hintMessage?: string;
}

const DEFAULT_SKILLS: SkillDef[] = [
  // ── Workflow Trigger ──
  {
    id: 'skill-workflow-trigger',
    name: 'Workflow Trigger',
    description: 'Teaches Melvin how to manually trigger configured workflows on demand.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'productivity',
    linkedTools: ['schedule_task', 'list_scheduled_tasks'],
    instructions: `## Workflow Trigger
When the user asks to run, trigger, or execute a workflow (e.g. "run my morning brief", "trigger the daily routine"):
1. Use the list_scheduled_tasks tool to find matching cron jobs.
2. Identify the workflow by name match.
3. Confirm which workflow you are triggering and what it does.
4. The workflow will be executed automatically by the system.`,
  },

  // ── Anthropic Skill 1: Memory Protocol ──
  {
    id: 'skill-memory-protocol',
    name: 'Memory Protocol',
    description: 'Always search memory before responding to leverage prior context.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'memory',
    linkedTools: ['memory_search', 'memory_save'],
    instructions: `## Memory Protocol
Before responding to any request that could benefit from prior context:
1. Call memory_search with relevant keywords from the user's message.
2. If high-relevance memories (score >= 70) are returned, incorporate them naturally.
3. Do not mention "I checked my memory" -- just use the information seamlessly.
4. After completing important tasks, save durable insights (preferences, project context, recurring patterns) with score >= 70.
5. Never re-save information that already exists in memory.`,
  },

  // ── Anthropic Skill 3: Compaction Persistence ──
  {
    id: 'skill-compaction-persistence',
    name: 'Compaction Persistence',
    description: 'Save progress state to memory before stopping; never stop prematurely.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'productivity',
    instructions: `## Compaction Persistence
- If a multi-step task is getting long and you are approaching the circuit breaker limit, use memory_save to checkpoint your progress: what is done, what remains, and key intermediate results.
- NEVER voluntarily stop a task mid-chain and say "I've done steps 1-3, shall I continue?" -- persist through all steps.
- If you must stop (true blocker), save state with a clear "CHECKPOINT:" prefix so you can resume if asked.
- When the user says "continue" or "keep going", search memory for the most recent checkpoint first.`,
  },

  // ── Anthropic Skill 4: Think Before Acting ──
  {
    id: 'skill-think-protocol',
    name: 'Think Before Acting',
    description: 'Use the think tool to reason before complex decisions.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'productivity',
    linkedTools: ['think'],
    instructions: `## Think Before Acting
Before executing multi-step tasks, ambiguous requests, or decisions with significant consequences:
1. Use the think tool to plan your approach, identify risks, and sequence actions.
2. Think about what could go wrong and how to recover.
3. For tool chains with 3+ steps, always think first to map out the full plan.
4. DO NOT use think for simple, obvious requests (quick lookups, direct answers).
5. The think tool is for YOUR internal reasoning -- its output is not shown to the user.`,
  },

  // ── Anthropic Skill 10: Action vs Research Mode ──
  {
    id: 'skill-action-research-mode',
    name: 'Action vs Research Mode',
    description: 'Adapt behavior based on whether user needs action or research.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'productivity',
    instructions: `## Adaptive Mode Selection
Classify each request as ACTION or RESEARCH mode:

ACTION mode (do something): send email, schedule meeting, create file, run code, modify data.
- Execute immediately. Minimize explanation. Confirm completion with brief summary.
- Chain all required tool calls in a single turn.

RESEARCH mode (learn something): analyze, compare, explain, investigate, summarize.
- Be thorough. Cite sources. Use structured output (tables, lists).
- Use web_search for current data. Use deep_research for comprehensive analysis.
- Present findings with clear takeaways and actionable recommendations.

Default to ACTION mode when intent is ambiguous.`,
  },

  // ── Anthropic Skill 13: Hallucination Prevention ──
  {
    id: 'skill-hallucination-prevention',
    name: 'Hallucination Prevention',
    description: 'Ground responses in verified data; never fabricate.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'general',
    instructions: `## Hallucination Prevention
- NEVER fabricate tool outputs, API responses, email contents, or data.
- When quoting from a tool result, use the EXACT text returned -- do not paraphrase or embellish.
- If a tool returns an error or no data, say so plainly. Do not guess what the result "would have been."
- For factual claims about current events, markets, or specific data: verify via web_search before stating.
- When uncertain about a fact, say "I'm not certain" rather than guessing.
- Distinguish clearly between "this is what the data shows" and "this is my recommendation."`,
  },

  // ── Anthropic Skill 14: Reflect-Abstract-Generalize ──
  {
    id: 'skill-reflect-abstract-generalize',
    name: 'Self-Improvement Loop',
    description: 'After complex tasks, reflect and save reusable patterns.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'memory',
    linkedTools: ['memory_save'],
    instructions: `## Reflect-Abstract-Generalize
After completing a complex, multi-step task:
1. REFLECT: What worked well? What was harder than expected? Were there errors or retries?
2. ABSTRACT: What general principle or pattern does this represent?
3. GENERALIZE: If this pattern would be useful in future similar tasks, save it to memory with score >= 80.
- Examples: "When searching GHL, always include locationId" or "User prefers executive summary format for research reports."
- Only save genuinely reusable insights, not task-specific details.`,
  },

  // ── Anthropic Skill 15: Pre-Response Verification ──
  {
    id: 'skill-pre-response-verification',
    name: 'Pre-Response Verification',
    description: 'Verify response completeness before delivering.',
    type: 'prompt-injection',
    enabled: true,
    isPlatformDefault: true,
    category: 'general',
    instructions: `## Pre-Response Verification
Before finalizing your response, mentally verify:
1. Does this DIRECTLY answer what the user asked? (Not adjacent information)
2. If I used tools, are all results accurately reflected? (No fabrication)
3. Are there any steps I planned but did not execute? (Complete the chain)
4. If an output template is active, does my response match ALL required sections?
5. If the user asked for action (send, create, schedule), did I actually DO it? (Not just explain how)
If any check fails, fix it before responding.`,
  },
];

const DEFAULT_TRIGGER_RULES: TriggerRule[] = [
  {
    id: 'trigger-workflow-run',
    name: 'Workflow Trigger',
    enabled: true,
    phrases: [
      'morning brief',
      'daily routine',
      'run workflow',
      'trigger workflow',
      'execute workflow',
      'start workflow',
      'morning report',
    ],
    matchMode: 'contains',
    priority: 75,
    routeType: 'skill',
    routeTarget: 'skill-workflow-trigger',
  },
];

export async function seedDefaultSkills(storage: IStorage): Promise<void> {
  try {
    const settings = await storage.getPlatformSettings();
    const data = settings.data as Record<string, any>;

    // Get first user for changed_by FK constraint
    const users = await storage.listUsers();
    const userId = users[0]?.id ?? null;

    const existingSkills: SkillDef[] = Array.isArray(data.skills) ? data.skills : [];
    const existingRules: TriggerRule[] = Array.isArray(data.triggerRules) ? data.triggerRules : [];

    const existingSkillIds = new Set(existingSkills.map(s => s.id));
    const existingRuleIds = new Set(existingRules.map(r => r.id));

    const newSkills = DEFAULT_SKILLS.filter(s => !existingSkillIds.has(s.id));
    const newRules = DEFAULT_TRIGGER_RULES.filter(r => !existingRuleIds.has(r.id));

    if (newSkills.length === 0 && newRules.length === 0) {
      return; // nothing to seed
    }

    const updatedData = {
      ...data,
      skills: [...existingSkills, ...newSkills],
      triggerRules: [...existingRules, ...newRules],
    };

    await storage.upsertPlatformSettings(updatedData, userId ?? undefined);
    console.log(`[seed] Inserted ${newSkills.length} skills and ${newRules.length} trigger rules`);
  } catch (err) {
    console.error('[seed] Failed to seed default skills:', err);
  }
}
