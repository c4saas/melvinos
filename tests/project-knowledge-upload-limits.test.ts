import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILE_UPLOAD_LIMITS_MB, formatFileUploadLimitLabel, PLAN_LABELS, type UserPlan } from '@shared/schema';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';

const { validateUploadSizeForPlan } = await import('../server/routes');

const BYTES_PER_MB = 1024 * 1024;

const planCases: Array<{ plan: UserPlan; label: string }> = [
  { plan: 'free', label: PLAN_LABELS.free },
  { plan: 'pro', label: PLAN_LABELS.pro },
  { plan: 'enterprise', label: PLAN_LABELS.enterprise },
];

for (const { plan, label } of planCases) {
  test(`rejects ${label} plan project knowledge uploads slightly above the limit`, () => {
    const limitMb = DEFAULT_FILE_UPLOAD_LIMITS_MB[plan];
    assert.notEqual(limitMb, null, `${label} plan upload limit should be defined for this test`);

    const result = validateUploadSizeForPlan(plan, (limitMb as number) * BYTES_PER_MB + 1);

    assert.ok(result, `Expected validation to fail for ${label.toLowerCase()} plan upload`);
    assert.equal(result?.status, 413);
    assert.equal(
      result?.message,
      `File too large. Maximum size is ${formatFileUploadLimitLabel(limitMb)} for ${label} users.`,
    );
  });
}
