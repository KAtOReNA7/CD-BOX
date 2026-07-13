import assert from "node:assert/strict";
import test from "node:test";

import { matchSeikoOfficialEntitiesToCurated } from "@/lib/ai/seiko-official-curated";
import { findCuratedArtistDiscography } from "@/lib/official-music/curated-discography";
import {
  SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS,
  SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS,
  type SeikoMatsudaOfficialEntity,
  type SeikoMatsudaOfficialResult,
  type SeikoMatsudaOfficialWorkKey,
} from "@/lib/official-music/seiko-matsuda";

const specifications = {
  "SINGLE:22": {
    title: "DANCING SHOES (Club Mix)",
    category: "SINGLE",
    manifestCategory: "SINGLE",
    date: "1985-06-24",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "12AH-1896",
    catalogs: ["12AH-1896"],
    cover: "1985-3_Artwork19850624-112-0001.gif",
  },
  "SINGLE:29": {
    title: "Who's that boy",
    category: "SINGLE",
    manifestCategory: "SINGLE",
    date: "1990-10-01",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "73523",
    catalogs: ["73523"],
    cover: "1990-4_Artwork19901001-112-0001.gif",
  },
  "SINGLE:71": {
    title: "特別な恋人/声だけ聞かせて",
    category: "SINGLE",
    manifestCategory: "SINGLE",
    date: "2011-11-23",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "UMCK-5355",
    catalogs: ["UMCK-5355"],
    cover: "2011-4_Artwork20111123-112-0001.jpg",
  },
  "ORIGINAL_ALBUM:29": {
    title: "Sweetest Time",
    category: "ALBUM",
    manifestCategory: "ORIGINAL_ALBUM",
    date: "1997-12-03",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "PHCL-12",
    catalogs: ["PHCL-12"],
    cover: "1997-1_Artwork19971203-111-0001.gif",
  },
  "ORIGINAL_ALBUM:35": {
    title: "area62",
    category: "ALBUM",
    manifestCategory: "ORIGINAL_ALBUM",
    date: "2002-06-21",
    dateKind: "UNRESOLVED",
    catalogDisplay: "VIVI-19623/TGCS-1439",
    catalogs: ["VIVI-19623", "TGCS-1439"],
    cover: "2002-1_Artwork20020621-111-0001.gif",
  },
} as const;

function entity(key: SeikoMatsudaOfficialWorkKey): SeikoMatsudaOfficialEntity {
  const spec = specifications[key];
  const sourceUrl = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[key];
  return {
    manifestEntryKey: key,
    sourceUrl,
    provider: "seiko-matsuda-official",
    sourceType: "official-artist-entity-page",
    evidenceScope: "single-item-page",
    observedArtist: "松田聖子",
    observedTitle: spec.title,
    observedCategory: spec.category,
    manifestCategory: spec.manifestCategory,
    observedReleaseDate: spec.date,
    observedDateKind: spec.dateKind,
    observedCatalogDisplay: spec.catalogDisplay,
    observedCatalogNumbers: [...spec.catalogs],
    tracks: [{ position: 1, title: spec.title, duration: "4:00" }],
    identityTrackTitles: [spec.title],
    cover: {
      provider: "seiko-matsuda-official",
      scope: "WORK",
      matchLevel: "WORK_EXACT",
      url: `https://www.seikomatsuda.co.jp/discography/images/upload/${spec.cover}`,
      sourceUrl,
      observedAlt: spec.title,
      requiresAssetValidation: true,
    },
    conflicts: {
      taxonomy: key === "ORIGINAL_ALBUM:29"
        ? {
            status: "UNRESOLVED",
            manifestCategory: "ORIGINAL_ALBUM",
            officialObservedCategory: "ALBUM",
            competingClaims: [{
              provider: "musicbrainz",
              field: "category",
              value: "EP",
              sourceUrl: "https://musicbrainz.org/release-group/00000000-0000-0000-0000-000000000029",
              fetchedByThisAdapter: false,
              evidenceRole: "DECLARED_CONFLICT_ONLY",
            }],
            resolution: null,
          }
        : null,
      date: key === "ORIGINAL_ALBUM:35"
        ? {
            status: "UNRESOLVED",
            manifestDate: "2002-06-21",
            officialObservedDate: "2002-06-21",
            competingClaims: [{
              provider: "musicbrainz",
              field: "date",
              value: "2002-06-11",
              sourceUrl: "https://musicbrainz.org/release-group/00000000-0000-0000-0000-000000000035",
              fetchedByThisAdapter: false,
              evidenceRole: "DECLARED_CONFLICT_ONLY",
            }],
            resolution: null,
          }
        : null,
    },
    optionalExternalEvidence: null,
  };
}

