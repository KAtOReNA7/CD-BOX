import assert from "node:assert/strict";
import type { Response } from "openai/resources/responses/responses";
import { collectResponseOutputText } from "@/lib/ai/client";
import {
  assertCanUseWebSearch,
  getConfiguredProviderCapabilities,
  redactSecret,
  resolveEffectiveAiTextProtocol,
  resolveAiReasoningEffort,
  resolveAiRequestTimeoutMs,
  resolveAiTextProtocol,
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
assert.equal(noSearch.configurationReady, true);
assert.equal(noSearch.textProtocol, "auto");
assert.equal(noSearch.effectiveTextProtocol, "auto");
assert.equal(noSearch.responsesSupport, "unknown");
assert.equal(noSearch.responsesSupported, false);
assert.equal(noSearch.webSearchSupported, false);
assert.throws(() => assertCanUseWebSearch(noSearch), /AI_ENABLE_WEB_SEARCH|web_search/);
assert.equal(resolveAiTextProtocol({ NODE_ENV: "test" }), "auto");
assert.equal(resolveEffectiveAiTextProtocol({ NODE_ENV: "test" }), "auto");
assert.equal(
  resolveEffectiveAiTextProtocol({
    NODE_ENV: "test",
    AI_TEXT_PROTOCOL: "auto",
    AI_RESPONSES_SUPPORTED: "false",
    AI_CHAT_COMPLETIONS_SUPPORTED: "true",
  }),
  "chat-completions",
);
assert.equal(
  resolveEffectiveAiTextProtocol({
    NODE_ENV: "test",
    AI_TEXT_PROTOCOL: "auto",
    AI_RESPONSES_SUPPORTED: "true",
    AI_CHAT_COMPLETIONS_SUPPORTED: "false",
  }),
  "responses",
);
assert.equal(
  resolveEffectiveAiTextProtocol({
    NODE_ENV: "test",
    AI_TEXT_PROTOCOL: "auto",
    AI_RESPONSES_SUPPORTED: "false",
  }),
  "chat-completions",
);
assert.throws(
  () => resolveEffectiveAiTextProtocol({
    NODE_ENV: "test",
    AI_RESPONSES_SUPPORTED: "false",
    AI_CHAT_COMPLETIONS_SUPPORTED: "false",
  }),
  /explicitly marked unsupported/,
);
assert.throws(
  () => resolveAiTextProtocol({ NODE_ENV: "test", AI_TEXT_PROTOCOL: "legacy" }),
  /AI_TEXT_PROTOCOL/,
);
assert.equal(resolveAiReasoningEffort({ NODE_ENV: "test" }), "none");
assert.equal(resolveAiReasoningEffort({ NODE_ENV: "test", AI_REASONING_EFFORT: "high" }), "high");
assert.throws(
  () => resolveAiReasoningEffort({ NODE_ENV: "test", AI_REASONING_EFFORT: "xhigh" }),
  /AI_REASONING_EFFORT/,
);
assert.equal(resolveAiRequestTimeoutMs({ NODE_ENV: "test" }), 300_000);
assert.equal(resolveAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_MS: "30000" }), 30_000);
assert.equal(resolveAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_MS: "600000" }), 600_000);
assert.throws(
  () => resolveAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_MS: "29999" }),
  /AI_REQUEST_TIMEOUT_MS/,
);

for (const invalidSettings of [
  { AI_REASONING_EFFORT: "xhigh" },
  { AI_REQUEST_TIMEOUT_MS: "29999" },
]) {
  const summary = getConfiguredProviderCapabilities({
    NODE_ENV: "test",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://relay.example/v1",
    OPENAI_TEXT_MODEL: "test-model",
    AI_TEXT_PROTOCOL: "chat-completions",
    AI_CHAT_COMPLETIONS_SUPPORTED: "true",
    ...invalidSettings,
  });
  assert.equal(summary.configurationReady, false);
  assert.equal(summary.effectiveTextProtocol, "unavailable");
  assert.equal(summary.textSupported, false);
}
assert.throws(
  () => resolveAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_MS: "600001" }),
  /AI_REQUEST_TIMEOUT_MS/,
);

const relayConfig = requireAiProviderConfig({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test",
  OPENAI_BASE_URL: "https://relay.example.com/v1",
  OPENAI_TEXT_MODEL: "gpt-5.6-terra",
});
assert.equal(relayConfig.apiKey, "sk-test");
assert.equal(relayConfig.textModel, "gpt-5.6-terra");
assert.equal(relayConfig.reasoningEffort, "none");
assert.equal(relayConfig.requestTimeoutMs, 300_000);

