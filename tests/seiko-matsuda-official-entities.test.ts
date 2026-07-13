import assert from "node:assert/strict";
import test from "node:test";
import {
  SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS,
  SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS,
  SeikoMatsudaOfficialEntityClient,
  SeikoMatsudaOfficialSourceFailure,
  parseSeikoMatsudaOfficialEntityPage,
  parseSeikoMatsudaDancingNdlEvidence,
  parseSeikoMatsudaWhosNdlEvidence,
  parseSeikoMatsudaWhosSonyBoxEvidence,
  seikoMatsudaOfficialDetailUrl,
  type SeikoMatsudaOfficialFailureCode,
  type SeikoMatsudaOfficialWorkKey,
} from "@/lib/official-music/seiko-matsuda";

type Fixture = {
  title: string;
  categoryLabel: "シングル" | "アルバム";
  categoryPath: "/discography/single" | "/discography/album";
  date: string;
  catalog: string;
  coverPath: string;
  tracks: Array<[title: string, duration: string]>;
};

const fixtures: Record<SeikoMatsudaOfficialWorkKey, Fixture> = {
  "SINGLE:22": {
    title: "DANCING SHOES (Club Mix)",
    categoryLabel: "シングル",
    categoryPath: "/discography/single",
    date: "1985年06月24日",
    catalog: "12AH-1896",
    coverPath: "/discography/images/upload/1985-3_Artwork19850624-112-0001.gif",
    tracks: [
      ["DANCING SHOES(Club Mix)", "5:52"],
      ["DANCING SHOES(Instrumental)", "4:03"],
      ["CRAZY ME, CRAZY FOR YOU", "4:13"],
    ],
  },
  "SINGLE:29": {
    title: "Who's that boy",
    categoryLabel: "シングル",
    categoryPath: "/discography/single",
    date: "1990年10月01日",
    catalog: "73523",
    coverPath: "/discography/images/upload/1990-4_Artwork19901001-112-0001.gif",
    tracks: [
      ["Who's that boy", "4:42"],
      ["He's so good to me", "4:14"],
    ],
  },
  "SINGLE:71": {
    title: "特別な恋人/声だけ聞かせて",
    categoryLabel: "シングル",
    categoryPath: "/discography/single",
    date: "2011年11月23日",
    catalog: "UMCK-5355",
    coverPath: "/discography/images/upload/2011-4_Artwork20111123-112-0001.jpg",
    tracks: [
      ["特別な恋人", "4:56"],
      ["声だけ聞かせて", "4:23"],
      ["特別な恋人 (Instrumental)", "4:55"],
      ["声だけ聞かせて (Instrumental)", "4:22"],
    ],
  },
  "ORIGINAL_ALBUM:29": {
    title: "Sweetest Time",
    categoryLabel: "アルバム",
    categoryPath: "/discography/album",
    date: "1997年12月03日",
    catalog: "PHCL-12",
    coverPath: "/discography/images/upload/1997-1_Artwork19971203-111-0001.gif",
    tracks: [
      ["Gone with the rain", "4:43"],
      ["Why say goodbye", "5:33"],
      ["KissしてX'mas", "4:58"],
      ["Gone with the rain (English Version)", "4:42"],
      ["Why say Goodbye (English Version)", "5:33"],
      ["あなたに逢いたくて ～Missing You～ (Engllish Version)", "5:33"],
    ],
  },
  "ORIGINAL_ALBUM:35": {
    title: "area62",
    categoryLabel: "アルバム",
    categoryPath: "/discography/album",
    date: "2002年06月21日",
    catalog: "VIVI-19623/TGCS-1439",
    coverPath: "/discography/images/upload/2002-1_Artwork20020621-111-0001.gif",
    tracks: [
      ["all to you", "4:22"],
      ["just for tonight", "3:57"],
      ["I'm right here", "4:17"],
      ["never need another", "4:12"],
      ["let's fall in love again", "4:27"],
      ["everything I am", "4:00"],
      ["chameleon", "3:40"],
      ["downtown tokyo", "4:00"],
      ["ave maria", "3:41"],
      ["downtown tokyo (Japanese)", "3:59"],
      ["all to you (Japanese)", "4:22"],
      ["all to you (remix 4-5)", "5:06"],
      ["ave maria (wavemix)", "4:06"],
    ],
  },
};

type PageOverrides = Partial<Fixture> & {
  coverAlt?: string;
  artistLogoAlt?: string;
  pageTitle?: string;
  duplicateTitle?: boolean;
};

