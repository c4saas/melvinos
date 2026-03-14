"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  defaultVoiceSettings,
  type VoiceSettings,
  voiceSettingsSchema,
} from "../../../../lib/voice-settings";

const voiceSettingsFormSchema = voiceSettingsSchema.extend({
  apiKey: z.string().optional(),
});

const MODEL_OPTIONS: Array<{
  label: string;
  value: string;
  description: string;
}> = [
  {
    label: "GPT-4o Realtime Preview",
    value: "gpt-4o-realtime-preview-2024-12-17",
    description: "Bidirectional WebRTC streaming with OpenAI voice responses.",
  },
  {
    label: "GPT-4o Mini Voice",
    value: "gpt-4o-mini-voice",
    description: "Lightweight neural voice tuned for assistants and alerts.",
  },
  {
    label: "GPT-4o Audio Preview",
    value: "gpt-4o-audio-preview",
    description: "High-fidelity text-to-speech optimized for polished output.",
  },
];

type VoiceSettingsFormValues = z.infer<typeof voiceSettingsFormSchema>;

type SaveState = "idle" | "loading" | "saving" | "saved" | "error";

export default function VoiceSettingsPage() {
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<VoiceSettingsFormValues>({
    resolver: zodResolver(voiceSettingsFormSchema),
    defaultValues: defaultVoiceSettings,
  });

  const {
    handleSubmit,
    control,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    let isActive = true;

    const loadSettings = async () => {
      try {
        setSaveState("loading");
        const response = await fetch("/api/settings/voice", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load voice preferences.");
        }

        const data = (await response.json()) as VoiceSettings;

        if (isActive) {
          reset({
            apiKey: data.apiKey ?? "",
            model: data.model ?? defaultVoiceSettings.model,
            realtimeEnabled:
              data.realtimeEnabled ?? defaultVoiceSettings.realtimeEnabled,
          });
          setSaveState("idle");
        }
      } catch (error) {
        console.error("Voice settings fetch error", error);
        if (isActive) {
          setErrorMessage("We were unable to load your voice preferences.");
          setSaveState("error");
        }
      }
    };

    void loadSettings();

    return () => {
      isActive = false;
    };
  }, [reset]);

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage(null);
    setSaveState("saving");

    const payload: VoiceSettings = {
      apiKey: values.apiKey ?? "",
      model: values.model,
      realtimeEnabled: values.realtimeEnabled,
    };

    try {
      const response = await fetch("/api/settings/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { error?: string } | null;
        const message = body?.error ?? "Unable to save voice preferences.";
        throw new Error(message);
      }

      const saved = (await response.json()) as VoiceSettings;

      reset({
        apiKey: saved.apiKey ?? "",
        model: saved.model,
        realtimeEnabled: saved.realtimeEnabled,
      });

      setSaveState("saved");
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setSaveState("idle");
        resetTimerRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("Voice settings save error", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save voice preferences.",
      );
      setSaveState("error");
    }
  });

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const isBusy =
    isSubmitting || saveState === "loading" || saveState === "saving";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Voice settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure your OpenAI voice engine credentials, preferred model, and
          realtime streaming behavior.
        </p>
      </header>

      <section className="max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="apiKey"
              className="text-sm font-medium text-foreground"
            >
              OpenAI API key
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isBusy}
              {...register("apiKey")}
            />
            <p className="text-xs text-muted-foreground">
              Keys are stored securely and only used for outbound voice calls.
            </p>
            {errors.apiKey ? (
              <p className="text-xs text-destructive">
                {errors.apiKey.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="model"
              className="text-sm font-medium text-foreground"
            >
              Voice model
            </label>
            <Controller
              name="model"
              control={control}
              render={({ field }) => (
                <select
                  id="model"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isBusy}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            />
            <div className="space-y-1">
              {MODEL_OPTIONS.map((option) => (
                <p
                  key={`${option.value}-description`}
                  className="text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {option.label}:
                  </span>{" "}
                  {option.description}
                </p>
              ))}
            </div>
            {errors.model ? (
              <p className="text-xs text-destructive">{errors.model.message}</p>
            ) : null}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border/60 bg-muted/40 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Enable realtime voice
              </p>
              <p className="text-xs text-muted-foreground">
                Allows low-latency, bidirectional conversations through the
                OpenAI realtime API.
              </p>
            </div>
            <Controller
              name="realtimeEnabled"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    field.value ? "bg-primary" : "bg-muted"
                  } ${isBusy ? "opacity-60" : ""}`}
                  onClick={() => {
                    if (isBusy) return;
                    field.onChange(!field.value);
                  }}
                  disabled={isBusy}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
                      field.value ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              )}
            />
          </div>

          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}
          {saveState === "saved" ? (
            <p className="text-sm text-emerald-500">Voice preferences saved.</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" || isSubmitting
                ? "Saving…"
                : "Save changes"}
            </button>
            <button
              type="button"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => reset(defaultVoiceSettings)}
              disabled={isBusy}
            >
              Reset to defaults
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
