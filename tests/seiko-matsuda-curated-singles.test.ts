import assert from "node:assert/strict";
import test from "node:test";
import manifestJson from "@/data/authoritative-discography-manifests.json";
import {
  curatedWorkScopeDecision,
  curatedWorkTitleKeys,
  findCuratedArtistDiscography,
} from "@/lib/official-music/curated-discography";

const completeBoxUrl =
  "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828";

const expectedTimeline = [
  ["裸足の季節", "1980-04-01"],
  ["青い珊瑚礁", "1980-07-01"],
  ["風は秋色", "1980-10-01"],
  ["チェリーブラッサム", "1981-01-21"],
  ["夏の扉", "1981-04-21"],
  ["白いパラソル", "1981-07-21"],
  ["風立ちぬ", "1981-10-07"],
  ["赤いスイートピー", "1982-01-21"],
  ["渚のバルコニー", "1982-04-21"],
  ["小麦色のマーメイド", "1982-07-21"],
  ["野ばらのエチュード", "1982-10-21"],
  ["秘密の花園", "1983-02-03"],
  ["天国のキッス", "1983-04-27"],
  ["ガラスの林檎 / SWEET MEMORIES", "1983-08-01"],
  ["瞳はダイアモンド", "1983-10-28"],
  ["Rock'n Rouge", "1984-02-01"],
  ["時間の国のアリス", "1984-05-10"],
  ["ピンクのモーツァルト", "1984-08-01"],
  ["ハートのイアリング", "1984-11-01"],
  ["天使のウィンク", "1985-01-30"],
  ["ボーイの季節", "1985-05-09"],
  ["DANCING SHOES (Club Mix)", "1985-06-24"],
  ["Strawberry Time", "1987-04-22"],
  ["Pearl-White Eve", "1987-11-06"],
  ["Marrakech ～マラケッシュ～", "1988-04-14"],
  ["旅立ちはフリージア", "1988-09-07"],
  ["Precious Heart", "1989-11-15"],
  ["THE RIGHT COMBINATION", "1990-07-15"],
  ["Who's that boy", "1990-10-01"],
  ["We Are Love", "1990-11-21"],
  ["きっと、また逢える・・・", "1992-02-05"],
  ["あなたのすべてになりたい", "1992-08-01"],
  ["大切なあなた", "1993-04-21"],
  ["A Touch of Destiny", "1993-05-21"],
  ["かこわれて、愛jing", "1993-11-10"],
  ["もう一度、初めから", "1994-05-11"],
  ["輝いた季節へ旅立とう", "1994-12-01"],
  ["素敵にOnce Again", "1995-04-21"],
  ["あなたに逢いたくて ～Missing You～", "1996-04-22"],
  ["Let's Talk About It", "1996-04-24"],
  ["I'll Be There For You", "1996-05-17"],
  ["さよならの瞬間", "1996-11-25"],
  ["私だけの天使 ～Angel～", "1997-04-23"],
  ["Gone with the rain", "1997-12-03"],
  ["恋する想い ～Fall in love～", "1998-06-17"],
  ["Touch the Love", "1998-11-26"],
  ["哀しみのボート", "1999-10-27"],
  ["20th Party", "2000-05-17"],
  ["上海ラヴソング", "2000-06-07"],
  ["Unseasonable Shore", "2000-06-14"],
  ["True Love Story", "2000-09-27"],
  ["The Sound of Fire", "2000-11-29"],
  ["あなたしか見えない", "2001-06-20"],
  ["愛愛 ～100%Pure Love～", "2001-11-14"],
  ["素敵な明日", "2002-06-05"],
  ["Call me", "2003-06-04"],
  ["逢いたい", "2004-05-26"],
  ["Smile on me", "2004-07-07"],
  ["永遠さえ感じた夜", "2005-02-02"],
  ["I'll fall in love", "2005-08-24"],
  ["しあわせな気持ち", "2005-09-21"],
  ["bless you", "2006-04-26"],
  ["WE ARE.", "2006-05-24"],
  ["涙がただこぼれるだけ", "2007-05-23"],
  ["真夏の夜の夢", "2007-08-01"],
  ["クリスマスの夜", "2007-11-21"],
  ["花びら舞う季節に", "2008-03-19"],
  ["Love is all", "2008-06-25"],
  ["あの輝いた季節", "2008-10-22"],
  ["いくつの夜明けを数えたら", "2010-05-05"],
  ["特別な恋人/声だけ聞かせて", "2011-11-23"],
  ["涙のしずく", "2012-05-02"],
  ["LuLu!!", "2013-05-22"],
  ["夢がさめて", "2013-10-30"],
  ["I Love You !! 〜あなたの微笑みに〜", "2014-05-21"],
  ["永遠のもっと果てまで/惑星になりたい", "2015-10-28"],
  ["薔薇のように咲いて 桜のように散って", "2016-09-21"],
] as const;