function fixturePage(
  workKey: SeikoMatsudaOfficialWorkKey,
  overrides: PageOverrides = {},
) {
  const fixture = { ...fixtures[workKey], ...overrides };
  const tracks = fixture.tracks.map(([title, duration], index) => `
    <tr>
      <th class="play-no">${index + 1}.</th>
      <td class="play-title">${title}</td>
      <td class="play-time">${duration}</td>
    </tr>`).join("");
  return `<!doctype html>
  <html lang="ja">
    <head><title>${overrides.pageTitle ?? "ディスコグラフィ｜松田聖子オフィシャルサイト"}</title></head>
    <body>
      <div id="logo"><img src="/img/logo.png" alt="${overrides.artistLogoAlt ?? "松田聖子"}" title="松田聖子"></div>
      <nav><a href="/discography/" class="active">Discography</a></nav>
      <div id="discography" class="row">
        <p class="info-title-message">${fixture.categoryLabel}</p>
        <img src="${fixture.coverPath}" alt="${overrides.coverAlt ?? fixture.title}">
        <p class="info-disk-title">${fixture.title}</p>
        ${overrides.duplicateTitle ? `<p class="info-disk-title">${fixture.title}</p>` : ""}
        <p class="info-p">商品番号：${fixture.catalog}</p>
        <p class="info-p">リリース：${fixture.date}</p>
        <p class="info-p"><a href="#disk1">Disk1</a></p>
        <table>${tracks}</table>
      </div>
      <p class="sub-menu"><a href="${fixture.categoryPath}" class="active">category</a></p>
    </body>
  </html>`;
}

type NdlFixtureOverrides = {
  pageTitle?: string;
  bibId?: string;
  title?: string;
  artist?: string;
  catalog?: string;
  date?: string;
  material?: string;
  editionNote?: string;
};

function dancingNdlFixture(overrides: NdlFixtureOverrides = {}) {
  const title = overrides.title ?? "Dancing shoes(Club mix)";
  const bibId = overrides.bibId ?? "000008815159";
  const artist = overrides.artist ?? "-";
  const catalog = overrides.catalog ?? "12AH-1896";
  const date = overrides.date ?? "[19--]";
  const material = overrides.material ?? "アナログ (LP) , 33 1/3rpm";
  return `<!doctype html><html lang="ja"><head>
    <title>${overrides.pageTitle ?? `${title} | NDLサーチ | 国立国会図書館`}</title>
    </head><body><dl>
      <dt>国立国会図書館書誌ID</dt><dd>${bibId}</dd>
      <dt>資料種別</dt><dd>録音資料</dd>
      <dt>著者</dt><dd>${artist}</dd>
      <dt>タイトル</dt><dd>${title}</dd>
      <dt>発売番号</dt><dd>${catalog}</dd>
      <dt>発売番号</dt><dd><span>${catalog}</span></dd>
      <dt>出版年</dt><dd>${date}</dd>
      <dt>出版年月日等</dt><dd>${date}</dd>
      <dt>形態の詳細</dt><dd>${material}</dd>
    </dl></body></html>`;
}

function whosNdlFixture(overrides: NdlFixtureOverrides = {}) {
  const title = overrides.title ?? "Who's that boy";
  const bibId = overrides.bibId ?? "000010906601";
  const artist = overrides.artist ?? "Seiko";
  const catalog = overrides.catalog ?? "SRCL-20090";
  const date = overrides.date ?? "2010.5";
  const material = overrides.material ?? "CD";
  const editionNote = overrides.editionNote ?? "Blu-spec CD";
  const pageTitle = overrides.pageTitle ??
    "Who&#39;s that boy (Thanks 30th anniversary Seiko Matsuda. Seiko Matsuda single collection 30th anniversary box～the voice of a queen～ ; 30) | NDLサーチ | 国立国会図書館";
  return `<!doctype html><html lang="ja"><head><title>${pageTitle}</title></head><body><dl>
    <dt>国立国会図書館書誌ID</dt><dd>${bibId}</dd>
    <dt>資料種別</dt><dd>録音資料</dd>
    <dt>著者</dt><dd>${artist}</dd>
    <dt>著者・編者</dt><dd>${artist}</dd>
    <dt>タイトル</dt><dd>${title}</dd>
    <dt>発売番号</dt><dd>${catalog}</dd>
    <dt>発売番号</dt><dd><span>${catalog}</span></dd>
    <dt>出版年</dt><dd>${date}</dd>
    <dt>出版年月日等</dt><dd>${date}</dd>
    <dt>形態の詳細</dt><dd>${material}</dd>
    <dt>別の媒体に関する注記</dt><dd>${editionNote}</dd>
  </dl></body></html>`;
}

