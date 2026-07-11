import assert from "node:assert/strict";
import type { Response } from "openai/resources/responses/responses";
import { collectResponseOutputText } from "@/lib/ai/client";
import {
  assertCanUseWebSearch,
  getConfiguredProviderCapabilities,
  redactSecret,
  requireAiProviderConfig,
  requireRelayBaseUrl,
  requireRuntimeAiProviderConfig,
  sanitizeErrorMessage,
} from "@/lib/ai/provider-capabilities";
import { createAndRunReleaseResearchTask } from "@/lib/ai/release-research";

assert.throws(
  () => requireRelayBaseUrl({ NODE_ENV: "test" }),
  /OPENAI_BASE_URL|relay base URL/,
);

assert.equal(redactSecret("sk-1234567890abcdef"), "sk-1...cdef");
assert.equal(sanitizeErrorMessage("bad key sk-secret-value", "sk-secret-value"), "bad key sk-s...alue");
assert.equal(
  collectResponseOutputText([
    { type: "reasoning" },
    {
      type: "message",
      content: [
        { type: "output_text", text: "streamed " },
        { type: "output_text", text: "response" },
      ],
    },
  ] as Response["output"]),
  "streamed response",
);

const noSearch = getConfiguredProviderCapabilities({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test",
  OPENAI_BASE_URL: "https://relay.example.com/v1",
  OPENAI_TEXT_MODEL: "gpt-5.5",
  AI_ENABLE_WEB_SEARCH: "false",
});
assert.equal(noSearch.responsesSupported, true);
assert.equal(noSearch.webSearchSupported, false);
assert.throws(() => assertCanUseWebSearch(noSearch), /web_search/);

const gatewayConfig = requireAiProviderConfig({
  NODE_ENV: "test",
  AI_PROVIDER_MODE: "vercel-ai-gateway",
  VERCEL_OIDC_TOKEN: "oidc-test",
  OPENAI_API_KEY: "ignored-custom-key",
  OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
  OPENAI_TEXT_MODEL: "openai/gpt-5.4-mini",
});
assert.equal(gatewayConfig.apiKey, "oidc-test");
assert.equal(gatewayConfig.providerMode, "vercel-ai-gateway");
assert.equal(
  getConfiguredProviderCapabilities({
    NODE_ENV: "test",
    AI_PROVIDER_MODE: "vercel-ai-gateway",
    VERCEL_OIDC_TOKEN: "oidc-test",
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    OPENAI_TEXT_MODEL: "openai/gpt-5.4-mini",
    AI_ENABLE_WEB_SEARCH: "true",
  }).webSearchSupported,
  true,
);

const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
  AI_ENABLE_WEB_SEARCH: process.env.AI_ENABLE_WEB_SEARCH,
};
process.env.OPENAI_API_KEY = "sk-test";
process.env.OPENAI_BASE_URL = "https://relay.example.com/v1";
process.env.OPENAI_TEXT_MODEL = "gpt-5.5";
process.env.AI_ENABLE_WEB_SEARCH = "false";

async function main() {
  const runtimeGateway = await requireRuntimeAiProviderConfig(
    {
      NODE_ENV: "test",
      AI_PROVIDER_MODE: "vercel-ai-gateway",
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
      OPENAI_TEXT_MODEL: "openai/gpt-5.4-mini",
    },
    "request-oidc-token",
  );
  assert.equal(runtimeGateway.apiKey, "request-oidc-token");

  await assert.rejects(
    () =>
      createAndRunReleaseResearchTask(
        {
          artistName: "Miho Nakayama",
          country: "Japan",
          target: "ORIGINAL_CD",
          excludeReissues: true,
          includeCollaborations: true,
          includeLiveRemixBest: true,
        },
        "user-test",
      ),
    /web_search/,
  );

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const missingResponses = {
  ...noSearch,
  responsesSupported: false,
  webSearchSupported: false,
};
assert.throws(() => assertCanUseWebSearch(missingResponses), /Responses API/);

assert.equal(noSearch.chatCompletionsSupported, true);
assert.equal(noSearch.webSearchSupported, false);

main().then(() => {
  console.log("AI provider config test passed.");
}).catch((error) => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  throw error;
});
