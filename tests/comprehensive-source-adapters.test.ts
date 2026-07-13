import assert from "node:assert/strict";
import test from "node:test";
import type { CoverAssetValidationResult } from "@/lib/ai/cover-asset-validation";
import type {
  ComprehensiveCandidateResult,
  ComprehensiveDiscographyCandidate,
} from "@/lib/ai/comprehensive-discography";
import {
  createPersistedCoverRetryLookup,
  prepareComprehensiveSourceEvidence,
  type ComprehensiveSourceAdapterDependencies,
} from "@/lib/ai/comprehensive-source-adapters";
import { classifyComprehensiveEvidence } from "@/lib/ai/comprehensive-evidence-audit";
import {
  createPersistedItunesEditionCoverBinding,
  type ItunesAlbumResult,
} from "@/lib/ai/itunes-enrichment";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import type {
  DiscogsJapanCdSearchResult,
  DiscogsJapanPhysicalSearchResult,
  DiscogsReleaseEvidence,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";
import type {
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";
import type { NdlClientResult, NdlRecord } from "@/lib/ndl/types";
import {
  findCuratedArtistDiscography,
  type CuratedArtistDiscography,
  type CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import type { OfficialMusicResearchResult } from "@/lib/official-music/types";
import type { SoundFujiArchiveResearchResult } from "@/lib/official-music/sound-fuji";

const releaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const request: ReleaseResearchRequest = {
  artistName: "Miho Nakayama",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

function releaseCandidate(overrides: Partial<ReleaseResearchCandidate> = {}): ReleaseResearchCandidate {
  return {
    id: `release-${releaseId}`,
    title: "CATCH THE NITE",
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "Miho Nakayama",
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
    format: "CD",
    catalogNumber: "K32X-240",
    barcode: "4988003002400",
    label: "King Records",
    originalPrice: null,
    editionType: null,
    isReissue: null,
    isRemaster: null,
    isExcludedByDefault: false,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    notes: null,
    confidence: "MEDIUM",
    warnings: [],
    sources: [
      {
        title: "MusicBrainz release group",
        url: `https://musicbrainz.org/release-group/${groupId}`,
        sourceType: "database",
      },
      {
        title: "MusicBrainz release",
        url: `https://musicbrainz.org/release/${releaseId}`,
        sourceType: "database",
      },
    ],
    verification: null,
    ...overrides,
  };
}

function comprehensiveCandidate(
  scope: "PASS" | "UNKNOWN" | "OUT_OF_SCOPE" = "PASS",
  overrides: Partial<ReleaseResearchCandidate> = {},
): ComprehensiveDiscographyCandidate {
  const candidate = releaseCandidate(overrides);
  return {
    candidate,
    workId: groupId,
    editionId: releaseId,
    observations: [
      {
        id: `musicbrainz:${releaseId}`,
        provider: "musicbrainz",
        role: "DISCOVERY",
        strength: "SUPPORTING",
        stage: "MUSICBRAINZ",
        verdict: "PASS",
        reasonCode: "MUSICBRAINZ_EDITION_DISCOVERED",
        reason: "MusicBrainz supplied the edition.",
        sourceUrl: `https://musicbrainz.org/release/${releaseId}`,
        matchedFields: ["title", "artist", "catalogNumber", "date", "format"],
      },
      {
        id: `scope:${releaseId}`,
        provider: "musicbrainz",
        role: "DISCOVERY",
        strength: "SUPPORTING",
        stage: "SCOPE",
        verdict: scope,
        reasonCode: `SCOPE_${scope}`,
        reason: `Scope is ${scope}.`,
        sourceUrl: null,
        matchedFields: [],
      },
    ],
    conflicts: [],
  };
}

function researchResult(): ReleaseResearchResult {
  return {
    artist: {
      name: "Miho Nakayama",
      nameKana: "なかやま みほ",
      nameRomaji: "Miho Nakayama",
      country: "JP",
      officialSiteUrl: "https://official.example/discography",
    },
    collectionScope: {
      target: request.target,
      excludeReissues: request.excludeReissues,
      includeCollaborations: request.includeCollaborations,
    },
    releases: [releaseCandidate()],
    globalWarnings: [],
    verificationSummary: null,
  };
}

function evidenceBundle(): ArtistReleaseEvidenceBundle {
  return {
    query: { artistName: request.artistName, targetCountry: "JP", target: request.target },
    artist: null,
    releases: [],
    sourceWhitelist: [],
    warnings: [],
    stats: {
      artistResultsInspected: 1,
      releasesFetched: 1,
      releasesAccepted: 1,
      coverLookups: 0,
    },
  };
}

function ndlRecord(title = "Miho Nakayama / CATCH THE NITE"): NdlRecord {
  return {
    recordId: "R100000002-I000008888764",
    sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
    title,
    creators: ["Miho Nakayama"],
    publishers: ["King Records"],
    issued: "1988-02-10",
    issuedRaw: "1988-02-10",
    issuedPrecision: "day",
    identifiers: ["K32X-240"],
    identifierDetails: [{ value: "K32X-240", scheme: null }],
    catalogNumbers: ["K32X-240"],
  };
}

function ndlResult(record: NdlRecord = ndlRecord()): NdlClientResult {
  return {
    value: {
      queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch",
      sourceTotal: 1,
      records: [record],
      complete: true,
    },
    warnings: [],
  };
}

function officialResult(candidateId: string): OfficialMusicResearchResult {
  return {
    candidates: [{
      candidateId,
      evidence: {
        candidateId,
        sourceType: "official",
        url: "https://official.example/discography/catch-the-nite",
        pageTitle: "CATCH THE NITE",
        evidenceScope: "structured-entity",
        matchedFields: ["catalogNumber", "title", "date"],
        observedDate: "1988-02-10",
        datePrecision: "day",
      },
    }],
    warnings: [],
    stats: {
      rootsAccepted: 1,
      pagesAttempted: 1,
      pagesFetched: 1,
      pagesDiscovered: 1,
      candidatesInspected: 1,
      candidatesMatched: 1,
      ambiguousCandidates: 0,
    },
  };
}

function discogsRow(id: number, overrides: Partial<DiscogsSearchReleaseEvidence> = {}): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: id,
    masterId: null,
    title: "Miho Nakayama - CATCH THE NITE",
    year: 1988,
    country: "Japan",
    formats: ["CD"],
    labels: ["King Records"],
    catalogNumber: "K32X-240",
    barcode: null,
    apiUrl: `https://api.discogs.com/releases/${id}`,
    sourceUrl: `https://www.discogs.com/release/${id}`,
    thumbnailUrl: null,
    coverImageUrl: null,
    ...overrides,
  };
}

function discogsSearch(rows: DiscogsSearchReleaseEvidence[]): DiscogsResult<DiscogsJapanCdSearchResult> {
  return {
    value: {
      evidenceRole: "corroborating-only",
      artistQuery: "Miho Nakayama",
      items: rows,
      sourceTotal: rows.length,
      pagesFetched: 1,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  };
}

function discogsDetail(id: number, primaryImageUrl: string | null): DiscogsReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: id,
    masterId: null,
    status: "Accepted",
    dataQuality: "Correct",
    title: "CATCH THE NITE",
    artistCredit: "Miho Nakayama",
    artists: [{ name: "Miho Nakayama", anv: null, join: null }],
    year: 1988,
    released: "1988-02-10",
    country: "Japan",
    labels: [{ name: "King Records", catalogNumber: "K32X-240" }],
    formats: [{ name: "CD", quantity: 1, descriptions: [] }],
    identifiers: [],
    barcodes: [],
    tracks: [],
    images: [],
    primaryImageUrl,
    displayImageUrl: null,
    apiUrl: `https://api.discogs.com/releases/${id}`,
    sourceUrl: `https://www.discogs.com/release/${id}`,
  };
}

function exactReleaseEvidence(
  overrides: Partial<MusicReleaseEvidence> = {},
): MusicReleaseEvidence {
  return {
    entityType: "release",
    sourceId: releaseId,
    releaseGroupId: groupId,
    title: "CATCH THE NITE",
    artistCredit: "Miho Nakayama",
    artistNames: ["Miho Nakayama"],
    artistAliases: [],
    date: "1988-02-10",
    type: "Album",
    secondaryTypes: [],
    country: "JP",
    label: "King Records",
    catalogNumber: "K32X-240",
    format: "CD",
    labels: [{ name: "King Records", catalogNumber: "K32X-240" }],
    formats: ["CD"],
    barcode: "4988003002400",
    status: "Official",
    sourceUrl: `https://musicbrainz.org/release/${releaseId}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [],
    ...overrides,
  };
}

function bundleWithRelease(
  evidence: MusicReleaseEvidence = exactReleaseEvidence(),
): ArtistReleaseEvidenceBundle {
  return {
    ...evidenceBundle(),
    releases: [{ evidence, warnings: [] }],
    discoveredEditions: [{
      workId: groupId,
      evidence,
      scope: { verdict: "PASS", reasonCodes: [] },
    }],
    works: [{
      workId: groupId,
      releaseGroup: null,
      editions: [{
        workId: groupId,
        evidence,
        scope: { verdict: "PASS", reasonCodes: [] },
      }],
    }],
  };
}

function validCover(url: string): CoverAssetValidationResult {
  return {
    ok: true,
    reason: "valid",
    retryable: false,
    attempts: 1,
    redirects: 0,
    status: 200,
    contentType: "image/jpeg",
    bytesRead: 10_000,
    sourceHost: new URL(url).hostname,
    finalHost: new URL(url).hostname,
    imageFormat: "jpeg",
    width: 600,
    height: 600,
    contentSha256: "a".repeat(64),
  };
}

function baseDependencies(
  rows: DiscogsSearchReleaseEvidence[] = [],
): ComprehensiveSourceAdapterDependencies {
  return {
    ndl: {
      searchArtistInventory: async () => ndlResult(),
      searchCatalogNumber: async () => ndlResult(),
    },
    researchOfficial: async (input: { candidates: Array<{ id: string }> }) =>
      officialResult(input.candidates[0]!.id),
    discogs: {
      searchJapanCdReleases: async () => discogsSearch(rows),
      getRelease: async (id: number) => ({
        value: discogsDetail(id, null),
        warnings: [],
        rateLimit: null,
      }),
    },
    musicMetadata: {
      getCoverArt: async () => ({ value: null, warnings: [] }),
    },
    validateCover: async (url: string | URL) => validCover(url.toString()),
    searchItunes: async (): Promise<ItunesAlbumResult[]> => [],
  };
}

function soundFujiResult(
  candidateIds: readonly string[],
  overrides: Partial<SoundFujiArchiveResearchResult> = {},
): SoundFujiArchiveResearchResult {
  const sourceUrl = "https://soundfuji.kingrecords.co.jp/release/1587/";
  return {
    status: "COMPLETE",
    applicable: true,
    complete: true,
    candidates: candidateIds.map((candidateId) => ({
      candidateId,
      outcome: "PASS",
      reasonCode: "OFFICIAL_LABEL_WORK_MATCH",
      evidence: {
        provider: "king-records-sound-fuji",
        sourceType: "official-label-archive",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        scope: "WORK",
        matchedFields: ["artist", "title"],
        sourceUrl,
        sourceUrls: [sourceUrl],
        observedTitle: "CATCH THE NITE",
        observedArtist: "中山美穂",
        observedKind: "ALBUM",
        cover: {
          provider: "king-records-sound-fuji",
          scope: "WORK",
          matchLevel: "WORK_EXACT",
          url: "https://soundfuji.kingrecords.co.jp/shared/img/2024/06/NOPA-2409.jpg",
          sourceUrl,
        },
      },
    })),
    warnings: [],
    stats: {
      indexPagesFetched: 25,
      indexRecords: 2_481,
      detailPagesFetched: 1,
      cacheHits: 0,
      candidatesInspected: candidateIds.length,
      candidatesMatched: candidateIds.length,
      ambiguousCandidates: 0,
    },
    ...overrides,
  };
}

function curatedSyntheticCandidate(input: {
  title: string;
  category: "SINGLE" | "ORIGINAL_ALBUM";
  key: string;
  scopeReason: "OFFICIAL_CD_MANIFEST_WORK_SCOPE" | "CURATED_LATER_OFFICIAL_CD_CONFIRMED";
  physicalCd: "LEGACY_CONFIRMED" | "LATER_OFFICIAL_EDITION";
  representationKind: "WORK_ONLY" | "CONTAINER_INCLUSION";
  releaseDate?: string | null;
  catalogNumber?: string | null;
  containerTitle?: string | null;
  manifestArtistCredits?: string;
  candidateArtistCredit?: string;
}) {
  const provider = "curated-official-manifest:miho-test";
  const candidate = comprehensiveCandidate("PASS", {
    id: `curated-miho-test-${input.key.toLowerCase().replace(":", "-")}`,
    title: input.title,
    category: input.category,
    artistCredit: input.candidateArtistCredit ?? "Miho Nakayama",
    releaseDate: input.releaseDate ?? null,
    originalReleaseDate: input.category === "SINGLE" ? "1985-09-21" : "1988-02-10",
    catalogNumber: input.catalogNumber ?? null,
    label: "King Records",
    format: "CD (official canonical-work representation)",
    editionType: input.representationKind === "CONTAINER_INCLUSION"
      ? "LATER_OFFICIAL_CD_REPRESENTATION"
      : "OFFICIAL_COMPLETE_CATALOGUE_REPRESENTATION",
    sources: [{
      title: "Official canonical discography manifest",
      url: "https://official.example/miho/manifest",
      sourceType: "official",
    }],
  });
  candidate.workId = `${provider}:${input.key}`;
  candidate.editionId = `${provider}:representation:${input.key}`;
  candidate.observations = [
    {
      id: `${provider}:authority:${input.key}`,
      provider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "Canonical manifest work identity.",
      sourceUrl: "https://official.example/miho/manifest",
      matchedFields: ["artist", "title", "category"],
      facts: {
        artist: "中山美穂",
        artistCredits: input.manifestArtistCredits ?? "Miho Nakayama",
        title: input.title,
        category: input.category,
        date: candidate.candidate.originalReleaseDate,
        manifestEntryKey: input.key,
      },
    },
    {
      id: `${provider}:scope:${input.key}`,
      provider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: input.scopeReason,
      reason: "Canonical physical-CD scope.",
      sourceUrl: "https://official.example/miho/manifest",
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        country: "JP",
        format: "CD",
        physicalCd: input.physicalCd,
        physicalCdReleaseDate: input.releaseDate ?? null,
        physicalCdCatalogNumber: input.catalogNumber ?? null,
        physicalCdRepresentationKind: input.representationKind,
        physicalCdContainerTitle: input.containerTitle ?? null,
        manifestEntryKey: input.key,
      },
    },
    {
      id: `discogs:curated-original:${input.key}`,
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
      reason: "Unique complete original-work inventory binding.",
      sourceUrl: "https://www.discogs.com/release/700",
      matchedFields: ["artist", "title", "category", "originalYear"],
      facts: {
        artist: "Miho Nakayama",
        boundArtistCredit: "Miho Nakayama",
        canonicalArtist: "中山美穂",
        canonicalTitle: input.title,
        category: input.category,
        originalYear: candidate.candidate.originalReleaseDate!.slice(0, 4),
        manifestEntryKey: input.key,
        uniqueBinding: "true",
        inventoryComplete: "true",
      },
    },
  ];
  candidate.conflicts = [];
  return candidate;
}

test("adapts NDL and official evidence as strong authority and Discogs as corroboration", async () => {
  const candidate = comprehensiveCandidate();
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, baseDependencies([discogsRow(1), discogsRow(2)]));

  const enriched = prepared.candidates[0]!;
  assert.equal(enriched.observations.some((item) =>
    item.provider === "ndl-search" && item.role === "AUTHORITATIVE" && item.verdict === "PASS"), true);
  assert.equal(enriched.observations.some((item) =>
    item.provider === "official-catalog" && item.role === "AUTHORITATIVE" && item.verdict === "PASS"), true);
  const discogs = enriched.observations.find((item) => item.provider === "discogs");
  assert.equal(discogs?.verdict, "PASS");
  assert.equal(discogs?.reasonCode, "DISCOGS_MULTIPLE_EXACT_EDITIONS");
  assert.equal(prepared.sourceStats.ndlMatched, 1);
  assert.equal(prepared.sourceStats.officialMatched, 1);
  assert.equal(prepared.sourceStats.discogsMatched, 1);
});

test("adapts an exact SOUND FUJI work match as authority and a validated WORK cover", async () => {
  const dependencies = baseDependencies([]);
  let coverArtArchiveCalls = 0;
  dependencies.musicMetadata = {
    getCoverArt: async () => {
      coverArtArchiveCalls += 1;
      return { value: null, warnings: [] };
    },
  };
  dependencies.researchSoundFuji = async (input) => {
    assert.deepEqual(input.candidates.map((candidate) => candidate.id), [groupId]);
    return soundFujiResult([groupId]);
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);

  const enriched = prepared.candidates[0]!;
  assert.equal(enriched.observations.some((item) =>
    item.provider === "king-records-sound-fuji" &&
    item.reasonCode === "OFFICIAL_LABEL_WORK_MATCH" &&
    item.verdict === "PASS"), true);
  const cover = await prepared.lookupValidatedCover(enriched);
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "official-label");
  assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "WORK");
  assert.equal(cover.status === "FOUND" ? cover.sourceReleaseDate : null, "1988-02-10");
  assert.equal(coverArtArchiveCalls, 0, "an exact official work cover avoids a redundant CAA request");
  assert.equal(prepared.sourceStats.soundFujiMatched, 1);
  assert.equal(prepared.sourceStats.soundFujiCovers, 1);
});

test("a locked curated work-only representation stays pending without a physical edition", async () => {
  const candidate = curatedSyntheticCandidate({
    title: "CATCH THE NITE",
    category: "ORIGINAL_ALBUM",
    key: "ORIGINAL_ALBUM:1",
    scopeReason: "OFFICIAL_CD_MANIFEST_WORK_SCOPE",
    physicalCd: "LEGACY_CONFIRMED",
    representationKind: "WORK_ONLY",
  });
  const dependencies = baseDependencies([]);
  dependencies.researchSoundFuji = async (input) =>
    soundFujiResult(input.candidates.map((item) => item.id));
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, dependencies);
  const enriched = prepared.candidates[0]!;
  assert.equal(enriched.observations.some((item) =>
    item.reasonCode === "OFFICIAL_LABEL_WORK_MATCH" &&
    item.facts?.manifestEntryKey === "ORIGINAL_ALBUM:1"), true);
  assert.equal(enriched.observations.some((item) =>
    item.reasonCode === "DISCOGS_EXACT_EDITION_NOT_FOUND"), false);
  assert.equal(classifyComprehensiveEvidence({
    candidateId: enriched.candidate.id,
    workId: enriched.workId,
    editionId: enriched.editionId,
    title: enriched.candidate.title,
    artistCredit: enriched.candidate.artistCredit,
    observations: enriched.observations,
    conflicts: enriched.conflicts,
  }).eligibleForAi, false);
});

test("a declared compilation carrier binds its tuple without becoming a work-title conflict or cover", async () => {
  const candidate = curatedSyntheticCandidate({
    title: "Canonical Single",
    category: "SINGLE",
    key: "SINGLE:2",
    scopeReason: "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
    physicalCd: "LATER_OFFICIAL_EDITION",
    representationKind: "CONTAINER_INCLUSION",
    releaseDate: "2020-12-23",
    catalogNumber: "KICS-93968～70",
    containerTitle: "All Time Best",
    manifestArtistCredits: "",
    candidateArtistCredit: "中山美穂",
  });
  const row = discogsRow(702, {
    title: "Miho Nakayama - All Time Best",
    year: 2020,
    masterId: 900,
    formats: ["CD", "Compilation"],
    // Discogs uses a slash for the same complete range that the official
    // declaration writes with a wave dash.
    catalogNumber: "KICS-93968/70",
    coverImageUrl: "https://i.discogs.com/container-cover.jpeg",
  });
  const earlierMasterEdition = discogsRow(701, {
    title: "Miho Nakayama - All Time Best",
    year: 2010,
    masterId: 900,
    formats: ["CD", "Compilation"],
    catalogNumber: "KICS-80000",
  });
  const supplementalShadow = comprehensiveCandidate("PASS", {
    id: "discogs-release-702",
    title: "All Time Best",
    category: "COLLECTION",
    artistCredit: "Miho Nakayama",
    releaseDate: "2020",
    originalReleaseDate: null,
    format: "CD, Compilation",
    catalogNumber: "KICS-93968/70",
    coverImageUrl: null,
    coverImageSourceUrl: null,
    sources: [{
      title: "Discogs release",
      url: row.sourceUrl,
      sourceType: "database",
    }],
  });
  supplementalShadow.workId = "discogs-master:900";
  supplementalShadow.editionId = "discogs:702";
  supplementalShadow.observations = supplementalShadow.observations.filter((item) =>
    item.stage !== "MUSICBRAINZ");
  let detailCalls = 0;
  const dependencies = baseDependencies([earlierMasterEdition, row]);
  dependencies.discogs!.getRelease = async () => {
    detailCalls += 1;
    return {
      value: discogsDetail(row.releaseId, "https://i.discogs.com/container-cover.jpeg"),
      warnings: [],
      rateLimit: null,
    };
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate, supplementalShadow],
  }, dependencies);
  const enriched = prepared.candidates.find((item) =>
    item.candidate.id === candidate.candidate.id)!;
  const shadow = prepared.candidates.find((item) =>
    item.candidate.id === supplementalShadow.candidate.id)!;
  const carrier = enriched.observations.find((item) =>
    item.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH");
  assert.equal(carrier?.facts?.carrierTitle, "All Time Best");
  assert.equal(carrier?.facts?.catalogNumber, "KICS-93968/70");
  assert.equal(carrier?.facts?.manifestEntryKey, "SINGLE:2");
  assert.equal(carrier?.facts?.uniqueBinding, "true");
  assert.equal(shadow.observations.some((item) =>
    item.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH"), false);
  assert.equal(shadow.observations.some((item) =>
    item.reasonCode === "DISCOGS_LATER_MASTER_EDITION_OUT_OF_SCOPE" &&
    item.verdict === "OUT_OF_SCOPE"), true);
  assert.equal(enriched.conflicts.some((item) => item.reasonCode === "TITLE_CONFLICT"), false);
  const carrierReadiness = classifyComprehensiveEvidence({
    candidateId: enriched.candidate.id,
    workId: enriched.workId,
    editionId: enriched.editionId,
    title: enriched.candidate.title,
    artistCredit: enriched.candidate.artistCredit,
    observations: enriched.observations,
    conflicts: enriched.conflicts,
  });
  assert.equal(carrierReadiness.eligibleForAi, true, JSON.stringify({
    carrierReadiness,
    outOfScope: enriched.observations.filter((item) => item.verdict === "OUT_OF_SCOPE"),
  }));
  const cover = await prepared.lookupValidatedCover(enriched);
  assert.equal(cover.status, "MISSING");
  assert.equal(detailCalls, 0, "the container artwork is never used as canonical work artwork");
});

test("declared carrier matching fails closed for wrong identity or an ambiguous tuple", async (t) => {
  const candidate = () => curatedSyntheticCandidate({
    title: "Canonical Single",
    category: "SINGLE",
    key: "SINGLE:2",
    scopeReason: "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
    physicalCd: "LATER_OFFICIAL_EDITION",
    representationKind: "CONTAINER_INCLUSION",
    releaseDate: "2020-12-23",
    catalogNumber: "KICS-93968～70",
    containerTitle: "All Time Best",
  });
  const exact = discogsRow(710, {
    title: "Miho Nakayama - All Time Best",
    year: 2020,
    formats: ["CD", "Compilation"],
    catalogNumber: "KICS-93968～70",
  });
  const cases: Array<[string, DiscogsSearchReleaseEvidence[]]> = [
    ["multi artist", [{ ...exact, title: "Miho Nakayama & Other Artist - All Time Best" }]],
    ["wrong container title", [{ ...exact, title: "Miho Nakayama - Different Box" }]],
    ["wrong year", [{ ...exact, year: 2021 }]],
    ["wrong catalog", [{ ...exact, catalogNumber: "KICS-00000" }]],
    ["range tail instead of product head", [{ ...exact, catalogNumber: "KICS-93970" }]],
    ["reversed range", [{ ...exact, catalogNumber: "KICS-93970/68" }]],
    ["expanded range", [{ ...exact, catalogNumber: "KICS-93968/71" }]],
    ["different normal-edition range", [{ ...exact, catalogNumber: "KICS-3968/70" }]],
    ["non-CD carrier", [{ ...exact, formats: ["Vinyl", "Compilation"] }]],
    ["promotional CD", [{ ...exact, formats: ["CD", "Compilation", "Promo"] }]],
    ["ambiguous duplicate tuple", [exact, { ...exact, releaseId: 711 }]],
  ];
  for (const [name, rows] of cases) {
    await t.test(name, async () => {
      const prepared = await prepareComprehensiveSourceEvidence({
        request,
        result: researchResult(),
        bundle: evidenceBundle(),
        candidates: [candidate()],
      }, baseDependencies(rows));
      const enriched = prepared.candidates[0]!;
      assert.equal(enriched.observations.some((item) =>
        item.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH"), false);
      assert.equal(enriched.observations.some((item) =>
        item.reasonCode === "DISCOGS_CURATED_CARRIER_NOT_FOUND"), true);
      assert.equal(classifyComprehensiveEvidence({
        candidateId: enriched.candidate.id,
        workId: enriched.workId,
        editionId: enriched.editionId,
        title: enriched.candidate.title,
        artistCredit: enriched.candidate.artistCredit,
        observations: enriched.observations,
        conflicts: enriched.conflicts,
      }).eligibleForAi, false);
    });
  }
});

function exactMihoWork(title: string, category: "SINGLE" | "ORIGINAL_ALBUM") {
  const manifest = findCuratedArtistDiscography(null, ["中山美穂"]);
  const work = manifest?.works.find((candidate) =>
    candidate.category === category && candidate.title === title);
  assert.ok(manifest && work);
  return { manifest, work };
}

function mihoOriginalPhysicalRow(
  releaseId: number,
  title: string,
  year: number,
  formats: string[],
  catalogNumber: string,
  masterId: number,
) {
  return discogsRow(releaseId, {
    masterId,
    title: `Miho Nakayama - ${title}`,
    year,
    formats,
    catalogNumber,
  });
}

async function prepareMihoDeclaredCarrierFixture(input: {
  title: string;
  category: "SINGLE" | "ORIGINAL_ALBUM";
  physicalRows: DiscogsSearchReleaseEvidence[];
  cdRows: DiscogsSearchReleaseEvidence[];
  existing: boolean;
  existingReleaseDate?: string;
}) {
  const { manifest, work } = exactMihoWork(input.title, input.category);
  const workId = `90000000-0000-4000-8000-${String(work.ordinal).padStart(12, "0")}`;
  const existingCandidate = input.existing
    ? comprehensiveCandidate("PASS", {
        id: `miho-existing-${input.category.toLowerCase()}-${work.ordinal}`,
        title: work.title,
        category: work.category,
        artistCredit: "中山美穂",
        releaseDate: input.existingReleaseDate ?? work.originalReleaseDate,
        originalReleaseDate: work.originalReleaseDate,
        format: input.category === "SINGLE" ? "Vinyl" : "CD",
        catalogNumber: null,
      })
    : null;
  if (existingCandidate) {
    existingCandidate.workId = workId;
    existingCandidate.editionId = `musicbrainz-existing:${workId}`;
  }
  const bundle: ArtistReleaseEvidenceBundle = {
    ...evidenceBundle(),
    query: { artistName: "Miho Nakayama", targetCountry: "JP", target: "ORIGINAL_CD" },
    works: input.existing ? [{
      workId,
      editions: [],
      releaseGroup: {
        entityType: "release-group",
        sourceId: workId,
        releaseGroupId: null,
        title: work.title,
        artistCredit: "Miho Nakayama",
        artistNames: ["Miho Nakayama"],
        artistAliases: [],
        date: input.existingReleaseDate ?? work.originalReleaseDate,
        type: input.category === "SINGLE" ? "Single" : "Album",
        secondaryTypes: [],
        country: "JP",
        label: "King Records",
        catalogNumber: null,
        format: null,
        labels: [{ name: "King Records", catalogNumber: null }],
        formats: [],
        barcode: null,
        status: "Official",
        sourceUrl: `https://musicbrainz.org/release-group/${workId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [],
      },
    }] : [],
  };
  const dependencies = baseDependencies(input.cdRows);
  dependencies.searchJapanPhysicalReleases = async (query) => ({
    value: {
      evidenceRole: "corroborating-only",
      artistQuery: query,
      items: input.physicalRows,
      sourceTotal: input.physicalRows.length,
      pagesFetched: 1,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle,
    candidates: existingCandidate ? [existingCandidate] : [],
  }, {
    ...dependencies,
    useCuratedManifests: true,
    findCuratedDiscography: () => ({
      ...manifest,
      catalogStatus: undefined,
      baselines: undefined,
      works: [work],
    }),
    limits: {
      maxScopeCandidates: 10,
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: 1,
      maxCuratedPhysicalQueries: 1,
      maxCuratedPhysicalPagesPerQuery: 1,
      maxCuratedPhysicalItemsPerQuery: 20,
      maxDiscogsCoverDetailsPerCandidate: 0,
      maxItunesTitleLookups: 0,
    },
  });
  const candidate = prepared.candidates.find((item) => item.editionId ===
    `curated-official-manifest:miho-nakayama:representation:${work.category}:${work.ordinal}`);
  assert.ok(candidate);
  if (existingCandidate && candidate.candidate.id !== existingCandidate.candidate.id) {
    const original = prepared.candidates.find((item) =>
      item.candidate.id === existingCandidate.candidate.id);
    assert.ok(original);
    assert.equal(original.editionId, `musicbrainz-existing:${workId}`);
    assert.equal(original.candidate.releaseDate, existingCandidate.candidate.releaseDate);
  }
  return { candidate, work };
}

