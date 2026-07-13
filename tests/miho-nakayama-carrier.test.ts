import assert from "node:assert/strict";
import test from "node:test";
import {
  MIHO_NAKAYAMA_KING_CARRIER_URL,
  MihoNakayamaCarrierSourceFailure,
  MihoNakayamaKingCarrierClient,
  parseMihoNakayamaKingCarrierPage,
  type MihoNakayamaCarrierFailureCode,
} from "@/lib/official-music/miho-nakayama-carrier";

const canonicalDiscs = [
  [
    "「C」",
    "生意気",
    "BE-BOP-HIGHSCHOOL",
    "色・ホワイトブレンド",
    "クローズ・アップ",
    "JINGI・愛してもらいます",
    "ツイてるね ノッてるね",
    "WAKU WAKU させて",
    "「派手!!!」",
    "50/50",
    "CATCH ME",
    "You‘re My Only Shinin’ Star",
    "人魚姫 mermaid",
    "Witches ウィッチズ",
  ],
  [
    "ROSÉCOLOR",
    "VIRGIN EYES",
    "Midnight Taxi",
    "セミスゥィートの魔法",
    "女神たちの冒険",
    "愛してるっていわない！",
    "これからのI LOVE YOU",
    "Rosa",
    "遠い街のどこかで・・・",
    "Mellow",
    "世界中の誰よりきっと",
    "幸せになるために",
    "あなたになら・・・",
  ],
  [
    "ただ泣きたくなるの",
    "Sea Paradise–OLの反乱−",
    "HERO",
    "CHEERS FOR YOU",
    "Hurt to Heart ～痛みの行方～",
    "Thinking About You ～あなたの夜を包みたい～",
    "True Romance",
    "未来へのプレゼント",
    "マーチ カラー",
    "LOVE CLOVER",
    "A Place Under the Sun",
    "Adore",
    "君のこと",
  ],
] as const;

type FixtureOverrides = {
  artist?: string;
  title?: string;
  visibleDate?: string;
  hiddenDate?: string;
  catalog?: string;
  productType?: string;
  summaryDiscCount?: number;
  summaryTrackCount?: number;
  discs?: string[][];
  canonicalUrl?: string;
  openGraphUrl?: string;
  omitDisc?: number;
};

function cloneDiscs(): string[][] {
  return canonicalDiscs.map((disc) => [...disc] as string[]);
}

