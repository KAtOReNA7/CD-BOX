import "server-only";

import { requireRuntimeAiProviderConfig, sanitizeErrorMessage } from "@/lib/ai/provider-capabilities";
import { createTextResponse, createWebSearchResponse } from "@/lib/ai/client";

export const providerChecks = [
  "models",
  "chat",
  "chat-stream",
  "responses",
  "responses-stream",
  "web-search",
] as const;
export type ProviderCheck = (typeof providerChecks)[number];

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
    signal: AbortSignal.timeout(90_000),
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

async function providerStreamRequest(path: string, body: unknown) {
  const config = await requireRuntimeAiProviderConfig();
  const response = await fetch(`${config.baseURL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const reader = response.body?.getReader();
  const firstChunk = reader ? await reader.read() : null;
  await reader?.cancel();

  return {
    response,
    hasChunk: Boolean(firstChunk && !firstChunk.done && firstChunk.value.byteLength > 0),
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

export async function runProviderCheck(check: ProviderCheck) {
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
        max_tokens: 32,
      });
      const hasOutput = Boolean(
        payload &&
          typeof payload === "object" &&
          "choices" in payload &&
          Array.isArray(payload.choices) &&
          payload.choices.length > 0,
      );

      return {
        check,
        ok: response.ok && hasOutput,
        status: response.status,
        hasOutput,
        ...errorMetadata(payload),
      };
    }

    if (check === "chat-stream") {
      const { response, hasChunk } = await providerStreamRequest("/chat/completions", {
        model: config.textModel,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 32,
        stream: true,
      });

      return {
        check,
        ok: response.ok && hasChunk,
        status: response.status,
        contentType: response.headers.get("content-type"),
        hasChunk,
      };
    }

    if (check === "responses-stream") {
      const { response, hasChunk } = await providerStreamRequest("/responses", {
        model: config.textModel,
        input: "Reply with exactly: ok",
        max_output_tokens: 32,
        stream: true,
      });

      return {
        check,
        ok: response.ok && hasChunk,
        status: response.status,
        contentType: response.headers.get("content-type"),
        hasChunk,
      };
    }

    if (check === "responses") {
      const response = await createTextResponse({
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
      ? [runtimeApiKey, process.env.OPENAI_API_KEY, process.env.AI_GATEWAY_API_KEY, process.env.VERCEL_OIDC_TOKEN]
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