type RawManifest = {
  artists: Array<{
    slug: string;
    baselines: Array<{
      category: string;
      expected: number;
      officialCatalogTotal?: number;
      sources: Array<{ url: string }>;
      expectedWorks?: Array<{
        title: string;
        artistCredits?: string[];
        originalReleaseDate?: string;
        mediaScope?: { physicalCd?: string };
      }>;
    }>;
  }>;
};

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

test("Seiko's official 96 product rows resolve to the exact ordered 77-work timeline", () => {
  const rawArtist = (manifestJson as RawManifest).artists.find((artist) =>
    artist.slug === "seiko-matsuda");
  const baseline = rawArtist?.baselines.find((item) => item.category === "SINGLE");
  assert.ok(baseline?.expectedWorks);
  assert.equal(baseline.expected, 77);
  assert.equal(baseline.officialCatalogTotal, 77);
  assert.deepEqual(
    baseline.expectedWorks.map((work) => [work.title, work.originalReleaseDate]),
    expectedTimeline,
  );
  assert.equal(new Set(baseline.expectedWorks.map((work) =>
    normalized(work.title))).size, 77);
  assert.equal(baseline.expectedWorks.some((work) =>
    /初回|通常盤|カセットテープ/u.test(work.title)), false);
  assert.deepEqual(new Set(baseline.sources.map((source) => source.url)), new Set([
    "https://www.seikomatsuda.co.jp/discography/single",
    "https://www.sonymusic.co.jp/artist/SeikoMatsuda/discography/buy/SRCL-3661",
    completeBoxUrl,
    "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/490615",
  ]));
});

test("all 77 official works have explicit and source-bounded ORIGINAL_CD scope", () => {
  const artist = findCuratedArtistDiscography(null, ["松田聖子"]);
  const singles = artist?.works.filter((work) => work.category === "SINGLE") ?? [];
  assert.equal(singles.length, 77);
  assert.equal(singles.every((work) => work.mediaScope !== null), true);

  const later = singles.filter((work) =>
    work.mediaScope?.physicalCd === "LATER_OFFICIAL_EDITION");
  const original = singles.filter((work) =>
    work.mediaScope?.physicalCd === "ORIGINAL_RELEASE");
  assert.equal(later.length, 27);
  assert.equal(original.length, 50);
  assert.equal(singles.some((work) =>
    work.mediaScope?.physicalCd === "NONE" ||
    work.mediaScope?.physicalCd === "UNKNOWN"), false);

  const expectedLaterTitles = new Set([
    ...expectedTimeline.slice(0, 26).map(([title]) => title),
    "Who's that boy",
  ]);
  assert.deepEqual(new Set(later.map((work) => work.title)), expectedLaterTitles);
  for (const work of later) {
    assert.deepEqual(work.mediaScope?.physicalCdAuthorityUrls, [completeBoxUrl]);
    assert.equal(work.mediaScope?.physicalCdReleaseDate, "2010-05-26");
    assert.equal(work.mediaScope?.physicalCdCatalogNumber, "SRCL-20061 ～ SRCL-20133");
    assert.equal(curatedWorkScopeDecision(work, "ORIGINAL_CD").reasonCode,
      "CURATED_LATER_OFFICIAL_CD_CONFIRMED");
  }
  assert.deepEqual(
    singles.find((work) => work.title === "Who's that boy")?.mediaScope?.originalFormats,
    ["CASSETTE"],
  );

  for (const work of original) {
    assert.deepEqual(work.mediaScope?.originalFormats, ["CD"]);
    assert.equal(work.mediaScope?.physicalCdReleaseDate, work.originalReleaseDate);
    assert.equal(curatedWorkScopeDecision(work, "ORIGINAL_CD").reasonCode,
      "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED");
  }
});