function fixturePage(overrides: FixtureOverrides = {}) {
  const artist = overrides.artist ?? "中山美穂";
  const title = overrides.title ?? "All Time Best【初回限定盤】";
  const visibleDate = overrides.visibleDate ?? "2020/12/23";
  const hiddenDate = overrides.hiddenDate ?? "2020-12-23 00:00:00";
  const catalog = overrides.catalog ?? "KICS-93968～70";
  const discs = overrides.discs ?? cloneDiscs();
  const trackList = discs.map((tracks, index) => {
    const disc = index + 1;
    if (disc === overrides.omitDisc) return "";
    return [
      `[DISC-${disc}]`,
      ...tracks.map((track, trackIndex) =>
        `${String(trackIndex + 1).padStart(2, "0")}.${track}`),
    ].join("\n");
  }).join("\n\n");
  return `<!doctype html>
  <html lang="ja">
    <head>
      <title>${title} | ${artist} | キングレコードオフィシャルサイト</title>
      <link rel="canonical" href="${overrides.canonicalUrl ?? MIHO_NAKAYAMA_KING_CARRIER_URL}">
      <meta property="og:url" content="${overrides.openGraphUrl ?? MIHO_NAKAYAMA_KING_CARRIER_URL}">
      <meta property="og:image" content="https://www.kingrecords.co.jp/img/goods/L/container.jpg">
    </head>
    <body>
      <div class="detail__content__desc">
        <p class="desc--type">${overrides.productType ?? "CDアルバム | ブルーレイディスク"}</p>
        <h3 class="desc--title">${title}</h3>
        <p class="desc--artist"><a href="/cs/artist/artist.aspx?artist=10057">${artist}</a></p>
        <p class="desc--date">${visibleDate}</p>
      </div>
      <div class="detail__content__form">
        <p class="form--info">${catalog} <i>￥7,700</i></p>
      </div>
      <div class="detail__content__text">
        <div class="text--block">今までにリリースしたシングル39作品に「君のこと」を入れた全${overrides.summaryTrackCount ?? 40}曲を収録したCD${overrides.summaryDiscCount ?? 3}枚組。
${trackList}

[Blu-ray]
「VIRGIN FLIGHT '86 MIHO NAKAYAMA FIRST CONCERT」</div>
      </div>
      <input type="hidden" name="isrc_goods_artistname" value="${artist}">
      <input type="hidden" name="isrc_goods_name" value="${title}">
      <input type="hidden" name="isrc_goods_release_dt" value="${hiddenDate}">
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
  sourceUrl = MIHO_NAKAYAMA_KING_CARRIER_URL,
) {
  assert.throws(
    () => parseMihoNakayamaKingCarrierPage(fixturePage(overrides), sourceUrl),
    (error) => error instanceof MihoNakayamaCarrierSourceFailure && error.code === code,
  );
}

test("strictly returns one King carrier tuple and never exposes the container cover as a work cover", () => {
  const carrier = parseMihoNakayamaKingCarrierPage(fixturePage());
  assert.equal(carrier.artist, "中山美穂");
  assert.equal(carrier.title, "All Time Best【初回限定盤】");
  assert.equal(carrier.releaseDate, "2020-12-23");
  assert.equal(carrier.catalogNumber, "KICS-93968～70");
  assert.equal(carrier.cdDiscCount, 3);
  assert.equal(carrier.trackCount, 40);
  assert.equal(carrier.tracks.length, 40);
  assert.deepEqual(carrier.manifestCarrierWorks, [
    { manifestTitle: "生意気", observedTrackTitle: "生意気", disc: 1, position: 2 },
    {
      manifestTitle: "BE-BOP-HIGHSCHOOL",
      observedTrackTitle: "BE-BOP-HIGHSCHOOL",
      disc: 1,
      position: 3,
    },
    {
      manifestTitle: "ツイてるねノッてるね",
      observedTrackTitle: "ツイてるね ノッてるね",
      disc: 1,
      position: 7,
    },
    { manifestTitle: "VIRGIN EYES", observedTrackTitle: "VIRGIN EYES", disc: 2, position: 2 },
  ]);
  assert.equal(carrier.workCover, null);
  assert.equal(carrier.coverInheritanceAllowed, false);
  assert.equal("coverUrl" in carrier, false);
  assert.equal("coverImageUrl" in carrier, false);
});

test("fails closed for wrong artist, title, date, catalog, media type, and fixed URL", () => {
  assertParserFailure({ artist: "中山忍" }, "artist-identity-mismatch");
  assertParserFailure({ title: "All Time Best" }, "title-mismatch");
  assertParserFailure({ visibleDate: "2020/12/22", hiddenDate: "2020-12-22 00:00:00" }, "date-mismatch");
  assertParserFailure({ catalog: "KICS-93968" }, "catalog-mismatch");
  assertParserFailure({ productType: "配信アルバム" }, "disc-count-mismatch");
  assertParserFailure({}, "invalid-source-url", "https://www.kingrecords.co.jp/cs/g/gKICS-93969/");
  assertParserFailure({ canonicalUrl: "https://www.kingrecords.co.jp/cs/g/gKICS-93969/" }, "invalid-source-url");
});

test("fails closed for wrong disc and track counts", () => {
  assertParserFailure({ summaryDiscCount: 2 }, "disc-count-mismatch");
  assertParserFailure({ omitDisc: 3 }, "disc-count-mismatch");
  assertParserFailure({ summaryTrackCount: 39 }, "track-count-mismatch");
  const missingTrack = cloneDiscs();
  missingTrack[2]!.pop();
  assertParserFailure({ discs: missingTrack }, "track-count-mismatch");
});

test("requires every manifest work exactly once and never accepts a substring", () => {
  const missing = cloneDiscs();
  missing[0]![2] = "THE BE-BOP-HIGHSCHOOL REMIX";
  assertParserFailure({ discs: missing }, "carrier-track-missing");

  const duplicated = cloneDiscs();
  duplicated[0]![3] = "生意気";
  assertParserFailure({ discs: duplicated }, "carrier-track-duplicate");

  const wrongPosition = cloneDiscs();
  [wrongPosition[0]![1], wrongPosition[0]![3]] = [wrongPosition[0]![3]!, wrongPosition[0]![1]!];
  assertParserFailure({ discs: wrongPosition }, "carrier-track-position-mismatch");
});

test("accepts only the controlled official spacing alias for ツイてるねノッてるね", () => {
  const unspaced = cloneDiscs();
  unspaced[0]![6] = "ツイてるねノッてるね";
  const carrier = parseMihoNakayamaKingCarrierPage(fixturePage({ discs: unspaced }));
  assert.equal(
    carrier.manifestCarrierWorks[2]?.observedTrackTitle,
    "ツイてるねノッてるね",
  );

  const uncontrolled = cloneDiscs();
  uncontrolled[0]![6] = "ツイてるね・ノッてるね";
  assertParserFailure({ discs: uncontrolled }, "carrier-track-missing");
});

test("recovers from one partial network failure without relaxing request safety", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const client = new MihoNakayamaKingCarrierClient({
    resolveHost: publicResolver,
    retryCount: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(input, MIHO_NAKAYAMA_KING_CARRIER_URL);
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
  assert.equal(calls, 2);
  assert.equal(result.stats.retries, 1);
  assert.deepEqual(sleeps, [250]);
});

test("network exhaustion returns no partial carrier facts and failures are not cached", async () => {
  let calls = 0;
  const client = new MihoNakayamaKingCarrierClient({
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
  assert.equal(first.carrier, null);
  assert.equal(first.warnings[0].code, "network-unavailable");
  assert.equal(second.complete, false);
  assert.equal(calls, 2);
});

test("DNS must resolve exclusively to public addresses", async () => {
  let fetched = false;
  const client = new MihoNakayamaKingCarrierClient({
    resolveHost: async () => ["127.0.0.1"],
    retryCount: 0,
    fetchImpl: async () => {
      fetched = true;
      return htmlResponse(fixturePage());
    },
  });
  const result = await client.load();
  assert.equal(result.complete, false);
  assert.equal(result.warnings[0].code, "non-public-address");
  assert.equal(fetched, false);
});

test("redirects, non-HTML responses, and oversized bodies fail closed", async (t) => {
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
      name: "content-type",
      response: () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      code: "unsupported-content-type",
    },
    {
      name: "content-length",
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
      const client = new MihoNakayamaKingCarrierClient({
        resolveHost: publicResolver,
        retryCount: 0,
        fetchImpl: async () => fixture.response(),
      });
      const result = await client.load();
      assert.equal(result.complete, false);
      assert.equal(result.warnings[0].code, fixture.code);
      assert.equal(result.carrier, null);
    });
  }
});

test("complete results are cached for the bounded TTL", async () => {
  let calls = 0;
  let now = 1_000;
  const client = new MihoNakayamaKingCarrierClient({
    resolveHost: publicResolver,
    now: () => now,
    cacheTtlMs: 1_000,
    retryCount: 0,
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
