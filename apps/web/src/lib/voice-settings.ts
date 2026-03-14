import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";

const SETTINGS_FILE = path.join(
  process.cwd(),
  "apps/web/data/voice-settings.json",
);

export const voiceSettingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().min(1),
  realtimeEnabled: z.boolean(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const defaultVoiceSettings: VoiceSettings = {
  apiKey: "",
  model: "gpt-4o-mini-voice",
  realtimeEnabled: false,
};

function normalize(settings: Partial<VoiceSettings>): VoiceSettings {
  return {
    ...defaultVoiceSettings,
    ...settings,
    apiKey: settings.apiKey ?? "",
  };
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = voiceSettingsSchema.partial().parse(parsed);
    return normalize(validated);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ...defaultVoiceSettings };
    }

    throw error;
  }
}

export async function saveVoiceSettings(
  input: VoiceSettings,
): Promise<VoiceSettings> {
  const parsed = voiceSettingsSchema.parse(input);
  const settings = normalize(parsed);

  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");

  return settings;
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}
