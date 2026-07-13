import assert from "node:assert/strict";
import test from "node:test";
import {
  MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
  MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
  MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
  MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS,
  MomoeYamaguchiOfficialCatalogClient,
  momoeYamaguchiSonyAlbumCallbackName,
  momoeYamaguchiSonyAlbumJsonpUrl,
  momoeYamaguchiSonyAlbumProductUrl,
  parseMomoeYamaguchiOtonanoSingles,
  parseMomoeYamaguchiCosmosCdJsonp,
  parseMomoeYamaguchiSonyAlbumJsonp,
  type OfficialMusicFetch,
} from "@/lib/official-music";

const publicResolver = async () => ["93.184.216.34"];
const otonanoCoverPrefix =
  "/files/6/OTONANO/originalpage/golden_idol/img/momoe/";

type SingleFixtureOptions = {
  duplicateTitle?: boolean;
  wrongCoverHost?: boolean;
  missingFormalDate?: boolean;
};

function otonanoSinglesFixture(options: SingleFixtureOptions = {}) {
  const rows = Array.from({ length: 32 }, (_, index) => {
    const number = index + 1;
    const title = options.duplicateTitle && index === 1 ? "曲1" : `曲${number}`;
    const catalog = index < 12 ? `SOLB ${100 + index}` : `06SH ${200 + index}`;
    const path = `${otonanoCoverPrefix}${catalog.replace(/\s/g, "")}.jpg`;
    const imageUrl = options.wrongCoverHost && index === 0
      ? `https://evil.example${path}`
      : path;
    const date = options.missingFormalDate && index === 0
      ? ""
      : `<dt>オリジナル発売日：</dt><dd>1973/${Math.floor(index / 28) + 1}/${index % 28 + 1}</dd>`;
    return `
      <li>
        <a href="${imageUrl}" class="fancybox" rel="jacket"><img src="${imageUrl}" alt="${title}"></a>
        <dl class="number"><dt>${number * 2 - 1}</dt><dd>${title}</dd><dt>${number * 2}</dt><dd>B面${number}</dd></dl>
        <dl class="info">${date}<dt>アナログ品番：</dt><dd>${catalog}</dd></dl>
      </li>`;
  });
  rows.push(`
    <li>
      <a href="${otonanoCoverPrefix}28AH1435.jpg" class="fancybox" rel="jacket"><img src="${otonanoCoverPrefix}28AH1435.jpg" alt="あなたへの子守唄"></a>
      <dl class="number"><dt>65</dt><dd>あなたへの子守唄（ボーナストラック）</dd></dl>
      <dl class="info"><dt>Promotion</dt><dd>Only</dd></dl>
    </li>`);
  return `<html><body><div class="title-list"><ul>${rows.join("")}</ul></div></body></html>`;
}

type AlbumFixtureOverrides = Partial<{
  artistName: unknown;
  artistFolder: unknown;
  representative_goods_number: unknown;
  title: unknown;
  image_original: unknown;
  release_date: unknown;
  comments: unknown;
}>;

function albumOriginalDate(ordinal: number) {
  if (ordinal === 1) return "1973年8月21日";
  if (ordinal === 22) return "1980年10月21日";
  return `1975年1月${ordinal}日`;
}

function sonyAlbumJsonp(
  catalogNumber: string,
  overrides: AlbumFixtureOverrides = {},
) {
  const ordinal = MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.indexOf(catalogNumber) + 1;
  const callback = momoeYamaguchiSonyAlbumCallbackName(catalogNumber);
  const item = {
    artistName: "山口百恵",
    artistFolder: "MomoeYamaguchi",
    representative_goods_number: catalogNumber,
    title: `Album ${ordinal}（初回盤）`,
    image_original: `http://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/${78000 + ordinal}.jpg`,
    release_date: "2004.05.19",
    comments: [`${ordinal}枚目のアルバム。${albumOriginalDate(ordinal)}発売。`],
    ...overrides,
  };
  return `${callback}(${JSON.stringify({ items: item })});`;
}

const cosmosTracks = [
  "OPENING（TAKE OFF）",
  "SPACE OPERA",
  "銀河カフェテラス",
  "宇宙旅行のパンフレット",
  "銀色のジプシー",
  "ただよいの中で",
  "COSMOS（宇宙）",
  "軌道修正",
  "乙女座 宮",
  "TIME TRAVEL",
  "OPENING（TAKE OFF）",
  "宇宙旅行のパンフレット",
];

