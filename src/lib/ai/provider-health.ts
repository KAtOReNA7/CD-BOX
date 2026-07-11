import "server-only";

import { requireRuntimeAiProviderConfig, sanitizeErrorMessage } from "@/lib/ai/provider-capabilities";
import {
  collectResponseOutputText,
  createResponsesTextResponse,
  createWebSearchResponse,
} from "@/lib/ai/client";
import {
  consumeChatCompletionsEventStream,
  consumeResponsesEventStream,
} from "@/lib/ai/sse";

export const providerChecks = [
  "models",
  "chat",
  "chat-stream",
  "responses",
  "responses-stream",
  "web-search",
] as const;
export type ProviderCheck = (typeof providerChecks)[number];
export type ProviderCheckResult = {
  check: ProviderCheck;
  ok: boolean;
  status: number | null;
  errorType?: string | null;
  errorCode?: string | null;
  errorMessage?: string;
  [key: string]: unknown;
};

let activeProviderCheck: {
  check: ProviderCheck;
  promise: Promise<ProviderCheckResult>;
} | null = null;

export function isProviderCheck(value: string | null | undefined): value is ProviderCheck {
  return providerChecks.includes(value as ProviderCheck);
}

async function providerRequest(path: string, body?: unknown) {
  const config = await requireRuntimeAiProviderConfig();
  const response = await fetch(`${config.baseURL}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { response, payload };
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    return null;
  }
}

async function providerStreamRequest(
  path: string,
  body: unknown,
  kind: "responses" | "chat-completions",
) {
  const config = await requireRuntimeAiProviderConfig();
  const response = await fetch(`${config.baseURL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      response,
      payload: parseJson(text),
      eventCount: 0,
      completed: false,
      outputText: "",
    };
  }

  if (kind === "responses") {
    const result = await consumeResponsesEventStream(response.body);
    return {
      response,
      payload: result.response,
      eventCount: result.eventCount,
      completed: result.response.status === "completed",
      outputText: typeof result.response.output_text === "string"
        ? result.response.output_text
        : collectResponseOutputText(result.response.output),
    };
  }

  const result = await consumeChatCompletionsEventStream(response.body);

  return {
    response,
    payload: null,
    eventCount: result.eventCount,
    completed: true,
    outputText: result.outputText,
  };
}

function errorMetadata(payload: unknown) {
  if (!payload || typeof payload !== "object") return { errorType: null, errorCode: null };
  const error = "error" in payload && payload.error && typeof payload.error === "object" ? payload.error : null;
  if (!error) return { errorType: null, errorCode: null };

  return {
    errorType: "type" in error && typeof error.type === "string" ? error.type : null,
    errorCode: "code" in error && typeof error.code === "string" ? error.code : null,
  };
}

function chatCompletionText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) {
    return "";
  }
  const first = payload.choices[0];
  if (!first || typeof first !== "object" || !("message" in first) || !first.message || typeof first.message !== "object") {
    return "";
  }
  const content = "content" in first.message ? first.message.content : null;
  return typeof content === "string" ? content : "";
}

