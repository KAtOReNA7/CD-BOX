import assert from "node:assert/strict";
import test from "node:test";
import {
  MIHO_NAKAYAMA_MELLOW_CD_URL,
  MihoNakayamaCarrierSourceFailure,
  MihoNakayamaMellowCdClient,
  parseMihoNakayamaMellowCdPage,
  type MihoNakayamaCarrierFailureCode,
} from "@/lib/official-music/miho-nakayama-carrier";

const canonicalTracks = [
  "Mellow",
  "あるきなさい",
  "ゆっくりMy Love",
  "Platinum Cat",
  "Silent",
  "忘れなくてもいいじゃない",
  "灼熱の心",
  "はなしをきいて",
  "Kiss Kiss Kiss",
  "Treasure",
  "Mellow(CM Version)",
];

type FixtureOverrides = {
  artist?: string;
  title?: string;
  visibleDate?: string;
  hiddenDate?: string;
  catalog?: string;
  productType?: string;
  hiddenProductType?: string;
  canonicalUrl?: string;
  openGraphUrl?: string;
  discNumber?: number;
  tracks?: string[];
  trackHeading?: string;
};

function fixturePage(overrides: FixtureOverrides = {}) {
  const artist = overrides.artist ?? "中山美穂";
  const title = overrides.title ?? "Mellow";
  const tracks = overrides.tracks ?? [...canonicalTracks];
  const trackRows = tracks.map((track, index) => `
    <div class="track_"><div class="detail_"><div class="track_title_">
      ${index + 1}.${track}
    </div></div></div>`).join("\n");
  return `<!doctype html>
  <html lang="ja">
    <head>
      <title>${title} | ${artist} | キングレコードオフィシャルサイト</title>
      <link rel="canonical" href="${overrides.canonicalUrl ?? MIHO_NAKAYAMA_MELLOW_CD_URL}">
      <meta property="og:url" content="${overrides.openGraphUrl ?? MIHO_NAKAYAMA_MELLOW_CD_URL}">
      <meta property="og:image" content="https://www.kingrecords.co.jp/img/goods/L/mellow-container.jpg">
    </head>
    <body>
      <div class="detail__content__desc">
        <p class="desc--type">${overrides.productType ?? "CDアルバム"}</p>
        <h3 class="desc--title">${title}</h3>
        <p class="desc--artist"><a href="/cs/artist/artist.aspx?artist=10057">${artist}</a></p>
        <p class="desc--date">${overrides.visibleDate ?? "2015/10/14"}</p>
      </div>
      <div class="detail__content__form">
        <p class="form--info">${overrides.catalog ?? "KICS-3274"} <i>￥1,980</i></p>
      </div>
      <div class="detail__content__text">
        <h5 class="text--head">${overrides.trackHeading ?? "収録内容"}</h5>
        <div class="text--block"><div class="cd_disc_"><div class="disclist">
          No.楽曲<br>【DISC${overrides.discNumber ?? 1} CDアルバム】
          ${trackRows}
        </div></div></div>
      </div>
      <input type="hidden" name="isrc_goods_disc" value="${overrides.hiddenProductType ?? "CDアルバム"}">
      <input type="hidden" name="isrc_goods_artistname" value="${artist}">
      <input type="hidden" name="isrc_goods_name" value="${title}">
      <input type="hidden" name="isrc_goods_release_dt" value="${overrides.hiddenDate ?? "2015-10-14 00:00:00"}">
    </body>
  </html>`;
}

