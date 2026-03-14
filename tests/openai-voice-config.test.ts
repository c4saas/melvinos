import test from 'node:test';
import assert from 'node:assert/strict';

const envModule = await import('../apps/web/src/lib/env.ts');
const resetEnvCache = envModule.__resetEnvCacheForTesting;

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_VOICE_API_KEY',
  'OPENAI_VOICE_MODEL',
  'OPENAI_VOICE_NAME',
  'OPENAI_VOICE_FORMAT',
  'OPENAI_VOICE_REALTIME_ENABLED',
  'OPENAI_VOICE_REALTIME_URL',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

type EnvSnapshot = Record<EnvKey, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snapshot = {} as EnvSnapshot;
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function applyEnv(values: Partial<EnvSnapshot>): void {
  for (const key of ENV_KEYS) {
    if (key in values) {
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

await test('OpenAIVoiceClient uses shared env defaults', async () => {
  const original = snapshotEnv();
  applyEnv({
    OPENAI_API_KEY: 'base-openai-key',
    OPENAI_VOICE_API_KEY: undefined,
    OPENAI_VOICE_MODEL: undefined,
    OPENAI_VOICE_NAME: undefined,
    OPENAI_VOICE_FORMAT: undefined,
    OPENAI_VOICE_REALTIME_ENABLED: undefined,
    OPENAI_VOICE_REALTIME_URL: undefined,
  });
  resetEnvCache();

  try {
    const module = await import('../server/openai-voice.ts');
    const client = new module.OpenAIVoiceClient();

    assert.equal((client as any).apiKey, 'base-openai-key', 'should reuse OPENAI_API_KEY when voice key missing');
    assert.equal((client as any).defaultModel, 'gpt-4o-mini-tts', 'default model should use helper default');
    assert.equal((client as any).defaultVoice, 'alloy', 'default voice should use helper default');
    assert.equal((client as any).defaultFormat, 'mp3', 'default format should use helper default');
    assert.equal((client as any).baseUrl, undefined, 'base URL should remain undefined when override absent');

    const config = module.getVoiceRuntimeConfig();
    assert.equal(config.apiKey, 'base-openai-key', 'config should expose resolved API key');
    assert.equal(config.model, 'gpt-4o-mini-tts', 'config should expose default model');
    assert.equal(config.voice, 'alloy', 'config should expose default voice');
    assert.equal(config.format, 'mp3', 'config should expose default format');
    assert.equal(config.realtime.enabled, false, 'config should reflect realtime disabled by default');
    assert.equal(
      config.realtime.baseUrl,
      'wss://api.openai.com/v1/realtime',
      'config should expose fallback realtime URL',
    );
  } finally {
    applyEnv(original);
    resetEnvCache();
  }
});

await test('OpenAIVoiceClient respects voice-specific overrides from getEnv', async () => {
  const original = snapshotEnv();
  applyEnv({
    OPENAI_API_KEY: 'base-openai-key',
    OPENAI_VOICE_API_KEY: 'voice-only-key',
    OPENAI_VOICE_MODEL: 'custom-voice-model',
    OPENAI_VOICE_NAME: 'luna',
    OPENAI_VOICE_FORMAT: 'WAV',
    OPENAI_VOICE_REALTIME_ENABLED: 'true',
    OPENAI_VOICE_REALTIME_URL: 'wss://voice.example/ws',
  });
  resetEnvCache();

  try {
    const module = await import('../server/openai-voice.ts');
    const client = new module.OpenAIVoiceClient();

    assert.equal((client as any).apiKey, 'voice-only-key', 'voice API key should override default');
    assert.equal((client as any).defaultModel, 'custom-voice-model', 'custom model should be applied');
    assert.equal((client as any).defaultVoice, 'luna', 'custom voice should be applied');
    assert.equal((client as any).defaultFormat, 'wav', 'format should normalize to lower-case wav');
    assert.equal((client as any).baseUrl, 'wss://voice.example/ws', 'base URL should use custom override');

    const config = module.getVoiceRuntimeConfig();
    assert.equal(config.apiKey, 'voice-only-key');
    assert.equal(config.model, 'custom-voice-model');
    assert.equal(config.voice, 'luna');
    assert.equal(config.format, 'wav');
    assert.equal(config.realtime.enabled, true);
    assert.equal(config.realtime.baseUrl, 'wss://voice.example/ws');
  } finally {
    applyEnv(original);
    resetEnvCache();
  }
});
