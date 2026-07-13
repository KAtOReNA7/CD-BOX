import assert from "node:assert/strict";
import test from "node:test";

import {
  AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS,
  AkinaNakamoriOfficialClient,
  type AkinaNakamoriOfficialRecoveryKey,
} from "@/lib/official-music/akina-nakamori";

const coverByKey: Record<AkinaNakamoriOfficialRecoveryKey, string> = {
  "SINGLE:50":
    "https://content-jp.umgi.net/products/um/umck-5257_demo_extralarge.jpg?26122017060855",
  "SINGLE:54":
    "https://content-jp.umgi.net/products/up/upch-5870_demo_extralarge.jpg?20032018014423",
  "SINGLE:55": "https://wmg.jp/packages/33269/images/tujyoban_jacket.jpg",
  "ORIGINAL_ALBUM:15":
    "https://content-jp.umgi.net/products/up/upch-7267_demo_extralarge.jpg?05022020085752",
};

function validHtml(key: AkinaNakamoriOfficialRecoveryKey) {
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  return `<!doctype html><html><head>
    <title>${spec.observedTitle} - 中森明菜</title>
    <meta property="og:image" content="${coverByKey[key]}">
    </head><body><main>
    <h1>${spec.observedTitle}</h1><h2>中森明菜 AKINA NAKAMORI</h2>
    <p>${spec.formatMarker}</p><p>${spec.releaseDate}</p>
    <p>${spec.catalogNumber}</p>
    ${spec.requiredWorkMarkers.map((marker) => `<p>${marker}</p>`).join("")}
    </main></body></html>`;
}

