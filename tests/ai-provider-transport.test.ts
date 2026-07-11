import assert from "node:assert/strict";
import type { Response } from "openai/resources/responses/responses";
import {
  createTextResponse,
  isResponsesEndpointUnsupportedError,
  normalizeCompletedResponsesText,
  ResponsesFunctionalUnsupportedError,
  runTextProtocolFallback,
} from "@/lib/ai/client";
import { resolveEffectiveAiTextProtocol } from "@/lib/ai/provider-capabilities";
import {
  consumeChatCompletionsEventStream,
  consumeResponsesEventStream,
} from "@/lib/ai/sse";

function byteStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function main() {
  assert.equal(isResponsesEndpointUnsupportedError({ status: 404, message: "Not Found" }), true);
  assert.equal(isResponsesEndpointUnsupportedError({ status: 405, message: "Method Not Allowed" }), true);
  assert.equal(
    isResponsesEndpointUnsupportedError({
      status: 400,
      message: "The /responses endpoint is not supported by this relay",
    }),
    true,
  );
  assert.equal(
    isResponsesEndpointUnsupportedError({ status: 404, code: "model_not_found", message: "Model not found" }),
    false,
  );
  assert.equal(isResponsesEndpointUnsupportedError({ status: 404, message: "No such model: gpt-test" }), false);
  assert.equal(isResponsesEndpointUnsupportedError({ status: 401, message: "Invalid API key" }), false);
  assert.equal(isResponsesEndpointUnsupportedError({ status: 429, code: "insufficient_quota" }), false);
  assert.equal(isResponsesEndpointUnsupportedError({ status: 500, message: "Internal error" }), false);
  assert.equal(
    isResponsesEndpointUnsupportedError({ status: 400, message: "Unknown endpoint /v1/responses" }),
    true,
  );
  assert.equal(
    isResponsesEndpointUnsupportedError({ status: 422, message: "Unsupported endpoint /responses" }),
    true,
  );
  assert.equal(
    isResponsesEndpointUnsupportedError({ status: 400, message: "Unknown model gpt-test for /responses" }),
    false,
  );

  const originalFetch = globalThis.fetch;
  const retryTestEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
    AI_TEXT_PROTOCOL: process.env.AI_TEXT_PROTOCOL,
    AI_RESPONSES_SUPPORTED: process.env.AI_RESPONSES_SUPPORTED,
    AI_CHAT_COMPLETIONS_SUPPORTED: process.env.AI_CHAT_COMPLETIONS_SUPPORTED,
    AI_REASONING_EFFORT: process.env.AI_REASONING_EFFORT,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
    AI_MAX_COMPLETION_TOKENS: process.env.AI_MAX_COMPLETION_TOKENS,
  };
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = "https://relay.example.com/v1";
  process.env.OPENAI_TEXT_MODEL = "gpt-test";
  process.env.AI_TEXT_PROTOCOL = "chat-completions";
  process.env.AI_RESPONSES_SUPPORTED = "false";
  process.env.AI_CHAT_COMPLETIONS_SUPPORTED = "true";
  process.env.AI_REASONING_EFFORT = "none";
  process.env.AI_REQUEST_TIMEOUT_MS = "30000";
  process.env.AI_MAX_COMPLETION_TOKENS = "2048";
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new globalThis.Response(
      JSON.stringify({ error: { message: "Synthetic server failure", type: "server_error" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  let generationError: unknown;
  try {
    await createTextResponse({ systemPrompt: "test", userPrompt: "test" });
  } catch (error) {
    generationError = error;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(retryTestEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.ok(generationError instanceof Error);
  assert.equal(fetchCalls, 1, "generation requests must not be retried automatically");

  const reasoningOnlyResponse = {
    id: "resp_reasoning_only",
    status: "completed",
    output: [{ type: "reasoning" }],
  } as unknown as Response;
  assert.throws(
    () => normalizeCompletedResponsesText(reasoningOnlyResponse),
    ResponsesFunctionalUnsupportedError,
  );

  let emptyOutputFallbackCalled = false;
  const emptyOutputFallback = await runTextProtocolFallback({
    protocol: "auto",
    responses: async () => {
      normalizeCompletedResponsesText(reasoningOnlyResponse);
      return "unreachable";
    },
    chatCompletions: async () => {
      emptyOutputFallbackCalled = true;
      return "chat-after-empty-responses";
    },
  });
  assert.equal(emptyOutputFallback, "chat-after-empty-responses");
  assert.equal(emptyOutputFallbackCalled, true);

  let explicitResponsesFallbackCalled = false;
  await assert.rejects(
    () => runTextProtocolFallback({
      protocol: "responses",
      responses: async () => {
        normalizeCompletedResponsesText(reasoningOnlyResponse);
        return "unreachable";
      },
      chatCompletions: async () => {
        explicitResponsesFallbackCalled = true;
        return "should-not-run";
      },
    }),
    ResponsesFunctionalUnsupportedError,
  );
  assert.equal(explicitResponsesFallbackCalled, false);

  const refusalResponse = {
    id: "resp_refusal",
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "refusal", refusal: "Cannot comply" }],
    }],
  } as unknown as Response;
  let refusalError: unknown;
  try {
    normalizeCompletedResponsesText(refusalResponse);
  } catch (error) {
    refusalError = error;
  }
  assert.ok(refusalError instanceof Error);
  assert.equal(isResponsesEndpointUnsupportedError(refusalError), false);

  const declaredChatCalls: string[] = [];
  const declaredChat = await runTextProtocolFallback({
    protocol: resolveEffectiveAiTextProtocol({
      NODE_ENV: "test",
      AI_TEXT_PROTOCOL: "auto",
      AI_RESPONSES_SUPPORTED: "false",
      AI_CHAT_COMPLETIONS_SUPPORTED: "true",
    }),
    responses: async () => {
      declaredChatCalls.push("responses");
      return "should-not-run";
    },
    chatCompletions: async () => {
      declaredChatCalls.push("chat");
      return "declared-chat";
    },
  });
  assert.equal(declaredChat, "declared-chat");
  assert.deepEqual(declaredChatCalls, ["chat"]);

  const responseFirstCalls: string[] = [];
  const responseFirst = await runTextProtocolFallback({
    protocol: "auto",
    responses: async () => {
      responseFirstCalls.push("responses");
      return "responses-result";
    },
    chatCompletions: async () => {
      responseFirstCalls.push("chat");
      return "chat-result";
    },
  });
  assert.equal(responseFirst, "responses-result");
  assert.deepEqual(responseFirstCalls, ["responses"]);

  const fallbackCalls: string[] = [];
  const fallback = await runTextProtocolFallback({
    protocol: "auto",
    responses: async () => {
      fallbackCalls.push("responses");
      throw { status: 404, message: "Not Found" };
    },
    chatCompletions: async () => {
      fallbackCalls.push("chat");
      return "chat-result";
    },
  });
  assert.equal(fallback, "chat-result");
  assert.deepEqual(fallbackCalls, ["responses", "chat"]);

  let unsafeFallbackCalled = false;
  await assert.rejects(
    () => runTextProtocolFallback({
      protocol: "auto",
      responses: async () => {
        throw { status: 401, message: "Invalid API key" };
      },
      chatCompletions: async () => {
        unsafeFallbackCalled = true;
        return "should-not-run";
      },
    }),
  );
  assert.equal(unsafeFallbackCalled, false);

  const completedResponse = {
    id: "resp_test",
    object: "response",
    status: "completed",
    output: [],
    output_text: "ok",
    error: null,
  };
  const completedEvent = `event: response.completed\r\ndata: ${JSON.stringify({
    type: "response.completed",
    response: completedResponse,
  })}\r\n\r\n`;
  const responsesStream = byteStream([
    "event: response.created\r\ndata: {\"type\":\"response.created\"}\r\n\r",
    `\n${completedEvent.slice(0, 37)}`,
    `${completedEvent.slice(37)}data: [DONE]\r\n\r\n`,
  ]);
  const consumedResponses = await consumeResponsesEventStream(responsesStream);
  assert.equal(consumedResponses.response.id, "resp_test");
  assert.equal(consumedResponses.response.status, "completed");
  assert.equal(consumedResponses.eventCount, 2);

  let openStreamCancelled = false;
  const encoder = new TextEncoder();
  const openStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(completedEvent));
    },
    cancel() {
      openStreamCancelled = true;
    },
  });
  const earlyCompleted = await consumeResponsesEventStream(openStream);
  assert.equal(earlyCompleted.response.id, "resp_test");
  assert.equal(openStreamCancelled, true);

  await assert.rejects(
    () => consumeResponsesEventStream(byteStream([
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n",
      "data: [DONE]\n\n",
    ])),
    /response\.completed/,
  );

  const chatStream = byteStream([
    "data: {\"choices\":[{\"delta\":{\"content\":\"o\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"delta\":{\"content\":\"k\"},\"finish_reason\":\"stop\"}]}\n\n",
    "data: [DONE]\n\n",
  ]);
  const consumedChat = await consumeChatCompletionsEventStream(chatStream);
  assert.equal(consumedChat.outputText, "ok");
  assert.equal(consumedChat.eventCount, 2);

  let doneStreamCancelled = false;
  const doneStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n" +
        "data: [DONE]\n\n",
      ));
    },
    cancel() {
      doneStreamCancelled = true;
    },
  });
  const doneResult = await consumeChatCompletionsEventStream(doneStream);
  assert.equal(doneResult.outputText, "ok");
  assert.equal(doneStreamCancelled, true);

  let finishReasonStreamCancelled = false;
  const finishReasonStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n",
      ));
    },
    cancel() {
      finishReasonStreamCancelled = true;
    },
  });
  const finishReasonResult = await consumeChatCompletionsEventStream(finishReasonStream);
  assert.equal(finishReasonResult.outputText, "ok");
  assert.equal(finishReasonStreamCancelled, true);
}

main().then(() => {
  console.log("AI provider transport test passed.");
});
