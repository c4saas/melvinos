import { NextResponse } from "next/server";
import { z } from "zod";

import {
  defaultVoiceSettings,
  getVoiceSettings,
  saveVoiceSettings,
  voiceSettingsSchema,
  type VoiceSettings,
} from "../../../../lib/voice-settings";

const voiceSettingsRequestSchema = voiceSettingsSchema.extend({
  apiKey: z.string().optional(),
});

export async function GET() {
  const settings = await getVoiceSettings();
  return NextResponse.json(settings satisfies VoiceSettings);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = voiceSettingsRequestSchema.parse(body);
    const normalized: VoiceSettings = {
      ...defaultVoiceSettings,
      ...parsed,
      apiKey: parsed.apiKey ?? "",
    };

    const saved = await saveVoiceSettings(normalized);
    return NextResponse.json(saved satisfies VoiceSettings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid voice settings payload.",
          issues: error.issues,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { error: "Unable to save voice settings. Please try again." },
      { status: 500 },
    );
  }
}
