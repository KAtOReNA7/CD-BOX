import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyComprehensiveEvidence,
  type ComprehensiveEvidenceCandidate,
  type ComprehensiveEvidenceObservation,
} from "@/lib/ai/comprehensive-evidence-audit";
import { MIHO_NAKAYAMA_KING_CARRIER_URL, MIHO_NAKAYAMA_MELLOW_CD_URL } from
  "@/lib/official-music/miho-nakayama-carrier";
import { SEIKO_MATSUDA_RECOVERY_SPECS } from
  "@/lib/official-music/seiko-matsuda-recovery";

type Fixture = {
  slug: string;
  key: string;
  artist: string;
  title: string;
  category: string;
  originalDate: string;
  physicalCd: "ORIGINAL_RELEASE" | "LATER_OFFICIAL_EDITION";
  physicalDate: string;
  catalog: string;
  kind: "SAME_WORK_EDITION" | "CONTAINER_INCLUSION";
  containerTitle?: string;
  carrier: ComprehensiveEvidenceObservation;
};

function candidate(input: Fixture): ComprehensiveEvidenceCandidate {
  const manifestProvider = `curated-official-manifest:${input.slug}`;
  return {
    candidateId: `candidate:${input.key}`,
    workId: `work:${input.key}`,
    editionId: `${manifestProvider}:representation:${input.key}`,
    title: input.title,
    artistCredit: input.artist,
    observations: [{
      id: `manifest:${input.key}`,
      provider: manifestProvider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "fixture",
      sourceUrl: "https://example.invalid/manifest",
      matchedFields: ["artist", "title", "category", "date"],
      facts: {
        manifestEntryKey: input.key,
        artist: input.artist,
        artistCredits: "",
        title: input.title,
        category: input.category,
        date: input.originalDate,
      },
    }, {
      id: `scope:${input.key}`,
      provider: manifestProvider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: input.physicalCd === "ORIGINAL_RELEASE"
        ? "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED"
        : "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
      reason: "fixture",
      sourceUrl: input.carrier.sourceUrl,
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        manifestEntryKey: input.key,
        country: "JP",
        physicalCdCountry: "JP",
        format: "CD",
        title: input.title,
        date: input.originalDate,
        physicalCd: input.physicalCd,
        physicalCdReleaseDate: input.physicalDate,
        physicalCdCatalogNumber: input.catalog,
        physicalCdRepresentationKind: input.kind,
        physicalCdContainerTitle: input.containerTitle ?? null,
      },
    }, {
      id: `musicbrainz:${input.key}`,
      provider: "musicbrainz",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "MUSICBRAINZ",
      verdict: "PASS",
      reasonCode: "MUSICBRAINZ_WORK_GROUP_CORROBORATION",
      reason: "fixture",
      sourceUrl: "https://musicbrainz.org/release-group/11111111-1111-4111-8111-111111111111",
      matchedFields: ["artist", "title"],
    }, input.carrier],
    conflicts: [],
  };
}

function mihoBoxCarrier(): ComprehensiveEvidenceObservation {
  return {
    id: "king:miho-box",
    provider: "king-records-japan",
    role: "CORROBORATING",
    strength: "STRONG",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "MIHO_KING_ALL_TIME_BEST_CD_CARRIER_MATCH",
    reason: "fixture",
    sourceUrl: MIHO_NAKAYAMA_KING_CARRIER_URL,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format",
      "trackMembership", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: "SINGLE:2",
      artist: "中山美穂",
      canonicalArtist: "中山美穂",
      carrierTitle: "All Time Best",
      observedCarrierTitle: "All Time Best【初回限定盤】",
      canonicalTitle: "生意気",
      date: "2020-12-23",
      catalogNumber: "KICS-93968～70",
      country: "JP",
      format: "CD",
      cdDiscCount: "3",
      trackCount: "40",
      memberTrackTitle: "生意気",
      memberDisc: "1",
      memberPosition: "2",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      coverInheritanceAllowed: "false",
    },
  };
}

