import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DiscogsClient,
  isAllowedDiscogsImageUrl,
  type DiscogsFetch,
} from "@/lib/discogs";

function response(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    json: async () => payload,
  };
}

function detail(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    resource_url: `https://api.discogs.com/releases/${id}`,
    title: "Example",
    artists_sort: "Artist",
    artists: [{ name: "Artist", anv: "", join: "" }],
    labels: [],
    formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }],
    identifiers: [],
    tracklist: [],
    images: [],
    ...overrides,
  };
}

function client(fetchImpl: DiscogsFetch, overrides: ConstructorParameters<typeof DiscogsClient>[0] = {}) {
  return new DiscogsClient({
    fetchImpl,
    userAgent: "CD-BOX-tests/1.0 (+https://example.invalid)",
    minimumIntervalMs: 0,
    retryCount: 0,
    ...overrides,
  });
}

test("allows only exact HTTPS Discogs hosts for image evidence", () => {
  assert.equal(isAllowedDiscogsImageUrl("https://i.discogs.com/cover.jpeg"), true);
  assert.equal(isAllowedDiscogsImageUrl("https://api.discogs.com/image/1"), true);
  assert.equal(isAllowedDiscogsImageUrl("https://www.discogs.com/image/1"), true);
  assert.equal(isAllowedDiscogsImageUrl("http://i.discogs.com/cover.jpeg"), false);
  assert.equal(isAllowedDiscogsImageUrl("https://i.discogs.com.evil.example/cover.jpeg"), false);
  assert.equal(isAllowedDiscogsImageUrl("https://discogs.com/cover.jpeg"), false);
  assert.equal(isAllowedDiscogsImageUrl("https://user:pass@i.discogs.com/cover.jpeg"), false);
  assert.equal(isAllowedDiscogsImageUrl("javascript:alert(1)"), false);
});

test("never promotes a secondary Discogs scan to front-cover evidence", async () => {
  const result = await client(async () => response(200, detail(7, {
    images: [
      { type: "primary", uri: "https://evil.example/fake.jpeg", width: 600, height: 600 },
      { type: "secondary", uri: "https://i.discogs.com/safe.jpeg", width: 500, height: 500 },
    ],
  }))).getRelease(7);

  assert.equal(result.value?.images.length, 1);
  assert.equal(result.value?.primaryImageUrl, null);
  assert.equal(result.warnings[0]?.code, "invalid-response");
});

test("rejects a release payload whose ID or API URL does not match the request", async () => {
  const wrongId = await client(async () => response(200, detail(8))).getRelease(7);
  assert.equal(wrongId.value, null);
  assert.equal(wrongId.warnings[0]?.code, "invalid-response");

  const wrongOrigin = await client(async () => response(200, detail(7, {
    resource_url: "https://api.discogs.com.evil.example/releases/7",
  }))).getRelease(7);
  assert.equal(wrongOrigin.value, null);
  assert.equal(wrongOrigin.warnings[0]?.code, "invalid-response");
});

test("honors Retry-After on 429 before retrying", async () => {
  let requests = 0;
  const sleeps: number[] = [];
  const fetchImpl: DiscogsFetch = async () => {
    requests += 1;
    return requests === 1
      ? response(429, {}, { "retry-after": "2" })
      : response(200, detail(7));
  };

  const result = await client(fetchImpl, {
    retryCount: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  }).getRelease(7);

  assert.equal(requests, 2);
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(result.value?.releaseId, 7);
});

test("aborts a timed-out request and retries once", async () => {
  let requests = 0;
  let firstSignal: AbortSignal | undefined;
  const fetchImpl: DiscogsFetch = async (_input, init) => {
    requests += 1;
    if (requests === 2) return response(200, detail(7));
    firstSignal = init?.signal ?? undefined;
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  };

  const result = await client(fetchImpl, {
    timeoutMs: 25,
    retryCount: 1,
    sleep: async () => undefined,
  }).getRelease(7);

  assert.equal(firstSignal?.aborted, true);
  assert.equal(requests, 2);
  assert.equal(result.value?.releaseId, 7);
});

test("returns null without a warning for a missing release", async () => {
  const result = await client(async () => response(404, {})).getRelease(7);
  assert.equal(result.value, null);
  assert.deepEqual(result.warnings, []);
});

test("does not accept malformed or out-of-scope Japan CD search rows", async () => {
  const payload = {
    pagination: { page: 1, pages: 1, per_page: 100, items: 3 },
    results: [
      {
        id: 1,
        type: "release",
        title: "Wrong country",
        country: "US",
        year: "1992",
        format: ["CD"],
        label: [],
        barcode: [],
        master_id: 0,
        catno: "X",
        thumb: "",
        cover_image: "",
        resource_url: "https://api.discogs.com/releases/1",
      },
      {
        id: 2,
        type: "release",
        title: "Wrong format",
        country: "Japan",
        year: "1992",
        format: ["Vinyl"],
        label: [],
        barcode: [],
        master_id: 0,
        catno: "X",
        thumb: "",
        cover_image: "",
        resource_url: "https://api.discogs.com/releases/2",
      },
      {
        id: 3,
        type: "release",
        title: "Unsafe API URL",
        country: "Japan",
        year: "1992",
        format: ["CD"],
        label: [],
        barcode: [],
        master_id: 0,
        catno: "X",
        thumb: "",
        cover_image: "",
        resource_url: "https://evil.example/releases/3",
      },
    ],
  };
  const result = await client(async () => response(200, payload)).searchJapanCdReleases("Artist");

  assert.equal(result.value.items.length, 0);
  assert.equal(result.value.partial, true);
  assert.ok(result.warnings.some((item) => item.code === "invalid-response"));
});
