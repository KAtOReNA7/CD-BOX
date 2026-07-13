import assert from "node:assert/strict";
import test from "node:test";
import {
  matchMomoeOfficialCatalogToCurated,
} from "@/lib/ai/momoe-official-curated";
import type {
  CuratedArtistDiscography,
  CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import {
  MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
  MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS,
  momoeYamaguchiSonyAlbumJsonpUrl,
  momoeYamaguchiSonyAlbumProductUrl,
  type MomoeYamaguchiCanonicalWork,
  type MomoeYamaguchiCatalogResult,
  type MomoeYamaguchiWorkCoverEvidence,
} from "@/lib/official-music/momoe-yamaguchi";

function dateAt(year: number, offset: number) {
  return new Date(Date.UTC(year, 0, offset + 1)).toISOString().slice(0, 10);
}

function curatedWork(
  category: CuratedDiscographyWork["category"],
  ordinal: number,
): CuratedDiscographyWork {
  const prefix = category === "SINGLE" ? "Single" : "Album";
  return {
    ordinal,
    title: `${prefix} ${ordinal}`,
    aliases: [`${prefix} Alias ${ordinal}`],
    category,
    originalReleaseDate: dateAt(category === "SINGLE" ? 1973 : 1975, ordinal - 1),
    authorityUrls: ["https://official.example/catalog"],
    authorityAsOf: "2026-07-12",
    mediaScope: null,
  };
}

function curatedFixture(): CuratedArtistDiscography {
  return {
    slug: "momoe-yamaguchi",
    canonicalName: "山口百恵",
    aliases: ["Momoe Yamaguchi"],
    musicBrainzArtistId: "85c1ff8e-b819-416d-9b73-5be468f7211a",
    country: "JP",
    works: [
      ...Array.from({ length: 32 }, (_, index) => curatedWork("SINGLE", index + 1)),
      ...Array.from({ length: 22 }, (_, index) => curatedWork("ORIGINAL_ALBUM", index + 1)),
    ],
  };
}

function sourceWork(work: CuratedDiscographyWork): MomoeYamaguchiCanonicalWork {
  const observedTitle = work.aliases[0]!;
  const isSingle = work.category === "SINGLE";
  const catalogNumber = isSingle
    ? `SOLB ${100 + work.ordinal}`
    : MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS[work.ordinal - 1]!;
  const sourceUrl = isSingle
    ? MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL
    : momoeYamaguchiSonyAlbumProductUrl(catalogNumber);
  const retrievalUrl = isSingle
    ? sourceUrl
    : momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber);
  const cover: MomoeYamaguchiWorkCoverEvidence = {
    provider: "sony-music-otonano",
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url: isSingle
      ? `https://www.110107.com/files/6/OTONANO/originalpage/golden_idol/img/momoe/TESTS${work.ordinal}.jpg`
      : `https://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/TESTA${work.ordinal}.jpg`,
    sourceUrl,
  };
  const edition = isSingle
    ? null
    : { catalogNumber, releaseDate: "2004-05-19" };
  return {
    ordinal: work.ordinal,
    title: observedTitle,
    aliases: [],
    category: work.category,
    originalReleaseDate: work.originalReleaseDate!,
    originalCatalogNumber: isSingle ? catalogNumber : null,
    sourceEdition: edition,
    authorityUrls: [sourceUrl],
    evidence: {
      provider: "sony-music-otonano",
      sourceType: "official-record-label-catalog",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      scope: "WORK",
      matchedFields: ["artist", "title", "category", "date", "catalogNumber"],
      sourceUrl,
      sourceUrls: [sourceUrl],
      retrievalUrl,
      observedArtist: "山口百恵",
      observedTitle,
      observedCategory: work.category,
      observedOriginalReleaseDate: work.originalReleaseDate!,
      observedOriginalCatalogNumber: isSingle ? catalogNumber : null,
      observedEditionReleaseDate: edition?.releaseDate ?? null,
      observedEditionCatalogNumber: edition?.catalogNumber ?? null,
      cover,
    },
    cover,
  };
}

