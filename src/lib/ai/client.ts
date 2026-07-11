import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions/completions";
import type {
  Response,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";
import {
  type AiTextProtocol,
  requireRuntimeAiProviderConfig,
} from "@/lib/ai/provider-capabilities";

const textModel = process.env.OPENAI_TEXT_MODEL ?? "openai/gpt-5.6-sol";
const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

export const aiConfig = {
  textModel,
  imageModel,
};

type CompletedResponsesText = Response & {
  output_text: string;
  transport: "responses";
};

export type CompletedChatText = {
  id: string;
  status: "completed";
  error: null;
  output: Response["output"];
  output_text: string;
  transport: "chat-completions";
  raw_response: ChatCompletion;
};

export type CompletedAiTextResponse = CompletedResponsesText | CompletedChatText;

type RuntimeAiConfig = Awaited<ReturnType<typeof requireRuntimeAiProviderConfig>>;

function newAiClient(config: RuntimeAiConfig) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: config.requestTimeoutMs,
  });
}

export async function createAiClient(apiKeyOverride?: string) {
  const config = await requireRuntimeAiProviderConfig(process.env, apiKeyOverride);

  return newAiClient(config);
}

export function collectResponseOutputText(output: Response["output"]) {
  return output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("");
}

function collectResponseRefusal(output: Response["output"]) {
  return output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .filter((content) => content.type === "refusal")
    .map((content) => content.refusal)
    .join("\n");
}

export class ResponsesFunctionalUnsupportedError extends Error {
  readonly code = "responses_empty_output";

  constructor() {
    super("Responses API completed without assistant output text. The relay may expose the endpoint without functional text generation support.");
    this.name = "ResponsesFunctionalUnsupportedError";
  }
}

export function normalizeCompletedResponsesText(response: Response): CompletedResponsesText {
  const refusal = collectResponseRefusal(response.output);
  if (refusal) {
    throw new Error(`Responses API refused the text request: ${refusal}`);
  }

  const completed = {
    ...response,
    output_text: collectResponseOutputText(response.output),
    transport: "responses" as const,
  };

  if (!completed.output_text.trim()) {
    throw new ResponsesFunctionalUnsupportedError();
  }

  return completed;
}

async function createCompletedStreamingResponse(
  client: OpenAI,
  params: Omit<ResponseCreateParamsStreaming, "stream">,
): Promise<CompletedResponsesText> {
  const stream = await client.responses.create({ ...params, stream: true });

  for await (const event of stream) {
    if (event.type === "response.completed") {
      return normalizeCompletedResponsesText(event.response);
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }

    if (event.type === "response.failed" || event.type === "response.incomplete") {
      throw new Error(event.response.error?.message ?? `Responses API ended with ${event.response.status}.`);
    }
  }

  throw new Error("Responses API stream ended before a completed response was received.");
}

function errorField(error: unknown, field: string) {
  if (!error || typeof error !== "object") return null;
  const direct = field in error ? (error as Record<string, unknown>)[field] : null;
  if (typeof direct === "string" || typeof direct === "number") return direct;
  const nested = "error" in error && error.error && typeof error.error === "object"
    ? (error.error as Record<string, unknown>)[field]
    : null;
  return typeof nested === "string" || typeof nested === "number" ? nested : null;
}

export function isResponsesEndpointUnsupportedError(error: unknown) {
  if (error instanceof ResponsesFunctionalUnsupportedError) return true;

  const statusValue = errorField(error, "status");
  const status = typeof statusValue === "number" ? statusValue : Number(statusValue);
  const code = String(errorField(error, "code") ?? "").toLowerCase();
  const type = String(errorField(error, "type") ?? "").toLowerCase();
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(errorField(error, "message") ?? "").toLowerCase();
  const modelOrDeploymentUnavailable = /(?:model|deployment).*(?:not found|does not exist|unavailable|unknown|unsupported)|(?:no such|unknown|unsupported).*(?:model|deployment)/i.test(message);

  if (
    code.includes("model_not_found") ||
    type.includes("model_not_found") ||
    code.includes("invalid_api_key") ||
    code.includes("insufficient_quota") ||
    modelOrDeploymentUnavailable
  ) {
    return false;
  }

  if (status === 405 || status === 501) return true;
  if (status === 404) {
    return true;
  }

  const mentionsResponsesEndpoint = /responses? api|\/(?:v1\/)?responses\b|endpoint|request url/i.test(message);
  const saysUnsupported = /unsupported|not supported|unknown|not found|unrecognized|does not exist/i.test(message);
  return (status === 400 || status === 422) && mentionsResponsesEndpoint && saysUnsupported;
}

export async function runTextProtocolFallback<T>(input: {
  protocol: AiTextProtocol;
  responses: () => Promise<T>;
  chatCompletions: () => Promise<T>;
}) {
  if (input.protocol === "chat-completions") {
    return input.chatCompletions();
  }

  try {
    return await input.responses();
  } catch (error) {
    if (input.protocol === "responses" || !isResponsesEndpointUnsupportedError(error)) {
      throw error;
    }

    return input.chatCompletions();
  }
}

export function collectChatCompletionText(completion: ChatCompletion) {
  const content: unknown = completion.choices?.[0]?.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part: unknown) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")
    .join("");
}