test("the three Miho carrier singles bind the exact All Time Best tuple on existing and synthetic paths", async () => {
  const cases = [
    {
      title: "BE-BOP-HIGHSCHOOL",
      original: mihoOriginalPhysicalRow(
        12_914_286,
        "BE-BOP-HIGHSCHOOL",
        1985,
        ["Vinyl", "Single"],
        "K07S-10071",
        501,
      ),
      existing: true,
    },
    {
      title: "ツイてるねノッてるね",
      original: mihoOriginalPhysicalRow(
        3_599_317,
        "ツイてるねノッてるね",
        1986,
        ["Vinyl", "Single"],
        "K07S-10131",
        502,
      ),
      existing: false,
    },
    {
      title: "VIRGIN EYES",
      original: mihoOriginalPhysicalRow(
        13_031_606,
        "VIRGIN EYES",
        1989,
        ["Cassette", "Single"],
        "091X-10010",
        503,
      ),
      existing: false,
    },
  ] as const;
  for (const item of cases) {
    const carrier = discogsRow(21_870_289, {
      masterId: 2_187_000,
      title: "Miho Nakayama - All Time Best",
      year: 2020,
      formats: ["CD", "Compilation"],
      catalogNumber: "KICS-93968/70",
    });
    const { candidate, work } = await prepareMihoDeclaredCarrierFixture({
      title: item.title,
      category: "SINGLE",
      physicalRows: [item.original],
      cdRows: [carrier],
      existing: item.existing,
    });
    assert.equal(candidate.candidate.releaseDate, "2020-12-23", item.title);
    assert.equal(candidate.candidate.catalogNumber, "KICS-93968～70", item.title);
    assert.equal(candidate.candidate.format, "CD (official canonical-work representation)", item.title);
    assert.equal(candidate.candidate.editionType, "LATER_OFFICIAL_CD_REPRESENTATION", item.title);
    assert.equal(candidate.candidate.isReissue, true, item.title);
    assert.equal(
      candidate.editionId,
      `curated-official-manifest:miho-nakayama:representation:SINGLE:${work.ordinal}`,
      item.title,
    );
    const observed = candidate.observations.find((entry) =>
      entry.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH");
    assert.ok(observed, JSON.stringify(candidate.observations.map((entry) => ({
      provider: entry.provider,
      stage: entry.stage,
      verdict: entry.verdict,
      reasonCode: entry.reasonCode,
      facts: entry.facts,
    }))));
    assert.deepEqual({
      carrierTitle: observed?.facts?.carrierTitle,
      catalogNumber: observed?.facts?.catalogNumber,
      year: observed?.facts?.year,
      representationKind: observed?.facts?.physicalCdRepresentationKind,
      uniqueBinding: observed?.facts?.uniqueBinding,
      fields: observed?.matchedFields,
    }, {
      carrierTitle: "All Time Best",
      catalogNumber: "KICS-93968/70",
      year: "2020",
      representationKind: "CONTAINER_INCLUSION",
      uniqueBinding: "true",
      fields: ["artist", "catalogNumber", "year", "country", "format"],
    }, item.title);
  }
});

test("the three Miho carrier singles reject wrong, reversed, and normal-edition catalog tuples", async () => {
  const works = [
    ["BE-BOP-HIGHSCHOOL", 12_914_286, 1985, "K07S-10071", 601],
    ["ツイてるねノッてるね", 3_599_317, 1986, "K07S-10131", 602],
    ["VIRGIN EYES", 13_031_606, 1989, "091X-10010", 603],
  ] as const;
  for (const [title, releaseId, year, originalCatalog, masterId] of works) {
    const physical = mihoOriginalPhysicalRow(
      releaseId,
      title,
      year,
      title === "VIRGIN EYES" ? ["Cassette", "Single"] : ["Vinyl", "Single"],
      originalCatalog,
      masterId,
    );
    const invalidCarriers = [
      [21_870_290, "KICS-00000"],
      [21_870_291, "KICS-93970/68"],
      [28_520_134, "KICS-3968/70"],
    ] as const;
    const { candidate } = await prepareMihoDeclaredCarrierFixture({
      title,
      category: "SINGLE",
      physicalRows: [physical],
      cdRows: invalidCarriers.map(([id, catalogNumber]) => discogsRow(id, {
        title: "Miho Nakayama - All Time Best",
        year: 2020,
        formats: ["CD", "Compilation"],
        catalogNumber,
      })),
      existing: false,
    });
    assert.equal(candidate.observations.some((entry) =>
      entry.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH"), false, title);
    assert.equal(candidate.observations.some((entry) =>
      entry.reasonCode === "DISCOGS_CURATED_CARRIER_NOT_FOUND"), true, title);
  }
});

const AKINA_TEST_NAME = "\u4e2d\u68ee\u660e\u83dc";

function akinaBoxWork(ordinal: number): CuratedDiscographyWork {
  return {
    ordinal,
    title: `Test Single ${ordinal}`,
    aliases: [],
    category: "SINGLE",
    originalReleaseDate: `1982-01-${String(ordinal).padStart(2, "0")}`,
    authorityUrls: ["https://wmg.jp/akina/discography/11915/"],
    authorityAsOf: "2026-07-13",
    mediaScope: {
      originalFormats: ["VINYL"],
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdCountry: "JP",
      physicalCdAuthorityUrls: ["https://wmg.jp/akina/discography/11915/"],
      physicalCdReleaseDate: "2014-06-18",
      physicalCdCatalogNumber: "WPCL-11871/98",
      physicalCdRepresentationKind: "CONTAINER_INCLUSION",
      physicalCdContainerTitle: "Singles Box 1982-1991",
      exclusionReason: null,
    },
  };
}

function exactAkinaBoxRow(
  overrides: Partial<DiscogsSearchReleaseEvidence> = {},
): DiscogsSearchReleaseEvidence {
  return discogsRow(17_604_979, {
    title: `${AKINA_TEST_NAME} - Akina Nakamori Singles Box 1982-1991`,
    year: 2014,
    formats: ["CD", "Single", "Reissue", "Remastered", "Box Set", "Compilation"],
    labels: ["Warner Music Japan", "Warner Music Japan Inc."],
    catalogNumber: "WPCL-11871/98 (WQCQ-536/63)",
    barcode: "4943674180035",
    ...overrides,
  });
}

async function prepareAkinaBoxFixture(boxRows: DiscogsSearchReleaseEvidence[]) {
  const works = Array.from({ length: 22 }, (_, index) => akinaBoxWork(index + 1));
  const manifest: CuratedArtistDiscography = {
    slug: "akina-nakamori",
    canonicalName: AKINA_TEST_NAME,
    aliases: ["Akina Nakamori"],
    musicBrainzArtistId: "30000000-0000-4000-8000-000000000031",
    country: "JP",
    works,
  };
  const physicalRows = works.map((work) => discogsRow(18_000_000 + work.ordinal, {
    masterId: 19_000_000 + work.ordinal,
    title: `${AKINA_TEST_NAME} - ${work.title}`,
    year: 1982,
    formats: ["Vinyl", "7\"", "Single"],
    catalogNumber: `L-${1600 + work.ordinal}`,
  }));
  const dependencies = baseDependencies(boxRows);
  dependencies.searchJapanPhysicalReleases = async (artistQuery) => ({
    value: {
      evidenceRole: "corroborating-only",
      artistQuery,
      items: physicalRows,
      sourceTotal: physicalRows.length,
      pagesFetched: 1,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  });
  const fixtureRequest: ReleaseResearchRequest = { ...request, artistName: AKINA_TEST_NAME };
  const fixtureResult: ReleaseResearchResult = {
    ...researchResult(),
    artist: {
      name: AKINA_TEST_NAME,
      nameKana: null,
      nameRomaji: "Akina Nakamori",
      country: "JP",
      officialSiteUrl: "https://wmg.jp/akina/",
    },
    releases: [],
  };
  return prepareComprehensiveSourceEvidence({
    request: fixtureRequest,
    result: fixtureResult,
    bundle: {
      ...evidenceBundle(),
      query: { artistName: AKINA_TEST_NAME, targetCountry: "JP", target: "ORIGINAL_CD" },
    },
    candidates: [],
  }, {
    ...dependencies,
    useCuratedManifests: true,
    findCuratedDiscography: () => manifest,
    limits: {
      maxScopeCandidates: 30,
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: 1,
      maxCuratedPhysicalQueries: 1,
      maxCuratedPhysicalPagesPerQuery: 1,
      maxCuratedPhysicalItemsPerQuery: 100,
      maxDiscogsCoverDetailsPerCandidate: 0,
      maxItunesTitleLookups: 0,
    },
  });
}

test("the exact Akina Singles Box row binds 22 independent synthetic container representations", async () => {
  const prepared = await prepareAkinaBoxFixture([exactAkinaBoxRow()]);
  const carriers = prepared.candidates.filter((candidate) =>
    /^curated-official-manifest:akina-nakamori:representation:SINGLE:\d+$/u.test(
      candidate.editionId,
    ));
  assert.equal(carriers.length, 22);
  for (const candidate of carriers) {
    assert.equal(candidate.candidate.releaseDate, "2014-06-18");
    assert.equal(candidate.candidate.catalogNumber, "WPCL-11871/98");
    const carrier = candidate.observations.find((observation) =>
      observation.reasonCode === "AKINA_DISCOGS_CANONICAL_WORK_CARRIER_MATCH");
    assert.ok(carrier, candidate.candidate.title);
    assert.equal(carrier.facts?.barcode, "4943674180035");
    assert.equal(carrier.facts?.uniqueCarrierEntity, "true");
    assert.deepEqual(classifyComprehensiveEvidence({
      candidateId: candidate.candidate.id,
      workId: candidate.workId,
      editionId: candidate.editionId,
      title: candidate.candidate.title,
      artistCredit: candidate.candidate.artistCredit,
      observations: candidate.observations,
      conflicts: candidate.conflicts,
    }), {
      verdict: "PASS",
      reasonCode: "EVIDENCE_READY",
      eligibleForAi: true,
    }, candidate.candidate.title);
  }
});

test("the Akina Singles Box bridge fails closed on every carrier-boundary mismatch", async (t) => {
  const exact = exactAkinaBoxRow();
  const cases: Array<[string, DiscogsSearchReleaseEvidence[]]> = [
    ["wrong title", [{ ...exact, title: `${AKINA_TEST_NAME} - Singles Box 1982-1990` }]],
    ["wrong catalog", [{ ...exact, catalogNumber: "WPCL-11872/98 (WQCQ-536/63)" }]],
    ["wrong barcode", [{ ...exact, barcode: "4943674180036" }]],
    ["wrong country", [{
      ...exact,
      country: "United States",
    } as unknown as DiscogsSearchReleaseEvidence]],
    ["wrong year", [{ ...exact, year: 2015 }]],
    ["missing box format", [{ ...exact, formats: ["CD", "Single", "Compilation"] }]],
    ["duplicate exact source", [exact, {
      ...exact,
      releaseId: 17_604_980,
      sourceUrl: "https://www.discogs.com/release/17604980",
      apiUrl: "https://api.discogs.com/releases/17604980",
    }]],
  ];
  for (const [name, rows] of cases) {
    await t.test(name, async () => {
      const prepared = await prepareAkinaBoxFixture(rows);
      const candidate = prepared.candidates.find((item) => item.editionId ===
        "curated-official-manifest:akina-nakamori:representation:SINGLE:1");
      assert.ok(candidate);
      assert.equal(candidate.observations.some((observation) =>
        observation.reasonCode === "AKINA_DISCOGS_CANONICAL_WORK_CARRIER_MATCH"), false);
      assert.deepEqual(classifyComprehensiveEvidence({
        candidateId: candidate.candidate.id,
        workId: candidate.workId,
        editionId: candidate.editionId,
        title: candidate.candidate.title,
        artistCredit: candidate.candidate.artistCredit,
        observations: candidate.observations,
        conflicts: candidate.conflicts,
      }), {
        verdict: "UNKNOWN",
        reasonCode: "MISSING_DECLARED_CARRIER",
        eligibleForAi: false,
      });
    });
  }
});

test("Mellow preserves the original work date and creates one exact later-CD representation", async () => {
  const cd = mihoOriginalPhysicalRow(
    8_822_822,
    "Mellow",
    2015,
    ["CD", "Album"],
    "KICS3274",
    9200,
  );
  const cassette = mihoOriginalPhysicalRow(
    22_022_713,
    "Mellow",
    1992,
    ["Cassette", "Album"],
    "KITX-140",
    9200,
  );
  cassette.coverImageUrl = "https://i.discogs.com/mellow-cassette.jpg";
  const { candidate, work } = await prepareMihoDeclaredCarrierFixture({
    title: "Mellow",
    category: "ORIGINAL_ALBUM",
    physicalRows: [cassette, cd],
    cdRows: [cd],
    existing: true,
    existingReleaseDate: "1992",
  });
  assert.equal(candidate.candidate.releaseDate, "2015-10-14");
  assert.equal(candidate.candidate.originalReleaseDate, "1992-06-10");
  assert.equal(candidate.candidate.catalogNumber, "KICS-3274");
  assert.equal(candidate.candidate.format, "CD (official canonical-work representation)");
  assert.equal(candidate.candidate.editionType, "LATER_OFFICIAL_CD_REPRESENTATION");
  assert.equal(candidate.candidate.isReissue, true);
  assert.equal(
    candidate.editionId,
    `curated-official-manifest:miho-nakayama:representation:ORIGINAL_ALBUM:${work.ordinal}`,
  );
  const original = candidate.observations.find((entry) =>
    entry.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH");
  assert.equal(original?.sourceUrl, "https://www.discogs.com/release/22022713");
  assert.equal(original?.facts?.catalogNumber, "KITX-140");
  assert.equal(original?.facts?.formats, "Cassette, Album");
  const carrier = candidate.observations.find((entry) =>
    entry.reasonCode === "CURATED_CANONICAL_WORK_CARRIER_MATCH");
  assert.ok(carrier, JSON.stringify(candidate.observations.map((entry) => ({
    provider: entry.provider,
    stage: entry.stage,
    verdict: entry.verdict,
    reasonCode: entry.reasonCode,
    facts: entry.facts,
  }))));
  assert.deepEqual({
    carrierTitle: carrier?.facts?.carrierTitle,
    catalogNumber: carrier?.facts?.catalogNumber,
    year: carrier?.facts?.year,
    representationKind: carrier?.facts?.physicalCdRepresentationKind,
    fields: carrier?.matchedFields,
  }, {
    carrierTitle: "Mellow",
    catalogNumber: "KICS3274",
    year: "2015",
    representationKind: "SAME_WORK_EDITION",
    fields: ["artist", "title", "catalogNumber", "year", "country", "format"],
  });
  assert.equal(candidate.candidate.sources.some((source) =>
    source.url === "https://www.kingrecords.co.jp/cs/g/gKICS-3274/"), true);
});

test("an exact official work page securely bridges a later Discogs CD to its MusicBrainz work", async () => {
  const musicBrainz = comprehensiveCandidate("PASS", {
    title: "CATCH THE NITE",
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
  });
  const discogsEdition: ComprehensiveDiscographyCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "discogs-release-999",
      title: "CATCH THE NITE",
      releaseDate: "2015-09-16",
      originalReleaseDate: null,
      catalogNumber: "KICS-9999",
      sources: [{
        title: "Discogs release",
        url: "https://www.discogs.com/release/999",
        sourceType: "database",
      }],
    }),
    workId: "discogs-master:999",
    editionId: "discogs-release:999",
  };
  discogsEdition.observations = discogsEdition.observations.filter((item) =>
    item.stage !== "MUSICBRAINZ");
  const dependencies = baseDependencies([]);
  dependencies.researchSoundFuji = async (input) =>
    soundFujiResult(input.candidates.map((candidate) => candidate.id));
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [musicBrainz, discogsEdition],
  }, dependencies);

  const bridged = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "discogs-release-999");
  assert.equal(bridged?.workId, groupId);
  assert.equal(bridged?.candidate.originalReleaseDate, "1988-02-10");
  assert.equal(bridged?.candidate.sources.some((source) =>
    source.url === `https://musicbrainz.org/release-group/${groupId}`), true);
});