function sonyBoxFixture() {
  return `<!doctype html><html lang="ja"><head>
    <title>絶賛予約受付中!!!<br />5/26発売<br />「Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～」 | 松田聖子 | ソニーミュージックオフィシャルサイト</title>
    <meta property="og:url" content="https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828">
    </head><body class="a-body" data-folder="SeikoMatsuda" data-path="/artist/SeikoMatsuda/">
      <artist-header-component name="松田聖子" folder="SeikoMatsuda"></artist-header-component>
      <span class="p-infoHeader__date">2010.04.03</span>
      <div class="p-infoContent">
        これまで松田聖子を支え続ける多くのファンに向けた最強の記念アイテムとして、デビュー曲「裸足の季節」から最新曲「あの輝いた季節」までの全シングル曲（73枚）をコンプリートした完全生産限定BOXとなります。<br />
        Seiko Matsuda<br />
        Single Collection 30th Anniversary Box<br />
        ～The Voice Of a Queen～<br />
        発売日:2010年5月26日<br />
        品　番:SRCL20061-133<br />
        ①レコード会社の壁を越えた全73シングル！これまでに国内外で発売された全シングル73枚を完全コンプリート！<br />
        ③SONYが開発した高品質DISC「Blu-spec CD」で、デジタルリマスタリングされた音を更にクリアに！<br />
        ⑦全73枚のCD盤は全てジャケット写真をデザインしたピクチャー・レーベル仕様！<br />
        ⑧日本未発売「SEIKO」名義の海外のみで発売されたシングルも６タイトル収録！<br />
        （「ALL WAY TO THE HEAVEN」「WHO’S THAT BOY」「LET’S TALK ABOUT IT」「GOOD FOR YOU」「all to you」<br />
        「just for tonight」）<br />
        ⑨トータル収録曲数全287曲。<br />
      </div>
    </body></html>`;
}