function mellowCarrier(): ComprehensiveEvidenceObservation {
  return {
    id: "king:mellow",
    provider: "king-records-japan",
    role: "CORROBORATING",
    strength: "STRONG",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "MIHO_KING_MELLOW_CD_CARRIER_MATCH",
    reason: "fixture",
    sourceUrl: MIHO_NAKAYAMA_MELLOW_CD_URL,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format",
      "trackList", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: "ORIGINAL_ALBUM:14",
      artist: "中山美穂",
      canonicalArtist: "中山美穂",
      carrierTitle: "Mellow",
      canonicalTitle: "Mellow",
      originalReleaseDate: "1992-06-10",
      date: "2015-10-14",
      catalogNumber: "KICS-3274",
      country: "JP",
      format: "CD",
      cdDiscCount: "1",
      trackCount: "11",
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      coverInheritanceAllowed: "false",
    },
  };
}

function akinaCarrier(): ComprehensiveEvidenceObservation {
  return {
    id: "universal:diva",
    provider: "universal-music-japan",
    role: "CORROBORATING",
    strength: "STRONG",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "AKINA_OFFICIAL_RECOVERY_CD_CARRIER_MATCH",
    reason: "fixture",
    sourceUrl: "https://www.universal-music.co.jp/nakamori-akina/products/umck-5257/",
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: "SINGLE:50",
      artist: "中森明菜",
      canonicalArtist: "中森明菜",
      carrierTitle: "DIVA Single Version",
      canonicalTitle: "DIVA",
      date: "2009-09-23",
      catalogNumber: "UMCK-5257",
      country: "JP",
      format: "CD",
      status: "Official",
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
    },
  };
}

function seikoCarrier(): ComprehensiveEvidenceObservation {
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS["SINGLE:27"];
  return {
    id: "seiko:precious-heart",
    provider: "seiko-matsuda-official",
    role: "CORROBORATING",
    strength: "STRONG",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "SEIKO_OFFICIAL_RECOVERY_CD_CARRIER_MATCH",
    reason: "fixture",
    sourceUrl: spec.sourceUrl,
    matchedFields: [
      "artist", "title", "date", "catalogNumber", "country", "format", "uniqueCarrier",
    ],
    facts: {
      manifestEntryKey: "SINGLE:27",
      artist: "松田聖子",
      canonicalArtist: "松田聖子",
      carrierTitle: spec.pageTitle,
      canonicalTitle: spec.canonicalTitle,
      date: spec.releaseDate,
      catalogNumber: "CSDL-3045",
      catalogNumbers: "CSDL-3045",
      country: "JP",
      format: "CD",
      status: "Official",
      physicalCdRepresentationKind: "SAME_WORK_EDITION",
      uniqueBinding: "true",
      uniqueCarrierEntity: "true",
      selectionPolicy: spec.selectionPolicy,
      fixedPageId: String(spec.detailId),
      auditedCoverSha256: spec.auditedAsset.sha256,
    },
  };
}

function replaceWithGenericInventoryFallback(
  fixture: ComprehensiveEvidenceCandidate,
  input: { key: string; artist: string; title: string; category: string; year: string; catalog: string },
) {
  const scope = fixture.observations.find((item) => item.stage === "SCOPE")!;
  fixture.observations = fixture.observations.filter((item) =>
    item.stage !== "MUSICBRAINZ" && item !== fixture.observations.at(-1));
  fixture.observations.push({
    id: `generic-official:${input.key}`,
    provider: "official-catalog",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "OFFICIAL_CATALOG_EDITION_MATCH",
    reason: "generic fallback fixture",
    sourceUrl: scope.sourceUrl,
    matchedFields: ["title", "catalogNumber", "date"],
    facts: { title: input.title, catalogNumber: input.catalog, date: `${input.year}-01-01` },
  }, {
    id: `generic-discogs:${input.key}`,
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
    reason: "generic fallback fixture",
    sourceUrl: "https://www.discogs.com/release/123",
    matchedFields: [
      "artist", "title", "category", "originalYear", "catalogNumber", "year",
    ],
    facts: {
      manifestEntryKey: input.key,
      uniqueBinding: "true",
      inventoryComplete: "true",
      matchKind: "NFKC_EXACT",
      canonicalArtist: input.artist,
      artist: input.artist,
      boundArtistCredit: input.artist,
      canonicalTitle: input.title,
      title: input.title,
      category: input.category,
      originalYear: input.year,
      year: input.year,
      catalogNumber: input.catalog,
      formats: `CD,${input.category === "SINGLE" ? "Single" : "Album"}`,
      releaseId: "123",
    },
  });
  const official = fixture.observations.at(-2)!;
  official.facts!.date = scope.facts!.physicalCdReleaseDate;
}