function normalizedChatResponse(completion: ChatCompletion): CompletedChatText {
  const outputText = collectChatCompletionText(completion);
  if (!outputText) {
    throw new Error("Chat Completions ended without assistant text.");
  }

  return {
    id: completion.id,
    status: "completed",
    error: null,
    output: [
      {
        id: completion.id,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: outputText, annotations: [] }],
      },
    ],
    output_text: outputText,
    transport: "chat-completions",
    raw_response: completion,
  };
}

function maxCompletionTokens(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.AI_MAX_COMPLETION_TOKENS ?? 16_384);
  if (!Number.isInteger(configured) || configured < 256 || configured > 32_768) {
    throw new Error("AI_MAX_COMPLETION_TOKENS must be an integer between 256 and 32768.");
  }

  return configured;
}

async function createChatTextResponse(
  client: OpenAI,
  config: RuntimeAiConfig,
  input: { systemPrompt: string; userPrompt: string },
) {
  // This relay exposes a conforming Chat Completions stream, but its
  // non-streaming compatibility response can contain an empty `content` even
  // when the model generated text. Use the streaming transport for runtime
  // generation and fail closed on incomplete/non-text completions.
  const stream = await client.chat.completions.create({
    model: config.textModel,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    reasoning_effort: config.reasoningEffort,
    max_completion_tokens: maxCompletionTokens(),
    stream: true,
    stream_options: { include_usage: true },
  });

  let id = "";
  let created = 0;
  let model = config.textModel;
  let outputText = "";
  let refusal = "";
  let finishReason: ChatCompletion.Choice["finish_reason"] | null = null;
  let usage: ChatCompletion["usage"];

  for await (const chunk of stream) {
    const typedChunk = chunk as ChatCompletionChunk;
    id ||= typedChunk.id;
    created ||= typedChunk.created;
    model = typedChunk.model || model;
    if (typedChunk.usage) usage = typedChunk.usage;

    const choices = Array.isArray(typedChunk.choices) ? typedChunk.choices : [];
    const choice = choices.find((item) => item.index === 0) ?? choices[0];
    if (!choice) continue;
    if (typeof choice.delta.content === "string") outputText += choice.delta.content;
    if (typeof choice.delta.refusal === "string") refusal += choice.delta.refusal;
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  if (refusal.trim()) {
    throw new Error(`Chat Completions refused the text request: ${refusal}`);
  }
  if (!finishReason) {
    throw new Error("Chat Completions stream ended before a completion marker was received.");
  }
  if (finishReason !== "stop") {
    throw new Error(`Chat Completions ended with ${finishReason} before a complete text response was available.`);
  }

  const completion: ChatCompletion = {
    id: id || `chat-${Date.now()}`,
    created,
    model,
    object: "chat.completion",
    choices: [{
      index: 0,
      finish_reason: finishReason,
      logprobs: null,
      message: {
        role: "assistant",
        content: outputText,
        refusal: null,
      },
    }],
    ...(usage ? { usage } : {}),
  };

  return normalizedChatResponse(completion);
}

export async function createResponsesTextResponse(input: {
  systemPrompt: string;
  userPrompt: string;
}, apiKeyOverride?: string) {
  const config = await requireRuntimeAiProviderConfig(process.env, apiKeyOverride);
  const client = newAiClient(config);

  return createCompletedStreamingResponse(client, {
    model: config.textModel,
    reasoning: { effort: config.reasoningEffort },
    input: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  });
}

export async function createWebSearchResponse(input: {
  systemPrompt: string;
  userPrompt: string;
  forceSearch?: boolean;
}, apiKeyOverride?: string) {
  const config = await requireRuntimeAiProviderConfig(process.env, apiKeyOverride);
  const client = newAiClient(config);

  return createCompletedStreamingResponse(client, {
    model: config.textModel,
    reasoning: { effort: config.reasoningEffort },
    tools: [{ type: "web_search" }],
    tool_choice: input.forceSearch ? "required" : "auto",
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content: input.systemPrompt,
      },
      {
        role: "user",
        content: input.userPrompt,
      },
    ],
  });
}

export async function createTextResponse(input: {
  systemPrompt: string;
  userPrompt: string;
}, apiKeyOverride?: string) {
  const config = await requireRuntimeAiProviderConfig(process.env, apiKeyOverride);
  const client = newAiClient(config);

  return runTextProtocolFallback<CompletedAiTextResponse>({
    protocol: config.textProtocol,
    responses: () => createCompletedStreamingResponse(client, {
      model: config.textModel,
      reasoning: { effort: config.reasoningEffort },
      input: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    }),
    chatCompletions: () => createChatTextResponse(client, config, input),
  });
}

export async function runStructuredReleaseSearch(input: {
  artistName: string;
  query: string;
}, apiKeyOverride?: string) {
  return createWebSearchResponse({
    forceSearch: true,
    systemPrompt:
      "You structure real CD release research for a collector database. Preserve source URLs and never invent cover art.",
    userPrompt: `Artist: ${input.artistName}\nResearch request: ${input.query}`,
  }, apiKeyOverride);
}

export async function generateUiAssetPlaceholder(input: { prompt: string }, apiKeyOverride?: string) {
  const client = await createAiClient(apiKeyOverride);

  return client.images.generate({
    model: imageModel,
    prompt: input.prompt,
    size: "1024x1024",
  });
}