test("an exact official bridge propagates one canonical manifest identity over conflicting provider metadata", async () => {
  const musicBrainz = comprehensiveCandidate("PASS", {
    title: "CATCH THE NITE",
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
  });
  const canonical: ComprehensiveDiscographyCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "curated-catch-the-nite",
      title: "CATCH THE NITE",
      releaseDate: null,
      originalReleaseDate: "1988-02-12",
      catalogNumber: null,
      sources: [{
        title: "Official canonical discography manifest",
        url: "https://official.example/discography/catch-the-nite",
        sourceType: "official",
      }, {
        title: "Unrelated MusicBrainz edition",
        url: "https://musicbrainz.org/release/99999999-9999-4999-8999-999999999999",
        sourceType: "database",
      }, {
        title: "Unrelated Discogs edition",
        url: "https://www.discogs.com/release/99999999",
        sourceType: "database",
      }],
    }),
    workId: "curated-official-manifest:miho-test:ORIGINAL_ALBUM:1",
    editionId: "curated-official-manifest:miho-test:representation:ORIGINAL_ALBUM:1",
  };
  canonical.observations = [
    ...canonical.observations.filter((entry) => entry.stage !== "MUSICBRAINZ"),
    {
      id: "curated-authority",
      provider: "curated-official-manifest:miho-test",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "The official manifest fixes the canonical work date.",
      sourceUrl: "https://official.example/discography/catch-the-nite",
      matchedFields: ["artist", "title", "category"],
      facts: {
        artist: "中山美穂",
        title: "CATCH THE NITE",
        category: "ORIGINAL_ALBUM",
        date: "1988-02-12",
        manifestEntryKey: "ORIGINAL_ALBUM:1",
      },
    },
    {
      id: "curated-scope",
      provider: "curated-official-manifest:miho-test",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: "OFFICIAL_CD_MANIFEST_WORK_SCOPE",
      reason: "The versioned manifest confirms a CD representation.",
      sourceUrl: "https://official.example/discography/catch-the-nite",
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        manifestEntryKey: "ORIGINAL_ALBUM:1",
        format: "CD",
        physicalCd: "LEGACY_CONFIRMED",
        originalFormats: "LEGACY_CD_MANIFEST",
      },
    },
  ];
  const dependencies = baseDependencies([]);
  dependencies.researchSoundFuji = async (input) =>
    soundFujiResult(input.candidates.map((candidate) => candidate.id));
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [musicBrainz, canonical],
  }, dependencies);

  const bridgedMusicBrainz = prepared.candidates.find((candidate) =>
    candidate.candidate.id === musicBrainz.candidate.id);
  assert.equal(bridgedMusicBrainz?.workId, groupId);
  assert.equal(bridgedMusicBrainz?.candidate.originalReleaseDate, "1988-02-12");
  assert.equal(bridgedMusicBrainz?.candidate.sources.some((source) =>
    source.url === "https://official.example/discography/catch-the-nite"), true);
  assert.equal(bridgedMusicBrainz?.candidate.sources.some((source) =>
    source.url === "https://musicbrainz.org/release/99999999-9999-4999-8999-999999999999"), false);
  assert.equal(bridgedMusicBrainz?.candidate.sources.some((source) =>
    source.url === "https://www.discogs.com/release/99999999"), false);
  assert.equal(bridgedMusicBrainz?.observations.some((entry) =>
    entry.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
    entry.facts?.manifestEntryKey === "ORIGINAL_ALBUM:1"), true);
});

test("one SOUND FUJI page cannot collapse two canonical manifest keys", async () => {
  const first = comprehensiveCandidate("PASS", {
    id: "first-canonical-work",
    title: "CATCH THE NITE",
    originalReleaseDate: "1988-02-10",
  });
  first.workId = "curated:first";
  first.editionId = "curated:first:edition";
  const second = comprehensiveCandidate("PASS", {
    id: "second-canonical-work",
    title: "CATCH THE NITE",
    originalReleaseDate: "1988-02-11",
  });
  second.workId = "curated:second";
  second.editionId = "curated:second:edition";
  for (const [candidate, key] of [[first, "ORIGINAL_ALBUM:1"], [second, "ORIGINAL_ALBUM:2"]] as const) {
    candidate.observations = [
      ...candidate.observations.filter((entry) => entry.stage !== "MUSICBRAINZ"),
      {
        id: `authority:${key}`,
        provider: "curated-official-manifest:miho-test",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        verdict: "PASS",
        reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
        reason: "Canonical manifest identity.",
        sourceUrl: `https://official.example/${key}`,
        matchedFields: ["artist", "title", "category"],
        facts: {
          artist: "中山美穂",
          title: candidate.candidate.title,
          category: "ORIGINAL_ALBUM",
          date: candidate.candidate.originalReleaseDate,
          manifestEntryKey: key,
        },
      },
    ];
  }
  const dependencies = baseDependencies([]);
  dependencies.researchSoundFuji = async (input) =>
    soundFujiResult(input.candidates.map((candidate) => candidate.id));
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [first, second],
  }, dependencies);
  assert.deepEqual(new Set(prepared.candidates.map((candidate) => candidate.workId)),
    new Set(["curated:first", "curated:second"]));
});

test("discovers a missing MusicBrainz single from Discogs and admits it only after NDL binds it", async () => {
  const dependencies = baseDependencies([discogsRow(77, {
    masterId: 707,
    formats: ["CD", "Single"],
  })]);
  dependencies.researchOfficial = undefined;
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [],
  }, dependencies);
  assert.equal(prepared.sourceStats.supplementalCandidates, 1);
  assert.equal(prepared.candidates.length, 1);
  assert.equal(prepared.candidates[0]?.candidate.id, "discogs-release-77");
  assert.equal(
    prepared.candidates[0]?.candidate.releaseDate,
    "1988-02-10",
    "the catalog-bound national bibliography refines a year-only Discogs date",
  );
  assert.equal(prepared.candidates[0]?.observations.some((item) =>
    item.provider === "musicbrainz"), false);
  assert.equal(classifyComprehensiveEvidence({
    candidateId: prepared.candidates[0]!.candidate.id,
    workId: prepared.candidates[0]!.workId,
    editionId: prepared.candidates[0]!.editionId,
    title: prepared.candidates[0]!.candidate.title,
    artistCredit: prepared.candidates[0]!.candidate.artistCredit,
    observations: prepared.candidates[0]!.observations,
    conflicts: prepared.candidates[0]!.conflicts,
  }).eligibleForAi, true);
});

test("an NDL complete-singles manifest supplies strong authority only to an existing single work", async () => {
  const dependencies = baseDependencies([]);
  dependencies.fetchNdlSingleManifests = async () => ({
    unavailable: false,
    evidence: [{
      provider: "ndl-search",
      recordId: "R100000002-I000008350485",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008350485",
      manifestTitle: "Miho Nakayama complete singles box",
      publisher: "King Records",
      trackTitles: ["Adore"],
    }],
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate("PASS", {
      title: "Adore",
      category: "SINGLE",
      releaseDate: "1999-09-16",
      originalReleaseDate: "1999-09-16",
      catalogNumber: "KIDS-431",
    })],
  }, dependencies);
  const enriched = prepared.candidates[0]!;
  const manifestObservation = enriched.observations.find((item) =>
    item.reasonCode === "NDL_COMPLETE_SINGLE_MANIFEST_MATCH" && item.verdict === "PASS");
  assert.ok(manifestObservation);
  assert.equal(manifestObservation.facts?.sourceTrackTitle, "Adore");
  assert.equal(manifestObservation.facts?.matchKind, "EXACT_NORMALIZED_TITLE");
  assert.equal(classifyComprehensiveEvidence({
    candidateId: enriched.candidate.id,
    workId: enriched.workId,
    editionId: enriched.editionId,
    title: enriched.candidate.title,
    artistCredit: enriched.candidate.artistCredit,
    observations: enriched.observations,
    conflicts: enriched.conflicts,
  }).eligibleForAi, true);
  assert.equal(prepared.sourceStats.ndlManifestMatched, 1);
});

test("an NDL manifest never drops composite or version markers to grant authority", async () => {
  const dependencies = baseDependencies([]);
  dependencies.fetchNdlSingleManifests = async () => ({
    unavailable: false,
    evidence: [{
      provider: "ndl-search",
      recordId: "R100000002-I000008350485",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008350485",
      manifestTitle: "Complete singles A-side collection",
      publisher: "Example Records",
      trackTitles: ["Slow Motion"],
    }],
  });
  for (const title of ["Slow Motion -JAZZ-", "TATTOO / Slow Motion"]) {
    const prepared = await prepareComprehensiveSourceEvidence({
      request,
      result: researchResult(),
      bundle: evidenceBundle(),
      candidates: [comprehensiveCandidate("PASS", {
        title,
        category: "SINGLE",
        releaseDate: "1982-05-01",
        originalReleaseDate: "1982-05-01",
        catalogNumber: "L-1600",
      })],
    }, dependencies);
    assert.equal(prepared.candidates[0]?.observations.some((item) =>
      item.reasonCode === "NDL_COMPLETE_SINGLE_MANIFEST_MATCH"), false, title);
    assert.equal(prepared.sourceStats.ndlManifestMatched, 0, title);
  }
});