function htmlResponse(html: string, init: ResponseInit = {}) {
  return new Response(html, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function publicResolver() {
  return Promise.resolve(["93.184.216.34"]);
}

function assertParserFailure(
  workKey: SeikoMatsudaOfficialWorkKey,
  html: string,
  code: SeikoMatsudaOfficialFailureCode,
) {
  assert.throws(
    () => parseSeikoMatsudaOfficialEntityPage(workKey, html),
    (error) => error instanceof SeikoMatsudaOfficialSourceFailure && error.code === code,
  );
}

test("strictly parses all five fixed official entity pages and preserves unresolved conflicts", () => {
  const entities = (Object.keys(fixtures) as SeikoMatsudaOfficialWorkKey[])
    .map((workKey) => parseSeikoMatsudaOfficialEntityPage(workKey, fixturePage(workKey)));
  assert.equal(entities.length, 5);
  assert.deepEqual(
    entities.map((entity) => entity.tracks.length),
    [3, 2, 4, 6, 13],
  );
  assert.equal(new Set(entities.map((entity) => entity.cover.url)).size, 5);
  assert.equal(entities.every((entity) =>
    entity.cover.provider === "seiko-matsuda-official" &&
    entity.cover.scope === "WORK" &&
    entity.cover.matchLevel === "WORK_EXACT" &&
    entity.cover.sourceUrl === entity.sourceUrl &&
    entity.cover.requiresAssetValidation), true);

  const dancing = entities.find((entity) => entity.manifestEntryKey === "SINGLE:22")!;
  assert.equal(dancing.observedTitle, "DANCING SHOES (Club Mix)");
  assert.deepEqual(dancing.identityTrackTitles, [
    "DANCING SHOES(Club Mix)",
    "CRAZY ME, CRAZY FOR YOU",
  ]);

  const special = entities.find((entity) => entity.manifestEntryKey === "SINGLE:71")!;
  assert.deepEqual(special.identityTrackTitles, ["特別な恋人", "声だけ聞かせて"]);

  const sweetest = entities.find((entity) =>
    entity.manifestEntryKey === "ORIGINAL_ALBUM:29")!;
  assert.equal(sweetest.observedCategory, "ALBUM");
  assert.equal(sweetest.manifestCategory, "ORIGINAL_ALBUM");
  assert.equal(sweetest.conflicts.taxonomy?.status, "UNRESOLVED");
  assert.equal(sweetest.conflicts.taxonomy?.resolution, null);
  assert.deepEqual(
    sweetest.conflicts.taxonomy?.competingClaims.map((claim) => ({
      provider: claim.provider,
      value: claim.value,
      fetched: claim.fetchedByThisAdapter,
    })),
    [
      { provider: "musicbrainz", value: "EP", fetched: false },
      { provider: "discogs", value: "Mini-Album", fetched: false },
    ],
  );

  const area62 = entities.find((entity) =>
    entity.manifestEntryKey === "ORIGINAL_ALBUM:35")!;
  assert.equal(area62.observedDateKind, "UNRESOLVED");
  assert.equal(area62.conflicts.date?.status, "UNRESOLVED");
  assert.equal(area62.conflicts.date?.officialObservedDate, "2002-06-21");
  assert.equal(area62.conflicts.date?.competingClaims[0]?.value, "2002-06-11");
  assert.equal(area62.conflicts.date?.resolution, null);
  assert.deepEqual(area62.observedCatalogNumbers, ["VIVI-19623", "TGCS-1439"]);
});

test("models Who's that boy external sources as unfetched candidates, never as independent evidence", () => {
  const entity = parseSeikoMatsudaOfficialEntityPage("SINGLE:29", fixturePage("SINGLE:29"));
  assert.deepEqual(entity.optionalExternalEvidence, {
    status: "NOT_FETCHED_BY_ENTITY_PAGE",
    independentlyCorroborated: false,
    verifiedEvidence: [],
    candidates: [
      {
        provider: "sony-music-japan",
        sourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
        fetchedByThisAdapter: false,
        evidence: null,
      },
      {
        provider: "national-diet-library",
        sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010906601",
        fetchedByThisAdapter: false,
        evidence: null,
      },
    ],
  });
  assert.equal(entity.observedCatalogDisplay, "73523");
  assert.deepEqual(entity.observedCatalogNumbers, ["73523"]);
});

test("strictly parses fixed NDL and Sony external evidence with explicit verification limits", () => {
  const dancing = parseSeikoMatsudaDancingNdlEvidence(dancingNdlFixture());
  assert.equal(dancing.status, "PARTIAL");
  assert.equal(dancing.verified, false);
  assert.equal(dancing.unique, true);
  assert.deepEqual(dancing.limitations, ["ARTIST_NOT_PROVIDED", "DATE_UNKNOWN"]);
  assert.equal(dancing.evidence?.evidenceKey, "DANCING_NDL");
  assert.equal(dancing.evidence?.observedArtist, null);
  assert.equal(dancing.evidence?.rawArtist, "-");
  assert.equal(dancing.evidence?.observedTitle, "Dancing shoes(Club mix)");
  assert.equal(dancing.evidence?.observedCatalogNumber, "12AH-1896");
  assert.equal(dancing.evidence?.observedDate, null);
  assert.equal(dancing.evidence?.rawDate, "[19--]");
  assert.deepEqual(dancing.evidence?.verifiedFields, ["title", "catalogNumber", "carrier"]);
  assert.deepEqual(dancing.evidence?.missingFields, ["artist", "date"]);
  assert.equal(dancing.evidence?.provenance.fixedRecordId,
    "R100000002-I000008815159");

  const whosNdl = parseSeikoMatsudaWhosNdlEvidence(whosNdlFixture());
  assert.equal(whosNdl.status, "VERIFIED");
  assert.equal(whosNdl.verified, true);
  assert.equal(whosNdl.unique, true);
  assert.equal(whosNdl.evidence?.evidenceKey, "WHOS_NDL");
  assert.equal(whosNdl.evidence?.observedArtist, "Seiko");
  assert.equal(whosNdl.evidence?.observedTitle, "Who's that boy");
  assert.equal(whosNdl.evidence?.observedCatalogNumber, "SRCL-20090");
  assert.equal(whosNdl.evidence?.observedDate, "2010-05");
  assert.equal(whosNdl.evidence?.carrier, "BLU_SPEC_CD");
  assert.equal(whosNdl.evidence?.provenance.fixedRecordId,
    "R100000002-I000010906601");

  const sony = parseSeikoMatsudaWhosSonyBoxEvidence(sonyBoxFixture());
  assert.equal(sony.status, "VERIFIED");
  assert.equal(sony.verified, true);
  assert.equal(sony.unique, true);
  assert.equal(sony.evidence?.evidenceKey, "WHOS_SONY_BOX");
  if (sony.evidence?.evidenceKey !== "WHOS_SONY_BOX") assert.fail("expected Sony evidence");
  assert.equal(sony.evidence.observedWorkTitle, "WHO’S THAT BOY");
  assert.equal(sony.evidence.observedArtistCredit, "SEIKO");
  assert.equal(sony.evidence.observedBoxReleaseDate, "2010-05-26");
  assert.deepEqual(sony.evidence.observedCatalogRange, {
    start: "SRCL-20061",
    end: "SRCL-20133",
  });
  assert.equal(sony.evidence.completeSinglesCount, 73);
  assert.equal(sony.evidence.cdDiscCount, 73);
  assert.equal(sony.evidence.carrier, "BLU_SPEC_CD");
  assert.deepEqual(sony.evidence.overseasSingles, [
    "ALL WAY TO THE HEAVEN",
    "WHO’S THAT BOY",
    "LET’S TALK ABOUT IT",
    "GOOD FOR YOU",
    "all to you",
    "just for tonight",
  ]);
  assert.equal(sony.evidence.provenance.sourceUrl,
    SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX);
});

test("fixed external parsers fail closed on provenance and identity mutations", () => {
  const cases: Array<{
    parse: (html: string) => unknown;
    html: string;
    code: SeikoMatsudaOfficialFailureCode;
  }> = [
    {
      parse: parseSeikoMatsudaDancingNdlEvidence,
      html: dancingNdlFixture({ title: "Dancing shoes" }),
      code: "external-provenance-invalid",
    },
    {
      parse: parseSeikoMatsudaDancingNdlEvidence,
      html: dancingNdlFixture({ artist: "松田聖子" }),
      code: "external-artist-mismatch",
    },
    {
      parse: parseSeikoMatsudaDancingNdlEvidence,
      html: dancingNdlFixture({ date: "1985.6" }),
      code: "external-date-mismatch",
    },
    {
      parse: parseSeikoMatsudaDancingNdlEvidence,
      html: dancingNdlFixture({ catalog: "12AH-1897" }),
      code: "external-catalog-mismatch",
    },
    {
      parse: parseSeikoMatsudaDancingNdlEvidence,
      html: dancingNdlFixture({ bibId: "000008815160" }),
      code: "external-record-id-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosNdlEvidence,
      html: whosNdlFixture({ artist: "Various Artists" }),
      code: "external-artist-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosNdlEvidence,
      html: whosNdlFixture({ date: "2010.6" }),
      code: "external-date-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosNdlEvidence,
      html: whosNdlFixture({ catalog: "SRCL-20091" }),
      code: "external-catalog-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosNdlEvidence,
      html: whosNdlFixture({ editionNote: "CD" }),
      code: "external-claim-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosSonyBoxEvidence,
      html: sonyBoxFixture().replace("WHO’S THAT BOY", "WHO IS THAT BOY"),
      code: "external-title-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosSonyBoxEvidence,
      html: sonyBoxFixture().replace("品　番:SRCL20061-133", "品　番:SRCL20062-133"),
      code: "external-catalog-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosSonyBoxEvidence,
      html: sonyBoxFixture().replace("発売日:2010年5月26日", "発売日:2010年5月27日"),
      code: "external-date-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosSonyBoxEvidence,
      html: sonyBoxFixture().replace("Blu-spec CD", "ordinary CD"),
      code: "external-claim-mismatch",
    },
    {
      parse: parseSeikoMatsudaWhosSonyBoxEvidence,
      html: sonyBoxFixture().replace(
        SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX,
        "https://example.com/escape",
      ),
      code: "external-provenance-invalid",
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => item.parse(item.html),
      (error) => error instanceof SeikoMatsudaOfficialSourceFailure &&
        error.code === item.code,
    );
  }
});

test("fails exact title, date, category, catalog, track, cover, and artist integrity checks", () => {
  const cases: Array<{
    label: string;
    workKey: SeikoMatsudaOfficialWorkKey;
    html: string;
    code: SeikoMatsudaOfficialFailureCode;
  }> = [
    {
      label: "version marker removed",
      workKey: "SINGLE:22",
      html: fixturePage("SINGLE:22", { title: "DANCING SHOES" }),
      code: "title-mismatch",
    },
    {
      label: "double title truncated",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { title: "特別な恋人" }),
      code: "title-mismatch",
    },
    {
      label: "same-year wrong day",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { date: "2011年11月24日" }),
      code: "date-mismatch",
    },
    {
      label: "partial date",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { date: "2011年11月" }),
      code: "date-mismatch",
    },
    {
      label: "wrong category",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", {
        categoryLabel: "アルバム",
        categoryPath: "/discography/album",
      }),
      code: "category-mismatch",
    },
    {
      label: "wrong catalog",
      workKey: "SINGLE:29",
      html: fixturePage("SINGLE:29", { catalog: "SRCL-20090" }),
      code: "catalog-mismatch",
    },
    {
      label: "area62 catalog boundary truncated",
      workKey: "ORIGINAL_ALBUM:35",
      html: fixturePage("ORIGINAL_ALBUM:35", { catalog: "VIVI-19623" }),
      code: "catalog-mismatch",
    },
    {
      label: "B-side removed",
      workKey: "SINGLE:29",
      html: fixturePage("SINGLE:29", { tracks: [["Who's that boy", "4:42"]] }),
      code: "track-boundary-mismatch",
    },
    {
      label: "double-title track reordered",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", {
        tracks: [
          ["声だけ聞かせて", "4:23"],
          ["特別な恋人", "4:56"],
          ["特別な恋人 (Instrumental)", "4:55"],
          ["声だけ聞かせて (Instrumental)", "4:22"],
        ],
      }),
      code: "track-boundary-mismatch",
    },
    {
      label: "cross-origin cover",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", {
        coverPath: "https://example.com/discography/images/upload/2011-4_Artwork20111123-112-0001.jpg",
      }),
      code: "cover-url-invalid",
    },
    {
      label: "cover points to another official work",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", {
        coverPath: fixtures["SINGLE:29"].coverPath,
      }),
      code: "cover-url-invalid",
    },
    {
      label: "cover alt truncated",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { coverAlt: "特別な恋人" }),
      code: "cover-title-mismatch",
    },
    {
      label: "artist shell changed",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { artistLogoAlt: "SEIKO" }),
      code: "artist-identity-mismatch",
    },
    {
      label: "duplicate entity title",
      workKey: "SINGLE:71",
      html: fixturePage("SINGLE:71", { duplicateTitle: true }),
      code: "title-mismatch",
    },
  ];
  for (const item of cases) {
    assertParserFailure(item.workKey, item.html, item.code);
  }
});