const autoChatConfig = requireAiProviderConfig({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test",
  OPENAI_BASE_URL: "https://relay.example.com/v1",
  OPENAI_TEXT_MODEL: "gpt-5.6-terra",
  AI_TEXT_PROTOCOL: "auto",
  AI_RESPONSES_SUPPORTED: "false",
  AI_CHAT_COMPLETIONS_SUPPORTED: "true",
});
assert.equal(autoChatConfig.requestedTextProtocol, "auto");
assert.equal(autoChatConfig.effectiveTextProtocol, "chat-completions");
assert.equal(autoChatConfig.textProtocol, "chat-completions");
assert.equal(
  getConfiguredProviderCapabilities({
    NODE_ENV: "test",
    OPENAI_API_KEY: "sk-test",
    OPENAI_BASE_URL: "https://relay.example.com/v1",
    OPENAI_TEXT_MODEL: "gpt-5.6-terra",
    AI_ENABLE_WEB_SEARCH: "true",
  }).webSearchSupport,
  "unknown",
);

const verifiedSearch = getConfiguredProviderCapabilities({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test",
  OPENAI_BASE_URL: "https://relay.example.com/v1",
  OPENAI_TEXT_MODEL: "gpt-5.5",
  AI_ENABLE_WEB_SEARCH: "true",
  AI_RESPONSES_SUPPORTED: "true",
  AI_WEB_SEARCH_SUPPORTED: "true",
});
assert.equal(verifiedSearch.responsesSupported, true);
assert.equal(verifiedSearch.webSearchSupported, true);
assert.doesNotThrow(() => assertCanUseWebSearch(verifiedSearch));

const unknownSearch = getConfiguredProviderCapabilities({
  NODE_ENV: "test",
  OPENAI_API_KEY: "sk-test",
  OPENAI_BASE_URL: "https://relay.example.com/v1",
  OPENAI_TEXT_MODEL: "gpt-5.5",
  AI_ENABLE_WEB_SEARCH: "true",
});
assert.equal(unknownSearch.responsesSupport, "unknown");
assert.equal(unknownSearch.webSearchSupport, "unknown");
assert.doesNotThrow(() => assertCanUseWebSearch(unknownSearch));

const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
  AI_ENABLE_WEB_SEARCH: process.env.AI_ENABLE_WEB_SEARCH,
  AI_TEXT_PROTOCOL: process.env.AI_TEXT_PROTOCOL,
  AI_RESPONSES_SUPPORTED: process.env.AI_RESPONSES_SUPPORTED,
  AI_CHAT_COMPLETIONS_SUPPORTED: process.env.AI_CHAT_COMPLETIONS_SUPPORTED,
  AI_WEB_SEARCH_SUPPORTED: process.env.AI_WEB_SEARCH_SUPPORTED,
  AI_REASONING_EFFORT: process.env.AI_REASONING_EFFORT,
  AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
};
process.env.OPENAI_API_KEY = "sk-test";
process.env.OPENAI_BASE_URL = "https://relay.example.com/v1";
process.env.OPENAI_TEXT_MODEL = "gpt-5.5";
process.env.AI_ENABLE_WEB_SEARCH = "false";
process.env.AI_TEXT_PROTOCOL = "auto";
delete process.env.AI_RESPONSES_SUPPORTED;
delete process.env.AI_CHAT_COMPLETIONS_SUPPORTED;
delete process.env.AI_WEB_SEARCH_SUPPORTED;
process.env.AI_REASONING_EFFORT = "none";
process.env.AI_REQUEST_TIMEOUT_MS = "300000";

async function main() {
  const runtimeRelay = await requireRuntimeAiProviderConfig(
    {
      NODE_ENV: "test",
      OPENAI_BASE_URL: "https://relay.example.com/v1",
      OPENAI_TEXT_MODEL: "gpt-5.6-terra",
    },
    "sk-request-override",
  );
  assert.equal(runtimeRelay.apiKey, "sk-request-override");

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
    /AI_ENABLE_WEB_SEARCH|web_search/,
  );

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const missingResponses = {
  ...noSearch,
  webSearchEnabled: true,
  responsesSupport: "unsupported" as const,
  webSearchSupport: "unsupported" as const,
  responsesSupported: false,
  webSearchSupported: false,
};
assert.throws(() => assertCanUseWebSearch(missingResponses), /Responses API/);

assert.equal(noSearch.chatCompletionsSupport, "unknown");
assert.equal(noSearch.chatCompletionsSupported, false);
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