function cosmosCdJsonp(overrides: Record<string, unknown> = {}) {
  const items = {
    artistName: "山口百恵",
    artistFolder: "MomoeYamaguchi",
    representative_goods_number: "SRCL-2622",
    display_goods_number: "SRCL-2622",
    title: "COSMOS宇宙",
    type: "アルバム",
    image_original:
      "http://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/94245.jpg",
    release_date: "1993.06.21",
    display_release_date: "1993.06.21",
    discs: cosmosTracks.map((title, index) => ({
      disc_number: 1,
      contents: [{ track_number: index + 1, title }],
    })),
    ...overrides,
  };
  return `cdbox_srcl2622(${JSON.stringify({ items })});`;
}

function response(body: string, contentType: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    status: init.status ?? 200,
    headers: { "Content-Type": contentType, ...init.headers },
  });
}

function fixtureClient(input: {
  singleHtml?: string;
  albumOverrides?: (catalogNumber: string, ordinal: number) => AlbumFixtureOverrides;
  fetchOverride?: OfficialMusicFetch;
  requests?: Array<{ url: string; init?: RequestInit }>;
  concurrency?: number;
  cacheTtlMs?: number;
  now?: () => number;
}) {
  const requests = input.requests ?? [];
  const fetchImpl: OfficialMusicFetch = input.fetchOverride ?? (async (urlInput, init) => {
    const url = urlInput.toString();
    requests.push({ url, init });
    if (url === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      return response(input.singleHtml ?? otonanoSinglesFixture(), "text/html; charset=UTF-8");
    }
    const catalogNumber = url.match(/\/discography\/(MHCL-\d+)\/callback\//)?.[1];
    if (!catalogNumber) return response("missing", "text/plain", { status: 404 });
    const ordinal = MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.indexOf(catalogNumber) + 1;
    return response(
      sonyAlbumJsonp(catalogNumber, input.albumOverrides?.(catalogNumber, ordinal)),
      "text/javascript; charset=UTF-8",
    );
  });
  return {
    requests,
    client: new MomoeYamaguchiOfficialCatalogClient({
      fetchImpl,
      resolveHost: publicResolver,
      sleep: async () => undefined,
      retryCount: 0,
      concurrency: input.concurrency ?? 3,
      cacheTtlMs: input.cacheTtlMs,
      now: input.now,
    }),
  };
}

test("parses 33 OTONANO jackets into exactly 32 formal singles and excludes Promotion Only", () => {
  const singles = parseMomoeYamaguchiOtonanoSingles(otonanoSinglesFixture());

  assert.equal(singles.length, 32);
  assert.equal(singles[0]?.title, "曲1");
  assert.equal(singles[0]?.originalReleaseDate, "1973-01-01");
  assert.equal(singles[0]?.originalCatalogNumber, "SOLB 100");
  assert.equal(singles[31]?.title, "曲32");
  assert.equal(singles.some((work) => work.title === "あなたへの子守唄"), false);
  assert.equal(singles.every((work) => work.cover.scope === "WORK"), true);
  assert.equal(singles.every((work) => work.cover.url.startsWith("https://www.110107.com/")), true);
});

test("strict Sony JSONP parsing separates original date from the 2004 source edition", () => {
  const catalogNumber = "MHCL-10011";
  const album = parseMomoeYamaguchiSonyAlbumJsonp(
    sonyAlbumJsonp(catalogNumber, {
      title: "山口百恵ファースト・アルバム　としごろ（初回生産限定盤）",
    }),
    catalogNumber,
  );

  assert.equal(album.title, "としごろ");
  assert.equal(album.originalReleaseDate, "1973-08-21");
  assert.deepEqual(album.sourceEdition, {
    catalogNumber,
    releaseDate: "2004-05-19",
  });
  assert.equal(album.evidence.observedOriginalReleaseDate, "1973-08-21");
  assert.equal(album.evidence.observedEditionReleaseDate, "2004-05-19");
  assert.equal(album.cover.url.startsWith("https://www.sonymusic.co.jp/adm_image/"), true);
  assert.equal(album.cover.sourceUrl, momoeYamaguchiSonyAlbumProductUrl(catalogNumber));
  assert.equal(album.evidence.sourceUrl, momoeYamaguchiSonyAlbumProductUrl(catalogNumber));
  assert.equal(album.evidence.retrievalUrl, momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber));
});

test("strict Sony COSMOS JSONP parsing binds only the fixed 1993 physical-CD tuple", async () => {
  const carrier = parseMomoeYamaguchiCosmosCdJsonp(cosmosCdJsonp());
  assert.deepEqual({
    artist: carrier.artist,
    title: carrier.title,
    date: carrier.releaseDate,
    catalog: carrier.catalogNumber,
    format: carrier.format,
    sourceUrl: carrier.sourceUrl,
    retrievalUrl: carrier.retrievalUrl,
  }, {
    artist: "山口百恵",
    title: "COSMOS宇宙",
    date: "1993-06-21",
    catalog: "SRCL-2622",
    format: "CD",
    sourceUrl: MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
    retrievalUrl: MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
  });

  const requests: string[] = [];
  const client = new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl: async (url) => {
      requests.push(url.toString());
      return response(cosmosCdJsonp(), "text/javascript; charset=UTF-8");
    },
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
  });
  assert.equal((await client.loadCosmosPhysicalCdCarrier()).catalogNumber, "SRCL-2622");
  assert.deepEqual(requests, [MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL]);
});

