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

export function requireRelayBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  if (!env.OPENAI_BASE_URL) {
    throw new Error("CD-BOX requires an OpenAI-compatible relay base URL. Set OPENAI_BASE_URL before using AI features.");
  }

  return env.OPENAI_BASE_URL;
}

export function requireAiProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const missing = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_TEXT_MODEL"].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `CD-BOX requires an OpenAI-compatible relay configuration. Missing: ${missing.join(", ")}.`,
    );
  }

  return {
    apiKey: env.OPENAI_API_KEY!,
    baseURL: env.OPENAI_BASE_URL!,
    textModel: env.OPENAI_TEXT_MODEL!,
    imageModel: env.OPENAI_IMAGE_MODEL ?? null,
    providerMode: env.AI_PROVIDER_MODE ?? "openai-compatible",
    webSearchEnabled: env.AI_ENABLE_WEB_SEARCH === "true",
    imageGenerationEnabled: env.AI_ENABLE_IMAGE_GENERATION === "true",
  };
}

export function getConfiguredProviderCapabilities(env: NodeJS.ProcessEnv = process.env): AiProviderCapabilitySummary {
  const baseUrlConfigured = Boolean(env.OPENAI_BASE_URL);
  const textModel = env.OPENAI_TEXT_MODEL ?? null;
  const imageModel = env.OPENAI_IMAGE_MODEL ?? null;
  const hasTextConfig = Boolean(env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_TEXT_MODEL);

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
