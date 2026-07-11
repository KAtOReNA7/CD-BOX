import "server-only";

export type AiProviderCapabilitySummary = {
  configurationReady: boolean;
  baseUrlConfigured: boolean;
  textModel: string | null;
  imageModel: string | null;
  textProtocol: AiTextProtocol;
  effectiveTextProtocol: AiTextProtocol | "unavailable";
  textSupport: AiCapabilityState;
  responsesSupport: AiCapabilityState;
  webSearchSupport: AiCapabilityState;
  chatCompletionsSupport: AiCapabilityState;
  webSearchEnabled: boolean;
  textSupported: boolean;
  jsonSupported: boolean;
  responsesSupported: boolean;
  webSearchSupported: boolean;
  chatCompletionsSupported: boolean;
  imageModelConfigured: boolean;
};

export type AiCapabilityState = "supported" | "unsupported" | "unknown";
export type AiTextProtocol = "auto" | "responses" | "chat-completions";
export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

const textProtocols = new Set<AiTextProtocol>(["auto", "responses", "chat-completions"]);
const reasoningEfforts = new Set<AiReasoningEffort>(["none", "minimal", "low", "medium", "high"]);

export function resolveAiTextProtocol(env: NodeJS.ProcessEnv = process.env): AiTextProtocol {
  const configured = env.AI_TEXT_PROTOCOL ?? "auto";
  if (!textProtocols.has(configured as AiTextProtocol)) {
    throw new Error("AI_TEXT_PROTOCOL must be one of: auto, responses, chat-completions.");
  }

  return configured as AiTextProtocol;
}

export function resolveEffectiveAiTextProtocol(env: NodeJS.ProcessEnv = process.env): AiTextProtocol {
  const requested = resolveAiTextProtocol(env);
  if (requested !== "auto") return requested;

  const responses = declaredCapability(env.AI_RESPONSES_SUPPORTED);
  const chatCompletions = declaredCapability(env.AI_CHAT_COMPLETIONS_SUPPORTED);

  if (responses === "unsupported" && chatCompletions === "unsupported") {
    throw new Error("Both Responses and Chat Completions are explicitly marked unsupported.");
  }
  if (responses === "supported" && chatCompletions !== "supported") return "responses";
  if (chatCompletions === "supported" && responses !== "supported") return "chat-completions";
  if (responses === "unsupported") return "chat-completions";
  if (chatCompletions === "unsupported") return "responses";

  return "auto";
}

export function resolveAiReasoningEffort(env: NodeJS.ProcessEnv = process.env): AiReasoningEffort {
  const configured = env.AI_REASONING_EFFORT ?? "none";
  if (!reasoningEfforts.has(configured as AiReasoningEffort)) {
    throw new Error("AI_REASONING_EFFORT must be one of: none, minimal, low, medium, high.");
  }

  return configured as AiReasoningEffort;
}

export function resolveAiRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.AI_REQUEST_TIMEOUT_MS ?? 300_000);
  if (!Number.isInteger(configured) || configured < 30_000 || configured > 600_000) {
    throw new Error("AI_REQUEST_TIMEOUT_MS must be an integer between 30000 and 600000 milliseconds.");
  }

  return configured;
}

function declaredCapability(value: string | undefined): AiCapabilityState {
  if (value === "true") return "supported";
  if (value === "false") return "unsupported";
  return "unknown";
}

export function redactSecret(value: string | undefined | null) {
  if (!value) return "missing";
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function sanitizeErrorMessage(message: string, apiKey?: string | null) {
  if (!apiKey) return message;
  return message.split(apiKey).join(redactSecret(apiKey));
}

export function normalizeRelayBaseUrl(value: string) {
  const url = new URL(value);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";

  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("OPENAI_BASE_URL must use HTTPS (HTTP is only allowed for localhost).");
  }

  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  if (!url.pathname.endsWith("/v1")) {
    throw new Error("OPENAI_BASE_URL must point to an OpenAI-compatible /v1 base URL.");
  }

  return url.toString().replace(/\/$/, "");
}

export function requireRelayBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  if (!env.OPENAI_BASE_URL) {
    throw new Error("CD-BOX requires an OpenAI-compatible relay base URL. Set OPENAI_BASE_URL before using AI features.");
  }

  try {
    return normalizeRelayBaseUrl(env.OPENAI_BASE_URL);
  } catch (error) {
    throw new Error(
      `Invalid OPENAI_BASE_URL: ${error instanceof Error ? error.message : "unknown URL error"}`,
    );
  }
}

export function resolveAiCredential(env: NodeJS.ProcessEnv = process.env) {
  return env.OPENAI_API_KEY ?? null;
}