test("strict Sony COSMOS parser rejects every fixed carrier-boundary mismatch", () => {
  const cases: Array<[string, string]> = [
    ["wrong callback", cosmosCdJsonp().replace("cdbox_srcl2622", "other_callback")],
    ["wrong artist", cosmosCdJsonp({ artistName: "Other Artist" })],
    ["wrong title", cosmosCdJsonp({ title: "COSMOS" })],
    ["wrong date", cosmosCdJsonp({ release_date: "1993.06.22" })],
    ["wrong catalog", cosmosCdJsonp({ representative_goods_number: "SRCL-2623" })],
    ["wrong product type", cosmosCdJsonp({ type: "配信" })],
    ["missing track", cosmosCdJsonp({ discs: cosmosTracks.slice(0, -1).map((title, index) => ({
      disc_number: 1,
      contents: [{ track_number: index + 1, title }],
    })) })],
    ["wrong disc", cosmosCdJsonp({ discs: cosmosTracks.map((title, index) => ({
      disc_number: index === 0 ? 2 : 1,
      contents: [{ track_number: index + 1, title }],
    })) })],
  ];
  for (const [name, payload] of cases) {
    assert.throws(() => parseMomoeYamaguchiCosmosCdJsonp(payload), /Sony|COSMOS/, name);
  }
});

test("loads a complete 32+22 canonical catalog with bounded parallel GET requests", async () => {
  let active = 0;
  let maximumActive = 0;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: OfficialMusicFetch = async (urlInput, init) => {
    const url = urlInput.toString();
    requests.push({ url, init });
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    active -= 1;
    if (url === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      return response(otonanoSinglesFixture(), "text/html; charset=UTF-8");
    }
    const catalogNumber = url.match(/\/discography\/(MHCL-\d+)\/callback\//)?.[1];
    assert.ok(catalogNumber);
    return response(sonyAlbumJsonp(catalogNumber), "text/javascript; charset=UTF-8");
  };
  const result = await new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
    concurrency: 3,
  }).load();

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.complete, true);
  assert.equal(result.works.length, 54);
  assert.equal(result.singles.length, 32);
  assert.equal(result.originalAlbums.length, 22);
  assert.equal(result.originalAlbums[0]?.originalReleaseDate, "1973-08-21");
  assert.equal(result.originalAlbums[21]?.originalReleaseDate, "1980-10-21");
  assert.equal(Object.keys(result.coverByWorkKey).length, 54);
  assert.equal(result.stats.promotionalRowsExcluded, 1);
  assert.equal(result.stats.requestsAttempted, 23);
  assert.equal(requests.length, 23);
  assert.equal(maximumActive >= 2 && maximumActive <= 3, true);
  assert.equal(requests.every((request) => request.init?.method === "GET"), true);
  assert.equal(requests.every((request) => request.init?.credentials === "omit"), true);
  assert.equal(requests.every((request) => request.init?.redirect === "manual"), true);
});

test("fails closed for malformed JSONP and missing Sony fields", () => {
  const catalogNumber = "MHCL-10011";
  assert.throws(
    () => parseMomoeYamaguchiSonyAlbumJsonp("alert({});", catalogNumber),
    /JSONP callback wrapper/,
  );
  assert.throws(
    () => parseMomoeYamaguchiSonyAlbumJsonp(
      sonyAlbumJsonp(catalogNumber, { comments: [] }),
      catalogNumber,
    ),
    /incomplete album item/,
  );
});

test("rejects non-whitelisted cover hosts for both official sources", () => {
  assert.throws(
    () => parseMomoeYamaguchiOtonanoSingles(otonanoSinglesFixture({ wrongCoverHost: true })),
    /unsafe or structurally incomplete/,
  );
  assert.throws(
    () => parseMomoeYamaguchiSonyAlbumJsonp(
      sonyAlbumJsonp("MHCL-10011", {
        image_original: "https://evil.example/adm_image/common/artist_image/jacket_image/1.jpg",
      }),
      "MHCL-10011",
    ),
    /unsafe or conflicting/,
  );
});

test("rejects duplicate work identities and missing formal OTONANO fields", () => {
  assert.throws(
    () => parseMomoeYamaguchiOtonanoSingles(otonanoSinglesFixture({ duplicateTitle: true })),
    /duplicate work identity/,
  );
  assert.throws(
    () => parseMomoeYamaguchiOtonanoSingles(otonanoSinglesFixture({ missingFormalDate: true })),
    /missing its date/,
  );
});

