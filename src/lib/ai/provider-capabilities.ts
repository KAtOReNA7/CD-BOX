import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";

export type AiProviderCapabilitySummary = {
  baseUrlConfigured: boolean;
  textModel: string | null;
  imageModel: string | null;
  textSupported: boolean;
  jsonSupported: boolean;
  responsesSupported: boolean;
  webSearchSupported: boolean;
  chatCompletionsSupported: boolean;
  imageModelConfigured: boolean;
};

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
  if (env.AI_PROVIDER_MODE === "vercel-ai-gateway") {
    return env.AI_GATEWAY_API_KEY ?? env.VERCEL_OIDC_TOKEN ?? null;
  }

  return env.OPENAI_API_KEY ?? null;
}

export function requireAiProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const providerMode = env.AI_PROVIDER_MODE ?? "openai-compatible";
  const apiKey = resolveAiCredential(env);
  const missing = ["OPENAI_BASE_URL", "OPENAI_TEXT_MODEL"].filter((key) => !env[key]);
  if (!apiKey) {
    missing.unshift(providerMode === "vercel-ai-gateway" ? "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN" : "OPENAI_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `CD-BOX requires an OpenAI-compatible relay configuration. Missing: ${missing.join(", ")}.`,
    );
  }

  return {
    apiKey: apiKey!,
    baseURL: requireRelayBaseUrl(env),
    textModel: env.OPENAI_TEXT_MODEL!,
    imageModel: env.OPENAI_IMAGE_MODEL ?? null,
    providerMode,
    webSearchEnabled: env.AI_ENABLE_WEB_SEARCH === "true",
    imageGenerationEnabled: env.AI_ENABLE_IMAGE_GENERATION === "true",
  };
}

export async function requireRuntimeAiProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  apiKeyOverride?: string,
) {
  const providerMode = env.AI_PROVIDER_MODE ?? "openai-compatible";
  let apiKey = apiKeyOverride ?? resolveAiCredential(env);

  if (!apiKey && providerMode === "vercel-ai-gateway") {
    apiKey = await getVercelOidcToken();
  }

  const runtimeEnv = {
    ...env,
    ...(providerMode === "vercel-ai-gateway"
      ? { AI_GATEWAY_API_KEY: apiKey ?? undefined }
      : { OPENAI_API_KEY: apiKey ?? undefined }),
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
  const hasRuntimeCredential =
    Boolean(resolveAiCredential(env)) ||
    (env.AI_PROVIDER_MODE === "vercel-ai-gateway" && env.VERCEL === "1");
  const hasTextConfig = Boolean(hasRuntimeCredential && baseUrlConfigured && env.OPENAI_TEXT_MODEL);

  return {
    baseUrlConfigured,
    textModel,
    imageModel,
    textSupported: hasTextConfig,
    jsonSupported: hasTextConfig,
    responsesSupported: hasTextConfig,
    webSearchSupported: hasTextConfig && env.AI_ENABLE_WEB_SEARCH === "true",
    chatCompletionsSupported: hasTextConfig,
    imageModelConfigured: Boolean(imageModel),
  };
}

export function assertCanUseWebSearch(capabilities: AiProviderCapabilitySummary) {
  if (!capabilities.responsesSupported) {
    throw new Error("The configured relay does not have Responses API enabled. Online release research cannot run.");
  }

  if (!capabilities.webSearchSupported) {
    throw new Error("The current OpenAI-compatible relay does not support web_search, so online release research cannot run.");
  }
}
