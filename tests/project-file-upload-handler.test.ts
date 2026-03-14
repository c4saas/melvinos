import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILE_UPLOAD_LIMITS_MB, formatFileUploadLimitLabel, PLAN_LABELS } from '@shared/schema';

const {
  isOversizedProjectFileHeadResponse,
  buildProjectFileOversizeError,
  fetchProjectFileMetadata,
} = await import('../server/routes');

const { UnsafeRemoteURLError } = await import('../server/security/safe-fetch');

test('detects oversized project file responses by status code', () => {
  const response = new Response(null, { status: 413 });
  assert.equal(isOversizedProjectFileHeadResponse(response), true);
});

test('detects oversized project file responses via explicit header', () => {
  const response = new Response(null, {
    status: 400,
    headers: { 'x-error-code': 'oversized-file' },
  });
  assert.equal(isOversizedProjectFileHeadResponse(response), true);
});

test('detects oversized project file responses via S3 style header', () => {
  const response = new Response(null, {
    status: 400,
    headers: { 'x-amz-error-code': 'EntityTooLarge' },
  });
  assert.equal(isOversizedProjectFileHeadResponse(response), true);
});

test('ignores unrelated head response failures', () => {
  const response = new Response(null, { status: 400 });
  assert.equal(isOversizedProjectFileHeadResponse(response), false);
});

test('builds consistent oversize error payloads for project files', () => {
  const oversize = buildProjectFileOversizeError('pro');
  assert.equal(oversize.status, 413);
  const limit = DEFAULT_FILE_UPLOAD_LIMITS_MB.pro;
  if (limit === null) {
    assert.equal(oversize.message, 'File too large to upload for your plan.');
  } else {
    assert.equal(
      oversize.message,
      `File too large. Maximum size is ${formatFileUploadLimitLabel(limit)} for ${PLAN_LABELS.pro} users.`,
    );
  }
});

test('rejects private network URLs when fetching project file metadata', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    fetchProjectFileMetadata('http://internal.service/resource', {
      lookupFn: async () => [{ address: '10.0.0.42', family: 4 }],
      fetchFn: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
    }),
    (error: unknown) => error instanceof UnsafeRemoteURLError && /private IP/.test(error.message),
  );

  assert.equal(fetchCalls, 0);
});
