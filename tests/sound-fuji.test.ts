import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUND_FUJI_ORIGIN,
  SoundFujiArchiveClient,
  type SoundFujiArchiveClientOptions,
} from "@/lib/official-music/sound-fuji";
import type { OfficialMusicFetch } from "@/lib/official-music/types";

const publicResolver = async () => ["93.184.216.34"];

type IndexItem = {
  id: number;
  link: string;
  title: { rendered: string };
};

function indexItem(id: number, title: string, link = `${SOUND_FUJI_ORIGIN}/release/${id}/`): IndexItem {
  return { id, link, title: { rendered: title } };
}

function indexResponse(
  items: IndexItem[],
  options: { total?: number; pages?: number; status?: number; contentLength?: number } = {},
) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-WP-Total": String(options.total ?? items.length),
    "X-WP-TotalPages": String(options.pages ?? 1),
  });
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", String(options.contentLength));
  }
  return new Response(JSON.stringify(items), {
    status: options.status ?? 200,
    headers,
  });
}

function detailResponse(options: {
  title: string;
  artist: string;
  cover?: string;
  appleSlug?: string;
  kingCatalog?: string;
}) {
  const cover = options.cover
    ? `<meta property="og:image" content="${options.cover}">`
    : "";
  const apple = options.appleSlug
    ? `<li><a href="https://music.apple.com/jp/album/${options.appleSlug}/123456789">Apple Music</a></li>`
    : "";
  const shop = options.kingCatalog
    ? `<li><a href="https://kingeshop.jp/shop/g/g${options.kingCatalog}/">KING e-SHOP</a></li>`
    : "";
  return new Response(`
    <html>
      <head>${cover}</head>
      <body>
        <div class="detail__desc">
          <div class="detail__desc__title">
            <h2>${options.title}</h2>
            <h3>${options.artist}</h3>
          </div>
          <div class="detail__desc__buttons"><ul>${apple}${shop}</ul></div>
        </div>
      </body>
    </html>
  `, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function fixtureClient(
  route: (url: URL, init?: RequestInit) => Response | Promise<Response>,
  requests: Array<{ url: string; init?: RequestInit }> = [],
  overrides: SoundFujiArchiveClientOptions = {},
) {
  const fetchImpl: OfficialMusicFetch = async (input, init) => {
    const url = new URL(input.toString());
    requests.push({ url: url.toString(), init });
    return route(url, init);
  };
  return new SoundFujiArchiveClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    now: () => 0,
    minimumIntervalMs: 0,
    timeoutMs: 1_000,
    cacheTtlMs: 0,
    ...overrides,
  });
}

function indexPage(url: URL) {
  return url.pathname === "/wp-json/wp/v2/release"
    ? Number(url.searchParams.get("page"))
    : null;
}

