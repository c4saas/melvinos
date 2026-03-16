import { z } from "zod";

const envSchema = z.object({
  /**
   * Optional dedicated API key for realtime voice sessions. Leave undefined to reuse OPENAI_API_KEY.
   */
  OPENAI_VOICE_API_KEY: z.string().min(1).optional(),
  /**
   * Default model used when negotiating voice sessions with the OpenAI Realtime API.
   */
  OPENAI_VOICE_MODEL: z.string().min(1).default("gpt-4o-mini-tts"),
  /**
   * Default voice profile requested for realtime synthesis.
   */
  OPENAI_VOICE_NAME: z.string().min(1).default("alloy"),
  /**
   * Default audio container requested for realtime synthesis clips.
   */
  OPENAI_VOICE_FORMAT: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "") return undefined;
        return normalized;
      }
      return value;
    }, z.enum(["mp3", "wav"]).default("mp3")),
  /**
   * Enables the UI to request realtime WebSocket streaming instead of pre-rendered clips.
   */
  OPENAI_VOICE_REALTIME_ENABLED: z
    .preprocess((value) => {
      if (typeof value === "string") {
        if (value.trim() === "") return undefined;
        return value === "true" || value === "1" || value.toLowerCase() === "yes";
      }
      if (typeof value === "number") {
        return value === 1;
      }
      if (typeof value === "boolean") {
        return value;
      }
      return undefined;
    }, z.boolean().default(false)),
  /**
   * Optional override for the OpenAI Realtime API base URL. When unset the default wss://api.openai.com/v1/realtime is used.
   */
  OPENAI_VOICE_REALTIME_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    const parsed = envSchema.parse({
      OPENAI_VOICE_API_KEY: process.env.OPENAI_VOICE_API_KEY,
      OPENAI_VOICE_MODEL: process.env.OPENAI_VOICE_MODEL,
      OPENAI_VOICE_NAME: process.env.OPENAI_VOICE_NAME,
      OPENAI_VOICE_FORMAT: process.env.OPENAI_VOICE_FORMAT,
      OPENAI_VOICE_REALTIME_ENABLED: process.env.OPENAI_VOICE_REALTIME_ENABLED,
      OPENAI_VOICE_REALTIME_URL: process.env.OPENAI_VOICE_REALTIME_URL,
    });

    cachedEnv = {
      ...parsed,
      OPENAI_VOICE_API_KEY:
        parsed.OPENAI_VOICE_API_KEY ?? process.env.OPENAI_API_KEY ?? undefined,
    };
  }

  return cachedEnv;
}

export const {
  OPENAI_VOICE_API_KEY,
  OPENAI_VOICE_MODEL,
  OPENAI_VOICE_NAME,
  OPENAI_VOICE_FORMAT,
  OPENAI_VOICE_REALTIME_ENABLED,
  OPENAI_VOICE_REALTIME_URL,
} = getEnv();

export function __resetEnvCacheForTesting(): void {
  cachedEnv = null;
}
