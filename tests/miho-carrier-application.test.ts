import assert from "node:assert/strict";
import test from "node:test";

import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import { applyMihoNakayamaKingCarrierEvidence } from "@/lib/ai/miho-carrier-application";
import { findCuratedArtistDiscography } from "@/lib/official-music/curated-discography";
import {
  MIHO_NAKAYAMA_KING_CARRIER_URL,
  MIHO_NAKAYAMA_MELLOW_CD_URL,
  type MihoNakayamaCarrierTrack,
  type MihoNakayamaKingCarrierResult,
  type MihoNakayamaMellowCdResult,
} from "@/lib/official-music/miho-nakayama-carrier";

const resolvedManifest = findCuratedArtistDiscography(null, ["中山美穂"]);
assert.ok(resolvedManifest);
const manifest = resolvedManifest;

const boxKeys = ["SINGLE:2", "SINGLE:3", "SINGLE:7", "SINGLE:16"] as const;
const expectedMembership = [
  { manifestTitle: "生意気", observedTrackTitle: "生意気", disc: 1, position: 2 },
  { manifestTitle: "BE-BOP-HIGHSCHOOL", observedTrackTitle: "BE-BOP-HIGHSCHOOL", disc: 1, position: 3 },
  { manifestTitle: "ツイてるねノッてるね", observedTrackTitle: "ツイてるね ノッてるね", disc: 1, position: 7 },
  { manifestTitle: "VIRGIN EYES", observedTrackTitle: "VIRGIN EYES", disc: 2, position: 2 },
] as const;
const mellowTitles = [
  "Mellow", "あるきなさい", "ゆっくりMy Love", "Platinum Cat", "Silent",
  "忘れなくてもいいじゃない", "灼熱の心", "はなしをきいて", "Kiss Kiss Kiss",
  "Treasure", "Mellow(CM Version)",
];

function boxTracks() {
  const tracks: MihoNakayamaCarrierTrack[] = [];
  for (const [discIndex, count] of [14, 13, 13].entries()) {
    for (let index = 0; index < count; index += 1) {
      tracks.push({ disc: discIndex + 1, position: index + 1,
        title: `fixture-${discIndex + 1}-${index + 1}` });
    }
  }
  for (const member of expectedMembership) {
    tracks.find((track) => track.disc === member.disc && track.position === member.position)!.title =
      member.observedTrackTitle;
  }
  return tracks;
}

function boxResult(): Extract<MihoNakayamaKingCarrierResult, { status: "VERIFIED" }> {
  return {
    status: "VERIFIED",
    complete: true,
    unique: true,
    carrier: {
      provider: "king-records-japan",
      sourceType: "official-record-label-product-page",
      evidenceRole: "PHYSICAL_CD_CARRIER",
      scope: "CONTAINER_EDITION",
      matchLevel: "EDITION_EXACT",
      unique: true,
      artist: "中山美穂",
      title: "All Time Best【初回限定盤】",
      releaseDate: "2020-12-23",
      catalogNumber: "KICS-93968～70",
      country: "JP",
      format: "CD",
      cdDiscCount: 3,
      trackCount: 40,
      tracks: boxTracks(),
      manifestCarrierWorks: expectedMembership.map((item) => ({ ...item })),
      matchedFields: [
        "artist", "title", "releaseDate", "catalogNumber", "discCount", "trackCount", "trackList",
      ],
      sourceUrl: MIHO_NAKAYAMA_KING_CARRIER_URL,
      retrievalUrl: MIHO_NAKAYAMA_KING_CARRIER_URL,
      workCover: null,
      coverInheritanceAllowed: false,
    },
    warnings: [],
    stats: { requestsAttempted: 1, responsesFetched: 1, retries: 0, sourcesParsed: 1, cacheHits: 0 },
  };
}

function mellowResult(): Extract<MihoNakayamaMellowCdResult, { status: "VERIFIED" }> {
  return {
    status: "VERIFIED",
    complete: true,
    unique: true,
    edition: {
      provider: "king-records-japan",
      sourceType: "official-record-label-product-page",
      evidenceRole: "PHYSICAL_CD_EDITION",
      scope: "SAME_WORK_EDITION",
      matchLevel: "EDITION_EXACT",
      representationKind: "SAME_WORK_EDITION",
      unique: true,
      artist: "中山美穂",
      workTitle: "Mellow",
      editionTitle: "Mellow",
      originalReleaseDate: "1992-06-10",
      editionReleaseDate: "2015-10-14",
      catalogNumber: "KICS-3274",
      country: "JP",
      format: "CD",
      isReissue: true,
      cdDiscCount: 1,
      trackCount: 11,
      tracks: mellowTitles.map((title, index) => ({ position: index + 1, title })),
      matchedFields: [
        "artist", "title", "editionReleaseDate", "catalogNumber", "format", "trackList",
      ],
      sourceUrl: MIHO_NAKAYAMA_MELLOW_CD_URL,
      retrievalUrl: MIHO_NAKAYAMA_MELLOW_CD_URL,
      workCover: null,
      coverInheritanceAllowed: false,
    },
    warnings: [],
    stats: { requestsAttempted: 1, responsesFetched: 1, retries: 0, sourcesParsed: 1, cacheHits: 0 },
  };
}