test("selects the album Mellow rather than its same-title EP and verifies manifesto", async () => {
  const records = [
    indexItem(1603, "Mellow"),
    indexItem(3696, "Mellow"),
    indexItem(1617, "manifesto"),
  ];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse(records);
    if (url.pathname === "/release/1603/") {
      return detailResponse({
        title: "Mellow",
        artist: "中山美穂",
        cover: `${SOUND_FUJI_ORIGIN}/wp-content/uploads/2020/08/mellow.jpg`,
        appleSlug: "mellow",
        kingCatalog: "KICS-3274",
      });
    }
    if (url.pathname === "/release/3696/") {
      return detailResponse({
        title: "Mellow",
        artist: "中山美穂",
        cover: `${SOUND_FUJI_ORIGIN}/wp-content/uploads/2020/08/mellow-ep.jpg`,
        appleSlug: "mellow-ep",
      });
    }
    if (url.pathname === "/release/1617/") {
      return detailResponse({
        title: "manifesto",
        artist: "中山美穂",
        cover: `${SOUND_FUJI_ORIGIN}/wp-content/uploads/2020/08/manifesto.jpg`,
        kingCatalog: "KICS-3281",
      });
    }
    return new Response("missing", { status: 404 });
  }, requests);

  const result = await client.research({
    artistNames: ["中山美穂", "Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [
      { id: "mellow", title: "Mellow", expectedKind: "ALBUM" },
      { id: "manifesto", title: "manifesto", expectedKind: "ALBUM" },
    ],
  });

  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.candidates.map((candidate) => candidate.outcome), ["PASS", "PASS"]);
  assert.equal(result.candidates[0]?.evidence?.sourceUrl, `${SOUND_FUJI_ORIGIN}/release/1603/`);
  assert.equal(result.candidates[0]?.evidence?.observedKind, "ALBUM");
  assert.equal(result.candidates[1]?.evidence?.sourceUrl, `${SOUND_FUJI_ORIGIN}/release/1617/`);
  assert.deepEqual(result.candidates[0]?.evidence?.matchedFields, ["artist", "title"]);
  assert.equal(result.candidates[0]?.evidence?.role, "AUTHORITATIVE");
  assert.equal(result.candidates[0]?.evidence?.strength, "STRONG");
  assert.equal(result.candidates[0]?.evidence?.scope, "WORK");
  assert.equal(result.candidates[0]?.evidence?.cover?.scope, "WORK");
  assert.equal(result.candidates[0]?.evidence?.cover?.matchLevel, "WORK_EXACT");
  assert.equal("edition" in (result.candidates[0]?.evidence?.cover ?? {}), false);
  assert.equal(requests.every((request) => new URL(request.url).origin === SOUND_FUJI_ORIGIN), true);
  assert.equal(requests.every((request) => request.init?.redirect === "error"), true);
  assert.equal(requests.every((request) => request.init?.credentials === "omit"), true);
});

test("matches the complete normalized short title C and never treats E as a substring hit", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1, "「C」"), indexItem(2, "E")]);
    }
    if (url.pathname === "/release/1/") {
      return detailResponse({ title: "「C」", artist: "中山美穂" });
    }
    if (url.pathname === "/release/2/") {
      return detailResponse({ title: "E", artist: "中山美穂" });
    }
    return new Response("missing", { status: 404 });
  }, requests);

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["キングレコード"],
    candidates: [{ id: "c", title: "C", expectedKind: "SINGLE" }],
  });

  assert.equal(result.candidates[0]?.outcome, "PASS");
  assert.equal(result.candidates[0]?.evidence?.sourceUrl, `${SOUND_FUJI_ORIGIN}/release/1/`);
  assert.equal(result.candidates[0]?.evidence?.observedKind, null);
  assert.equal(requests.some((request) => new URL(request.url).pathname === "/release/2/"), false);
});

test("matches the controlled katakana reading suffix on the numeric 50/50 title", async () => {
  const officialCover = `${SOUND_FUJI_ORIGIN}/shared/img/2024/07/NOPA-2366_1.jpg`;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([
        indexItem(2228, "50/50(フィフティー・フィフティー)"),
        indexItem(9998, "50/50(Live)"),
        indexItem(9999, "50/50(ライブ)"),
      ]);
    }
    if (url.pathname === "/release/2228/") {
      return detailResponse({
        title: "50/50(フィフティー・フィフティー)",
        artist: "中山美穂",
        cover: officialCover,
        appleSlug: "50-50-ep",
      });
    }
    return new Response("unexpected detail", { status: 500 });
  }, requests);

  const result = await client.research({
    artistNames: ["中山美穂", "Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "fifty-fifty", title: "50/50", expectedKind: "SINGLE" }],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.candidates[0]?.outcome, "PASS");
  assert.equal(
    result.candidates[0]?.evidence?.sourceUrl,
    `${SOUND_FUJI_ORIGIN}/release/2228/`,
  );
  assert.equal(result.candidates[0]?.evidence?.observedKind, "SINGLE");
  assert.equal(result.candidates[0]?.evidence?.cover?.url, officialCover);
  assert.deepEqual(
    requests.filter((request) => new URL(request.url).pathname.startsWith("/release/"))
      .map((request) => new URL(request.url).pathname),
    ["/release/2228/"],
  );
});

test("uses a known expected kind despite an unknown duplicate but never assigns the unknown page to a conflicting kind", async () => {
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1577, "「C」"), indexItem(2212, "「C」")]);
    }
    if (url.pathname === "/release/1577/") {
      return detailResponse({
        title: "「C」",
        artist: "中山美穂",
        kingCatalog: "KICS-3261",
      });
    }
    if (url.pathname === "/release/2212/") {
      return detailResponse({ title: "「C」", artist: "中山美穂" });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [
      { id: "album-c", title: "C", expectedKind: "ALBUM" },
      { id: "single-c", title: "C", expectedKind: "SINGLE" },
    ],
  });

  assert.equal(result.candidates[0]?.outcome, "PASS");
  assert.equal(result.candidates[0]?.evidence?.sourceUrl, `${SOUND_FUJI_ORIGIN}/release/1577/`);
  assert.equal(result.candidates[1]?.outcome, "AMBIGUOUS");
});