test("rejects empty, oversized, and unknown fixed-page inputs", () => {
  assertParserFailure("SINGLE:22", "", "invalid-html");
  assertParserFailure("SINGLE:22", "x".repeat(512 * 1024 + 1), "response-too-large");
  assert.throws(
    () => seikoMatsudaOfficialDetailUrl("SINGLE:999" as SeikoMatsudaOfficialWorkKey),
    (error) => error instanceof SeikoMatsudaOfficialSourceFailure &&
      error.code === "invalid-source-url",
  );
});

test("client fetches only five fixed HTTPS pages with server-safe no-store requests", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const pages = new Map(
    (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
      [SeikoMatsudaOfficialWorkKey, string]
    >).map(([workKey, url]) => [url, fixturePage(workKey)]),
  );
  const client = new SeikoMatsudaOfficialEntityClient({
    resolveHost: publicResolver,
    retryCount: 0,
    concurrency: 3,
    includeExternalEvidence: false,
    fetchImpl: async (input, init) => {
      const url = input.toString();
      calls.push({ url, init });
      const html = pages.get(url);
      assert.ok(html, `unexpected URL: ${url}`);
      return htmlResponse(html);
    },
  });
  const result = await client.load();
  assert.equal(result.status, "FIXED_SET_COMPLETE");
  assert.equal(result.complete, true);
  assert.equal(result.works.length, 5);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.externalEvidence.status, "NOT_REQUESTED");
  assert.equal(result.externalEvidence.requested, false);
  assert.equal(result.sourceResults.every((item) => item.status === "COMPLETE"), true);
  assert.deepEqual(result.stats, {
    requestsAttempted: 5,
    responsesFetched: 5,
    retries: 0,
    pagesParsed: 5,
    coverUrlsParsed: 5,
  });
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    Object.values(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS).sort(),
  );
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.credentials, "omit");
    assert.equal(call.init?.redirect, "manual");
    assert.equal(call.init?.referrerPolicy, "no-referrer");
    assert.ok(call.init?.signal instanceof AbortSignal);
  }
  assert.equal(result.byManifestEntryKey["SINGLE:71"]?.observedTitle,
    "特別な恋人/声だけ聞かせて");

  const second = await client.load();
  assert.equal(second.complete, true);
  assert.equal(calls.length, 10, "each load must perform a fresh fixed-page fetch");
});