async function runProviderCheckOnce(check: ProviderCheck): Promise<ProviderCheckResult> {
  let runtimeApiKey: string | null = null;

  try {
    const config = await requireRuntimeAiProviderConfig();
    runtimeApiKey = config.apiKey;

    if (check === "models") {
      const { response, payload } = await providerRequest("/models");
      const models =
        payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
          ? payload.data
              .map((item) =>
                item && typeof item === "object" && "id" in item && typeof item.id === "string" ? item.id : null,
              )
              .filter((id): id is string => Boolean(id))
          : [];
      const configuredModelAvailable = models.includes(config.textModel);

      return {
        check,
        ok: response.ok && configuredModelAvailable,
        status: response.status,
        configuredTextModel: config.textModel,
        configuredModelAvailable,
        configuredImageModel: config.imageModel,
        models,
        ...errorMetadata(payload),
      };
    }

    if (check === "chat") {
      const { response, payload } = await providerRequest("/chat/completions", {
        model: config.textModel,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        reasoning_effort: config.reasoningEffort,
        max_completion_tokens: 2_048,
      });
      const hasOutput = Boolean(chatCompletionText(payload));

      return {
        check,
        ok: response.ok && hasOutput,
        status: response.status,
        hasOutput,
        ...errorMetadata(payload),
      };
    }

    if (check === "chat-stream") {
      const { response, payload, eventCount, completed, outputText } = await providerStreamRequest("/chat/completions", {
        model: config.textModel,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        reasoning_effort: config.reasoningEffort,
        max_completion_tokens: 2_048,
        stream: true,
      }, "chat-completions");

      return {
        check,
        ok: response.ok && completed && Boolean(outputText),
        status: response.status,
        contentType: response.headers.get("content-type"),
        eventCount,
        completed,
        hasOutput: Boolean(outputText),
        ...errorMetadata(payload),
      };
    }

    if (check === "responses-stream") {
      const { response, payload, eventCount, completed, outputText } = await providerStreamRequest("/responses", {
        model: config.textModel,
        input: "Reply with exactly: ok",
        reasoning: { effort: config.reasoningEffort },
        max_output_tokens: 2_048,
        stream: true,
      }, "responses");

      return {
        check,
        ok: response.ok && completed && Boolean(outputText),
        status: response.status,
        contentType: response.headers.get("content-type"),
        eventCount,
        completed,
        hasOutput: Boolean(outputText),
        ...errorMetadata(payload),
      };
    }

    if (check === "responses") {
      const response = await createResponsesTextResponse({
        systemPrompt: "Return only the requested text.",
        userPrompt: "Reply with exactly: ok",
      });

      return {
        check,
        ok: response.status === "completed" && Boolean(response.output_text),
        status: 200,
        outputItems: response.output.length,
        webSearchCalls: 0,
        errorType: response.error?.code ?? null,
        errorCode: response.error?.code ?? null,
      };
    }

    if (check === "web-search") {
      const response = await createWebSearchResponse({
        forceSearch: true,
        systemPrompt: "Use web search and answer concisely.",
        userPrompt: "Find the official Next.js website and return its current stable major version in one sentence.",
      });
      const webSearchCalls = response.output.filter((item) => item.type === "web_search_call").length;

      return {
        check,
        ok: response.status === "completed" && Boolean(response.output_text) && webSearchCalls > 0,
        status: 200,
        outputItems: response.output.length,
        webSearchCalls,
        errorType: response.error?.code ?? null,
        errorCode: response.error?.code ?? null,
      };
    }

    throw new Error(`Unsupported provider check: ${check}`);
  } catch (error) {
    const errorMessage = error instanceof Error
      ? [runtimeApiKey, process.env.OPENAI_API_KEY]
          .reduce<string>((message, secret) => sanitizeErrorMessage(message, secret), error.message)
          .slice(0, 500)
      : "Unknown provider error";

    return {
      check,
      ok: false,
      status: null,
      errorType: error instanceof Error ? error.name : "unknown_error",
      errorCode: null,
      errorMessage,
    };
  }
}

export function runProviderCheck(check: ProviderCheck): Promise<ProviderCheckResult> {
  if (activeProviderCheck) {
    if (activeProviderCheck.check === check) {
      return activeProviderCheck.promise;
    }

    return Promise.resolve({
      check,
      ok: false,
      status: null,
      errorType: "BusyError",
      errorCode: "diagnostic_in_progress",
      errorMessage: `The ${activeProviderCheck.check} diagnostic is already running. Wait for it to finish before starting another check.`,
    });
  }

  const promise = runProviderCheckOnce(check);
  activeProviderCheck = { check, promise };
  void promise.finally(() => {
    if (activeProviderCheck?.promise === promise) {
      activeProviderCheck = null;
    }
  });
  return promise;
}
