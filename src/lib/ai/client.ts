import OpenAI from "openai";
import { requireAiProviderConfig, requireRelayBaseUrl } from "@/lib/ai/provider-capabilities";

const textModel = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5";
const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

export const aiConfig = {
  textModel,
  imageModel,
};

export function createAiClient() {
  const config = requireAiProviderConfig();

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

export async function createWebSearchResponse(input: {
  systemPrompt: string;
  userPrompt: string;
  forceSearch?: boolean;
}) {
  requireRelayBaseUrl();
  const client = createAiClient();

  return client.responses.create({
    model: textModel,
    tools: [{ type: "web_search" }],
    tool_choice: input.forceSearch ? "required" : "auto",
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
  } as Parameters<typeof client.responses.create>[0]);
}

export async function runStructuredReleaseSearch(input: {
  artistName: string;
  query: string;
}) {
  return createWebSearchResponse({
    forceSearch: true,
    systemPrompt:
      "You structure real CD release research for a collector database. Preserve source URLs and never invent cover art.",
    userPrompt: `Artist: ${input.artistName}\nResearch request: ${input.query}`,
  });
}

export async function generateUiAssetPlaceholder(input: { prompt: string }) {
  const client = createAiClient();

  return client.images.generate({
    model: imageModel,
    prompt: input.prompt,
    size: "1024x1024",
  });
}