test("client independently fetches all three fixed external sources and keeps their provenance", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const pages = new Map<string, string>([
    ...(Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
      [SeikoMatsudaOfficialWorkKey, string]
    >).map(([workKey, url]): [string, string] => [url, fixturePage(workKey)]),
    [SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL, dancingNdlFixture()],
    [SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL, whosNdlFixture()],
    [SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX, sonyBoxFixture()],
  ]);
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: publicResolver,
    retryCount: 0,
    concurrency: 3,
    fetchImpl: async (input, init) => {
      const url = input.toString();
      calls.push({ url, init });
      const html = pages.get(url);
      assert.ok(html, `unexpected URL: ${url}`);
      return htmlResponse(html);
    },
  }).load();
  assert.equal(result.complete, true);
  assert.equal(result.works.length, 5);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.externalEvidence.status, "SOURCE_SET_COMPLETE");
  assert.equal(result.externalEvidence.requested, true);
  assert.equal(result.externalEvidence.verifiedCount, 2);
  assert.equal(result.externalEvidence.uniqueCount, 3);
  assert.deepEqual(result.externalEvidence.warnings, []);
  assert.deepEqual(result.externalEvidence.stats, {
    requestsAttempted: 3,
    responsesFetched: 3,
    retries: 0,
    sourcesParsed: 3,
  });
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.status, "PARTIAL");
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.verified, false);
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.unique, true);
  assert.equal(result.externalEvidence.sources.WHOS_NDL?.status, "VERIFIED");
  assert.equal(result.externalEvidence.sources.WHOS_SONY_BOX?.status, "VERIFIED");
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    [
      ...Object.values(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS),
      ...Object.values(SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS),
    ].sort(),
  );
  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.credentials, "omit");
    assert.equal(call.init?.redirect, "manual");
  }
});

