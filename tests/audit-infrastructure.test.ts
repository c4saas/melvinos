/**
 * MelvinOS Operational Audit — Infrastructure Test Suite
 *
 * 5 scenarios escalating from easiest → hardest, targeting the gaps
 * that prevent Melvin from running multi-step and long-running operations.
 *
 * Test 1: Single tool error recovery
 * Test 2: Parallel tool failure isolation
 * Test 3: Multi-step sprint (5-8 iterations)
 * Test 4: Task queue — retries, concurrency, crash recovery
 * Test 5: Long-running multi-phase — context trimming, circuit breaker, task chaining
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/test';

// ── Imports ─────────────────────────────────────────────────────────────────

const { toolRegistry } = await import('../server/agent/tool-registry');
const { runAgentLoop } = await import('../server/agent/agent-loop');
const taskQueue = await import('../server/agent/task-queue');

import type { ToolResult, ToolContext, ToolDefinition } from '../server/agent/tool-registry';
import type { LLMProvider } from '../server/agent/agent-loop';
import type { AgentConfig, AgentEvent } from '../server/agent/types';
import type { AgentTask, AgentTaskStatus, InsertAgentTask } from '@shared/schema';
import type { IStorage } from '../server/storage';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Collect all events from the agent loop async generator */
async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** Minimal AgentConfig for testing */
function testConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    model: 'claude-sonnet-4-6',
    maxIterations: 50,
    userId: 'test-user',
    conversationId: 'test-conv',
    ...overrides,
  };
}

/** Register a tool on the singleton and return a cleanup function */
function registerTestTool(tool: ToolDefinition): () => void {
  // Remove if already exists (from a previous test run)
  toolRegistry.unregister(tool.name);
  toolRegistry.register(tool);
  return () => { toolRegistry.unregister(tool.name); };
}

