import OpenAI from "openai";

const textModel = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5";
const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

export const aiConfig = {
  textModel,
  imageModel,
};

export function createAiClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

export async function runStructuredReleaseSearch(input: {
  artistName: string;
  query: string;
}) {
  const client = createAiClient();

  return client.responses.create({
    model: textModel,
    input: [
      {
        role: "system",
        content:
          "You structure real CD release research for a collector database. Preserve source URLs and never invent cover art.",
      },
      {
        role: "user",
        content: `Artist: ${input.artistName}\nResearch request: ${input.query}`,
      },
    ],
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