test("one optional external failure does not fail the five official entities or other sources", async () => {
  const target = SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL;
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: publicResolver,
    retryCount: 0,
    fetchImpl: async (input) => {
      const url = input.toString();
      if (url === target) {
        return new Response("temporary", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }
      const official = (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
        [SeikoMatsudaOfficialWorkKey, string]
      >).find(([, value]) => value === url);
      if (official) return htmlResponse(fixturePage(official[0]));
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL) {
        return htmlResponse(whosNdlFixture());
      }
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX) {
        return htmlResponse(sonyBoxFixture());
      }
      assert.fail(`unexpected URL: ${url}`);
    },
  }).load();
  assert.equal(result.status, "FIXED_SET_COMPLETE");
  assert.equal(result.complete, true);
  assert.equal(result.works.length, 5);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.externalEvidence.status, "SOURCE_INCOMPLETE");
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.status, "FAILED");
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.verified, false);
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.unique, false);
  assert.equal(result.externalEvidence.sources.WHOS_NDL?.status, "VERIFIED");
  assert.equal(result.externalEvidence.sources.WHOS_SONY_BOX?.status, "VERIFIED");
  assert.equal(result.externalEvidence.verifiedCount, 2);
  assert.equal(result.externalEvidence.uniqueCount, 2);
  assert.equal(result.externalEvidence.warnings.length, 1);
  assert.equal(result.externalEvidence.warnings[0]?.url, target);
});

test("external DNS failures are isolated by host and never poison official-page completeness", async () => {
  let fetchCalls = 0;
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: async (hostname) => hostname === "ndlsearch.ndl.go.jp"
      ? ["127.0.0.1"]
      : ["93.184.216.34"],
    retryCount: 0,
    fetchImpl: async (input) => {
      fetchCalls += 1;
      const url = input.toString();
      const official = (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
        [SeikoMatsudaOfficialWorkKey, string]
      >).find(([, value]) => value === url);
      if (official) return htmlResponse(fixturePage(official[0]));
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX) {
        return htmlResponse(sonyBoxFixture());
      }
      assert.fail(`blocked NDL URL must not be fetched: ${url}`);
    },
  }).load();
  assert.equal(result.complete, true);
  assert.equal(result.works.length, 5);
  assert.equal(fetchCalls, 6);
  assert.equal(result.externalEvidence.status, "SOURCE_INCOMPLETE");
  assert.equal(result.externalEvidence.sources.DANCING_NDL?.warning?.code,
    "non-public-address");
  assert.equal(result.externalEvidence.sources.WHOS_NDL?.warning?.code,
    "non-public-address");
  assert.equal(result.externalEvidence.sources.WHOS_SONY_BOX?.status, "VERIFIED");
  assert.equal(result.externalEvidence.verifiedCount, 1);
  assert.equal(result.externalEvidence.uniqueCount, 1);
});

test("external sources still resolve independently when the artist-detail host is unavailable", async () => {
  let fetchCalls = 0;
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: async (hostname) => hostname === "www.seikomatsuda.co.jp"
      ? ["127.0.0.1"]
      : ["93.184.216.34"],
    retryCount: 0,
    fetchImpl: async (input) => {
      fetchCalls += 1;
      const url = input.toString();
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL) {
        return htmlResponse(dancingNdlFixture());
      }
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL) {
        return htmlResponse(whosNdlFixture());
      }
      if (url === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX) {
        return htmlResponse(sonyBoxFixture());
      }
      assert.fail(`official page must not be fetched after private DNS: ${url}`);
    },
  }).load();
  assert.equal(result.complete, false);
  assert.deepEqual(result.works, []);
  assert.equal(result.warnings[0]?.code, "non-public-address");
  assert.equal(fetchCalls, 3);
  assert.equal(result.externalEvidence.status, "SOURCE_SET_COMPLETE");
  assert.equal(result.externalEvidence.verifiedCount, 2);
  assert.equal(result.externalEvidence.uniqueCount, 3);
});