function officialFixture(manifest = curatedFixture()): MomoeYamaguchiCatalogResult {
  const singles = manifest.works
    .filter((work) => work.category === "SINGLE")
    .map(sourceWork);
  const originalAlbums = manifest.works
    .filter((work) => work.category === "ORIGINAL_ALBUM")
    .map(sourceWork);
  const works = [...singles, ...originalAlbums];
  return {
    status: "COMPLETE",
    complete: true,
    artist: {
      canonicalName: "山口百恵",
      aliases: ["Momoe Yamaguchi"],
      country: "JP",
    },
    works,
    singles,
    originalAlbums,
    coverByWorkKey: Object.fromEntries(
      works.map((work) => [`${work.category}:${work.ordinal}`, work.cover]),
    ),
    warnings: [],
    stats: {
      requestsAttempted: 23,
      responsesFetched: 23,
      retries: 0,
      singleRowsParsed: 33,
      promotionalRowsExcluded: 1,
      singlesParsed: 32,
      albumsParsed: 22,
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function updateOfficialWork(
  catalog: MomoeYamaguchiCatalogResult,
  category: CuratedDiscographyWork["category"],
  ordinal: number,
  update: (work: MomoeYamaguchiCanonicalWork) => void,
) {
  const categoryWorks = category === "SINGLE" ? catalog.singles : catalog.originalAlbums;
  const primary = categoryWorks.find((work) => work.ordinal === ordinal);
  assert.ok(primary);
  update(primary);
  const combined = catalog.works.find((work) =>
    work.category === category && work.ordinal === ordinal);
  assert.ok(combined);
  if (combined !== primary) update(combined);
}

test("emits 54 strong dynamic authority facts and official WORK covers by manifestEntryKey", () => {
  const manifest = curatedFixture();
  const catalog = officialFixture(manifest);
  const result = matchMomoeOfficialCatalogToCurated(manifest, catalog);

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.complete, true);
  assert.equal(result.matches.length, 54);
  assert.equal(Object.keys(result.authorityByManifestEntryKey).length, 54);
  assert.equal(Object.keys(result.coverByManifestEntryKey).length, 54);

  const single = result.authorityByManifestEntryKey["SINGLE:1"];
  assert.equal(single?.role, "AUTHORITATIVE");
  assert.equal(single?.strength, "STRONG");
  assert.equal(single?.stage, "AUTHORITATIVE");
  assert.equal(single?.verdict, "PASS");
  assert.equal(single?.facts?.canonicalTitle, "Single 1");
  assert.equal(single?.facts?.observedTitle, "Single Alias 1");
  assert.equal(single?.facts?.title, "Single Alias 1");
  assert.equal(single?.facts?.date, "1973-01-01");
  assert.equal(single?.facts?.catalogNumber, "SOLB 101");
  assert.equal(single?.facts?.originalCatalogNumber, "SOLB 101");
  assert.equal(single?.matchedFields.includes("catalogNumber"), true);
  assert.equal(single?.sourceUrl, MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL);
  assert.equal(result.coverByManifestEntryKey["SINGLE:1"]?.scope, "WORK");

  const album = result.authorityByManifestEntryKey["ORIGINAL_ALBUM:1"];
  assert.equal(album?.facts?.editionCatalogNumber, "MHCL-10011");
  assert.equal(album?.facts?.editionReleaseDate, "2004-05-19");
  assert.equal(album?.facts?.date, "1975-01-01");
  assert.equal(album?.facts?.catalogNumber, null);
  assert.equal(album?.matchedFields.includes("catalogNumber"), false);
  assert.equal(album?.sourceUrl, momoeYamaguchiSonyAlbumProductUrl("MHCL-10011"));
  assert.equal(album?.facts?.retrievalUrl, momoeYamaguchiSonyAlbumJsonpUrl("MHCL-10011"));
  assert.equal("candidate" in result.matches[0]!, false);
  assert.equal("mediaScope" in result.matches[0]!, false);
});

test("requires exact curated artist identity, MusicBrainz id, and country", () => {
  const baseManifest = curatedFixture();
  const catalog = officialFixture(baseManifest);
  for (const mutate of [
    (manifest: CuratedArtistDiscography) => { manifest.canonicalName = "山口 百恵"; },
    (manifest: CuratedArtistDiscography) => { manifest.country = "US"; },
    (manifest: CuratedArtistDiscography) => { manifest.musicBrainzArtistId = "wrong"; },
    (manifest: CuratedArtistDiscography) => { manifest.aliases = ["Momoe"]; },
  ]) {
    const manifest = clone(baseManifest);
    mutate(manifest);
    const result = matchMomoeOfficialCatalogToCurated(manifest, catalog);
    assert.equal(result.reasonCode, "ARTIST_IDENTITY_MISMATCH");
    assert.deepEqual(result.matches, []);
  }
});

test("rejects incomplete source results without emitting partial facts or covers", () => {
  const manifest = curatedFixture();
  const catalog = officialFixture(manifest);
  catalog.status = "SOURCE_INCOMPLETE";
  catalog.complete = false;
  catalog.warnings = [{
    code: "network-unavailable",
    message: "unavailable",
    retryable: true,
  }];

  const result = matchMomoeOfficialCatalogToCurated(manifest, catalog);
  assert.equal(result.reasonCode, "SOURCE_NOT_COMPLETE");
  assert.deepEqual(result.authorityByManifestEntryKey, {});
  assert.deepEqual(result.coverByManifestEntryKey, {});
});

test("requires exactly 32+22 curated works with complete original dates", () => {
  const manifest = curatedFixture();
  const catalog = officialFixture(manifest);
  const missing = clone(manifest);
  missing.works.pop();
  assert.equal(
    matchMomoeOfficialCatalogToCurated(missing, catalog).reasonCode,
    "MANIFEST_SHAPE_INVALID",
  );

  const partialDate = clone(manifest);
  partialDate.works[0]!.originalReleaseDate = "1973";
  assert.equal(
    matchMomoeOfficialCatalogToCurated(partialDate, catalog).reasonCode,
    "MANIFEST_SHAPE_INVALID",
  );
});

test("requires an internally complete 32+22 official snapshot with full dates", () => {
  const manifest = curatedFixture();
  const missing = clone(officialFixture(manifest));
  missing.singles.pop();
  assert.equal(
    matchMomoeOfficialCatalogToCurated(manifest, missing).reasonCode,
    "OFFICIAL_CATALOG_SHAPE_INVALID",
  );

  const partialDate = clone(officialFixture(manifest));
  updateOfficialWork(partialDate, "SINGLE", 1, (work) => {
    work.originalReleaseDate = "1973";
    work.evidence.observedOriginalReleaseDate = "1973";
  });
  assert.equal(
    matchMomoeOfficialCatalogToCurated(manifest, partialDate).reasonCode,
    "OFFICIAL_PROVENANCE_INVALID",
  );
});

test("title matching accepts a complete alias but never a substring", () => {
  const manifest = curatedFixture();
  const catalog = officialFixture(manifest);
  assert.equal(matchMomoeOfficialCatalogToCurated(manifest, catalog).complete, true);

  const substring = clone(catalog);
  updateOfficialWork(substring, "SINGLE", 1, (work) => {
    work.title = "Single Alias";
    work.evidence.observedTitle = "Single Alias";
  });
  const result = matchMomoeOfficialCatalogToCurated(manifest, substring);
  assert.equal(result.reasonCode, "WORK_MAPPING_NOT_BIJECTIVE");
  assert.deepEqual(result.matches, []);
});

test("fails the entire batch when two manifest entries compete for one official work", () => {
  const manifest = curatedFixture();
  const catalog = officialFixture(manifest);
  manifest.works[1]!.title = manifest.works[0]!.title;
  manifest.works[1]!.aliases = [...manifest.works[0]!.aliases];
  manifest.works[1]!.originalReleaseDate = manifest.works[0]!.originalReleaseDate;

  const result = matchMomoeOfficialCatalogToCurated(manifest, catalog);
  assert.equal(result.reasonCode, "WORK_MAPPING_NOT_BIJECTIVE");
  assert.deepEqual(result.authorityByManifestEntryKey, {});
  assert.deepEqual(result.coverByManifestEntryKey, {});
});

test("rejects an API endpoint or foreign host as the auditable cover source", () => {
  const manifest = curatedFixture();
  const apiSource = clone(officialFixture(manifest));
  updateOfficialWork(apiSource, "ORIGINAL_ALBUM", 1, (work) => {
    work.cover.sourceUrl = momoeYamaguchiSonyAlbumJsonpUrl("MHCL-10011");
    work.evidence.cover.sourceUrl = work.cover.sourceUrl;
  });
  assert.equal(
    matchMomoeOfficialCatalogToCurated(manifest, apiSource).reasonCode,
    "OFFICIAL_PROVENANCE_INVALID",
  );

  const foreignCover = clone(officialFixture(manifest));
  updateOfficialWork(foreignCover, "SINGLE", 1, (work) => {
    work.cover.url = "https://evil.example/files/cover.jpg";
    work.evidence.cover.url = work.cover.url;
  });
  assert.equal(
    matchMomoeOfficialCatalogToCurated(manifest, foreignCover).reasonCode,
    "OFFICIAL_PROVENANCE_INVALID",
  );
});