test("a duplicate album makes the entire client result source-incomplete with no partial works", async () => {
  const { client } = fixtureClient({
    albumOverrides: (_catalogNumber, ordinal) => ordinal === 2
      ? { title: "Album 1（初回盤）" }
      : {},
  });
  const result = await client.load();

  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.complete, false);
  assert.deepEqual(result.works, []);
  assert.equal(result.warnings[0]?.code, "incomplete-catalog");
});

test("rejects oversized source responses before parsing", async () => {
  const fetchImpl: OfficialMusicFetch = async (input) => {
    if (input.toString() === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      return response("small", "text/html", {
        headers: { "Content-Length": String(512 * 1024 + 1) },
      });
    }
    return response("unused", "text/javascript");
  };
  const result = await new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
  }).load();

  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.warnings[0]?.code, "response-too-large");
  assert.deepEqual(result.works, []);
});

test("coalesces concurrent loads into one 23-request flight and reuses only the complete result", async () => {
  let calls = 0;
  const fetchImpl: OfficialMusicFetch = async (input) => {
    calls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const url = input.toString();
    if (url === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      return response(otonanoSinglesFixture(), "text/html; charset=UTF-8");
    }
    const catalogNumber = url.match(/\/discography\/(MHCL-\d+)\/callback\//)?.[1];
    assert.ok(catalogNumber);
    return response(sonyAlbumJsonp(catalogNumber), "text/javascript; charset=UTF-8");
  };
  const client = new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
    concurrency: 3,
    cacheTtlMs: 60_000,
    now: () => 1_000,
  });

  const [first, second, third] = await Promise.all([
    client.load(),
    client.load(),
    client.load(),
  ]);
  assert.equal(first.complete, true);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(calls, 23);

  const cached = await client.load();
  assert.equal(cached, first);
  assert.equal(calls, 23);
});

test("does not cache a source-incomplete retryable result and succeeds on the next load", async () => {
  let failFirstAlbumRequest = true;
  let calls = 0;
  let otonanoCalls = 0;
  const firstAlbumUrl = momoeYamaguchiSonyAlbumJsonpUrl("MHCL-10011");
  const fetchImpl: OfficialMusicFetch = async (input) => {
    const url = input.toString();
    calls += 1;
    if (url === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      otonanoCalls += 1;
      return response(otonanoSinglesFixture(), "text/html; charset=UTF-8");
    }
    if (url === firstAlbumUrl && failFirstAlbumRequest) {
      failFirstAlbumRequest = false;
      return response("temporary", "text/javascript", { status: 503 });
    }
    const catalogNumber = url.match(/\/discography\/(MHCL-\d+)\/callback\//)?.[1];
    assert.ok(catalogNumber);
    return response(sonyAlbumJsonp(catalogNumber), "text/javascript; charset=UTF-8");
  };
  const client = new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
    cacheTtlMs: 60_000,
  });

  const incomplete = await client.load();
  const callsAfterFailure = calls;
  assert.equal(incomplete.status, "SOURCE_INCOMPLETE");
  assert.equal(incomplete.warnings[0]?.retryable, true);

  const complete = await client.load();
  assert.equal(complete.status, "COMPLETE");
  assert.equal(calls > callsAfterFailure, true);
  assert.equal(otonanoCalls, 2);

  const cached = await client.load();
  assert.equal(cached, complete);
  assert.equal(calls > callsAfterFailure, true);
  assert.equal(otonanoCalls, 2);
});

test("expires the finite complete-result cache at the injected clock boundary", async () => {
  let now = 10_000;
  let calls = 0;
  const fetchImpl: OfficialMusicFetch = async (input) => {
    calls += 1;
    const url = input.toString();
    if (url === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) {
      return response(otonanoSinglesFixture(), "text/html; charset=UTF-8");
    }
    const catalogNumber = url.match(/\/discography\/(MHCL-\d+)\/callback\//)?.[1];
    assert.ok(catalogNumber);
    return response(sonyAlbumJsonp(catalogNumber), "text/javascript; charset=UTF-8");
  };
  const client = new MomoeYamaguchiOfficialCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    retryCount: 0,
    cacheTtlMs: 100,
    now: () => now,
  });

  const first = await client.load();
  assert.equal(first.complete, true);
  assert.equal(calls, 23);

  now = 10_099;
  assert.equal(await client.load(), first);
  assert.equal(calls, 23);

  now = 10_100;
  const refreshed = await client.load();
  assert.equal(refreshed.complete, true);
  assert.notEqual(refreshed, first);
  assert.equal(calls, 46);
});
