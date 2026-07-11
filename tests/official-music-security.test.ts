import assert from "node:assert/strict";
import test from "node:test";
import {
  OfficialMusicCatalogClient,
  isPublicInternetAddress,
  validateOfficialMusicUrl,
  type OfficialMusicFetch,
} from "@/lib/official-music";

const origin = "https://artist.example.com";
const candidate = {
  id: "release-1",
  title: "Example Album",
  date: "2001-02-03",
  catalogNumber: "ABC-123",
};

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html", ...init.headers },
    ...init,
  });
}

function client(fetchImpl: OfficialMusicFetch, overrides: ConstructorParameters<typeof OfficialMusicCatalogClient>[0] = {}) {
  return new OfficialMusicCatalogClient({
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
    sleep: async () => undefined,
    now: () => 0,
    retryCount: 0,
    minimumIntervalMs: 250,
    ...overrides,
  });
}

test("rejects literal IPs, localhost, credentials, non-standard ports, and special-use domains", () => {
  for (const url of [
    "https://127.0.0.1/music",
    "https://[::1]/music",
    "https://localhost/music",
    "https://catalog.local/music",
    "https://user:pass@artist.example.com/music",
    "https://artist.example.com:8443/music",
    "http://artist.example.com/music",
  ]) {
    assert.equal(validateOfficialMusicUrl(url).ok, false, url);
  }
  assert.equal(validateOfficialMusicUrl(`${origin}/music`).ok, true);
});

test("classifies public and non-public DNS addresses conservatively", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ]) assert.equal(isPublicInternetAddress(address), false, address);

  assert.equal(isPublicInternetAddress("8.8.8.8"), true);
  assert.equal(isPublicInternetAddress("2606:4700:4700::1111"), true);
});

test("does not fetch a hostname when any DNS answer is non-public", async () => {
  let fetches = 0;
  const result = await client(async () => {
    fetches += 1;
    return html("unused");
  }, {
    resolveHost: async () => ["93.184.216.34", "127.0.0.1"],
  }).research({
    officialUrls: [`${origin}/music`],
    candidates: [candidate],
  });

  assert.equal(fetches, 0);
  assert.ok(result.warnings.some((item) => item.code === "non-public-address"));
});

test("permits only same-origin redirects and rechecks the redirect hostname", async () => {
  const requests: string[] = [];
  const sameOrigin = await client(async (input) => {
    const url = input.toString();
    requests.push(url);
    return url.endsWith("/music")
      ? new Response(null, { status: 302, headers: { Location: "/release/final" } })
      : html("<article><h1>Example Album</h1><p>ABC-123</p><p>2001-02-03</p></article>");
  }).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });

  assert.deepEqual(requests, [`${origin}/music`, `${origin}/release/final`]);
  assert.equal(sameOrigin.candidates[0]?.evidence?.url, `${origin}/release/final`);

  let externalFetches = 0;
  const crossOrigin = await client(async () => {
    externalFetches += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: "https://other.example.com/release/final" },
    });
  }).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });

  assert.equal(externalFetches, 1);
  assert.equal(crossOrigin.candidates[0]?.evidence, null);
  assert.ok(crossOrigin.warnings.some((item) => item.code === "cross-origin-redirect"));
});

test("rejects oversized and non-HTML responses without reading them as evidence", async () => {
  const tooLarge = await client(async () => new Response("small fixture", {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Content-Length": String(2 * 1024 * 1024 + 1),
    },
  })).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });
  assert.ok(tooLarge.warnings.some((item) => item.code === "page-too-large"));

  const image = await client(async () => new Response("not really an image", {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  })).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });
  assert.ok(image.warnings.some((item) => item.code === "unsupported-content-type"));
});

test("retries a transient status, honors Retry-After, and never submits forms", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await client(async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    if (calls === 1) {
      return new Response(null, { status: 429, headers: { "Retry-After": "2" } });
    }
    return html(`
      <form method="post" action="/release/unsafe">
        <button>Submit</button><a href="/music/inside-form">Inside form</a>
      </form>
      <article><h1>Example Album</h1><p>ABC 123</p><p>2001-02-03</p></article>
    `);
  }, {
    retryCount: 1,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  }).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });

  assert.equal(calls, 2);
  assert.ok(delays.includes(2_000));
  assert.equal(result.candidates[0]?.evidence?.url, `${origin}/music`);
  assert.equal(result.stats.pagesDiscovered, 1);
});

test("turns abort timeouts into sanitized structured warnings", async () => {
  const result = await client(async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("private upstream detail must not leak"));
      }, { once: true });
    }), {
    timeoutMs: 25,
  }).research({ officialUrls: [`${origin}/music`], candidates: [candidate] });

  assert.ok(result.warnings.some((item) => item.code === "network-timeout"));
  assert.equal(JSON.stringify(result).includes("private upstream detail"), false);
});

test("keeps the timeout active while streaming the response body", async () => {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(new TextEncoder().encode("<html>"));
      // Deliberately never close. Abort must terminate the fetch body read.
    },
  });
  const result = await client(async (_input, init) => {
    init?.signal?.addEventListener("abort", () => {
      streamController.error(new Error("aborted streaming body"));
    }, { once: true });
    return new Response(stream, { headers: { "Content-Type": "text/html" } });
  }, { timeoutMs: 25 }).research({
    officialUrls: [`${origin}/music`],
    candidates: [candidate],
  });

  assert.ok(result.warnings.some((item) => item.code === "network-timeout"));
});