test("requires a complete artist alias and rejects a wrong-artist substring", async () => {
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse([indexItem(1603, "Mellow")]);
    if (url.pathname === "/release/1603/") {
      return detailResponse({ title: "Mellow", artist: "Miho Nakayama Tribute Band" });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["中山美穂", "Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.candidates[0]?.outcome, "NOT_FOUND");
  assert.equal(result.candidates[0]?.evidence, null);
});

test("collapses same-artist same-title same-kind official pages into one work authority", async () => {
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1617, "manifesto"), indexItem(2617, "manifesto")]);
    }
    if (url.pathname === "/release/1617/" || url.pathname === "/release/2617/") {
      return detailResponse({
        title: "manifesto",
        artist: "中山美穂",
        cover: `${SOUND_FUJI_ORIGIN}/shared/img/${url.pathname === "/release/1617/" ? "first" : "second"}.jpg`,
        kingCatalog: url.pathname === "/release/1617/" ? "KICS-3281" : "KICS-9999",
      });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "manifesto", title: "manifesto", expectedKind: "ALBUM" }],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.candidates[0]?.outcome, "PASS");
  assert.equal(result.candidates[0]?.evidence?.sourceUrl, `${SOUND_FUJI_ORIGIN}/release/1617/`);
  assert.deepEqual(result.candidates[0]?.evidence?.sourceUrls, [
    `${SOUND_FUJI_ORIGIN}/release/1617/`,
    `${SOUND_FUJI_ORIGIN}/release/2617/`,
  ]);
  assert.equal(
    result.candidates[0]?.evidence?.cover?.url,
    `${SOUND_FUJI_ORIGIN}/shared/img/first.jpg`,
  );
  assert.equal(result.stats.ambiguousCandidates, 0);
});

test("fails closed when exact work pages conflict on album versus single kind", async () => {
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1603, "Mellow"), indexItem(3696, "Mellow")]);
    }
    if (url.pathname === "/release/1603/") {
      return detailResponse({
        title: "Mellow",
        artist: "中山美穂",
        kingCatalog: "KICS-3274",
      });
    }
    if (url.pathname === "/release/3696/") {
      return detailResponse({
        title: "Mellow",
        artist: "中山美穂",
        appleSlug: "mellow-ep",
      });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.candidates[0]?.outcome, "AMBIGUOUS");
  assert.equal(result.candidates[0]?.evidence, null);
  assert.equal(result.stats.ambiguousCandidates, 1);
});

test("marks every candidate source-incomplete when bounded pagination fails", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    indexItem(index + 1, index === 0 ? "manifesto" : `unrelated-${index + 1}`));
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse(firstPage, { total: 101, pages: 2 });
    if (indexPage(url) === 2) {
      return indexResponse([], { total: 101, pages: 2, status: 503 });
    }
    return new Response("missing", { status: 404 });
  }, requests);

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [
      { id: "manifesto", title: "manifesto" },
      { id: "mellow", title: "Mellow" },
    ],
  });

  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.complete, false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.outcome), [
    "SOURCE_INCOMPLETE",
    "SOURCE_INCOMPLETE",
  ]);
  assert.equal(result.warnings[0]?.code, "http-status");
  assert.equal(requests.some((request) => new URL(request.url).pathname.startsWith("/release/")), false);
});