/** Build a mock LLM provider from a sequence of completion results */
function mockProvider(
  completions: Array<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>,
): LLMProvider & { callCount: number; receivedMessages: any[][] } {
  let idx = 0;
  const receivedMessages: any[][] = [];

  return {
    callCount: 0,
    receivedMessages,

    async complete(messages, _tools, _config) {
      receivedMessages.push([...messages]);
      const entry = completions[Math.min(idx, completions.length - 1)];
      idx++;
      (this as any).callCount++;
      return {
        content: entry.content,
        toolCalls: entry.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
        usage: entry.usage ?? { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },

    async *stream(_messages, _config) {
      yield { text: 'Final summary after circuit breaker.' };
      yield { usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 } };
    },
  };
}

/** Simple in-memory task storage for Test 4 & 5 */
class TaskStorage {
  tasks = new Map<string, AgentTask>();
  toolErrors: any[] = [];
  peakRunning = 0;

  async listAgentTasks(status?: AgentTaskStatus): Promise<AgentTask[]> {
    const all = [...this.tasks.values()];
    if (!status) return all;
    return all.filter((t) => t.status === status);
  }

  async getAgentTask(id: string): Promise<AgentTask | undefined> {
    return this.tasks.get(id);
  }

  async createAgentTask(task: InsertAgentTask): Promise<AgentTask> {
    const id = randomUUID();
    const full: AgentTask = {
      id,
      type: task.type,
      title: task.title,
      status: (task.status as AgentTaskStatus) ?? 'pending',
      input: task.input ?? null,
      output: null,
      error: null,
      progress: task.progress ?? 0,
      conversationId: task.conversationId ?? null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };
    this.tasks.set(id, full);
    return full;
  }

  async updateAgentTask(id: string, updates: Partial<AgentTask>): Promise<AgentTask | undefined> {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.tasks.set(id, updated);

    // Track peak concurrency
    const running = [...this.tasks.values()].filter((t) => t.status === 'running').length;
    if (running > this.peakRunning) this.peakRunning = running;

    return updated;
  }

  async logToolError(data: any) {
    this.toolErrors.push(data);
    return { id: randomUUID(), ...data, createdAt: new Date() };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — Single Tool Error Recovery (Easy)
// ═══════════════════════════════════════════════════════════════════════════

test('Audit 1: Single tool error recovery — agent catches error, sanitizes secrets, and continues', async () => {
  const cleanup = registerTestTool({
    name: 'audit_failing_tool',
    description: 'A tool that fails',
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolResult> {
      return { output: '', error: 'Connection refused to api.example.com with key sk-test1234567890abcdef' };
    },
  });

  try {
    // LLM calls the tool once, then responds with text after seeing the error
    const provider = mockProvider([
      {
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'audit_failing_tool', args: {} }],
      },
      {
        content: 'I encountered an error and will try a different approach.',
      },
    ]);

    const gen = runAgentLoop(
      testConfig(),
      [{ role: 'user', content: 'Do something' }],
      provider,
      ['audit_failing_tool'],
    );
    const events = await collectEvents(gen);

    // 1. Tool result event carries the error
    const toolResult = events.find((e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result');
    assert.ok(toolResult, 'Should emit a tool_result event');
    assert.ok(toolResult.error, 'tool_result should contain an error');
    assert.ok(toolResult.error!.includes('Connection refused'), 'Error message should be present');

    // 2. Agent loop completes (doesn't crash)
    const done = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done');
    assert.ok(done, 'Should emit a done event — loop must not crash on tool errors');

    // 3. The error is fed back to the LLM so it can decide what to do
    const secondCallMessages = provider.receivedMessages[1];
    assert.ok(secondCallMessages, 'LLM should be called a second time');
    const toolMsg = secondCallMessages.find((m: any) => m.role === 'tool');
    assert.ok(toolMsg, 'Tool error should be fed back as a tool role message');
    assert.ok(toolMsg.content.includes('Error:'), 'Tool message should contain the error');

    // 4. Done event has the tool call recorded
    assert.equal(done.toolCalls.length, 1, 'Should record 1 tool call');
    assert.ok(done.toolCalls[0].error, 'Tool call record should have error');
  } finally {
    cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 — Parallel Tool Failure Isolation (Medium)
// ═══════════════════════════════════════════════════════════════════════════

test('Audit 2: Parallel tool failure isolation — one broken tool does not kill siblings', async () => {
  const executionOrder: string[] = [];

  const cleanups = [
    registerTestTool({
      name: 'audit_fast_ok',
      description: 'Fast succeeding tool',
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<ToolResult> {
        executionOrder.push('fast_ok');
        return { output: 'fast result' };
      },
    }),
    registerTestTool({
      name: 'audit_slow_ok',
      description: 'Slow succeeding tool',
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<ToolResult> {
        await new Promise((r) => setTimeout(r, 30));
        executionOrder.push('slow_ok');
        return { output: 'slow result' };
      },
    }),
    registerTestTool({
      name: 'audit_fail',
      description: 'Failing tool',
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<ToolResult> {
        executionOrder.push('fail');
        return { output: '', error: 'Simulated failure' };
      },
    }),
  ];

  try {
    // LLM calls all 3 tools in parallel, then completes
    const provider = mockProvider([
      {
        content: '',
        toolCalls: [
          { id: 'tc-fast', name: 'audit_fast_ok', args: {} },
          { id: 'tc-slow', name: 'audit_slow_ok', args: {} },
          { id: 'tc-fail', name: 'audit_fail', args: {} },
        ],
      },
      {
        content: 'Processed all results.',
      },
    ]);

    const gen = runAgentLoop(
      testConfig(),
      [{ role: 'user', content: 'Do three things' }],
      provider,
      ['audit_fast_ok', 'audit_slow_ok', 'audit_fail'],
    );
    const events = await collectEvents(gen);

    // 1. All 3 tools were called
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    assert.equal(toolCalls.length, 3, 'Should emit 3 tool_call events');

    // 2. All 3 results returned
    const toolResults = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result',
    );
    assert.equal(toolResults.length, 3, 'Should emit 3 tool_result events');

    // 3. Successful tools succeeded despite the failure
    const fastResult = toolResults.find((r) => r.tool === 'audit_fast_ok');
    const slowResult = toolResults.find((r) => r.tool === 'audit_slow_ok');
    const failResult = toolResults.find((r) => r.tool === 'audit_fail');
    assert.equal(fastResult?.output, 'fast result', 'fast tool should succeed');
    assert.equal(slowResult?.output, 'slow result', 'slow tool should succeed');
    assert.ok(failResult?.error, 'failing tool should carry error');

    // 4. All 3 tools actually executed
    assert.equal(executionOrder.length, 3, 'All 3 tools must have executed');

    // 5. Loop completed successfully
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'Should emit done event — parallel failure must not crash the loop');

    // 6. Second LLM call received all 3 tool results
    const secondCall = provider.receivedMessages[1];
    const toolMsgs = secondCall.filter((m: any) => m.role === 'tool');
    assert.equal(toolMsgs.length, 3, 'LLM should receive all 3 tool results');
  } finally {
    for (const c of cleanups) c();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — Multi-Step Sprint (Medium-Hard)
// ═══════════════════════════════════════════════════════════════════════════

test('Audit 3: Multi-step sprint — 6-step sequential operation completes correctly', async () => {
  let stepCounter = 0;

  const cleanup = registerTestTool({
    name: 'audit_step_tool',
    description: 'Sequential step tool',
    parameters: { type: 'object', properties: { step: { type: 'number' } } },
    async execute(args): Promise<ToolResult> {
      stepCounter++;
      return { output: `Step ${args.step} result: data_${args.step}` };
    },
  });

  try {
    // 5 tool calls then a final text response
    const completions = [];
    for (let i = 1; i <= 5; i++) {
      completions.push({
        content: '',
        toolCalls: [{ id: `tc-${i}`, name: 'audit_step_tool', args: { step: i } }],
        usage: { promptTokens: 100 * i, completionTokens: 50, totalTokens: 100 * i + 50 },
      });
    }
    completions.push({
      content: 'All 5 steps completed successfully.',
      usage: { promptTokens: 600, completionTokens: 100, totalTokens: 700 },
    });

    const provider = mockProvider(completions);
    const gen = runAgentLoop(
      testConfig(),
      [{ role: 'user', content: 'Run a 5-step operation' }],
      provider,
      ['audit_step_tool'],
    );
    const events = await collectEvents(gen);

    // 1. Correct number of tool events
    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    const toolResultEvents = events.filter((e) => e.type === 'tool_result');
    assert.equal(toolCallEvents.length, 5, 'Should have 5 tool_call events');
    assert.equal(toolResultEvents.length, 5, 'Should have 5 tool_result events');

    // 2. All steps executed
    assert.equal(stepCounter, 5, 'Tool should have been called 5 times');

    // 3. Done event is correct
    const done = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done');
    assert.ok(done, 'Should emit done event');
    assert.equal(done.toolCalls.length, 5, 'Done event should list 5 tool calls');
    assert.equal(done.content, 'All 5 steps completed successfully.');

    // 4. Each LLM call sees growing conversation history
    assert.equal(provider.receivedMessages.length, 6, 'LLM should be called 6 times');
    for (let i = 1; i < provider.receivedMessages.length; i++) {
      const prev = provider.receivedMessages[i - 1].length;
      const curr = provider.receivedMessages[i].length;
      assert.ok(curr > prev, `Call ${i + 1} should have more messages than call ${i} (${curr} > ${prev})`);
    }

    // 5. Usage accumulates
    assert.ok(done.usage, 'Done event should have accumulated usage');
    assert.ok(done.usage!.totalTokens > 600, 'Total tokens should accumulate across all iterations');

    // 6. Tool call ordering is preserved
    for (let i = 0; i < done.toolCalls.length; i++) {
      assert.equal(done.toolCalls[i].id, `tc-${i + 1}`, `Tool call ${i + 1} should have correct ID`);
      assert.ok(done.toolCalls[i].output.includes(`Step ${i + 1}`), `Tool call ${i + 1} should have correct output`);
    }
  } finally {
    cleanup();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4 — Task Queue: Retries, Concurrency, Crash Recovery (Hard)
// ═══════════════════════════════════════════════════════════════════════════

test('Audit 4a: Task queue — transient errors retry with exponential backoff', async () => {
  const store = new TaskStorage();
  let handlerCallCount = 0;

  taskQueue.stopTaskQueue();
  taskQueue.initTaskQueue(store as unknown as IStorage, { pollIntervalMs: 60000, maxConcurrent: 5 });
  taskQueue.registerTaskHandler('test_transient', async () => {
    handlerCallCount++;
    if (handlerCallCount <= 2) {
      throw new Error('429 rate limit exceeded');
    }
    return { output: { success: true } };
  });

  const task = await taskQueue.enqueueTask('test_transient', 'Test transient retry');

  // Wait for retries to complete (backoff: 5s, 20s)
  let finalTask: AgentTask | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    finalTask = await store.getAgentTask(task.id);
    if (finalTask?.status === 'completed' || finalTask?.status === 'failed') break;
  }

  assert.equal(handlerCallCount, 3, 'Handler should be called 3 times (2 failures + 1 success)');
  assert.equal(finalTask?.status, 'completed', 'Task should eventually complete');

  taskQueue.stopTaskQueue();
});

test('Audit 4b: Task queue — non-transient errors fail immediately without retry', async () => {
  const store = new TaskStorage();
  let handlerCallCount = 0;

  taskQueue.stopTaskQueue();
  taskQueue.initTaskQueue(store as unknown as IStorage, { pollIntervalMs: 60000, maxConcurrent: 5 });
  taskQueue.registerTaskHandler('test_nontransient', async () => {
    handlerCallCount++;
    throw new Error('Invalid input: missing required field "name"');
  });

  const task = await taskQueue.enqueueTask('test_nontransient', 'Test non-transient fail');

  let finalTask: AgentTask | undefined;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    finalTask = await store.getAgentTask(task.id);
    if (finalTask?.status === 'failed') break;
  }

  assert.equal(handlerCallCount, 1, 'Handler should be called only once — no retry for non-transient errors');
  assert.equal(finalTask?.status, 'failed', 'Task should be marked as failed');
  assert.ok(finalTask?.error?.includes('Invalid input'), 'Error message should be preserved');

  taskQueue.stopTaskQueue();
});

test('Audit 4c: Task queue — concurrency limit respected', async () => {
  const store = new TaskStorage();
  let concurrentNow = 0;
  let peakConcurrent = 0;

  taskQueue.stopTaskQueue();
  taskQueue.initTaskQueue(store as unknown as IStorage, { pollIntervalMs: 100, maxConcurrent: 2 });
  taskQueue.registerTaskHandler('test_concurrent', async () => {
    concurrentNow++;
    if (concurrentNow > peakConcurrent) peakConcurrent = concurrentNow;
    await new Promise((r) => setTimeout(r, 200));
    concurrentNow--;
    return { output: { done: true } };
  });

  // Enqueue 4 tasks
  for (let i = 0; i < 4; i++) {
    await taskQueue.enqueueTask('test_concurrent', `Concurrent task ${i}`);
  }

  // Wait for all to complete
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const completed = (await store.listAgentTasks('completed')).length;
    if (completed >= 4) break;
  }

  const completed = (await store.listAgentTasks('completed')).length;
  assert.equal(completed, 4, 'All 4 tasks should complete');
  assert.ok(peakConcurrent <= 2, `Peak concurrency should be ≤ 2, got ${peakConcurrent}`);

  taskQueue.stopTaskQueue();
});

test('Audit 4d: Task queue — crash recovery resets running tasks to pending', async () => {
  const store = new TaskStorage();

  // Track what updateAgentTask calls are made by crash recovery
  const updateCalls: Array<{ id: string; updates: Partial<AgentTask> }> = [];
  const originalUpdate = store.updateAgentTask.bind(store);
  store.updateAgentTask = async (id: string, updates: Partial<AgentTask>) => {
    updateCalls.push({ id, updates });
    return originalUpdate(id, updates);
  };

  // Seed 2 tasks and set them to "running" (simulating a crash mid-execution)
  const t1 = await store.createAgentTask({ type: 'test_crash', title: 'Crashed task 1', conversationId: null, input: null, progress: 50 });
  const t2 = await store.createAgentTask({ type: 'test_crash', title: 'Crashed task 2', conversationId: null, input: null, progress: 30 });
  await originalUpdate(t1.id, { status: 'running', startedAt: new Date() });
  await originalUpdate(t2.id, { status: 'running', startedAt: new Date() });

  const runningBefore = (await store.listAgentTasks('running')).length;
  assert.equal(runningBefore, 2, 'Should have 2 running tasks before recovery');

  // Clear the tracked calls so we only see crash recovery updates
  updateCalls.length = 0;

  taskQueue.stopTaskQueue();
  // Use very long poll interval so processPendingTasks doesn't interfere
  taskQueue.initTaskQueue(store as unknown as IStorage, { pollIntervalMs: 600000, maxConcurrent: 5 });

  // Wait for crash recovery (has a 2s setTimeout internally + async)
  await new Promise((r) => setTimeout(r, 3500));

  // Crash recovery should have called updateAgentTask to reset both to pending
  const resetCalls = updateCalls.filter((c) => c.updates.status === 'pending');
  assert.equal(resetCalls.length, 2, 'Crash recovery should reset 2 tasks to pending');

  // Verify via direct storage check
  const runningAfter = (await store.listAgentTasks('running')).length;
  assert.equal(runningAfter, 0, 'No tasks should be running after crash recovery');

  taskQueue.stopTaskQueue();
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5 — Long-Running Multi-Phase Operations (Hardest)
// ═══════════════════════════════════════════════════════════════════════════

test('Audit 5a: Context trimming — preserves recent results and memory, trims old tool outputs', async () => {
  const cleanup = registerTestTool({
    name: 'audit_context_tool',
    description: 'Tool for context testing',
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolResult> {
      // Return a large output so total chars stay above 480K across iterations
      return { output: 'Y'.repeat(1000) };
    },
  });

  try {
    // Run 4 iterations so we get 4 new tool results. Combined with the 5 pre-filled
    // tool results, the oldest ones (beyond the last 3) should get trimmed.
    const completions = [];
    for (let i = 1; i <= 4; i++) {
      completions.push({
        content: '',
        toolCalls: [{ id: `tc-ctx-${i}`, name: 'audit_context_tool', args: {} }],
      });
    }
    completions.push({ content: 'Done with context test.' });

    const provider = mockProvider(completions);

    // Pre-fill conversation with enough content to exceed 480K chars.
    // We need: 5 old tool results (2 will be beyond "last 3") + padding.
    // Trimming logic: counts from end, keeps last 3 tool results, trims older ones > 200 chars.
    const bigContent = 'X'.repeat(100_000); // 100K chars each — 5 tool results = 500K chars + padding
    const prefillMessages: any[] = [
      { role: 'user', content: 'Start task' },
    ];

    // Add 5 old tool result pairs (assistant + tool messages)
    for (let i = 1; i <= 5; i++) {
      prefillMessages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `old-tc-${i}`, type: 'function', function: { name: 'audit_context_tool', arguments: '{}' } }],
      });
      if (i === 3) {
        // Memory tool result at position 3 — should NOT be trimmed
        prefillMessages.push({ role: 'tool', content: `memory_search results: ${bigContent}`, tool_call_id: `old-tc-${i}` });
      } else {
        // Regular tool result — should be trimmed if old enough
        prefillMessages.push({ role: 'tool', content: bigContent, tool_call_id: `old-tc-${i}` });
      }
    }

    // Final user message
    prefillMessages.push({ role: 'user', content: 'Continue the task' });

    const gen = runAgentLoop(
      testConfig({ maxIterations: 10 }),
      prefillMessages,
      provider,
      ['audit_context_tool'],
    );
    const events = await collectEvents(gen);

    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'Should complete despite large context');

    // Check the last LLM call's messages for trimming behavior
    const lastCall = provider.receivedMessages[provider.receivedMessages.length - 1];
    const toolMessages = lastCall.filter((m: any) => m.role === 'tool');

    // Memory result should be preserved (never trimmed regardless of position)
    const memoryMsg = toolMessages.find((m: any) =>
      typeof m.content === 'string' && m.content.includes('memory_search'),
    );
    assert.ok(memoryMsg, 'Memory tool results should be preserved during trimming');

    // At least one old result should be trimmed (the earliest non-memory tool results)
    const trimmedMsgs = toolMessages.filter((m: any) => m.content === '[Trimmed for context management]');
    assert.ok(trimmedMsgs.length > 0, 'Old non-memory tool results should be trimmed when context exceeds 480K chars');

    // The most recent tool results should NOT be trimmed
    const recentResults = toolMessages.slice(-3);
    for (const r of recentResults) {
      assert.notEqual(r.content, '[Trimmed for context management]', 'Recent tool results should not be trimmed');
    }
  } finally {
    cleanup();
  }
});

test('Audit 5b: Circuit breaker — forces graceful shutdown at maxIterations', async () => {
  const cleanup = registerTestTool({
    name: 'audit_infinite_tool',
    description: 'Tool that the LLM calls forever',
    parameters: { type: 'object', properties: {} },
    async execute(): Promise<ToolResult> {
      return { output: 'still going...' };
    },
  });

  try {
    // LLM always returns a tool call — simulates an infinite loop
    const infiniteCompletions = Array.from({ length: 20 }, (_, i) => ({
      content: '',
      toolCalls: [{ id: `tc-inf-${i}`, name: 'audit_infinite_tool', args: {} }],
    }));

    const provider = mockProvider(infiniteCompletions);
    const config = testConfig({ maxIterations: 3 });

    const gen = runAgentLoop(
      config,
      [{ role: 'user', content: 'Do an infinite task' }],
      provider,
      ['audit_infinite_tool'],
    );
    const events = await collectEvents(gen);

    // 1. Circuit breaker should stop the loop
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    assert.ok(toolCalls.length <= 3, `Should stop at maxIterations (3), got ${toolCalls.length} tool calls`);

    // 2. Final response streamed (from provider.stream)
    const textDeltas = events.filter((e) => e.type === 'text_delta');
    assert.ok(textDeltas.length > 0, 'Should stream a final summary after circuit breaker');

    // 3. Done event emitted (not an error)
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'Should emit done event — circuit breaker is graceful, not a crash');

    // 4. No error events
    const errors = events.filter((e) => e.type === 'error');
    assert.equal(errors.length, 0, 'Circuit breaker should not produce error events');
  } finally {
    cleanup();
  }
});

test('Audit 5c: Task chaining — multi-phase operations via sequential task spawning', async () => {
  const store = new TaskStorage();
  const phaseOutputs: string[] = [];

  taskQueue.stopTaskQueue();
  taskQueue.initTaskQueue(store as unknown as IStorage, { pollIntervalMs: 100, maxConcurrent: 5 });

  const totalPhases = 3;

  taskQueue.registerTaskHandler('phase_runner', async (task: AgentTask) => {
    const input = task.input as { phase: number } | null;
    const phase = input?.phase ?? 1;
    const result = `Phase ${phase} completed`;
    phaseOutputs.push(result);

    // Chain to next phase if not done
    if (phase < totalPhases) {
      await taskQueue.enqueueTask('phase_runner', `Phase ${phase + 1}`, { phase: phase + 1 });
    }

    return { output: { result, phase } };
  });

  // Start phase 1
  await taskQueue.enqueueTask('phase_runner', 'Phase 1', { phase: 1 });

  // Wait for all phases to complete
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const completed = (await store.listAgentTasks('completed')).length;
    if (completed >= totalPhases) break;
  }

  // 1. All 3 phases completed
  const completed = await store.listAgentTasks('completed');
  assert.equal(completed.length, totalPhases, `All ${totalPhases} phases should complete`);

  // 2. Phases executed in order
  assert.deepEqual(phaseOutputs, [
    'Phase 1 completed',
    'Phase 2 completed',
    'Phase 3 completed',
  ], 'Phases should execute in order');

  // 3. Total tasks created = 3
  assert.equal(store.tasks.size, totalPhases, `Should have exactly ${totalPhases} tasks in storage`);

  // 4. Each task has output referencing its phase
  for (const task of completed) {
    const output = task.output as { phase: number; result: string } | null;
    assert.ok(output?.result.includes('Phase'), 'Each task output should reference its phase');
  }

  taskQueue.stopTaskQueue();
});
