import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISCOGS_ATTRIBUTION,
  DISCOGS_EVIDENCE_ROLE,
  DiscogsClient,
  type DiscogsFetch,
} from "@/lib/discogs";

function response(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
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

function searchRelease(id: number, overrides: Record<string, unknown> = {}) {
  return {
    country: "Japan",
    year: "1992",
    format: ["CD", "Album"],
    label: ["King Records"],
    type: "release",
    id,
    barcode: [`4988003${id}`],
    master_id: id + 100,
    catno: `KICS ${id}`,
    title: `Miho Nakayama - Release ${id}`,
    thumb: "",
    cover_image: "",
    resource_url: `https://api.discogs.com/releases/${id}`,
    ...overrides,
  };
}

function searchPage(page: number, pages: number, total: number, results: unknown[]) {
  return {
    pagination: { page, pages, per_page: 2, items: total },
    results,
  };
}

function detail(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "Accepted",
    data_quality: "Correct",
    year: 1992,
    released: "1992-07-01",
    resource_url: `https://api.discogs.com/releases/${id}`,
    uri: `https://www.discogs.com/release/${id}-example`,
    title: "Mellow = メロウ",
    artists_sort: "Miho Nakayama = 中山美穂",
    artists: [
      { name: "Miho Nakayama", anv: "中山美穂", join: "" },
    ],
    country: "Japan",
    labels: [{ name: "King Records", catno: "KICS 210" }],
    formats: [{ name: "CD", qty: "1", descriptions: ["Album", "Stereo"] }],
    identifiers: [
      { type: "Barcode", value: "4988003121303", description: "Text" },
      { type: "Matrix / Runout", value: "KICS-210", description: "Matrix" },
    ],
    tracklist: [
      { position: "1", title: "Mellow", duration: "4:00", type_: "track" },
      { position: "2", title: "Track Two", duration: "3:30", type_: "track" },
    ],
    images: [
      {
        type: "primary",
        uri: "https://i.discogs.com/example-primary.jpeg",
        uri150: "https://i.discogs.com/example-primary-150.jpeg",
        width: 600,
        height: 600,
      },
    ],
    master_id: 2496199,
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

test("searches every advertised Japan CD page within the safety limits", async () => {
  const urls: URL[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const fetchImpl: DiscogsFetch = async (input, init) => {
    const url = new URL(input);
    urls.push(url);
    inits.push(init);
    const page = Number(url.searchParams.get("page"));
    return response(
      200,
      page === 1
        ? searchPage(1, 2, 3, [searchRelease(1), searchRelease(2)])
        : searchPage(2, 2, 3, [searchRelease(3)]),
      {
        "x-discogs-ratelimit": "25",
        "x-discogs-ratelimit-used": String(page),
        "x-discogs-ratelimit-remaining": String(25 - page),
      },
    );
  };

  const result = await client(fetchImpl).searchJapanCdReleases("  Miho Nakayama  ", {
    perPage: 2,
    maxPages: 5,
    maxItems: 10,
  });

  assert.equal(urls.length, 2);
  assert.equal(urls[0]?.origin, "https://api.discogs.com");
  assert.equal(urls[0]?.pathname, "/database/search");
  assert.equal(urls[0]?.searchParams.get("artist"), "Miho Nakayama");
  assert.equal(urls[0]?.searchParams.get("type"), "release");
  assert.equal(urls[0]?.searchParams.get("country"), "Japan");
  assert.equal(urls[0]?.searchParams.get("format"), "CD");
  assert.equal(urls[0]?.searchParams.get("sort"), "title");
  assert.equal(urls[0]?.searchParams.get("sort_order"), "asc");
  assert.equal((inits[0]?.headers as Record<string, string>)["User-Agent"],
    "CD-BOX-tests/1.0 (+https://example.invalid)");
  assert.equal(inits[0]?.redirect, "error");
  assert.equal(result.value.evidenceRole, "corroborating-only");
  assert.equal(result.value.items.length, 3);
  assert.equal(result.value.sourceTotal, 3);
  assert.equal(result.value.pagesFetched, 2);
  assert.equal(result.value.partial, false);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.rateLimit, { limit: 25, used: 2, remaining: 23 });
  assert.equal(result.value.items[0]?.sourceUrl, "https://www.discogs.com/release/1");
  assert.equal(result.value.items[0]?.evidenceRole, DISCOGS_EVIDENCE_ROLE);
});

test("marks a safely capped pagination result as partial", async () => {
  const fetchImpl: DiscogsFetch = async () => response(
    200,
    searchPage(1, 3, 5, [searchRelease(1), searchRelease(2)]),
  );
  const result = await client(fetchImpl).searchJapanCdReleases("中山美穂", {
    perPage: 2,
    maxPages: 1,
  });

  assert.equal(result.value.items.length, 2);
  assert.equal(result.value.partial, true);
  assert.ok(result.warnings.some((item) => item.code === "partial-results"));
});

test("parses release details as corroborating evidence with exact identifiers and cover", async () => {
  const result = await client(async () => response(200, detail(8822822), {
    "x-discogs-ratelimit": "25",
    "x-discogs-ratelimit-used": "8",
    "x-discogs-ratelimit-remaining": "17",
  })).getRelease(8822822);

  assert.equal(result.warnings.length, 0);
  assert.equal(result.value?.evidenceRole, "corroborating-only");
  assert.equal(result.value?.releaseId, 8822822);
  assert.equal(result.value?.status, "Accepted");
  assert.equal(result.value?.dataQuality, "Correct");
  assert.equal(result.value?.artistCredit, "Miho Nakayama = 中山美穂");
  assert.deepEqual(result.value?.barcodes, ["4988003121303"]);
  assert.equal(result.value?.labels[0]?.catalogNumber, "KICS 210");
  assert.equal(result.value?.formats[0]?.name, "CD");
  assert.equal(result.value?.tracks.length, 2);
  assert.equal(result.value?.primaryImageUrl, "https://i.discogs.com/example-primary.jpeg");
  assert.equal(result.value?.sourceUrl, "https://www.discogs.com/release/8822822");
  assert.deepEqual(result.rateLimit, { limit: 25, used: 8, remaining: 17 });
});

test("exports the exact official attribution notices", () => {
  assert.equal(DISCOGS_ATTRIBUTION.dataNotice, "Data provided by Discogs.");
  assert.match(DISCOGS_ATTRIBUTION.nonAffiliationNotice, /not affiliated with/);
  assert.equal(DISCOGS_ATTRIBUTION.termsUrl.startsWith("https://support.discogs.com/"), true);
});
