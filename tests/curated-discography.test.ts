import assert from "node:assert/strict";
import test from "node:test";
import {
  curatedHistoricalCanonDecision,
  curatedPhysicalCdDateEvidenceKind,
  curatedPhysicalCdDateRelation,
  curatedWorkScopeDecision,
  curatedDiscographyManifestCount,
  curatedWorkTitleKeys,
  findCuratedArtistDiscography,
  parseCuratedWorkMediaScope,
  type CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import {
  isCompleteOriginalReleaseDateAfterAsOf,
} from "@/lib/official-music/curated-canon-policy";

test("loads only source-backed expected-work manifests with exact artist identity", () => {
  assert.ok(curatedDiscographyManifestCount >= 2);
  const miho = findCuratedArtistDiscography(
    "30d83c58-baeb-4474-b6c5-6704d00c4c20",
    ["wrong display name"],
  );
  const momoe = findCuratedArtistDiscography(null, ["山口百恵"]);
  const akina = findCuratedArtistDiscography(null, ["中森明菜"]);
  const seiko = findCuratedArtistDiscography(null, ["松田聖子"]);
  assert.equal(miho?.slug, "miho-nakayama");
  assert.equal(miho?.works.filter((work) => work.category === "SINGLE").length, 39);
  const namaiki = miho?.works.find((work) => work.title === "生意気");
  assert.deepEqual(
    {
      representationKind: namaiki?.mediaScope?.physicalCdRepresentationKind,
      containerTitle: namaiki?.mediaScope?.physicalCdContainerTitle,
      date: namaiki?.mediaScope?.physicalCdReleaseDate,
      catalogNumber: namaiki?.mediaScope?.physicalCdCatalogNumber,
    },
    {
      representationKind: "CONTAINER_INCLUSION",
      containerTitle: "All Time Best",
      date: "2020-12-23",
      catalogNumber: "KICS-93968～70",
    },
  );
  for (const title of [
    "BE-BOP-HIGHSCHOOL",
    "ツイてるねノッてるね",
    "VIRGIN EYES",
  ]) {
    const scopedWork: CuratedDiscographyWork | undefined = miho?.works.find((candidate) =>
      candidate.category === "SINGLE" && candidate.title === title);
    assert.deepEqual({
      physicalCd: scopedWork?.mediaScope?.physicalCd,
      representationKind: scopedWork?.mediaScope?.physicalCdRepresentationKind,
      containerTitle: scopedWork?.mediaScope?.physicalCdContainerTitle,
      date: scopedWork?.mediaScope?.physicalCdReleaseDate,
      catalogNumber: scopedWork?.mediaScope?.physicalCdCatalogNumber,
      authorityUrls: scopedWork?.mediaScope?.physicalCdAuthorityUrls,
    }, {
      physicalCd: "LATER_OFFICIAL_EDITION",
      representationKind: "CONTAINER_INCLUSION",
      containerTitle: "All Time Best",
      date: "2020-12-23",
      catalogNumber: "KICS-93968～70",
      authorityUrls: ["https://www.kingrecords.co.jp/cs/g/gKICS-93968/"],
    }, title);
  }
  const mellow = miho?.works.find((work) =>
    work.category === "ORIGINAL_ALBUM" && work.title === "Mellow");
  assert.deepEqual({
    originalFormats: mellow?.mediaScope?.originalFormats,
    physicalCd: mellow?.mediaScope?.physicalCd,
    representationKind: mellow?.mediaScope?.physicalCdRepresentationKind,
    date: mellow?.mediaScope?.physicalCdReleaseDate,
    catalogNumber: mellow?.mediaScope?.physicalCdCatalogNumber,
    authorityUrls: mellow?.mediaScope?.physicalCdAuthorityUrls,
  }, {
    originalFormats: ["CD"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    representationKind: "SAME_WORK_EDITION",
    date: "2015-10-14",
    catalogNumber: "KICS-3274",
    authorityUrls: ["https://www.kingrecords.co.jp/cs/g/gKICS-3274/"],
  });
  assert.equal(miho?.baselines?.find((baseline) =>
    baseline.category === "ORIGINAL_ALBUM")?.authorityUrls.includes(
      "https://www.kingrecords.co.jp/cs/g/gKICS-3274/",
    ), true);
  assert.equal(momoe?.works.filter((work) => work.category === "SINGLE").length, 32);
  assert.equal(momoe?.works.filter((work) => work.category === "ORIGINAL_ALBUM").length, 22);
  const momoeSingles = momoe?.works.filter((work) => work.category === "SINGLE") ?? [];
  assert.equal(momoeSingles.length, 32);
  assert.equal(momoeSingles.every((work) =>
    work.mediaScope?.originalFormats.length === 1 &&
    work.mediaScope.originalFormats[0] === "VINYL" &&
    work.mediaScope.physicalCd === "LATER_OFFICIAL_EDITION" &&
    work.mediaScope.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
    work.mediaScope.physicalCdContainerTitle === "ゴールデン☆アイドル 山口百恵" &&
    work.mediaScope.physicalCdReleaseDate === "2015-02-11" &&
    work.mediaScope.physicalCdCatalogNumber === "MHCL-30295～30298" &&
    work.mediaScope.physicalCdAuthorityUrls.length === 1 &&
    work.mediaScope.physicalCdAuthorityUrls[0] ===
      "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-30295"), true);
  const momoeCosmos = momoe?.works.find((work) =>
    work.category === "ORIGINAL_ALBUM" && work.title === "COSMOS（宇宙）");
  assert.deepEqual({
    physicalCd: momoeCosmos?.mediaScope?.physicalCd,
    date: momoeCosmos?.mediaScope?.physicalCdReleaseDate,
    catalogNumber: momoeCosmos?.mediaScope?.physicalCdCatalogNumber,
    authorityUrls: momoeCosmos?.mediaScope?.physicalCdAuthorityUrls,
  }, {
    physicalCd: "LATER_OFFICIAL_EDITION",
    date: "1993-06-21",
    catalogNumber: "SRCL-2622",
    authorityUrls: [
      "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/SRCL-2622",
    ],
  });
  assert.equal(akina?.works.filter((work) => work.category === "SINGLE").length, 55);
  assert.equal(akina?.works.filter((work) => work.category === "ORIGINAL_ALBUM").length, 25);
  assert.equal(akina?.works.every((work) => work.mediaScope !== null), true);
  assert.equal(akina?.works.filter((work) =>
    work.category === "SINGLE" &&
    curatedWorkScopeDecision(work, "ORIGINAL_CD").verdict === "PASS").length, 54);
  assert.equal(seiko?.works.filter((work) => work.category === "ORIGINAL_ALBUM").length, 54);
  assert.equal(seiko?.works.every((work) => work.mediaScope !== null), true);
  const seikoBoxWorks = seiko?.works.filter((work) =>
    work.category === "SINGLE" &&
    work.mediaScope?.physicalCdCatalogNumber === "SRCL-20061 ～ SRCL-20133") ?? [];
  assert.equal(seikoBoxWorks.length, 27);
  assert.equal(seikoBoxWorks.every((work) =>
    work.mediaScope?.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
    work.mediaScope.physicalCdContainerTitle ===
      "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～"), true);
  const seikoAlbum = (title: string) => seiko?.works.find((work) =>
    work.category === "ORIGINAL_ALBUM" && work.title === title);
  assert.deepEqual([
    seikoAlbum("Citron")?.mediaScope?.physicalCdCatalogNumber,
    seikoAlbum("Precious Moment")?.mediaScope?.physicalCdCatalogNumber,
    seikoAlbum("I'll fall in love 愛的禮物")?.mediaScope?.physicalCdCatalogNumber,
    seikoAlbum("I'll fall in love 愛的禮物")?.mediaScope?.physicalCdCountry,
  ], ["32DH-5040", "CSCL-1039", "SMD8859", "TW"]);
  assert.equal(
    findCuratedArtistDiscography("00000000-0000-4000-8000-000000000000", ["Miho Nakayama"]),
    null,
  );
  assert.equal(findCuratedArtistDiscography(null, ["山口"]), null);
  assert.equal(findCuratedArtistDiscography(null, ["Miho"]), null);
});

test("complete curated baselines close historical canon without closing an active future", () => {
  const akina = findCuratedArtistDiscography(null, ["中森明菜"]);
  const miho = findCuratedArtistDiscography(null, ["中山美穂"]);
  const seiko = findCuratedArtistDiscography(null, ["松田聖子"]);
  assert.ok(akina && miho && seiko);
  const albumBaseline = akina.baselines?.find((baseline) =>
    baseline.category === "ORIGINAL_ALBUM");
  const singleBaseline = akina.baselines?.find((baseline) =>
    baseline.category === "SINGLE");
  assert.ok(albumBaseline && singleBaseline);
  assert.equal(akina.catalogStatus, "active");
  assert.equal(albumBaseline.kind, "minimum");
  assert.equal(albumBaseline.completeWorkEnumeration, true);
  assert.equal(albumBaseline.officialCatalogTotal, 25);
  assert.equal(albumBaseline.finalSnapshotKind, "exact");
  assert.equal(albumBaseline.snapshotVerifiedAt, "2026-07-13");

  for (const title of [
    "歌姫",
    "艶華 -Enka-",
    "フォーク・ソング〜歌姫 抒情歌〜",
    "ムード歌謡〜歌姫昭和名曲集〜",
  ]) {
    const decision = curatedHistoricalCanonDecision(akina, {
      title,
      category: "ORIGINAL_ALBUM",
      originalReleaseDate: title === "歌姫" ? "1994-03-04" : "2009-06-24",
    });
    assert.equal(decision.outcome, "OUT_OF_SCOPE", title);
    assert.equal(decision.reasonCode, "CURATED_HISTORICAL_NON_CANONICAL_WORK", title);
    assert.equal(decision.baseline?.asOf, albumBaseline.asOf, title);
  }

  const newestCanonical = curatedHistoricalCanonDecision(akina, {
    title: "ごめんと、すきと、",
    category: "SINGLE",
    originalReleaseDate: "2026-07-01",
  });
  assert.equal(newestCanonical.outcome, "CANONICAL_MEMBER");
  assert.equal(newestCanonical.work?.ordinal, 55);
  assert.equal(singleBaseline.asOf, newestCanonical.work?.originalReleaseDate);

  const dayAfterCutoff = new Date(`${albumBaseline.snapshotVerifiedAt}T00:00:00.000Z`);
  dayAfterCutoff.setUTCDate(dayAfterCutoff.getUTCDate() + 1);
  const postCutoffDate = dayAfterCutoff.toISOString().slice(0, 10);
  assert.equal(curatedHistoricalCanonDecision(akina, {
    title: "Future original album",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: postCutoffDate,
  }).outcome, "POST_CUTOFF_NEW_WORK");
  for (const date of [
    null,
    albumBaseline.asOf.slice(0, 4),
    albumBaseline.asOf.slice(0, 7),
    albumBaseline.asOf,
  ]) {
    assert.equal(curatedHistoricalCanonDecision(akina, {
      title: "Undated unlisted album",
      category: "ORIGINAL_ALBUM",
      originalReleaseDate: date,
    }).outcome, "OUT_OF_SCOPE", String(date));
  }
  const latestCanonicalAlbum = akina.works.find((work) =>
    work.category === "ORIGINAL_ALBUM" && work.title === "明菜");
  assert.ok(latestCanonicalAlbum?.originalReleaseDate);
  assert.equal(curatedHistoricalCanonDecision(akina, {
    title: latestCanonicalAlbum.title,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: latestCanonicalAlbum.originalReleaseDate.slice(0, 4),
  }).outcome, "OUT_OF_SCOPE", "a canonical title still needs its complete original date");
  const activeTitleDateConflict = curatedHistoricalCanonDecision(akina, {
    title: latestCanonicalAlbum.aliases[0]!,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: postCutoffDate,
  });
  assert.equal(activeTitleDateConflict.outcome, "OUT_OF_SCOPE");
  assert.equal(activeTitleDateConflict.reasonCode, "CURATED_CANONICAL_TITLE_DATE_CONFLICT");
  assert.equal(activeTitleDateConflict.work?.title, latestCanonicalAlbum.title);
  const activePartialDateConflict = curatedHistoricalCanonDecision(akina, {
    title: latestCanonicalAlbum.title,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: latestCanonicalAlbum.originalReleaseDate.slice(0, 4),
  });
  assert.equal(activePartialDateConflict.reasonCode, "CURATED_CANONICAL_TITLE_DATE_CONFLICT");
  assert.equal(isCompleteOriginalReleaseDateAfterAsOf(postCutoffDate, albumBaseline.asOf), true);
  assert.equal(isCompleteOriginalReleaseDateAfterAsOf(albumBaseline.asOf.slice(0, 7), albumBaseline.asOf), false);

  const seikoJazz = curatedHistoricalCanonDecision(seiko, {
    title: "SEIKO JAZZ 3",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: "2024-02-14",
  });
  assert.equal(seikoJazz.outcome, "OUT_OF_SCOPE");
  assert.equal(seikoJazz.reasonCode, "CURATED_HISTORICAL_NON_CANONICAL_WORK");
  assert.equal(seikoJazz.baseline?.snapshotVerifiedAt, "2026-07-13");
  assert.equal(curatedHistoricalCanonDecision(seiko, {
    title: "Future original album after the audited snapshot",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: "2026-07-14",
  }).outcome, "POST_CUTOFF_NEW_WORK");

  const mihoAlbumBaseline = miho.baselines?.find((baseline) =>
    baseline.category === "ORIGINAL_ALBUM");
  assert.ok(mihoAlbumBaseline);
  assert.equal(curatedHistoricalCanonDecision(miho, {
    title: "Impossible future addition to fixed catalog",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: "2099-01-01",
  }).outcome, "OUT_OF_SCOPE");
  const fixedCanonicalAlbum = miho.works.find((work) =>
    work.category === "ORIGINAL_ALBUM" && work.originalReleaseDate && work.aliases.length > 0);
  assert.ok(fixedCanonicalAlbum?.originalReleaseDate && fixedCanonicalAlbum.aliases[0]);
  for (const date of ["2099-01-01", fixedCanonicalAlbum.originalReleaseDate.slice(0, 4)]) {
    const conflict = curatedHistoricalCanonDecision(miho, {
      title: fixedCanonicalAlbum.aliases[0]!,
      category: "ORIGINAL_ALBUM",
      originalReleaseDate: date,
    });
    assert.equal(conflict.outcome, "OUT_OF_SCOPE", date);
    assert.equal(conflict.reasonCode, "CURATED_CANONICAL_TITLE_DATE_CONFLICT", date);
    assert.equal(conflict.work?.title, fixedCanonicalAlbum.title, date);
  }

  assert.equal(curatedHistoricalCanonDecision({ ...akina, baselines: [] }, {
    title: "No complete baseline",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: albumBaseline.asOf,
  }).outcome, "NOT_APPLICABLE");
  assert.equal(curatedHistoricalCanonDecision({
    ...akina,
    baselines: akina.baselines?.map((baseline) => baseline.category === "ORIGINAL_ALBUM"
      ? { ...baseline, officialCatalogTotal: baseline.officialCatalogTotal + 1 }
      : baseline),
  }, {
    title: "Mismatched enumeration",
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: albumBaseline.asOf,
  }).outcome, "NOT_APPLICABLE");
});

test("curated title aliases remain complete normalized identities, never substrings", () => {
  const momoe = findCuratedArtistDiscography(null, ["Momoe Yamaguchi"]);
  const debut = momoe?.works.find((work) =>
    work.category === "SINGLE" && work.ordinal === 1);
  assert.ok(debut);
  const keys = curatedWorkTitleKeys(debut);
  assert.equal(keys.has("としごろ"), true);
  assert.equal(keys.has("とし"), false);
  assert.equal(debut.authorityUrls.every((url) => url.startsWith("https://")), true);

  const akina = findCuratedArtistDiscography(null, ["中森明菜"]);
  const firstNorthWing = akina?.works.find((work) =>
    work.category === "SINGLE" && work.ordinal === 7);
  const sharedDiscNorthWing = akina?.works.find((work) =>
    work.category === "SINGLE" && work.ordinal === 11);
  assert.ok(firstNorthWing);
  assert.ok(sharedDiscNorthWing);
  assert.equal(curatedWorkTitleKeys(firstNorthWing).has("北ウイング"), true);
  assert.equal(curatedWorkTitleKeys(sharedDiscNorthWing).has("北ウイング"), false);
  assert.equal(
    curatedWorkTitleKeys(sharedDiscNorthWing).has("北ウイングリフレイン"),
    true,
  );
});

test("Akina's official numbered singles preserve carrier history without treating compilation tracks as editions", () => {
  const akina = findCuratedArtistDiscography(null, ["Akina Nakamori"]);
  const single = (title: string) => akina?.works.find((work) =>
    work.category === "SINGLE" && work.title === title);
  const nonfiction = single("ノンフィクション エクスタシー");
  const digitalFirst = single("It's brand new day");
  const crazyLove = single("Crazy Love");
  const tattoo = single("TATTOO");
  assert.ok(nonfiction);
  assert.ok(digitalFirst);
  assert.ok(crazyLove);
  assert.ok(tattoo);

  assert.deepEqual(
    {
      originalFormats: nonfiction.mediaScope?.originalFormats,
      physicalCd: nonfiction.mediaScope?.physicalCd,
      cdDate: nonfiction.mediaScope?.physicalCdReleaseDate,
      catalogNumber: nonfiction.mediaScope?.physicalCdCatalogNumber,
      representationKind: nonfiction.mediaScope?.physicalCdRepresentationKind,
      containerTitle: nonfiction.mediaScope?.physicalCdContainerTitle,
    },
    {
      originalFormats: ["CASSETTE"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      cdDate: "2014-06-18",
      catalogNumber: "WPCL-11871/98",
      representationKind: "CONTAINER_INCLUSION",
      containerTitle: "Singles Box 1982-1991",
    },
  );
  const boxSingles = akina?.works.filter((work) =>
    work.category === "SINGLE" && work.ordinal <= 22) ?? [];
  assert.equal(boxSingles.length, 22);
  assert.equal(boxSingles.every((work) =>
    work.mediaScope?.physicalCd === "LATER_OFFICIAL_EDITION" &&
    work.mediaScope.physicalCdReleaseDate === "2014-06-18" &&
    work.mediaScope.physicalCdCatalogNumber === "WPCL-11871/98" &&
    work.mediaScope.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
    work.mediaScope.physicalCdContainerTitle === "Singles Box 1982-1991"), true);
  assert.deepEqual(
    {
      originalFormats: digitalFirst.mediaScope?.originalFormats,
      physicalCd: digitalFirst.mediaScope?.physicalCd,
      cdDate: digitalFirst.mediaScope?.physicalCdReleaseDate,
      catalogNumber: digitalFirst.mediaScope?.physicalCdCatalogNumber,
    },
    {
      originalFormats: ["DIGITAL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      cdDate: "2001-07-10",
      catalogNumber: "NNCC-10001",
    },
  );
  assert.equal(curatedWorkScopeDecision(crazyLove, "ORIGINAL_CD").verdict, "OUT_OF_SCOPE");
  assert.equal(
    curatedWorkScopeDecision(crazyLove, "ORIGINAL_CD").reasonCode,
    "CURATED_DIGITAL_ONLY_OUT_OF_CD_SCOPE",
  );
  assert.deepEqual(tattoo.mediaScope?.originalFormats, ["VINYL", "CD"]);
  assert.equal(tattoo.mediaScope?.physicalCd, "ORIGINAL_RELEASE");
});

test("Akina album carrier tuples are complete and edition-specific", () => {
  const akina = findCuratedArtistDiscography(null, ["中森明菜"]);
  assert.ok(akina);
  const album = (title: string) => {
    const found = akina.works.find((work) =>
      work.category === "ORIGINAL_ALBUM" && work.title === title);
    assert.ok(found);
    return found;
  };
  const warnerReissues = [
    ["プロローグ〈序幕〉", "WPCL-11722"],
    ["バリエーション〈変奏曲〉", "WPCL-11723"],
    ["ファンタジー〈幻想曲〉", "WPCL-11724"],
    ["NEW AKINA エトランゼ", "WPCL-11725"],
    ["ANNIVERSARY", "WPCL-11726"],
    ["POSSIBILITY", "WPCL-11727"],
    ["BITTER AND SWEET", "WPCL-11728"],
    ["D404ME", "WPCL-11729"],
  ] as const;
  for (const [title, catalogNumber] of warnerReissues) {
    assert.deepEqual({
      physicalCd: album(title).mediaScope?.physicalCd,
      date: album(title).mediaScope?.physicalCdReleaseDate,
      catalogNumber: album(title).mediaScope?.physicalCdCatalogNumber,
    }, {
      physicalCd: "LATER_OFFICIAL_EDITION",
      date: "2014-01-29",
      catalogNumber,
    }, title);
  }
  const originalCatalogs = new Map([
    ["la alteración", "MVCD-25"],
    ["SHAKER", "MVCD-38"],
    ["SPOON", "GRCO-3001"],
    ["I hope so", "UMCK-1162"],
    ["DESTINATION", "UMCK-1209"],
    ["DIVA", "UMCK-1331"],
    ["FIXER", "UPCH-2068"],
  ]);
  for (const [title, catalogNumber] of originalCatalogs) {
    assert.equal(album(title).mediaScope?.physicalCdCatalogNumber, catalogNumber, title);
  }
});

test("Akina source spellings stay attached only to the exact manifest work", () => {
  const akina = findCuratedArtistDiscography(null, ["Akina Nakamori"]);
  assert.ok(akina);
  const single = (ordinal: number) => {
    const found = akina.works.find((work) =>
      work.category === "SINGLE" && work.ordinal === ordinal);
    assert.ok(found);
    return found;
  };

  assert.deepEqual(single(12).artistCredits, ["Akina"]);
  assert.deepEqual(single(13).aliases, ["Akaitori Nigeta"]);
  assert.deepEqual(single(16).artistCredits, ["明菜", "Akina"]);
  assert.equal(curatedWorkTitleKeys(single(16)).has("desire"), true);
  assert.equal(curatedWorkTitleKeys(single(23)).has("آلموج"), true);
  assert.deepEqual(single(33).artistCredits, ["Nakamori Akina"]);
  assert.deepEqual(single(35).artistCredits, ["Akina"]);
  assert.deepEqual(single(37).artistCredits, ["Nakamori Akina"]);

  // Per-work source credits must never become global artist aliases.
  assert.equal(findCuratedArtistDiscography(null, ["Akina"]), null);
  assert.equal(findCuratedArtistDiscography(null, ["Nakamori Akina"]), null);

  // Keep independently audited conflict, scope, and source-lag entries intact.
  assert.equal(single(44).originalReleaseDate, "2002-05-02");
  assert.equal(curatedWorkScopeDecision(single(51), "ORIGINAL_CD").verdict, "OUT_OF_SCOPE");
  assert.deepEqual(
    {
      date: single(55).originalReleaseDate,
      catalogNumber: single(55).mediaScope?.physicalCdCatalogNumber,
    },
    { date: "2026-07-01", catalogNumber: "WPCL-13771" },
  );
});

function scopedWork(
  title: string,
  mediaScope: CuratedDiscographyWork["mediaScope"],
): CuratedDiscographyWork {
  return {
    ordinal: 1,
    title,
    aliases: [],
    category: "SINGLE",
    originalReleaseDate: "1986-11-10",
    authorityUrls: ["https://example.com/official-discography"],
    authorityAsOf: "2026-07-12",
    mediaScope,
  };
}

test("work media scope separates official-count membership from physical-CD eligibility", () => {
  const cassette = scopedWork("Example cassette-only single", parseCuratedWorkMediaScope({
    originalFormats: ["CASSETTE"],
    physicalCd: "NONE",
    exclusionReason: "CASSETTE_ONLY",
  }));
  const digital = scopedWork("Crazy Love", parseCuratedWorkMediaScope({
    originalFormats: ["DIGITAL"],
    physicalCd: "NONE",
    exclusionReason: "DIGITAL_ONLY",
  }));
  const laterCd = scopedWork("Example vinyl-era single", parseCuratedWorkMediaScope({
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    physicalCdAuthorityUrls: ["https://example.com/official-cd-edition"],
    physicalCdReleaseDate: "1992-07-22",
    physicalCdCatalogNumber: "KIDS-123",
  }));

  assert.equal(
    curatedWorkScopeDecision(cassette, "ORIGINAL_CD").reasonCode,
    "CURATED_CASSETTE_ONLY_OUT_OF_CD_SCOPE",
  );
  assert.deepEqual(
    {
      verdict: curatedWorkScopeDecision(cassette, "ALL_PHYSICAL").verdict,
      format: curatedWorkScopeDecision(cassette, "ALL_PHYSICAL").representationFormat,
    },
    { verdict: "PASS", format: "Cassette" },
  );
  assert.equal(
    curatedWorkScopeDecision(digital, "ALL_PHYSICAL").reasonCode,
    "CURATED_DIGITAL_ONLY_OUT_OF_PHYSICAL_SCOPE",
  );
  assert.deepEqual(
    {
      verdict: curatedWorkScopeDecision(laterCd, "ORIGINAL_CD").verdict,
      format: curatedWorkScopeDecision(laterCd, "ORIGINAL_CD").representationFormat,
    },
    { verdict: "PASS", format: "CD" },
  );
});

test("media-scope parser rejects contradictory carrier claims", () => {
  assert.deepEqual(
    parseCuratedWorkMediaScope({
      originalFormats: ["VINYL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdAuthorityUrls: ["https://example.com/official-cd-edition"],
      physicalCdReleaseDate: "2020-12-23",
      physicalCdCatalogNumber: "KICS-93968～70",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      physicalCdContainerTitle: "All Time Best",
    }),
    {
      originalFormats: ["VINYL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdAuthorityUrls: ["https://example.com/official-cd-edition"],
      physicalCdDateEvidenceKind: "AVAILABLE_BY",
      physicalCdReleaseDate: "2020-12-23",
      physicalCdCatalogNumber: "KICS-93968～70",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      physicalCdContainerTitle: "All Time Best",
      exclusionReason: null,
    },
  );
  assert.throws(
    () => parseCuratedWorkMediaScope({
      originalFormats: ["CASSETTE"],
      physicalCd: "ORIGINAL_RELEASE",
    }),
    /requires CD in originalFormats/,
  );
  assert.throws(
    () => parseCuratedWorkMediaScope({
      originalFormats: ["DIGITAL"],
      physicalCd: "NONE",
      exclusionReason: "CASSETTE_ONLY",
    }),
    /CASSETTE_ONLY requires originalFormats \[CASSETTE\]/,
  );
  assert.throws(
    () => parseCuratedWorkMediaScope({
      originalFormats: ["VINYL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
    }),
    /requires physicalCdAuthorityUrls/,
  );
  assert.throws(
    () => parseCuratedWorkMediaScope({
      originalFormats: ["VINYL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdAuthorityUrls: ["https://example.com/official-cd-edition"],
      physicalCdReleaseDate: "2020-12-23",
      physicalCdCatalogNumber: "KICS-93968～70",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
    }),
    /requires a later official CD date, catalog number, and container title/,
  );
  assert.throws(
    () => parseCuratedWorkMediaScope({
      originalFormats: ["CD"],
      physicalCd: "ORIGINAL_RELEASE",
      physicalCdContainerTitle: "Unrelated Box",
    }),
    /only valid for CONTAINER_INCLUSION/,
  );
});

test("a later Seiko box is AVAILABLE_BY evidence and cannot reject an earlier exact CD", () => {
  const seiko = findCuratedArtistDiscography(null, ["松田聖子"]);
  const work = seiko?.works.find((candidate) =>
    candidate.category === "SINGLE" && candidate.title === "青い珊瑚礁");
  assert.ok(work?.mediaScope);

  assert.equal(work.originalReleaseDate, "1980-07-01");
  assert.equal(work.mediaScope.physicalCdReleaseDate, "2010-05-26");
  assert.equal(curatedPhysicalCdDateEvidenceKind(work.mediaScope), "AVAILABLE_BY");
  assert.equal(
    curatedPhysicalCdDateRelation(work.mediaScope, "2004-04-14"),
    "WITHIN_AVAILABLE_BY",
  );
  assert.equal(
    curatedPhysicalCdDateRelation(work.mediaScope, "2010-05-26"),
    "WITHIN_AVAILABLE_BY",
  );
  assert.equal(
    curatedPhysicalCdDateRelation(work.mediaScope, "2011-01-01"),
    "AFTER_AVAILABLE_BY",
  );
});

test("same-work carrier dates remain exact edition evidence", () => {
  const exact = parseCuratedWorkMediaScope({
    originalFormats: ["CD"],
    physicalCd: "ORIGINAL_RELEASE",
    physicalCdAuthorityUrls: ["https://example.com/exact-edition"],
    physicalCdReleaseDate: "2004-04-14",
    physicalCdCatalogNumber: "SRCL-5676",
  });
  assert.equal(curatedPhysicalCdDateEvidenceKind(exact), "EXACT_EDITION");
  assert.equal(curatedPhysicalCdDateRelation(exact, "2004-04-14"), "EXACT_EDITION_MATCH");
  assert.equal(curatedPhysicalCdDateRelation(exact, "2010-05-26"), "EXACT_EDITION_MISMATCH");

  assert.throws(() => parseCuratedWorkMediaScope({
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    physicalCdAuthorityUrls: ["https://example.com/box"],
    physicalCdDateEvidenceKind: "EXACT_EDITION",
    physicalCdReleaseDate: "2010-05-26",
    physicalCdCatalogNumber: "SRCL-20061/20133",
    physicalCdRepresentationKind: "CONTAINER_INCLUSION",
    physicalCdContainerTitle: "Singles Box",
  }), /can only prove AVAILABLE_BY/u);
});

test("a legacy later same-work CD is an availability upper bound unless explicitly exact", () => {
  const later = parseCuratedWorkMediaScope({
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    physicalCdAuthorityUrls: ["https://example.com/later-cd"],
    physicalCdReleaseDate: "2013-07-24",
    physicalCdCatalogNumber: "MHCL-30107",
    physicalCdRepresentationKind: "SAME_WORK_EDITION",
  });
  assert.equal(curatedPhysicalCdDateEvidenceKind(later), "AVAILABLE_BY");
  assert.equal(curatedPhysicalCdDateRelation(later, "1990-10-15"), "WITHIN_AVAILABLE_BY");

  const explicitlyExact = parseCuratedWorkMediaScope({
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    physicalCdAuthorityUrls: ["https://example.com/later-cd"],
    physicalCdDateEvidenceKind: "EXACT_EDITION",
    physicalCdReleaseDate: "2013-07-24",
    physicalCdCatalogNumber: "MHCL-30107",
    physicalCdRepresentationKind: "SAME_WORK_EDITION",
  });
  assert.equal(curatedPhysicalCdDateEvidenceKind(explicitlyExact), "EXACT_EDITION");
  assert.equal(
    curatedPhysicalCdDateRelation(explicitlyExact, "1990-10-15"),
    "EXACT_EDITION_MISMATCH",
  );
});