function work(key: string) {
  const [category, rawOrdinal] = key.split(":");
  return manifest.works.find((item) =>
    item.category === category && item.ordinal === Number(rawOrdinal))!;
}

function candidate(key: string): ComprehensiveDiscographyCandidate {
  const manifestWork = work(key);
  const media = manifestWork.mediaScope!;
  return {
    candidate: {
      id: `candidate:${key}`,
      title: manifestWork.title,
      titleOriginal: null,
      category: manifestWork.category,
      artistCredit: "中山美穂",
      releaseDate: media.physicalCdReleaseDate,
      originalReleaseDate: manifestWork.originalReleaseDate,
      format: "CD (official canonical-work representation)",
      catalogNumber: media.physicalCdCatalogNumber,
      barcode: null,
      label: null,
      originalPrice: null,
      editionType: "LATER_OFFICIAL_CD_REPRESENTATION",
      isReissue: true,
      isRemaster: null,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [],
      verification: null,
    },
    workId: `work:${key}`,
    editionId: `curated-official-manifest:miho-nakayama:representation:${key}`,
    observations: [{
      id: `manifest:${key}`,
      provider: "curated-official-manifest:miho-nakayama",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "fixture",
      sourceUrl: manifestWork.authorityUrls[0] ?? null,
      matchedFields: ["artist", "title", "category"],
      facts: { manifestEntryKey: key },
    }],
    conflicts: [],
  };
}

test("binds the four exact Miho works to the fixed All Time Best carrier", () => {
  const result = applyMihoNakayamaKingCarrierEvidence({
    candidates: boxKeys.map(candidate),
    manifest,
    box: boxResult(),
    mellow: null,
  });

  assert.equal(result.matchedCarriers, 4);
  assert.equal(result.candidates.every((item) => item.observations.some((observation) =>
    observation.reasonCode === "MIHO_KING_ALL_TIME_BEST_CD_CARRIER_MATCH")), true);
  assert.equal(result.candidates.every((item) => item.observations.some((observation) =>
    observation.facts?.coverInheritanceAllowed === "false")), true);
});

test("rejects near-substring box membership instead of broadening a work title", () => {
  const changed = boxResult();
  changed.carrier.manifestCarrierWorks[1]!.observedTrackTitle = "THE BE-BOP-HIGHSCHOOL REMIX";
  const result = applyMihoNakayamaKingCarrierEvidence({
    candidates: boxKeys.map(candidate), manifest, box: changed, mellow: null,
  });

  assert.equal(result.matchedCarriers, 0);
});

test("binds Mellow to the exact 2015 King same-work CD edition", () => {
  const result = applyMihoNakayamaKingCarrierEvidence({
    candidates: [candidate("ORIGINAL_ALBUM:14")],
    manifest,
    box: null,
    mellow: mellowResult(),
  });

  assert.equal(result.matchedCarriers, 1);
  const evidence = result.candidates[0]?.observations.find((item) =>
    item.reasonCode === "MIHO_KING_MELLOW_CD_CARRIER_MATCH");
  assert.equal(evidence?.facts?.date, "2015-10-14");
  assert.equal(evidence?.facts?.catalogNumber, "KICS-3274");
});

test("rejects Mellow when any fixed track-list boundary changes", () => {
  const changed = mellowResult();
  changed.edition.tracks[10]!.title = "Mellow (unknown version)";
  const result = applyMihoNakayamaKingCarrierEvidence({
    candidates: [candidate("ORIGINAL_ALBUM:14")], manifest, box: null, mellow: changed,
  });

  assert.equal(result.matchedCarriers, 0);
});

test("does not attach official evidence to a candidate with a different carrier tuple", () => {
  const changed = candidate("ORIGINAL_ALBUM:14");
  changed.candidate.catalogNumber = "KICS-210";
  const result = applyMihoNakayamaKingCarrierEvidence({
    candidates: [changed], manifest, box: null, mellow: mellowResult(),
  });

  assert.equal(result.matchedCarriers, 0);
});
