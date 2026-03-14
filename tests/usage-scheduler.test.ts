import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  InsertUsageSummarySnapshot,
  UsageMetric,
  UsageSummarySnapshot,
  User,
} from '@shared/schema';
import { runUsageAggregationCycle } from '../server/usage/scheduler';
import type { IStorage } from '../server/storage';

let metricCounter = 0;

function makeMetric(partial: Partial<UsageMetric>): UsageMetric {
  metricCounter += 1;
  return {
    id: partial.id ?? `metric-${metricCounter}`,
    userId: partial.userId ?? 'user-1',
    chatId: partial.chatId ?? 'chat-1',
    messageId: partial.messageId ?? null,
    model: partial.model ?? 'gpt-5',
    promptTokens: partial.promptTokens ?? '0',
    completionTokens: partial.completionTokens ?? '0',
    totalTokens: partial.totalTokens ?? '0',
    createdAt: partial.createdAt ?? new Date(),
  } as UsageMetric;
}

function makeUser(id: string, status: User['status'] = 'active'): User {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    id,
    username: null,
    password: null,
    email: `${id}@example.com`,
    avatar: null,
    firstName: null,
    lastName: null,
    profileImageUrl: null,
    plan: 'free',
    proAccessCode: null,
    role: 'user',
    status,
    createdAt: now,
    updatedAt: now,
  } as User;
}

class UsageStorageStub
  implements Pick<
    IStorage,
    'listUsers' | 'getLatestUsageSummarySnapshot' | 'getUserUsageMetrics' | 'saveUsageSummarySnapshot'
  >
{
  public snapshots: UsageSummarySnapshot[] = [];
  public metricsByUser = new Map<string, UsageMetric[]>();
  public usageMetricCalls = 0;
  private latestSnapshots = new Map<string, UsageSummarySnapshot>();

  constructor(private readonly users: User[]) {}

  async listUsers(): Promise<User[]> {
    return this.users;
  }

  async getLatestUsageSummarySnapshot(userId: string): Promise<UsageSummarySnapshot | undefined> {
    return this.latestSnapshots.get(userId);
  }

  async getUserUsageMetrics(userId: string, _from?: Date, _to?: Date): Promise<UsageMetric[]> {
    this.usageMetricCalls += 1;
    return this.metricsByUser.get(userId) ?? [];
  }

  async saveUsageSummarySnapshot(snapshot: InsertUsageSummarySnapshot): Promise<UsageSummarySnapshot> {
    const record: UsageSummarySnapshot = {
      id: `snapshot-${this.snapshots.length + 1}`,
      userId: snapshot.userId,
      rangeStart: new Date(snapshot.rangeStart),
      rangeEnd: new Date(snapshot.rangeEnd),
      totals: structuredClone(snapshot.totals),
      modelBreakdown: structuredClone(snapshot.modelBreakdown ?? []),
      generatedAt: snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(),
    };

    const existingIndex = this.snapshots.findIndex(
      (entry) =>
        entry.userId === record.userId &&
        new Date(entry.rangeStart).getTime() === record.rangeStart.getTime() &&
        new Date(entry.rangeEnd).getTime() === record.rangeEnd.getTime(),
    );

    if (existingIndex >= 0) {
      this.snapshots[existingIndex] = record;
    } else {
      this.snapshots.push(record);
    }

    this.latestSnapshots.set(record.userId, record);
    return record;
  }
}

test('runUsageAggregationCycle stores a snapshot for active users', async () => {
  const storage = new UsageStorageStub([
    makeUser('active-user', 'active'),
    makeUser('suspended-user', 'suspended'),
  ]);

  storage.metricsByUser.set('active-user', [
    makeMetric({
      id: 'metric-1',
      userId: 'active-user',
      chatId: 'chat-1',
      model: 'gpt-5',
      promptTokens: '100',
      completionTokens: '50',
      totalTokens: '150',
      createdAt: new Date('2024-01-01T00:10:00Z'),
    }),
  ]);

  await runUsageAggregationCycle(storage, {
    intervalMs: 15 * 60 * 1000,
    lookbackMs: 60 * 60 * 1000,
    now: () => new Date('2024-01-01T00:15:00Z'),
  });

  assert.equal(storage.snapshots.length, 1);
  const snapshot = storage.snapshots[0];
  assert.equal(snapshot.userId, 'active-user');
  assert.equal(snapshot.totals.messages, 1);
  assert.equal(snapshot.totals.totalTokens, 150);
  assert.equal(snapshot.modelBreakdown.length, 1);
  assert.equal(snapshot.modelBreakdown[0]?.model, 'gpt-5');
  assert.equal(snapshot.rangeEnd.toISOString(), '2024-01-01T00:15:00.000Z');
});

test('runUsageAggregationCycle skips duplicate windows for the same user', async () => {
  const storage = new UsageStorageStub([makeUser('user-1')]);
  storage.metricsByUser.set('user-1', [
    makeMetric({
      id: 'metric-1',
      userId: 'user-1',
      createdAt: new Date('2023-12-31T23:30:00Z'),
      promptTokens: '200',
      completionTokens: '100',
      totalTokens: '300',
    }),
  ]);

  const intervalMs = 15 * 60 * 1000;
  const lookbackMs = 60 * 60 * 1000;

  await runUsageAggregationCycle(storage, {
    intervalMs,
    lookbackMs,
    now: () => new Date('2024-01-01T00:07:00Z'),
  });

  assert.equal(storage.snapshots.length, 1);
  const metricsCallsAfterFirstRun = storage.usageMetricCalls;

  await runUsageAggregationCycle(storage, {
    intervalMs,
    lookbackMs,
    now: () => new Date('2024-01-01T00:10:00Z'),
  });

  assert.equal(storage.snapshots.length, 1, 'should not create a new snapshot for the same window');
  assert.equal(storage.usageMetricCalls, metricsCallsAfterFirstRun, 'should not fetch metrics again for deduplicated runs');
});
