import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";
import { requireRelayBaseUrl, requireRuntimeAiProviderConfig } from "@/lib/ai/provider-capabilities";

const textModel = process.env.OPENAI_TEXT_MODEL ?? "openai/gpt-5.4-mini";
const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

export const aiConfig = {
  textModel,
  imageModel,
};

export async function createAiClient(apiKeyOverride?: string) {
  const config = await requireRuntimeAiProviderConfig(process.env, apiKeyOverride);

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 1,
    timeout: 120_000,
  });
}

export function collectResponseOutputText(output: Response["output"]) {
  return output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("");
}

function addOutputText(response: Response) {
  response.output_text = collectResponseOutputText(response.output);

  return response;
}

async function createCompletedStreamingResponse(
  params: Omit<ResponseCreateParamsStreaming, "stream">,
  apiKeyOverride?: string,
): Promise<Response> {
  const client = await createAiClient(apiKeyOverride);
  const stream = await client.responses.create({ ...params, stream: true });

  for await (const event of stream) {
    if (event.type === "response.completed") {
      return addOutputText(event.response);
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

export async function createWebSearchResponse(input: {
  systemPrompt: string;
  userPrompt: string;
  forceSearch?: boolean;
}, apiKeyOverride?: string) {
  requireRelayBaseUrl();

  return createCompletedStreamingResponse({
    model: textModel,
    reasoning: { effort: "low" },
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
  }, apiKeyOverride);
}

export async function createTextResponse(input: {
  systemPrompt: string;
  userPrompt: string;
}, apiKeyOverride?: string) {
  requireRelayBaseUrl();

  return createCompletedStreamingResponse({
    model: textModel,
    reasoning: { effort: "low" },
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
  }, apiKeyOverride);
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