test("the production historical-canon gate removes Akina cover albums before candidate-level source calls", async () => {
  const manifest = findCuratedArtistDiscography(null, ["中森明菜"]);
  assert.ok(manifest);
  const albumBaseline = manifest.baselines?.find((baseline) =>
    baseline.category === "ORIGINAL_ALBUM");
  const newestSingle = manifest.works.find((work) =>
    work.category === "SINGLE" && work.title === "ごめんと、すきと、");
  assert.ok(albumBaseline && newestSingle);
  assert.equal(newestSingle.originalReleaseDate, "2026-07-01");

  const candidate = (
    id: string,
    title: string,
    category: ReleaseResearchCandidate["category"],
    originalReleaseDate: string | null,
  ) => {
    const value = comprehensiveCandidate("PASS", {
      id,
      title,
      category,
      artistCredit: "中森明菜",
      releaseDate: originalReleaseDate,
      originalReleaseDate,
    });
    value.workId = `work:${id}`;
    value.editionId = `edition:${id}`;
    return value;
  };
  const historicalExtras = [
    candidate("akina-utahime", "歌姫", "ORIGINAL_ALBUM", "1994-03-04"),
    candidate("akina-enka", "艶華 -Enka-", "ORIGINAL_ALBUM", "2007-06-27"),
    candidate(
      "akina-folk-song",
      "フォーク・ソング〜歌姫 抒情歌〜",
      "ORIGINAL_ALBUM",
      "2008-12-24",
    ),
    candidate(
      "akina-mood-kayo",
      "ムード歌謡〜歌姫昭和名曲集〜",
      "ORIGINAL_ALBUM",
      "2009-06-24",
    ),
  ];
  const nextDay = new Date(`${albumBaseline.snapshotVerifiedAt}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const postCutoff = candidate(
    "akina-new-post-cutoff-album",
    "New post-cutoff original album",
    "ORIGINAL_ALBUM",
    nextDay.toISOString().slice(0, 10),
  );
  const partialDate = candidate(
    "akina-partial-date-album",
    "Unlisted album with partial date",
    "ORIGINAL_ALBUM",
    albumBaseline.asOf.slice(0, 4),
  );
  const canonicalTitleDateConflict = candidate(
    "akina-canonical-title-date-conflict",
    "Akina",
    "ORIGINAL_ALBUM",
    postCutoff.candidate.originalReleaseDate,
  );
  const canonicalTitlePartialDateConflict = candidate(
    "akina-canonical-title-partial-date-conflict",
    "明菜",
    "ORIGINAL_ALBUM",
    albumBaseline.asOf.slice(0, 4),
  );
  const currentCanonical = candidate(
    "akina-single-55",
    newestSingle.title,
    "SINGLE",
    newestSingle.originalReleaseDate,
  );
  const candidateLevelSourceIds: string[] = [];
  const dependencies = baseDependencies([
    discogsRow(998, {
      masterId: 999,
      title: "中森明菜 - 歌姫",
      year: 1994,
      formats: ["CD", "Album"],
      catalogNumber: "K32X-240",
    }),
    discogsRow(999, {
      masterId: 999,
      title: "中森明菜 - 歌姫",
      year: 2014,
      formats: ["CD", "Album", "Reissue"],
      catalogNumber: "TEST-999",
    }),
  ]);
  dependencies.useCuratedManifests = true;
  dependencies.findCuratedDiscography = () => manifest;
  dependencies.researchOfficial = async (input) => {
    candidateLevelSourceIds.push(...input.candidates.map((item) => item.id));
    return officialResult(input.candidates[0]!.id);
  };
  dependencies.limits = {
    maxScopeCandidates: 100,
    maxNdlCatalogLookups: 0,
    maxOfficialCandidates: 10,
    maxDiscogsQueries: 1,
    maxCuratedPhysicalQueries: 0,
    maxItunesTitleLookups: 0,
  };
  const akinaRequest: ReleaseResearchRequest = {
    ...request,
    artistName: "中森明菜",
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: akinaRequest,
    result: {
      ...researchResult(),
      artist: {
        name: "中森明菜",
        nameKana: "なかもり あきな",
        nameRomaji: "Akina Nakamori",
        country: "JP",
        officialSiteUrl: "https://www.universal-music.co.jp/nakamori-akina/",
      },
    },
    bundle: {
      ...evidenceBundle(),
      query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
    },
    candidates: [
      ...historicalExtras,
      partialDate,
      canonicalTitleDateConflict,
      canonicalTitlePartialDateConflict,
      currentCanonical,
      postCutoff,
    ],
  }, dependencies);

  for (const rejected of [...historicalExtras, partialDate]) {
    const actual = prepared.candidates.find((item) =>
      item.candidate.id === rejected.candidate.id);
    assert.ok(actual);
    const gate = actual.observations.find((item) =>
      item.reasonCode === "CURATED_HISTORICAL_NON_CANONICAL_WORK");
    assert.equal(gate?.verdict, "OUT_OF_SCOPE", rejected.candidate.title);
    assert.equal(gate?.stage, "SCOPE", rejected.candidate.title);
    assert.equal(
      gate?.facts?.authorityAsOf,
      albumBaseline.snapshotVerifiedAt,
      rejected.candidate.title,
    );
    assert.equal(actual.candidate.isExcludedByDefault, true, rejected.candidate.title);
    assert.equal(candidateLevelSourceIds.includes(rejected.candidate.id), false);
    assert.deepEqual(classifyComprehensiveEvidence({
      candidateId: actual.candidate.id,
      workId: actual.workId,
      editionId: actual.editionId,
      title: actual.candidate.title,
      artistCredit: actual.candidate.artistCredit,
      observations: actual.observations,
      conflicts: actual.conflicts,
    }), {
      verdict: "OUT_OF_SCOPE",
      reasonCode: "OUT_OF_SCOPE",
      eligibleForAi: false,
    });
  }
  for (const rejected of [canonicalTitleDateConflict, canonicalTitlePartialDateConflict]) {
    const actual = prepared.candidates.find((item) =>
      item.candidate.id === rejected.candidate.id);
    assert.ok(actual);
    const gate = actual.observations.find((item) =>
      item.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT");
    assert.equal(gate?.verdict, "OUT_OF_SCOPE", rejected.candidate.title);
    assert.equal(gate?.stage, "SCOPE", rejected.candidate.title);
    assert.equal(gate?.facts?.canonicalTitle, "明菜", rejected.candidate.title);
    assert.equal(gate?.facts?.canonicalOriginalReleaseDate, "2017-11-08", rejected.candidate.title);
    assert.equal(gate?.facts?.membership, "CANONICAL_TITLE_DATE_CONFLICT", rejected.candidate.title);
    assert.equal(actual.candidate.isExcludedByDefault, true, rejected.candidate.title);
    assert.equal(candidateLevelSourceIds.includes(rejected.candidate.id), false);
  }
  for (const retained of [currentCanonical, postCutoff]) {
    const actual = prepared.candidates.find((item) =>
      item.candidate.id === retained.candidate.id);
    assert.ok(actual);
    assert.equal(actual.observations.some((item) =>
      item.reasonCode === "CURATED_HISTORICAL_NON_CANONICAL_WORK"), false);
    assert.equal(actual.candidate.isExcludedByDefault, false);
  }
  assert.equal(candidateLevelSourceIds.includes(currentCanonical.candidate.id), true);
  assert.equal(candidateLevelSourceIds.includes(postCutoff.candidate.id), true);
  const supplemental = prepared.candidates.find((item) =>
    item.candidate.id === "discogs-release-999");
  assert.ok(supplemental);
  assert.equal(supplemental.candidate.originalReleaseDate, "1994-03-04");
  assert.equal(supplemental.observations.some((item) =>
    item.reasonCode === "CURATED_HISTORICAL_NON_CANONICAL_WORK" &&
      item.verdict === "OUT_OF_SCOPE"), true);
  assert.equal(prepared.sourceStats.curatedHistoricalNonCanonicalOutOfScope, 6);
  assert.equal(prepared.sourceStats.curatedCanonicalTitleDateConflicts, 2);
});

test("official budget is work-breadth-first so Akina The Heat is checked before repeated editions", async () => {
  const manifest = findCuratedArtistDiscography(null, ["中森明菜"]);
  assert.ok(manifest);
  const officialUrl =
    "https://www.universal-music.co.jp/nakamori-akina/products/umck-5060/";
  const targetId = "curated-akina-nakamori-single-44";
  const repeated = Array.from({ length: 200 }, (_, index) => {
    const candidate = comprehensiveCandidate("PASS", {
      id: `akina-repeated-edition-${index + 1}`,
      title: "スローモーション",
      category: "SINGLE",
      artistCredit: "中森明菜",
      releaseDate: "1982-05-01",
      originalReleaseDate: "1982-05-01",
      catalogNumber: `REPEAT-${index + 1}`,
      label: null,
    });
    candidate.workId = "akina-repeated-slow-motion-work";
    candidate.editionId = `akina-repeated-edition:${index + 1}`;
    return candidate;
  });
  const inspected: string[] = [];
  const dependencies = baseDependencies([]);
  dependencies.researchOfficial = async (input) => {
    inspected.push(...input.candidates.map((candidate) => candidate.id));
    return {
      candidates: input.candidates.map((candidate) => ({
        candidateId: candidate.id,
        evidence: candidate.id === targetId
          ? {
              candidateId: candidate.id,
              sourceType: "official" as const,
              url: officialUrl,
              pageTitle: "The Heat~musica fiesta~[CD MAXI]",
              evidenceScope: "single-item-page" as const,
              matchedFields: ["catalogNumber", "title", "date"],
              observedDate: "2002-05-02",
              datePrecision: "day" as const,
            }
          : null,
      })),
      warnings: [],
      stats: {
        rootsAccepted: 1,
        pagesAttempted: 1,
        pagesFetched: 1,
        pagesDiscovered: 1,
        candidatesInspected: input.candidates.length,
        candidatesMatched: 1,
        ambiguousCandidates: 0,
      },
    };
  };
  dependencies.searchJapanPhysicalReleases = async (query) => ({
    value: {
      evidenceRole: "corroborating-only",
      artistQuery: query,
      items: [discogsRow(9_888_435, {
        title: "中森明菜* = Akina Nakamori - The Heat 〜Musica Fiesta〜",
        year: 2002,
        formats: ["CD", "Single"],
        labels: ["Kitty MME"],
        catalogNumber: "UMCK 5060",
      })],
      sourceTotal: 1,
      pagesFetched: 1,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  });
  dependencies.limits = {
    maxScopeCandidates: 500,
    maxNdlCatalogLookups: 0,
    maxOfficialCandidates: 200,
    maxDiscogsQueries: 1,
    maxCuratedPhysicalQueries: 1,
    maxItunesTitleLookups: 0,
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: { ...request, artistName: "中森明菜" },
    result: {
      ...researchResult(),
      artist: {
        name: "中森明菜",
        nameKana: "なかもり あきな",
        nameRomaji: "Akina Nakamori",
        country: "JP",
        officialSiteUrl: "https://www.universal-music.co.jp/nakamori-akina/",
      },
    },
    bundle: {
      ...evidenceBundle(),
      query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
      works: [],
    },
    candidates: repeated,
  }, {
    ...dependencies,
    useCuratedManifests: true,
    findCuratedDiscography: () => manifest,
  });

  assert.equal(inspected.length, 200);
  assert.equal(inspected.includes(targetId), true);
  assert.equal(inspected.filter((id) => id.startsWith("akina-repeated-edition-")).length < 200, true);
  const target = prepared.candidates.find((candidate) => candidate.candidate.id === targetId);
  assert.ok(target);
  assert.equal(target.observations.some((item) =>
    item.reasonCode === "OFFICIAL_CATALOG_EDITION_MATCH" && item.sourceUrl === officialUrl), true);
  assert.equal(target.observations.some((item) =>
    item.reasonCode === "OFFICIAL_CANDIDATE_LIMIT"), false);
  assert.equal(target.observations.some((item) =>
    item.reasonCode === "DISCOGS_CURATED_CARRIER_NOT_FOUND"), true);
  assert.deepEqual(classifyComprehensiveEvidence({
    candidateId: target.candidate.id,
    workId: target.workId,
    editionId: target.editionId,
    title: target.candidate.title,
    artistCredit: target.candidate.artistCredit,
    observations: target.observations,
    conflicts: target.conflicts,
  }), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_INDEPENDENT_CORROBORATION",
    eligibleForAi: false,
  });
});

type CuratedTestReleaseGroup = NonNullable<
  NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["releaseGroup"]
>;

async function prepareCuratedMatchFixture(
  overrides: Partial<CuratedTestReleaseGroup> = {},
  workOverrides: Partial<CuratedDiscographyWork> = {},
  carrierReleases: MusicReleaseEvidence[] = [],
) {
  const workId = "10000000-0000-4000-8000-000000000010";
  const manifest: CuratedArtistDiscography = {
    slug: "example-artist",
    canonicalName: "Example Artist",
    aliases: ["Artist Example"],
    musicBrainzArtistId: "20000000-0000-4000-8000-000000000020",
    country: "JP",
    works: [{
      ordinal: 1,
      title: "Debut Single",
      aliases: ["The Debut Single"],
      category: "SINGLE",
      originalReleaseDate: "1973-05-21",
      authorityUrls: ["https://official.example/discography/debut-single"],
      authorityAsOf: "2026-07-12",
      mediaScope: null,
      ...workOverrides,
    }],
  };
  const fixtureRequest: ReleaseResearchRequest = { ...request, artistName: "Example Artist" };
  const fixtureResult: ReleaseResearchResult = {
    ...researchResult(),
    artist: {
      name: "Example Artist",
      nameKana: null,
      nameRomaji: "Example Artist",
      country: "JP",
      officialSiteUrl: null,
    },
  };
  const releaseGroup: CuratedTestReleaseGroup = {
    entityType: "release-group",
    sourceId: workId,
    releaseGroupId: null,
    title: "Debut Single",
    artistCredit: "Example Artist",
    artistNames: ["Example Artist"],
    artistAliases: [],
    date: "1973-05-21",
    type: "Single",
    secondaryTypes: [],
    country: null,
    label: null,
    catalogNumber: null,
    format: null,
    labels: [],
    formats: [],
    barcode: null,
    status: null,
    sourceUrl: `https://musicbrainz.org/release-group/${workId}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [],
    ...overrides,
  };
  return prepareComprehensiveSourceEvidence({
    request: fixtureRequest,
    result: fixtureResult,
    bundle: {
      ...evidenceBundle(),
      query: { artistName: "Example Artist", targetCountry: "JP", target: "ORIGINAL_CD" },
      discoveredEditions: carrierReleases.map((evidence) => ({
        workId,
        evidence,
        scope: { verdict: "OUT_OF_SCOPE", reasonCodes: ["MB_COUNTRY_OUTSIDE_TARGET"] },
      })),
      works: [{
        workId,
        editions: carrierReleases.map((evidence) => ({
          workId,
          evidence,
          scope: { verdict: "OUT_OF_SCOPE", reasonCodes: ["MB_COUNTRY_OUTSIDE_TARGET"] },
        })),
        releaseGroup,
      }],
    },
    candidates: [],
  }, {
    ...baseDependencies([]),
    useCuratedManifests: true,
    findCuratedDiscography: () => manifest,
    limits: {
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: 0,
      maxItunesTitleLookups: 0,
    },
  });
}

function exactTwMusicBrainzCarrier(
  overrides: Partial<MusicReleaseEvidence> = {},
): MusicReleaseEvidence {
  const sourceId = "30000000-0000-4000-8000-000000000030";
  return {
    entityType: "release",
    sourceId,
    releaseGroupId: "10000000-0000-4000-8000-000000000010",
    title: "Debut Single",
    artistCredit: "Example Artist",
    artistNames: ["Example Artist"],
    artistAliases: [],
    date: "2015-08-26",
    type: "Single",
    secondaryTypes: [],
    country: "TW",
    label: "Example Records",
    catalogNumber: "TEST-1",
    format: "CD",
    labels: [{ name: "Example Records", catalogNumber: "TEST-1" }],
    formats: ["CD"],
    barcode: "4710000000001",
    status: "Official",
    sourceUrl: `https://musicbrainz.org/release/${sourceId}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [],
    ...overrides,
  };
}

const laterTwCarrierScope: CuratedDiscographyWork["mediaScope"] = {
  originalFormats: ["VINYL"],
  physicalCd: "LATER_OFFICIAL_EDITION",
  physicalCdCountry: "TW",
  physicalCdAuthorityUrls: ["https://official.example/discography/debut-single"],
  physicalCdReleaseDate: "2015-08-26",
  physicalCdCatalogNumber: "TEST-1",
  physicalCdRepresentationKind: "SAME_WORK_EDITION",
  physicalCdContainerTitle: null,
  exclusionReason: null,
};

test("a unique exact MusicBrainz release binds a later same-work carrier outside the request country", async () => {
  const prepared = await prepareCuratedMatchFixture({}, {
    mediaScope: laterTwCarrierScope,
  }, [exactTwMusicBrainzCarrier()]);
  const candidate = prepared.candidates.find((item) => item.editionId ===
    "curated-official-manifest:example-artist:representation:SINGLE:1");
  assert.ok(candidate);
  assert.equal(candidate.candidate.releaseDate, "2015-08-26");
  assert.equal(candidate.candidate.catalogNumber, "TEST-1");
  const carrier = candidate.observations.find((observation) =>
    observation.reasonCode === "CURATED_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH");
  assert.ok(carrier);
  assert.equal(carrier.facts?.country, "TW");
  assert.equal(carrier.facts?.uniqueCarrierEntity, "true");
  assert.deepEqual(classifyComprehensiveEvidence({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  }), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
});

test("the generic MusicBrainz carrier bridge rejects conflicting or ambiguous releases", async (t) => {
  const exact = exactTwMusicBrainzCarrier();
  const cases: Array<[string, MusicReleaseEvidence[]]> = [
    ["wrong artist", [{ ...exact, artistCredit: "Other Artist", artistNames: ["Other Artist"] }]],
    ["wrong title", [{ ...exact, title: "Different Work" }]],
    ["wrong date", [{ ...exact, date: "2015-08-27" }]],
    ["wrong catalog", [{ ...exact, catalogNumber: "TEST-2" }]],
    ["wrong country", [{ ...exact, country: "JP" }]],
    ["non-official", [{ ...exact, status: "Promotion" }]],
    ["non-CD", [{ ...exact, format: "Digital Media", formats: ["Digital Media"] }]],
    ["wrong source URL", [{ ...exact, sourceUrl: "https://musicbrainz.org/release/40000000-0000-4000-8000-000000000040" }]],
    ["duplicate exact entity", [exact, { ...exact, sourceId: "40000000-0000-4000-8000-000000000040", sourceUrl: "https://musicbrainz.org/release/40000000-0000-4000-8000-000000000040" }]],
  ];
  for (const [name, releases] of cases) {
    await t.test(name, async () => {
      const prepared = await prepareCuratedMatchFixture({}, {
        mediaScope: laterTwCarrierScope,
      }, releases);
      const candidate = prepared.candidates.find((item) => item.editionId ===
        "curated-official-manifest:example-artist:representation:SINGLE:1");
      assert.ok(candidate);
      assert.equal(candidate.observations.some((observation) =>
        observation.reasonCode === "CURATED_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH"), false);
      assert.deepEqual(classifyComprehensiveEvidence({
        candidateId: candidate.candidate.id,
        workId: candidate.workId,
        editionId: candidate.editionId,
        title: candidate.candidate.title,
        artistCredit: candidate.candidate.artistCredit,
        observations: candidate.observations,
        conflicts: candidate.conflicts,
      }), {
        verdict: "UNKNOWN",
        reasonCode: "MISSING_DECLARED_CARRIER",
        eligibleForAi: false,
      });
    });
  }
});

test("a foreign-artist title claim cannot seed a curated work", async () => {
  const prepared = await prepareCuratedMatchFixture({
    artistCredit: "Other Artist",
    artistNames: ["Other Artist"],
  });
  assert.equal(prepared.sourceStats.curatedManifestSeeded, 0);
  assert.equal(prepared.sourceStats.curatedManifestPendingSeeded, 0);
  assert.equal(prepared.candidates.some((candidate) =>
    candidate.candidate.id === "curated-example-artist-single-1"), false);
});

test("same-artist incompatible MusicBrainz rows do not erase or corroborate a curated work", async (t) => {
  const cases: Array<[string, Partial<CuratedTestReleaseGroup>]> = [
    ["wrong primary type", { type: "Album" }],
    ["excluded secondary type", { secondaryTypes: ["Compilation"] }],
    ["conflicting full date", { date: "1973-05-22" }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const prepared = await prepareCuratedMatchFixture(overrides);
      const seeded = prepared.candidates.find((candidate) =>
        candidate.candidate.id === "curated-example-artist-single-1");
      assert.ok(seeded);
      assert.equal(prepared.sourceStats.curatedManifestSeeded, 0);
      assert.equal(prepared.sourceStats.curatedManifestPendingSeeded, 1);
      assert.equal(seeded.observations.some((item) =>
        item.reasonCode === "MUSICBRAINZ_WORK_GROUP_CORROBORATION"), false);
      assert.deepEqual(classifyComprehensiveEvidence({
        candidateId: seeded.candidate.id,
        workId: seeded.workId,
        editionId: seeded.editionId,
        title: seeded.candidate.title,
        artistCredit: seeded.candidate.artistCredit,
        observations: seeded.observations,
        conflicts: seeded.conflicts,
      }), {
        verdict: "UNKNOWN",
        reasonCode: "MISSING_MUSICBRAINZ",
        eligibleForAi: false,
      });
    });
  }
});

test("a partial MusicBrainz year may identify a curated work without corroborating its full date", async () => {
  const prepared = await prepareCuratedMatchFixture({ date: "1973" });
  const seeded = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "curated-example-artist-single-1");
  assert.ok(seeded);
  assert.equal(seeded.candidate.releaseDate, null);
  const authority = seeded.observations.find((item) =>
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH");
  assert.equal(authority?.matchedFields.includes("date"), false);
  assert.equal(authority?.facts?.dateSupport, "MANIFEST_ONLY");
});

test("an alternate artist credit is scoped to one curated work rather than the whole artist", async () => {
  const withoutWorkCredit = await prepareCuratedMatchFixture({
    artistCredit: "PROJECT CREDIT",
    artistNames: ["PROJECT CREDIT"],
  });
  assert.equal(withoutWorkCredit.sourceStats.curatedManifestSeeded, 0);

  const withWorkCredit = await prepareCuratedMatchFixture({
    artistCredit: "PROJECT CREDIT",
    artistNames: ["PROJECT CREDIT"],
  }, {
    artistCredits: ["PROJECT CREDIT"],
  });
  const seeded = withWorkCredit.candidates.find((candidate) =>
    candidate.candidate.id === "curated-example-artist-single-1");
  assert.ok(seeded);
  assert.equal(seeded.candidate.artistCredit, "PROJECT CREDIT");
  assert.equal(withWorkCredit.sourceStats.curatedManifestSeeded, 1);
});

test("a curated container manifest keeps the vinyl edition separate and pending without its carrier", async () => {
  const momoeGroupId = "a4df4a04-8e9f-4982-b153-1365346079fd";
  const momoeRequest: ReleaseResearchRequest = {
    ...request,
    artistName: "山口百恵",
  };
  const momoeResult: ReleaseResearchResult = {
    ...researchResult(),
    artist: {
      name: "山口百恵",
      nameKana: null,
      nameRomaji: "Momoe Yamaguchi",
      country: "JP",
      officialSiteUrl: "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/",
    },
  };
  const vinyl = comprehensiveCandidate("OUT_OF_SCOPE", {
    id: "momoe-vinyl-debut",
    title: "人にめざめる14才 としごろ",
    category: "SINGLE",
    artistCredit: "山口百恵",
    releaseDate: "1973-05-21",
    originalReleaseDate: "1973-05-21",
    format: "7\" Vinyl",
    catalogNumber: "SOLB-29",
    sources: [{
      title: "MusicBrainz release group",
      url: `https://musicbrainz.org/release-group/${momoeGroupId}`,
      sourceType: "database",
    }],
  });
  vinyl.workId = momoeGroupId;
  vinyl.editionId = "momoe-vinyl-edition";
  const bundle: ArtistReleaseEvidenceBundle = {
    ...evidenceBundle(),
    query: { artistName: "山口百恵", targetCountry: "JP", target: "ORIGINAL_CD" },
    works: [{
      workId: momoeGroupId,
      editions: [],
      releaseGroup: {
        entityType: "release-group",
        sourceId: momoeGroupId,
        releaseGroupId: null,
        title: "人にめざめる14才 としごろ",
        artistCredit: "山口百恵",
        artistNames: ["山口百恵"],
        artistAliases: [],
        date: "1973-05-21",
        type: "Single",
        secondaryTypes: [],
        country: null,
        label: null,
        catalogNumber: null,
        format: null,
        labels: [],
        formats: [],
        barcode: null,
        status: null,
        sourceUrl: `https://musicbrainz.org/release-group/${momoeGroupId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [],
      },
    }],
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: momoeRequest,
    result: momoeResult,
    bundle,
    candidates: [vinyl],
  }, {
    ...baseDependencies([]),
    useCuratedManifests: true,
  });

  const seeded = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "curated-momoe-yamaguchi-single-1");
  assert.ok(seeded);
  assert.equal(seeded.candidate.title, "としごろ");
  assert.equal(seeded.candidate.releaseDate, "2015-02-11");
  assert.equal(seeded.candidate.originalReleaseDate, "1973-05-21");
  assert.equal(seeded.candidate.format, "CD (official canonical-work representation)");
  assert.equal(seeded.candidate.catalogNumber, "MHCL-30295～30298");
  const preservedVinyl = prepared.candidates.find((candidate) =>
    candidate.candidate.id === vinyl.candidate.id);
  assert.ok(preservedVinyl);
  assert.equal(preservedVinyl.editionId, "momoe-vinyl-edition");
  assert.equal(preservedVinyl.candidate.releaseDate, "1973-05-21");
  assert.equal(seeded.observations.some((item) =>
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" && item.verdict === "PASS"), true);
  assert.equal(seeded.observations.some((item) =>
    item.reasonCode === "MUSICBRAINZ_WORK_GROUP_CORROBORATION" && item.verdict === "PASS"), true);
  const manifestAuthority = seeded.observations.find((item) =>
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH");
  assert.equal(manifestAuthority?.matchedFields.includes("date"), true);
  assert.equal(manifestAuthority?.facts?.dateSupport, "MUSICBRAINZ_EXACT");
  assert.deepEqual(classifyComprehensiveEvidence({
    candidateId: seeded.candidate.id,
    workId: seeded.workId,
    editionId: seeded.editionId,
    title: seeded.candidate.title,
    artistCredit: seeded.candidate.artistCredit,
    observations: seeded.observations,
    conflicts: seeded.conflicts,
  }), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_DECLARED_CARRIER",
    eligibleForAi: false,
  });
  assert.equal(prepared.sourceStats.curatedManifestSeeded, 1);
});

test("explicit curated carrier scope blocks cassette-only and digital-only works from CD results", async () => {
  const rows = [
    {
      id: "akina-cd",
      workId: "10000000-0000-4000-8000-000000000001",
      title: "ごめんと、すきと、",
      date: "2026-07-01",
    },
    {
      id: "akina-cassette",
      workId: "10000000-0000-4000-8000-000000000002",
      title: "ノンフィクション エクスタシー",
      date: "1986-11-10",
    },
    {
      id: "akina-digital",
      workId: "10000000-0000-4000-8000-000000000003",
      title: "Crazy Love",
      date: "2010-07-13",
    },
  ] as const;
  const candidates = rows.map((row) => {
    const candidate = comprehensiveCandidate("PASS", {
      id: row.id,
      title: row.title,
      category: "SINGLE",
      artistCredit: "中森明菜",
      releaseDate: row.date,
      originalReleaseDate: row.date,
      // Deliberately wrong upstream carrier: the authoritative scope must win.
      format: "CD",
      catalogNumber: null,
    });
    candidate.workId = row.workId;
    candidate.editionId = `${row.id}-edition`;
    return candidate;
  });
  const bundle: ArtistReleaseEvidenceBundle = {
    ...evidenceBundle(),
    query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
    works: rows.map((row) => ({
      workId: row.workId,
      editions: [],
      releaseGroup: {
        entityType: "release-group",
        sourceId: row.workId,
        releaseGroupId: null,
        title: row.title,
        artistCredit: "中森明菜",
        artistNames: ["中森明菜"],
        artistAliases: [],
        date: row.date,
        type: "Single",
        secondaryTypes: [],
        country: null,
        label: null,
        catalogNumber: null,
        format: null,
        labels: [],
        formats: [],
        barcode: null,
        status: null,
        sourceUrl: `https://musicbrainz.org/release-group/${row.workId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [],
      },
    })),
  };
  const authorityUrl = "https://example.com/akina-official-discography";
  const manifest: CuratedArtistDiscography = {
    slug: "akina-nakamori-test",
    canonicalName: "中森明菜",
    aliases: ["Akina Nakamori"],
    musicBrainzArtistId: "7d7d7d7d-0000-4000-8000-000000000000",
    country: "JP",
    works: [
      {
        ordinal: 1,
        title: rows[0].title,
        aliases: [],
        category: "SINGLE",
        originalReleaseDate: rows[0].date,
        authorityUrls: [authorityUrl],
        authorityAsOf: "2026-07-12",
        mediaScope: {
          originalFormats: ["CD"],
          physicalCd: "ORIGINAL_RELEASE",
          physicalCdAuthorityUrls: [],
          physicalCdReleaseDate: rows[0].date,
          physicalCdCatalogNumber: null,
          exclusionReason: null,
        },
      },
      {
        ordinal: 2,
        title: rows[1].title,
        aliases: [],
        category: "SINGLE",
        originalReleaseDate: rows[1].date,
        authorityUrls: [authorityUrl],
        authorityAsOf: "2026-07-12",
        mediaScope: {
          originalFormats: ["CASSETTE"],
          physicalCd: "NONE",
          physicalCdAuthorityUrls: [],
          physicalCdReleaseDate: null,
          physicalCdCatalogNumber: null,
          exclusionReason: "CASSETTE_ONLY",
        },
      },
      {
        ordinal: 3,
        title: rows[2].title,
        aliases: [],
        category: "SINGLE",
        originalReleaseDate: rows[2].date,
        authorityUrls: [authorityUrl],
        authorityAsOf: "2026-07-12",
        mediaScope: {
          originalFormats: ["DIGITAL"],
          physicalCd: "NONE",
          physicalCdAuthorityUrls: [],
          physicalCdReleaseDate: null,
          physicalCdCatalogNumber: null,
          exclusionReason: "DIGITAL_ONLY",
        },
      },
    ],
  };
  const akinaRequest: ReleaseResearchRequest = {
    ...request,
    artistName: "中森明菜",
  };
  const akinaResult: ReleaseResearchResult = {
    ...researchResult(),
    artist: {
      name: "中森明菜",
      nameKana: "なかもり あきな",
      nameRomaji: "Akina Nakamori",
      country: "JP",
      officialSiteUrl: authorityUrl,
    },
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: akinaRequest,
    result: akinaResult,
    bundle,
    candidates,
  }, {
    ...baseDependencies([]),
    useCuratedManifests: true,
    findCuratedDiscography: () => manifest,
  });

  const cd = prepared.candidates.find((candidate) => candidate.candidate.id === "akina-cd");
  const cassette = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "akina-cassette");
  const digital = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "akina-digital");
  assert.ok(cd && cassette && digital);
  assert.equal(cd.observations.some((item) =>
    item.reasonCode === "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED" && item.verdict === "PASS"), true);
  assert.equal(cassette.observations.some((item) =>
    item.reasonCode === "CURATED_CASSETTE_ONLY_OUT_OF_CD_SCOPE" &&
      item.verdict === "OUT_OF_SCOPE"), true);
  assert.equal(digital.observations.some((item) =>
    item.reasonCode === "CURATED_DIGITAL_ONLY_OUT_OF_CD_SCOPE" &&
      item.verdict === "OUT_OF_SCOPE"), true);
  assert.equal(cassette.candidate.isExcludedByDefault, true);
  assert.equal(digital.candidate.isExcludedByDefault, true);
  assert.equal(classifyComprehensiveEvidence({
    candidateId: cassette.candidate.id,
    workId: cassette.workId,
    editionId: cassette.editionId,
    title: cassette.candidate.title,
    artistCredit: cassette.candidate.artistCredit,
    observations: cassette.observations,
    conflicts: cassette.conflicts,
  }).verdict, "OUT_OF_SCOPE");
  assert.equal(prepared.sourceStats.curatedManifestMatched, 1);
  assert.equal(prepared.sourceStats.curatedManifestOutOfScope, 2);
  assert.equal(prepared.sourceStats.curatedManifestSeeded, 0);
  assert.equal(prepared.sourceStats.scopeCandidates, 1);
});