test("double-A, collaboration, and version identities stay complete and never become substring aliases", () => {
  const artist = findCuratedArtistDiscography(null, ["Seiko Matsuda"]);
  const singles = artist?.works.filter((work) => work.category === "SINGLE") ?? [];
  const titles = new Set(singles.map((work) => work.title));
  for (const title of [
    "ガラスの林檎 / SWEET MEMORIES",
    "時間の国のアリス",
    "特別な恋人/声だけ聞かせて",
    "永遠のもっと果てまで/惑星になりたい",
    "THE RIGHT COMBINATION",
    "Let's Talk About It",
    "I'll Be There For You",
    "True Love Story",
    "WE ARE.",
    "夢がさめて",
    "DANCING SHOES (Club Mix)",
  ]) assert.equal(titles.has(title), true, title);

  for (const work of singles) {
    const titleKey = normalized(work.title);
    for (const alias of work.aliases) {
      const aliasKey = normalized(alias);
      assert.equal(titleKey.includes(aliasKey), false,
        `${work.title} has a substring alias: ${alias}`);
    }
  }
  const dancing = singles.find((work) => work.title === "DANCING SHOES (Club Mix)");
  assert.ok(dancing);
  assert.deepEqual(dancing.aliases, ["DANCING SHOES 12\""]);
  assert.equal(curatedWorkTitleKeys(dancing).has(normalized("DANCING SHOES")), false);
  assert.deepEqual(
    singles.find((work) => work.title === "時間の国のアリス")?.aliases,
    ["時間の国のアリス / 夏服のイヴ"],
  );
  assert.equal(curatedWorkTitleKeys(
    singles.find((work) => work.title === "時間の国のアリス")!,
  ).has(normalized("時間の国のアリス / 夏服のイヴ")), true);
  assert.deepEqual(
    singles.find((work) => work.title === "True Love Story")?.aliases,
    ["True Love Story / さよならのKISSを忘れない"],
  );
  assert.equal(curatedWorkTitleKeys(
    singles.find((work) => work.title === "True Love Story")!,
  ).has(normalized("True Love Story / さよならのKISSを忘れない")), true);
  assert.deepEqual(
    singles.find((work) => work.title === "WE ARE.")?.aliases,
    ["WE ARE. / PawPaw"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "DANCING SHOES (Club Mix)")?.artistCredits,
    ["SEIKO"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "Who's that boy")?.artistCredits,
    ["SEIKO"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "WE ARE.")?.artistCredits,
    ["PawPaw"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "THE RIGHT COMBINATION")?.artistCredits,
    ["Seiko and Donnie Wahlberg", "Seiko & Donnie Wahlberg"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "かこわれて、愛jing")?.artistCredits,
    ["MATSUYAKKO"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "Let's Talk About It")?.artistCredits,
    ["Seiko"],
  );
  assert.deepEqual(
    singles.find((work) => work.title === "Smile on me")?.artistCredits,
    ["SEIKO & Crazy.T"],
  );
  assert.equal(artist?.aliases.includes("SEIKO"), false);
  assert.equal(artist?.aliases.includes("PawPaw"), false);
  for (const [title, forbiddenPartial] of [
    ["Who's that boy", "Who's"],
    ["特別な恋人/声だけ聞かせて", "特別な恋人"],
  ] as const) {
    const work = singles.find((item) => item.title === title);
    assert.ok(work);
    assert.equal(curatedWorkTitleKeys(work).has(normalized(forbiddenPartial)), false);
  }
});