test("retries one transient index-page failure without discarding the complete snapshot", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    indexItem(index + 1, index === 0 ? "Mellow" : `unrelated-${index + 1}`));
  let secondPageCalls = 0;
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse(firstPage, { total: 101, pages: 2 });
    if (indexPage(url) === 2) {
      secondPageCalls += 1;
      return secondPageCalls === 1
        ? indexResponse([], { total: 101, pages: 2, status: 503 })
        : indexResponse([indexItem(101, "unrelated-101")], { total: 101, pages: 2 });
    }
    if (url.pathname === "/release/1/") {
      return detailResponse({ title: "Mellow", artist: "Miho Nakayama", appleSlug: "mellow" });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow", expectedKind: "ALBUM" }],
  });

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.candidates[0]?.outcome, "PASS");
  assert.equal(secondPageCalls, 2);
});

test("retries a transient DNS lookup but never retries a non-public answer", async () => {
  let dnsCalls = 0;
  const recovered = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse([indexItem(1, "unrelated")]);
    return new Response("missing", { status: 404 });
  }, [], {
    resolveHost: async () => {
      dnsCalls += 1;
      if (dnsCalls === 1) throw new Error("temporary DNS failure");
      return ["93.184.216.34"];
    },
  });
  const recoveredResult = await recovered.research({
    artistNames: ["Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });
  assert.equal(recoveredResult.status, "COMPLETE");
  assert.equal(dnsCalls, 2);

  let privateDnsCalls = 0;
  const blocked = fixtureClient(() => new Response("must not fetch", { status: 500 }), [], {
    resolveHost: async () => {
      privateDnsCalls += 1;
      return ["127.0.0.1"];
    },
  });
  const blockedResult = await blocked.research({
    artistNames: ["Miho Nakayama"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });
  assert.equal(blockedResult.status, "SOURCE_INCOMPLETE");
  assert.equal(blockedResult.warnings[0]?.code, "non-public-address");
  assert.equal(privateDnsCalls, 1);
});

test("does not fetch SOUND FUJI unless an exact King label or publisher gate is present", async () => {
  let fetches = 0;
  const client = fixtureClient(() => {
    fetches += 1;
    return indexResponse([]);
  });

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["Warner Music Japan"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });

  assert.equal(result.status, "NOT_APPLICABLE");
  assert.equal(result.applicable, false);
  assert.equal(fetches, 0);
});

test("rejects an off-host index link before making any detail request", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1603, "Mellow", "https://example.com/release/1603/")]);
    }
    return new Response("must not fetch", { status: 500 });
  }, requests);

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });

  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.warnings[0]?.code, "invalid-index");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]!.url).origin, SOUND_FUJI_ORIGIN);
});

test("uses only bounded complete-snapshot/detail caches and expires both together", async () => {
  let now = 0;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) return indexResponse([indexItem(1603, "Mellow")]);
    if (url.pathname === "/release/1603/") {
      return detailResponse({ title: "Mellow", artist: "中山美穂" });
    }
    return new Response("missing", { status: 404 });
  }, requests, {
    now: () => now,
    cacheTtlMs: 1_000,
  });
  const input = {
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  };

  await client.research(input);
  const cached = await client.research(input);
  assert.equal(requests.length, 2);
  assert.equal(cached.stats.cacheHits, 2);

  now = 1_001;
  await client.research(input);
  assert.equal(requests.length, 4);
});

test("fails closed before parsing an index whose declared size exceeds the hard limit", async () => {
  const client = fixtureClient((url) => {
    if (indexPage(url) === 1) {
      return indexResponse([indexItem(1603, "Mellow")], { contentLength: 1024 * 1024 + 1 });
    }
    return new Response("missing", { status: 404 });
  });

  const result = await client.research({
    artistNames: ["中山美穂"],
    labelOrPublisherNames: ["King Records"],
    candidates: [{ id: "mellow", title: "Mellow" }],
  });

  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.warnings[0]?.code, "response-too-large");
});