function curatedPhysicalManifest(): CuratedArtistDiscography {
  return {
    slug: "akina-physical-test",
    canonicalName: "中森明菜",
    aliases: ["Akina Nakamori"],
    musicBrainzArtistId: "30000000-0000-4000-8000-000000000030",
    country: "JP",
    works: [{
      ordinal: 1,
      title: "スローモーション",
      aliases: ["Slow Motion"],
      category: "SINGLE",
      originalReleaseDate: "1982-05-01",
      authorityUrls: ["https://example.com/akina/slow-motion"],
      authorityAsOf: "2026-07-12",
      mediaScope: {
        originalFormats: ["CD"],
        physicalCd: "ORIGINAL_RELEASE",
        physicalCdAuthorityUrls: [],
        physicalCdReleaseDate: "1982-05-01",
        physicalCdCatalogNumber: "WPCL-100",
        exclusionReason: null,
      },
    }],
  };
}

function curatedPhysicalRow(
  releaseId = 800,
  overrides: Partial<DiscogsSearchReleaseEvidence> = {},
): DiscogsSearchReleaseEvidence {
  return discogsRow(releaseId, {
    masterId: 88,
    title: "中森明菜 - スローモーション = Slow Motion",
    year: 1982,
    formats: ["Vinyl", "7\"", "45 RPM", "Single"],
    catalogNumber: "L-1600",
    ...overrides,
  });
}

function curatedPhysicalResearchResult(): ReleaseResearchResult {
  return {
    ...researchResult(),
    artist: {
      name: "中森明菜",
      nameKana: "なかもり あきな",
      nameRomaji: "Akina Nakamori",
      country: "JP",
      officialSiteUrl: null,
    },
  };
}

async function prepareCuratedPhysicalFixture(options: {
  physicalRows?: DiscogsSearchReleaseEvidence[];
  cdRows?: DiscogsSearchReleaseEvidence[];
  physicalPartial?: boolean;
  physicalWarnings?: Array<{
    code: "invalid-response" | "partial-results" | "rate-limited" | "unavailable";
    message: string;
    retryable: boolean;
  }>;
  directJapaneseHit?: boolean;
  returnedArtistQuery?: string;
  candidates?: ComprehensiveDiscographyCandidate[];
  bundle?: ArtistReleaseEvidenceBundle;
  getRelease?: (id: number) => Promise<DiscogsResult<DiscogsReleaseEvidence | null>>;
  validateCover?: (url: string | URL) => Promise<CoverAssetValidationResult>;
} = {}) {
  const physicalRows = options.physicalRows ?? [curatedPhysicalRow()];
  const calls: Array<{
    query: string;
    limits: { maxPages?: number; maxItems?: number };
  }> = [];
  const progress: Array<{
    stage: "SOURCE_FETCH" | "NDL_MATCH" | "SOURCE_MERGE";
    processed: number;
    total: number;
  }> = [];
  const dependencies = baseDependencies(options.cdRows ?? []);
  dependencies.searchJapanPhysicalReleases = async (query, limits) => {
    calls.push({ query, limits: limits ?? {} });
    const rows = options.directJapaneseHit || query === "Akina Nakamori" ? physicalRows : [];
    return {
      value: {
        evidenceRole: "corroborating-only",
        artistQuery: options.returnedArtistQuery ?? query,
        items: rows,
        sourceTotal: rows.length,
        pagesFetched: 1,
        partial: options.physicalPartial ?? false,
      } satisfies DiscogsJapanPhysicalSearchResult,
      warnings: options.physicalWarnings ?? [],
      rateLimit: null,
    };
  };
  if (options.getRelease) dependencies.discogs!.getRelease = options.getRelease;
  if (options.validateCover) dependencies.validateCover = options.validateCover;
  const fixtureRequest: ReleaseResearchRequest = {
    ...request,
    artistName: "中森明菜",
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: fixtureRequest,
    result: curatedPhysicalResearchResult(),
    bundle: options.bundle ?? {
      ...evidenceBundle(),
      query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
      works: [],
    },
    candidates: options.candidates ?? [],
    onProgress: async (update) => {
      progress.push(update);
    },
  }, {
    ...dependencies,
    useCuratedManifests: true,
    findCuratedDiscography: () => curatedPhysicalManifest(),
    limits: {
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: options.cdRows?.length ? 1 : 0,
      maxCuratedPhysicalQueries: 2,
      maxCuratedPhysicalPagesPerQuery: 2,
      maxCuratedPhysicalItemsPerQuery: 20,
      maxItunesTitleLookups: 0,
    },
  });
  return { prepared, calls, progress };
}

