import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/test';

const { MemStorage } = await import('../server/storage');
const { requirePermission } = await import('../server/security/permissions');
const { isAuthenticated } = await import('../server/localAuth');
const { PERMISSIONS } = await import('../shared/constants');

const createMockResponse = () => {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res;
};

const runMiddlewareChain = async (
  middlewares: Array<(req: any, res: any, next?: (err?: unknown) => void) => unknown>,
  req: any,
  res: any,
) => {
  let index = -1;

  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) {
      throw new Error('next() called multiple times');
    }
    index = i;
    const fn = middlewares[i];
    if (!fn) {
      return;
    }

    if (fn.length >= 3) {
      await fn(req, res, async (err?: unknown) => {
        if (err) {
          throw err;
        }
        await dispatch(i + 1);
      });
    } else {
      await (fn as any)(req, res);
      await dispatch(i + 1);
    }
  };

  await dispatch(0);
};

test('MemStorage can create and update centralized N8N agents', async () => {
  const storage = new MemStorage();

  const created = await storage.createN8nAgent({
    workflowId: 'workflow-123',
    name: 'Daily Research Agent',
    description: 'Runs a daily research automation.',
    status: 'active',
    webhookUrl: 'https://example.com/webhook',
    metadata: { tags: ['daily', 'research'] },
  });

  assert.ok(created.id);
  assert.equal(created.status, 'active');
  assert.equal((created.metadata as any)?.tags?.length, 2);
  assert.equal(created.type, 'webhook');
  assert.equal(created.isActive, true);

  const assistants = await storage.listAssistants();
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0]?.id, created.id);
  assert.equal(assistants[0]?.type, 'webhook');
  assert.equal(assistants[0]?.userId, null);

  const fetched = await storage.getN8nAgents();
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].id, created.id);

  const updated = await storage.createN8nAgent({
    workflowId: 'workflow-123',
    name: 'Updated Research Agent',
    status: 'inactive',
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.name, 'Updated Research Agent');
  assert.equal(updated.status, 'inactive');
  assert.equal((updated.metadata as any)?.tags?.length, 2);
  assert.equal(updated.isActive, false);

  const fetchedAgain = await storage.getN8nAgents();
  assert.equal(fetchedAgain.length, 1);
  assert.equal(fetchedAgain[0].name, 'Updated Research Agent');
  assert.equal(fetchedAgain[0].status, 'inactive');
  assert.equal(fetchedAgain[0].isActive, false);
});

test('MemStorage deleteN8nAgent only removes centralized webhook assistants', async () => {
  const storage = new MemStorage();

  const created = await storage.createN8nAgent({
    workflowId: 'workflow-xyz',
    name: 'Outbound Agent',
  });

  const deleted = await storage.deleteN8nAgent(created.id);
  assert.equal(deleted, true);

  const deletedAgain = await storage.deleteN8nAgent(created.id);
  assert.equal(deletedAgain, false);
});

test('n8n agent API routes reject users without assistant library permissions', async () => {
  const storage = new MemStorage();
  const user = await storage.createUser({
    username: 'regular-user',
    email: 'user@example.com',
    password: null,
    plan: 'free',
    proAccessCode: null,
    role: 'user',
  });

  const req: any = {
    method: 'POST',
    path: '/api/integrations/n8n/agents',
    body: {
      workflowId: 'wf-1',
      name: 'Example Agent',
    },
    session: { userId: user.id },
    user,
    isAuthenticated: () => true,
  };

  const res = createMockResponse();
  let handlerCalled = false;

  const handler = async () => {
    handlerCalled = true;
    res.json({ ok: true });
  };

  await runMiddlewareChain(
    [isAuthenticated as any, requirePermission(PERMISSIONS.ASSISTANT_LIBRARY_EDIT, storage), handler],
    req,
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(handlerCalled, false);
  assert.deepEqual(res.body, {
    error: 'Insufficient permissions',
    required: PERMISSIONS.ASSISTANT_LIBRARY_EDIT,
    role: 'user',
  });
});