function successfulFetch(overrides: Partial<Record<AkinaNakamoriOfficialRecoveryKey, string>> = {}) {
  return async (input: string | URL) => {
    const sourceUrl = input.toString();
    const key = (Object.keys(AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS) as
      AkinaNakamoriOfficialRecoveryKey[]).find((candidate) =>
        AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[candidate].sourceUrl === sourceUrl);
    assert.ok(key, `unexpected URL ${sourceUrl}`);
    return new Response(overrides[key] ?? validHtml(key), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}

function client(fetchImpl = successfulFetch()) {
  return new AkinaNakamoriOfficialClient({
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
    sleep: async () => undefined,
    retryCount: 0,
  });
}

test("returns only the three fixed Akina CD carriers and the exact work cover", async () => {
  const result = await client().fetchRecovery();

  assert.deepEqual(Object.keys(result.carriers).sort(), ["SINGLE:50", "SINGLE:54", "SINGLE:55"]);
  assert.equal(result.carriers["SINGLE:50"]?.catalogNumber, "UMCK-5257");
  assert.equal(result.carriers["SINGLE:54"]?.canonicalTitle,
    "ひらり -SAKURA-／FIXER -WHILE THE WOMEN ARE SLEEPING-");
  assert.equal(result.carriers["SINGLE:55"]?.observedTitle, "ごめんと、すきと、【通常盤CD】");
  assert.equal(result.workCovers["ORIGINAL_ALBUM:15"]?.canonicalTitle, "UNBALANCE+BALANCE");
  assert.equal(result.workCovers["ORIGINAL_ALBUM:15"]?.cover.matchLevel, "WORK_EXACT");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.stats, {
    requestsAttempted: 4,
    responsesFetched: 4,
    retries: 0,
    entitiesMatched: 4,
  });
});

for (const [label, mutate] of [
  ["artist", (html: string) => html.replaceAll("中森明菜", "別人")],
  ["title", (html: string) => html.replaceAll("DIVA Single Version", "DIVA remix")],
  ["date", (html: string) => html.replaceAll("2009-09-23", "2009-09-24")],
  ["catalog", (html: string) => html.replaceAll("UMCK-5257", "UMCK-9999")],
  ["format", (html: string) => html.replaceAll("CD MAXI", "DOWNLOAD")],
  ["track membership", (html: string) => html.replaceAll("Heartache", "Other song")],
  ["cover binding", (html: string) => html.replaceAll("umck-5257_", "umck-9999_")],
] as const) {
  test(`fails closed when the DIVA official page changes ${label}`, async () => {
    const result = await client(successfulFetch({
      "SINGLE:50": mutate(validHtml("SINGLE:50")),
    })).fetchRecovery();

    assert.equal(result.carriers["SINGLE:50"], undefined);
    assert.equal(result.warnings.some((item) =>
      item.key === "SINGLE:50" && item.code === "invalid-official-html"), true);
    assert.equal(Object.keys(result.carriers).length, 2);
  });
}

test("does not collapse the two-track Hirari/FIXER canonical work to the page heading", async () => {
  const result = await client(successfulFetch({
    "SINGLE:54": validHtml("SINGLE:54").replace(
      "<p>ひらり -SAKURA-</p>",
      "<p>unrelated coupling song</p>",
    ),
  })).fetchRecovery();

  assert.equal(result.carriers["SINGLE:54"], undefined);
});

test("accepts only the normal-edition WMG entity, not a same-day deluxe catalog", async () => {
  const deluxe = validHtml("SINGLE:55")
    .replaceAll("【通常盤CD】", "【2CDデラックス・エディション】")
    .replaceAll("WPCL-13771", "WPCL-13769/70")
    .replaceAll("/33269/", "/33268/");
  const result = await client(successfulFetch({ "SINGLE:55": deluxe })).fetchRecovery();

  assert.equal(result.carriers["SINGLE:55"], undefined);
});

test("rejects a different UHQCD page as the UNBALANCE work cover", async () => {
  const wrong = validHtml("ORIGINAL_ALBUM:15")
    .replaceAll("UNBALANCE+BALANCE+6 [UHQCD]", "DIVA [UHQCD]")
    .replaceAll("UPCH-7267", "UPCH-7283")
    .replaceAll("upch-7267_", "upch-7283_");
  const result = await client(successfulFetch({ "ORIGINAL_ALBUM:15": wrong })).fetchRecovery();

  assert.equal(result.workCovers["ORIGINAL_ALBUM:15"], undefined);
});

test("blocks non-public DNS answers before making any request", async () => {
  let requests = 0;
  const result = await new AkinaNakamoriOfficialClient({
    fetchImpl: async () => {
      requests += 1;
      return new Response(validHtml("SINGLE:50"));
    },
    resolveHost: async () => ["127.0.0.1"],
    retryCount: 0,
  }).fetchRecovery();

  assert.equal(requests, 0);
  assert.equal(result.warnings.length, 4);
  assert.equal(result.warnings.every((item) => item.code === "non-public-address"), true);
});

test("rejects redirects, wrong MIME types, and oversized pages", async () => {
  let call = 0;
  const result = await client(async () => {
    call += 1;
    if (call === 1) return new Response(null, {
      status: 302,
      headers: { location: "https://example.com/" },
    });
    if (call === 2) return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    if (call === 3) return new Response("x", {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "600000" },
    });
    return new Response(validHtml("ORIGINAL_ALBUM:15"), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }).fetchRecovery();

  assert.deepEqual(result.warnings.map((item) => item.code), [
    "unexpected-redirect",
    "unsupported-content-type",
    "response-too-large",
  ]);
  assert.equal(result.stats.entitiesMatched, 1);
});

test("stops a chunked body at the hard byte limit before buffering the response", async () => {
  const result = await client(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(200_000));
      controller.enqueue(new Uint8Array(200_000));
      controller.enqueue(new Uint8Array(200_000));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  })).fetchRecovery();

  assert.equal(result.stats.entitiesMatched, 0);
  assert.equal(result.warnings.length, 4);
  assert.equal(result.warnings.every((item) => item.code === "response-too-large"), true);
});

test("classifies a body-stream timeout as retryable instead of invalid HTML", async () => {
  const result = await new AkinaNakamoriOfficialClient({
    fetchImpl: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    }), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    resolveHost: async () => ["93.184.216.34"],
    timeoutMs: 100,
    retryCount: 0,
  }).fetchRecovery();

  assert.equal(result.stats.entitiesMatched, 0);
  assert.equal(result.warnings.length, 4);
  assert.equal(result.warnings.every((item) =>
    item.code === "network-timeout" && item.retryable), true);
});

test("retries a transient provider failure once without broadening the entity", async () => {
  const attempts = new Map<string, number>();
  const result = await new AkinaNakamoriOfficialClient({
    fetchImpl: async (input) => {
      const url = input.toString();
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      if (attempt === 1) return new Response(null, { status: 503 });
      const key = (Object.keys(AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS) as
        AkinaNakamoriOfficialRecoveryKey[]).find((candidate) =>
          AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[candidate].sourceUrl === url)!;
      return new Response(validHtml(key), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    resolveHost: async () => ["93.184.216.34"],
    sleep: async () => undefined,
    retryCount: 1,
  }).fetchRecovery();

  assert.equal(result.stats.requestsAttempted, 8);
  assert.equal(result.stats.retries, 4);
  assert.equal(result.stats.entitiesMatched, 4);
  assert.deepEqual(result.warnings, []);
});
