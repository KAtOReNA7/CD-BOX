import type { Response as OpenAiResponse } from "openai/resources/responses/responses";

export type SseEvent = {
  event: string | null;
  data: string;
};

function parseEventBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }

  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

export async function* readSseEvents(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new Error("Provider returned an empty event stream body.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseEventBlock(block);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const trailing = parseEventBlock(buffer.replace(/\r\n/g, "\n"));
    if (trailing) yield trailing;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function eventPayload(event: SseEvent) {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    throw new Error(`Provider returned invalid SSE JSON for ${event.event ?? "unnamed event"}.`);
  }
}

function providerStreamError(payload: Record<string, unknown>, fallback: string) {
  const nested = payload.error && typeof payload.error === "object"
    ? payload.error as Record<string, unknown>
    : null;
  const message = nested && typeof nested.message === "string"
    ? nested.message
    : typeof payload.message === "string"
      ? payload.message
      : fallback;
  return new Error(message);
}

export async function consumeResponsesEventStream(body: ReadableStream<Uint8Array> | null) {
  let eventCount = 0;

  for await (const event of readSseEvents(body)) {
    if (event.data === "[DONE]") continue;
    const payload = eventPayload(event);
    const type = typeof payload.type === "string" ? payload.type : event.event;
    eventCount += 1;

    if (type === "error") {
      throw providerStreamError(payload, "Responses API stream returned an error event.");
    }

    if (type === "response.failed" || type === "response.incomplete") {
      const response = payload.response && typeof payload.response === "object"
        ? payload.response as Record<string, unknown>
        : null;
      throw providerStreamError(response ?? payload, `Responses API ended with ${type}.`);
    }

    if (type === "response.completed") {
      const response = payload.response;
      if (!response || typeof response !== "object") {
        throw new Error("Responses API completion event did not contain a response object.");
      }
      return { response: response as OpenAiResponse, eventCount };
    }
  }

  throw new Error("Responses API stream ended before response.completed was received.");
}

function deltaText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")
    .join("");
}

export async function consumeChatCompletionsEventStream(body: ReadableStream<Uint8Array> | null) {
  let outputText = "";
  let eventCount = 0;

  for await (const event of readSseEvents(body)) {
    if (event.data === "[DONE]") {
      return { outputText, eventCount };
    }
    const payload = eventPayload(event);
    eventCount += 1;

    if (payload.error) {
      throw providerStreamError(payload, "Chat Completions stream returned an error.");
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    let eventCompleted = false;
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const typedChoice = choice as Record<string, unknown>;
      const delta = typedChoice.delta && typeof typedChoice.delta === "object"
        ? typedChoice.delta as Record<string, unknown>
        : null;
      outputText += deltaText(delta?.content);
      if (typedChoice.finish_reason !== null && typedChoice.finish_reason !== undefined) eventCompleted = true;
    }

    if (eventCompleted) return { outputText, eventCount };
  }

  throw new Error("Chat Completions stream ended before a completion marker was received.");
}