test("accepts only the exact Miho All Time Best membership carrier", () => {
  const fixture = candidate({
    slug: "miho-nakayama", key: "SINGLE:2", artist: "中山美穂", title: "生意気",
    category: "SINGLE", originalDate: "1985-09-21",
    physicalCd: "LATER_OFFICIAL_EDITION", physicalDate: "2020-12-23",
    catalog: "KICS-93968～70", kind: "CONTAINER_INCLUSION", containerTitle: "All Time Best",
    carrier: mihoBoxCarrier(),
  });
  assert.equal(classifyComprehensiveEvidence(fixture).verdict, "PASS");
  fixture.observations.at(-1)!.facts!.memberTrackTitle = "生意気 remix";
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});

test("accepts one exact Mellow King edition and rejects duplicate carrier observations", () => {
  const fixture = candidate({
    slug: "miho-nakayama", key: "ORIGINAL_ALBUM:14", artist: "中山美穂", title: "Mellow",
    category: "ORIGINAL_ALBUM", originalDate: "1992-06-10",
    physicalCd: "LATER_OFFICIAL_EDITION", physicalDate: "2015-10-14",
    catalog: "KICS-3274", kind: "SAME_WORK_EDITION", carrier: mellowCarrier(),
  });
  assert.equal(classifyComprehensiveEvidence(fixture).verdict, "PASS");
  fixture.observations.push({ ...mellowCarrier(), id: "king:mellow:duplicate" });
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});

test("accepts the fixed Akina DIVA official product and rejects another source", () => {
  const fixture = candidate({
    slug: "akina-nakamori", key: "SINGLE:50", artist: "中森明菜", title: "DIVA",
    category: "SINGLE", originalDate: "2009-09-23", physicalCd: "ORIGINAL_RELEASE",
    physicalDate: "2009-09-23", catalog: "UMCK-5257", kind: "SAME_WORK_EDITION",
    carrier: akinaCarrier(),
  });
  assert.equal(classifyComprehensiveEvidence(fixture).verdict, "PASS");
  fixture.observations.at(-1)!.sourceUrl =
    "https://www.universal-music.co.jp/nakamori-akina/products/umck-1331/";
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});

test("Akina DIVA cannot fall through to a generic official and Discogs tuple", () => {
  const fixture = candidate({
    slug: "akina-nakamori", key: "SINGLE:50", artist: "中森明菜", title: "DIVA",
    category: "SINGLE", originalDate: "2009-09-23", physicalCd: "ORIGINAL_RELEASE",
    physicalDate: "2009-09-23", catalog: "UMCK-5257", kind: "SAME_WORK_EDITION",
    carrier: akinaCarrier(),
  });
  replaceWithGenericInventoryFallback(fixture, {
    key: "SINGLE:50", artist: "中森明菜", title: "DIVA", category: "SINGLE",
    year: "2009", catalog: "UMCK-5257",
  });
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});

test("accepts the exact Seiko recovery tuple and rejects a changed audited asset", () => {
  const fixture = candidate({
    slug: "seiko-matsuda", key: "SINGLE:27", artist: "松田聖子", title: "Precious Heart",
    category: "SINGLE", originalDate: "1989-11-15", physicalCd: "ORIGINAL_RELEASE",
    physicalDate: "1989-11-15", catalog: "CSDL-3045", kind: "SAME_WORK_EDITION",
    carrier: seikoCarrier(),
  });
  assert.equal(classifyComprehensiveEvidence(fixture).verdict, "PASS");
  fixture.observations.at(-1)!.facts!.auditedCoverSha256 = "0".repeat(64);
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});

test("Seiko recovery keys cannot fall through to a generic official and Discogs tuple", () => {
  const fixture = candidate({
    slug: "seiko-matsuda", key: "SINGLE:27", artist: "松田聖子", title: "Precious Heart",
    category: "SINGLE", originalDate: "1989-11-15", physicalCd: "ORIGINAL_RELEASE",
    physicalDate: "1989-11-15", catalog: "CSDL-3045", kind: "SAME_WORK_EDITION",
    carrier: seikoCarrier(),
  });
  replaceWithGenericInventoryFallback(fixture, {
    key: "SINGLE:27", artist: "松田聖子", title: "Precious Heart", category: "SINGLE",
    year: "1989", catalog: "CSDL-3045",
  });
  assert.equal(classifyComprehensiveEvidence(fixture).reasonCode, "MISSING_DECLARED_CARRIER");
});
