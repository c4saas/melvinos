import Groq from "groq-sdk";

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

let cachedClient: { key: string; client: Groq } | null = null;

function getGroqClient(apiKey?: string): Groq {
  const key = apiKey || process.env.GROQ_API_KEY || '';
  if (!key) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  if (cachedClient && cachedClient.key === key) {
    return cachedClient.client;
  }

  const client = new Groq({ apiKey: key });
  cachedClient = { key, client };
  return client;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  format: string = "webm",
  apiKey?: string,
): Promise<TranscriptionResult> {
  try {
    const client = getGroqClient(apiKey);

    // Create a File-like object for the Groq SDK (needs name property for multipart)
    const audioFile = new File([audioBuffer], `audio.${format}`, {
      type: `audio/${format}`,
    });

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3",
      language: "en", // Can be made configurable
      response_format: "json",
    });

    return {
      text: transcription.text,
    };
  } catch (error) {
    console.error("Groq Whisper transcription error:", error);
    throw new Error(
      error instanceof Error ? error.message : "Transcription failed"
    );
  }
}
