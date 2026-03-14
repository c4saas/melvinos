import { fetchWithSsrfProtection } from "./security/safe-fetch";

export interface WebhookAttachmentPayload {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface WebhookInvocationPayload {
  assistant: {
    id?: string | null;
    type?: string | null;
    name?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  message: {
    text: string;
    metadata?: Record<string, unknown> | null;
    attachments?: WebhookAttachmentPayload[];
  };
  chat: {
    id?: string | null;
    projectId?: string | null;
  };
  user: {
    id: string;
  };
  context: {
    model: string;
    hasAttachments: boolean;
    hasContent: boolean;
    timestamp: string;
  };
}

export type WebhookInvocationStatus = "success" | "error" | "timeout";

export interface WebhookInvocationResult {
  status: WebhookInvocationStatus;
  content: string;
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  responseMetadata?: unknown;
}

interface InvokeWebhookAssistantOptions {
  url: string;
  payload: WebhookInvocationPayload;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  validateUrl?: (url: string) => Promise<void>;
}

const clampTimeout = (value: number | undefined, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }
  const normalized = Math.floor(value);
  return Math.min(Math.max(normalized, min), max);
};

export async function invokeWebhookAssistant(options: InvokeWebhookAssistantOptions): Promise<WebhookInvocationResult> {
  const {
    url,
    payload,
    timeoutMs,
    headers,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!fetchImpl) {
    throw new Error("Fetch implementation is not available in this environment");
  }

  const safeTimeout = clampTimeout(timeoutMs, 1_000, 60_000);

  const validateUrl = options.validateUrl
    ? options.validateUrl
    : async (target: string) => {
        await fetchWithSsrfProtection(target, {
          fetchFn: async () => new Response(null, { status: 200 }),
        });
      };

  try {
    await validateUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook URL validation failed";
    return {
      status: "error",
      content: "",
      latencyMs: 0,
      errorMessage: message,
    };
  }

  const controller = new AbortController();
  const startTime = Date.now();
  const timer = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Atlas-Webhook-Version": "2024-12-01",
        ...(headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;
    const statusCode = response.status;
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        status: "error",
        content: "",
        latencyMs,
        statusCode,
        errorMessage: errorText || `Webhook responded with status ${statusCode}`,
      };
    }

    let responseText = "";
    let responseMetadata: unknown;

    if (contentType.includes("application/json")) {
      try {
        const data = await response.json();
        if (typeof data === "string") {
          responseText = data;
        } else if (data && typeof data === "object") {
          const candidate = data as Record<string, unknown>;
          if (typeof candidate.text === "string") {
            responseText = candidate.text;
          } else if (typeof candidate.response === "string") {
            responseText = candidate.response;
          } else {
            responseText = JSON.stringify(candidate);
          }
          if (candidate.metadata && typeof candidate.metadata === "object") {
            responseMetadata = candidate.metadata;
          }
        } else {
          responseText = JSON.stringify(data);
        }
      } catch (error) {
        responseText = await response.text().catch(() => "");
        responseMetadata = { parseError: error instanceof Error ? error.message : "Unable to parse JSON" };
      }
    } else {
      responseText = await response.text().catch(() => "");
    }

    return {
      status: "success",
      content: responseText,
      latencyMs,
      statusCode,
      responseMetadata,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
      return {
        status: "timeout",
        content: "",
        latencyMs,
        errorMessage: "Webhook request timed out",
      };
    }

    const message = error instanceof Error ? error.message : "Webhook request failed";
    return {
      status: "error",
      content: "",
      latencyMs,
      errorMessage: message,
    };
  } finally {
    clearTimeout(timer);
  }
}
