import assert from "node:assert/strict";
import test from "node:test";
import { runProviderCheck } from "@/lib/ai/provider-health";

test("provider diagnostics reuse identical work and reject a concurrent different check", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
    AI_TEXT_PROTOCOL: process.env.AI_TEXT_PROTOCOL,
    AI_REASONING_EFFORT: process.env.AI_REASONING_EFFORT,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
  };
  let resolveFetch!: (response: Response) => void;
  let fetchCalls = 0;

  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "https://relay.example/v1";
  process.env.OPENAI_TEXT_MODEL = "test-model";
  process.env.AI_TEXT_PROTOCOL = "chat-completions";
  process.env.AI_REASONING_EFFORT = "none";
  process.env.AI_REQUEST_TIMEOUT_MS = "30000";
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;

  try {
    const first = runProviderCheck("models");
    const duplicate = runProviderCheck("models");
    assert.equal(duplicate, first);

    const busy = await runProviderCheck("chat");
    assert.equal(busy.ok, false);
    assert.equal(busy.errorCode, "diagnostic_in_progress");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fetchCalls, 1);

    resolveFetch(new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const completed = await first;
    assert.equal(completed.ok, true);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