export function requireAiProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = resolveAiCredential(env);
  const missing = ["OPENAI_BASE_URL", "OPENAI_TEXT_MODEL"].filter((key) => !env[key]);
  if (!apiKey) {
    missing.unshift("OPENAI_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `CD-BOX requires an OpenAI-compatible relay configuration. Missing: ${missing.join(", ")}.`,
    );
  }

  const requestedTextProtocol = resolveAiTextProtocol(env);
  const effectiveTextProtocol = resolveEffectiveAiTextProtocol(env);

  return {
    apiKey: apiKey!,
    baseURL: requireRelayBaseUrl(env),
    textModel: env.OPENAI_TEXT_MODEL!,
    imageModel: env.OPENAI_IMAGE_MODEL ?? null,
    requestedTextProtocol,
    textProtocol: effectiveTextProtocol,
    effectiveTextProtocol,
    reasoningEffort: resolveAiReasoningEffort(env),
    requestTimeoutMs: resolveAiRequestTimeoutMs(env),
    webSearchEnabled: env.AI_ENABLE_WEB_SEARCH === "true",
    imageGenerationEnabled: env.AI_ENABLE_IMAGE_GENERATION === "true",
  };
}

export function requireRuntimeAiProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  apiKeyOverride?: string,
) {
  const runtimeEnv = {
    ...env,
    OPENAI_API_KEY: apiKeyOverride ?? resolveAiCredential(env) ?? undefined,
  };

  return requireAiProviderConfig(runtimeEnv);
}

export function getConfiguredProviderCapabilities(env: NodeJS.ProcessEnv = process.env): AiProviderCapabilitySummary {
  let baseUrlConfigured = false;
  try {
    baseUrlConfigured = Boolean(requireRelayBaseUrl(env));
  } catch {
    baseUrlConfigured = false;
  }
  const textModel = env.OPENAI_TEXT_MODEL ?? null;
  const imageModel = env.OPENAI_IMAGE_MODEL ?? null;
  const hasRuntimeCredential = Boolean(resolveAiCredential(env));
  const hasRequiredTextConfig = Boolean(hasRuntimeCredential && baseUrlConfigured && env.OPENAI_TEXT_MODEL);

  let textProtocol: AiTextProtocol = "auto";
  let effectiveTextProtocol: AiTextProtocol | "unavailable" = "auto";
  let providerSettingsValid = true;
  try {
    textProtocol = resolveAiTextProtocol(env);
    effectiveTextProtocol = resolveEffectiveAiTextProtocol(env);
    resolveAiReasoningEffort(env);
    resolveAiRequestTimeoutMs(env);
  } catch {
    // Invalid configuration is not a verified provider capability.
    providerSettingsValid = false;
    effectiveTextProtocol = "unavailable";
  }
  const hasTextConfig = hasRequiredTextConfig && providerSettingsValid;

  const responsesSupport = !hasTextConfig || textProtocol === "chat-completions"
    ? "unsupported"
    : declaredCapability(env.AI_RESPONSES_SUPPORTED);
  const chatCompletionsSupport = !hasTextConfig || textProtocol === "responses"
    ? "unsupported"
    : declaredCapability(env.AI_CHAT_COMPLETIONS_SUPPORTED);
  const webSearchEnabled = env.AI_ENABLE_WEB_SEARCH === "true";
  const webSearchSupport = !hasTextConfig || !webSearchEnabled || responsesSupport === "unsupported"
    ? "unsupported"
    : declaredCapability(env.AI_WEB_SEARCH_SUPPORTED);
  const textSupport = !hasTextConfig
    ? "unsupported"
    : responsesSupport === "supported" || chatCompletionsSupport === "supported"
      ? "supported"
      : responsesSupport === "unsupported" && chatCompletionsSupport === "unsupported"
        ? "unsupported"
        : "unknown";

  return {
    configurationReady: hasTextConfig,
    baseUrlConfigured,
    textModel,
    imageModel,
    textProtocol,
    effectiveTextProtocol,
    textSupport,
    responsesSupport,
    webSearchSupport,
    chatCompletionsSupport,
    webSearchEnabled,
    textSupported: textSupport === "supported",
    jsonSupported: textSupport === "supported",
    responsesSupported: responsesSupport === "supported",
    webSearchSupported: webSearchSupport === "supported",
    chatCompletionsSupported: chatCompletionsSupport === "supported",
    imageModelConfigured: Boolean(imageModel),
  };
}

export function assertCanUseWebSearch(capabilities: AiProviderCapabilitySummary) {
  if (!capabilities.configurationReady) {
    throw new Error("The AI provider configuration is incomplete. Configure the relay URL, model, and credential first.");
  }

  if (!capabilities.webSearchEnabled) {
    throw new Error("Online release research is disabled. Set AI_ENABLE_WEB_SEARCH=true after verifying the relay.");
  }

  if (capabilities.responsesSupport === "unsupported") {
    throw new Error("The configured relay does not have Responses API enabled. Online release research cannot run.");
  }

  if (capabilities.webSearchSupport === "unsupported") {
    throw new Error("The current OpenAI-compatible relay does not support web_search, so online release research cannot run.");
  }
}