test("bounded Japanese-then-romanized ALL_PHYSICAL inventory admits one pending curated work", async () => {
  const { prepared, calls, progress } = await prepareCuratedPhysicalFixture({
    cdRows: [curatedPhysicalRow(801, {
      title: "中森明菜 - スローモーション",
      formats: ["CD", "Single"],
      catalogNumber: "WPCL-100",
    })],
  });
  assert.deepEqual(calls, [
    { query: "中森明菜", limits: { maxPages: 2, maxItems: 20 } },
    { query: "Akina Nakamori", limits: { maxPages: 2, maxItems: 20 } },
  ]);
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-akina-physical-test-single-1");
  assert.ok(candidate);
  const corroboration = candidate.observations.find((item) =>
    item.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH");
  assert.equal(corroboration?.verdict, "PASS");
  assert.deepEqual(corroboration?.matchedFields, [
    "artist",
    "title",
    "category",
    "originalYear",
    "catalogNumber",
    "year",
  ]);
  assert.equal(corroboration?.facts?.catalogNumber, "L-1600");
  assert.equal(corroboration?.facts?.year, "1982");
  assert.equal(corroboration?.facts?.formats, "Vinyl, 7\", 45 RPM, Single");
  assert.equal(candidate.candidate.format, "CD (official canonical-work representation)");
  assert.equal(classifyComprehensiveEvidence({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  }).eligibleForAi, true);
  assert.equal(prepared.sourceStats.curatedManifestPendingSeeded, 1);
  assert.equal(prepared.sourceStats.curatedPhysicalSearchCalls, 2);
  assert.equal(prepared.sourceStats.curatedPhysicalRows, 1);
  assert.equal(prepared.sourceStats.curatedPhysicalMatchedWorks, 1);
  assert.equal(progress.some((item) =>
    item.stage === "SOURCE_FETCH" && item.processed === 1 && item.total === 1), true);
});

test("a non-alias artistQuery response is not accepted as the curated inventory", async () => {
  const { prepared, calls } = await prepareCuratedPhysicalFixture({
    returnedArtistQuery: "Wrong Artist",
  });
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-akina-physical-test-single-1");
  assert.ok(candidate);
  assert.equal(candidate.observations.some((item) =>
    item.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH"), false);
  assert.deepEqual(calls.map((item) => item.query), ["中森明菜", "Akina Nakamori"]);
});

test("curated physical evidence stays pending for wrong or non-unique inventory rows", async (t) => {
  const cases: Array<[string, DiscogsSearchReleaseEvidence[]]> = [
    ["wrong artist", [curatedPhysicalRow(810, { title: "松田聖子 - スローモーション" })]],
    ["wrong year", [curatedPhysicalRow(811, { year: 1983 })]],
    ["wrong category", [curatedPhysicalRow(812, { formats: ["Vinyl", "Album"] })]],
    ["digital file", [curatedPhysicalRow(813, { formats: ["File", "MP3", "Single"] })]],
    ["ambiguous catalogs", [
      curatedPhysicalRow(814, { masterId: 8140, catalogNumber: "L-1600" }),
      curatedPhysicalRow(815, { masterId: 8150, catalogNumber: "L-1601" }),
    ]],
  ];
  for (const [name, physicalRows] of cases) {
    await t.test(name, async () => {
      const { prepared } = await prepareCuratedPhysicalFixture({ physicalRows });
      const candidate = prepared.candidates.find((item) =>
        item.candidate.id === "curated-akina-physical-test-single-1");
      assert.ok(candidate);
      assert.equal(candidate.observations.some((item) =>
        item.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH"), false);
      assert.equal(classifyComprehensiveEvidence({
        candidateId: candidate.candidate.id,
        workId: candidate.workId,
        editionId: candidate.editionId,
        title: candidate.candidate.title,
        artistCredit: candidate.candidate.artistCredit,
        observations: candidate.observations,
        conflicts: candidate.conflicts,
      }).eligibleForAi, false);
      assert.equal(prepared.sourceStats.curatedPhysicalMatchedWorks, 0);
    });
  }
});

test("partial or rate-limited physical inventory cannot claim a unique work binding", async () => {
  const { prepared } = await prepareCuratedPhysicalFixture({
    directJapaneseHit: true,
    physicalPartial: true,
    physicalWarnings: [{
      code: "rate-limited",
      message: "Discogs rate limit reached.",
      retryable: true,
    }],
  });
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-akina-physical-test-single-1");
  assert.ok(candidate);
  assert.equal(candidate.observations.some((item) =>
    item.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH"), false);
  assert.equal(prepared.sourceStats.curatedPhysicalIncompleteInventories, 1);
  assert.equal(prepared.sourceStats.curatedPhysicalRetryableFailures, 1);
  assert.equal(prepared.sourceStats.curatedPhysicalRateLimits, 1);
});

test("curated original-work binding merges existing MusicBrainz and Discogs CD candidates", async () => {
  const physical = curatedPhysicalRow(820, { masterId: 8200, catalogNumber: "L-1600" });
  const cd = curatedPhysicalRow(821, {
    masterId: 8200,
    formats: ["CD", "Single"],
    catalogNumber: "WPCL-101",
  });
  const mbWorkId = "40000000-0000-4000-8000-000000000040";
  const mbCandidate = comprehensiveCandidate("PASS", {
    id: "mb-akina-slow-motion",
    title: "スローモーション",
    category: "SINGLE",
    artistCredit: "中森明菜",
    releaseDate: "1982-05-01",
    originalReleaseDate: "1982-05-01",
    catalogNumber: "WPCL-100",
  });
  mbCandidate.workId = mbWorkId;
  mbCandidate.editionId = "mb-akina-slow-motion-edition";
  const bundle: ArtistReleaseEvidenceBundle = {
    ...evidenceBundle(),
    query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
    works: [{
      workId: mbWorkId,
      editions: [],
      releaseGroup: {
        entityType: "release-group",
        sourceId: mbWorkId,
        releaseGroupId: null,
        title: "スローモーション",
        artistCredit: "中森明菜",
        artistNames: ["中森明菜"],
        artistAliases: [],
        date: "1982-05-01",
        type: "Single",
        secondaryTypes: [],
        country: null,
        label: null,
        catalogNumber: null,
        format: null,
        labels: [],
        formats: [],
        barcode: null,
        status: null,
        sourceUrl: `https://musicbrainz.org/release-group/${mbWorkId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [],
      },
    }],
  };
  const { prepared } = await prepareCuratedPhysicalFixture({
    physicalRows: [physical],
    cdRows: [cd],
    candidates: [mbCandidate],
    bundle,
  });
  const musicBrainz = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "mb-akina-slow-motion");
  const discogsCd = prepared.candidates.find((candidate) =>
    candidate.candidate.id === "discogs-release-821");
  assert.ok(musicBrainz && discogsCd);
  assert.equal(discogsCd.workId, musicBrainz.workId);
  assert.equal(musicBrainz.workId, mbWorkId);
  assert.equal(prepared.candidates.some((candidate) =>
    candidate.candidate.id === "curated-akina-physical-test-single-1"), false);
  assert.equal(prepared.sourceStats.curatedPhysicalReboundCandidates, 1);
  assert.equal(new Set(prepared.candidates
    .filter((candidate) => candidate.candidate.title === "スローモーション")
    .map((candidate) => candidate.workId)).size, 1);
});

test("exact Discogs work detail cannot supply artwork for a different selected edition", async () => {
  const physical = curatedPhysicalRow(830, {
    coverImageUrl: "https://i.discogs.com/search-cover.jpg",
  });
  let detailCalls = 0;
  const validatedUrls: string[] = [];
  const { prepared } = await prepareCuratedPhysicalFixture({
    physicalRows: [physical],
    validateCover: async (url) => {
      validatedUrls.push(url.toString());
      return validCover(url.toString());
    },
    getRelease: async (releaseId) => {
      detailCalls += 1;
      return {
        value: {
          ...discogsDetail(releaseId, "https://i.discogs.com/detail-cover.jpg"),
          displayImageUrl: "https://i.discogs.com/detail-display-cover.jpg",
          masterId: 88,
          title: "スローモーション = Slow Motion",
          artistCredit: "中森明菜",
          artists: [{ name: "中森明菜", anv: null, join: null }],
          year: 1982,
          released: "1982-05-01",
          country: "Japan",
          labels: [{ name: "Reprise Records", catalogNumber: "L-1600" }],
          formats: [{
            name: "Vinyl",
            quantity: 1,
            descriptions: ["7\"", "45 RPM", "Single"],
          }],
        },
        warnings: [],
        rateLimit: null,
      };
    },
  });
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-akina-physical-test-single-1");
  assert.ok(candidate);
  const cover = await prepared.lookupValidatedCover(candidate);
  assert.equal(cover.status, "INVALID");
  assert.equal(detailCalls, 1);
  assert.deepEqual(validatedUrls, []);
  assert.equal(prepared.sourceStats.curatedPhysicalCoverDetailCalls, 1);
  assert.equal(prepared.sourceStats.curatedPhysicalCoversMatched, 0);
});

test("a curated Discogs work binding cannot promote a display image to selected-edition artwork", async () => {
  const displayImageUrl = "https://i.discogs.com/detail-display-cover.jpg";
  const physical = curatedPhysicalRow(835);
  const canonicalArtist = curatedPhysicalManifest().canonicalName;
  const discogsTitle = physical.title.slice(physical.title.indexOf(" - ") + 3);
  const { prepared } = await prepareCuratedPhysicalFixture({
    physicalRows: [physical],
    getRelease: async (releaseId) => ({
      value: {
        ...discogsDetail(releaseId, null),
        masterId: 88,
        title: discogsTitle,
        artistCredit: canonicalArtist,
        artists: [{ name: canonicalArtist, anv: null, join: null }],
        year: 1982,
        released: "1982-05-01",
        country: "Japan",
        labels: [{ name: "Reprise Records", catalogNumber: "L-1600" }],
        formats: [{
          name: "Vinyl",
          quantity: 1,
          descriptions: ["7\"", "45 RPM", "Single"],
        }],
        images: [{
          type: "secondary",
          url: displayImageUrl,
          thumbnailUrl: "https://i.discogs.com/detail-display-cover-150.jpg",
          width: 600,
          height: 600,
        }],
        displayImageUrl,
      },
      warnings: [],
      rateLimit: null,
    }),
  });
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-akina-physical-test-single-1");
  assert.ok(candidate);

  const cover = await prepared.lookupValidatedCover(candidate);

  assert.equal(cover.status, "INVALID");
  assert.equal(prepared.sourceStats.curatedPhysicalCoversMatched, 0);
});

test("a Discogs display image is ignored on the generic row cover path", async () => {
  const displayImageUrl = "https://i.discogs.com/generic-display-cover.jpg";
  const validatedUrls: string[] = [];
  const dependencies = baseDependencies([discogsRow(836)]);
  dependencies.discogs!.getRelease = async (id) => ({
    value: {
      ...discogsDetail(id, null),
      displayImageUrl,
    },
    warnings: [],
    rateLimit: null,
  });
  dependencies.validateCover = async (url) => {
    validatedUrls.push(url.toString());
    return validCover(url.toString());
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);

  assert.equal(cover.status, "MISSING");
  assert.equal(validatedUrls.includes(displayImageUrl), false);
});

test("Discogs WORK cover detail must preserve exact title, date, and catalog", async (t) => {
  const cases: Array<[string, Partial<DiscogsReleaseEvidence>]> = [
    ["title", { title: "別の作品" }],
    ["date", { released: "1982-05-02" }],
    ["catalog", { labels: [{ name: "Reprise Records", catalogNumber: "WRONG-1" }] }],
  ];
  for (const [name, detailOverride] of cases) {
    await t.test(name, async () => {
      const { prepared } = await prepareCuratedPhysicalFixture({
        physicalRows: [curatedPhysicalRow(840)],
        getRelease: async (releaseId) => ({
          value: {
            ...discogsDetail(releaseId, null),
            displayImageUrl: "https://i.discogs.com/wrong-cover.jpg",
            masterId: 88,
            title: "スローモーション = Slow Motion",
            artistCredit: "中森明菜",
            artists: [{ name: "中森明菜", anv: null, join: null }],
            year: 1982,
            released: "1982-05-01",
            country: "Japan",
            labels: [{ name: "Reprise Records", catalogNumber: "L-1600" }],
            formats: [{ name: "Vinyl", quantity: 1, descriptions: ["Single"] }],
            ...detailOverride,
          },
          warnings: [],
          rateLimit: null,
        }),
      });
      const candidate = prepared.candidates.find((item) =>
        item.candidate.id === "curated-akina-physical-test-single-1");
      assert.ok(candidate);
      const cover = await prepared.lookupValidatedCover(candidate);
      assert.equal(cover.status, "MISSING", name);
      assert.equal(prepared.sourceStats.curatedPhysicalCoversMatched, 0, name);
    });
  }
});

test("a catalog-bound NDL title difference becomes AI_REVIEW rather than rejection", async () => {
  const dependencies = baseDependencies();
  dependencies.ndl!.searchArtistInventory = async () => ndlResult(ndlRecord("Miho Nakayama / キャッチ・ザ・ナイト"));
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);
  assert.equal(prepared.candidates[0]?.conflicts[0]?.certainty, "AI_REVIEW");
  assert.equal(prepared.candidates[0]?.conflicts[0]?.reasonCode, "TITLE_CONFLICT");
  assert.equal(prepared.candidates[0]?.conflicts.some((item) => item.certainty === "EXPLICIT"), false);
});

test("source failures become retryable UNKNOWN observations without failing the preparation", async () => {
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, {
    ndl: {
      searchArtistInventory: async () => { throw new Error("NDL timeout"); },
      searchCatalogNumber: async () => { throw new Error("NDL timeout"); },
    },
    researchOfficial: async () => { throw new Error("official timeout"); },
    discogs: {
      searchJapanCdReleases: async () => { throw new Error("Discogs timeout"); },
      getRelease: async () => { throw new Error("must not run during evidence preparation"); },
    },
    musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
    validateCover: async (url: string | URL) => validCover(url.toString()),
    searchItunes: async () => { throw new Error("Apple timeout"); },
  });
  const sourceRows = prepared.candidates[0]!.observations.filter((item) =>
    ["ndl-search", "official-catalog", "discogs"].includes(item.provider));
  assert.equal(sourceRows.length, 3);
  assert.equal(sourceRows.every((item) => item.verdict === "UNKNOWN"), true);
  assert.equal(sourceRows.every((item) => item.retryable === true), true);
});

test("UNKNOWN scope candidates are researched but remain pending without resolving evidence", async () => {
  let calls = 0;
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate("UNKNOWN")],
  }, {
    ndl: {
      searchArtistInventory: async () => { calls += 1; return ndlResult(); },
      searchCatalogNumber: async () => { calls += 1; return ndlResult(); },
    },
    researchOfficial: async () => { calls += 1; return officialResult("unused"); },
    discogs: {
      searchJapanCdReleases: async () => { calls += 1; return discogsSearch([]); },
      getRelease: async () => { calls += 1; throw new Error("unused"); },
    },
    musicMetadata: { getCoverArt: async () => { calls += 1; return { value: null, warnings: [] }; } },
    validateCover: async (url: string | URL) => validCover(url.toString()),
    searchItunes: async () => { calls += 1; return []; },
  });
  assert.equal(calls, 4);
  assert.equal(prepared.sourceStats.scopeCandidates, 1);
  assert.equal(classifyComprehensiveEvidence({
    candidateId: prepared.candidates[0]!.candidate.id,
    workId: prepared.candidates[0]!.workId,
    editionId: prepared.candidates[0]!.editionId,
    title: prepared.candidates[0]!.candidate.title,
    artistCredit: prepared.candidates[0]!.candidate.artistCredit,
    observations: prepared.candidates[0]!.observations,
    conflicts: prepared.candidates[0]!.conflicts,
  }).reasonCode, "SCOPE_UNRESOLVED");
});

test("a work-rule OUT_OF_SCOPE skips candidate matching while global discovery stays available", async () => {
  let calls = 0;
  const candidate = comprehensiveCandidate();
  candidate.observations.push({
    ...candidate.observations[1]!,
    id: "scope:work-rule:excluded",
    provider: "cd-box-work-rules",
    verdict: "OUT_OF_SCOPE",
    reasonCode: "LATER_COMPOSITE_REISSUE_BUNDLE",
  });
  const dependencies = baseDependencies();
  dependencies.ndl!.searchArtistInventory = async () => { calls += 1; return ndlResult(); };
  dependencies.researchOfficial = async () => { calls += 1; return officialResult(candidate.candidate.id); };
  dependencies.discogs!.searchJapanCdReleases = async () => { calls += 1; return discogsSearch([]); };
  dependencies.searchItunes = async () => { calls += 1; return []; };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, dependencies);
  assert.equal(calls, 3);
  assert.equal(prepared.sourceStats.scopeCandidates, 0);
});

test("NDL authority plus an exact Japan CD Discogs row resolves an earlier UNKNOWN scope", async () => {
  const candidate = comprehensiveCandidate("UNKNOWN");
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, baseDependencies([discogsRow(91, { formats: ["CD", "Album"] })]));
  const enriched = prepared.candidates[0]!;
  assert.equal(classifyComprehensiveEvidence({
    candidateId: enriched.candidate.id,
    workId: enriched.workId,
    editionId: enriched.editionId,
    title: enriched.candidate.title,
    artistCredit: enriched.candidate.artistCredit,
    observations: enriched.observations,
    conflicts: enriched.conflicts,
  }).eligibleForAi, true);
});

test("cover lookup stops at an exact validated CAA cover before Discogs", async () => {
  let discogsDetails = 0;
  const validationOptions: unknown[] = [];
  const dependencies = baseDependencies([discogsRow(1)]);
  dependencies.validateCover = async (url, options) => {
    validationOptions.push(options);
    return validCover(url.toString());
  };
  dependencies.musicMetadata!.getCoverArt = async () => ({
    value: {
      entityType: "release" as const,
      sourceId: releaseId,
      imageUrl: `https://coverartarchive.org/release/${releaseId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${releaseId}`,
      approved: true,
      types: ["Front"],
    },
    warnings: [],
  });
  dependencies.discogs!.getRelease = async (id: number) => {
    discogsDetails += 1;
    return { value: discogsDetail(id, "https://i.discogs.com/cover.jpg"), warnings: [], rateLimit: null };
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "cover-art-archive");
  assert.equal(discogsDetails, 0);
  assert.deepEqual(validationOptions, [{ timeoutMs: 15_000, retryCount: 1 }]);
});

test("synthetic candidates never treat manifest MusicBrainz URLs as their CAA identities", async () => {
  const contaminatedReleaseId = "71873e32-972d-4359-8071-745061c39119";
  const manifestReleaseGroupId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const contaminatedImageUrl =
    `https://coverartarchive.org/release/${contaminatedReleaseId}/20509482470.jpg`;
  const titles = [
    "北ウイング／リ・フ・レ・イ・ン",
    "ノンフィクション エクスタシー",
    "The Heat 〜musica fiesta〜",
  ] as const;
  const candidates = titles.map((title, index) => {
    const candidate = comprehensiveCandidate("PASS", {
      id: `curated-akina-nakamori-single-${index + 1}`,
      title,
      titleOriginal: title,
      artistCredit: "中森明菜",
      releaseDate: `198${index + 4}-01-01`,
      originalReleaseDate: `198${index + 4}-01-01`,
      catalogNumber: null,
      sources: [
        {
          title: "Official canonical discography manifest",
          url: `https://musicbrainz.org/release/${contaminatedReleaseId}`,
          sourceType: "official",
        },
        {
          title: "Official canonical discography manifest",
          url: `https://musicbrainz.org/release-group/${manifestReleaseGroupId}`,
          sourceType: "official",
        },
      ],
    });
    return {
      ...candidate,
      workId: `curated-official-manifest:akina-nakamori:work:${index + 1}`,
      editionId: `curated-official-manifest:akina-nakamori:representation:SINGLE:${index + 1}`,
    };
  });
  const coverArtCalls: Array<{ entityType: string; sourceId: string }> = [];
  const dependencies = baseDependencies([]);
  dependencies.musicMetadata!.getCoverArt = async (entityType, sourceId) => {
    coverArtCalls.push({ entityType, sourceId });
    return {
      value: {
        entityType,
        sourceId,
        imageUrl: contaminatedImageUrl,
        sourceUrl: entityType === "release"
          ? `https://coverartarchive.org/release/${sourceId}`
          : `https://coverartarchive.org/release-group/${sourceId}`,
        approved: true,
        types: ["Front"],
      },
      warnings: [],
    };
  };
  const sourceResult = researchResult();
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: {
      ...sourceResult,
      releases: candidates.map((candidate) => candidate.candidate),
    },
    bundle: evidenceBundle(),
    candidates,
  }, dependencies);

  const covers = await Promise.all(
    prepared.candidates.map((candidate) => prepared.lookupValidatedCover(candidate)),
  );

  assert.deepEqual(coverArtCalls, []);
  assert.equal(covers.length, titles.length);
  covers.forEach((cover, index) => {
    assert.equal(cover.status, "MISSING", titles[index]);
    assert.equal(JSON.stringify(cover).includes(contaminatedReleaseId), false, titles[index]);
  });
});

test("a manifest-rebound edition recovers only its exact trusted MusicBrainz release observation", async () => {
  const candidate = {
    ...comprehensiveCandidate(),
    editionId: "curated-official-manifest:miho-nakayama:representation:ORIGINAL_ALBUM:4",
  };
  const coverArtCalls: string[] = [];
  const dependencies = baseDependencies([]);
  dependencies.musicMetadata!.getCoverArt = async (entityType, sourceId) => {
    coverArtCalls.push(`${entityType}:${sourceId}`);
    return {
      value: {
        entityType,
        sourceId,
        imageUrl: `https://coverartarchive.org/release/${sourceId}/front-500`,
        sourceUrl: `https://coverartarchive.org/release/${sourceId}`,
        approved: true,
        types: ["Front"],
      },
      warnings: [],
    };
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, dependencies);

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);

  assert.equal(cover.status, "FOUND");
  assert.deepEqual(coverArtCalls, [`release:${releaseId}`]);
});

test("a rebound edition rejects mismatched or duplicate MusicBrainz observation identities", async () => {
  for (const observations of [
    comprehensiveCandidate().observations.map((item) => item.stage === "MUSICBRAINZ"
      ? { ...item, sourceUrl: "https://musicbrainz.org/release/cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
      : item),
    [
      ...comprehensiveCandidate().observations,
      {
        ...comprehensiveCandidate().observations[0]!,
        id: "musicbrainz:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        sourceUrl: "https://musicbrainz.org/release/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    ],
  ]) {
    let coverArtCalls = 0;
    const dependencies = baseDependencies([]);
    dependencies.musicMetadata!.getCoverArt = async () => {
      coverArtCalls += 1;
      return { value: null, warnings: [] };
    };
    const candidate = {
      ...comprehensiveCandidate(),
      workId: "curated-official-manifest:miho-nakayama:work:ORIGINAL_ALBUM:4",
      editionId: "curated-official-manifest:miho-nakayama:representation:ORIGINAL_ALBUM:4",
      observations,
    };
    const prepared = await prepareComprehensiveSourceEvidence({
      request,
      result: researchResult(),
      bundle: evidenceBundle(),
      candidates: [candidate],
    }, dependencies);
    await prepared.lookupValidatedCover(prepared.candidates[0]!);
    assert.equal(coverArtCalls, 0);
  }
});

test("an existing CAA candidate and API result validate the same exact pair only once", async () => {
  const imageUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
  const sourceUrl = `https://coverartarchive.org/release/${releaseId}`;
  const validationCalls: Array<{ url: string; options: unknown }> = [];
  const dependencies = baseDependencies([]);
  dependencies.musicMetadata!.getCoverArt = async (entityType) => entityType === "release"
    ? {
        value: {
          entityType,
          sourceId: releaseId,
          imageUrl,
          sourceUrl,
          approved: true,
          types: ["Front"],
        },
        warnings: [],
      }
    : { value: null, warnings: [] };
  dependencies.validateCover = async (url, options) => {
    validationCalls.push({ url: url.toString(), options });
    return {
      ...validCover(url.toString()),
      ok: false,
      reason: "timeout",
      retryable: true,
      status: null,
    };
  };
  const candidate = comprehensiveCandidate("PASS", {
    coverImageUrl: imageUrl,
    coverImageSourceUrl: sourceUrl,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, dependencies);

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);

  assert.equal(cover.status, "UNAVAILABLE");
  assert.deepEqual(validationCalls, [{
    url: imageUrl,
    options: { timeoutMs: 15_000, retryCount: 1 },
  }]);
});

test("CAA pair deduplication still validates a different API image resource", async () => {
  const existingImageUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
  const apiImageUrl = `https://coverartarchive.org/release/${releaseId}/front-1200`;
  const sourceUrl = `https://coverartarchive.org/release/${releaseId}`;
  const validationCalls: Array<{ url: string; options: unknown }> = [];
  const dependencies = baseDependencies([]);
  dependencies.musicMetadata!.getCoverArt = async (entityType) => entityType === "release"
    ? {
        value: {
          entityType,
          sourceId: releaseId,
          imageUrl: apiImageUrl,
          sourceUrl,
          approved: true,
          types: ["Front"],
        },
        warnings: [],
      }
    : { value: null, warnings: [] };
  dependencies.validateCover = async (url, options) => {
    const value = url.toString();
    validationCalls.push({ url: value, options });
    return value === apiImageUrl
      ? validCover(value)
      : {
          ...validCover(value),
          ok: false,
          reason: "timeout",
          retryable: true,
          status: null,
        };
  };
  const candidate = comprehensiveCandidate("PASS", {
    coverImageUrl: existingImageUrl,
    coverImageSourceUrl: sourceUrl,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [candidate],
  }, dependencies);

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);

  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.imageUrl : null, apiImageUrl);
  assert.deepEqual(validationCalls, [
    { url: existingImageUrl, options: { timeoutMs: 15_000, retryCount: 1 } },
    { url: apiImageUrl, options: { timeoutMs: 15_000, retryCount: 1 } },
  ]);
});

test("a non-retryable CAA validation failure is not cached across a fresh lookup", async () => {
  let validationCalls = 0;
  const dependencies = baseDependencies([]);
  dependencies.musicMetadata!.getCoverArt = async (entityType, sourceId) => ({
    value: {
      entityType,
      sourceId,
      imageUrl: `https://coverartarchive.org/release/${sourceId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${sourceId}`,
      approved: true,
      types: ["Front"],
    },
    warnings: [],
  });
  dependencies.validateCover = async (url) => {
    validationCalls += 1;
    return validationCalls === 1
      ? {
          ...validCover(url.toString()),
          ok: false,
          reason: "invalid-image-data",
          retryable: false,
        }
      : validCover(url.toString());
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);

  const first = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  const second = await prepared.lookupValidatedCover(prepared.candidates[0]!);

  assert.equal(first.status, "INVALID");
  assert.equal(second.status, "FOUND");
  assert.equal(validationCalls, 2);
});

const beBopPeerReleaseIds = [
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
] as const;

function beBopCandidate(
  id: string,
  editionId: string,
  overrides: Partial<ReleaseResearchCandidate> = {},
): ComprehensiveDiscographyCandidate {
  return {
    ...comprehensiveCandidate("PASS", {
      id,
      title: "BE-BOP-HIGHSCHOOL",
      category: "SINGLE",
      releaseDate: "1985-12-18",
      originalReleaseDate: "1985-12-18",
      catalogNumber: null,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      sources: [
        {
          title: "MusicBrainz release group",
          url: `https://musicbrainz.org/release-group/${groupId}`,
          sourceType: "database",
        },
        {
          title: "MusicBrainz release",
          url: `https://musicbrainz.org/release/${editionId}`,
          sourceType: "database",
        },
      ],
      ...overrides,
    }),
    workId: groupId,
    editionId,
  };
}

test("cover lookup never promotes a peer CAA release cover to WORK artwork", async () => {
  const target = beBopCandidate("be-bop-target", releaseId);
  const peerReleaseId = beBopPeerReleaseIds[0];
  const peerImageUrl = `https://coverartarchive.org/release/${peerReleaseId}/front-500`;
  const peer = beBopCandidate("be-bop-peer", peerReleaseId, {
    title: "be bop high school",
    coverImageUrl: peerImageUrl,
    coverImageSourceUrl: `https://coverartarchive.org/release/${peerReleaseId}`,
  });
  const validatedUrls: string[] = [];
  const validationOptions: unknown[] = [];
  const dependencies = baseDependencies([]);
  dependencies.validateCover = async (url: string | URL, options) => {
    validatedUrls.push(url.toString());
    validationOptions.push(options);
    return validCover(url.toString());
  };

  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [target, peer],
  }, dependencies);
  const preparedTarget = prepared.candidates.find((candidate) =>
    candidate.candidate.id === target.candidate.id)!;
  const cover = await prepared.lookupValidatedCover(preparedTarget);

  assert.equal(cover.status, "INVALID");
  assert.deepEqual(validatedUrls, []);
  assert.deepEqual(validationOptions, []);
});

test("peer CAA release cover fallback rejects a different full title or original release date", async (t) => {
  for (const mismatch of [
    { name: "title", overrides: { title: "BE-BOP-HIGHSCHOOL OST" } },
    { name: "date", overrides: { originalReleaseDate: "1986-01-01" } },
  ] satisfies Array<{ name: string; overrides: Partial<ReleaseResearchCandidate> }>) {
    await t.test(mismatch.name, async () => {
      const target = beBopCandidate(`be-bop-${mismatch.name}-target`, releaseId);
      const peerReleaseId = beBopPeerReleaseIds[0];
      const peerImageUrl = `https://coverartarchive.org/release/${peerReleaseId}/front-500`;
      const peer = beBopCandidate(`be-bop-${mismatch.name}-peer`, peerReleaseId, {
        coverImageUrl: peerImageUrl,
        coverImageSourceUrl: `https://coverartarchive.org/release/${peerReleaseId}`,
        ...mismatch.overrides,
      });
      const validatedUrls: string[] = [];
      const dependencies = baseDependencies([]);
      dependencies.validateCover = async (url: string | URL) => {
        validatedUrls.push(url.toString());
        return validCover(url.toString());
      };

      const prepared = await prepareComprehensiveSourceEvidence({
        request,
        result: researchResult(),
        bundle: evidenceBundle(),
        candidates: [target, peer],
      }, dependencies);
      const preparedTarget = prepared.candidates.find((candidate) =>
        candidate.candidate.id === target.candidate.id)!;
      const cover = await prepared.lookupValidatedCover(preparedTarget);

      assert.equal(cover.status, "MISSING");
      assert.deepEqual(validatedUrls, []);
    });
  }
});

test("peer CAA release cover fallback rejects multiple different exact covers", async () => {
  const target = beBopCandidate("be-bop-ambiguous-target", releaseId);
  const peers = beBopPeerReleaseIds.map((peerReleaseId, index) =>
    beBopCandidate(`be-bop-ambiguous-peer-${index}`, peerReleaseId, {
      coverImageUrl: `https://coverartarchive.org/release/${peerReleaseId}/front-500`,
      coverImageSourceUrl: `https://coverartarchive.org/release/${peerReleaseId}`,
    }));
  const validatedUrls: string[] = [];
  const dependencies = baseDependencies([]);
  dependencies.validateCover = async (url: string | URL) => {
    validatedUrls.push(url.toString());
    return validCover(url.toString());
  };

  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [target, ...peers],
  }, dependencies);
  const preparedTarget = prepared.candidates.find((candidate) =>
    candidate.candidate.id === target.candidate.id)!;
  const cover = await prepared.lookupValidatedCover(preparedTarget);

  assert.equal(cover.status, "MISSING");
  assert.deepEqual(validatedUrls, []);
});

test("cover lookup falls back from CAA to an exact Discogs primary image", async () => {
  const dependencies = baseDependencies([discogsRow(9)]);
  dependencies.discogs!.getRelease = async (id: number) => ({
    value: discogsDetail(id, "https://i.discogs.com/verified-cover.jpg"),
    warnings: [],
    rateLimit: null,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "discogs");
  assert.equal(cover.status === "FOUND" ? cover.sourceUrl : null, "https://www.discogs.com/release/9");
});

test("persisted cover retry contacts only the exact raw-bundle CAA release", async () => {
  // Older schema-v2 tasks may have a null scalar format when raw evidence
  // preserved multiple media values. The exact raw release still proves CD.
  const candidate = comprehensiveCandidate("PASS", { format: null });
  const calls: Array<[string, string]> = [];
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: bundleWithRelease(),
  }, {
    musicMetadata: {
      getCoverArt: async (entityType, id) => {
        calls.push([entityType, id]);
        return {
          value: {
            entityType: "release" as const,
            sourceId: releaseId,
            imageUrl: `https://coverartarchive.org/release/${releaseId}/front-500`,
            sourceUrl: `https://coverartarchive.org/release/${releaseId}`,
            approved: true,
            types: ["Front"],
          },
          warnings: [],
        };
      },
    },
    discogs: {
      getRelease: async () => {
        assert.fail("A CAA-only retry must not contact Discogs.");
      },
    },
    validateCover: async (url) => validCover(url.toString()),
    now: () => new Date("2026-07-13T00:00:00.000Z"),
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "cover-art-archive");
  assert.deepEqual(calls, [["release", releaseId]]);
});

test("persisted cover retry fetches only Discogs release ids sealed into PASS evidence", async () => {
  const candidate = comprehensiveCandidate();
  candidate.observations.push({
    id: `discogs:${candidate.candidate.id}`,
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "DISCOGS_EXACT_EDITION_MATCH",
    reason: "Persisted exact tuple.",
    sourceUrl: "https://www.discogs.com/release/9",
    matchedFields: ["artist", "title", "catalogNumber", "year", "country", "format"],
    facts: {
      artist: "Miho Nakayama",
      title: "CATCH THE NITE",
      catalogNumber: "K32X-240",
      year: "1988",
      releaseIds: "9",
    },
  });
  const releaseCalls: number[] = [];
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: evidenceBundle(),
  }, {
    musicMetadata: {
      getCoverArt: async () => {
        assert.fail("A task without an exact raw MusicBrainz release must not call CAA.");
      },
    },
    discogs: {
      getRelease: async (id) => {
        releaseCalls.push(id);
        return {
          value: discogsDetail(id, "https://i.discogs.com/persisted-exact.jpg"),
          warnings: [],
          rateLimit: null,
        };
      },
    },
    validateCover: async (url) => validCover(url.toString()),
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "discogs");
  assert.deepEqual(releaseCalls, [9]);
});

test("persisted Discogs retry fails closed when the exact release date identity changes", async () => {
  const candidate = comprehensiveCandidate();
  candidate.observations.push({
    id: `discogs:${candidate.candidate.id}`,
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "DISCOGS_EXACT_EDITION_MATCH",
    reason: "Persisted exact tuple.",
    sourceUrl: "https://www.discogs.com/release/9",
    matchedFields: ["artist", "title", "catalogNumber", "year", "country", "format"],
    facts: {
      artist: "Miho Nakayama",
      title: "CATCH THE NITE",
      catalogNumber: "K32X-240",
      year: "1988",
      releaseIds: "9",
    },
  });
  let validationCalls = 0;
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: evidenceBundle(),
  }, {
    discogs: {
      getRelease: async (id) => ({
        value: {
          ...discogsDetail(id, "https://i.discogs.com/wrong-date.jpg"),
          released: "1988-09-01",
        },
        warnings: [],
        rateLimit: null,
      }),
    },
    musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
    validateCover: async (url) => {
      validationCalls += 1;
      return validCover(url.toString());
    },
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "INVALID");
  assert.equal(validationCalls, 0);
});

