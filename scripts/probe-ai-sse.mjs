function parseEventBlock(block) {
  let event = null;
  const data = [];

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

export async function* readSseEvents(body) {
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
        const event = parseEventBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
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

function payloadFrom(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    throw new Error(`Provider returned invalid SSE JSON for ${event.event ?? "unnamed event"}.`);
  }
}

function streamError(payload, fallback) {
  return new Error(payload?.error?.message ?? payload?.message ?? fallback);
}

export async function consumeResponsesEventStream(body) {
  let eventCount = 0;

  for await (const event of readSseEvents(body)) {
    if (event.data === "[DONE]") continue;
    const payload = payloadFrom(event);
    const type = payload?.type ?? event.event;
    eventCount += 1;

    if (type === "error") throw streamError(payload, "Responses API stream returned an error event.");
    if (type === "response.failed" || type === "response.incomplete") {
      throw streamError(payload?.response ?? payload, `Responses API ended with ${type}.`);
    }
    if (type === "response.completed") {
      if (!payload?.response || typeof payload.response !== "object") {
        throw new Error("Responses API completion event did not contain a response object.");
      }
      return { response: payload.response, eventCount };
    }
  }

  throw new Error("Responses API stream ended before response.completed was received.");
}