function completeResult(): SeikoMatsudaOfficialResult {
  const keys = Object.keys(specifications) as SeikoMatsudaOfficialWorkKey[];
  const works = keys.map(entity);
  return {
    status: "FIXED_SET_COMPLETE",
    complete: true,
    works,
    byManifestEntryKey: Object.fromEntries(works.map((work) => [work.manifestEntryKey, work])),
    sourceResults: keys.map((key) => ({
      workKey: key,
      url: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[key],
      status: "COMPLETE",
      failureCode: null,
      message: null,
    })),
    warnings: [],
    externalEvidence: {
      status: "SOURCE_SET_COMPLETE",
      requested: true,
      sources: {
        DANCING_NDL: {
          status: "PARTIAL",
          verified: false,
          unique: true,
          evidence: {
            evidenceKey: "DANCING_NDL",
            workKey: "SINGLE:22",
            observedArtist: null,
            rawArtist: "",
            artistStatus: "SOURCE_NOT_PROVIDED",
            observedTitle: "DANCING SHOES",
            observedCatalogNumber: "12AH-1896",
            observedDate: null,
            rawDate: "",
            datePrecision: "UNKNOWN",
            dateStatus: "SOURCE_NOT_PROVIDED",
            carrier: "ANALOG_LP",
            verifiedFields: ["title", "catalogNumber", "carrier"],
            missingFields: ["artist", "date"],
            provenance: {
              provider: "national-diet-library",
              sourceType: "national-bibliography-record",
              sourceUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL,
              retrievalUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL,
              fixedRecordId: "R100000002-I000008815159",
              fetchedByThisAdapter: true,
            },
          },
          limitations: ["ARTIST_NOT_PROVIDED", "DATE_UNKNOWN"],
          warning: null,
        },
        WHOS_NDL: {
          status: "VERIFIED",
          verified: true,
          unique: true,
          evidence: {
            evidenceKey: "WHOS_NDL",
            workKey: "SINGLE:29",
            observedArtist: "Seiko",
            rawArtist: "Seiko",
            artistStatus: "VERIFIED",
            observedTitle: "Who's that boy",
            observedCatalogNumber: "SRCL-20090",
            observedDate: "2010-05",
            rawDate: "2010.5",
            datePrecision: "MONTH",
            dateStatus: "VERIFIED",
            carrier: "BLU_SPEC_CD",
            verifiedFields: ["artist", "title", "catalogNumber", "date", "carrier"],
            missingFields: [],
            provenance: {
              provider: "national-diet-library",
              sourceType: "national-bibliography-record",
              sourceUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL,
              retrievalUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL,
              fixedRecordId: "R100000002-I000010906601",
              fetchedByThisAdapter: true,
            },
          },
          limitations: [],
          warning: null,
        },
        WHOS_SONY_BOX: {
          status: "VERIFIED",
          verified: true,
          unique: true,
          evidence: {
            evidenceKey: "WHOS_SONY_BOX",
            workKey: "SINGLE:29",
            observedArtist: "松田聖子",
            observedArtistCredit: "SEIKO",
            observedWorkTitle: "WHO’S THAT BOY",
            observedBoxTitle: "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～",
            observedBoxReleaseDate: "2010-05-26",
            observedCatalogDisplay: "SRCL20061-133",
            observedCatalogRange: { start: "SRCL-20061", end: "SRCL-20133" },
            completeSinglesCount: 73,
            cdDiscCount: 73,
            carrier: "BLU_SPEC_CD",
            overseasSingles: [
              "ALL WAY TO THE HEAVEN",
              "WHO’S THAT BOY",
              "LET’S TALK ABOUT IT",
              "GOOD FOR YOU",
              "all to you",
              "just for tonight",
            ],
            publishedDate: "2010-04-03",
            verifiedFields: [
              "artist",
              "artistCredit",
              "title",
              "boxCompleteness",
              "date",
              "catalogRange",
              "carrier",
            ],
            provenance: {
              provider: "sony-music-japan",
              sourceType: "official-record-label-box-page",
              sourceUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX,
              retrievalUrl: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX,
              fixedRecordId: null,
              fetchedByThisAdapter: true,
            },
          },
          limitations: [],
          warning: null,
        },
      },
      verifiedCount: 2,
      uniqueCount: 3,
      warnings: [],
      stats: { requestsAttempted: 3, responsesFetched: 3, retries: 0, sourcesParsed: 3 },
    },
    stats: { requestsAttempted: 5, responsesFetched: 5, retries: 0, pagesParsed: 5, coverUrlsParsed: 5 },
  };
}