function htmlResponse(html: string, init: ResponseInit = {}) {
  return new Response(html, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function publicResolver() {
  return Promise.resolve(["93.184.216.34"]);
}

function assertParserFailure(
  overrides: FixtureOverrides,
  code: MihoNakayamaCarrierFailureCode,
  sourceUrl = MIHO_NAKAYAMA_MELLOW_CD_URL,
) {
  assert.throws(
    () => parseMihoNakayamaMellowCdPage(fixturePage(overrides), sourceUrl),
    (error) => error instanceof MihoNakayamaCarrierSourceFailure && error.code === code,
  );
}

test("returns one later official SAME_WORK Mellow CD edition without inheriting its product cover", () => {
  const edition = parseMihoNakayamaMellowCdPage(fixturePage());
  assert.deepEqual({
    artist: edition.artist,
    workTitle: edition.workTitle,
    originalReleaseDate: edition.originalReleaseDate,
    editionReleaseDate: edition.editionReleaseDate,
    catalogNumber: edition.catalogNumber,
    format: edition.format,
    representationKind: edition.representationKind,
    isReissue: edition.isReissue,
    discs: edition.cdDiscCount,
    tracks: edition.trackCount,
  }, {
    artist: "中山美穂",
    workTitle: "Mellow",
    originalReleaseDate: "1992-06-10",
    editionReleaseDate: "2015-10-14",
    catalogNumber: "KICS-3274",
    format: "CD",
    representationKind: "SAME_WORK_EDITION",
    isReissue: true,
    discs: 1,
    tracks: 11,
  });
  assert.deepEqual(edition.tracks.map((track) => track.title), canonicalTracks);
  assert.equal(edition.tracks[0]?.title, "Mellow");
  assert.equal(edition.tracks.at(-1)?.title, "Mellow(CM Version)");
  assert.equal(edition.workCover, null);
  assert.equal(edition.coverInheritanceAllowed, false);
  assert.equal("coverUrl" in edition, false);
  assert.equal("coverImageUrl" in edition, false);
});

test("fails closed for wrong identity, edition tuple, media, and URL", () => {
  assertParserFailure({ artist: "中山忍" }, "artist-identity-mismatch");
  assertParserFailure({ title: "Mellow Deluxe" }, "title-mismatch");
  assertParserFailure({
    visibleDate: "2015/10/15",
    hiddenDate: "2015-10-15 00:00:00",
  }, "date-mismatch");
  assertParserFailure({ catalog: "KICS-3275" }, "catalog-mismatch");
  assertParserFailure({ productType: "配信アルバム" }, "disc-count-mismatch");
  assertParserFailure({ hiddenProductType: "ブルーレイディスク" }, "disc-count-mismatch");
  assertParserFailure({}, "invalid-source-url", "https://www.kingrecords.co.jp/cs/g/gKICS-3275/");
  assertParserFailure({ canonicalUrl: "https://www.kingrecords.co.jp/cs/g/gKICS-3275/" }, "invalid-source-url");
});

test("requires the unique ordered 11-track DISC1 list", () => {
  assertParserFailure({ discNumber: 2 }, "disc-count-mismatch");
  assertParserFailure({ tracks: canonicalTracks.slice(0, 10) }, "track-count-mismatch");
  assertParserFailure({ tracks: [...canonicalTracks, "Bonus"] }, "track-count-mismatch");
  assertParserFailure({ trackHeading: "商品詳細" }, "track-list-invalid");

  const swapped = [...canonicalTracks];
  [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  assertParserFailure({ tracks: swapped }, "track-title-mismatch");

  const duplicate = [...canonicalTracks];
  duplicate[10] = "Mellow";
  assertParserFailure({ tracks: duplicate }, "track-title-mismatch");

  const wrongLast = [...canonicalTracks];
  wrongLast[10] = "Mellow CM Version";
  assertParserFailure({ tracks: wrongLast }, "track-title-mismatch");
});

test("recovers from one network failure and preserves strict request controls", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const client = new MihoNakayamaMellowCdClient({
    resolveHost: publicResolver,
    retryCount: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(input, MIHO_NAKAYAMA_MELLOW_CD_URL);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.referrerPolicy, "no-referrer");
      if (calls === 1) throw new Error("temporary network failure");
      return htmlResponse(fixturePage());
    },
  });
  const result = await client.load();
  assert.equal(result.complete, true);
  assert.equal(result.edition?.catalogNumber, "KICS-3274");
  assert.equal(calls, 2);
  assert.equal(result.stats.retries, 1);
  assert.deepEqual(sleeps, [250]);
});

test("network or DNS failure returns no partial edition facts and is not cached", async () => {
  let calls = 0;
  const client = new MihoNakayamaMellowCdClient({
    resolveHost: publicResolver,
    retryCount: 0,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    },
  });
  const first = await client.load();
  const second = await client.load();
  assert.equal(first.complete, false);
  assert.equal(first.edition, null);
  assert.equal(first.warnings[0].code, "network-unavailable");
  assert.equal(second.complete, false);
  assert.equal(calls, 2);

  let fetched = false;
  const privateDns = new MihoNakayamaMellowCdClient({
    resolveHost: async () => ["127.0.0.1"],
    retryCount: 0,
    fetchImpl: async () => {
      fetched = true;
      return htmlResponse(fixturePage());
    },
  });
  const privateResult = await privateDns.load();
  assert.equal(privateResult.complete, false);
  assert.equal(privateResult.warnings[0].code, "non-public-address");
  assert.equal(fetched, false);
});

test("redirects, invalid MIME, and oversized bodies fail closed", async (t) => {
  const cases: Array<{
    name: string;
    response: () => Response;
    code: MihoNakayamaCarrierFailureCode;
  }> = [
    {
      name: "redirect",
      response: () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com/" },
      }),
      code: "invalid-source-url",
    },
    {
      name: "mime",
      response: () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      code: "unsupported-content-type",
    },
    {
      name: "size",
      response: () => new Response("small", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(512 * 1_024 + 1),
        },
      }),
      code: "response-too-large",
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const client = new MihoNakayamaMellowCdClient({
        resolveHost: publicResolver,
        retryCount: 0,
        fetchImpl: async () => fixture.response(),
      });
      const result = await client.load();
      assert.equal(result.complete, false);
      assert.equal(result.edition, null);
      assert.equal(result.warnings[0].code, fixture.code);
    });
  }
});

test("only complete Mellow results are cached for the bounded TTL", async () => {
  let calls = 0;
  let now = 1_000;
  const client = new MihoNakayamaMellowCdClient({
    resolveHost: publicResolver,
    retryCount: 0,
    now: () => now,
    cacheTtlMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      return htmlResponse(fixturePage());
    },
  });
  const first = await client.load();
  const cached = await client.load();
  assert.equal(first.complete, true);
  assert.equal(cached.complete, true);
  assert.equal(cached.stats.cacheHits, 1);
  assert.equal(calls, 1);
  now = 2_001;
  await client.load();
  assert.equal(calls, 2);
});