test("persisted exact provider outages remain retryable without discovery fallback", async () => {
  const candidate = comprehensiveCandidate();
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: bundleWithRelease(),
  }, {
    musicMetadata: {
      getCoverArt: async () => {
        throw new Error("temporary CAA outage");
      },
    },
    discogs: { getRelease: async () => ({ value: null, warnings: [], rateLimit: null }) },
    validateCover: async (url) => validCover(url.toString()),
  });

  const cover = await lookup(candidate);
  assert.deepEqual(cover, {
    status: "UNAVAILABLE",
    reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
    reason: "One or more persisted exact cover sources were temporarily unavailable.",
    retryable: true,
  });
});

test("persisted retry revalidates only an identity-bound official work cover", async () => {
  const candidate = comprehensiveCandidate();
  candidate.observations.push(
    {
      id: "curated-official-manifest:test:authority",
      provider: "curated-official-manifest:test",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "Persisted canonical identity.",
      sourceUrl: "https://www.seikomatsuda.co.jp/discography/detail/115",
      matchedFields: ["artist", "title", "category", "date"],
      facts: { manifestEntryKey: "ORIGINAL_ALBUM:1" },
    },
    {
      id: "seiko-matsuda-official:entity:ORIGINAL_ALBUM:1",
      provider: "seiko-matsuda-official",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
      reason: "Persisted exact official entity and cover.",
      sourceUrl: "https://www.seikomatsuda.co.jp/discography/detail/115",
      matchedFields: ["artist", "title", "category", "date"],
      facts: {
        manifestEntryKey: "ORIGINAL_ALBUM:1",
        canonicalTitle: "CATCH THE NITE",
        date: "1988-02-10",
        coverUrl: "https://www.seikomatsuda.co.jp/discography/images/upload/exact.jpg",
      },
    },
  );
  const validated: string[] = [];
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: evidenceBundle(),
  }, {
    musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
    discogs: { getRelease: async () => ({ value: null, warnings: [], rateLimit: null }) },
    validateCover: async (url) => {
      validated.push(url.toString());
      return validCover(url.toString());
    },
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "official-label");
  assert.deepEqual(validated, [
    "https://www.seikomatsuda.co.jp/discography/images/upload/exact.jpg",
  ]);
});

test("persisted retry fails closed for a legacy Apple URL without an exact entity binding", async () => {
  const candidate = comprehensiveCandidate("PASS", {
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/test/600x600bb.jpg",
    coverImageSourceUrl: "https://music.apple.com/jp/album/catch-the-nite/123456789",
  });
  let appleLookups = 0;
  let validations = 0;
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    bundle: evidenceBundle(),
  }, {
    musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
    discogs: { getRelease: async () => ({ value: null, warnings: [], rateLimit: null }) },
    lookupItunesAlbum: async () => {
      appleLookups += 1;
      throw new Error("legacy URL-only rows must not contact Apple");
    },
    validateCover: async (url) => {
      validations += 1;
      return validCover(url.toString());
    },
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "MISSING");
  assert.equal(appleLookups, 0);
  assert.equal(validations, 0);
});

test("persisted retry re-fetches and validates the exact bound Apple collection entity", async () => {
  const candidate = comprehensiveCandidate();
  const appleAlbum: ItunesAlbumResult = {
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NITE",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  };
  const appleEditionBinding = createPersistedItunesEditionCoverBinding(
    candidate.candidate,
    appleAlbum,
    "Miho Nakayama",
  );
  assert.ok(appleEditionBinding);
  const result: ComprehensiveCandidateResult = {
    candidate: candidate.candidate,
    workId: candidate.workId,
    editionId: candidate.editionId,
    resolution: "PENDING_COVER",
    evidenceVerdict: "PASS",
    aiDecision: null,
    cover: {
      status: "UNAVAILABLE",
      reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
      reason: "Apple image delivery was temporarily unavailable.",
      retryable: true,
      appleEditionBinding,
    },
    ledger: [],
  };
  const lookedUp: number[] = [];
  const validated: string[] = [];
  const lookup = createPersistedCoverRetryLookup({
    candidates: [candidate],
    results: [result],
    bundle: evidenceBundle(),
  }, {
    musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
    discogs: { getRelease: async () => ({ value: null, warnings: [], rateLimit: null }) },
    lookupItunesAlbum: async (collectionId) => {
      lookedUp.push(collectionId);
      return appleAlbum;
    },
    validateCover: async (url) => {
      validated.push(url.toString());
      return validCover(url.toString());
    },
  });

  const cover = await lookup(candidate);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "apple-music");
  assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "EDITION");
  assert.deepEqual(lookedUp, [44]);
  assert.deepEqual(validated, [
    "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
  ]);
  assert.equal(
    cover.status === "FOUND" ? cover.appleEditionBinding?.artistId : null,
    99,
  );
});

test("persisted retry rejects Apple entity metadata that changed title, artist, or day", async () => {
  const candidate = comprehensiveCandidate();
  const appleAlbum: ItunesAlbumResult = {
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NITE",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  };
  const appleEditionBinding = createPersistedItunesEditionCoverBinding(
    candidate.candidate,
    appleAlbum,
    "Miho Nakayama",
  );
  assert.ok(appleEditionBinding);
  const result: ComprehensiveCandidateResult = {
    candidate: candidate.candidate,
    workId: candidate.workId,
    editionId: candidate.editionId,
    resolution: "PENDING_COVER",
    evidenceVerdict: "PASS",
    aiDecision: null,
    cover: {
      status: "UNAVAILABLE",
      reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
      reason: "Apple image delivery was temporarily unavailable.",
      retryable: true,
      appleEditionBinding,
    },
    ledger: [],
  };
  for (const changed of [
    { ...appleAlbum, artistId: 100 },
    { ...appleAlbum, collectionName: "Different Album" },
    { ...appleAlbum, releaseDate: "1988-12-10T00:00:00Z" },
  ]) {
    let validations = 0;
    const lookup = createPersistedCoverRetryLookup({
      candidates: [candidate],
      results: [result],
      bundle: evidenceBundle(),
    }, {
      musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
      discogs: { getRelease: async () => ({ value: null, warnings: [], rateLimit: null }) },
      lookupItunesAlbum: async () => changed,
      validateCover: async (url) => {
        validations += 1;
        return validCover(url.toString());
      },
    });
    const cover = await lookup(candidate);
    assert.equal(cover.status, "INVALID");
    assert.equal(validations, 0);
  }
});

test("a retryable Discogs refresh is discarded so the next cover retry performs a new search", async () => {
  const dependencies = baseDependencies([]);
  let searchCalls = 0;
  dependencies.discogs!.searchJapanCdReleases = async () => {
    searchCalls += 1;
    const retryable = searchCalls < 3;
    const rows = retryable ? [] : [discogsRow(9)];
    return {
      ...discogsSearch(rows),
      value: {
        ...discogsSearch(rows).value,
        partial: retryable,
      },
      warnings: retryable
        ? [{ code: "unavailable" as const, message: "Discogs temporarily unavailable.", retryable: true }]
        : [],
    };
  };
  dependencies.discogs!.getRelease = async (id: number) => ({
    value: discogsDetail(id, "https://i.discogs.com/recovered-cover.jpg"),
    warnings: [],
    rateLimit: null,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);

  const first = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  const second = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(first.status, "UNAVAILABLE");
  assert.equal(second.status === "FOUND" ? second.provider : null, "discogs");
  assert.equal(searchCalls, 3);
});

test("cover lookup uses an exact preloaded Apple match after checking exact edition sources", async () => {
  const dependencies = baseDependencies([]);
  let coverArtArchiveCalls = 0;
  let discogsDetailCalls = 0;
  dependencies.musicMetadata!.getCoverArt = async () => {
    coverArtArchiveCalls += 1;
    return { value: null, warnings: [] };
  };
  dependencies.discogs!.getRelease = async (id: number) => {
    discogsDetailCalls += 1;
    return { value: discogsDetail(id, null), warnings: [], rateLimit: null };
  };
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NITE",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  }];
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "apple-music");
  assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "EDITION");
  assert.equal(cover.status === "FOUND" ? cover.sourceReleaseDate : null, "1988-02-10T00:00:00Z");
  assert.equal(cover.status === "FOUND" ? cover.appleEditionBinding?.collectionId : null, 44);
  assert.equal(cover.status === "FOUND" ? cover.appleEditionBinding?.releaseDate : null, "1988-02-10");
  assert.match(cover.status === "FOUND" ? cover.imageUrl : "", /600x600bb\.jpg$/);
  assert.equal(coverArtArchiveCalls, 2);
  assert.equal(discogsDetailCalls, 0);
});

test("a transient exact Apple image failure persists the complete entity binding for retry", async () => {
  const dependencies = baseDependencies([]);
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NITE",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  }];
  dependencies.validateCover = async (url) => ({
    ...validCover(url.toString()),
    ok: false,
    reason: "timeout",
    retryable: true,
    status: 503,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "UNAVAILABLE");
  assert.equal(cover.appleEditionBinding?.collectionId, 44);
  assert.equal(cover.appleEditionBinding?.artistId, 99);
  assert.equal(cover.appleEditionBinding?.artistName, "Miho Nakayama");
  assert.equal(cover.appleEditionBinding?.collectionName, "CATCH THE NITE");
  assert.equal(cover.appleEditionBinding?.releaseDate, "1988-02-10");
  assert.equal(cover.appleEditionBinding?.candidateIdentity.releaseDate, "1988-02-10");
});

test("cover lookup rejects an approved MusicBrainz release-group cover as final WORK artwork", async () => {
  const dependencies = baseDependencies([]);
  const entityTypes: string[] = [];
  const validationOptions: unknown[] = [];
  dependencies.validateCover = async (url, options) => {
    validationOptions.push(options);
    return validCover(url.toString());
  };
  dependencies.musicMetadata!.getCoverArt = async (entityType, sourceId) => {
    entityTypes.push(entityType);
    return entityType === "release-group"
      ? {
          value: {
            entityType,
            sourceId,
            imageUrl: `https://coverartarchive.org/release-group/${sourceId}/front-500`,
            sourceUrl: `https://coverartarchive.org/release-group/${sourceId}`,
            approved: true,
            types: ["Front"],
          },
          warnings: [],
        }
      : { value: null, warnings: [] };
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, dependencies);
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "INVALID");
  assert.deepEqual(entityTypes, ["release", "release-group"]);
  assert.deepEqual(validationOptions, []);
});

test("a later unique Apple digital issue is retained only as an explicit WORK cover", async () => {
  const dependencies = baseDependencies([]);
  const identityCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "itunes-work-identity",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "itunes-work-identity-work",
    editionId: "itunes-work-identity-edition",
  };
  const albums: ItunesAlbumResult[] = [{
    collectionId: 33,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "SUMMER BREEZE",
    releaseDate: "1986-07-01T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/identity/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/33",
  }, {
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NITE",
    releaseDate: "2015-09-16T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/work-cover/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite-single/44",
  }];
  dependencies.searchItunes = async () => albums;
  dependencies.searchItunesByTitle = async () => albums;

  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), identityCandidate],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "FOUND");
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "apple-music");
  assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "WORK");
  assert.equal(cover.status === "FOUND" ? cover.sourceReleaseDate : null, "2015-09-16T00:00:00Z");
});

test("ambiguous same-title Apple collections are rejected even as WORK covers", async () => {
  const dependencies = baseDependencies([]);
  const identityCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "itunes-ambiguous-identity",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "itunes-ambiguous-identity-work",
    editionId: "itunes-ambiguous-identity-edition",
  };
  const albums: ItunesAlbumResult[] = [
    {
      collectionId: 33,
      artistId: 99,
      artistName: "Miho Nakayama",
      collectionName: "SUMMER BREEZE",
      releaseDate: "1986-07-01T00:00:00Z",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/identity/100x100bb.jpg",
      collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/33",
    },
    ...[44, 45].map((collectionId) => ({
      collectionId,
      artistId: 99,
      artistName: "Miho Nakayama",
      collectionName: "CATCH THE NITE - Single",
      releaseDate: `${collectionId === 44 ? "2015" : "2020"}-09-16T00:00:00Z`,
      artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Music/work-${collectionId}/100x100bb.jpg`,
      collectionViewUrl: `https://music.apple.com/jp/album/catch-the-nite/${collectionId}`,
    })),
  ];
  dependencies.searchItunes = async () => albums;
  dependencies.searchItunesByTitle = async () => [albums[1]!];
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), identityCandidate],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "MISSING");
  assert.equal(cover.status === "MISSING" ? cover.reasonCode : null, "EXACT_COVER_NOT_FOUND");
});

test("an unavailable Apple artist refresh is discarded so the next cover retry contacts Apple again", async () => {
  const dependencies = baseDependencies([]);
  let artistSearchCalls = 0;
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => {
    artistSearchCalls += 1;
    if (artistSearchCalls < 3) throw new Error("temporary Apple outage");
    return [{
      collectionId: 44,
      artistId: 99,
      artistName: "Miho Nakayama",
      collectionName: "CATCH THE NITE",
      releaseDate: "1988-02-10T00:00:00Z",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/recovered/100x100bb.jpg",
      collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
    }];
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate()],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  const first = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  const second = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(first.status, "UNAVAILABLE");
  assert.equal(second.status === "FOUND" ? second.provider : null, "apple-music");
  assert.equal(artistSearchCalls, 3);
});

test("cover lookup performs one exact albumTerm search when artist results omit the target", async () => {
  const dependencies = baseDependencies([]);
  const other = {
    ...comprehensiveCandidate("PASS", {
      id: "release-other-album",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "work-other-album",
    editionId: "edition-other-album",
  };
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 33,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "SUMMER BREEZE",
    releaseDate: "1986-07-01T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/other/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/33",
  }];
  let titleSearchCalls = 0;
  dependencies.searchItunesByTitle = async (title): Promise<ItunesAlbumResult[]> => {
    titleSearchCalls += 1;
    assert.equal(title, "CATCH THE NITE");
    return [{
      collectionId: 44,
      artistId: 99,
      artistName: "Miho Nakayama",
      collectionName: "CATCH THE NITE",
      releaseDate: "1988-02-10T00:00:00Z",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/target/100x100bb.jpg",
      collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
    }];
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), other],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  assert.equal(prepared.sourceStats.itunesTitleCalls, 0);
  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status === "FOUND" ? cover.provider : null, "apple-music");
  assert.match(cover.status === "FOUND" ? cover.imageUrl : "", /600x600bb\.jpg$/);
  assert.equal(titleSearchCalls, 1);
  assert.equal(prepared.sourceStats.itunesTitleCalls, 1);

  await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(titleSearchCalls, 1);
  assert.equal(prepared.sourceStats.itunesTitleCalls, 1);
});

test("a romanized albumTerm result may supply only a date-bound WORK cover", async () => {
  const dependencies = baseDependencies([]);
  const identityCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "itunes-romanized-identity",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "itunes-romanized-identity-work",
    editionId: "itunes-romanized-identity-edition",
  };
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 33,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "SUMMER BREEZE",
    releaseDate: "1986-07-01T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/identity/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/33",
  }];
  dependencies.searchItunesByTitle = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 44,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "CATCH THE NIGHT",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/romanized/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-night/44",
  }];
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), identityCandidate],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "WORK");
  assert.equal(cover.status === "FOUND" ? cover.sourceReleaseDate : null, "1988-02-10T00:00:00Z");
});