function manifest() {
  const value = findCuratedArtistDiscography(
    "ef013257-e584-410e-88e8-05ea9ae9ea3a",
    ["松田聖子", "Seiko Matsuda"],
  );
  assert.ok(value);
  return value;
}

test("maps the exact five official Seiko entities and preserves external evidence boundaries", () => {
  const matched = matchSeikoOfficialEntitiesToCurated(manifest(), completeResult());
  assert.equal(matched.complete, true);
  assert.equal(matched.matches.length, 5);
  assert.equal(
    matched.matchByManifestEntryKey["SINGLE:29"]?.externalObservations.length,
    2,
  );
  assert.deepEqual(
    matched.matchByManifestEntryKey["SINGLE:29"]?.externalObservations.map((item) => item.reasonCode),
    ["SEIKO_NDL_WHOS_CD_VERIFIED", "SEIKO_SONY_COMPLETE_SINGLES_CD_BOX_VERIFIED"],
  );
  assert.equal(
    matched.matchByManifestEntryKey["SINGLE:22"]?.externalObservations[0]?.verdict,
    "UNKNOWN",
  );
  assert.equal(
    matched.matchByManifestEntryKey["ORIGINAL_ALBUM:35"]?.authority.facts?.dateKind,
    "UNRESOLVED",
  );
});

test("fails closed when the official source is incomplete", () => {
  const official = completeResult();
  official.complete = false;
  official.status = "SOURCE_INCOMPLETE";
  official.works = [];
  official.byManifestEntryKey = {};
  const matched = matchSeikoOfficialEntitiesToCurated(manifest(), official);
  assert.equal(matched.complete, false);
  assert.equal(matched.reasonCode, "SOURCE_NOT_COMPLETE");
  assert.deepEqual(matched.matches, []);
});

test("fails closed on a tampered official title or cover provenance", () => {
  const title = completeResult();
  title.byManifestEntryKey["SINGLE:71"]!.observedTitle = "特別な恋人";
  assert.equal(
    matchSeikoOfficialEntitiesToCurated(manifest(), title).reasonCode,
    "OFFICIAL_PROVENANCE_INVALID",
  );

  const cover = completeResult();
  cover.byManifestEntryKey["SINGLE:29"]!.cover.url =
    "https://example.com/not-an-official-cover.jpg";
  assert.equal(
    matchSeikoOfficialEntitiesToCurated(manifest(), cover).reasonCode,
    "OFFICIAL_PROVENANCE_INVALID",
  );
});
