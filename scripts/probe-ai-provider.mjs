import { loadLocalEnv } from "./load-local-env.mjs";
import {
  consumeChatCompletionsEventStream,
  consumeResponsesEventStream,
} from "./probe-ai-sse.mjs";

const envDebug = loadLocalEnv();
const env = process.env;
const apiKey = env.OPENAI_API_KEY;

function resolveReasoningEffort(value = "none") {
  const allowed = new Set(["none", "minimal", "low", "medium", "high"]);
  if (!allowed.has(value)) {
    throw new Error("AI_REASONING_EFFORT must be one of: none, minimal, low, medium, high.");
  }
  return value;
}

function resolveRequestTimeoutMs(value = "300000") {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    throw new Error("AI_REQUEST_TIMEOUT_MS must be an integer between 30000 and 600000 milliseconds.");
  }
  return timeoutMs;
}

const reasoningEffort = resolveReasoningEffort(env.AI_REASONING_EFFORT);
const requestTimeoutMs = resolveRequestTimeoutMs(env.AI_REQUEST_TIMEOUT_MS);

function sanitize(message) {
  const text = String(message);
  if (!apiKey) return text;
  return text.split(apiKey).join("[redacted]");
}

function safeProbeError(error) {
  if (error instanceof Error) {
    return { type: error.name, message: sanitize(error.message).slice(0, 500) };
  }
  if (error && typeof error === "object") {
    return {
      status: typeof error.status === "number" ? error.status : null,
      type: typeof error.type === "string" ? error.type : "provider_error",
      message: sanitize(error.message ?? "Unknown provider error").slice(0, 500),
    };
  }
  return { type: "provider_error", message: sanitize(error).slice(0, 500) };
}

function displayBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "invalid";
  }
}

function baseUrl(path) {
  const configured = env.OPENAI_BASE_URL.replace(/\/$/, "");
  const versioned = configured.endsWith("/v1") ? configured : `${configured}/v1`;
  return `${versioned}${path}`;
}

async function postResponsesStream(path, body) {
  const response = await fetch(baseUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const error = json?.error ?? json ?? {};
    throw {
      status: response.status,
      type: error.type ?? error.code ?? "provider_error",
      message: sanitize(error.message ?? text),
    };
  }

  return consumeResponsesEventStream(response.body);
}

async function postChatStream(path, body) {
  const response = await fetch(baseUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const error = json?.error ?? json ?? {};
    throw {
      status: response.status,
      type: error.type ?? error.code ?? "provider_error",
      message: sanitize(error.message ?? text),
    };
  }

  return consumeChatCompletionsEventStream(response.body);
}

function extractText(payload) {
  if (typeof payload === "string") return payload;
  if (payload.output_text) return payload.output_text;
  if (payload.choices?.[0]?.message?.content) return payload.choices[0].message.content;
  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function extractJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found.");
  return JSON.parse(match[0]);
}

function extractWebSearchEvidence(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const calls = output.filter((item) => item?.type === "web_search_call");
  const sourceCount = calls.reduce((count, call) => {
    const sources = Array.isArray(call?.action?.sources) ? call.action.sources : [];
    return count + sources.length;
  }, 0);

  return { callCount: calls.length, sourceCount };
}

function logProbe(name, result) {
  console.log(`[${name}] ${JSON.stringify(result, null, 2)}`);
}

const config = {
  apiKeyConfigured: Boolean(apiKey),
  baseUrlConfigured: Boolean(env.OPENAI_BASE_URL),
  baseUrl: displayBaseUrl(env.OPENAI_BASE_URL),
  textModel: env.OPENAI_TEXT_MODEL ?? null,
  imageModel: env.OPENAI_IMAGE_MODEL ?? null,
  reasoningEffort,
  requestTimeoutMs,
};

logProbe("config", config);
logProbe("debug", envDebug);

const summary = {
  baseUrlConfigured: config.baseUrlConfigured,
  textModel: config.textModel,
  imageModel: config.imageModel,
  textSupported: false,
  jsonSupported: false,
  responsesSupported: false,
  webSearchSupported: false,
  chatCompletionsSupported: false,
  imageModelConfigured: Boolean(config.imageModel),
};

if (!config.apiKeyConfigured || !config.baseUrlConfigured || !config.textModel) {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} else {
  try {
    const chat = await postChatStream("/chat/completions", {
      model: config.textModel,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      reasoning_effort: config.reasoningEffort,
      max_completion_tokens: 2_048,
    });
    const chatText = chat.outputText;
    summary.chatCompletionsSupported = Boolean(chatText);
    summary.textSupported = /ok/i.test(chatText);
    logProbe("chat-completions", {
      ok: summary.chatCompletionsSupported,
      eventCount: chat.eventCount,
      text: chatText.slice(0, 120),
    });
  } catch (error) {
    logProbe("chat-completions", { ok: false, error: safeProbeError(error) });
  }

  try {
    const jsonPayload = await postChatStream("/chat/completions", {
      model: config.textModel,
      messages: [{ role: "user", content: 'Return only JSON: {"ok":true,"provider":"openai-compatible"}' }],
      reasoning_effort: config.reasoningEffort,
      max_completion_tokens: 2_048,
    });
    const parsed = extractJsonObject(jsonPayload.outputText);
    summary.jsonSupported = parsed.ok === true && parsed.provider === "openai-compatible";
    logProbe("json-output", { ok: summary.jsonSupported, parsed });
  } catch (error) {
    logProbe("json-output", { ok: false, error: safeProbeError(error) });
  }

  try {
    const { response: responses, eventCount } = await postResponsesStream("/responses", {
      model: config.textModel,
      input: "Reply with exactly: ok",
      reasoning: { effort: config.reasoningEffort },
      max_output_tokens: 2_048,
    });
    const responseText = extractText(responses);
    summary.responsesSupported = responses.status === "completed" && Boolean(responseText);
    summary.textSupported = summary.textSupported || /ok/i.test(responseText);
    logProbe("responses", {
      ok: summary.responsesSupported,
      completed: responses.status === "completed",
      eventCount,
      text: responseText.slice(0, 120),
    });
  } catch (error) {
    logProbe("responses", { ok: false, error: safeProbeError(error) });
  }

  if (summary.responsesSupported) {
    try {
      const { response: web, eventCount } = await postResponsesStream("/responses", {
        model: config.textModel,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: "Search: Miho Nakayama King Records discography CD. Return one sentence.",
        reasoning: { effort: config.reasoningEffort },
        max_output_tokens: 2_048,
      });
      const text = extractText(web);
      const evidence = extractWebSearchEvidence(web);
      summary.webSearchSupported = Boolean(text) && evidence.callCount > 0;
      logProbe("web-search", {
        ok: summary.webSearchSupported,
        callCount: evidence.callCount,
        sourceCount: evidence.sourceCount,
        eventCount,
        text: text.slice(0, 240),
      });
    } catch (error) {
      summary.webSearchSupported = false;
      logProbe("web-search", { ok: false, error: safeProbeError(error) });
    }
  } else {
    logProbe("web-search", { ok: false, skipped: "responsesSupported=false" });
  }

  logProbe("image-model", {
    ok: summary.imageModelConfigured,
    note: "Image generation is not executed in this probe to avoid cost.",
  });

  console.log(JSON.stringify(summary, null, 2));
}