test("one malformed page makes the complete result atomic and exposes no partial works", async () => {
  const badUrl = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:71"];
  const client = new SeikoMatsudaOfficialEntityClient({
    resolveHost: publicResolver,
    retryCount: 0,
    includeExternalEvidence: false,
    fetchImpl: async (input) => {
      const entry = (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
        [SeikoMatsudaOfficialWorkKey, string]
      >).find(([, url]) => url === input.toString());
      assert.ok(entry);
      return htmlResponse(entry[1] === badUrl
        ? fixturePage(entry[0], { title: "特別な恋人" })
        : fixturePage(entry[0]));
    },
  });
  const result = await client.load();
  assert.equal(result.status, "SOURCE_INCOMPLETE");
  assert.equal(result.complete, false);
  assert.deepEqual(result.works, []);
  assert.deepEqual(result.byManifestEntryKey, {});
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, "title-mismatch");
  assert.equal(result.warnings[0]?.workKey, "SINGLE:71");
  assert.equal(result.sourceResults.filter((item) => item.status === "FAILED").length, 1);
  assert.equal(result.stats.pagesParsed, 4);
  assert.equal(result.stats.coverUrlsParsed, 4);
});

test("private DNS fails every fixed page closed before fetch", async () => {
  let fetchCalls = 0;
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: async () => ["127.0.0.1"],
    retryCount: 0,
    includeExternalEvidence: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      return htmlResponse("");
    },
  }).load();
  assert.equal(result.complete, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.works, []);
  assert.equal(result.warnings[0]?.code, "non-public-address");
  assert.equal(result.sourceResults.length, 5);
  assert.equal(result.sourceResults.every((item) =>
    item.status === "FAILED" && item.failureCode === "non-public-address"), true);
  assert.equal(result.stats.requestsAttempted, 0);
});

test("redirects and non-HTML responses fail closed without following them", async (t) => {
  const target = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:22"];
  const cases: Array<{
    name: string;
    response: () => Response;
    code: SeikoMatsudaOfficialFailureCode;
  }> = [
    {
      name: "redirect",
      response: () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com/escape" },
      }),
      code: "invalid-source-url",
    },
    {
      name: "json content type",
      response: () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      code: "unsupported-content-type",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const result = await new SeikoMatsudaOfficialEntityClient({
        resolveHost: publicResolver,
        retryCount: 0,
        includeExternalEvidence: false,
        fetchImpl: async (input) => {
          const entry = (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
            [SeikoMatsudaOfficialWorkKey, string]
          >).find(([, url]) => url === input.toString());
          assert.ok(entry);
          return entry[1] === target ? item.response() : htmlResponse(fixturePage(entry[0]));
        },
      }).load();
      assert.equal(result.complete, false);
      assert.equal(result.warnings.some((value) => value.code === item.code), true);
      assert.deepEqual(result.works, []);
    });
  }
});

test("retries one retryable fixed-page HTTP failure without relaxing validation", async () => {
  const attempts = new Map<string, number>();
  const target = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:22"];
  const sleeps: number[] = [];
  const result = await new SeikoMatsudaOfficialEntityClient({
    resolveHost: publicResolver,
    retryCount: 1,
    includeExternalEvidence: false,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    fetchImpl: async (input) => {
      const url = input.toString();
      attempts.set(url, (attempts.get(url) ?? 0) + 1);
      if (url === target && attempts.get(url) === 1) {
        return new Response("temporary", {
          status: 503,
          headers: {
            "content-type": "text/plain",
            "retry-after": "0",
          },
        });
      }
      const entry = (Object.entries(SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS) as Array<
        [SeikoMatsudaOfficialWorkKey, string]
      >).find(([, value]) => value === url);
      assert.ok(entry);
      return htmlResponse(fixturePage(entry[0]));
    },
  }).load();
  assert.equal(result.complete, true);
  assert.equal(attempts.get(target), 2);
  assert.equal([...attempts.values()].reduce((sum, value) => sum + value, 0), 6);
  assert.deepEqual(sleeps, [0]);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.requestsAttempted, 6);
  assert.equal(result.stats.responsesFetched, 5);
});