test("date-only Apple matching never uses an unrelated artist-inventory row", async () => {
  const dependencies = baseDependencies([]);
  const identityCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "itunes-unrelated-identity",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "itunes-unrelated-identity-work",
    editionId: "itunes-unrelated-identity-edition",
  };
  const inventoryRows: ItunesAlbumResult[] = [{
    collectionId: 32,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "SUMMER BREEZE",
    releaseDate: "1986-07-01T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/identity/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/32",
  }, {
    collectionId: 33,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "UNRELATED ALBUM",
    releaseDate: "1988-02-10T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/unrelated/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/unrelated/33",
  }];
  dependencies.searchItunes = async () => inventoryRows;
  dependencies.searchItunesByTitle = async () => [];
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), identityCandidate],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });

  const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(cover.status, "MISSING");
});

test("a failed albumTerm search remains retryable and is not cached as a permanent miss", async () => {
  const dependencies = baseDependencies([]);
  dependencies.searchItunes = async (): Promise<ItunesAlbumResult[]> => [{
    collectionId: 33,
    artistId: 99,
    artistName: "Miho Nakayama",
    collectionName: "SUMMER BREEZE",
    releaseDate: "1986-07-01T00:00:00Z",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/other/100x100bb.jpg",
    collectionViewUrl: "https://music.apple.com/jp/album/summer-breeze/33",
  }];
  let titleSearchCalls = 0;
  dependencies.searchItunesByTitle = async (): Promise<ItunesAlbumResult[]> => {
    titleSearchCalls += 1;
    if (titleSearchCalls === 1) throw new Error("temporary Apple outage");
    return [{
      collectionId: 44,
      artistId: 99,
      artistName: "Miho Nakayama",
      collectionName: "CATCH THE NITE",
      releaseDate: "1988-02-10T00:00:00Z",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/target/100x100bb.jpg",
      collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
    }];
  };
  const identityCandidate = {
    ...comprehensiveCandidate("PASS", {
      id: "itunes-identity-candidate",
      title: "SUMMER BREEZE",
      releaseDate: "1986-07-01",
      originalReleaseDate: "1986-07-01",
      catalogNumber: "K32X-100",
    }),
    workId: "itunes-identity-work",
    editionId: "itunes-identity-edition",
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), identityCandidate],
  }, {
    ...dependencies,
    limits: { minimumItunesArtistCollections: 1 },
  });
  const first = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  const second = await prepared.lookupValidatedCover(prepared.candidates[0]!);
  assert.equal(first.status, "UNAVAILABLE");
  assert.equal(second.status === "FOUND" ? second.provider : null, "apple-music");
  assert.equal(titleSearchCalls, 2);
  assert.equal(prepared.sourceStats.itunesTitleCalls, 2);
});

test("concurrent candidates share one Discogs detail request by release id", async () => {
  const dependencies = baseDependencies([discogsRow(9)]);
  let detailCalls = 0;
  dependencies.discogs!.getRelease = async (id: number) => {
    detailCalls += 1;
    return {
      value: discogsDetail(id, "https://i.discogs.com/shared-cover.jpg"),
      warnings: [],
      rateLimit: null,
    };
  };
  const second = {
    ...comprehensiveCandidate("PASS", { id: "second-candidate" }),
    workId: "second-work",
    editionId: "second-edition",
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate(), second],
  }, dependencies);
  const covers = await Promise.all(prepared.candidates.map((candidate) =>
    prepared.lookupValidatedCover(candidate)));
  assert.equal(covers.every((cover) => cover.status === "FOUND"), true);
  assert.equal(detailCalls, 1);
});

test("catalog absence remains UNKNOWN and does not trigger an unbounded NDL lookup", async () => {
  let catalogCalls = 0;
  const dependencies = baseDependencies();
  dependencies.ndl!.searchCatalogNumber = async () => {
    catalogCalls += 1;
    return ndlResult();
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: evidenceBundle(),
    candidates: [comprehensiveCandidate("PASS", { catalogNumber: null })],
  }, dependencies);
  const ndl = prepared.candidates[0]?.observations.find((item) => item.provider === "ndl-search");
  assert.equal(ndl?.verdict, "UNKNOWN");
  assert.equal(ndl?.reasonCode, "NDL_CANDIDATE_INCOMPLETE");
  assert.equal(catalogCalls, 0);
});

const akinaFixedReleaseIds = {
  liar: "f431289c-d0a5-4907-8704-34781bf26a59",
  kataomoi: "a7d708fc-735e-4f71-b6fd-a9310037b3d0",
} as const;

function akinaFixedMusicBrainzRelease(
  id: string,
  overrides: Partial<MusicReleaseEvidence> = {},
): MusicReleaseEvidence {
  const kataomoi = id === akinaFixedReleaseIds.kataomoi;
  const catalogNumber = kataomoi ? "MVDD-10004" : "09L3-4070";
  return {
    entityType: "release",
    sourceId: id,
    releaseGroupId: kataomoi
      ? "6f2ae23b-54c6-4a8e-80da-d00163450c13"
      : "3a17841f-b70b-3c13-8814-9cad695cd838",
    title: kataomoi ? "片想い・愛撫" : "LIAR",
    artistCredit: "中森明菜",
    artistNames: ["中森明菜"],
    artistAliases: [],
    date: kataomoi ? "1994-03-24" : "1989-04-25",
    type: "Single",
    secondaryTypes: [],
    country: "JP",
    label: kataomoi ? "MCA Victor" : "Reprise Records",
    catalogNumber,
    format: "8cm CD",
    labels: [{ name: kataomoi ? "MCA Victor" : "Reprise Records", catalogNumber }],
    formats: ["8cm CD"],
    barcode: null,
    status: "Official",
    sourceUrl: `https://musicbrainz.org/release/${id}`,
    // A release lookup may expose artwork, but the fixed identity bridge must
    // never promote it or derive a CAA lookup from the manifest source URL.
    coverUrl: "https://coverartarchive.org/release/test/front.jpg",
    coverSourceUrl: "https://coverartarchive.org/release/test",
    sources: [],
    ...overrides,
  };
}

function akinaFixedNdlRecords(): NdlRecord[] {
  return [
    {
      recordId: "R100000002-I000009059584",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000009059584",
      title: "中森明菜 / 夜のどこかで ～night shift～",
      creators: ["中森明菜"],
      publishers: ["MCA Victor"],
      issued: "1994-09-02",
      issuedRaw: "1994-09-02",
      issuedPrecision: "day",
      identifiers: ["MVDD-10007"],
      identifierDetails: [{ value: "MVDD-10007", scheme: null }],
      catalogNumbers: ["MVDD-10007"],
    },
    {
      recordId: "R100000002-I000009061321",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000009061321",
      title: "中森明菜 / 帰省 ～Never Forget～",
      creators: ["中森明菜"],
      publishers: ["Gauss Entertainment"],
      issued: "1998-02-11",
      issuedRaw: "1998-02-11",
      issuedPrecision: "day",
      identifiers: ["GRDO-10"],
      identifierDetails: [{ value: "GRDO-10", scheme: null }],
      catalogNumbers: ["GRDO-10"],
    },
  ];
}

function akinaLiveNdlRecords(): NdlRecord[] {
  return akinaFixedNdlRecords().map((record) => ({
    ...record,
    // NDL OpenSearch exposes these two CD records under the artist name and
    // month precision; the exact record page remains the manifest-bound URL.
    title: "中森明菜",
    creators: [],
    issued: record.issued?.slice(0, 7) ?? null,
    issuedRaw: record.issued?.slice(0, 7) ?? null,
    issuedPrecision: "month" as const,
  }));
}

type AkinaGetRelease = NonNullable<
  NonNullable<ComprehensiveSourceAdapterDependencies["musicMetadata"]>["getRelease"]
>;

async function prepareAkinaFixedCarrierFixture(options: {
  getRelease?: AkinaGetRelease;
  ndlRecords?: NdlRecord[];
} = {}) {
  const manifest = findCuratedArtistDiscography(null, ["中森明菜"]);
  assert.ok(manifest);
  const requestedReleaseIds: string[] = [];
  let coverCalls = 0;
  const records = options.ndlRecords ?? akinaLiveNdlRecords();
  const ndl: NdlClientResult = {
    value: {
      queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch",
      sourceTotal: records.length,
      records,
      complete: true,
    },
    warnings: [],
  };
  const defaultGetRelease: AkinaGetRelease = async (id) => {
    requestedReleaseIds.push(id);
    return { value: akinaFixedMusicBrainzRelease(id), warnings: [] };
  };
  const injectedGetRelease = options.getRelease ?? defaultGetRelease;
  const dependencies = baseDependencies([]);
  dependencies.useCuratedManifests = true;
  dependencies.findCuratedDiscography = () => manifest;
  dependencies.ndl = {
    searchArtistInventory: async () => ndl,
    searchCatalogNumber: async () => ndl,
  };
  dependencies.researchOfficial = async () => ({
    candidates: [],
    warnings: [],
    stats: {
      rootsAccepted: 0,
      pagesAttempted: 0,
      pagesFetched: 0,
      pagesDiscovered: 0,
      candidatesInspected: 0,
      candidatesMatched: 0,
      ambiguousCandidates: 0,
    },
  });
  dependencies.musicMetadata = {
    getRelease: async (id) => {
      if (options.getRelease) requestedReleaseIds.push(id);
      return injectedGetRelease(id);
    },
    getCoverArt: async () => {
      coverCalls += 1;
      return { value: null, warnings: [] };
    },
  };
  dependencies.limits = {
    maxScopeCandidates: 500,
    maxNdlCatalogLookups: 0,
    maxOfficialCandidates: 0,
    maxDiscogsQueries: 0,
    maxCuratedPhysicalQueries: 0,
    maxItunesTitleLookups: 0,
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: { ...request, artistName: "中森明菜" },
    result: {
      ...researchResult(),
      artist: {
        name: "中森明菜",
        nameKana: "なかもり あきな",
        nameRomaji: "Akina Nakamori",
        country: "JP",
        officialSiteUrl: null,
      },
    },
    bundle: {
      ...evidenceBundle(),
      query: { artistName: "中森明菜", targetCountry: "JP", target: "ORIGINAL_CD" },
      works: [],
    },
    candidates: [],
  }, dependencies);
  return { prepared, requestedReleaseIds, coverCalls: () => coverCalls };
}

function akinaCandidateByKey(
  prepared: Awaited<ReturnType<typeof prepareAkinaFixedCarrierFixture>>["prepared"],
  key: string,
) {
  const candidate = prepared.candidates.find((item) => item.editionId ===
    `curated-official-manifest:akina-nakamori:representation:${key}`);
  assert.ok(candidate);
  return candidate;
}

function classifyPreparedCandidate(candidate: ComprehensiveDiscographyCandidate) {
  return classifyComprehensiveEvidence({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  });
}

test("Akina's four manifest-fixed same-work CD carriers bind by exact UUID or exact NDL URL", async () => {
  const fixture = await prepareAkinaFixedCarrierFixture();
  assert.deepEqual(new Set(fixture.requestedReleaseIds), new Set(Object.values(akinaFixedReleaseIds)));
  for (const key of ["SINGLE:26", "SINGLE:31"]) {
    const candidate = akinaCandidateByKey(fixture.prepared, key);
    assert.equal(candidate.observations.filter((item) =>
      item.reasonCode === "AKINA_FIXED_MUSICBRAINZ_CD_CARRIER_MATCH").length, 1);
    assert.deepEqual(classifyPreparedCandidate(candidate), {
      verdict: "PASS",
      reasonCode: "EVIDENCE_READY",
      eligibleForAi: true,
    });
  }
  for (const key of ["SINGLE:32", "SINGLE:38"]) {
    const candidate = akinaCandidateByKey(fixture.prepared, key);
    assert.equal(candidate.observations.filter((item) =>
      item.reasonCode === "AKINA_FIXED_NDL_CD_CARRIER_MATCH").length, 1,
    JSON.stringify(candidate.observations.filter((item) => item.provider === "ndl-search")));
    assert.equal(candidate.conflicts.filter((item) =>
      item.certainty === "AI_REVIEW" && item.reasonCode === "TITLE_CONFLICT").length, 1);
    assert.deepEqual(classifyPreparedCandidate(candidate), {
      verdict: "PASS",
      reasonCode: "EVIDENCE_READY",
      eligibleForAi: true,
    });
  }
  const liar = akinaCandidateByKey(fixture.prepared, "SINGLE:26");
  await fixture.prepared.lookupValidatedCover(liar);
  assert.equal(fixture.coverCalls(), 0);
  assert.equal(liar.candidate.coverImageUrl, null);
  assert.equal(liar.candidate.coverImageSourceUrl, null);
});

test("Akina's fixed MusicBrainz fetch rejects every wrong tuple field and provider ambiguity", async (t) => {
  const exact = akinaFixedMusicBrainzRelease(akinaFixedReleaseIds.liar);
  const cases: Array<[string, MusicReleaseEvidence | null, boolean]> = [
    ["wrong UUID", { ...exact, sourceId: akinaFixedReleaseIds.kataomoi }, false],
    ["wrong URL", { ...exact, sourceUrl: `https://musicbrainz.org/release/${akinaFixedReleaseIds.kataomoi}` }, false],
    ["wrong artist", { ...exact, artistCredit: "Other Artist", artistNames: ["Other Artist"] }, false],
    ["wrong title", { ...exact, title: "Different Work" }, false],
    ["wrong full date", { ...exact, date: "1989-04-26" }, false],
    ["wrong catalog", { ...exact, catalogNumber: "09L3-9999" }, false],
    ["wrong label catalog", { ...exact, labels: [{ name: "Reprise Records", catalogNumber: "09L3-9999" }] }, false],
    ["wrong country", { ...exact, country: "US" }, false],
    ["non-official", { ...exact, status: "Promotion" }, false],
    ["non-CD", { ...exact, format: "Digital Media", formats: ["Digital Media"] }, false],
    ["warning-bearing response", exact, true],
    ["missing response", null, false],
  ];
  for (const [name, release, warning] of cases) {
    await t.test(name, async () => {
      const fixture = await prepareAkinaFixedCarrierFixture({
        getRelease: async (id) => id === akinaFixedReleaseIds.liar
          ? {
              value: release,
              warnings: warning
                ? [{ source: "musicbrainz", code: "invalid-response", message: "ambiguous", retryable: false }]
                : [],
            }
          : { value: akinaFixedMusicBrainzRelease(id), warnings: [] },
      });
      const candidate = akinaCandidateByKey(fixture.prepared, "SINGLE:26");
      assert.equal(candidate.observations.some((item) =>
        item.reasonCode === "AKINA_FIXED_MUSICBRAINZ_CD_CARRIER_MATCH"), false);
      assert.deepEqual(classifyPreparedCandidate(candidate), {
        verdict: "UNKNOWN",
        reasonCode: "MISSING_DECLARED_CARRIER",
        eligibleForAi: false,
      });
    });
  }
});

test("Akina's fixed NDL bridge rejects wrong provenance, tuple conflicts, and duplicate records", async (t) => {
  const exact = akinaLiveNdlRecords()[0]!;
  const cases: Array<[string, NdlRecord[]]> = [
    ["wrong URL", [{ ...exact, sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000000000000" }]],
    ["wrong artist", [{ ...exact, title: "Other Artist / 夜のどこかで", creators: ["Other Artist"] }]],
    ["wrong date", [{ ...exact, issued: "1994-10", issuedRaw: "1994-10" }]],
    ["wrong catalog", [{ ...exact, catalogNumbers: ["MVDD-99999"] }]],
    ["duplicate exact record", [exact, { ...exact, recordId: "R100000002-I000009059585" }]],
  ];
  for (const [name, records] of cases) {
    await t.test(name, async () => {
      const fixture = await prepareAkinaFixedCarrierFixture({ ndlRecords: records });
      const candidate = akinaCandidateByKey(fixture.prepared, "SINGLE:32");
      assert.equal(candidate.observations.some((item) =>
        item.reasonCode === "AKINA_FIXED_NDL_CD_CARRIER_MATCH"), false);
      assert.deepEqual(classifyPreparedCandidate(candidate), {
        verdict: "UNKNOWN",
        reasonCode: "MISSING_DECLARED_CARRIER",
        eligibleForAi: false,
      });
    });
  }
});

test("Akina's fixed carrier audit rejects duplicate/wrong observations and accepts one complete NDL title-review chain", async () => {
  const fixture = await prepareAkinaFixedCarrierFixture({ ndlRecords: akinaFixedNdlRecords() });
  const liar = akinaCandidateByKey(fixture.prepared, "SINGLE:26");
  const liarCarrier = liar.observations.find((item) =>
    item.reasonCode === "AKINA_FIXED_MUSICBRAINZ_CD_CARRIER_MATCH");
  assert.ok(liarCarrier);
  assert.equal(classifyPreparedCandidate({
    ...liar,
    observations: [...liar.observations, { ...liarCarrier, id: `${liarCarrier.id}:duplicate` }],
  }).reasonCode, "MISSING_DECLARED_CARRIER");
  assert.equal(classifyPreparedCandidate({
    ...liar,
    observations: liar.observations.map((item) => item === liarCarrier
      ? { ...item, sourceUrl: `https://musicbrainz.org/release/${akinaFixedReleaseIds.kataomoi}` }
      : item),
  }).reasonCode, "MISSING_DECLARED_CARRIER");

  const night = akinaCandidateByKey(fixture.prepared, "SINGLE:32");
  const ndlCarrier = night.observations.find((item) =>
    item.reasonCode === "AKINA_FIXED_NDL_CD_CARRIER_MATCH");
  const ndlBacking = night.observations.find((item) => item.id === ndlCarrier?.facts?.ndlObservationId);
  assert.ok(ndlCarrier && ndlBacking);
  assert.equal(classifyPreparedCandidate({
    ...night,
    observations: [...night.observations, { ...ndlCarrier, id: `${ndlCarrier.id}:duplicate` }],
  }).reasonCode, "MISSING_DECLARED_CARRIER");
  assert.equal(classifyPreparedCandidate({
    ...night,
    observations: [...night.observations, { ...ndlBacking }],
  }).reasonCode, "MISSING_DECLARED_CARRIER");

  const comparison = {
    id: "musicbrainz:akina-title-comparison",
    provider: "musicbrainz",
    role: "DISCOVERY" as const,
    strength: "SUPPORTING" as const,
    stage: "MUSICBRAINZ" as const,
    verdict: "PASS" as const,
    reasonCode: "MUSICBRAINZ_WORK_GROUP_CORROBORATION",
    reason: "Independent title notation for AI comparison.",
    sourceUrl: "https://musicbrainz.org/release-group/11111111-1111-4111-8111-111111111111",
    matchedFields: ["artist", "title"],
  };
  const conflictId = "ndl-title-review:akina-fixed-test";
  const reviewBacking = {
    ...ndlBacking,
    reasonCode: "NDL_CATALOG_ARTIST_DATE_MATCH_TITLE_REVIEW",
    matchedFields: ndlBacking.matchedFields.filter((field) => field !== "title"),
    facts: { ...ndlBacking.facts, title: "Different supplied title notation" },
  };
  const reviewCarrier = {
    ...ndlCarrier,
    matchedFields: ndlCarrier.matchedFields.map((field) =>
      field === "title" ? "titleReviewChain" : field),
    facts: {
      ...ndlCarrier.facts,
      carrierTitle: "Different supplied title notation",
      titleMatch: "AI_REVIEW",
      titleReviewConflictId: conflictId,
    },
  };
  const reviewCandidate: ComprehensiveDiscographyCandidate = {
    ...night,
    observations: night.observations.map((item) => item.id === ndlBacking.id
      ? reviewBacking
      : item.id === ndlCarrier.id
        ? reviewCarrier
        : item).concat(comparison),
    conflicts: [{
      id: conflictId,
      certainty: "AI_REVIEW",
      reasonCode: "TITLE_CONFLICT",
      field: "title",
      sourceObservationIds: [comparison.id, reviewBacking.id],
      message: "Review the two supplied title notations.",
    }],
  };
  assert.deepEqual(classifyPreparedCandidate(reviewCandidate), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
  assert.equal(classifyPreparedCandidate({
    ...reviewCandidate,
    conflicts: [],
  }).reasonCode, "MISSING_DECLARED_CARRIER");
});
