import type { IStorage } from '../storage';
import type { AgentTask, AgentTaskStatus } from '@shared/schema';

type TaskHandler = (task: AgentTask) => Promise<{ output?: unknown; error?: string }>;

interface TaskQueueOptions {
  pollIntervalMs?: number;
  maxConcurrent?: number;
}

const DEFAULT_POLL_INTERVAL = 5000;
const DEFAULT_MAX_CONCURRENT = 5;

let storageRef: IStorage | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let runningCount = 0;
let maxConcurrent = DEFAULT_MAX_CONCURRENT;

const handlers = new Map<string, TaskHandler>();
const taskListeners = new Map<string, Set<(task: AgentTask) => void>>();
const retryCounters = new Map<string, number>();
const MAX_RETRIES = 3;

export function initTaskQueue(storage: IStorage, options?: TaskQueueOptions): void {
  storageRef = storage;
  maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;

  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const interval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  pollTimer = setInterval(() => {
    void processPendingTasks();
  }, interval);

  console.log(`[task-queue] Initialized (poll: ${interval}ms, concurrency: ${maxConcurrent})`);

  // Crash recovery: any task still marked 'running' from a previous process was interrupted
  // mid-execution (e.g. server restart). Reset them to 'pending' so they re-queue automatically.
  storage.listAgentTasks('running').then(interrupted => {
    if (interrupted.length === 0) return;
    console.log(`[task-queue] Crash recovery: resetting ${interrupted.length} interrupted task(s) to pending`);
    for (const task of interrupted) {
      void storage.updateAgentTask(task.id, { status: 'pending', startedAt: null, progress: 0 });
    }
    // Trigger processing after a short delay to let the DB writes settle
    setTimeout(() => void processPendingTasks(), 2000);
  }).catch(err => {
    console.warn('[task-queue] Crash recovery check failed:', err);
  });
}

export function stopTaskQueue(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function registerTaskHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler);
}

export function onTaskUpdate(taskId: string, listener: (task: AgentTask) => void): () => void {
  if (!taskListeners.has(taskId)) {
    taskListeners.set(taskId, new Set());
  }
  taskListeners.get(taskId)!.add(listener);

  return () => {
    const set = taskListeners.get(taskId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) taskListeners.delete(taskId);
    }
  };
}

function notifyListeners(task: AgentTask): void {
  const set = taskListeners.get(task.id);
  if (set) {
    for (const listener of set) {
      try {
        listener(task);
      } catch {
        // ignore listener errors
      }
    }
  }
}

export async function enqueueTask(
  type: string,
  title: string,
  input?: unknown,
  conversationId?: string,
): Promise<AgentTask> {
  if (!storageRef) throw new Error('Task queue not initialized');

  const task = await storageRef.createAgentTask({
    type,
    title,
    status: 'pending',
    input: input ?? null,
    conversationId: conversationId ?? null,
    progress: 0,
  });

  // Try to process immediately if we have capacity
  void processPendingTasks();

  return task;
}

export async function cancelTask(taskId: string): Promise<AgentTask | undefined> {
  if (!storageRef) throw new Error('Task queue not initialized');

  const task = await storageRef.getAgentTask(taskId);
  if (!task) return undefined;

  if (task.status === 'completed' || task.status === 'failed') {
    return task; // Can't cancel finished tasks
  }

  const updated = await storageRef.updateAgentTask(taskId, {
    status: 'cancelled',
    completedAt: new Date(),
  });

  if (updated) notifyListeners(updated);
  return updated;
}

export async function getTaskStatus(taskId: string): Promise<AgentTask | undefined> {
  if (!storageRef) throw new Error('Task queue not initialized');
  return storageRef.getAgentTask(taskId);
}

export async function listTasks(status?: AgentTaskStatus): Promise<AgentTask[]> {
  if (!storageRef) throw new Error('Task queue not initialized');
  return storageRef.listAgentTasks(status);
}

async function processPendingTasks(): Promise<void> {
  if (!storageRef || runningCount >= maxConcurrent) return;

  try {
    const pending = await storageRef.listAgentTasks('pending');
    if (pending.length === 0) return;

    for (const task of pending) {
      if (runningCount >= maxConcurrent) break;
      void runTask(task);
    }
  } catch (err) {
    // Gracefully handle DB errors (e.g. table not yet created during migration)
  }
}

async function runTask(task: AgentTask): Promise<void> {
  if (!storageRef) return;

  const handler = handlers.get(task.type);
  if (!handler) {
    await storageRef.updateAgentTask(task.id, {
      status: 'failed',
      error: `No handler registered for task type: ${task.type}`,
      completedAt: new Date(),
    });
    return;
  }

  runningCount++;

  try {
    // Mark as running
    const running = await storageRef.updateAgentTask(task.id, {
      status: 'running',
      startedAt: new Date(),
    });
    if (running) notifyListeners(running);

    // Execute handler
    const result = await handler(task);

    // Mark as completed or failed
    retryCounters.delete(task.id);
    if (result.error) {
      const failed = await storageRef.updateAgentTask(task.id, {
        status: 'failed',
        error: result.error,
        output: result.output ?? null,
        completedAt: new Date(),
      });
      if (failed) notifyListeners(failed);
    } else {
      const completed = await storageRef.updateAgentTask(task.id, {
        status: 'completed',
        output: result.output ?? null,
        progress: 100,
        completedAt: new Date(),
      });
      if (completed) notifyListeners(completed);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTransient = /timeout|ECONNRESET|ENOTFOUND|rate.?limit|429|503|502/i.test(message);
    const attempts = (retryCounters.get(task.id) ?? 0) + 1;
    retryCounters.set(task.id, attempts);

    if (isTransient && attempts <= MAX_RETRIES) {
      // Exponential backoff: 5s, 20s, 45s
      const delayMs = attempts * attempts * 5000;
      console.log(`[task-queue] Transient error on task ${task.id}, retry ${attempts}/${MAX_RETRIES} in ${delayMs}ms`);
      await storageRef?.updateAgentTask(task.id, {
        status: 'pending',
        error: `Retry ${attempts}/${MAX_RETRIES}: ${message}`,
      });
      setTimeout(() => void processPendingTasks(), delayMs);
    } else {
      retryCounters.delete(task.id);
      const failed = await storageRef?.updateAgentTask(task.id, {
        status: 'failed',
        error: message,
        completedAt: new Date(),
      });
      if (failed) notifyListeners(failed);
    }
  } finally {
    runningCount--;
  }
}

export async function updateTaskProgress(taskId: string, progress: number): Promise<void> {
  if (!storageRef) return;
  const updated = await storageRef.updateAgentTask(taskId, { progress: Math.min(100, Math.max(0, progress)) });
  if (updated) notifyListeners(updated);
}
