const env = process.env;

function redact(value) {
  if (!value) return "missing";
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sanitize(message) {
  if (!env.OPENAI_API_KEY) return message;
  return String(message).split(env.OPENAI_API_KEY).join(redact(env.OPENAI_API_KEY));
}

function baseUrl(path) {
  return `${env.OPENAI_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function postJson(path, body) {
  const response = await fetch(baseUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const error = json?.error ?? json ?? {};
    throw {
      status: response.status,
      type: error.type ?? error.code ?? "provider_error",
      message: sanitize(error.message ?? text),
    };
  }

  return json ?? text;
}

function extractText(payload) {
  if (typeof payload === "string") return payload;
  if (payload.output_text) return payload.output_text;
  if (payload.choices?.[0]?.message?.content) return payload.choices[0].message.content;
  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function extractJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found.");
  return JSON.parse(match[0]);
}

function logProbe(name, result) {
  console.log(`[${name}] ${JSON.stringify(result, null, 2)}`);
}

const config = {
  apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
  apiKeyRedacted: redact(env.OPENAI_API_KEY),
  baseUrlConfigured: Boolean(env.OPENAI_BASE_URL),
  baseUrl: env.OPENAI_BASE_URL ?? null,
  textModel: env.OPENAI_TEXT_MODEL ?? null,
  imageModel: env.OPENAI_IMAGE_MODEL ?? null,
};

logProbe("config", config);

const summary = {
  baseUrlConfigured: config.baseUrlConfigured,
  textModel: config.textModel,
  imageModel: config.imageModel,
  textSupported: false,
  jsonSupported: false,
  responsesSupported: false,
  webSearchSupported: false,
  chatCompletionsSupported: false,
  imageModelConfigured: Boolean(config.imageModel),
};

if (!config.apiKeyConfigured || !config.baseUrlConfigured || !config.textModel) {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} else {
  try {
    const chat = await postJson("/chat/completions", {
      model: config.textModel,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      temperature: 0,
    });
    summary.chatCompletionsSupported = true;
    summary.textSupported = /ok/i.test(extractText(chat));
    logProbe("chat-completions", { ok: true, text: extractText(chat).slice(0, 120) });
  } catch (error) {
    logProbe("chat-completions", { ok: false, error });
  }

  try {
    const jsonPayload = await postJson("/chat/completions", {
      model: config.textModel,
      messages: [{ role: "user", content: 'Return only JSON: {"ok":true,"provider":"openai-compatible"}' }],
      temperature: 0,
    });
    const parsed = extractJsonObject(extractText(jsonPayload));
    summary.jsonSupported = parsed.ok === true && parsed.provider === "openai-compatible";
    logProbe("json-output", { ok: summary.jsonSupported, parsed });
  } catch (error) {
    logProbe("json-output", { ok: false, error: { message: sanitize(error.message ?? JSON.stringify(error)) } });
  }

  try {
    const responses = await postJson("/responses", {
      model: config.textModel,
      input: "Reply with exactly: ok",
    });
    summary.responsesSupported = true;
    summary.textSupported = summary.textSupported || /ok/i.test(extractText(responses));
    logProbe("responses", { ok: true, text: extractText(responses).slice(0, 120) });
  } catch (error) {
    logProbe("responses", { ok: false, error });
  }

  if (summary.responsesSupported) {
    try {
      const web = await postJson("/responses", {
        model: config.textModel,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: "Search: Miho Nakayama King Records discography CD. Return one sentence.",
      });
      const text = extractText(web);
      summary.webSearchSupported = Boolean(text);
      logProbe("web-search", { ok: summary.webSearchSupported, text: text.slice(0, 240) });
    } catch (error) {
      summary.webSearchSupported = false;
      logProbe("web-search", { ok: false, error });
    }
  } else {
    logProbe("web-search", { ok: false, skipped: "responsesSupported=false" });
  }

  logProbe("image-model", {
    ok: summary.imageModelConfigured,
    note: "Image generation is not executed in this probe to avoid cost.",
  });

  console.log(JSON.stringify(summary, null, 2));
}
