import "server-only";

import {
  isAllowedVerifiedCoverAssetHost,
  isAllowedVerifiedCoverAssetUrl,
  isAllowedVerifiedCoverSourceUrl,
  validateCoverAsset,
  type VerifiedCoverProvider,
} from "@/lib/ai/cover-asset-validation";
import {
  addComprehensiveConflict,
  addComprehensiveObservation,
  type ComprehensiveCandidateResult,
  type ComprehensiveCoverLookupResult,
  type ComprehensiveDiscographyCandidate,
} from "@/lib/ai/comprehensive-discography";
import {
  curatedDiscogsDetailMatchesWork,
  findCuratedDiscogsWorkEvidence,
  type CuratedDiscogsWorkBinding,
  type ExactDiscogsArtistInventory,
} from "@/lib/ai/curated-discogs-work-evidence";
import {
  curatedCarrierCatalogMatches,
  inspectCuratedSyntheticWorkIdentity,
  type ComprehensiveEvidenceObservation,
  type CuratedSyntheticWorkIdentity,
} from "@/lib/ai/comprehensive-evidence-audit";
import {
  matchMomoeOfficialCatalogToCurated,
  type MomoeOfficialCuratedResult,
} from "@/lib/ai/momoe-official-curated";
import {
  matchSeikoOfficialEntitiesToCurated,
  type SeikoOfficialCuratedMatch,
  type SeikoOfficialCuratedResult,
} from "@/lib/ai/seiko-official-curated";
import { applyAkinaNakamoriOfficialRecovery } from "@/lib/ai/akina-recovery-application";
import { applyMihoNakayamaKingCarrierEvidence } from "@/lib/ai/miho-carrier-application";
import { applySeikoMatsudaRecoveryEvidence } from "@/lib/ai/seiko-recovery-application";
import {
  appleCollectionIdFromStoreUrl,
  createPersistedItunesEditionCoverBinding,
  exactItunesAlbumMatchesPersistedEditionBinding,
  findUniqueItunesCoverMatch,
  findUniqueItunesDatedWorkCoverMatch,
  findUniqueItunesWorkCoverMatch,
  lookupItunesAlbumByCollectionId,
  normalizeAppleStoreUrl,
  resolveItunesCountryCode,
  searchItunesAlbums,
  selectDominantItunesArtistId,
  toItunesArtwork600,
  type ItunesAlbumResult,
  type PersistedItunesEditionCoverBinding,
} from "@/lib/ai/itunes-enrichment";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import { discogsClient, type DiscogsClient } from "@/lib/discogs/client";
import type {
  DiscogsJapanPhysicalSearchResult,
  DiscogsReleaseEvidence,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";
import {
  musicMetadataClient,
  type MusicMetadataClient,
} from "@/lib/music-metadata/client";
import type {
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";
import {
  fetchNdlSingleManifests,
  NdlSearchClient,
  matchNdlCandidateForComprehensiveAudit,
  type NdlCandidate,
  type NdlClientResult,
  type NdlSingleManifestResult,
} from "@/lib/ndl";
import {
  curatedHistoricalCanonDecision,
  curatedCanonBoundaryAsOf,
  curatedPhysicalCdDateEvidenceKind,
  curatedWorkScopeDecision,
  curatedWorkTitleKeys,
  MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER,
  MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
  MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
  fetchMomoeYamaguchiCosmosPhysicalCdCarrier,
  fetchMomoeYamaguchiOfficialCatalog,
  findCuratedArtistDiscography,
  isKingRecordsLabelOrPublisher,
  normalizedCuratedWorkTitle,
  researchSoundFujiWorkArchive,
  researchOfficialMusicCatalog,
  fetchSeikoMatsudaOfficialEntities,
  type CuratedArtistDiscography,
  type CuratedDiscographyWork,
  type CuratedHistoricalCanonDecision,
  type CuratedWorkScopeDecision,
  type MomoeYamaguchiCatalogResult,
  type MomoeYamaguchiPhysicalCdCarrierEvidence,
  type MomoeYamaguchiWorkCoverEvidence,
  type SoundFujiArchiveResearchResult,
  type SoundFujiWorkCoverEvidence,
  type OfficialMusicResearchInput,
  type OfficialMusicResearchResult,
  type SeikoMatsudaOfficialCoverEvidence,
  type SeikoMatsudaOfficialResult,
} from "@/lib/official-music";
import { SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS } from "@/lib/official-music/seiko-matsuda";
import {
  AkinaNakamoriOfficialClient,
  type AkinaNakamoriOfficialRecoveryResult,
} from "@/lib/official-music/akina-nakamori";
import {
  MihoNakayamaKingCarrierClient,
  MihoNakayamaMellowCdClient,
  type MihoNakayamaKingCarrierResult,
  type MihoNakayamaMellowCdResult,
} from "@/lib/official-music/miho-nakayama-carrier";
import {
  SeikoMatsudaRecoveryClient,
  type SeikoMatsudaRecoveryResult,
} from "@/lib/official-music/seiko-matsuda-recovery";
import {
  classifyDiscogsFormatScope,
  discoverDiscogsSupplementalCandidates,
} from "@/lib/ai/supplemental-release-discovery";

export type PrepareComprehensiveSourceEvidenceInput = {
  request: ReleaseResearchRequest;
  result: ReleaseResearchResult;
  bundle: ArtistReleaseEvidenceBundle;
  candidates: readonly ComprehensiveDiscographyCandidate[];
  onProgress?: (input: {
    stage: "SOURCE_FETCH" | "NDL_MATCH" | "SOURCE_MERGE";
    processed: number;
    total: number;
  }) => void | Promise<void>;
};

export type ComprehensiveSourceAdapterLimits = {
  maxScopeCandidates?: number;
  maxNdlCatalogLookups?: number;
  maxOfficialCandidates?: number;
  maxDiscogsQueries?: number;
  maxDiscogsPagesPerQuery?: number;
  maxDiscogsItemsPerQuery?: number;
  maxCuratedPhysicalQueries?: number;
  maxCuratedPhysicalPagesPerQuery?: number;
  maxCuratedPhysicalItemsPerQuery?: number;
  maxDiscogsRowsPerCandidate?: number;
  maxDiscogsCoverDetailsPerCandidate?: number;
  minimumItunesArtistCollections?: number;
  maxItunesTitleLookups?: number;
};

export type ComprehensiveSourceAdapterDependencies = {
  useCuratedManifests?: boolean;
  findCuratedDiscography?: (
    musicBrainzArtistId: string | null | undefined,
    artistNames: readonly string[],
  ) => CuratedArtistDiscography | null;
  ndl?: Pick<NdlSearchClient, "searchArtistInventory" | "searchCatalogNumber">;
  fetchNdlSingleManifests?: typeof fetchNdlSingleManifests;
  researchOfficial?: (
    input: OfficialMusicResearchInput,
  ) => Promise<OfficialMusicResearchResult>;
  researchSoundFuji?: typeof researchSoundFujiWorkArchive;
  researchMomoeOfficial?: () => Promise<MomoeYamaguchiCatalogResult>;
  researchMomoeCosmosCarrier?: () => Promise<MomoeYamaguchiPhysicalCdCarrierEvidence>;
  researchSeikoOfficial?: () => Promise<SeikoMatsudaOfficialResult>;
  researchMihoKingCarrier?: () => Promise<MihoNakayamaKingCarrierResult>;
  researchMihoMellowCd?: () => Promise<MihoNakayamaMellowCdResult>;
  researchSeikoRecovery?: () => Promise<SeikoMatsudaRecoveryResult>;
  researchAkinaRecovery?: () => Promise<AkinaNakamoriOfficialRecoveryResult>;
  matchSeikoOfficial?: typeof matchSeikoOfficialEntitiesToCurated;
  discogs?: Pick<DiscogsClient, "searchJapanCdReleases" | "getRelease">;
  searchJapanPhysicalReleases?: DiscogsClient["searchJapanPhysicalReleases"];
  musicMetadata?: Pick<MusicMetadataClient, "getCoverArt"> &
    Partial<Pick<MusicMetadataClient, "getRelease">>;
  validateCover?: typeof validateCoverAsset;
  searchItunes?: (
    artistName: string,
    country: string | null | undefined,
  ) => Promise<ItunesAlbumResult[]>;
  searchItunesByTitle?: (
    title: string,
    country: string | null | undefined,
  ) => Promise<ItunesAlbumResult[]>;
  now?: () => Date;
  limits?: ComprehensiveSourceAdapterLimits;
};

export type ComprehensiveSourceStats = {
  scopeCandidates: number;
  supplementalCandidates: number;
  curatedManifestWorks: number;
  curatedManifestMatched: number;
  curatedManifestSeeded: number;
  curatedManifestPendingSeeded: number;
  curatedManifestOutOfScope: number;
  curatedManifestUnknownScope: number;
  curatedHistoricalNonCanonicalOutOfScope: number;
  curatedCanonicalTitleDateConflicts: number;
  curatedPhysicalSearchCalls: number;
  curatedPhysicalRows: number;
  curatedPhysicalSourceTotal: number;
  curatedPhysicalPagesFetched: number;
  curatedPhysicalMatchedWorks: number;
  curatedPhysicalReboundCandidates: number;
  curatedPhysicalIncompleteInventories: number;
  curatedPhysicalRetryableFailures: number;
  curatedPhysicalRateLimits: number;
  curatedPhysicalCoverDetailCalls: number;
  curatedPhysicalCoversMatched: number;
  momoeOfficialCalls: number;
  momoeOfficialMatchedWorks: number;
  momoeOfficialIncomplete: number;
  momoeOfficialCoversMatched: number;
  momoeMusicBrainzCarrierMatchedWorks: number;
  momoeMusicBrainzCarrierFailures: number;
  seikoOfficialCalls: number;
  seikoOfficialMatchedWorks: number;
  seikoOfficialIncomplete: number;
  seikoOfficialCoversMatched: number;
  ndlInventoryCalls: number;
  ndlCatalogCalls: number;
  ndlMatched: number;
  ndlManifestCalls: number;
  ndlManifestMatched: number;
  officialCalls: number;
  officialMatched: number;
  soundFujiCalls: number;
  soundFujiMatched: number;
  soundFujiCovers: number;
  discogsSearchCalls: number;
  discogsRows: number;
  discogsMatched: number;
  itunesCalls: number;
  itunesTitleCalls: number;
  itunesAlbums: number;
};

export type PreparedComprehensiveSourceEvidence = {
  candidates: ComprehensiveDiscographyCandidate[];
  lookupValidatedCover: (
    candidate: ComprehensiveDiscographyCandidate,
  ) => Promise<ComprehensiveCoverLookupResult>;
  sourceStats: ComprehensiveSourceStats;
};

type DiscogsSearchState = {
  rows: DiscogsSearchReleaseEvidence[];
  incomplete: boolean;
  retryable: boolean;
  message: string | null;
};

type CuratedPhysicalSearchState = {
  inventory: ExactDiscogsArtistInventory | null;
  rows: DiscogsSearchReleaseEvidence[];
  complete: boolean;
  retryable: boolean;
};

type CuratedPhysicalApplication = {
  candidates: ComprehensiveDiscographyCandidate[];
  bindingsByWorkId: ReadonlyMap<string, CuratedDiscogsWorkBinding>;
};

type MomoeOfficialApplication = {
  candidates: ComprehensiveDiscographyCandidate[];
  coversByWorkId: ReadonlyMap<string, MomoeYamaguchiWorkCoverEvidence>;
};

type SeikoOfficialApplication = {
  candidates: ComprehensiveDiscographyCandidate[];
  coversByWorkId: ReadonlyMap<string, SeikoMatsudaOfficialCoverEvidence>;
};

type ItunesSearchState = {
  albums: ItunesAlbumResult[];
  unavailable: boolean;
};

let defaultNdlClient: NdlSearchClient | null = null;
let defaultMihoKingCarrierClient: MihoNakayamaKingCarrierClient | null = null;
let defaultMihoMellowCdClient: MihoNakayamaMellowCdClient | null = null;
let defaultSeikoRecoveryClient: SeikoMatsudaRecoveryClient | null = null;
let defaultAkinaRecoveryClient: AkinaNakamoriOfficialClient | null = null;

function getDefaultNdlClient() {
  defaultNdlClient ??= new NdlSearchClient();
  return defaultNdlClient;
}

function getDefaultMihoKingCarrierClient() {
  defaultMihoKingCarrierClient ??= new MihoNakayamaKingCarrierClient();
  return defaultMihoKingCarrierClient;
}

function getDefaultMihoMellowCdClient() {
  defaultMihoMellowCdClient ??= new MihoNakayamaMellowCdClient();
  return defaultMihoMellowCdClient;
}

function getDefaultSeikoRecoveryClient() {
  defaultSeikoRecoveryClient ??= new SeikoMatsudaRecoveryClient();
  return defaultSeikoRecoveryClient;
}

function getDefaultAkinaRecoveryClient() {
  defaultAkinaRecoveryClient ??= new AkinaNakamoriOfficialClient();
  return defaultAkinaRecoveryClient;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return [...new Set(values
    .map((value) => value?.normalize("NFKC").trim())
    .filter((value): value is string => Boolean(value)))];
}

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function yearOf(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function preciseCompatibleDate(
  current: string | null | undefined,
  authoritative: string | null | undefined,
) {
  const parse = (value: string | null | undefined) => {
    const match = value?.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
    if (!match) return null;
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;
    if (month !== null && (month < 1 || month > 12)) return null;
    if (day !== null) {
      const checked = new Date(Date.UTC(year, month! - 1, day));
      if (
        checked.getUTCFullYear() !== year ||
        checked.getUTCMonth() !== month! - 1 ||
        checked.getUTCDate() !== day
      ) return null;
    }
    return { value: value!, year, month, day, precision: day ? 3 : month ? 2 : 1 };
  };
  const observed = parse(authoritative);
  if (!observed) return current ?? null;
  const existing = parse(current);
  if (!existing) return observed.value;
  if (existing.year !== observed.year || existing.precision >= observed.precision) return existing.value;
  if (existing.month !== null && existing.month !== observed.month) return existing.value;
  return observed.value;
}

function discogsTitle(value: string) {
  const separator = value.indexOf(" - ");
  return separator >= 0 ? value.slice(separator + 3) : value;
}

function discogsArtistCredit(value: string) {
  const separator = value.indexOf(" - ");
  return separator > 0 ? value.slice(0, separator).trim() : null;
}

function isScopeResearchable(candidate: ComprehensiveDiscographyCandidate) {
  const scope = candidate.observations.filter((observation) => observation.stage === "SCOPE");
  return !scope.some((observation) => observation.verdict === "OUT_OF_SCOPE");
}

function breadthFirstByWork(candidates: readonly ComprehensiveDiscographyCandidate[]) {
  const groups = new Map<string, ComprehensiveDiscographyCandidate[]>();
  for (const candidate of candidates) {
    const values = groups.get(candidate.workId) ?? [];
    values.push(candidate);
    groups.set(candidate.workId, values);
  }
  const output: ComprehensiveDiscographyCandidate[] = [];
  const values = [...groups.values()];
  for (let index = 0; output.length < candidates.length; index += 1) {
    for (const group of values) {
      if (group[index]) output.push(group[index]!);
    }
  }
  return output;
}

function curatedManifestEntry(candidate: ComprehensiveDiscographyCandidate) {
  const matches = candidate.observations.filter((entry) =>
    entry.verdict === "PASS" &&
    entry.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
    normalizedText(entry.provider).startsWith("curated-official-manifest:") &&
    Boolean(entry.facts?.manifestEntryKey));
  return matches.length === 1 ? matches[0]! : null;
}

function isCuratedSyntheticRepresentation(candidate: ComprehensiveDiscographyCandidate) {
  const manifest = curatedManifestEntry(candidate);
  if (!manifest?.facts?.manifestEntryKey) return false;
  return candidate.editionId ===
    `${manifest.provider}:representation:${manifest.facts.manifestEntryKey}`;
}

/**
 * Candidate-level official crawling is bounded, so allocate that budget by
 * canonical work before spending it on second and later editions of the same
 * work. Canonical manifest representatives come first; within one work, the
 * synthetic representation is preferred because it carries the manifest's
 * exact declared date/catalog tuple instead of an arbitrary discovered edition.
 */
function officialCandidatesByWorkBreadth(
  candidates: readonly ComprehensiveDiscographyCandidate[],
) {
  const groups = new Map<string, ComprehensiveDiscographyCandidate[]>();
  for (const candidate of candidates) {
    const values = groups.get(candidate.workId) ?? [];
    values.push(candidate);
    groups.set(candidate.workId, values);
  }
  const rankedGroups = [...groups.entries()].map(([workId, values], groupIndex) => {
    const ranked = values
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => {
        const synthetic = Number(isCuratedSyntheticRepresentation(right.candidate)) -
          Number(isCuratedSyntheticRepresentation(left.candidate));
        if (synthetic !== 0) return synthetic;
        const canonical = Number(Boolean(curatedManifestEntry(right.candidate))) -
          Number(Boolean(curatedManifestEntry(left.candidate)));
        return canonical !== 0 ? canonical : left.index - right.index;
      })
      .map((entry) => entry.candidate);
    return {
      workId,
      values: ranked,
      groupIndex,
      canonical: ranked.some((candidate) => Boolean(curatedManifestEntry(candidate))),
    };
  }).sort((left, right) =>
    Number(right.canonical) - Number(left.canonical) || left.groupIndex - right.groupIndex);

  const output: ComprehensiveDiscographyCandidate[] = [];
  for (let index = 0; output.length < candidates.length; index += 1) {
    for (const group of rankedGroups) {
      if (group.values[index]) output.push(group.values[index]!);
    }
  }
  return output;
}

function observation(
  input: Omit<ComprehensiveEvidenceObservation, "matchedFields"> & {
    matchedFields?: string[];
  },
): ComprehensiveEvidenceObservation {
  return { ...input, matchedFields: input.matchedFields ?? [] };
}

function sourceFailureObservation(
  candidateId: string,
  provider: string,
  role: "AUTHORITATIVE" | "CORROBORATING",
  stage: "AUTHORITATIVE" | "CORROBORATION",
  reasonCode: string,
  reason: string,
  retryable: boolean,
): ComprehensiveEvidenceObservation {
  return observation({
    id: `${provider}:unknown:${candidateId}`,
    provider,
    role,
    strength: role === "AUTHORITATIVE" ? "STRONG" : "SUPPORTING",
    stage,
    verdict: "UNKNOWN",
    reasonCode,
    reason,
    sourceUrl: null,
    retryable,
  });
}

function artistNames(
  request: ReleaseResearchRequest,
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
) {
  const primary = bundle.artist?.name?.trim() || result.artist.name.trim() || request.artistName.trim();
  const aliases = uniqueStrings([
    request.artistName,
    result.artist.name,
    result.artist.nameKana,
    result.artist.nameRomaji,
    bundle.artist?.name,
    ...(bundle.artist?.aliases.map((alias) => alias.name) ?? []),
  ]).filter((name) => normalizedText(name) !== normalizedText(primary));
  return { primary, aliases };
}

function curatedReleaseGroupCategory(
  releaseGroup: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["releaseGroup"],
) {
  if (!releaseGroup) return null;
  const types = [releaseGroup.type, ...releaseGroup.secondaryTypes]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizedText(value));
  if (types.some((value) =>
    value === "compilation" || value === "live" || value === "remix" || value === "djmix" ||
    value === "soundtrack" || value === "mixtapestreet" || value === "spokenword" ||
    value === "interview" || value === "audiobook" || value === "audiodrama")) {
    return null;
  }
  if (types.includes("single")) return "SINGLE" as const;
  if (types.includes("album")) {
    return "ORIGINAL_ALBUM" as const;
  }
  return null;
}

type CuratedDateParts = {
  year: number;
  month: number | null;
  day: number | null;
};

function curatedDateParts(value: string | null | undefined): CuratedDateParts | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (year < 1 || year > 9999 || (month !== null && (month < 1 || month > 12))) return null;
  if (day !== null) {
    if (month === null || day < 1 || day > 31) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day) return null;
  }
  return { year, month, day };
}

function curatedDatesCompatible(
  expected: string | null | undefined,
  observed: string | null | undefined,
) {
  if (!expected || !observed) return true;
  const expectedParts = curatedDateParts(expected);
  const observedParts = curatedDateParts(observed);
  if (!expectedParts || !observedParts || expectedParts.year !== observedParts.year) return false;
  if (expectedParts.month !== null && observedParts.month !== null &&
    expectedParts.month !== observedParts.month) return false;
  return expectedParts.day === null || observedParts.day === null ||
    expectedParts.day === observedParts.day;
}

function curatedReleaseGroupArtistMatches(
  releaseGroup: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["releaseGroup"],
  manifest: CuratedArtistDiscography,
  work: CuratedDiscographyWork,
) {
  if (!releaseGroup) return false;
  const expectedNames = new Set([
    manifest.canonicalName,
    ...manifest.aliases,
    ...(work.artistCredits ?? []),
  ]
    .map(normalizedCuratedWorkTitle)
    .filter(Boolean));
  return [
    ...releaseGroup.artistNames,
    ...releaseGroup.artistAliases.map((alias) => alias.name),
    releaseGroup.artistCredit,
  ].some((name) => expectedNames.has(normalizedCuratedWorkTitle(name)));
}

function curatedWorkMatchScore(
  work: CuratedDiscographyWork,
  releaseGroup: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["releaseGroup"],
  manifest: CuratedArtistDiscography,
) {
  if (!releaseGroup || !curatedReleaseGroupArtistMatches(releaseGroup, manifest, work) ||
    !curatedWorkTitleKeys(work).has(normalizedCuratedWorkTitle(releaseGroup.title))) {
    return -1;
  }
  const categoryMatches = curatedReleaseGroupCategory(releaseGroup) === work.category;
  const expectedDate = work.originalReleaseDate;
  const observedDate = releaseGroup.date;
  const exactDate = Boolean(expectedDate && observedDate?.slice(0, 10) === expectedDate);
  const sameYear = Boolean(expectedDate && curatedDateParts(observedDate)?.year ===
    curatedDateParts(expectedDate)?.year);
  if (!curatedDatesCompatible(expectedDate, observedDate)) return -1;
  const hasExplicitType = Boolean(releaseGroup.type || releaseGroup.secondaryTypes.length > 0);
  if (!categoryMatches && (hasExplicitType || !exactDate)) return -1;
  return (categoryMatches ? 8 : 0) + (exactDate ? 8 : sameYear ? 2 : 0);
}

function matchedBundleWork(
  work: CuratedDiscographyWork,
  bundle: ArtistReleaseEvidenceBundle,
  manifest: CuratedArtistDiscography,
) {
  const ranked = (bundle.works ?? [])
    .map((candidate) => ({
      candidate,
      score: curatedWorkMatchScore(work, candidate.releaseGroup, manifest),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.candidate.workId.localeCompare(right.candidate.workId));
  if (!ranked[0] || ranked[1]?.score === ranked[0].score) return null;
  return ranked[0].candidate;
}

function curatedAuthorityObservation(
  candidateId: string,
  provider: string,
  work: CuratedDiscographyWork,
  observedMusicBrainzDate: string | null | undefined,
  canonicalArtist: string,
) {
  const dateCorroborated = Boolean(work.originalReleaseDate &&
    observedMusicBrainzDate?.slice(0, 10) === work.originalReleaseDate);
  return observation({
    id: `${provider}:work:${work.category}:${work.ordinal}:${candidateId}`,
    provider,
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
    reason: dateCorroborated
      ? "A versioned official artist or label manifest identifies this canonical title and category, with the full original date independently corroborated by MusicBrainz."
      : "A versioned official artist or label manifest identifies this exact canonical work title and category; its declared date has not been promoted to independently corroborated evidence.",
    sourceUrl: work.authorityUrls[0] ?? null,
    matchedFields: ["artist", "title", "category", ...(dateCorroborated ? ["date"] : [])],
    facts: {
      artist: canonicalArtist,
      artistCredits: (work.artistCredits ?? []).join(","),
      title: work.title,
      category: work.category,
      date: work.originalReleaseDate,
      ordinal: String(work.ordinal),
      manifestEntryKey: `${work.category}:${work.ordinal}`,
      authorityPages: work.authorityUrls.join(","),
      authorityAsOf: work.authorityAsOf,
      dateSupport: !work.originalReleaseDate
        ? "NOT_DECLARED"
        : dateCorroborated ? "MUSICBRAINZ_EXACT" : "MANIFEST_ONLY",
      musicBrainzObservedDate: observedMusicBrainzDate ?? null,
    },
  });
}

function curatedScopeObservation(
  candidateId: string,
  provider: string,
  work: CuratedDiscographyWork,
  country: string,
  decision: CuratedWorkScopeDecision,
) {
  const carrierCountry = work.mediaScope?.physicalCdCountry ?? country;
  return observation({
    id: `${provider}:scope:${work.category}:${work.ordinal}:${candidateId}`,
    provider,
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "SCOPE",
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    sourceUrl: decision.authorityUrls[0] ?? work.authorityUrls[0] ?? null,
    matchedFields: decision.verdict === "PASS"
      ? ["country", "format", "artist", "title"]
      : ["artist", "title"],
    facts: {
      country: carrierCountry,
      format: decision.representationFormat,
      title: work.title,
      date: work.originalReleaseDate,
      manifestEntryKey: `${work.category}:${work.ordinal}`,
      originalFormats: work.mediaScope?.originalFormats.join(",") ?? "LEGACY_CD_MANIFEST",
      physicalCd: work.mediaScope?.physicalCd ?? "LEGACY_CONFIRMED",
      physicalCdCountry: carrierCountry,
      physicalCdReleaseDate: work.mediaScope?.physicalCdReleaseDate ?? null,
      physicalCdDateEvidenceKind: curatedPhysicalCdDateEvidenceKind(work.mediaScope),
      physicalCdCatalogNumber: work.mediaScope?.physicalCdCatalogNumber ?? null,
      physicalCdRepresentationKind: !work.mediaScope
        ? "WORK_ONLY"
        : work.mediaScope.physicalCdRepresentationKind === "CONTAINER_INCLUSION"
          ? "CONTAINER_INCLUSION"
          : work.mediaScope.physicalCdReleaseDate && work.mediaScope.physicalCdCatalogNumber
            ? "SAME_WORK_EDITION"
            : "WORK_ONLY",
      physicalCdContainerTitle: work.mediaScope?.physicalCdContainerTitle ?? null,
      scopeExclusionReason: work.mediaScope?.exclusionReason ?? null,
    },
  });
}

function canRepresentDeclaredPhysicalCd(
  candidate: ReleaseResearchCandidate,
  work: CuratedDiscographyWork,
) {
  const media = work.mediaScope;
  const declaredDate = media?.physicalCdReleaseDate ?? null;
  const declaredCatalog = media?.physicalCdCatalogNumber ?? null;
  if (!declaredDate || !declaredCatalog) return false;
  if (
    media?.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
    media.physicalCd === "LATER_OFFICIAL_EDITION" &&
    media.physicalCdContainerTitle
  ) {
    // A box or compilation is a different physical entity from the work it
    // contains. Never rewrite an arbitrary MusicBrainz work edition into the
    // container; the manifest path creates a separate synthetic carrier.
    return false;
  }
  return (media?.physicalCd === "ORIGINAL_RELEASE" ||
      media?.physicalCd === "LATER_OFFICIAL_EDITION") &&
    candidate.releaseDate?.slice(0, 10) === declaredDate &&
    normalizedCatalog(candidate.catalogNumber) === normalizedCatalog(declaredCatalog) &&
    /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.format ?? "");
}

function needsIndependentSyntheticRepresentation(work: CuratedDiscographyWork) {
  const media = work.mediaScope;
  if (!media?.physicalCdReleaseDate || !media.physicalCdCatalogNumber) return false;
  return media.physicalCd === "ORIGINAL_RELEASE" ||
    media.physicalCd === "LATER_OFFICIAL_EDITION";
}

function withCuratedCandidateMetadata(
  candidate: ReleaseResearchCandidate,
  work: CuratedDiscographyWork,
  sourceUrls: readonly string[],
  representDeclaredPhysicalCd = false,
) {
  const oldOriginalDate = candidate.originalReleaseDate;
  let releaseDate = work.originalReleaseDate && candidate.releaseDate === oldOriginalDate
    ? work.originalReleaseDate
    : candidate.releaseDate;
  let catalogNumber = candidate.catalogNumber;
  let format = candidate.format;
  let editionType = candidate.editionType;
  let isReissue = candidate.isReissue;
  const media = work.mediaScope;
  const declaredDate = media?.physicalCdReleaseDate ?? null;
  const declaredCatalog = media?.physicalCdCatalogNumber ?? null;
  // Only an exact, authority-declared CD representation may replace
  // edition-level fields on an existing work candidate. Container inclusion
  // deliberately represents the canonical work with the declared container;
  // an original-CD tuple is filled only when it does not contradict the
  // candidate. Legacy and incomplete carrier scopes retain their metadata.
  if (representDeclaredPhysicalCd && canRepresentDeclaredPhysicalCd(candidate, work) &&
    declaredDate && declaredCatalog) {
    releaseDate = declaredDate;
    catalogNumber = declaredCatalog;
    format = "CD (official canonical-work representation)";
    editionType = media?.physicalCd === "LATER_OFFICIAL_EDITION"
      ? "LATER_OFFICIAL_CD_REPRESENTATION"
      : "OFFICIAL_ORIGINAL_CARRIER_REPRESENTATION";
    isReissue = media?.physicalCd === "LATER_OFFICIAL_EDITION";
  }
  const sources = [...candidate.sources];
  for (const url of sourceUrls) {
    if (!sources.some((source) => source.url === url)) {
      sources.push({ title: "Official canonical discography manifest", url, sourceType: "official" });
    }
  }
  return {
    ...candidate,
    titleOriginal: normalizedCuratedWorkTitle(candidate.title) === normalizedCuratedWorkTitle(work.title)
      ? candidate.titleOriginal
      : candidate.title,
    title: work.title,
    category: work.category,
    releaseDate,
    originalReleaseDate: work.originalReleaseDate ?? candidate.originalReleaseDate,
    format,
    catalogNumber,
    editionType,
    isReissue,
    sources,
  } satisfies ReleaseResearchCandidate;
}

function applyCuratedManifestEvidence(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  request: ReleaseResearchRequest,
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
  stats: ComprehensiveSourceStats,
  findManifest: typeof findCuratedArtistDiscography,
) {
  const artist = artistNames(request, result, bundle);
  const manifest = findManifest(
    bundle.artist?.sourceId,
    [artist.primary, ...artist.aliases],
  );
  if (!manifest || resolveItunesCountryCode(request.country) !== manifest.country) {
    return [...candidates];
  }
  stats.curatedManifestWorks = manifest.works.length;
  const output = [...candidates];
  const provider = `curated-official-manifest:${manifest.slug}`;

  for (const work of manifest.works) {
    const scopeDecision = curatedWorkScopeDecision(work, request.target);
    const bundleWork = matchedBundleWork(work, bundle, manifest);
    const existing = bundleWork
      ? output.filter((candidate) => candidate.workId === bundleWork.workId &&
          curatedDatesCompatible(
            work.originalReleaseDate,
            candidate.candidate.originalReleaseDate,
          ))
      : [];
    const sourceUrls = [...new Set([...work.authorityUrls, ...scopeDecision.authorityUrls])];

    if (scopeDecision.verdict !== "PASS") {
      for (const candidate of existing) {
        const index = output.indexOf(candidate);
        let enriched: ComprehensiveDiscographyCandidate = {
          ...candidate,
          candidate: {
            ...withCuratedCandidateMetadata(candidate.candidate, work, sourceUrls),
            isExcludedByDefault: scopeDecision.verdict === "OUT_OF_SCOPE" ||
              candidate.candidate.isExcludedByDefault,
          },
        };
        enriched = addComprehensiveObservation(
          enriched,
          curatedAuthorityObservation(
            candidate.candidate.id,
            provider,
            work,
            bundleWork?.releaseGroup?.date,
            manifest.canonicalName,
          ),
        );
        enriched = addComprehensiveObservation(
          enriched,
          curatedScopeObservation(
            candidate.candidate.id,
            provider,
            work,
            manifest.country,
            scopeDecision,
          ),
        );
        output[index] = enriched;
      }
      if (scopeDecision.verdict === "OUT_OF_SCOPE") {
        stats.curatedManifestOutOfScope += 1;
      } else {
        stats.curatedManifestUnknownScope += 1;
      }
      // Never synthesize a CD representation for an explicitly non-CD work,
      // or while physical-CD availability is still unconfirmed.
      continue;
    }

    const researchable = existing.filter(isScopeResearchable);
    if (researchable.length > 0) {
      const canonicalRepresentation = researchable.find((candidate) =>
        canRepresentDeclaredPhysicalCd(candidate.candidate, work)) ?? null;
      const canonicalEditionId = `${provider}:representation:${work.category}:${work.ordinal}`;
      for (const candidate of researchable) {
        const index = output.indexOf(candidate);
        const representsDeclaredPhysicalCd = candidate === canonicalRepresentation;
        let enriched: ComprehensiveDiscographyCandidate = {
          ...candidate,
          editionId: representsDeclaredPhysicalCd ? canonicalEditionId : candidate.editionId,
          candidate: withCuratedCandidateMetadata(
            candidate.candidate,
            work,
            sourceUrls,
            representsDeclaredPhysicalCd,
          ),
        };
        enriched = addComprehensiveObservation(
          enriched,
          curatedAuthorityObservation(
            candidate.candidate.id,
            provider,
            work,
            bundleWork?.releaseGroup?.date,
            manifest.canonicalName,
          ),
        );
        enriched = addComprehensiveObservation(
          enriched,
          curatedScopeObservation(
            candidate.candidate.id,
            provider,
            work,
            manifest.country,
            scopeDecision,
          ),
        );
        output[index] = enriched;
      }
      stats.curatedManifestMatched += 1;
      if (canonicalRepresentation || !needsIndependentSyntheticRepresentation(work)) {
        continue;
      }
      // A complete later-edition or container claim needs its own physical
      // representation. Fall through to the synthetic seed below instead of
      // mutating the original MusicBrainz edition for this work.
    }

    // A PASS carrier declaration may seed a pending canonical-work
    // representation even when MusicBrainz has no work group. Authority and
    // scope alone remain ineligible for AI until an independent exact work
    // binding is attached below.
    const sameTitleBundleClaims = !bundleWork
      ? (bundle.works ?? []).filter((candidate) =>
          candidate.releaseGroup && curatedWorkTitleKeys(work).has(
            normalizedCuratedWorkTitle(candidate.releaseGroup.title),
          ))
      : [];
    const hasSameArtistTitleClaim = sameTitleBundleClaims.some((candidate) =>
      candidate.releaseGroup && curatedReleaseGroupArtistMatches(
        candidate.releaseGroup,
        manifest,
        work,
      ));
    const hasOnlyForeignArtistClaims = sameTitleBundleClaims.length > 0 &&
      !hasSameArtistTitleClaim;
    if (hasOnlyForeignArtistClaims) continue;
    // A same-artist MusicBrainz row with an incompatible date/type can be a
    // different entity that happens to share the title (for example an album
    // named after a single, or a later remix). It must not corroborate this
    // manifest work, but it must not erase the official canonical work either.
    // Seed the work without a MusicBrainz observation; it remains ineligible
    // for AI unless a later adapter supplies an independently unique exact
    // identity binding.
    const releaseGroup = bundleWork?.releaseGroup ?? null;
    const candidateId = `curated-${manifest.slug}-${work.category.toLowerCase()}-${work.ordinal}`;
    const musicBrainzSource = releaseGroup?.sourceUrl ?? null;
    const sources: ReleaseResearchCandidate["sources"] = sourceUrls.map((url) => ({
      title: "Official canonical discography manifest",
      url,
      sourceType: "official" as const,
    }));
    if (musicBrainzSource) {
      sources.push({
        title: "MusicBrainz release group",
        url: musicBrainzSource,
        sourceType: "database",
      });
    }
    const synthetic: ComprehensiveDiscographyCandidate = {
      candidate: {
        id: candidateId,
        title: work.title,
        titleOriginal: null,
        category: work.category,
        artistCredit: work.artistCredits?.[0] ?? manifest.canonicalName,
        releaseDate: work.mediaScope?.physicalCdReleaseDate ??
          (work.mediaScope?.physicalCd === "ORIGINAL_RELEASE" ? work.originalReleaseDate : null),
        originalReleaseDate: work.originalReleaseDate,
        format: work.mediaScope
          ? `${scopeDecision.representationFormat} (official canonical-work representation)`
          : "CD (official complete-catalogue representation)",
        catalogNumber: work.mediaScope?.physicalCdCatalogNumber ?? null,
        barcode: null,
        label: null,
        originalPrice: null,
        editionType: work.mediaScope
          ? work.mediaScope.physicalCd === "LATER_OFFICIAL_EDITION"
            ? "LATER_OFFICIAL_CD_REPRESENTATION"
            : "OFFICIAL_ORIGINAL_CARRIER_REPRESENTATION"
          : "OFFICIAL_COMPLETE_CATALOGUE_REPRESENTATION",
        isReissue: work.mediaScope
          ? work.mediaScope.physicalCd === "LATER_OFFICIAL_EDITION"
          : true,
        isRemaster: null,
        isExcludedByDefault: false,
        // A release-group image is work-level evidence, not artwork for this
        // separately claimed physical carrier. Cover lookup may still find an
        // independently bound edition or approved work-level provider later.
        coverImageUrl: null,
        coverImageSourceUrl: null,
        notes: work.mediaScope
          ? `Canonical work represented by confirmed ${scopeDecision.representationFormat} carrier evidence. No edition date was inferred when the manifest did not declare one.`
          : "Canonical work represented by an official physical-CD complete catalogue. No individual CD edition date or catalog number was inferred.",
        confidence: "HIGH",
        warnings: [],
        sources,
        verification: null,
      },
      workId: bundleWork?.workId ?? `${provider}:${work.category}:${work.ordinal}`,
      editionId: `${provider}:representation:${work.category}:${work.ordinal}`,
      observations: [
        observation({
          id: `${provider}:discovery:${work.category}:${work.ordinal}`,
          provider,
          role: "DISCOVERY",
          strength: "SUPPORTING",
          stage: "DISCOVERY",
          verdict: "PASS",
          reasonCode: "CURATED_OFFICIAL_WORK_DISCOVERED",
          reason: "The versioned official catalogue manifest supplies a canonical work absent from individual-CD discovery.",
          sourceUrl: work.authorityUrls[0] ?? null,
          matchedFields: ["artist", "title", "category", "format"],
        }),
        curatedScopeObservation(
          candidateId,
          provider,
          work,
          manifest.country,
          scopeDecision,
        ),
        curatedAuthorityObservation(
          candidateId,
          provider,
          work,
          releaseGroup?.date,
          manifest.canonicalName,
        ),
        ...(releaseGroup ? [observation({
          id: `musicbrainz:release-group:${releaseGroup.sourceId}:${candidateId}`,
          provider: "musicbrainz",
          role: "DISCOVERY",
          strength: "SUPPORTING",
          stage: "MUSICBRAINZ",
          verdict: "PASS",
          reasonCode: "MUSICBRAINZ_WORK_GROUP_CORROBORATION",
          reason: "MusicBrainz independently identifies the same artist work group; the official manifest supplies its carrier representation.",
          sourceUrl: releaseGroup.sourceUrl,
          matchedFields: ["artist", "title", ...(releaseGroup.date ? ["date"] : [])],
          facts: {
            title: releaseGroup.title,
            artist: releaseGroup.artistCredit,
            date: releaseGroup.date,
          },
        })] : []),
      ],
      conflicts: [],
    };
    output.push(synthetic);
    if (releaseGroup) {
      stats.curatedManifestSeeded += 1;
    } else {
      stats.curatedManifestPendingSeeded += 1;
    }
  }
  return output;
}

type CuratedHistoricalOutOfScopeDecision = Extract<
  CuratedHistoricalCanonDecision,
  { outcome: "OUT_OF_SCOPE" }
>;

function curatedHistoricalCanonOutOfScopeObservation(
  candidate: ComprehensiveDiscographyCandidate,
  manifest: CuratedArtistDiscography,
  decision: CuratedHistoricalOutOfScopeDecision,
) {
  const provider = `curated-official-manifest:${manifest.slug}`;
  const originalReleaseDate = candidate.candidate.originalReleaseDate;
  const conflict = decision.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT";
  const observationKind = conflict ? "canonical-title-date-conflict" : "historical-canon";
  return observation({
    id: `${provider}:${observationKind}:${candidate.candidate.id}`,
    provider,
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "SCOPE",
    verdict: "OUT_OF_SCOPE",
    reasonCode: decision.reasonCode,
    reason: conflict
      ? `This title or manifest alias belongs to the canonical work dated ${decision.work.originalReleaseDate ?? "an undeclared date"}, but the candidate reports ${originalReleaseDate ? `the different original date ${originalReleaseDate}` : "no original date"}; it cannot be treated as a later new work.`
      : manifest.catalogStatus === "fixed"
        ? "This work is absent from the complete canonical manifest for a fixed artist catalogue."
        : `This work is absent from the complete canonical history through ${curatedCanonBoundaryAsOf(decision.baseline)}, and no complete original release date strictly after that cutoff proves it is a later new work.`,
    sourceUrl: decision.baseline.authorityUrls[0] ?? null,
    matchedFields: ["artist", "title", "category", ...(originalReleaseDate ? ["date"] : [])],
    facts: {
      artist: manifest.canonicalName,
      title: candidate.candidate.title,
      category: candidate.candidate.category,
      originalReleaseDate: originalReleaseDate ?? null,
      canonicalTitle: decision.work?.title ?? null,
      canonicalOriginalReleaseDate: decision.work?.originalReleaseDate ?? null,
      catalogStatus: manifest.catalogStatus ?? null,
      baselineKind: decision.baseline.kind,
      authorityAsOf: curatedCanonBoundaryAsOf(decision.baseline),
      officialCatalogTotal: String(decision.baseline.officialCatalogTotal),
      membership: conflict
        ? "CANONICAL_TITLE_DATE_CONFLICT"
        : "ABSENT_FROM_COMPLETE_CANONICAL_MANIFEST",
    },
  });
}

function applyCuratedHistoricalCanonGate(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  manifest: CuratedArtistDiscography | null,
  stats: ComprehensiveSourceStats,
) {
  if (!manifest) return [...candidates];
  return candidates.map((candidate) => {
    const decision = curatedHistoricalCanonDecision(manifest, {
      title: candidate.candidate.title,
      category: candidate.candidate.category,
      originalReleaseDate: candidate.candidate.originalReleaseDate,
    });
    if (decision.outcome !== "OUT_OF_SCOPE") return candidate;
    const gate = curatedHistoricalCanonOutOfScopeObservation(candidate, manifest, decision);
    if (!candidate.observations.some((item) => item.id === gate.id)) {
      if (decision.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT") {
        stats.curatedCanonicalTitleDateConflicts += 1;
      } else {
        stats.curatedHistoricalNonCanonicalOutOfScope += 1;
      }
    }
    return addComprehensiveObservation({
      ...candidate,
      candidate: {
        ...candidate.candidate,
        isExcludedByDefault: true,
      },
    }, gate);
  });
}

function curatedManifestEntryKey(work: CuratedDiscographyWork) {
  return `${work.category}:${work.ordinal}`;
}

function candidateManifestEntryKey(candidate: ComprehensiveDiscographyCandidate) {
  const keys = new Set(candidate.observations
    .filter((item) => item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")
    .map((item) => item.facts?.manifestEntryKey)
    .filter((value): value is string => Boolean(value)));
  return keys.size === 1 ? [...keys][0]! : null;
}

function candidateDiscogsReleaseId(candidate: ComprehensiveDiscographyCandidate) {
  const editionMatch = candidate.editionId.match(/^discogs:(\d+)$/u);
  if (editionMatch) return Number(editionMatch[1]);
  for (const source of candidate.candidate.sources) {
    const match = source.url.match(/^https:\/\/www\.discogs\.com\/release\/(\d+)$/iu);
    if (match) return Number(match[1]);
  }
  return null;
}

function curatedDiscogsObservation(
  candidateId: string,
  work: CuratedDiscographyWork,
  binding: CuratedDiscogsWorkBinding,
  canonicalArtist: string,
) {
  const evidence = binding.evidence;
  return observation({
    id: `discogs:curated-original-work:${evidence.release.releaseId}:${candidateId}`,
    provider: "discogs",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    verdict: "PASS",
    reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
    reason: "One complete Japan physical-release inventory uniquely binds the original artist, title, work category, and original year to this curated canonical work.",
    sourceUrl: evidence.sourceUrl,
    matchedFields: [
      "artist",
      "title",
      "category",
      "originalYear",
      ...(evidence.facts.catalogNumber ? ["catalogNumber", "year"] : []),
    ],
    facts: {
      artist: binding.inventory.query,
      // The row credit already passed the exact artist-inventory matcher.
      // Retain it separately so a carrier row using the same verified alias
      // can bind without promoting that alias to a global artist identity.
      boundArtistCredit: discogsArtistCredit(evidence.release.title),
      canonicalArtist,
      title: evidence.facts.discogsTitle,
      canonicalTitle: work.title,
      category: work.category,
      originalYear: evidence.facts.originalYear,
      year: evidence.facts.originalYear,
      catalogNumber: evidence.facts.catalogNumber,
      formats: evidence.facts.formats,
      releaseId: String(evidence.release.releaseId),
      masterId: evidence.release.masterId === null ? null : String(evidence.release.masterId),
      matchKind: evidence.matchKind,
      manifestEntryKey: curatedManifestEntryKey(work),
      uniqueBinding: "true",
      inventoryComplete: "true",
    },
  });
}

function applyCuratedPhysicalEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  request: ReleaseResearchRequest;
  manifest: CuratedArtistDiscography | null;
  physical: CuratedPhysicalSearchState;
  cdRows: readonly DiscogsSearchReleaseEvidence[];
  stats: ComprehensiveSourceStats;
}): CuratedPhysicalApplication {
  if (!input.manifest || !input.physical.inventory || !input.physical.complete) {
    return { candidates: [...input.candidates], bindingsByWorkId: new Map() };
  }

  const tentative = input.manifest.works.flatMap((work) => {
    const scope = curatedWorkScopeDecision(work, input.request.target);
    if (scope.verdict !== "PASS") return [];
    const evidence = findCuratedDiscogsWorkEvidence({
      work,
      rows: input.physical.rows,
      inventory: input.physical.inventory!,
    });
    return evidence ? [{ work, scope, evidence }] : [];
  });
  // A physical row that is a component of more than one manifest work is not
  // an independent unique work binding for either entry.
  const releaseOwners = new Map<number, number>();
  for (const item of tentative) {
    releaseOwners.set(
      item.evidence.release.releaseId,
      (releaseOwners.get(item.evidence.release.releaseId) ?? 0) + 1,
    );
  }
  const uniqueMatches = tentative.filter((item) =>
    releaseOwners.get(item.evidence.release.releaseId) === 1);
  const masterOwners = new Map<number, number>();
  for (const item of uniqueMatches) {
    const masterId = item.evidence.release.masterId;
    if (masterId !== null) {
      masterOwners.set(masterId, (masterOwners.get(masterId) ?? 0) + 1);
    }
  }
  // One Discogs master is one work identity. If two manifest works reached
  // different releases under that same master (for example split A/B-side
  // titles), neither is a unique independent binding.
  const uniquelyBoundMatches = uniqueMatches.filter((item) => {
    const masterId = item.evidence.release.masterId;
    return masterId === null || masterOwners.get(masterId) === 1;
  });
  const cdRowsByRelease = new Map(input.cdRows.map((row) => [row.releaseId, row]));
  const output = [...input.candidates];
  const bindings = new Map<string, CuratedDiscogsWorkBinding>();
  const conflictingBindingIds = new Set<string>();

  for (const item of uniquelyBoundMatches) {
    const entryKey = curatedManifestEntryKey(item.work);
    const curatedCandidates = output.filter((candidate) =>
      candidateManifestEntryKey(candidate) === entryKey);
    if (curatedCandidates.length === 0) continue;
    const musicBrainzWorkIds = new Set(curatedCandidates
      .filter((candidate) => candidate.observations.some((entry) =>
        normalizedText(entry.provider) === "musicbrainz" && entry.stage === "MUSICBRAINZ" &&
        entry.verdict === "PASS"))
      .map((candidate) => candidate.workId));
    if (musicBrainzWorkIds.size > 1) continue;
    const curatedWorkIds = new Set(curatedCandidates.map((candidate) => candidate.workId));
    const workId = musicBrainzWorkIds.size === 1
      ? [...musicBrainzWorkIds][0]!
      : curatedWorkIds.size === 1 ? [...curatedWorkIds][0]! : null;
    if (!workId) continue;

    const physicalRow = item.evidence.release;
    const relatedDiscogs = output.filter((candidate) => {
      if (!candidate.observations.some((entry) =>
        normalizedText(entry.provider) === "discogs" &&
        entry.reasonCode === "DISCOGS_JAPAN_CD_DISCOVERY")) return false;
      const releaseId = candidateDiscogsReleaseId(candidate);
      if (releaseId === null) return false;
      if (releaseId === physicalRow.releaseId) return true;
      const cdRow = cdRowsByRelease.get(releaseId);
      return Boolean(
        cdRow && physicalRow.masterId !== null &&
        masterOwners.get(physicalRow.masterId) === 1 &&
        cdRow.masterId === physicalRow.masterId,
      );
    });
    const related = [...new Map([...curatedCandidates, ...relatedDiscogs]
      .map((candidate) => [candidate.candidate.id, candidate])).values()];
    const provider = `curated-official-manifest:${input.manifest.slug}`;
    const sourceUrls = [...new Set([
      ...item.work.authorityUrls,
      ...item.scope.authorityUrls,
    ])];
    const binding: CuratedDiscogsWorkBinding = {
      work: item.work,
      inventory: input.physical.inventory,
      evidence: item.evidence,
    };

    for (const candidate of related) {
      const index = output.indexOf(candidate);
      const expectedRepresentationId = `${provider}:representation:${entryKey}`;
      const metadata = withCuratedCandidateMetadata(
        candidate.candidate,
        item.work,
        sourceUrls,
        candidate.editionId === expectedRepresentationId,
      );
      let enriched: ComprehensiveDiscographyCandidate = {
        ...candidate,
        workId,
        candidate: {
          ...metadata,
          sources: metadata.sources.some((source) => source.url === item.evidence.sourceUrl)
            ? metadata.sources
            : [...metadata.sources, {
                title: "Discogs original physical work",
                url: item.evidence.sourceUrl,
                sourceType: "database" as const,
              }],
        },
      };
      if (candidateManifestEntryKey(candidate) !== entryKey) {
        enriched = addComprehensiveObservation(
          enriched,
          curatedAuthorityObservation(
            candidate.candidate.id,
            provider,
            item.work,
            null,
            input.manifest.canonicalName,
          ),
        );
        enriched = addComprehensiveObservation(
          enriched,
          curatedScopeObservation(
            candidate.candidate.id,
            provider,
            item.work,
            input.manifest.country,
            item.scope,
          ),
        );
      }
      enriched = addComprehensiveObservation(
        enriched,
        curatedDiscogsObservation(
          candidate.candidate.id,
          item.work,
          binding,
          input.manifest.canonicalName,
        ),
      );
      output[index] = enriched;
      if (candidate.workId !== workId) input.stats.curatedPhysicalReboundCandidates += 1;
    }

    if (bindings.has(workId)) {
      bindings.delete(workId);
      conflictingBindingIds.add(workId);
    } else if (!conflictingBindingIds.has(workId)) {
      bindings.set(workId, binding);
    }
    input.stats.curatedPhysicalMatchedWorks += 1;
  }
  return { candidates: output, bindingsByWorkId: bindings };
}

const MOMOE_CARRIER_TITLE = "ゴールデン☆アイドル 山口百恵";
const MOMOE_CARRIER_DATE = "2015-02-11";
const MOMOE_CARRIER_CATALOG = "MHCL-30295～30298";
const MOMOE_CARRIER_BARCODE = "4582290405537";
const MOMOE_CARRIER_AUTHORITY_URL =
  "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-30295";
const MOMOE_CARRIER_CATALOGS = new Set([
  "MHCL30295",
  "MHCL30296",
  "MHCL30297",
  "MHCL30298",
]);

function exactMomoeCarrierText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim();
}

function exactMusicBrainzReleaseUrl(value: string, sourceId: string) {
  try {
    const url = new URL(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(sourceId) &&
      url.protocol === "https:" &&
      url.hostname === "musicbrainz.org" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.pathname === `/release/${sourceId}`;
  } catch {
    return false;
  }
}

function exactMomoeCarrierCatalogs(release: MusicReleaseEvidence) {
  if (release.labels.length < MOMOE_CARRIER_CATALOGS.size) return false;
  const catalogs = release.labels.map((label) => normalizedCatalog(label.catalogNumber));
  if (catalogs.some((catalog) => !catalog || !MOMOE_CARRIER_CATALOGS.has(catalog))) return false;
  const normalizedLabelNames = release.labels.map((label) => normalizedText(label.name));
  if (normalizedLabelNames.some((name) => !name)) return false;
  return new Set(normalizedLabelNames).size === 1 &&
    new Set(catalogs).size === MOMOE_CARRIER_CATALOGS.size;
}

function uniqueMomoeCarrierCatalogDisplays(release: MusicReleaseEvidence) {
  const catalogs = new Map<string, string>();
  for (const label of release.labels) {
    const normalized = normalizedCatalog(label.catalogNumber);
    if (!normalized || !label.catalogNumber || catalogs.has(normalized)) continue;
    catalogs.set(normalized, label.catalogNumber);
  }
  return [...MOMOE_CARRIER_CATALOGS].map((catalog) => catalogs.get(catalog) ?? catalog);
}

function exactMomoeMusicBrainzCarrier(release: MusicReleaseEvidence) {
  const allowedArtists = new Set([normalizedText("山口百恵"), normalizedText("Momoe Yamaguchi")]);
  const artistCredit = normalizedText(release.artistCredit);
  const artistNames = release.artistNames.map(normalizedText).filter(Boolean);
  const formats = release.formats.map((format) => normalizedCatalog(format));
  return release.entityType === "release" &&
    exactMusicBrainzReleaseUrl(release.sourceUrl, release.sourceId) &&
    exactMomoeCarrierText(release.title) === MOMOE_CARRIER_TITLE &&
    artistCredit.length > 0 && allowedArtists.has(artistCredit) &&
    artistNames.length === 1 && artistNames[0] === artistCredit &&
    release.country === "JP" &&
    release.date === MOMOE_CARRIER_DATE &&
    release.status?.normalize("NFKC").trim().toLocaleLowerCase("en") === "official" &&
    formats.length === 1 && formats[0] === "BLUSPECCD" &&
    normalizedCatalog(release.format) === "BLUSPECCD" &&
    release.catalogNumber === null &&
    release.barcode === MOMOE_CARRIER_BARCODE &&
    exactMomoeCarrierCatalogs(release);
}

function musicBrainzCarrierEditions(bundle: ArtistReleaseEvidenceBundle) {
  if (bundle.discoveredEditions !== undefined) {
    return bundle.discoveredEditions.map((edition) => edition.evidence);
  }
  if (bundle.works !== undefined) {
    return bundle.works.flatMap((work) => work.editions.map((edition) => edition.evidence));
  }
  return bundle.releases.map((release) => release.evidence);
}

type CuratedFixedMusicBrainzCarrierContract = {
  artistSlug: string;
  manifestEntryKey: string;
  releaseId: string;
  releaseUrl: string;
};

/**
 * Exact physical editions that are present in MusicBrainz but are not
 * reliably returned by its artist-wide release-group traversal.  These are
 * discovery seeds only: the fetched release must still match every physical
 * identity field declared by the curated manifest before it can corroborate
 * a candidate.
 */
const CURATED_FIXED_MUSICBRAINZ_CARRIERS: readonly CuratedFixedMusicBrainzCarrierContract[] = [
  {
    artistSlug: "seiko-matsuda",
    manifestEntryKey: "ORIGINAL_ALBUM:33",
    releaseId: "7307ae91-9841-4e24-ae93-331e135be494",
    releaseUrl: "https://musicbrainz.org/release/7307ae91-9841-4e24-ae93-331e135be494",
  },
  {
    artistSlug: "seiko-matsuda",
    manifestEntryKey: "ORIGINAL_ALBUM:34",
    releaseId: "0e9021da-f8dd-40ea-9a03-9b2d2f8ab7d4",
    releaseUrl: "https://musicbrainz.org/release/0e9021da-f8dd-40ea-9a03-9b2d2f8ab7d4",
  },
] as const;

function uniqueMomoeMusicBrainzCarrier(bundle: ArtistReleaseEvidenceBundle) {
  const matches = musicBrainzCarrierEditions(bundle).filter(exactMomoeMusicBrainzCarrier);
  return matches.length === 1 ? matches[0]! : null;
}

function momoeCarrierManifestWorks(manifest: CuratedArtistDiscography | null) {
  if (
    manifest?.slug !== "momoe-yamaguchi" ||
    exactMomoeCarrierText(manifest.canonicalName) !== "山口百恵" ||
    !manifest.aliases.some((alias) => exactMomoeCarrierText(alias) === "Momoe Yamaguchi")
  ) return null;
  const singles = manifest.works.filter((work) => work.category === "SINGLE");
  if (singles.length !== 32) return null;
  return singles.every((work) => {
    const media = work.mediaScope;
    return media?.originalFormats.length === 1 && media.originalFormats[0] === "VINYL" &&
      media.physicalCd === "LATER_OFFICIAL_EDITION" &&
      media.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
      media.physicalCdContainerTitle === MOMOE_CARRIER_TITLE &&
      media.physicalCdReleaseDate === MOMOE_CARRIER_DATE &&
      media.physicalCdCatalogNumber === MOMOE_CARRIER_CATALOG &&
      media.physicalCdAuthorityUrls.length === 1 &&
      media.physicalCdAuthorityUrls[0] === MOMOE_CARRIER_AUTHORITY_URL;
  }) ? singles : null;
}

function applyMomoeMusicBrainzCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  bundle: ArtistReleaseEvidenceBundle;
  stats: ComprehensiveSourceStats;
}) {
  const works = momoeCarrierManifestWorks(input.manifest);
  if (!works) return [...input.candidates];
  const workByKey = new Map(works.map((work) => [curatedManifestEntryKey(work), work]));
  const carrier = uniqueMomoeMusicBrainzCarrier(input.bundle);
  let batchFailed = !carrier;
  const output = input.candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    const work = key ? workByKey.get(key) : null;
    if (!key || !work) return candidate;
    const expectedEditionId = `curated-official-manifest:momoe-yamaguchi:representation:${key}`;
    if (candidate.editionId !== expectedEditionId) return candidate;
    const media = work.mediaScope!;
    const representationComplete = Boolean(
      carrier &&
      candidate.candidate.releaseDate === MOMOE_CARRIER_DATE &&
      normalizedCatalog(candidate.candidate.catalogNumber) === normalizedCatalog(MOMOE_CARRIER_CATALOG) &&
      candidate.candidate.format === "CD (official canonical-work representation)" &&
      candidate.candidate.editionType === "LATER_OFFICIAL_CD_REPRESENTATION" &&
      candidate.candidate.isReissue === true,
    );
    if (!carrier || !representationComplete) {
      batchFailed = true;
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "musicbrainz",
        "CORROBORATING",
        "CORROBORATION",
        "MOMOE_MUSICBRAINZ_CARRIER_NOT_FOUND",
        "No single exact MusicBrainz entity matched the complete Momoe Yamaguchi four-disc Blu-spec CD carrier tuple.",
        false,
      ));
    }
    const catalogs = uniqueMomoeCarrierCatalogDisplays(carrier).join(",");
    const sources = candidate.candidate.sources.some((source) => source.url === carrier.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "MusicBrainz physical carrier",
          url: carrier.sourceUrl,
          sourceType: "database" as const,
        }];
    input.stats.momoeMusicBrainzCarrierMatchedWorks += 1;
    return addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, observation({
      id: `musicbrainz:momoe-carrier:${carrier.sourceId}:${candidate.candidate.id}`,
      provider: "musicbrainz",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "MOMOE_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH",
      reason: "One unique MusicBrainz Japan release independently matches the official four-disc Blu-spec CD carrier containing all 32 canonical singles.",
      sourceUrl: carrier.sourceUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogNumber",
        "country",
        "format",
        "barcode",
        "uniqueCarrier",
      ],
      facts: {
        artist: carrier.artistCredit,
        canonicalArtist: input.manifest!.canonicalName,
        carrierTitle: media.physicalCdContainerTitle ?? carrier.title,
        observedCarrierTitle: carrier.title,
        date: carrier.date,
        catalogNumber: media.physicalCdCatalogNumber,
        catalogNumbers: catalogs,
        country: carrier.country,
        format: carrier.format,
        barcode: carrier.barcode,
        releaseId: carrier.sourceId,
        manifestEntryKey: key,
        physicalCdRepresentationKind: media.physicalCdRepresentationKind ?? null,
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
  if (batchFailed) input.stats.momoeMusicBrainzCarrierFailures += 1;
  return output;
}

function exactCuratedMusicBrainzCarrier(
  release: MusicReleaseEvidence,
  manifest: CuratedArtistDiscography,
  work: CuratedDiscographyWork,
) {
  const media = work.mediaScope;
  if (
    !media?.physicalCdReleaseDate ||
    !media.physicalCdCatalogNumber ||
    media.physicalCdRepresentationKind === "CONTAINER_INCLUSION"
  ) return false;
  const allowedTitles = curatedWorkTitleKeys(work);
  const allowedArtists = new Set([
    manifest.canonicalName,
    ...manifest.aliases,
    ...(work.artistCredits ?? []),
  ].map(normalizedCuratedWorkTitle).filter(Boolean));
  const artistCredit = normalizedCuratedWorkTitle(release.artistCredit);
  const artistNames = release.artistNames.map(normalizedCuratedWorkTitle).filter(Boolean);
  const formats = new Set(release.formats.map((format) => normalizedCatalog(format)));
  const expectedCountry = media.physicalCdCountry ?? manifest.country;
  return release.entityType === "release" &&
    exactMusicBrainzReleaseUrl(release.sourceUrl, release.sourceId) &&
    allowedTitles.has(normalizedCuratedWorkTitle(release.title)) &&
    Boolean(artistCredit) && allowedArtists.has(artistCredit) &&
    artistNames.length > 0 && artistNames.every((artist) => allowedArtists.has(artist)) &&
    release.date === media.physicalCdReleaseDate &&
    normalizedCatalog(release.catalogNumber) === normalizedCatalog(media.physicalCdCatalogNumber) &&
    release.country === expectedCountry &&
    release.status?.normalize("NFKC").trim().toLocaleLowerCase("en") === "official" &&
    formats.has("CD");
}

async function fetchCuratedFixedMusicBrainzCarriers(
  manifest: CuratedArtistDiscography | null,
  musicMetadata: ComprehensiveSourceAdapterDependencies["musicMetadata"] | undefined,
) {
  const carriers = new Map<string, MusicReleaseEvidence>();
  if (!manifest || !musicMetadata?.getRelease) return carriers;
  const contracts = CURATED_FIXED_MUSICBRAINZ_CARRIERS.filter((contract) =>
    contract.artistSlug === manifest.slug);
  const requests = contracts.map(async (contract) => {
    const works = manifest.works.filter((work) =>
      curatedManifestEntryKey(work) === contract.manifestEntryKey);
    if (works.length !== 1) return null;
    try {
      const response = await musicMetadata.getRelease!(contract.releaseId);
      const release = response.warnings.length === 0 ? response.value : null;
      if (
        !release ||
        release.sourceId !== contract.releaseId ||
        release.sourceUrl !== contract.releaseUrl ||
        !exactCuratedMusicBrainzCarrier(release, manifest, works[0]!)
      ) return null;
      return { contract, release };
    } catch {
      return null;
    }
  });
  for (const result of await Promise.all(requests)) {
    if (result) carriers.set(result.contract.manifestEntryKey, result.release);
  }
  if (new Set([...carriers.values()].map((release) => release.sourceId)).size !== carriers.size) {
    carriers.clear();
  }
  return carriers;
}

function applyCuratedMusicBrainzCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  bundle: ArtistReleaseEvidenceBundle;
  fixedCarriers?: ReadonlyMap<string, MusicReleaseEvidence>;
}) {
  if (!input.manifest) return [...input.candidates];
  const provider = `curated-official-manifest:${input.manifest.slug}`;
  const releases = musicBrainzCarrierEditions(input.bundle);
  const carrierByKey = new Map<string, MusicReleaseEvidence>();
  for (const work of input.manifest.works) {
    const media = work.mediaScope;
    if (
      !media?.physicalCdReleaseDate ||
      !media.physicalCdCatalogNumber ||
      media.physicalCdRepresentationKind === "CONTAINER_INCLUSION"
    ) continue;
    const matches = releases.filter((release) =>
      exactCuratedMusicBrainzCarrier(release, input.manifest!, work));
    const fixedCarrier = input.fixedCarriers?.get(curatedManifestEntryKey(work)) ?? null;
    if (fixedCarrier && !matches.some((release) => release.sourceId === fixedCarrier.sourceId)) {
      matches.push(fixedCarrier);
    }
    if (matches.length === 1 && exactCuratedMusicBrainzCarrier(matches[0]!, input.manifest, work)) {
      carrierByKey.set(curatedManifestEntryKey(work), matches[0]!);
    }
  }

  return input.candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    if (!key || candidate.editionId !== `${provider}:representation:${key}`) return candidate;
    const work = input.manifest!.works.find((item) => curatedManifestEntryKey(item) === key);
    const media = work?.mediaScope;
    if (
      !work ||
      !media?.physicalCdReleaseDate ||
      !media.physicalCdCatalogNumber ||
      media.physicalCdRepresentationKind === "CONTAINER_INCLUSION"
    ) return candidate;
    const carrier = carrierByKey.get(key) ?? null;
    const representationComplete = Boolean(
      carrier &&
      candidate.candidate.releaseDate === media.physicalCdReleaseDate &&
      normalizedCatalog(candidate.candidate.catalogNumber) ===
        normalizedCatalog(media.physicalCdCatalogNumber) &&
      /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? ""),
    );
    if (!carrier || !representationComplete) {
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "musicbrainz",
        "CORROBORATING",
        "CORROBORATION",
        "CURATED_MUSICBRAINZ_CARRIER_NOT_FOUND",
        "No unique exact MusicBrainz release matched the declared same-work CD carrier tuple.",
        false,
      ));
    }
    const sources = candidate.candidate.sources.some((source) => source.url === carrier.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "MusicBrainz physical carrier",
          url: carrier.sourceUrl,
          sourceType: "database" as const,
        }];
    return addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, observation({
      id: `musicbrainz:curated-carrier:${carrier.sourceId}:${candidate.candidate.id}`,
      provider: "musicbrainz",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "CURATED_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH",
      reason: "One unique official MusicBrainz release exactly matches the declared same-work CD carrier.",
      sourceUrl: carrier.sourceUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogNumber",
        "country",
        "format",
        "status",
        "uniqueCarrier",
      ],
      facts: {
        entityType: carrier.entityType,
        artist: carrier.artistCredit,
        canonicalArtist: input.manifest!.canonicalName,
        carrierTitle: carrier.title,
        canonicalTitle: work.title,
        date: carrier.date,
        catalogNumber: carrier.catalogNumber,
        country: carrier.country,
        format: carrier.formats.join(","),
        status: carrier.status,
        releaseId: carrier.sourceId,
        manifestEntryKey: key,
        physicalCdRepresentationKind: media.physicalCdRepresentationKind ??
          "SAME_WORK_EDITION",
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

type AkinaFixedCarrierContract = {
  manifestEntryKey: `SINGLE:${number}`;
  title: string;
  releaseDate: string;
  catalogNumber: string;
  authorityUrl: string;
};

type AkinaFixedMusicBrainzCarrierContract = AkinaFixedCarrierContract & {
  releaseId: string;
};

const AKINA_FIXED_MUSICBRAINZ_CARRIERS: readonly AkinaFixedMusicBrainzCarrierContract[] = [
  {
    manifestEntryKey: "SINGLE:26",
    title: "LIAR",
    releaseDate: "1989-04-25",
    catalogNumber: "09L3-4070",
    releaseId: "f431289c-d0a5-4907-8704-34781bf26a59",
    authorityUrl: "https://musicbrainz.org/release/f431289c-d0a5-4907-8704-34781bf26a59",
  },
  {
    manifestEntryKey: "SINGLE:31",
    title: "片想い／愛撫",
    releaseDate: "1994-03-24",
    catalogNumber: "MVDD-10004",
    releaseId: "a7d708fc-735e-4f71-b6fd-a9310037b3d0",
    authorityUrl: "https://musicbrainz.org/release/a7d708fc-735e-4f71-b6fd-a9310037b3d0",
  },
] as const;

const AKINA_FIXED_NDL_CARRIERS: readonly AkinaFixedCarrierContract[] = [
  {
    manifestEntryKey: "SINGLE:32",
    title: "夜のどこかで 〜night shift〜",
    releaseDate: "1994-09-02",
    catalogNumber: "MVDD-10007",
    authorityUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000009059584",
  },
  {
    manifestEntryKey: "SINGLE:38",
    title: "帰省 〜Never Forget〜",
    releaseDate: "1998-02-11",
    catalogNumber: "GRDO-10",
    authorityUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000009061321",
  },
] as const;

function exactAkinaFixedManifestWork(
  manifest: CuratedArtistDiscography | null,
  contract: AkinaFixedCarrierContract,
) {
  if (
    manifest?.slug !== "akina-nakamori" ||
    normalizedCuratedWorkTitle(manifest.canonicalName) !==
      normalizedCuratedWorkTitle("中森明菜") ||
    !manifest.aliases.some((alias) => normalizedCuratedWorkTitle(alias) ===
      normalizedCuratedWorkTitle("Akina Nakamori"))
  ) return null;
  const matches = manifest.works.filter((work) =>
    curatedManifestEntryKey(work) === contract.manifestEntryKey);
  if (matches.length !== 1) return null;
  const work = matches[0]!;
  const media = work.mediaScope;
  if (
    work.category !== "SINGLE" ||
    work.title !== contract.title ||
    work.originalReleaseDate !== contract.releaseDate ||
    !media ||
    media.physicalCd !== "ORIGINAL_RELEASE" ||
    media.physicalCdRepresentationKind !== "SAME_WORK_EDITION" ||
    media.physicalCdCountry !== "JP" ||
    media.physicalCdReleaseDate !== contract.releaseDate ||
    normalizedCatalog(media.physicalCdCatalogNumber) !==
      normalizedCatalog(contract.catalogNumber) ||
    media.physicalCdAuthorityUrls.length !== 1 ||
    media.physicalCdAuthorityUrls[0] !== contract.authorityUrl ||
    media.originalFormats.filter((format) => format === "CD").length !== 1
  ) return null;
  return work;
}

function exactAkinaFixedMusicBrainzCarrier(
  release: MusicReleaseEvidence,
  manifest: CuratedArtistDiscography,
  work: CuratedDiscographyWork,
  contract: AkinaFixedMusicBrainzCarrierContract,
) {
  const allowedArtists = new Set([
    manifest.canonicalName,
    ...manifest.aliases,
    ...(work.artistCredits ?? []),
  ].map(normalizedCuratedWorkTitle).filter(Boolean));
  const artistCredit = normalizedCuratedWorkTitle(release.artistCredit);
  const artistNames = release.artistNames.map(normalizedCuratedWorkTitle).filter(Boolean);
  const formats = release.formats.map(normalizedCatalog).filter(Boolean);
  return release.entityType === "release" &&
    release.sourceId === contract.releaseId &&
    release.sourceUrl === contract.authorityUrl &&
    exactMusicBrainzReleaseUrl(release.sourceUrl, release.sourceId) &&
    curatedWorkTitleKeys(work).has(normalizedCuratedWorkTitle(release.title)) &&
    Boolean(artistCredit) && allowedArtists.has(artistCredit) &&
    artistNames.length === 1 && artistNames[0] === artistCredit &&
    release.date === contract.releaseDate &&
    release.country === "JP" &&
    release.status?.normalize("NFKC").trim().toLocaleLowerCase("en") === "official" &&
    normalizedCatalog(release.catalogNumber) === normalizedCatalog(contract.catalogNumber) &&
    release.labels.length === 1 &&
    normalizedCatalog(release.labels[0]?.catalogNumber) === normalizedCatalog(contract.catalogNumber) &&
    formats.length === 1 && formats[0] === "8CMCD" &&
    normalizedCatalog(release.format) === "8CMCD";
}

async function fetchAkinaFixedMusicBrainzCarriers(
  manifest: CuratedArtistDiscography | null,
  musicMetadata: ComprehensiveSourceAdapterDependencies["musicMetadata"] | undefined,
) {
  const carriers = new Map<string, MusicReleaseEvidence>();
  if (!musicMetadata?.getRelease || !manifest) return carriers;
  const requests = AKINA_FIXED_MUSICBRAINZ_CARRIERS.map(async (contract) => {
    const work = exactAkinaFixedManifestWork(manifest, contract);
    if (!work) return null;
    try {
      const response = await musicMetadata.getRelease!(contract.releaseId);
      if (response.warnings.length > 0 || !response.value ||
        !exactAkinaFixedMusicBrainzCarrier(response.value, manifest, work, contract)) return null;
      return { contract, release: response.value };
    } catch {
      return null;
    }
  });
  for (const result of await Promise.all(requests)) {
    if (result) carriers.set(result.contract.manifestEntryKey, result.release);
  }
  if (new Set([...carriers.values()].map((release) => release.sourceId)).size !== carriers.size) {
    carriers.clear();
  }
  return carriers;
}

function applyAkinaFixedMusicBrainzCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  carriers: ReadonlyMap<string, MusicReleaseEvidence>;
}) {
  const contracts = new Map<string, AkinaFixedMusicBrainzCarrierContract>(
    AKINA_FIXED_MUSICBRAINZ_CARRIERS.map((contract) => [
    contract.manifestEntryKey,
    contract,
    ]),
  );
  return input.candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    const contract = key ? contracts.get(key) : null;
    const work = contract ? exactAkinaFixedManifestWork(input.manifest, contract) : null;
    if (!key || !contract || !work || candidate.editionId !==
      `curated-official-manifest:akina-nakamori:representation:${key}`) return candidate;
    const carrier = input.carriers.get(key) ?? null;
    const completeCandidateTuple = candidate.candidate.releaseDate === contract.releaseDate &&
      normalizedCatalog(candidate.candidate.catalogNumber) ===
        normalizedCatalog(contract.catalogNumber) &&
      /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? "");
    if (!carrier || !completeCandidateTuple) {
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "musicbrainz",
        "CORROBORATING",
        "CORROBORATION",
        "AKINA_FIXED_MUSICBRAINZ_CD_CARRIER_NOT_FOUND",
        "The manifest-fixed MusicBrainz release did not uniquely match the complete Akina same-work CD tuple.",
        false,
      ));
    }
    return addComprehensiveObservation(candidate, observation({
      id: `musicbrainz:akina-fixed-carrier:${carrier.sourceId}:${candidate.candidate.id}`,
      provider: "musicbrainz",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "AKINA_FIXED_MUSICBRAINZ_CD_CARRIER_MATCH",
      reason: "The one manifest-fixed MusicBrainz release exactly matches the Akina same-work Japan 8 cm CD carrier tuple.",
      sourceUrl: contract.authorityUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogNumber",
        "country",
        "format",
        "status",
        "uniqueCarrier",
      ],
      facts: {
        entityType: carrier.entityType,
        artist: carrier.artistCredit,
        canonicalArtist: input.manifest!.canonicalName,
        carrierTitle: carrier.title,
        canonicalTitle: work.title,
        date: carrier.date,
        catalogNumber: carrier.catalogNumber,
        country: carrier.country,
        format: carrier.formats.join(","),
        status: carrier.status,
        releaseId: carrier.sourceId,
        manifestEntryKey: key,
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
        retrievalBinding: "MANIFEST_FIXED_UUID",
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

const AKINA_BOX_ARTIST = "\u4e2d\u68ee\u660e\u83dc";
const AKINA_BOX_ARTIST_ALIAS = "Akina Nakamori";
const AKINA_BOX_TITLE = "Singles Box 1982-1991";
const AKINA_BOX_DISCOGS_TITLE = "Akina Nakamori Singles Box 1982-1991";
const AKINA_BOX_DATE = "2014-06-18";
const AKINA_BOX_CATALOG_KEY = "WPCL1187198";
const AKINA_BOX_AUTHORITY_URL = "https://wmg.jp/akina/discography/11915/";
const AKINA_BOX_BARCODE = "4943674180035";

function akinaBoxManifestWorks(manifest: CuratedArtistDiscography | null) {
  if (
    manifest?.slug !== "akina-nakamori" ||
    normalizedCuratedWorkTitle(manifest.canonicalName) !==
      normalizedCuratedWorkTitle(AKINA_BOX_ARTIST) ||
    !manifest.aliases.some((alias) => normalizedCuratedWorkTitle(alias) ===
      normalizedCuratedWorkTitle(AKINA_BOX_ARTIST_ALIAS))
  ) return null;
  const matches = manifest.works.filter((work) => {
    const media = work.mediaScope;
    return work.category === "SINGLE" && work.ordinal <= 22 &&
      media?.physicalCd === "LATER_OFFICIAL_EDITION" &&
      (media.physicalCdCountry ?? manifest.country) === "JP" &&
      media.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
      media.physicalCdContainerTitle === AKINA_BOX_TITLE &&
      media.physicalCdReleaseDate === AKINA_BOX_DATE &&
      normalizedCatalog(media.physicalCdCatalogNumber) === AKINA_BOX_CATALOG_KEY &&
      media.physicalCdAuthorityUrls.length === 1 &&
      media.physicalCdAuthorityUrls[0] === AKINA_BOX_AUTHORITY_URL;
  });
  return matches.length === 22 && matches.every((work, index) => work.ordinal === index + 1)
    ? matches
    : null;
}

function exactAkinaBoxDiscogsCarrier(row: DiscogsSearchReleaseEvidence) {
  const artist = normalizedCuratedWorkTitle(discogsArtistCredit(row.title));
  const title = normalizedCuratedWorkTitle(discogsTitle(row.title));
  const allowedArtists = new Set([AKINA_BOX_ARTIST, AKINA_BOX_ARTIST_ALIAS]
    .map(normalizedCuratedWorkTitle));
  const allowedTitles = new Set([AKINA_BOX_TITLE, AKINA_BOX_DISCOGS_TITLE]
    .map(normalizedCuratedWorkTitle));
  const formats = new Set(row.formats.map((format) => normalizedCatalog(format)));
  const catalog = row.catalogNumber?.normalize("NFKC").trim() ?? "";
  const catalogMatch = /^WPCL-11871\/98(?: \(WQCQ-536\/63\))?$/u.test(catalog);
  return allowedArtists.has(artist) && allowedTitles.has(title) &&
    row.country === "Japan" && row.year === 2014 &&
    formats.has("CD") && formats.has("SINGLE") && formats.has("BOXSET") &&
    formats.has("COMPILATION") && catalogMatch && row.barcode === AKINA_BOX_BARCODE &&
    row.labels.some((label) => normalizedCuratedWorkTitle(label) ===
      normalizedCuratedWorkTitle("Warner Music Japan")) &&
    row.sourceUrl === `https://www.discogs.com/release/${row.releaseId}` &&
    row.apiUrl === `https://api.discogs.com/releases/${row.releaseId}`;
}

function applyAkinaDiscogsCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  rows: readonly DiscogsSearchReleaseEvidence[];
}) {
  const works = akinaBoxManifestWorks(input.manifest);
  if (!works) return [...input.candidates];
  const carriers = input.rows.filter(exactAkinaBoxDiscogsCarrier);
  const carrier = carriers.length === 1 ? carriers[0]! : null;
  const workByKey = new Map(works.map((work) => [curatedManifestEntryKey(work), work]));
  return input.candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    const work = key ? workByKey.get(key) : null;
    if (!key || !work || candidate.editionId !==
      `curated-official-manifest:akina-nakamori:representation:${key}`) return candidate;
    if (!carrier) {
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "discogs",
        "CORROBORATING",
        "CORROBORATION",
        "AKINA_DISCOGS_CARRIER_NOT_FOUND",
        "No single exact Discogs entity matched the authoritative Akina Singles Box carrier tuple.",
        false,
      ));
    }
    const sources = candidate.candidate.sources.some((source) => source.url === carrier.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "Discogs physical carrier",
          url: carrier.sourceUrl,
          sourceType: "database" as const,
        }];
    return addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, observation({
      id: `discogs:akina-box-carrier:${carrier.releaseId}:${candidate.candidate.id}`,
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "AKINA_DISCOGS_CANONICAL_WORK_CARRIER_MATCH",
      reason: "One unique Japan Discogs release exactly matches the official 28-CD Singles Box carrier.",
      sourceUrl: carrier.sourceUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogNumber",
        "country",
        "format",
        "barcode",
        "uniqueCarrier",
      ],
      facts: {
        artist: discogsArtistCredit(carrier.title),
        canonicalArtist: input.manifest!.canonicalName,
        carrierTitle: AKINA_BOX_TITLE,
        observedCarrierTitle: discogsTitle(carrier.title),
        date: AKINA_BOX_DATE,
        year: String(carrier.year),
        catalogNumber: work.mediaScope!.physicalCdCatalogNumber,
        observedCatalogNumber: carrier.catalogNumber,
        country: "JP",
        format: carrier.formats.join(","),
        barcode: carrier.barcode,
        releaseId: String(carrier.releaseId),
        manifestEntryKey: key,
        physicalCdRepresentationKind: "CONTAINER_INCLUSION",
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

function applyMomoeOfficialEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  official: MomoeOfficialCuratedResult | null;
  stats: ComprehensiveSourceStats;
}): MomoeOfficialApplication {
  if (input.manifest?.slug !== "momoe-yamaguchi") {
    return { candidates: [...input.candidates], coversByWorkId: new Map() };
  }
  if (!input.official?.complete) {
    if (input.stats.momoeOfficialCalls > 0) {
      input.stats.momoeOfficialIncomplete += 1;
    }
    return { candidates: [...input.candidates], coversByWorkId: new Map() };
  }

  const output = [...input.candidates];
  const entryKeysByWorkId = new Map<string, Set<string>>();
  for (const candidate of output) {
    const key = candidateManifestEntryKey(candidate);
    if (!key) continue;
    const keys = entryKeysByWorkId.get(candidate.workId) ?? new Set<string>();
    keys.add(key);
    entryKeysByWorkId.set(candidate.workId, keys);
  }
  const ambiguousWorkIds = new Set([...entryKeysByWorkId.entries()]
    .filter(([, keys]) => keys.size !== 1)
    .map(([workId]) => workId));
  const covers = new Map<string, MomoeYamaguchiWorkCoverEvidence>();

  for (const match of input.official.matches) {
    const matchedCandidates = output.filter((candidate) =>
      candidateManifestEntryKey(candidate) === match.manifestEntryKey &&
      !ambiguousWorkIds.has(candidate.workId));
    if (matchedCandidates.length === 0) continue;
    const workIds = new Set(matchedCandidates.map((candidate) => candidate.workId));
    if (workIds.size !== 1) continue;
    const workId = [...workIds][0]!;

    for (const candidate of matchedCandidates) {
      const index = output.indexOf(candidate);
      const sources = candidate.candidate.sources.some((source) =>
        source.url === match.authority.sourceUrl)
        ? candidate.candidate.sources
        : [...candidate.candidate.sources, {
            title: "Sony/OTONANO official canonical work",
            url: match.authority.sourceUrl!,
            sourceType: "official" as const,
          }];
      const isSyntheticRepresentation = candidate.editionId.startsWith(
        "curated-official-manifest:momoe-yamaguchi:representation:",
      );
      const editionDate = match.authority.facts?.editionReleaseDate ?? null;
      const editionCatalog = match.authority.facts?.editionCatalogNumber ?? null;
      const enriched: ComprehensiveDiscographyCandidate = {
        ...candidate,
        candidate: {
          ...candidate.candidate,
          releaseDate: isSyntheticRepresentation && !candidate.candidate.releaseDate &&
              typeof editionDate === "string"
            ? editionDate
            : candidate.candidate.releaseDate,
          catalogNumber: isSyntheticRepresentation && !candidate.candidate.catalogNumber &&
              typeof editionCatalog === "string"
            ? editionCatalog
            : candidate.candidate.catalogNumber,
          sources,
        },
      };
      output[index] = addComprehensiveObservation(enriched, {
        ...match.authority,
        id: `${match.authority.id}:${candidate.candidate.id}`,
      });
    }
    covers.set(workId, match.cover);
    input.stats.momoeOfficialMatchedWorks += 1;
  }

  return { candidates: output, coversByWorkId: covers };
}

const MOMOE_COSMOS_MANIFEST_KEY = "ORIGINAL_ALBUM:14";
const MOMOE_COSMOS_CANONICAL_TITLE = "COSMOS（宇宙）";
const MOMOE_COSMOS_ORIGINAL_DATE = "1978-05-01";

function exactMomoeCosmosManifestWork(manifest: CuratedArtistDiscography | null) {
  if (
    manifest?.slug !== "momoe-yamaguchi" ||
    exactMomoeCarrierText(manifest.canonicalName) !== "山口百恵" ||
    manifest.country !== "JP"
  ) return null;
  const matches = manifest.works.filter((work) =>
    curatedManifestEntryKey(work) === MOMOE_COSMOS_MANIFEST_KEY);
  if (matches.length !== 1) return null;
  const work = matches[0]!;
  const media = work.mediaScope;
  return work.title === MOMOE_COSMOS_CANONICAL_TITLE &&
    work.category === "ORIGINAL_ALBUM" &&
    work.originalReleaseDate === MOMOE_COSMOS_ORIGINAL_DATE &&
    media?.physicalCd === "LATER_OFFICIAL_EDITION" &&
    media.physicalCdCountry === "JP" &&
    media.physicalCdReleaseDate === "1993-06-21" &&
    media.physicalCdCatalogNumber === MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER &&
    media.physicalCdRepresentationKind === "SAME_WORK_EDITION" &&
    media.physicalCdContainerTitle === null &&
    media.physicalCdAuthorityUrls.length === 1 &&
    media.physicalCdAuthorityUrls[0] === MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL
    ? work
    : null;
}

function exactMomoeCosmosCarrier(
  carrier: MomoeYamaguchiPhysicalCdCarrierEvidence | null,
) {
  return Boolean(
    carrier &&
    carrier.provider === "sony-music-japan" &&
    carrier.scope === "EDITION" &&
    carrier.matchLevel === "EDITION_EXACT" &&
    carrier.artist === "山口百恵" &&
    carrier.title === "COSMOS宇宙" &&
    carrier.country === "JP" &&
    carrier.format === "CD" &&
    carrier.releaseDate === "1993-06-21" &&
    carrier.catalogNumber === MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER &&
    carrier.sourceUrl === MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL &&
    carrier.retrievalUrl === MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
  );
}

function applyMomoeCosmosSonyCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  carrier: MomoeYamaguchiPhysicalCdCarrierEvidence | null;
}) {
  const work = exactMomoeCosmosManifestWork(input.manifest);
  if (!work || !input.carrier || !exactMomoeCosmosCarrier(input.carrier)) {
    return [...input.candidates];
  }
  const carrier = input.carrier;
  const expectedEditionId =
    `curated-official-manifest:momoe-yamaguchi:representation:${MOMOE_COSMOS_MANIFEST_KEY}`;
  return input.candidates.map((candidate) => {
    if (
      candidateManifestEntryKey(candidate) !== MOMOE_COSMOS_MANIFEST_KEY ||
      candidate.editionId !== expectedEditionId ||
      candidate.candidate.releaseDate !== carrier.releaseDate ||
      normalizedCatalog(candidate.candidate.catalogNumber) !== normalizedCatalog(carrier.catalogNumber) ||
      !/(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? "")
    ) return candidate;
    const sources = candidate.candidate.sources.some((source) => source.url === carrier.sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "Sony Music exact physical-CD carrier",
          url: carrier.sourceUrl,
          sourceType: "official" as const,
        }];
    return addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, observation({
      id: `sony-music-japan:momoe-cosmos-carrier:${candidate.candidate.id}`,
      provider: "sony-music-japan",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "MOMOE_SONY_COSMOS_CD_CARRIER_MATCH",
      reason: "The fixed Sony product and JSONP entity exactly identify the 1993 SRCL-2622 physical-CD edition of COSMOS.",
      sourceUrl: carrier.sourceUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogNumber",
        "country",
        "format",
        "uniqueCarrier",
      ],
      facts: {
        manifestEntryKey: MOMOE_COSMOS_MANIFEST_KEY,
        canonicalArtist: input.manifest!.canonicalName,
        canonicalTitle: work.title,
        artist: carrier.artist,
        carrierTitle: carrier.title,
        date: carrier.releaseDate,
        catalogNumber: carrier.catalogNumber,
        country: carrier.country,
        format: carrier.format,
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
        retrievalUrl: carrier.retrievalUrl,
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

type SeikoBridgeEditionTuple = {
  releaseGroupId: string;
  releaseGroupTitle: string;
  releaseGroupDate: string;
  releaseGroupType: string;
  releaseId: string | null;
  editionTitle: string;
  editionDate: string;
  catalogNumber: string;
  carrier: "CD" | "VINYL";
  country: "JP" | "US";
};

type SeikoBridgeRule = {
  editions: readonly SeikoBridgeEditionTuple[];
  conflict: "TITLE_CONFLICT" | "FORMAT_CONFLICT" | "DATE_CONFLICT";
  conflictField: "title" | "category" | "date";
};

const seikoBridgeRules: Partial<Record<string, SeikoBridgeRule>> = {
  "SINGLE:22": {
    editions: [{
      releaseGroupId: "19eace7b-472f-4623-8c5e-f668f20d17b2",
      releaseGroupTitle: "DANCING SHOES",
      releaseGroupDate: "1985-06-24",
      releaseGroupType: "Single",
      releaseId: "7d23b526-affb-4a6f-8783-9f06e954c4ac",
      editionTitle: "DANCING SHOES",
      editionDate: "1985-06-24",
      catalogNumber: "12AH-1896",
      carrier: "VINYL",
      country: "JP",
    }],
    conflict: "TITLE_CONFLICT",
    conflictField: "title",
  },
  "SINGLE:71": {
    editions: [{
      releaseGroupId: "a7115395-0a0e-4c6a-8f3e-7e3177af923c",
      releaseGroupTitle: "\u7279\u5225\u306a\u604b\u4eba",
      releaseGroupDate: "2011-11-23",
      releaseGroupType: "Single",
      releaseId: "d8cd86c9-dbeb-4c90-901e-ca6b263f3d23",
      editionTitle: "\u7279\u5225\u306a\u604b\u4eba",
      editionDate: "2011-11-23",
      catalogNumber: "UMCK-5355",
      carrier: "CD",
      country: "JP",
    }],
    conflict: "TITLE_CONFLICT",
    conflictField: "title",
  },
  "ORIGINAL_ALBUM:29": {
    editions: [{
      releaseGroupId: "ca0a9735-b047-4857-8086-6926a5b5c695",
      releaseGroupTitle: "Sweetest Time",
      releaseGroupDate: "1997-12-03",
      releaseGroupType: "EP",
      releaseId: "373608a5-0310-4e6b-854a-4a9e69f5ad89",
      editionTitle: "Sweetest Time",
      editionDate: "1997-12-03",
      catalogNumber: "PHCL-12",
      carrier: "CD",
      country: "JP",
    }],
    conflict: "FORMAT_CONFLICT",
    conflictField: "category",
  },
  "ORIGINAL_ALBUM:35": {
    editions: [
      {
        releaseGroupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
        releaseGroupTitle: "area62",
        releaseGroupDate: "2002-06-11",
        releaseGroupType: "Album",
        releaseId: "7468e7b1-27f3-4db7-a60c-787916e1a246",
        editionTitle: "area62",
        editionDate: "2002-06-11",
        catalogNumber: "HIPD 60054",
        carrier: "CD",
        country: "US",
      },
      // The fixed official page names these Japanese catalogue identities,
      // but MusicBrainz currently has no corresponding release rows. Keep
      // each future-safe tuple bound to the Japanese date instead of mixing
      // country, date, and catalogue allow-lists independently.
      {
        releaseGroupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
        releaseGroupTitle: "area62",
        releaseGroupDate: "2002-06-11",
        releaseGroupType: "Album",
        releaseId: null,
        editionTitle: "area62",
        editionDate: "2002-06-21",
        catalogNumber: "VIVI-19623",
        carrier: "CD",
        country: "JP",
      },
      {
        releaseGroupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
        releaseGroupTitle: "area62",
        releaseGroupDate: "2002-06-11",
        releaseGroupType: "Album",
        releaseId: null,
        editionTitle: "area62",
        editionDate: "2002-06-21",
        catalogNumber: "TGCS-1439",
        carrier: "CD",
        country: "JP",
      },
    ],
    conflict: "DATE_CONFLICT",
    conflictField: "date",
  },
};

const SEIKO_SPECIAL_LOVER_FIXED_BRIDGE = {
  manifestEntryKey: "SINGLE:71",
  workId: "curated-official-manifest:seiko-matsuda:SINGLE:71",
  editionId: "curated-official-manifest:seiko-matsuda:representation:SINGLE:71",
  officialUrl: "https://www.seikomatsuda.co.jp/discography/detail/244",
  releaseGroupId: "a7115395-0a0e-4c6a-8f3e-7e3177af923c",
  releaseId: "d8cd86c9-dbeb-4c90-901e-ca6b263f3d23",
  catalogNumber: "UMCK-5355",
  date: "2011-11-23",
} as const;

function hasSeikoSpecialLoverFixedBridge(candidate: ComprehensiveDiscographyCandidate) {
  const fixed = SEIKO_SPECIAL_LOVER_FIXED_BRIDGE;
  if (
    candidate.workId !== fixed.workId ||
    candidate.editionId !== fixed.editionId
  ) return false;
  const manifest = candidate.observations.filter((item) =>
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
    item.facts?.manifestEntryKey === fixed.manifestEntryKey);
  const official = candidate.observations.filter((item) =>
    item.provider === "seiko-matsuda-official" &&
    item.reasonCode === "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED" &&
    item.verdict === "PASS" &&
    item.sourceUrl === fixed.officialUrl &&
    item.facts?.manifestEntryKey === fixed.manifestEntryKey &&
    normalizedCatalog(item.facts?.catalogNumber) === normalizedCatalog(fixed.catalogNumber) &&
    item.facts?.date === fixed.date);
  const musicBrainz = candidate.observations.filter((item) =>
    item.provider === "musicbrainz" &&
    item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY" &&
    item.verdict === "PASS" &&
    item.sourceUrl === `https://musicbrainz.org/release/${fixed.releaseId}` &&
    item.facts?.manifestEntryKey === fixed.manifestEntryKey &&
    item.facts?.fixedReleaseGroupId === fixed.releaseGroupId &&
    item.facts?.fixedReleaseId === fixed.releaseId &&
    normalizedCatalog(item.facts?.editionCatalogNumber) === normalizedCatalog(fixed.catalogNumber) &&
    item.facts?.editionDate === fixed.date &&
    normalizedText(item.facts?.editionFormat) === "cd");
  return manifest.length === 1 && official.length === 1 && musicBrainz.length === 1;
}

function strictSeikoArtistIdentity(
  evidence: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["releaseGroup"],
  manifest: CuratedArtistDiscography,
  work: CuratedDiscographyWork,
) {
  if (!evidence) return false;
  const allowed = new Set([
    manifest.canonicalName,
    ...manifest.aliases,
    ...(work.artistCredits ?? []),
  ].map(normalizedCuratedWorkTitle).filter(Boolean));
  const names = evidence.artistNames.map(normalizedCuratedWorkTitle).filter(Boolean);
  const credit = normalizedCuratedWorkTitle(evidence.artistCredit);
  return names.length > 0 &&
    names.every((name) => allowed.has(name)) &&
    Boolean(credit && allowed.has(credit));
}

const musicBrainzUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validExistingSeikoMusicBrainzCandidate(
  candidate: ComprehensiveDiscographyCandidate,
  match: SeikoOfficialCuratedMatch,
  bundle: ArtistReleaseEvidenceBundle,
  manifest: CuratedArtistDiscography,
) {
  const sourceWorks = (bundle.works ?? []).filter((work) =>
    work.workId === candidate.workId && work.releaseGroup?.sourceId === work.workId);
  if (sourceWorks.length !== 1) return false;
  const sourceWork = sourceWorks[0]!;
  const releaseGroup = sourceWork.releaseGroup!;
  if (
    releaseGroup.entityType !== "release-group" ||
    releaseGroup.releaseGroupId !== releaseGroup.sourceId ||
    releaseGroup.sourceUrl !== `https://musicbrainz.org/release-group/${releaseGroup.sourceId}` ||
    !musicBrainzUuid.test(releaseGroup.sourceId) ||
    !strictSeikoArtistIdentity(releaseGroup, manifest, match.manifestWork) ||
    !curatedWorkTitleKeys(match.manifestWork).has(
      normalizedCuratedWorkTitle(releaseGroup.title),
    ) ||
    curatedReleaseGroupCategory(releaseGroup) !== match.manifestWork.category ||
    !curatedDatesCompatible(
      match.manifestWork.originalReleaseDate,
      releaseGroup.date,
    ) ||
    releaseGroup.secondaryTypes.some((value) =>
      ["compilation", "live", "remix", "djmix"].includes(normalizedText(value)))
  ) return false;

  const musicBrainzPasses = candidate.observations.filter((item) =>
    normalizedText(item.provider) === "musicbrainz" &&
    item.stage === "MUSICBRAINZ" &&
    item.verdict === "PASS");
  if (musicBrainzPasses.length === 0) return false;

  if (!musicBrainzUuid.test(candidate.editionId)) {
    return candidate.editionId.startsWith(
      "curated-official-manifest:seiko-matsuda:representation:",
    ) && musicBrainzPasses.some((item) => item.sourceUrl === releaseGroup.sourceUrl);
  }

  const editions = sourceWork.editions.filter((edition) =>
    edition.workId === sourceWork.workId &&
    edition.evidence.sourceId === candidate.editionId);
  if (editions.length !== 1) return false;
  const edition = editions[0]!.evidence;
  const formats = uniqueStrings([edition.format, ...edition.formats]).map(normalizedText);
  return edition.entityType === "release" &&
    edition.releaseGroupId === sourceWork.workId &&
    edition.sourceUrl === `https://musicbrainz.org/release/${edition.sourceId}` &&
    normalizedText(edition.status) === "official" &&
    edition.country === manifest.country &&
    formats.some((format) => format === "cd" || format.includes("bluspeccd")) &&
    strictSeikoArtistIdentity(edition, manifest, match.manifestWork) &&
    candidate.candidate.sources.some((source) => source.url === edition.sourceUrl) &&
    musicBrainzPasses.some((item) =>
      item.sourceUrl === edition.sourceUrl || item.sourceUrl === releaseGroup.sourceUrl);
}

function uniqueSeikoBridgeWork(
  match: SeikoOfficialCuratedMatch,
  bundle: ArtistReleaseEvidenceBundle,
  manifest: CuratedArtistDiscography,
) {
  const rule = seikoBridgeRules[match.manifestEntryKey];
  if (!rule) return null;
  const excludedSecondaryTypes = new Set(["compilation", "live", "remix", "djmix"]);
  const matches = rule.editions.flatMap((tuple) => {
    const sourceWorks = (bundle.works ?? []).filter((work) =>
      work.workId === tuple.releaseGroupId &&
      work.releaseGroup?.sourceId === tuple.releaseGroupId);
    if (sourceWorks.length !== 1) return [];
    const work = sourceWorks[0]!;
    const releaseGroup = work.releaseGroup!;
    if (
      releaseGroup.entityType !== "release-group" ||
      releaseGroup.releaseGroupId !== releaseGroup.sourceId ||
      releaseGroup.sourceId !== tuple.releaseGroupId ||
      !musicBrainzUuid.test(releaseGroup.sourceId) ||
      releaseGroup.sourceUrl !== `https://musicbrainz.org/release-group/${releaseGroup.sourceId}` ||
      !strictSeikoArtistIdentity(releaseGroup, manifest, match.manifestWork) ||
      normalizedCuratedWorkTitle(releaseGroup.title) !==
        normalizedCuratedWorkTitle(tuple.releaseGroupTitle) ||
      releaseGroup.date?.slice(0, 10) !== tuple.releaseGroupDate ||
      normalizedText(releaseGroup.type) !== normalizedText(tuple.releaseGroupType) ||
      releaseGroup.secondaryTypes.some((value) =>
        excludedSecondaryTypes.has(normalizedText(value)))
    ) return [];

    const editions = work.editions.filter((edition) => {
      const evidence = edition.evidence;
      const editionCatalogs = uniqueStrings([
        evidence.catalogNumber,
        ...evidence.labels.map((label) => label.catalogNumber),
      ]).map(normalizedCatalog);
      const formats = uniqueStrings([evidence.format, ...evidence.formats])
        .map(normalizedText);
      const carrierMatches = tuple.carrier === "CD"
        ? formats.some((format) => format === "cd" || format.includes("bluspeccd"))
        : formats.some((format) => format.includes("vinyl"));
      return evidence.entityType === "release" &&
        edition.workId === work.workId &&
        evidence.releaseGroupId === releaseGroup.sourceId &&
        musicBrainzUuid.test(evidence.sourceId) &&
        (tuple.releaseId === null || evidence.sourceId === tuple.releaseId) &&
        evidence.sourceUrl === `https://musicbrainz.org/release/${evidence.sourceId}` &&
        normalizedText(evidence.status) === "official" &&
        evidence.country === tuple.country &&
        strictSeikoArtistIdentity(evidence, manifest, match.manifestWork) &&
        editionCatalogs.includes(normalizedCatalog(tuple.catalogNumber)) &&
        evidence.date?.slice(0, 10) === tuple.editionDate &&
        normalizedCuratedWorkTitle(evidence.title) ===
          normalizedCuratedWorkTitle(tuple.editionTitle) &&
        carrierMatches;
    });
    if (editions.length !== 1) return [];
    return [{ sourceWork: work, edition: editions[0]!, tuple }];
  });
  const uniqueMatches = [...new Map(matches.map((item) => [
    `${item.sourceWork.workId}:${item.edition.evidence.sourceId}`,
    item,
  ])).values()];
  return uniqueMatches.length === 1 ? uniqueMatches[0]! : null;
}

function targetedSeikoMusicBrainzObservation(
  candidateId: string,
  match: SeikoOfficialCuratedMatch,
  sourceWork: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number],
  edition: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number]["editions"][number],
  tuple: SeikoBridgeEditionTuple,
): ComprehensiveEvidenceObservation {
  const releaseGroup = sourceWork.releaseGroup!;
  const release = edition.evidence;
  const boundCatalog = uniqueStrings([
    release.catalogNumber,
    ...release.labels.map((label) => label.catalogNumber),
  ]).find((value) => normalizedCatalog(value) === normalizedCatalog(tuple.catalogNumber)) ?? null;
  const canonicalCategory = match.manifestWork.category;
  const observedCategory = curatedReleaseGroupCategory(releaseGroup);
  const exactDate = releaseGroup.date?.slice(0, 10) === match.manifestWork.originalReleaseDate;
  return observation({
    id: `musicbrainz:seiko-targeted:${releaseGroup.sourceId}:${candidateId}`,
    provider: "musicbrainz",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "MUSICBRAINZ",
    verdict: "PASS",
    reasonCode: "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY",
    reason: "A fixed Seiko-only rule uniquely links this MusicBrainz release group to the canonical official entity by exact artist, a bounded title notation, a fixed date boundary, and an allowed primary type; semantic differences remain explicit AI review items.",
    sourceUrl: release.sourceUrl,
    matchedFields: [
      "artist",
      "title",
      "catalogNumber",
      "format",
      ...(exactDate ? ["date"] : []),
      ...(observedCategory === canonicalCategory ? ["category"] : []),
    ],
    facts: {
      manifestEntryKey: match.manifestEntryKey,
      artist: releaseGroup.artistCredit ?? releaseGroup.artistNames.join(","),
      title: releaseGroup.title,
      canonicalTitle: match.manifestWork.title,
      date: releaseGroup.date,
      canonicalDate: match.manifestWork.originalReleaseDate,
      category: observedCategory,
      canonicalCategory,
      sourceWorkId: sourceWork.workId,
      releaseGroupSourceUrl: releaseGroup.sourceUrl,
      editionSourceUrl: release.sourceUrl,
      editionTitle: release.title,
      editionDate: release.date,
      editionCatalogNumber: boundCatalog,
      editionFormat: release.format ?? release.formats.join(","),
      fixedReleaseGroupId: tuple.releaseGroupId,
      fixedReleaseId: tuple.releaseId,
      fixedRule: "SEIKO_FIVE_GAP_WORKS_V2_STRICT_TUPLES",
    },
  });
}

function seikoBridgeConflictMessage(
  match: SeikoOfficialCuratedMatch,
  sourceWork: NonNullable<ArtistReleaseEvidenceBundle["works"]>[number],
) {
  const releaseGroup = sourceWork.releaseGroup!;
  if (match.manifestEntryKey === "ORIGINAL_ALBUM:35") {
    return "The official Japanese CD entity declares 2002-06-21 while the MusicBrainz global work group declares 2002-06-11; compare source grain and reject only if the supplied evidence identifies different works rather than territory dates.";
  }
  if (match.manifestEntryKey === "ORIGINAL_ALBUM:29") {
    return "The official artist page and Sony numbered original-album canon classify this work as an album while MusicBrainz uses EP; decide the canonical work taxonomy without treating the supplied difference as a proven identity conflict.";
  }
  return `The official entity names the complete release boundary “${match.manifestWork.title}” while MusicBrainz names it “${releaseGroup.title}”; exact artist and date bind the comparison, and the official track list supplies the complete title boundary.`;
}

const SEIKO_SONY_BOX_TITLE =
  "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～";
const SEIKO_SONY_BOX_DATE = "2010-05-26";
const SEIKO_SONY_BOX_CATALOG_KEY = "SRCL20061SRCL20133";

function seikoSonyBoxManifestWorks(manifest: CuratedArtistDiscography | null) {
  if (manifest?.slug !== "seiko-matsuda") return null;
  const requiredOrdinals = new Set([...Array.from({ length: 26 }, (_, index) => index + 1), 29]);
  const matches = manifest.works.filter((work) => {
    const media = work.mediaScope;
    return work.category === "SINGLE" && requiredOrdinals.has(work.ordinal) &&
      media?.physicalCd === "LATER_OFFICIAL_EDITION" &&
      (media.physicalCdCountry ?? manifest.country) === "JP" &&
      media.physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
      media.physicalCdContainerTitle === SEIKO_SONY_BOX_TITLE &&
      media.physicalCdReleaseDate === SEIKO_SONY_BOX_DATE &&
      normalizedCatalog(media.physicalCdCatalogNumber) === SEIKO_SONY_BOX_CATALOG_KEY &&
      media.physicalCdAuthorityUrls.length === 1 &&
      media.physicalCdAuthorityUrls[0] ===
        SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX;
  });
  return matches.length === requiredOrdinals.size &&
      matches.every((work) => requiredOrdinals.has(work.ordinal))
    ? matches
    : null;
}

export function applySeikoSonyBoxCarrierEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  official: SeikoMatsudaOfficialResult | null;
}) {
  const works = seikoSonyBoxManifestWorks(input.manifest);
  if (!works) return [...input.candidates];
  const outcome = input.official?.externalEvidence?.sources.WHOS_SONY_BOX;
  const evidence = outcome?.status === "VERIFIED" && outcome.verified && outcome.unique &&
      outcome.warning === null && outcome.limitations.length === 0 &&
      outcome.evidence.evidenceKey === "WHOS_SONY_BOX"
    ? outcome.evidence
    : null;
  const fields = new Set(evidence?.verifiedFields ?? []);
  const valid = Boolean(
    input.official?.complete && evidence &&
    evidence.provenance.sourceUrl === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX &&
    evidence.observedArtist === "\u677e\u7530\u8056\u5b50" &&
    evidence.observedArtistCredit === "SEIKO" &&
    evidence.observedBoxTitle === SEIKO_SONY_BOX_TITLE &&
    evidence.observedBoxReleaseDate === SEIKO_SONY_BOX_DATE &&
    evidence.observedCatalogDisplay === "SRCL20061-133" &&
    evidence.observedCatalogRange.start === "SRCL-20061" &&
    evidence.observedCatalogRange.end === "SRCL-20133" &&
    evidence.completeSinglesCount === 73 && evidence.cdDiscCount === 73 &&
    evidence.carrier === "BLU_SPEC_CD" &&
    ["artist", "artistCredit", "title", "boxCompleteness", "date", "catalogRange", "carrier"]
      .every((field) => fields.has(field as typeof evidence.verifiedFields[number])),
  );
  const workByKey = new Map(works.map((work) => [curatedManifestEntryKey(work), work]));
  return input.candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    const work = key ? workByKey.get(key) : null;
    if (!key || !work || candidate.editionId !==
      `curated-official-manifest:seiko-matsuda:representation:${key}`) return candidate;
    if (!valid || !evidence) {
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "sony-music-japan",
        "CORROBORATING",
        "CORROBORATION",
        "SEIKO_SONY_BOX_CARRIER_NOT_FOUND",
        "The fixed Sony 73-disc singles-box evidence did not satisfy its complete carrier contract.",
        false,
      ));
    }
    const sourceUrl = evidence.provenance.sourceUrl;
    const sources = candidate.candidate.sources.some((source) => source.url === sourceUrl)
      ? candidate.candidate.sources
      : [...candidate.candidate.sources, {
          title: "Sony Music Japan complete singles box",
          url: sourceUrl,
          sourceType: "official" as const,
        }];
    return addComprehensiveObservation({
      ...candidate,
      candidate: { ...candidate.candidate, sources },
    }, observation({
      id: `sony-music-japan:seiko-box-carrier:${key}:${candidate.candidate.id}`,
      provider: "sony-music-japan",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "SEIKO_SONY_COMPLETE_SINGLES_CD_BOX_CARRIER_MATCH",
      reason: "Sony's unique fixed entity proves the complete 73-disc Blu-spec CD box carrier for this canonical single.",
      sourceUrl,
      matchedFields: [
        "artist",
        "title",
        "date",
        "catalogRange",
        "country",
        "carrier",
        "boxCompleteness",
        "uniqueCarrier",
      ],
      facts: {
        artist: evidence.observedArtist,
        artistCredit: evidence.observedArtistCredit,
        canonicalArtist: input.manifest!.canonicalName,
        carrierTitle: evidence.observedBoxTitle,
        canonicalTitle: work.title,
        date: evidence.observedBoxReleaseDate,
        catalogNumber: work.mediaScope!.physicalCdCatalogNumber,
        catalogDisplay: evidence.observedCatalogDisplay,
        catalogStart: evidence.observedCatalogRange.start,
        catalogEnd: evidence.observedCatalogRange.end,
        country: "JP",
        format: evidence.carrier,
        completeSinglesCount: String(evidence.completeSinglesCount),
        cdDiscCount: String(evidence.cdDiscCount),
        manifestEntryKey: key,
        physicalCdRepresentationKind: "CONTAINER_INCLUSION",
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

export function applySeikoOfficialEvidence(input: {
  candidates: readonly ComprehensiveDiscographyCandidate[];
  manifest: CuratedArtistDiscography | null;
  official: SeikoOfficialCuratedResult | null;
  bundle: ArtistReleaseEvidenceBundle;
  stats: ComprehensiveSourceStats;
}): SeikoOfficialApplication {
  const manifest = input.manifest;
  if (manifest?.slug !== "seiko-matsuda") {
    return { candidates: [...input.candidates], coversByWorkId: new Map() };
  }
  if (!input.official?.complete) {
    if (input.stats.seikoOfficialCalls > 0) input.stats.seikoOfficialIncomplete += 1;
    return { candidates: [...input.candidates], coversByWorkId: new Map() };
  }

  const output = [...input.candidates];
  const covers = new Map<string, SeikoMatsudaOfficialCoverEvidence>();
  const canonicalWorkIdByKey = new Map<string, string>();
  const ownersByWorkId = new Map<string, Set<string>>();
  const identityCollisionCandidateIds = new Set<string>();
  for (const candidate of output) {
    const manifestKeys = new Set(candidate.observations
      .filter((item) => item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")
      .map((item) => item.facts?.manifestEntryKey)
      .filter((value): value is string => Boolean(value)));
    if (manifestKeys.size > 1) {
      identityCollisionCandidateIds.add(candidate.candidate.id);
      continue;
    }
    const key = manifestKeys.size === 1 ? [...manifestKeys][0]! : null;
    if (!key) continue;
    const owners = ownersByWorkId.get(candidate.workId) ?? new Set<string>();
    owners.add(key);
    ownersByWorkId.set(candidate.workId, owners);
  }
  for (const match of input.official.matches) {
    const workIds = new Set(output
      .filter((candidate) =>
        candidateManifestEntryKey(candidate) === match.manifestEntryKey)
      .map((candidate) => candidate.workId));
    if (workIds.size !== 1) {
      output.filter((candidate) =>
        candidateManifestEntryKey(candidate) === match.manifestEntryKey)
        .forEach((candidate) => identityCollisionCandidateIds.add(candidate.candidate.id));
      continue;
    }
    const workId = [...workIds][0]!;
    canonicalWorkIdByKey.set(match.manifestEntryKey, workId);
  }
  for (const [workId, owners] of ownersByWorkId) {
    if (owners.size === 1) continue;
    output.filter((candidate) => candidate.workId === workId)
      .forEach((candidate) => identityCollisionCandidateIds.add(candidate.candidate.id));
  }
  if (identityCollisionCandidateIds.size > 0) {
    input.stats.seikoOfficialIncomplete += 1;
    const conflictSourceIds = uniqueStrings(output
      .filter((candidate) => identityCollisionCandidateIds.has(candidate.candidate.id))
      .flatMap((candidate) => candidate.observations
        .filter((item) => item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")
        .map((item) => item.id)));
    const blocked = output.map((candidate) => {
      if (!identityCollisionCandidateIds.has(candidate.candidate.id)) return candidate;
      const ownId = candidate.observations.find((item) =>
        item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")?.id;
      const peerId = conflictSourceIds.find((id) => id !== ownId);
      if (!ownId || !peerId) return candidate;
      return addComprehensiveConflict(candidate, {
        id: `seiko-manifest-work-id-collision:${candidate.candidate.id}`,
        certainty: "EXPLICIT",
        reasonCode: "EDITION_CONFLICT",
        field: "workId",
        sourceObservationIds: [ownId, peerId],
        message: "Two canonical Seiko manifest identities share one work id, or one identity is split across work ids; dynamic authority and cover assignment fail closed.",
      });
    });
    return { candidates: blocked, coversByWorkId: new Map() };
  }

  // Resolve every bridge against the immutable pre-bind graph first. This
  // prevents official.matches ordering from partially rebinding one
  // MusicBrainz work before a competing manifest key can claim it.
  const validMusicBrainzCandidateIdsByKey = new Map<string, Set<string>>();
  const bridgePlans = new Map<
    string,
    NonNullable<ReturnType<typeof uniqueSeikoBridgeWork>>
  >();
  const bridgeClaimsBySourceWorkId = new Map<string, Set<string>>();
  for (const match of input.official.matches) {
    const manifestCandidates = output.filter((candidate) =>
      candidateManifestEntryKey(candidate) === match.manifestEntryKey);
    const musicBrainzCandidates = manifestCandidates.filter((candidate) =>
      candidate.observations.some((item) =>
        normalizedText(item.provider) === "musicbrainz" &&
        item.stage === "MUSICBRAINZ" &&
        item.verdict === "PASS"));
    const validIds = new Set(musicBrainzCandidates
      .filter((candidate) => validExistingSeikoMusicBrainzCandidate(
        candidate,
        match,
        input.bundle,
        manifest,
      ))
      .map((candidate) => candidate.candidate.id));
    validMusicBrainzCandidateIdsByKey.set(match.manifestEntryKey, validIds);
    if (validIds.size > 0) continue;
    const bridge = uniqueSeikoBridgeWork(match, input.bundle, manifest);
    if (!bridge) continue;
    bridgePlans.set(match.manifestEntryKey, bridge);
    const claims = bridgeClaimsBySourceWorkId.get(bridge.sourceWork.workId) ?? new Set<string>();
    claims.add(match.manifestEntryKey);
    bridgeClaimsBySourceWorkId.set(bridge.sourceWork.workId, claims);
  }
  const unsafeBridgeKeys = new Set<string>();
  for (const [sourceWorkId, claims] of bridgeClaimsBySourceWorkId) {
    const existingOwners = ownersByWorkId.get(sourceWorkId) ?? new Set<string>();
    const combinedOwners = new Set([...claims, ...existingOwners]);
    if (combinedOwners.size <= 1) continue;
    combinedOwners.forEach((key) => unsafeBridgeKeys.add(key));
  }
  if (unsafeBridgeKeys.size > 0) input.stats.seikoOfficialIncomplete += 1;

  for (const match of input.official.matches) {
    const manifestCandidates = output.filter((candidate) =>
      candidateManifestEntryKey(candidate) === match.manifestEntryKey);
    const workId = canonicalWorkIdByKey.get(match.manifestEntryKey)!;
    const musicBrainzCandidates = manifestCandidates.filter((candidate) =>
      candidate.observations.some((item) =>
        normalizedText(item.provider) === "musicbrainz" &&
        item.stage === "MUSICBRAINZ" &&
        item.verdict === "PASS"));
    const validMusicBrainzCandidateIds =
      validMusicBrainzCandidateIdsByKey.get(match.manifestEntryKey) ?? new Set<string>();
    for (const candidate of musicBrainzCandidates) {
      if (validMusicBrainzCandidateIds.has(candidate.candidate.id)) continue;
      const index = output.findIndex((item) => item.candidate.id === candidate.candidate.id);
      const manifestObservation = candidate.observations.find((item) =>
        item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH");
      const musicBrainzObservation = candidate.observations.find((item) =>
        normalizedText(item.provider) === "musicbrainz" &&
        item.stage === "MUSICBRAINZ" &&
        item.verdict === "PASS");
      if (index < 0 || !manifestObservation || !musicBrainzObservation) continue;
      output[index] = addComprehensiveConflict(output[index]!, {
        id: `seiko-existing-musicbrainz-identity:${candidate.candidate.id}`,
        certainty: "EXPLICIT",
        reasonCode: "EDITION_CONFLICT",
        field: "musicBrainzIdentity",
        sourceObservationIds: [manifestObservation.id, musicBrainzObservation.id],
        message: "The existing MusicBrainz work or edition failed the fixed Seiko artist, id, official-status, country, or CD-carrier identity boundary.",
      });
    }
    const bridge = unsafeBridgeKeys.has(match.manifestEntryKey)
      ? null
      : bridgePlans.get(match.manifestEntryKey) ?? null;

    if (unsafeBridgeKeys.has(match.manifestEntryKey)) {
      const ownCandidates = output.filter((candidate) =>
        candidateManifestEntryKey(candidate) === match.manifestEntryKey);
      const peerObservationId = output.flatMap((candidate) => candidate.observations)
        .find((item) =>
          item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
          item.facts?.manifestEntryKey !== match.manifestEntryKey)?.id;
      for (const candidate of ownCandidates) {
        const index = output.findIndex((item) => item.candidate.id === candidate.candidate.id);
        const ownObservationId = candidate.observations.find((item) =>
          item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")?.id;
        if (index < 0 || !ownObservationId || !peerObservationId) continue;
        output[index] = addComprehensiveConflict(output[index]!, {
          id: `seiko-bridge-work-id-collision:${candidate.candidate.id}`,
          certainty: "EXPLICIT",
          reasonCode: "EDITION_CONFLICT",
          field: "workId",
          sourceObservationIds: [ownObservationId, peerObservationId],
          message: "One MusicBrainz work was claimed by multiple Seiko manifest identities, so the fixed bridge failed closed before rebinding.",
        });
      }
    }

    if (bridge && bridge.sourceWork.workId !== workId) {
      for (let index = 0; index < output.length; index += 1) {
        const candidate = output[index]!;
        const key = candidateManifestEntryKey(candidate);
        if (
          candidate.workId === bridge.sourceWork.workId &&
          (!key || key === match.manifestEntryKey)
        ) {
          output[index] = { ...candidate, workId };
        }
      }
    }

    for (const candidate of manifestCandidates) {
      const index = output.findIndex((item) => item.candidate.id === candidate.candidate.id);
      if (index < 0) continue;
      const currentCandidate = output[index]!;
      const sourceRows: ReleaseResearchCandidate["sources"] = [{
            title: "Seiko Matsuda official work entity",
            url: match.entity.sourceUrl,
            sourceType: "official" as const,
          }];
      if (bridge?.sourceWork.releaseGroup) {
        sourceRows.push({
          title: "MusicBrainz release group",
          url: bridge.sourceWork.releaseGroup.sourceUrl,
          sourceType: "database",
        });
      }
      const sources = [...new Map([
        ...currentCandidate.candidate.sources,
        ...sourceRows,
      ].map((source) => [source.url, source])).values()];
      let enriched: ComprehensiveDiscographyCandidate = {
        ...currentCandidate,
        candidate: {
          ...currentCandidate.candidate,
          sources,
        },
      };
      enriched = addComprehensiveObservation(enriched, {
        ...match.authority,
        id: `${match.authority.id}:${candidate.candidate.id}`,
      });
      for (const external of match.externalObservations) {
        enriched = addComprehensiveObservation(enriched, {
          ...external,
          id: `${external.id}:${candidate.candidate.id}`,
        });
      }
      if (bridge) {
        const musicBrainz = targetedSeikoMusicBrainzObservation(
          candidate.candidate.id,
          match,
          bridge.sourceWork,
          bridge.edition,
          bridge.tuple,
        );
        enriched = addComprehensiveObservation(enriched, musicBrainz);
        const releaseGroup = bridge.sourceWork.releaseGroup!;
        const rule = seikoBridgeRules[match.manifestEntryKey]!;
        const observedCategory = curatedReleaseGroupCategory(releaseGroup);
        const needsConflict = rule.conflict === "TITLE_CONFLICT"
          ? normalizedCuratedWorkTitle(releaseGroup.title) !==
            normalizedCuratedWorkTitle(match.manifestWork.title)
          : rule.conflict === "FORMAT_CONFLICT"
            ? observedCategory !== match.manifestWork.category
            : releaseGroup.date?.slice(0, 10) !== match.manifestWork.originalReleaseDate;
        if (needsConflict) {
          const officialId = `${match.authority.id}:${candidate.candidate.id}`;
          enriched = addComprehensiveConflict(enriched, {
            id: `seiko-targeted-review:${match.manifestEntryKey}:${candidate.candidate.id}`,
            certainty: "AI_REVIEW",
            reasonCode: rule.conflict,
            field: rule.conflictField,
            sourceObservationIds: [officialId, musicBrainz.id],
            message: seikoBridgeConflictMessage(match, bridge.sourceWork),
          });
        }
      }
      output[index] = enriched;
    }
    covers.set(workId, match.cover);
    input.stats.seikoOfficialMatchedWorks += 1;
  }

  return { candidates: output, coversByWorkId: covers };
}

function ndlCandidate(
  candidate: ComprehensiveDiscographyCandidate,
  artist: { primary: string; aliases: string[] },
): NdlCandidate | null {
  const release = candidate.candidate;
  const date = release.releaseDate ?? release.originalReleaseDate;
  if (!release.catalogNumber?.trim() || !date?.trim()) return null;
  return {
    artist: artist.primary,
    artistAliases: artist.aliases,
    title: release.title,
    titleAliases: release.titleOriginal ? [release.titleOriginal] : [],
    catalogNumber: release.catalogNumber,
    date,
  };
}

function ndlUnknownReason(reason: string | null | undefined) {
  if (reason === "ambiguous-catalog") return "NDL_AMBIGUOUS_CATALOG";
  if (reason === "catalog-not-found") return "NDL_CATALOG_NOT_FOUND";
  if (reason === "incomplete-results") return "NDL_RESULTS_INCOMPLETE";
  if (reason === "artist-mismatch") return "NDL_ARTIST_CONFLICT_UNRESOLVED";
  if (reason === "date-conflict") return "NDL_DATE_CONFLICT_UNRESOLVED";
  if (reason === "date-missing") return "NDL_DATE_MISSING";
  if (reason === "title-mismatch") return "NDL_TITLE_UNRESOLVED";
  return "NDL_CANDIDATE_INCOMPLETE";
}

function retryableNdlResult(result: NdlClientResult | null) {
  return Boolean(result?.warnings.some((warning) => warning.retryable));
}

function exactDiscogsRows(
  candidate: ComprehensiveDiscographyCandidate,
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  const release = candidate.candidate;
  const titleKeys = new Set([release.title, release.titleOriginal].map(normalizedText).filter(Boolean));
  const catalog = normalizedCatalog(release.catalogNumber);
  const year = yearOf(release.releaseDate) ?? yearOf(release.originalReleaseDate);
  if (titleKeys.size === 0 || !catalog || year === null) return [];
  return rows.filter((row) =>
    titleKeys.has(normalizedText(discogsTitle(row.title))) &&
    normalizedCatalog(row.catalogNumber) === catalog &&
    row.year === year);
}

function identifierBoundDiscogsRows(
  candidate: ComprehensiveDiscographyCandidate,
  candidates: readonly ComprehensiveDiscographyCandidate[],
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  const catalog = normalizedCatalog(candidate.candidate.catalogNumber);
  const year = yearOf(candidate.candidate.releaseDate) ?? yearOf(candidate.candidate.originalReleaseDate);
  if (!catalog || year === null) return [];
  const matchingWorks = new Set(candidates.filter((item) =>
    normalizedCatalog(item.candidate.catalogNumber) === catalog &&
    (yearOf(item.candidate.releaseDate) ?? yearOf(item.candidate.originalReleaseDate)) === year)
    .map((item) => item.workId));
  if (matchingWorks.size !== 1 || !matchingWorks.has(candidate.workId)) return [];
  return rows.filter((row) =>
    normalizedCatalog(row.catalogNumber) === catalog && row.year === year);
}

function matchingDiscogsRows(
  candidate: ComprehensiveDiscographyCandidate,
  candidates: readonly ComprehensiveDiscographyCandidate[],
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  const exact = exactDiscogsRows(candidate, rows);
  return exact.length > 0 ? exact : identifierBoundDiscogsRows(candidate, candidates, rows);
}

function curatedSyntheticIdentity(candidate: ComprehensiveDiscographyCandidate) {
  return inspectCuratedSyntheticWorkIdentity({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  });
}

function matchingCuratedCarrierRows(
  candidate: ComprehensiveDiscographyCandidate,
  identity: CuratedSyntheticWorkIdentity,
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  if (identity.representationKind === "WORK_ONLY" || !identity.workIdentityLocked) return [];
  const catalog = normalizedCatalog(identity.physicalCdCatalogNumber);
  const year = yearOf(identity.physicalCdReleaseDate);
  const candidateCatalog = normalizedCatalog(candidate.candidate.catalogNumber);
  const candidateDate = candidate.candidate.releaseDate?.slice(0, 10) ?? null;
  const expectedTitle = identity.representationKind === "CONTAINER_INCLUSION"
    ? identity.physicalCdContainerTitle
    : identity.canonicalTitle;
  if (
    !catalog ||
    year === null ||
    !expectedTitle ||
    candidateCatalog !== catalog ||
    candidateDate !== identity.physicalCdReleaseDate
  ) return [];

  const allowedArtists = new Set(identity.allowedArtistNames.map(normalizedText));
  // This direct row scan is intentionally limited to an already locked
  // curated synthetic identity. Going through matchingDiscogsRows here lets a
  // supplemental candidate carrying the same product tuple shadow the one
  // manifest work. Generic and later-master candidates still use the normal
  // work/edition matcher and retain their existing scope decisions.
  const matched = rows.filter((row) => {
    const artist = discogsArtistCredit(row.title);
    const formats = row.formats.map((format) =>
      format.normalize("NFKC").trim().toUpperCase());
    return Boolean(
      artist && allowedArtists.has(normalizedText(artist)) &&
      row.country === "Japan" &&
      formats.includes("CD") &&
      !formats.some((format) => format === "PROMO" || format === "PROMOTIONAL") &&
      curatedCarrierCatalogMatches(identity.physicalCdCatalogNumber, row.catalogNumber) &&
      row.year === year &&
      normalizedText(discogsTitle(row.title)) === normalizedText(expectedTitle),
    );
  });
  // The manifest declares one concrete carrier tuple. Multiple Discogs rows
  // for that tuple are ambiguous at edition grain and cannot prove it.
  return matched.length === 1 ? matched : [];
}

function discogsRowsForCover(
  candidate: ComprehensiveDiscographyCandidate,
  candidates: readonly ComprehensiveDiscographyCandidate[],
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  const identity = curatedSyntheticIdentity(candidate);
  if (!identity) return matchingDiscogsRows(candidate, candidates, rows);
  if (identity.representationKind === "CONTAINER_INCLUSION") {
    // A compilation/box image is not artwork for the canonical contained
    // work. The independently bound original-work source remains available
    // later in the cover fallback chain.
    return [];
  }
  return identity.representationKind === "WORK_ONLY"
    ? []
    : matchingCuratedCarrierRows(candidate, identity, rows);
}

function knownWorkIdsByDiscogsMaster(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  rows: readonly DiscogsSearchReleaseEvidence[],
) {
  const values = new Map<number, Set<string>>();
  for (const candidate of candidates) {
    for (const row of matchingDiscogsRows(candidate, candidates, rows)) {
      if (row.masterId === null) continue;
      const workIds = values.get(row.masterId) ?? new Set<string>();
      workIds.add(candidate.workId);
      values.set(row.masterId, workIds);
    }
  }
  return new Map([...values.entries()]
    .filter((entry) => entry[1].size === 1)
    .map(([masterId, workIds]) => [masterId, [...workIds][0]!]));
}

function musicBrainzObservationId(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.observations.find((item) =>
    normalizedText(item.provider) === "musicbrainz" && item.stage === "MUSICBRAINZ")?.id ?? null;
}

function musicBrainzReleaseId(candidate: ComprehensiveDiscographyCandidate) {
  if (musicBrainzUuid.test(candidate.editionId)) return candidate.editionId;

  // Curated manifest application can replace editionId with its exact
  // representation id. Recover the original release identity only from the
  // internally-created MusicBrainz observation whose id and source URL agree;
  // never scan display sources, which may contain manifest reference links.
  const trusted = new Set(candidate.observations.flatMap((item) => {
    if (
      normalizedText(item.provider) !== "musicbrainz" ||
      item.stage !== "MUSICBRAINZ" ||
      item.verdict !== "PASS" ||
      item.reasonCode !== "MUSICBRAINZ_EDITION_DISCOVERED"
    ) return [];
    const id = item.id.match(/^musicbrainz:([0-9a-f-]+)$/iu)?.[1] ?? null;
    const sourceId = item.sourceUrl?.match(
      /^https:\/\/musicbrainz\.org\/release\/([0-9a-f-]+)$/iu,
    )?.[1] ?? null;
    if (!id || !sourceId || id.toLocaleLowerCase("en") !== sourceId.toLocaleLowerCase("en") ||
      !musicBrainzUuid.test(id)) {
      return [];
    }
    return [id];
  }));
  if (trusted.size !== 1) return null;
  const id = [...trusted][0]!;
  return candidate.candidate.id.toLocaleLowerCase("en") ===
      `release-${id}`.toLocaleLowerCase("en")
    ? id
    : null;
}

function musicBrainzReleaseGroupId(candidate: ComprehensiveDiscographyCandidate) {
  return musicBrainzUuid.test(candidate.workId) ? candidate.workId : null;
}

async function safeNdlInventory(
  ndl: Pick<NdlSearchClient, "searchArtistInventory">,
  artist: string,
) {
  try {
    return await ndl.searchArtistInventory(artist, 500);
  } catch (error) {
    return {
      value: null,
      warnings: [{
        code: "network-unavailable" as const,
        message: error instanceof Error ? error.message : "NDL Search was unavailable.",
        retryable: true,
        status: null,
      }],
    } satisfies NdlClientResult;
  }
}

async function safeOfficialResearch(
  research: (input: OfficialMusicResearchInput) => Promise<OfficialMusicResearchResult>,
  input: OfficialMusicResearchInput,
) {
  try {
    return await research(input);
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Official catalogue research failed.",
      reasonCode: "OFFICIAL_CATALOG_UNAVAILABLE",
      retryable: true,
    } as const;
  }
}

async function searchDiscogsSources(
  discogs: Pick<DiscogsClient, "searchJapanCdReleases">,
  queries: readonly string[],
  limits: Required<Pick<
    ComprehensiveSourceAdapterLimits,
    "maxDiscogsPagesPerQuery" | "maxDiscogsItemsPerQuery"
  >>,
  stats: ComprehensiveSourceStats,
): Promise<DiscogsSearchState> {
  const rows = new Map<number, DiscogsSearchReleaseEvidence>();
  let incomplete = false;
  let retryable = false;
  let message: string | null = null;
  for (const query of queries) {
    stats.discogsSearchCalls += 1;
    try {
      const response = await discogs.searchJapanCdReleases(query, {
        maxPages: limits.maxDiscogsPagesPerQuery,
        maxItems: limits.maxDiscogsItemsPerQuery,
      });
      response.value.items.forEach((row) => rows.set(row.releaseId, row));
      incomplete ||= response.value.partial || response.warnings.length > 0;
      retryable ||= response.value.partial || response.warnings.some((warning) => warning.retryable);
      message ??= response.warnings[0]?.message ?? null;
    } catch (error) {
      incomplete = true;
      retryable = true;
      message ??= error instanceof Error ? error.message : "Discogs search was unavailable.";
    }
  }
  return { rows: [...rows.values()], incomplete, retryable, message };
}

function curatedPhysicalQueries(
  manifest: CuratedArtistDiscography,
  maximum: number,
) {
  const names = uniqueStrings([manifest.canonicalName, ...manifest.aliases]);
  const scriptRank = (value: string) => {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 0;
    if (/\p{Script=Latin}/u.test(value)) return 1;
    return 2;
  };
  return names
    .map((name, index) => ({ name, index, rank: scriptRank(name) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, maximum)
    .map((item) => item.name);
}

async function searchCuratedPhysicalInventory(
  search: DiscogsClient["searchJapanPhysicalReleases"] | null,
  manifest: CuratedArtistDiscography | null,
  limits: Required<Pick<
    ComprehensiveSourceAdapterLimits,
    | "maxCuratedPhysicalQueries"
    | "maxCuratedPhysicalPagesPerQuery"
    | "maxCuratedPhysicalItemsPerQuery"
  >>,
  stats: ComprehensiveSourceStats,
): Promise<CuratedPhysicalSearchState> {
  if (!search || !manifest || manifest.country !== "JP") {
    return { inventory: null, rows: [], complete: false, retryable: false };
  }
  const exactNames = [manifest.canonicalName, ...manifest.aliases];
  const exactNameKeys = new Set(exactNames.map(normalizedCuratedWorkTitle).filter(Boolean));
  let retryable = false;
  for (const query of curatedPhysicalQueries(manifest, limits.maxCuratedPhysicalQueries)) {
    stats.curatedPhysicalSearchCalls += 1;
    try {
      const response: DiscogsResult<DiscogsJapanPhysicalSearchResult> = await search(query, {
        maxPages: limits.maxCuratedPhysicalPagesPerQuery,
        maxItems: limits.maxCuratedPhysicalItemsPerQuery,
      });
      const returnedQuery = response.value.artistQuery;
      const exactReturnedQuery = normalizedCuratedWorkTitle(returnedQuery) ===
          normalizedCuratedWorkTitle(query) &&
        exactNameKeys.has(normalizedCuratedWorkTitle(returnedQuery));
      retryable ||= response.value.partial || response.warnings.some((warning) => warning.retryable);
      stats.curatedPhysicalRetryableFailures += response.warnings.filter((warning) =>
        warning.retryable).length;
      if (response.warnings.some((warning) => warning.code === "rate-limited") ||
        response.rateLimit?.remaining === 0) {
        stats.curatedPhysicalRateLimits += 1;
      }
      if (!exactReturnedQuery || response.value.items.length === 0) continue;

      const complete = !response.value.partial && response.warnings.length === 0;
      if (!complete) stats.curatedPhysicalIncompleteInventories += 1;
      stats.curatedPhysicalRows = response.value.items.length;
      stats.curatedPhysicalSourceTotal = response.value.sourceTotal;
      stats.curatedPhysicalPagesFetched = response.value.pagesFetched;
      return {
        inventory: {
          exact: true,
          query: returnedQuery,
          artistNames: exactNames,
        },
        rows: response.value.items,
        complete,
        retryable,
      };
    } catch {
      retryable = true;
      stats.curatedPhysicalRetryableFailures += 1;
    }
  }
  return { inventory: null, rows: [], complete: false, retryable };
}

async function safeItunesSearch(
  search: NonNullable<ComprehensiveSourceAdapterDependencies["searchItunes"]>,
  artist: string,
  country: string,
  stats: ComprehensiveSourceStats,
): Promise<ItunesSearchState> {
  stats.itunesCalls += 1;
  try {
    return { albums: await search(artist, country), unavailable: false };
  } catch {
    return { albums: [], unavailable: true };
  }
}

function validOfficialUrls(
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
) {
  return uniqueStrings([
    result.artist.officialSiteUrl,
    ...(bundle.artist?.officialUrls ?? []),
  ]);
}

function addNdlEvidence(
  candidate: ComprehensiveDiscographyCandidate,
  decision: ReturnType<typeof matchNdlCandidateForComprehensiveAudit>,
) {
  if (!decision.evidence) return candidate;
  const evidence = decision.evidence;
  const ndlObservation = observation({
    id: `ndl:${evidence.recordId}`,
    provider: "ndl-search",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: evidence.titleComparison === "requires-ai"
      ? "NDL_CATALOG_ARTIST_DATE_MATCH_TITLE_REVIEW"
      : "NDL_CONTROLLED_EDITION_MATCH",
    reason: evidence.titleComparison === "requires-ai"
      ? "A unique NDL catalog record matches artist and date; the supplied title pair requires AI comparison."
      : "A unique NDL national-bibliography record matches the physical edition.",
    sourceUrl: evidence.sourceUrl,
    matchedFields: evidence.matchedFields,
    facts: {
      artist: candidate.candidate.artistCredit,
      title: evidence.authoritativeTitle,
      observedTitle: evidence.observedTitle,
      catalogNumber: evidence.observedCatalogNumber,
      date: evidence.observedIssued,
    },
  });
  let next = addComprehensiveObservation(candidate, ndlObservation);
  const releaseDate = preciseCompatibleDate(
    next.candidate.releaseDate,
    evidence.observedIssued,
  );
  if (releaseDate !== next.candidate.releaseDate) {
    next = {
      ...next,
      candidate: { ...next.candidate, releaseDate },
    };
  }
  if (evidence.titleComparison === "requires-ai") {
    const musicBrainzId = musicBrainzObservationId(candidate);
    const comparisonId = musicBrainzId ?? candidate.observations.find((item) =>
      normalizedText(item.provider) === "discogs" &&
      item.role === "CORROBORATING" &&
      item.verdict === "PASS")?.id;
    if (comparisonId) {
      next = addComprehensiveConflict(next, {
        id: `ndl-title-review:${candidate.candidate.id}`,
        certainty: "AI_REVIEW",
        reasonCode: "TITLE_CONFLICT",
        field: "title",
        sourceObservationIds: [comparisonId, ndlObservation.id],
        message: "Catalog number, artist, and date uniquely bind this edition; compare the two supplied title notations and reject only if they clearly name different works.",
      });
    }
  }
  return next;
}

function exactAkinaNdlTitleReviewChain(
  candidate: ComprehensiveDiscographyCandidate,
  ndlObservation: ComprehensiveEvidenceObservation,
  manifest: CuratedArtistDiscography,
  work: CuratedDiscographyWork,
  contract: AkinaFixedCarrierContract,
) {
  const observationById = new Map(candidate.observations.map((item) => [item.id, item]));
  const matches = candidate.conflicts.filter((conflict) =>
    conflict.certainty === "AI_REVIEW" &&
    conflict.reasonCode === "TITLE_CONFLICT" &&
    conflict.field === "title" &&
    conflict.sourceObservationIds.length === 2 &&
    conflict.sourceObservationIds.includes(ndlObservation.id) &&
    conflict.sourceObservationIds.every((id) => observationById.has(id)) &&
    conflict.sourceObservationIds.some((id) => {
      const source = observationById.get(id);
      if (id === ndlObservation.id || source?.verdict !== "PASS") return false;
      if (["musicbrainz", "discogs"].includes(normalizedText(source.provider))) return true;
      return source.provider === "curated-official-manifest:akina-nakamori" &&
        source.role === "AUTHORITATIVE" && source.strength === "STRONG" &&
        source.stage === "AUTHORITATIVE" &&
        source.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
        source.facts?.manifestEntryKey === contract.manifestEntryKey &&
        normalizedCuratedWorkTitle(source.facts?.artist) ===
          normalizedCuratedWorkTitle(manifest.canonicalName) &&
        normalizedCuratedWorkTitle(source.facts?.title) ===
          normalizedCuratedWorkTitle(work.title) &&
        source.facts?.date === work.originalReleaseDate;
    }));
  return matches.length === 1 ? matches[0]! : null;
}

function applyAkinaFixedNdlCarrierEvidence(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  manifest: CuratedArtistDiscography | null,
) {
  const contracts = new Map<string, AkinaFixedCarrierContract>(AKINA_FIXED_NDL_CARRIERS.map((contract) => [
    contract.manifestEntryKey,
    contract,
  ]));
  return candidates.map((candidate) => {
    const key = candidateManifestEntryKey(candidate);
    const contract = key ? contracts.get(key) : null;
    const work = contract ? exactAkinaFixedManifestWork(manifest, contract) : null;
    if (!key || !contract || !work || candidate.editionId !==
      `curated-official-manifest:akina-nakamori:representation:${key}`) return candidate;
    const allowedArtists = new Set([
      manifest!.canonicalName,
      ...manifest!.aliases,
      ...(work.artistCredits ?? []),
    ].map(normalizedCuratedWorkTitle).filter(Boolean));
    const completeCandidateTuple =
      curatedWorkTitleKeys(work).has(normalizedCuratedWorkTitle(candidate.candidate.title)) &&
      allowedArtists.has(normalizedCuratedWorkTitle(candidate.candidate.artistCredit)) &&
      candidate.candidate.releaseDate === contract.releaseDate &&
      normalizedCatalog(candidate.candidate.catalogNumber) ===
        normalizedCatalog(contract.catalogNumber) &&
      /(^|[^\p{L}\p{N}])CD([^\p{L}\p{N}]|$)/iu.test(candidate.candidate.format ?? "");
    const reviewCandidates = candidate.observations.filter((item) => {
      const fields = new Set(item.matchedFields);
      return completeCandidateTuple && normalizedText(item.provider) === "ndlsearch" &&
        item.role === "AUTHORITATIVE" && item.strength === "STRONG" &&
        item.stage === "AUTHORITATIVE" && item.verdict === "PASS" &&
        item.reasonCode === "NDL_CATALOG_ARTIST_DATE_MATCH_TITLE_REVIEW" &&
        item.sourceUrl === contract.authorityUrl &&
        allowedArtists.has(normalizedCuratedWorkTitle(item.facts?.artist)) &&
        normalizedCatalog(item.facts?.catalogNumber) === normalizedCatalog(contract.catalogNumber) &&
        Boolean(item.facts?.date) && curatedDatesCompatible(contract.releaseDate, item.facts?.date) &&
        fields.has("artist") && fields.has("catalogNumber") && fields.has("date") &&
        !fields.has("title");
    });
    const manifestComparisons = candidate.observations.filter((item) =>
      item.provider === "curated-official-manifest:akina-nakamori" &&
      item.role === "AUTHORITATIVE" && item.strength === "STRONG" &&
      item.stage === "AUTHORITATIVE" && item.verdict === "PASS" &&
      item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
      item.facts?.manifestEntryKey === key &&
      normalizedCuratedWorkTitle(item.facts?.artist) ===
        normalizedCuratedWorkTitle(manifest!.canonicalName) &&
      normalizedCuratedWorkTitle(item.facts?.title) === normalizedCuratedWorkTitle(work.title) &&
      item.facts?.date === work.originalReleaseDate);
    let working = candidate;
    if (reviewCandidates.length === 1 && manifestComparisons.length === 1 &&
      !exactAkinaNdlTitleReviewChain(
        working,
        reviewCandidates[0]!,
        manifest!,
        work,
        contract,
      )) {
      working = addComprehensiveConflict(working, {
        id: `ndl-title-review:${candidate.candidate.id}:manifest-fixed`,
        certainty: "AI_REVIEW",
        reasonCode: "TITLE_CONFLICT",
        field: "title",
        sourceObservationIds: [manifestComparisons[0]!.id, reviewCandidates[0]!.id],
        message: "The exact NDL CD record is catalog/date bound but exposes an abbreviated title; compare it only with this manifest work title.",
      });
    }
    const ndlMatches = working.observations.filter((item) => {
      const fields = new Set(item.matchedFields);
      if (
        normalizedText(item.provider) !== "ndlsearch" ||
        item.role !== "AUTHORITATIVE" ||
        item.strength !== "STRONG" ||
        item.stage !== "AUTHORITATIVE" ||
        item.verdict !== "PASS" ||
        item.sourceUrl !== contract.authorityUrl ||
        !allowedArtists.has(normalizedCuratedWorkTitle(item.facts?.artist)) ||
        normalizedCatalog(item.facts?.catalogNumber) !==
          normalizedCatalog(contract.catalogNumber) ||
        !item.facts?.date || !curatedDatesCompatible(contract.releaseDate, item.facts.date) ||
        !fields.has("artist") || !fields.has("catalogNumber") || !fields.has("date")
      ) return false;
      if (item.reasonCode === "NDL_CONTROLLED_EDITION_MATCH") {
        return fields.has("title") &&
          curatedWorkTitleKeys(work).has(normalizedCuratedWorkTitle(item.facts?.title));
      }
      return item.reasonCode === "NDL_CATALOG_ARTIST_DATE_MATCH_TITLE_REVIEW" &&
        !fields.has("title") && Boolean(exactAkinaNdlTitleReviewChain(
          working,
          item,
          manifest!,
          work,
          contract,
        ));
    });
    if (ndlMatches.length !== 1 || !completeCandidateTuple) {
      return addComprehensiveObservation(working, sourceFailureObservation(
        candidate.candidate.id,
        "ndl-search",
        "CORROBORATING",
        "CORROBORATION",
        "AKINA_FIXED_NDL_CD_CARRIER_NOT_FOUND",
        "The exact manifest-declared NDL record did not uniquely match the complete Akina same-work CD tuple.",
        false,
      ));
    }
    const ndl = ndlMatches[0]!;
    const review = ndl.reasonCode === "NDL_CATALOG_ARTIST_DATE_MATCH_TITLE_REVIEW"
      ? exactAkinaNdlTitleReviewChain(working, ndl, manifest!, work, contract)
      : null;
    const matchedFields = [
      "artist",
      "date",
      "catalogNumber",
      "country",
      "format",
      "uniqueCarrier",
      ...(review ? ["titleReviewChain"] : ["title"]),
    ];
    return addComprehensiveObservation(working, observation({
      id: `ndl:akina-fixed-carrier:${key}:${candidate.candidate.id}`,
      provider: "ndl-search",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "AKINA_FIXED_NDL_CD_CARRIER_MATCH",
      reason: review
        ? "The one manifest-declared NDL record exactly binds artist, catalog and full date to this CD; its supplied title pair is attached to one explicit AI review chain."
        : "The one manifest-declared NDL record exactly binds the controlled title, artist, catalog and full date to this CD.",
      sourceUrl: contract.authorityUrl,
      matchedFields,
      facts: {
        artist: ndl.facts?.artist ?? null,
        canonicalArtist: manifest!.canonicalName,
        carrierTitle: ndl.facts?.title ?? null,
        canonicalTitle: work.title,
        date: ndl.facts?.date ?? null,
        catalogNumber: ndl.facts?.catalogNumber ?? null,
        country: "JP",
        format: "CD",
        manifestEntryKey: key,
        physicalCdRepresentationKind: "SAME_WORK_EDITION",
        ndlObservationId: ndl.id,
        titleMatch: review ? "AI_REVIEW" : "CONTROLLED_EQUIVALENT",
        titleReviewConflictId: review?.id ?? null,
        uniqueBinding: "true",
        uniqueCarrierEntity: "true",
      },
    }));
  });
}

function enrichWithNdlSingleManifest(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  manifests: NdlSingleManifestResult,
  stats: ComprehensiveSourceStats,
) {
  type ManifestTitleMatch = {
    manifest: NdlSingleManifestResult["evidence"][number];
    sourceTrackTitle: string;
  };
  const byTitle = new Map<string, ManifestTitleMatch[]>();
  for (const manifest of manifests.evidence) {
    for (const title of manifest.trackTitles) {
      const key = normalizedText(title);
      if (!key) continue;
      const values = byTitle.get(key) ?? [];
      if (!values.some((value) =>
        value.manifest.recordId === manifest.recordId &&
        normalizedText(value.sourceTrackTitle) === key)) {
        values.push({ manifest, sourceTrackTitle: title });
      }
      byTitle.set(key, values);
    }
  }

  return candidates.map((candidate) => {
    if (candidate.candidate.category !== "SINGLE") return candidate;
    const matches = uniqueStrings([
      candidate.candidate.title,
      candidate.candidate.titleOriginal,
    ]).flatMap((title) => byTitle.get(normalizedText(title)) ?? []);
    const unique = [...new Map(matches.map((match) => [
      `${match.manifest.recordId}:${normalizedText(match.sourceTrackTitle)}`,
      match,
    ])).values()];
    if (unique.length === 0) return candidate;
    const { manifest, sourceTrackTitle } = unique[0]!;
    stats.ndlManifestMatched += 1;
    return addComprehensiveObservation(candidate, observation({
      id: `ndl-single-manifest:${manifest.recordId}:${candidate.candidate.id}`,
      provider: "ndl-search",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "NDL_COMPLETE_SINGLE_MANIFEST_MATCH",
      reason: "The NDL national-bibliography complete-singles track manifest lists this exact title, and the candidate was independently discovered as a release-level single work.",
      sourceUrl: manifest.sourceUrl,
      matchedFields: ["artist", "title", "category"],
      facts: {
        title: candidate.candidate.title,
        category: "SINGLE",
        manifestTitle: manifest.manifestTitle,
        publisher: manifest.publisher,
        sourceTrackTitle,
        matchKind: "EXACT_NORMALIZED_TITLE",
      },
    }));
  });
}

function soundFujiExpectedKind(candidate: ComprehensiveDiscographyCandidate) {
  if (candidate.candidate.category === "SINGLE") return "SINGLE" as const;
  if (candidate.candidate.category === "ORIGINAL_ALBUM") return "ALBUM" as const;
  return null;
}

function soundFujiWorkRepresentatives(
  candidates: readonly ComprehensiveDiscographyCandidate[],
) {
  const representatives = new Map<string, ComprehensiveDiscographyCandidate>();
  for (const candidate of breadthFirstByWork(candidates)) {
    if (!soundFujiExpectedKind(candidate) || representatives.has(candidate.workId)) continue;
    representatives.set(candidate.workId, candidate);
  }
  return [...representatives.values()].slice(0, 200).map((candidate) => ({
    id: candidate.workId,
    title: candidate.candidate.title,
    expectedKind: soundFujiExpectedKind(candidate),
  }));
}

function musicBrainzWorkSourceUrls(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.candidate.sources.map((source) => source.url).filter((url) =>
    /^https:\/\/musicbrainz\.org\/release-group\/[0-9a-f-]+$/i.test(url));
}

function soundFujiStableWorkId(sourceUrl: string) {
  const releaseId = sourceUrl.match(/^https:\/\/soundfuji\.kingrecords\.co\.jp\/release\/(\d+)\/$/i)?.[1];
  return releaseId ? `soundfuji-work:${releaseId}` : null;
}

function applySoundFujiEvidence(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  research: SoundFujiArchiveResearchResult | null,
  attempted: boolean,
  stats: ComprehensiveSourceStats,
) {
  if (!attempted) {
    return {
      candidates: [...candidates],
      coversByWorkId: new Map<string, SoundFujiWorkCoverEvidence>(),
    };
  }
  if (!research) {
    return {
      candidates: candidates.map((candidate) => soundFujiExpectedKind(candidate)
        ? addComprehensiveObservation(candidate, sourceFailureObservation(
            candidate.candidate.id,
            "king-records-sound-fuji",
            "AUTHORITATIVE",
            "AUTHORITATIVE",
            "SOUND_FUJI_SOURCE_INCOMPLETE",
            "The bounded King Records archive request failed.",
            true,
          ))
        : candidate),
      coversByWorkId: new Map<string, SoundFujiWorkCoverEvidence>(),
    };
  }
  if (!research.applicable) {
    return {
      candidates: [...candidates],
      coversByWorkId: new Map<string, SoundFujiWorkCoverEvidence>(),
    };
  }

  stats.soundFujiMatched = research.stats.candidatesMatched;
  stats.soundFujiCovers = research.candidates.filter((item) => Boolean(item.evidence?.cover)).length;
  const outcomes = new Map(research.candidates.map((item) => [item.candidateId, item]));
  const firstWarning = research.warnings[0];
  const enriched = candidates.map((candidate) => {
    if (!soundFujiExpectedKind(candidate)) return candidate;
    const outcome = outcomes.get(candidate.workId);
    if (outcome?.outcome === "PASS" && outcome.evidence) {
      return addComprehensiveObservation(candidate, observation({
        id: `sound-fuji:${outcome.evidence.sourceUrl}:${candidate.candidate.id}`,
        provider: "king-records-sound-fuji",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        verdict: "PASS",
        reasonCode: "OFFICIAL_LABEL_WORK_MATCH",
        reason: "The official King Records archive matches the complete artist name, complete work title, and compatible release kind.",
        sourceUrl: outcome.evidence.sourceUrl,
        matchedFields: outcome.evidence.observedKind
          ? ["artist", "title", "category"]
          : ["artist", "title"],
        facts: {
          title: outcome.evidence.observedTitle,
          artist: outcome.evidence.observedArtist,
          category: outcome.evidence.observedKind,
          manifestEntryKey: candidateManifestEntryKey(candidate),
          officialPages: outcome.evidence.sourceUrls.join(","),
        },
      }));
    }
    const reasonCode = outcome?.reasonCode ?? "SOUND_FUJI_SOURCE_INCOMPLETE";
    const retryable = outcome?.outcome === "SOURCE_INCOMPLETE"
      ? Boolean(firstWarning?.retryable)
      : research.status === "SOURCE_INCOMPLETE" && Boolean(firstWarning?.retryable);
    return addComprehensiveObservation(candidate, sourceFailureObservation(
      candidate.candidate.id,
      "king-records-sound-fuji",
      "AUTHORITATIVE",
      "AUTHORITATIVE",
      reasonCode,
      outcome?.outcome === "AMBIGUOUS"
        ? "The official archive contains more than one incompatible exact work match."
        : outcome?.outcome === "NOT_FOUND"
          ? "The official King Records archive contains no exact artist, title, and work-kind match."
          : firstWarning?.message ?? "The official King Records archive could not be evaluated completely.",
      retryable,
    ));
  });

  // An exact official page is a safe work identity bridge across MusicBrainz
  // and later Discogs CD editions. This is deliberately stronger than a title
  // merge: artist, full normalized title, and work kind were all checked by
  // the fixed official-label adapter first.
  const passed = research.candidates.filter((item) => item.outcome === "PASS" && item.evidence);
  const oldWorkIdsBySource = new Map<string, Set<string>>();
  for (const item of passed) {
    const values = oldWorkIdsBySource.get(item.evidence!.sourceUrl) ?? new Set<string>();
    values.add(item.candidateId);
    oldWorkIdsBySource.set(item.evidence!.sourceUrl, values);
  }
  const bindings = new Map<string, {
    workId: string;
    title: string;
    originalReleaseDate: string | null;
    category: ComprehensiveDiscographyCandidate["candidate"]["category"] | null;
    musicBrainzWorkSourceUrl: string | null;
    canonicalManifest: {
      title: string;
      originalReleaseDate: string | null;
      category: ComprehensiveDiscographyCandidate["candidate"]["category"];
      observations: ComprehensiveEvidenceObservation[];
      sources: ReleaseResearchCandidate["sources"];
    } | null;
  }>();
  for (const item of passed) {
    const evidence = item.evidence!;
    const oldWorkIds = oldWorkIdsBySource.get(evidence.sourceUrl)!;
    if ([...oldWorkIds].some((oldWorkId) => bindings.has(oldWorkId))) continue;
    const group = enriched.filter((candidate) => oldWorkIds.has(candidate.workId));
    const musicBrainzCandidates = group.filter((candidate) =>
      candidate.observations.some((entry) =>
        normalizedText(entry.provider) === "musicbrainz" &&
        entry.stage === "MUSICBRAINZ" && entry.verdict === "PASS"));
    const manifestEntryKeys = new Set(group
      .map(candidateManifestEntryKey)
      .filter((value): value is string => Boolean(value)));
    // One official entity page cannot collapse two different canonical
    // manifest entries into one work. Keep both identities separate and let
    // their own evidence proceed independently.
    if (manifestEntryKeys.size > 1) continue;
    const musicBrainzWorkIds = new Set(musicBrainzCandidates.map((candidate) => candidate.workId));
    const sourceWorkId = soundFujiStableWorkId(evidence.sourceUrl);
    if (!sourceWorkId) continue;
    const workId = musicBrainzWorkIds.size === 1
      ? [...musicBrainzWorkIds][0]!
      : sourceWorkId;
    const originalDates = uniqueStrings(musicBrainzCandidates.map((candidate) =>
      candidate.candidate.originalReleaseDate));
    const categories = [...new Set(musicBrainzCandidates.map((candidate) =>
      candidate.candidate.category))];
    const musicBrainzSources = uniqueStrings(musicBrainzCandidates.flatMap(musicBrainzWorkSourceUrls));
    let canonicalManifest: {
      title: string;
      originalReleaseDate: string | null;
      category: ComprehensiveDiscographyCandidate["candidate"]["category"];
      observations: ComprehensiveEvidenceObservation[];
      sources: ReleaseResearchCandidate["sources"];
    } | null = null;
    if (manifestEntryKeys.size === 1) {
      const manifestEntryKey = [...manifestEntryKeys][0]!;
      const manifestCandidates = group.filter((candidate) =>
        candidateManifestEntryKey(candidate) === manifestEntryKey);
      const representative = [...manifestCandidates].sort((left, right) =>
        Number(right.editionId.startsWith("curated-official-manifest:")) -
          Number(left.editionId.startsWith("curated-official-manifest:")) ||
        left.candidate.id.localeCompare(right.candidate.id))[0];
      const observations = [...new Map(manifestCandidates.flatMap((candidate) =>
        candidate.observations.filter((entry) =>
          entry.verdict === "PASS" &&
          normalizedText(entry.provider).startsWith(
            normalizedText("curated-official-manifest:"),
          ) &&
          entry.facts?.manifestEntryKey === manifestEntryKey &&
          (entry.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" ||
            (entry.stage === "SCOPE" && [
              "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED",
              "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
              "OFFICIAL_CD_MANIFEST_WORK_SCOPE",
            ].includes(entry.reasonCode)))))
        .map((entry) => [
          `${normalizedText(entry.provider)}\u0000${entry.reasonCode}\u0000${manifestEntryKey}`,
          entry,
        ])).values()];
      if (representative && observations.some((entry) =>
        entry.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
        entry.role === "AUTHORITATIVE" && entry.verdict === "PASS")) {
        const officialSourceUrls = new Set(observations
          .map((entry) => entry.sourceUrl)
          .filter((value): value is string => Boolean(value)));
        canonicalManifest = {
          title: representative.candidate.title,
          originalReleaseDate: representative.candidate.originalReleaseDate,
          category: representative.candidate.category,
          observations,
          // Only copy sources that directly back the canonical manifest
          // observations. Release-level MusicBrainz/Discogs URLs belong to
          // their original editions and must never be transplanted to a peer.
          sources: [...new Map(manifestCandidates.flatMap((candidate) =>
            candidate.candidate.sources.filter((source) =>
              officialSourceUrls.has(source.url)))
            .map((source) => [source.url, source])).values()],
        };
      }
    }
    const binding = {
      workId,
      title: evidence.observedTitle,
      originalReleaseDate: originalDates.length === 1 ? originalDates[0]! : null,
      category: categories.length === 1 ? categories[0]! : null,
      musicBrainzWorkSourceUrl: musicBrainzSources.length === 1 ? musicBrainzSources[0]! : null,
      canonicalManifest,
    };
    oldWorkIds.forEach((oldWorkId) => bindings.set(oldWorkId, binding));
  }

  const rebound = enriched.map((candidate) => {
    const binding = bindings.get(candidate.workId);
    if (!binding) return candidate;
    const sources = [...new Map([
      ...candidate.candidate.sources,
      ...(binding.canonicalManifest?.sources ?? []),
      ...(binding.musicBrainzWorkSourceUrl &&
          !candidate.candidate.sources.some((source) => source.url === binding.musicBrainzWorkSourceUrl)
        ? [{
          title: "MusicBrainz release group",
          url: binding.musicBrainzWorkSourceUrl,
          sourceType: "database" as const,
        }]
        : []),
    ].map((source) => [source.url, source])).values()];
    let next: ComprehensiveDiscographyCandidate = {
      ...candidate,
      workId: binding.workId,
      candidate: {
        ...candidate.candidate,
        title: binding.canonicalManifest?.title ?? binding.title,
        originalReleaseDate: binding.canonicalManifest?.originalReleaseDate ??
          candidate.candidate.originalReleaseDate ?? binding.originalReleaseDate,
        category: binding.canonicalManifest?.category ??
          (candidate.candidate.category === "OTHER" && binding.category
            ? binding.category
            : candidate.candidate.category),
        sources,
      },
    };
    for (const entry of binding.canonicalManifest?.observations ?? []) {
      const alreadyPresent = next.observations.some((existing) =>
        normalizedText(existing.provider) === normalizedText(entry.provider) &&
        existing.reasonCode === entry.reasonCode &&
        existing.facts?.manifestEntryKey === entry.facts?.manifestEntryKey);
      if (alreadyPresent) continue;
      next = addComprehensiveObservation(next, {
        ...entry,
        id: `${entry.id}:sound-fuji-bridge:${candidate.candidate.id}`,
      });
    }
    return next;
  });
  const coversByWorkId = new Map<string, SoundFujiWorkCoverEvidence>();
  const conflictingCovers = new Set<string>();
  for (const item of passed) {
    const cover = item.evidence!.cover;
    if (!cover) continue;
    const workId = bindings.get(item.candidateId)?.workId ?? item.candidateId;
    const prior = coversByWorkId.get(workId);
    if (prior && (prior.url !== cover.url || prior.sourceUrl !== cover.sourceUrl)) {
      conflictingCovers.add(workId);
      coversByWorkId.delete(workId);
    } else if (!conflictingCovers.has(workId)) {
      coversByWorkId.set(workId, cover);
    }
  }
  return { candidates: rebound, coversByWorkId };
}

async function enrichWithNdl(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  inventoryResult: NdlClientResult,
  ndl: Pick<NdlSearchClient, "searchCatalogNumber">,
  artist: { primary: string; aliases: string[] },
  maxCatalogLookups: number,
  stats: ComprehensiveSourceStats,
  onProgress?: PrepareComprehensiveSourceEvidenceInput["onProgress"],
) {
  const cache = new Map<string, Promise<NdlClientResult>>();
  const output: ComprehensiveDiscographyCandidate[] = [];
  for (const candidate of candidates) {
    const ndlInput = ndlCandidate(candidate, artist);
    if (!ndlInput) {
      output.push(addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "ndl-search",
        "AUTHORITATIVE",
        "AUTHORITATIVE",
        "NDL_CANDIDATE_INCOMPLETE",
        "A catalog number and release date are required for a catalog-bound NDL lookup.",
        false,
      )));
      await onProgress?.({ stage: "NDL_MATCH", processed: output.length, total: candidates.length });
      continue;
    }

    let searched: NdlClientResult | null = inventoryResult;
    let decision = inventoryResult.value
      ? matchNdlCandidateForComprehensiveAudit(ndlInput, inventoryResult.value)
      : { evidence: null, reason: "incomplete-results" as const };
    if (!decision.evidence && ["catalog-not-found", "incomplete-results"].includes(decision.reason)) {
      const key = normalizedCatalog(ndlInput.catalogNumber);
      let lookup = cache.get(key);
      if (!lookup && cache.size < maxCatalogLookups) {
        stats.ndlCatalogCalls += 1;
        lookup = Promise.resolve()
          .then(() => ndl.searchCatalogNumber(ndlInput.catalogNumber, 20))
          .catch((error): NdlClientResult => ({
            value: null,
            warnings: [{
              code: "network-unavailable",
              message: error instanceof Error ? error.message : "NDL catalog lookup failed.",
              retryable: true,
              status: null,
            }],
          }));
        cache.set(key, lookup);
      }
      if (lookup) {
        searched = await lookup;
        if (searched.value) decision = matchNdlCandidateForComprehensiveAudit(ndlInput, searched.value);
      } else if (cache.size >= maxCatalogLookups) {
        output.push(addComprehensiveObservation(candidate, sourceFailureObservation(
          candidate.candidate.id,
          "ndl-search",
          "AUTHORITATIVE",
          "AUTHORITATIVE",
          "NDL_LOOKUP_LIMIT",
          "The bounded per-catalog NDL lookup budget was exhausted.",
          true,
        )));
        await onProgress?.({ stage: "NDL_MATCH", processed: output.length, total: candidates.length });
        continue;
      }
    }

    if (decision.evidence) {
      stats.ndlMatched += 1;
      output.push(addNdlEvidence(candidate, decision));
      await onProgress?.({ stage: "NDL_MATCH", processed: output.length, total: candidates.length });
      continue;
    }
    const warning = searched?.warnings[0];
    output.push(addComprehensiveObservation(candidate, sourceFailureObservation(
      candidate.candidate.id,
      "ndl-search",
      "AUTHORITATIVE",
      "AUTHORITATIVE",
      warning ? "NDL_UNAVAILABLE" : ndlUnknownReason(decision.reason),
      warning?.message ?? `NDL did not produce strong evidence: ${decision.reason}.`,
      retryableNdlResult(searched),
    )));
    await onProgress?.({ stage: "NDL_MATCH", processed: output.length, total: candidates.length });
  }
  return output;
}

function enrichWithOfficial(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  official: Awaited<ReturnType<typeof safeOfficialResearch>> | {
    value: null;
    error: string;
    reasonCode: string;
    retryable: boolean;
  },
  inspectedIds: ReadonlySet<string>,
  stats: ComprehensiveSourceStats,
) {
  if ("value" in official && official.value === null) {
    return candidates.map((candidate) => addComprehensiveObservation(candidate, sourceFailureObservation(
      candidate.candidate.id,
      "official-catalog",
      "AUTHORITATIVE",
      "AUTHORITATIVE",
      official.reasonCode,
      official.error,
      official.retryable,
    )));
  }
  if (!("candidates" in official)) return [...candidates];
  const byId = new Map(official.candidates.map((item) => [item.candidateId, item]));
  return candidates.map((candidate) => {
    if (!inspectedIds.has(candidate.candidate.id)) {
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "official-catalog",
        "AUTHORITATIVE",
        "AUTHORITATIVE",
        "OFFICIAL_CANDIDATE_LIMIT",
        "The bounded official-catalog candidate budget was exhausted.",
        true,
      ));
    }
    const matched = byId.get(candidate.candidate.id)?.evidence;
    if (matched) {
      stats.officialMatched += 1;
      return addComprehensiveObservation(candidate, observation({
        id: `official:${candidate.candidate.id}`,
        provider: "official-catalog",
        role: "AUTHORITATIVE",
        strength: "STRONG",
        stage: "AUTHORITATIVE",
        verdict: "PASS",
        reasonCode: "OFFICIAL_CATALOG_EDITION_MATCH",
        reason: "An official artist or label catalog matches title, catalog number, and date.",
        sourceUrl: matched.url,
        matchedFields: matched.matchedFields,
        facts: {
          title: candidate.candidate.title,
          catalogNumber: candidate.candidate.catalogNumber,
          date: matched.observedDate,
        },
      }));
    }
    const warnings = official.warnings.filter((warning) =>
      !warning.candidateId || warning.candidateId === candidate.candidate.id);
    const ambiguous = warnings.find((warning) => warning.code === "ambiguous-official-match");
    return addComprehensiveObservation(candidate, sourceFailureObservation(
      candidate.candidate.id,
      "official-catalog",
      "AUTHORITATIVE",
      "AUTHORITATIVE",
      ambiguous ? "OFFICIAL_CATALOG_AMBIGUOUS" : "OFFICIAL_CATALOG_NOT_FOUND",
      ambiguous?.message ?? warnings[0]?.message ?? "No unique official catalog page matched this edition.",
      warnings.some((warning) => warning.retryable),
    ));
  });
}

function enrichWithDiscogs(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  search: DiscogsSearchState,
  request: ReleaseResearchRequest,
  maxRowsPerCandidate: number,
  stats: ComprehensiveSourceStats,
) {
  const matches = new Map<string, DiscogsSearchReleaseEvidence[]>();
  const enriched = candidates.map((candidate) => {
    const curatedIdentity = curatedSyntheticIdentity(candidate);
    const matched = (curatedIdentity?.representationKind === "WORK_ONLY"
        ? []
        : curatedIdentity
        ? matchingCuratedCarrierRows(candidate, curatedIdentity, search.rows)
        : matchingDiscogsRows(candidate, candidates, search.rows))
      .slice(0, maxRowsPerCandidate);
    matches.set(
      candidate.candidate.id,
      curatedIdentity?.representationKind === "CONTAINER_INCLUSION" ? [] : matched,
    );
    if (matched.length === 0) {
      if (
        curatedIdentity?.representationKind === "WORK_ONLY" &&
        curatedIdentity.workIdentityLocked
      ) {
        // This candidate deliberately represents a canonical work, not a
        // claimed physical edition. Manifest + exact official work page +
        // unique original-work inventory already lock its identity, so a
        // catalog/date lookup is inapplicable rather than failed.
        return candidate;
      }
      return addComprehensiveObservation(candidate, sourceFailureObservation(
        candidate.candidate.id,
        "discogs",
        "CORROBORATING",
        "CORROBORATION",
        search.incomplete
          ? "DISCOGS_SEARCH_INCOMPLETE"
          : curatedIdentity?.representationKind !== "WORK_ONLY"
            ? "DISCOGS_CURATED_CARRIER_NOT_FOUND"
            : "DISCOGS_EXACT_EDITION_NOT_FOUND",
        search.message ?? (curatedIdentity?.representationKind !== "WORK_ONLY"
          ? "Discogs returned no unique artist, declared carrier title, catalog-number, and year tuple."
          : "Discogs returned no exact title, catalog-number, and year match."),
        search.retryable,
      ));
    }
    stats.discogsMatched += 1;
    const first = matched[0]!;
    const observedDiscogsArtist = discogsArtistCredit(first.title);
    const titleMatched = new Set([
      candidate.candidate.title,
      candidate.candidate.titleOriginal,
    ].map(normalizedText).filter(Boolean)).has(normalizedText(discogsTitle(first.title)));
    const curatedCarrierMatched = Boolean(
      curatedIdentity && curatedIdentity.representationKind !== "WORK_ONLY",
    );
    const scopeResults = matched.map((row) => {
      const hasEarlierMasterEdition = row.masterId !== null && row.year !== null &&
        search.rows.some((peer) =>
          peer.masterId === row.masterId && peer.year !== null && peer.year < row.year!);
      const candidateYear = yearOf(candidate.candidate.releaseDate) ??
        yearOf(candidate.candidate.originalReleaseDate);
      const hasEarlierKnownEdition = candidateYear !== null && candidates.some((peer) =>
        peer.workId === candidate.workId && peer.candidate.id !== candidate.candidate.id &&
        (yearOf(peer.candidate.releaseDate) ?? yearOf(peer.candidate.originalReleaseDate) ?? 9999) < candidateYear);
      return classifyDiscogsFormatScope(
        row.formats,
        request,
        candidate.candidate.category,
        {
          isEarliestJapanCdEdition: !hasEarlierMasterEdition && !hasEarlierKnownEdition,
          sourceComplete: !search.incomplete,
        },
      );
    });
    const scope = scopeResults.every((item) => item.verdict === "OUT_OF_SCOPE")
      ? scopeResults[0]!
      : scopeResults.some((item) => item.verdict === "PASS") &&
          scopeResults.some((item) => item.verdict === "OUT_OF_SCOPE")
        ? {
            ...scopeResults.find((item) => item.verdict === "PASS")!,
            verdict: "UNKNOWN" as const,
            reasonCode: "DISCOGS_SCOPE_ROWS_CONFLICT",
            reason: "Matching Discogs rows disagree about whether this edition is an in-scope original issue.",
          }
        : scopeResults.find((item) => item.verdict === "PASS") ?? scopeResults[0]!;
    const ignoreFixedSeikoPromo = hasSeikoSpecialLoverFixedBridge(candidate) &&
      scopeResults.length > 0 && scopeResults.every((item) =>
        item.verdict === "OUT_OF_SCOPE" &&
        item.reasonCode === "DISCOGS_PROMOTIONAL_EDITION_OUT_OF_SCOPE");
    const auditedScope = curatedCarrierMatched
      ? {
          verdict: "PASS" as const,
          reasonCode: "CURATED_DECLARED_CARRIER_IN_SCOPE",
          reason: "The exact official manifest carrier tuple is in scope for this one canonical work; a generic later-master classification remains applicable only to the separate container release candidate.",
        }
      : ignoreFixedSeikoPromo
      ? {
          verdict: "UNKNOWN" as const,
          reasonCode: "SEIKO_FIXED_CANONICAL_DISCOGS_PROMO_IGNORED",
          reason: "A promotional Discogs row is retained for audit only; the exact official manifest, fixed official detail page, and regular MusicBrainz CD tuple independently bind the canonical commercial work.",
        }
      : scope;
    const corroboration = observation({
      id: `discogs:${candidate.candidate.id}`,
      provider: "discogs",
      role: "CORROBORATING",
      strength: "SUPPORTING",
      stage: "CORROBORATION",
      verdict: ignoreFixedSeikoPromo ? "UNKNOWN" : "PASS",
      reasonCode: ignoreFixedSeikoPromo
        ? "SEIKO_FIXED_CANONICAL_DISCOGS_PROMO_IGNORED"
        : curatedCarrierMatched
          ? "CURATED_CANONICAL_WORK_CARRIER_MATCH"
        : titleMatched
        ? matched.length > 1
          ? "DISCOGS_MULTIPLE_EXACT_EDITIONS"
          : "DISCOGS_EXACT_EDITION_MATCH"
        : "DISCOGS_IDENTIFIER_BOUND_TITLE_REVIEW",
      reason: ignoreFixedSeikoPromo
        ? "The promotional Discogs row is not accepted as corroboration and cannot represent the canonical commercial release."
        : curatedCarrierMatched
          ? curatedIdentity!.representationKind === "CONTAINER_INCLUSION"
            ? "One exact artist, declared container title, catalog-number, and year tuple confirms the official CD carrier that contains this canonical work; the container title is not treated as the work title."
            : "One exact artist, work title, catalog-number, and year tuple confirms the specifically declared official CD edition."
        : titleMatched
        ? matched.length > 1
          ? "Multiple Discogs releases share the exact title, catalog number, and year; they corroborate the edition without forcing one master or release id."
          : "Discogs corroborates the exact title, catalog number, and year."
        : "A unique candidate work shares the Discogs catalog number and year; the bilingual title still requires semantic review.",
      sourceUrl: first.sourceUrl,
      matchedFields: curatedCarrierMatched
        ? [
            "artist",
            ...(titleMatched ? ["title"] : []),
            "catalogNumber",
            "year",
            "country",
            "format",
          ]
        : titleMatched
        ? [
            ...(observedDiscogsArtist ? ["artist"] : []),
            "title",
            "catalogNumber",
            "year",
            "country",
            "format",
          ]
        : ["catalogNumber", "year", "country", "format"],
      facts: {
        artist: observedDiscogsArtist,
        title: discogsTitle(first.title),
        catalogNumber: first.catalogNumber,
        year: first.year === null ? null : String(first.year),
        releaseIds: matched.map((row) => row.releaseId).join(","),
        manifestEntryKey: curatedCarrierMatched
          ? curatedIdentity!.manifestEntryKey
          : null,
        canonicalTitle: curatedCarrierMatched
          ? curatedIdentity!.canonicalTitle
          : null,
        carrierTitle: curatedCarrierMatched ? discogsTitle(first.title) : null,
        physicalCdRepresentationKind: curatedCarrierMatched
          ? curatedIdentity!.representationKind
          : null,
        uniqueBinding: curatedCarrierMatched ? "true" : null,
      },
      retryable: search.incomplete && search.retryable,
    });
    let next = addComprehensiveObservation(candidate, corroboration);
    next = addComprehensiveObservation(next, observation({
      id: `discogs:scope:${candidate.candidate.id}`,
      provider: "discogs",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: auditedScope.verdict,
      reasonCode: auditedScope.reasonCode,
      reason: auditedScope.reason,
      sourceUrl: first.sourceUrl,
      matchedFields: ["country", "format"],
      facts: {
        formats: first.formats.join(", "),
        originalReasonCode: curatedCarrierMatched || ignoreFixedSeikoPromo
          ? scope.reasonCode
          : null,
        manifestEntryKey: curatedCarrierMatched
          ? curatedIdentity!.manifestEntryKey
          : ignoreFixedSeikoPromo
            ? SEIKO_SPECIAL_LOVER_FIXED_BRIDGE.manifestEntryKey
            : null,
      },
    }));
    if (!titleMatched && !ignoreFixedSeikoPromo && !curatedCarrierMatched) {
      const comparisonId = musicBrainzObservationId(candidate) ?? candidate.observations.find((item) =>
        item.role === "AUTHORITATIVE" && item.verdict === "PASS")?.id;
      if (comparisonId) {
        next = addComprehensiveConflict(next, {
          id: `discogs-title-review:${candidate.candidate.id}`,
          certainty: "AI_REVIEW",
          reasonCode: "TITLE_CONFLICT",
          field: "title",
          sourceObservationIds: [comparisonId, corroboration.id],
          message: "Catalog number and year bind this Discogs row to one candidate work; compare the supplied bilingual titles and reject only if they clearly name different works.",
        });
      }
    }
    return next;
  });
  return { candidates: enriched, matches };
}

export async function validateProviderCover(
  imageUrl: string,
  sourceUrl: string,
  provider: VerifiedCoverProvider,
  validate: typeof validateCoverAsset,
  now: () => Date,
  match: {
    coverMatchLevel: "EDITION" | "WORK";
    sourceReleaseDate: string | null;
    expectedAsset?: {
      mime: "image/gif" | "image/jpeg" | "image/png";
      width: number;
      height: number;
      sha256: string;
      allowContentTypeMismatch?: boolean;
    };
  },
  validationOptions?: Parameters<typeof validateCoverAsset>[1],
) {
  // A release-group image or a different physical release can identify only
  // the work. CAA and Discogs are accepted as edition artwork solely when
  // they bind the currently selected release entity; work-level artwork must
  // come from the official label/archive or Apple Music.
  if (
    match.coverMatchLevel === "WORK" &&
    provider !== "official-label" &&
    provider !== "apple-music"
  ) return { found: null, retryable: false, invalid: true } as const;
  if (
    !isAllowedVerifiedCoverAssetUrl(imageUrl, provider) ||
    !isAllowedVerifiedCoverSourceUrl(sourceUrl, provider)
  ) return { found: null, retryable: false, invalid: true } as const;
  try {
    const checked = await validate(
      imageUrl,
      match.expectedAsset?.allowContentTypeMismatch
        ? { ...validationOptions, allowImageTypeMismatch: true }
        : validationOptions,
    );
    if (
      checked.ok &&
      checked.finalHost &&
      isAllowedVerifiedCoverAssetHost(checked.finalHost, provider) &&
      /^[a-f0-9]{64}$/iu.test(checked.contentSha256 ?? "")
    ) {
      const expectedFormat = match.expectedAsset?.mime === "image/jpeg"
        ? "jpeg"
        : match.expectedAsset?.mime?.slice("image/".length) ?? null;
      if (match.expectedAsset && (
        (match.expectedAsset.allowContentTypeMismatch
          ? checked.imageFormat !== expectedFormat
          : checked.contentType !== match.expectedAsset.mime) ||
        checked.width !== match.expectedAsset.width ||
        checked.height !== match.expectedAsset.height ||
        checked.contentSha256 !== match.expectedAsset.sha256
      )) {
        return { found: null, retryable: false, invalid: true } as const;
      }
      return {
        found: {
          status: "FOUND" as const,
          imageUrl,
          sourceUrl,
          provider,
          checkedAt: now().toISOString(),
          contentSha256: checked.contentSha256!,
          coverMatchLevel: match.coverMatchLevel,
          sourceReleaseDate: match.sourceReleaseDate,
        },
        retryable: false,
        invalid: false,
      };
    }
    return { found: null, retryable: checked.retryable, invalid: !checked.retryable } as const;
  } catch {
    return { found: null, retryable: true, invalid: false } as const;
  }
}

export type PersistedCoverRetryLookupInput = {
  /** Complete schema-v2 source candidates restored from the research ledger. */
  candidates: readonly ComprehensiveDiscographyCandidate[];
  /** Candidate results carrying provider bindings sealed into the same payload. */
  results?: readonly ComprehensiveCandidateResult[];
  /** The immutable public MusicBrainz evidence saved with the original task. */
  bundle: ArtistReleaseEvidenceBundle;
};

export type PersistedCoverRetryLookupDependencies = {
  discogs?: Pick<DiscogsClient, "getRelease">;
  musicMetadata?: Pick<MusicMetadataClient, "getCoverArt">;
  lookupItunesAlbum?: (
    collectionId: number,
    country: string | null | undefined,
  ) => Promise<ItunesAlbumResult | null>;
  validateCover?: typeof validateCoverAsset;
  now?: () => Date;
};

type PersistedDiscogsCoverBinding = {
  releaseIds: number[];
  title: string;
  artist: string | null;
  catalogNumber: string;
  year: number;
};

type PersistedBoundCover = {
  imageUrl: string;
  sourceUrl: string;
  provider: "apple-music" | "official-label";
  coverMatchLevel: "EDITION" | "WORK";
  sourceReleaseDate: string;
};

const persistedDiscogsCoverReasonCodes = new Set([
  "DISCOGS_EXACT_EDITION_MATCH",
  "DISCOGS_MULTIPLE_EXACT_EDITIONS",
  "DISCOGS_IDENTIFIER_BOUND_TITLE_REVIEW",
  "CURATED_CANONICAL_WORK_CARRIER_MATCH",
]);

const persistedOfficialCoverReasonCodes = new Set([
  "MOMOE_OFFICIAL_CURATED_WORK_MATCH",
  "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
  "SEIKO_OFFICIAL_RECOVERY_WORK_VERIFIED",
  "AKINA_OFFICIAL_RECOVERY_WORK_VERIFIED",
  "OFFICIAL_LABEL_WORK_MATCH",
]);

function cdFormatPresent(values: readonly (string | null | undefined)[]) {
  return values.some((value) => {
    const normalized = value?.normalize("NFKC").toUpperCase() ?? "";
    return /(^|[^A-Z0-9])CD([^A-Z0-9]|$)/u.test(normalized) ||
      /^(?:CD|CDMAXI|SHMCD|BLUSPECCD|UHQCD)$/u.test(normalizedCatalog(normalized));
  });
}

function exactPersistedMusicBrainzRelease(
  candidate: ComprehensiveDiscographyCandidate,
  bundle: ArtistReleaseEvidenceBundle,
) {
  const releaseId = musicBrainzReleaseId(candidate);
  if (!releaseId) return null;
  const sourceUrl = `https://musicbrainz.org/release/${releaseId}`;
  const rows = [
    ...bundle.releases.map((item) => item.evidence),
    ...(bundle.discoveredEditions ?? []).map((item) => item.evidence),
    ...(bundle.works ?? []).flatMap((work) => work.editions.map((item) => item.evidence)),
  ].filter((release) =>
    release.entityType === "release" &&
    release.sourceId.toLocaleLowerCase("en") === releaseId.toLocaleLowerCase("en") &&
    release.sourceUrl === sourceUrl);
  if (rows.length === 0) return null;

  const identityKeys = new Set(rows.map((release) => JSON.stringify({
    title: release.title,
    artistCredit: release.artistCredit,
    date: release.date,
    country: release.country,
    catalogNumber: release.catalogNumber,
    labels: release.labels,
    formats: release.formats,
    status: release.status,
  })));
  if (identityKeys.size !== 1) return null;
  const release = rows[0]!;
  const candidateDate = candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate;
  const releaseCatalogs = uniqueStrings([
    release.catalogNumber,
    ...release.labels.map((label) => label.catalogNumber),
  ]).map(normalizedCatalog).filter(Boolean);
  const candidateCatalog = normalizedCatalog(candidate.candidate.catalogNumber);
  if (
    !candidateDate ||
    !release.date ||
    !curatedDatesCompatible(candidateDate, release.date) ||
    (candidate.candidate.format !== null &&
      candidate.candidate.format !== undefined &&
      !cdFormatPresent([candidate.candidate.format])) ||
    !cdFormatPresent([release.format, ...release.formats]) ||
    (candidateCatalog && releaseCatalogs.length > 0 && !releaseCatalogs.includes(candidateCatalog))
  ) return null;

  const covers = uniqueStrings(rows.flatMap((item) =>
    item.coverUrl && item.coverSourceUrl === `https://coverartarchive.org/release/${releaseId}`
      ? [item.coverUrl]
      : []));
  return { releaseId, release, covers };
}

function exactPersistedDiscogsBinding(
  candidate: ComprehensiveDiscographyCandidate,
): PersistedDiscogsCoverBinding | null {
  const observations = candidate.observations.filter((item) =>
    normalizedText(item.provider) === "discogs" &&
    item.stage === "CORROBORATION" &&
    item.verdict === "PASS" &&
    persistedDiscogsCoverReasonCodes.has(item.reasonCode));
  if (observations.length !== 1) return null;
  const observed = observations[0]!;
  const rawReleaseIds = observed.facts?.releaseIds;
  const catalogNumber = observed.facts?.catalogNumber?.trim() ?? "";
  const title = observed.facts?.title?.trim() ?? "";
  const artist = observed.facts?.artist?.trim() || null;
  const year = Number(observed.facts?.year);
  if (
    !rawReleaseIds ||
    !/^\d+(?:,\d+){0,9}$/u.test(rawReleaseIds) ||
    !catalogNumber ||
    !title ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2200
  ) return null;
  const releaseIds = [...new Set(rawReleaseIds.split(",").map(Number))];
  const sourceReleaseId = observed.sourceUrl?.match(
    /^https:\/\/www\.discogs\.com\/release\/(\d+)$/iu,
  )?.[1];
  const candidateYear = yearOf(candidate.candidate.releaseDate) ??
    yearOf(candidate.candidate.originalReleaseDate);
  if (
    !sourceReleaseId ||
    !releaseIds.includes(Number(sourceReleaseId)) ||
    candidateYear !== year ||
    normalizedCatalog(candidate.candidate.catalogNumber) !== normalizedCatalog(catalogNumber) ||
    (candidate.candidate.format !== null &&
      candidate.candidate.format !== undefined &&
      !cdFormatPresent([candidate.candidate.format]))
  ) return null;
  return { releaseIds, title, artist, catalogNumber, year };
}

function persistedDiscogsDetailMatches(
  candidate: ComprehensiveDiscographyCandidate,
  binding: PersistedDiscogsCoverBinding,
  detail: DiscogsReleaseEvidence,
) {
  const expectedSource = `https://www.discogs.com/release/${detail.releaseId}`;
  const catalog = normalizedCatalog(binding.catalogNumber);
  const detailCatalogs = detail.labels
    .map((label) => normalizedCatalog(label.catalogNumber))
    .filter(Boolean);
  const detailArtists = [detail.artistCredit, ...detail.artists.flatMap((artist) => [artist.name, artist.anv])]
    .map(normalizedText)
    .filter(Boolean);
  const candidateDate = candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate;
  const detailDate = detail.released ?? (detail.year === null ? null : String(detail.year));
  return detail.sourceUrl === expectedSource &&
    detail.country === "Japan" &&
    detail.year === binding.year &&
    Boolean(candidateDate && detailDate && curatedDatesCompatible(candidateDate, detailDate)) &&
    normalizedText(detail.title) === normalizedText(binding.title) &&
    (!binding.artist || detailArtists.includes(normalizedText(binding.artist))) &&
    detailCatalogs.includes(catalog) &&
    detail.formats.some((format) => cdFormatPresent([format.name, ...format.descriptions]));
}

function persistedOfficialCover(candidate: ComprehensiveDiscographyCandidate) {
  const manifestEntryKey = candidateManifestEntryKey(candidate);
  const matches = candidate.observations.flatMap((item): PersistedBoundCover[] => {
    if (
      item.verdict !== "PASS" ||
      item.role !== "AUTHORITATIVE" ||
      !persistedOfficialCoverReasonCodes.has(item.reasonCode) ||
      !item.sourceUrl ||
      !item.matchedFields.includes("title")
    ) return [];
    const itemManifestEntryKey = item.facts?.manifestEntryKey?.trim() || null;
    if (!manifestEntryKey || itemManifestEntryKey !== manifestEntryKey) return [];
    const canonicalTitle = item.facts?.canonicalTitle ?? item.facts?.title;
    if (canonicalTitle && normalizedText(canonicalTitle) !== normalizedText(candidate.candidate.title)) {
      return [];
    }
    const sourceReleaseDate = item.facts?.observedEditionDate ??
      item.facts?.date ??
      item.facts?.originalReleaseDate ??
      candidate.candidate.originalReleaseDate;
    const expectedCandidateDate = item.facts?.observedEditionDate
      ? candidate.candidate.releaseDate
      : candidate.candidate.originalReleaseDate ?? candidate.candidate.releaseDate;
    if (
      !sourceReleaseDate ||
      !expectedCandidateDate ||
      !curatedDatesCompatible(expectedCandidateDate, sourceReleaseDate)
    ) return [];
    const imageUrl = item.facts?.coverUrl?.trim() ||
      (candidate.candidate.coverImageSourceUrl === item.sourceUrl
        ? candidate.candidate.coverImageUrl
        : null);
    if (!imageUrl) return [];
    return [{
      imageUrl,
      sourceUrl: item.sourceUrl,
      provider: "official-label",
      coverMatchLevel: "WORK",
      sourceReleaseDate,
    }];
  });
  const unique = new Map(matches.map((item) => [JSON.stringify([
    item.imageUrl,
    item.sourceUrl,
    item.sourceReleaseDate,
  ]), item]));
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

function isPersistedAppleEditionBinding(
  value: unknown,
): value is PersistedItunesEditionCoverBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  const identity = binding.candidateIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const candidateIdentity = identity as Record<string, unknown>;
  return binding.schemaVersion === 1 &&
    binding.provider === "apple-music" &&
    Number.isSafeInteger(binding.collectionId) && Number(binding.collectionId) > 0 &&
    Number.isSafeInteger(binding.artistId) && Number(binding.artistId) > 0 &&
    [
      binding.artistName,
      binding.collectionName,
      binding.releaseDate,
      binding.imageUrl,
      binding.sourceUrl,
      binding.artistQuery,
      candidateIdentity.id,
      candidateIdentity.title,
      candidateIdentity.category,
      candidateIdentity.artistCredit,
      candidateIdentity.releaseDate,
    ].every((item) => typeof item === "string" && item.trim().length > 0) &&
    (candidateIdentity.titleOriginal === null || typeof candidateIdentity.titleOriginal === "string") &&
    (candidateIdentity.originalReleaseDate === null ||
      typeof candidateIdentity.originalReleaseDate === "string") &&
    /^\d{4}-\d{2}-\d{2}$/u.test(String(binding.releaseDate)) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(String(candidateIdentity.releaseDate)) &&
    appleCollectionIdFromStoreUrl(String(binding.sourceUrl)) === binding.collectionId &&
    isAllowedVerifiedCoverAssetUrl(String(binding.imageUrl), "apple-music") &&
    isAllowedVerifiedCoverSourceUrl(String(binding.sourceUrl), "apple-music");
}

function persistedAppleBinding(
  candidate: ComprehensiveDiscographyCandidate,
  result: ComprehensiveCandidateResult | undefined,
  artistQuery: string,
) {
  const binding = result?.cover?.appleEditionBinding;
  if (
    !binding ||
    !isPersistedAppleEditionBinding(binding) ||
    result.candidate.id !== candidate.candidate.id ||
    result.workId !== candidate.workId ||
    result.editionId !== candidate.editionId ||
    normalizedText(binding.artistQuery) !== normalizedText(artistQuery) ||
    JSON.stringify(binding.candidateIdentity) !== JSON.stringify({
      id: candidate.candidate.id,
      title: candidate.candidate.title,
      titleOriginal: candidate.candidate.titleOriginal,
      category: candidate.candidate.category,
      artistCredit: candidate.candidate.artistCredit,
      releaseDate: candidate.candidate.releaseDate,
      originalReleaseDate: candidate.candidate.originalReleaseDate,
    })
  ) return null;
  return binding;
}

/**
 * Build the narrow cover-only lookup used by the persisted retry worker.
 *
 * This deliberately has no discovery dependencies. It can re-contact only a
 * raw-bundle MusicBrainz release's CAA endpoint, Discogs release ids already
 * sealed into a PASS observation, or Apple/official image pairs already bound
 * to the schema-v2 candidate. It never re-runs NDL, official catalog crawling,
 * Discogs search, Apple search, or AI, and it never changes evidence facts.
 */
export function createPersistedCoverRetryLookup(
  input: PersistedCoverRetryLookupInput,
  dependencies: PersistedCoverRetryLookupDependencies = {},
) {
  const candidatesById = new Map(input.candidates.map((candidate) => [
    candidate.candidate.id,
    candidate,
  ]));
  const resultsById = new Map((input.results ?? []).map((result) => [
    result.candidate.id,
    result,
  ]));
  const discogs = dependencies.discogs ?? discogsClient;
  const musicMetadata = dependencies.musicMetadata ?? musicMetadataClient;
  const lookupItunesAlbum = dependencies.lookupItunesAlbum ?? (
    (collectionId: number, country: string | null | undefined) =>
      lookupItunesAlbumByCollectionId(collectionId, country, {
        throwOnUnavailable: true,
      })
  );
  const validate = dependencies.validateCover ?? validateCoverAsset;
  const now = dependencies.now ?? (() => new Date());
  const discogsCache = new Map<number, Promise<DiscogsResult<DiscogsReleaseEvidence | null>>>();
  const caaCache = new Map<string, ReturnType<typeof musicMetadata.getCoverArt>>();
  const itunesCache = new Map<number, Promise<ItunesAlbumResult | null>>();

  const getDiscogsDetail = (releaseId: number) => {
    let pending = discogsCache.get(releaseId);
    if (!pending) {
      pending = discogs.getRelease(releaseId);
      discogsCache.set(releaseId, pending);
    }
    return pending;
  };
  const getCaaRelease = (releaseId: string) => {
    let pending = caaCache.get(releaseId);
    if (!pending) {
      pending = musicMetadata.getCoverArt("release", releaseId);
      caaCache.set(releaseId, pending);
    }
    return pending;
  };
  const getItunesAlbum = (collectionId: number) => {
    let pending = itunesCache.get(collectionId);
    if (!pending) {
      pending = lookupItunesAlbum(collectionId, input.bundle.query.targetCountry);
      itunesCache.set(collectionId, pending);
    }
    return pending;
  };

  return async (supplied: ComprehensiveDiscographyCandidate): Promise<ComprehensiveCoverLookupResult> => {
    const candidate = candidatesById.get(supplied.candidate.id);
    if (candidate !== supplied) {
      return {
        status: "INVALID",
        reasonCode: "COVER_RETRY_SOURCE_IDENTITY_MISMATCH",
        reason: "The supplied cover retry candidate is not the persisted schema-v2 source object.",
        retryable: false,
      };
    }

    let retryable = false;
    let invalid = false;
    const validatedPairs = new Map<string, ReturnType<typeof validateProviderCover>>();
    const validateBoundCover = (bound: PersistedBoundCover | (PersistedBoundCover & {
      provider: "apple-music" | "official-label";
    })) => {
      const key = JSON.stringify([bound.provider, bound.imageUrl, bound.sourceUrl]);
      let checked = validatedPairs.get(key);
      if (!checked) {
        checked = validateProviderCover(
          bound.imageUrl,
          bound.sourceUrl,
          bound.provider,
          validate,
          now,
          bound,
          { timeoutMs: 15_000, retryCount: 1 },
        );
        validatedPairs.set(key, checked);
      }
      return checked;
    };

    const official = persistedOfficialCover(candidate);
    if (official) {
      const checked = await validateBoundCover(official);
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const musicBrainz = exactPersistedMusicBrainzRelease(candidate, input.bundle);
    if (musicBrainz) {
      const sourceUrl = `https://coverartarchive.org/release/${musicBrainz.releaseId}`;
      for (const imageUrl of musicBrainz.covers) {
        const checked = await validateProviderCover(
          imageUrl,
          sourceUrl,
          "cover-art-archive",
          validate,
          now,
          {
            coverMatchLevel: "EDITION",
            sourceReleaseDate: musicBrainz.release.date,
          },
          COVER_ART_ARCHIVE_VALIDATION_OPTIONS,
        );
        if (checked.found) return checked.found;
        retryable ||= checked.retryable;
        invalid ||= checked.invalid;
      }
      try {
        const response = await getCaaRelease(musicBrainz.releaseId);
        retryable ||= response.warnings.some((warning) => warning.retryable);
        const cover = response.value;
        if (cover && (
          cover.entityType !== "release" ||
          cover.sourceId.toLocaleLowerCase("en") !== musicBrainz.releaseId.toLocaleLowerCase("en") ||
          cover.sourceUrl !== sourceUrl
        )) {
          invalid = true;
        } else if (cover?.approved === true) {
          const checked = await validateProviderCover(
            cover.imageUrl,
            cover.sourceUrl,
            "cover-art-archive",
            validate,
            now,
            {
              coverMatchLevel: "EDITION",
              sourceReleaseDate: musicBrainz.release.date,
            },
            COVER_ART_ARCHIVE_VALIDATION_OPTIONS,
          );
          if (checked.found) return checked.found;
          retryable ||= checked.retryable;
          invalid ||= checked.invalid;
        }
      } catch {
        retryable = true;
      }
    }

    const discogsBinding = exactPersistedDiscogsBinding(candidate);
    if (discogsBinding) {
      for (const releaseId of discogsBinding.releaseIds) {
        try {
          const response = await getDiscogsDetail(releaseId);
          retryable ||= response.warnings.some((warning) => warning.retryable);
          const detail = response.value;
          if (!detail) continue;
          if (!persistedDiscogsDetailMatches(candidate, discogsBinding, detail)) {
            invalid = true;
            continue;
          }
          const images = uniqueStrings([
            detail.primaryImageUrl,
            detail.displayImageUrl,
            candidate.candidate.coverImageSourceUrl === detail.sourceUrl
              ? candidate.candidate.coverImageUrl
              : null,
          ]);
          for (const imageUrl of images) {
            const checked = await validateProviderCover(
              imageUrl,
              detail.sourceUrl,
              "discogs",
              validate,
              now,
              {
                coverMatchLevel: "EDITION",
                sourceReleaseDate: detail.released ?? String(detail.year),
              },
            );
            if (checked.found) return checked.found;
            retryable ||= checked.retryable;
            invalid ||= checked.invalid;
          }
        } catch {
          retryable = true;
        }
      }
    }

    const appleBinding = persistedAppleBinding(
      candidate,
      resultsById.get(candidate.candidate.id),
      input.bundle.query.artistName,
    );
    let retryableAppleBinding: PersistedItunesEditionCoverBinding | null = null;
    if (appleBinding) {
      try {
        const album = await getItunesAlbum(appleBinding.collectionId);
        if (
          !album ||
          !exactItunesAlbumMatchesPersistedEditionBinding(
            candidate.candidate,
            album,
            appleBinding,
          )
        ) {
          invalid = true;
        } else {
          const refreshedBinding = createPersistedItunesEditionCoverBinding(
            candidate.candidate,
            album,
            appleBinding.artistQuery,
          )!;
          const checked = await validateBoundCover({
            imageUrl: refreshedBinding.imageUrl,
            sourceUrl: refreshedBinding.sourceUrl,
            provider: "apple-music",
            coverMatchLevel: "EDITION",
            sourceReleaseDate: refreshedBinding.releaseDate,
          });
          if (checked.found) {
            return { ...checked.found, appleEditionBinding: refreshedBinding };
          }
          retryable ||= checked.retryable;
          invalid ||= checked.invalid;
          if (checked.retryable) retryableAppleBinding = refreshedBinding;
        }
      } catch {
        retryable = true;
        retryableAppleBinding = appleBinding;
      }
    }

    if (retryable) {
      return {
        status: "UNAVAILABLE",
        reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
        reason: "One or more persisted exact cover sources were temporarily unavailable.",
        retryable: true,
        ...(retryableAppleBinding
          ? { appleEditionBinding: retryableAppleBinding }
          : {}),
      };
    }
    if (invalid) {
      return {
        status: "INVALID",
        reasonCode: "PERSISTED_EXACT_COVER_INVALID",
        reason: "A persisted exact cover source failed its provider, identity, date, or image validation.",
        retryable: false,
      };
    }
    return {
      status: "MISSING",
      reasonCode: "PERSISTED_EXACT_COVER_NOT_FOUND",
      reason: "The persisted exact CAA, Discogs, Apple, and official sources returned no validated cover.",
      retryable: false,
    };
  };
}

const COVER_ART_ARCHIVE_VALIDATION_OPTIONS = {
  timeoutMs: 15_000,
  // One immediate retry absorbs short Archive/CDN throttling bursts. The
  // persisted outer cover retry remains responsible for longer outages.
  retryCount: 1,
} as const;

function createCoverLookup(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  initialDiscogsRows: ReadonlyMap<string, DiscogsSearchReleaseEvidence[]>,
  initialItunes: ItunesSearchState,
  dependencies: {
    discogs: Pick<DiscogsClient, "getRelease">;
    musicMetadata: Pick<MusicMetadataClient, "getCoverArt">;
    validate: typeof validateCoverAsset;
    now: () => Date;
    maxDiscogsDetails: number;
    minimumItunesArtistCollections: number;
    maxItunesTitleLookups: number;
    soundFujiCoversByWorkId: ReadonlyMap<string, SoundFujiWorkCoverEvidence>;
    momoeOfficialCoversByWorkId: ReadonlyMap<string, MomoeYamaguchiWorkCoverEvidence>;
    seikoOfficialCoversByWorkId: ReadonlyMap<string, SeikoMatsudaOfficialCoverEvidence>;
    recoveredOfficialCoversByWorkId: ReadonlyMap<string, {
      url: string;
      sourceUrl: string;
      auditedAsset?: {
        mime: "image/gif" | "image/jpeg" | "image/png";
        width: number;
        height: number;
        sha256: string;
        allowContentTypeMismatch?: boolean;
      };
    }>;
    curatedDiscogsBindingsByWorkId: ReadonlyMap<string, CuratedDiscogsWorkBinding>;
    searchItunesByArtist: NonNullable<ComprehensiveSourceAdapterDependencies["searchItunes"]>;
    searchItunesByTitle: NonNullable<ComprehensiveSourceAdapterDependencies["searchItunesByTitle"]>;
    artistQuery: string;
    refreshDiscogsRows?: () => Promise<{
      rows: ReadonlyMap<string, DiscogsSearchReleaseEvidence[]>;
      retryable: boolean;
    }>;
    country: string;
    stats: ComprehensiveSourceStats;
  },
) {
  const byId = new Map(candidates.map((candidate) => [candidate.candidate.id, candidate]));
  const candidatesByWorkId = new Map<string, ComprehensiveDiscographyCandidate[]>();
  for (const candidate of candidates) {
    const workCandidates = candidatesByWorkId.get(candidate.workId) ?? [];
    workCandidates.push(candidate);
    candidatesByWorkId.set(candidate.workId, workCandidates);
  }
  let itunes = initialItunes;
  let itunesArtistId = selectDominantItunesArtistId(
    candidates.map((candidate) => candidate.candidate),
    itunes.albums,
    dependencies.minimumItunesArtistCollections,
  );
  let itunesRefresh: Promise<ItunesSearchState> | null = null;
  let discogsRows = initialDiscogsRows;
  let discogsRefresh: Promise<{
    rows: ReadonlyMap<string, DiscogsSearchReleaseEvidence[]>;
    retryable: boolean;
  }> | null = null;
  const cache = new Map<string, Promise<ComprehensiveCoverLookupResult>>();
  const titleSearchCache = new Map<string, Promise<ItunesSearchState>>();
  const discogsDetailCache = new Map<number, Promise<DiscogsResult<DiscogsReleaseEvidence | null>>>();
  const curatedReleaseIds = new Set([...dependencies.curatedDiscogsBindingsByWorkId.values()]
    .map((binding) => binding.evidence.release.releaseId));

  const uniquePeerCaaReleaseCover = (candidate: ComprehensiveDiscographyCandidate) => {
    const title = normalizedText(candidate.candidate.title);
    const originalReleaseDate = candidate.candidate.originalReleaseDate;
    if (!title || !originalReleaseDate) return null;

    const distinctCovers = new Map<string, {
      imageUrl: string;
      sourceUrl: string;
      sourceReleaseDate: string;
    }>();
    for (const peer of candidatesByWorkId.get(candidate.workId) ?? []) {
      if (
        peer.candidate.id === candidate.candidate.id ||
        normalizedText(peer.candidate.title) !== title ||
        peer.candidate.originalReleaseDate !== originalReleaseDate
      ) continue;

      const peerReleaseId = musicBrainzReleaseId(peer);
      if (
        !peerReleaseId ||
        peer.editionId.toLocaleLowerCase("und") !== peerReleaseId.toLocaleLowerCase("und")
      ) continue;
      const sourceUrl = `https://coverartarchive.org/release/${peerReleaseId}`;
      const imageUrl = peer.candidate.coverImageUrl;
      if (!imageUrl || peer.candidate.coverImageSourceUrl !== sourceUrl) continue;

      if (!distinctCovers.has(imageUrl)) {
        distinctCovers.set(imageUrl, {
          imageUrl,
          sourceUrl,
          sourceReleaseDate: peer.candidate.releaseDate ?? originalReleaseDate,
        });
      }
      // Two different exact release covers leave the work artwork ambiguous.
      if (distinctCovers.size > 1) return null;
    }
    return distinctCovers.size === 1 ? [...distinctCovers.values()][0]! : null;
  };

  const getDiscogsDetail = (releaseId: number) => {
    const existing = discogsDetailCache.get(releaseId);
    if (existing) return existing;
    if (curatedReleaseIds.has(releaseId)) {
      dependencies.stats.curatedPhysicalCoverDetailCalls += 1;
    }
    const pending = dependencies.discogs.getRelease(releaseId).then((response) => {
      if (response.warnings.some((warning) => warning.retryable)) {
        discogsDetailCache.delete(releaseId);
      }
      return response;
    }).catch((error) => {
      discogsDetailCache.delete(releaseId);
      throw error;
    });
    discogsDetailCache.set(releaseId, pending);
    return pending;
  };

  const lookup = async (supplied: ComprehensiveDiscographyCandidate): Promise<ComprehensiveCoverLookupResult> => {
    const candidate = byId.get(supplied.candidate.id) ?? supplied;
    let retryable = false;
    let invalid = false;
    let appleEditionBinding: PersistedItunesEditionCoverBinding | null = null;
    const caaValidationByPair = new Map<
      string,
      ReturnType<typeof validateProviderCover>
    >();
    const validateCaaCover = (
      imageUrl: string,
      sourceUrl: string,
      match: Parameters<typeof validateProviderCover>[5],
    ) => {
      // Candidate metadata and the CAA API can expose the same exact asset.
      // Validate that pair once per lookup, while allowing any different
      // image or source resource to proceed independently.
      const pair = JSON.stringify([imageUrl, sourceUrl]);
      const existing = caaValidationByPair.get(pair);
      if (existing) return existing;
      const pending = validateProviderCover(
        imageUrl,
        sourceUrl,
        "cover-art-archive",
        dependencies.validate,
        dependencies.now,
        match,
        COVER_ART_ARCHIVE_VALIDATION_OPTIONS,
      );
      caaValidationByPair.set(pair, pending);
      return pending;
    };
    const releaseId = musicBrainzReleaseId(candidate);
    const releaseGroupId = musicBrainzReleaseGroupId(candidate);
    const findAppleCoverMatch = (
      albums: readonly ItunesAlbumResult[],
      datedTitleSearchAlbums: readonly ItunesAlbumResult[] | null = null,
    ) => {
      const edition = findUniqueItunesCoverMatch(candidate.candidate, albums, itunesArtistId);
      if (edition) return { album: edition, level: "EDITION" as const };
      const work = findUniqueItunesWorkCoverMatch(candidate.candidate, albums, itunesArtistId);
      if (work) return { album: work, level: "WORK" as const };
      if (!datedTitleSearchAlbums) return null;
      // The date-only fallback must have been returned by this candidate's
      // albumTerm query. The wider inventory is evaluated separately so a
      // narrow search cannot hide another collection released on that day.
      const narrowDated = findUniqueItunesDatedWorkCoverMatch(
        candidate.candidate,
        datedTitleSearchAlbums,
        itunesArtistId,
      );
      const inventoryDated = findUniqueItunesDatedWorkCoverMatch(
        candidate.candidate,
        albums,
        itunesArtistId,
      );
      return narrowDated && inventoryDated && narrowDated.collectionId === inventoryDated.collectionId
        ? { album: narrowDated, level: "WORK" as const }
        : null;
    };

    const momoeOfficialCover = dependencies.momoeOfficialCoversByWorkId.get(candidate.workId);
    if (momoeOfficialCover) {
      const checked = await validateProviderCover(
        momoeOfficialCover.url,
        momoeOfficialCover.sourceUrl,
        "official-label",
        dependencies.validate,
        dependencies.now,
        {
          coverMatchLevel: "WORK",
          sourceReleaseDate: candidate.candidate.originalReleaseDate,
        },
        { timeoutMs: 12_000, retryCount: 1 },
      );
      if (checked.found) {
        dependencies.stats.momoeOfficialCoversMatched += 1;
        return checked.found;
      }
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const seikoOfficialCover = dependencies.seikoOfficialCoversByWorkId.get(candidate.workId);
    if (seikoOfficialCover) {
      const checked = await validateProviderCover(
        seikoOfficialCover.url,
        seikoOfficialCover.sourceUrl,
        "official-label",
        dependencies.validate,
        dependencies.now,
        {
          coverMatchLevel: "WORK",
          sourceReleaseDate: candidate.candidate.originalReleaseDate,
        },
        { timeoutMs: 12_000, retryCount: 1 },
      );
      if (checked.found) {
        dependencies.stats.seikoOfficialCoversMatched += 1;
        return checked.found;
      }
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const recoveredOfficialCover = dependencies.recoveredOfficialCoversByWorkId.get(
      candidate.workId,
    );
    if (recoveredOfficialCover) {
      const checked = await validateProviderCover(
        recoveredOfficialCover.url,
        recoveredOfficialCover.sourceUrl,
        "official-label",
        dependencies.validate,
        dependencies.now,
        {
          coverMatchLevel: "WORK",
          sourceReleaseDate: candidate.candidate.originalReleaseDate,
          expectedAsset: recoveredOfficialCover.auditedAsset,
        },
        { timeoutMs: 12_000, retryCount: 1 },
      );
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const officialWorkCover = dependencies.soundFujiCoversByWorkId.get(candidate.workId);
    if (officialWorkCover) {
      const checked = await validateProviderCover(
        officialWorkCover.url,
        officialWorkCover.sourceUrl,
        "official-label",
        dependencies.validate,
        dependencies.now,
        {
          coverMatchLevel: "WORK",
          // SOUND FUJI is an official work archive rather than a particular
          // physical-edition page. The effective source date is therefore the
          // independently established work date, never a guessed reissue date.
          sourceReleaseDate: candidate.candidate.originalReleaseDate,
        },
        { timeoutMs: 12_000, retryCount: 1 },
      );
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const existingCaaSource = releaseId
      ? `https://coverartarchive.org/release/${releaseId}`
      : null;
    if (
      existingCaaSource &&
      candidate.candidate.coverImageUrl &&
      candidate.candidate.coverImageSourceUrl === existingCaaSource
    ) {
      const checked = await validateCaaCover(
        candidate.candidate.coverImageUrl,
        existingCaaSource,
        {
          coverMatchLevel: "EDITION",
          sourceReleaseDate: candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate,
        },
      );
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    if (releaseId) {
      try {
        const response = await dependencies.musicMetadata.getCoverArt("release", releaseId);
        retryable ||= response.warnings.some((warning) => warning.retryable);
        if (response.value?.approved === true) {
          const checked = await validateCaaCover(
            response.value.imageUrl,
            response.value.sourceUrl,
            {
              coverMatchLevel: "EDITION",
              sourceReleaseDate: candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate,
            },
          );
          if (checked.found) return checked.found;
          retryable ||= checked.retryable;
          invalid ||= checked.invalid;
        }
      } catch {
        retryable = true;
      }
    }

    let candidateDiscogsRows = discogsRows.get(candidate.candidate.id) ?? [];
    if (candidateDiscogsRows.length === 0 && dependencies.refreshDiscogsRows) {
      discogsRefresh ??= dependencies.refreshDiscogsRows().then((refreshed) => {
        discogsRows = refreshed.rows;
        // A partial/retryable refresh is useful to the current callers, but it
        // must not become the permanent single-flight value. The outer cover
        // retry should perform a new provider request after the outage clears.
        if (refreshed.retryable) discogsRefresh = null;
        return refreshed;
      }).catch((error) => {
        discogsRefresh = null;
        throw error;
      });
      try {
        const refreshed = await discogsRefresh;
        retryable ||= refreshed.retryable;
        candidateDiscogsRows = refreshed.rows.get(candidate.candidate.id) ?? [];
      } catch {
        retryable = true;
      }
    }

    for (const row of candidateDiscogsRows
      .slice(0, dependencies.maxDiscogsDetails)) {
      let detail: DiscogsReleaseEvidence | null = null;
      try {
        const response: DiscogsResult<DiscogsReleaseEvidence | null> =
          await getDiscogsDetail(row.releaseId);
        detail = response.value;
        retryable ||= response.warnings.some((warning) => warning.retryable);
      } catch {
        retryable = true;
      }
      if (detail?.primaryImageUrl) {
        const checked = await validateProviderCover(
          detail.primaryImageUrl,
          detail.sourceUrl,
          "discogs",
          dependencies.validate,
          dependencies.now,
          {
            coverMatchLevel: "EDITION",
            sourceReleaseDate: detail.released ??
              (detail.year === null ? null : String(detail.year)) ??
              candidate.candidate.releaseDate ??
              candidate.candidate.originalReleaseDate,
          },
        );
        if (checked.found) return checked.found;
        retryable ||= checked.retryable;
        invalid ||= checked.invalid;
      }
      if (row.coverImageUrl) {
        const checked = await validateProviderCover(
          row.coverImageUrl,
          row.sourceUrl,
          "discogs",
          dependencies.validate,
          dependencies.now,
          {
            coverMatchLevel: "EDITION",
            sourceReleaseDate: row.year === null
              ? candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate
              : String(row.year),
          },
        );
        if (checked.found) return checked.found;
        retryable ||= checked.retryable;
        invalid ||= checked.invalid;
      }
    }

    const existingReleaseGroupSource = releaseGroupId
      ? `https://coverartarchive.org/release-group/${releaseGroupId}`
      : null;
    if (
      existingReleaseGroupSource &&
      candidate.candidate.coverImageUrl &&
      candidate.candidate.coverImageSourceUrl === existingReleaseGroupSource
    ) {
      const checked = await validateCaaCover(
        candidate.candidate.coverImageUrl,
        existingReleaseGroupSource,
        {
          coverMatchLevel: "WORK",
          sourceReleaseDate: candidate.candidate.originalReleaseDate,
        },
      );
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }
    if (releaseGroupId) {
      try {
        const response = await dependencies.musicMetadata.getCoverArt(
          "release-group",
          releaseGroupId,
        );
        retryable ||= response.warnings.some((warning) => warning.retryable);
        if (response.value?.approved === true) {
          const checked = await validateCaaCover(
            response.value.imageUrl,
            response.value.sourceUrl,
            {
              coverMatchLevel: "WORK",
              sourceReleaseDate: candidate.candidate.originalReleaseDate,
            },
          );
          if (checked.found) return checked.found;
          retryable ||= checked.retryable;
          invalid ||= checked.invalid;
        }
      } catch {
        retryable = true;
      }
    }

    const peerCaaReleaseCover = uniquePeerCaaReleaseCover(candidate);
    if (peerCaaReleaseCover) {
      const checked = await validateCaaCover(
        peerCaaReleaseCover.imageUrl,
        peerCaaReleaseCover.sourceUrl,
        {
          // This image is exact for a peer physical release, not for the
          // currently selected edition. The shared work identity, full title,
          // and original date permit only a work-level fallback.
          coverMatchLevel: "WORK",
          sourceReleaseDate: peerCaaReleaseCover.sourceReleaseDate,
        },
      );
      if (checked.found) return checked.found;
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
    }

    const curatedDiscogsBinding = dependencies.curatedDiscogsBindingsByWorkId.get(candidate.workId);
    if (curatedDiscogsBinding) {
      const curatedReleaseId = curatedDiscogsBinding.evidence.release.releaseId;
      try {
        const response = await getDiscogsDetail(curatedReleaseId);
        retryable ||= response.warnings.some((warning) => warning.retryable);
        const detail = response.value;
        if (detail && curatedDiscogsDetailMatchesWork(curatedDiscogsBinding, detail)) {
          const images = uniqueStrings([
            detail.primaryImageUrl,
            detail.displayImageUrl,
            curatedDiscogsBinding.evidence.release.coverImageUrl,
          ]);
          for (const imageUrl of images) {
            const checked = await validateProviderCover(
              imageUrl,
              detail.sourceUrl,
              "discogs",
              dependencies.validate,
              dependencies.now,
              {
                coverMatchLevel: "WORK",
                sourceReleaseDate: detail.released,
              },
            );
            if (checked.found) {
              dependencies.stats.curatedPhysicalCoversMatched += 1;
              return checked.found;
            }
            retryable ||= checked.retryable;
            invalid ||= checked.invalid;
          }
        }
      } catch {
        retryable = true;
      }
    }

    // Apple artwork is a work-level fallback after exact physical-edition
    // sources. A later digital issue must never mask an available original
    // CAA or Discogs cover.
    let appleMatch = findAppleCoverMatch(itunes.albums);
    if (itunes.unavailable) {
      itunesRefresh ??= safeItunesSearch(
        dependencies.searchItunesByArtist,
        dependencies.artistQuery,
        dependencies.country,
        dependencies.stats,
      ).then((refreshed) => {
        itunes = refreshed;
        itunesArtistId = selectDominantItunesArtistId(
          candidates.map((item) => item.candidate),
          refreshed.albums,
          dependencies.minimumItunesArtistCollections,
        );
        // safeItunesSearch reports provider failures as a resolved unavailable
        // state. Do not retain that resolved promise or later cover retries
        // would keep replaying the same outage instead of contacting Apple.
        if (refreshed.unavailable) itunesRefresh = null;
        return refreshed;
      }).catch((error) => {
        itunesRefresh = null;
        throw error;
      });
      const refreshed = await itunesRefresh;
      retryable ||= refreshed.unavailable;
      appleMatch = findAppleCoverMatch(itunes.albums);
    }
    if (!appleMatch && itunesArtistId !== null) {
      const titleKey = normalizedText(candidate.candidate.title);
      let titleSearch = titleSearchCache.get(titleKey);
      if (!titleSearch && titleSearchCache.size < dependencies.maxItunesTitleLookups) {
        dependencies.stats.itunesTitleCalls += 1;
        titleSearch = dependencies.searchItunesByTitle(candidate.candidate.title, dependencies.country)
          .then((albums) => ({ albums, unavailable: false }))
          .catch(() => ({ albums: [], unavailable: true }));
        titleSearchCache.set(titleKey, titleSearch);
      }
      if (titleSearch) {
        const titleResult = await titleSearch;
        if (titleResult.unavailable) {
          titleSearchCache.delete(titleKey);
          retryable = true;
        } else {
          // Preserve the broader artist inventory when judging uniqueness. A
          // narrower albumTerm result must not hide an already-observed
          // same-title collection and turn an ambiguous work into a match.
          appleMatch = findAppleCoverMatch(
            [...itunes.albums, ...titleResult.albums],
            titleResult.albums,
          );
        }
      }
    }
    const appleAlbum = appleMatch?.album ?? null;
    const appleImage = toItunesArtwork600(appleAlbum?.artworkUrl100);
    const appleSource = normalizeAppleStoreUrl(appleAlbum?.collectionViewUrl);
    if (appleImage && appleSource) {
      const exactAppleEditionBinding = appleMatch?.level === "EDITION" && appleAlbum
        ? createPersistedItunesEditionCoverBinding(
            candidate.candidate,
            appleAlbum,
            dependencies.artistQuery,
          )
        : null;
      const checked = await validateProviderCover(
        appleImage,
        appleSource,
        "apple-music",
        dependencies.validate,
        dependencies.now,
        {
          coverMatchLevel: appleMatch!.level,
          sourceReleaseDate: appleAlbum!.releaseDate,
        },
      );
      if (checked.found) {
        return exactAppleEditionBinding
          ? { ...checked.found, appleEditionBinding: exactAppleEditionBinding }
          : checked.found;
      }
      retryable ||= checked.retryable;
      invalid ||= checked.invalid;
      if (checked.retryable) appleEditionBinding = exactAppleEditionBinding;
    }

    if (retryable) {
      return {
        status: "UNAVAILABLE",
        reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
        reason: "One or more exact cover sources were temporarily unavailable.",
        retryable: true,
        ...(appleEditionBinding ? { appleEditionBinding } : {}),
      };
    }
    if (invalid) {
      return {
        status: "INVALID",
        reasonCode: "EXACT_COVER_INVALID",
        reason: "Exact cover candidates were found but failed image validation.",
        retryable: false,
      };
    }
    return {
      status: "MISSING",
      reasonCode: "EXACT_COVER_NOT_FOUND",
      reason: "CAA, Discogs, and Apple Music returned no exact validated cover.",
      retryable: false,
    };
  };

  return (candidate: ComprehensiveDiscographyCandidate) => {
    const key = candidate.candidate.id;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = lookup(candidate).then((result) => {
      // Only successful byte-validated covers are immutable. A later lookup
      // must be able to recover from a temporary CDN response that looked
      // invalid during the first attempt.
      if (result.status !== "FOUND") cache.delete(key);
      return result;
    }).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    return pending;
  };
}

export async function prepareComprehensiveSourceEvidence(
  input: PrepareComprehensiveSourceEvidenceInput,
  dependencies: ComprehensiveSourceAdapterDependencies = {},
): Promise<PreparedComprehensiveSourceEvidence> {
  const limits = {
    maxScopeCandidates: clampInteger(dependencies.limits?.maxScopeCandidates, 500, 1, 500),
    maxNdlCatalogLookups: clampInteger(dependencies.limits?.maxNdlCatalogLookups, 240, 0, 500),
    maxOfficialCandidates: clampInteger(dependencies.limits?.maxOfficialCandidates, 200, 0, 200),
    maxDiscogsQueries: clampInteger(dependencies.limits?.maxDiscogsQueries, 3, 0, 5),
    maxDiscogsPagesPerQuery: clampInteger(dependencies.limits?.maxDiscogsPagesPerQuery, 5, 1, 10),
    maxDiscogsItemsPerQuery: clampInteger(dependencies.limits?.maxDiscogsItemsPerQuery, 500, 1, 1_000),
    maxCuratedPhysicalQueries: clampInteger(
      dependencies.limits?.maxCuratedPhysicalQueries,
      3,
      0,
      5,
    ),
    // A complete inventory is required before claiming a unique original-work
    // binding. Prolific legacy artists can exceed five Discogs pages (Akina is
    // currently above 600 Japan physical rows), so use the client's existing
    // ten-page/1,000-row hard ceiling rather than silently making their
    // manifests permanently ineligible.
    maxCuratedPhysicalPagesPerQuery: clampInteger(
      dependencies.limits?.maxCuratedPhysicalPagesPerQuery,
      10,
      1,
      10,
    ),
    maxCuratedPhysicalItemsPerQuery: clampInteger(
      dependencies.limits?.maxCuratedPhysicalItemsPerQuery,
      1_000,
      1,
      1_000,
    ),
    maxDiscogsRowsPerCandidate: clampInteger(dependencies.limits?.maxDiscogsRowsPerCandidate, 10, 1, 50),
    maxDiscogsCoverDetailsPerCandidate: clampInteger(
      dependencies.limits?.maxDiscogsCoverDetailsPerCandidate,
      3,
      0,
      10,
    ),
    minimumItunesArtistCollections: clampInteger(
      dependencies.limits?.minimumItunesArtistCollections,
      2,
      1,
      20,
    ),
    maxItunesTitleLookups: clampInteger(dependencies.limits?.maxItunesTitleLookups, 120, 0, 200),
  };
  const ndl = dependencies.ndl ?? getDefaultNdlClient();
  const ndlManifestFetcher = dependencies.fetchNdlSingleManifests ?? (dependencies.ndl
    ? async () => ({ evidence: [], unavailable: false })
    : fetchNdlSingleManifests);
  const officialResearch = dependencies.researchOfficial ?? ((request) => researchOfficialMusicCatalog(request));
  const hasInjectedPublicSources = Boolean(
    dependencies.ndl ||
    dependencies.researchOfficial ||
    dependencies.discogs ||
    dependencies.musicMetadata ||
    dependencies.searchItunes ||
    dependencies.searchItunesByTitle ||
    dependencies.searchJapanPhysicalReleases ||
    dependencies.researchMihoKingCarrier ||
    dependencies.researchMihoMellowCd ||
    dependencies.researchSeikoRecovery ||
    dependencies.researchAkinaRecovery,
  );
  const soundFujiResearch = dependencies.researchSoundFuji ??
    (hasInjectedPublicSources ? null : researchSoundFujiWorkArchive);
  const momoeOfficialResearch = dependencies.researchMomoeOfficial ??
    (hasInjectedPublicSources ? null : fetchMomoeYamaguchiOfficialCatalog);
  const momoeCosmosCarrierResearch = dependencies.researchMomoeCosmosCarrier ??
    (hasInjectedPublicSources ? null : fetchMomoeYamaguchiCosmosPhysicalCdCarrier);
  const seikoOfficialResearch = dependencies.researchSeikoOfficial ??
    (hasInjectedPublicSources ? null : fetchSeikoMatsudaOfficialEntities);
  const mihoKingCarrierResearch = dependencies.researchMihoKingCarrier ??
    (hasInjectedPublicSources ? null : () => getDefaultMihoKingCarrierClient().load());
  const mihoMellowCdResearch = dependencies.researchMihoMellowCd ??
    (hasInjectedPublicSources ? null : () => getDefaultMihoMellowCdClient().load());
  const seikoRecoveryResearch = dependencies.researchSeikoRecovery ??
    (hasInjectedPublicSources ? null : () => getDefaultSeikoRecoveryClient().load());
  const akinaRecoveryResearch = dependencies.researchAkinaRecovery ??
    (hasInjectedPublicSources ? null : () => getDefaultAkinaRecoveryClient().fetchRecovery());
  const matchSeikoOfficial = dependencies.matchSeikoOfficial ??
    matchSeikoOfficialEntitiesToCurated;
  const discogs = dependencies.discogs ?? discogsClient;
  const searchJapanPhysicalReleases = dependencies.searchJapanPhysicalReleases ??
    (dependencies.discogs
      ? null
      : (query: string, options: Parameters<DiscogsClient["searchJapanPhysicalReleases"]>[1]) =>
          discogsClient.searchJapanPhysicalReleases(query, options));
  const musicMetadata = dependencies.musicMetadata ?? musicMetadataClient;
  const validate = dependencies.validateCover ?? validateCoverAsset;
  const searchItunes = dependencies.searchItunes ?? ((artist, country) =>
    searchItunesAlbums(artist, country, { limit: 200, throwOnUnavailable: true }));
  const searchItunesByTitle = dependencies.searchItunesByTitle ?? ((title, country) =>
    searchItunesAlbums(title, country, {
      limit: 50,
      attribute: "albumTerm",
      throwOnUnavailable: true,
    }));
  const now = dependencies.now ?? (() => new Date());
  const stats: ComprehensiveSourceStats = {
    scopeCandidates: 0,
    supplementalCandidates: 0,
    curatedManifestWorks: 0,
    curatedManifestMatched: 0,
    curatedManifestSeeded: 0,
    curatedManifestPendingSeeded: 0,
    curatedManifestOutOfScope: 0,
    curatedManifestUnknownScope: 0,
    curatedHistoricalNonCanonicalOutOfScope: 0,
    curatedCanonicalTitleDateConflicts: 0,
    curatedPhysicalSearchCalls: 0,
    curatedPhysicalRows: 0,
    curatedPhysicalSourceTotal: 0,
    curatedPhysicalPagesFetched: 0,
    curatedPhysicalMatchedWorks: 0,
    curatedPhysicalReboundCandidates: 0,
    curatedPhysicalIncompleteInventories: 0,
    curatedPhysicalRetryableFailures: 0,
    curatedPhysicalRateLimits: 0,
    curatedPhysicalCoverDetailCalls: 0,
    curatedPhysicalCoversMatched: 0,
    momoeOfficialCalls: 0,
    momoeOfficialMatchedWorks: 0,
    momoeOfficialIncomplete: 0,
    momoeOfficialCoversMatched: 0,
    momoeMusicBrainzCarrierMatchedWorks: 0,
    momoeMusicBrainzCarrierFailures: 0,
    seikoOfficialCalls: 0,
    seikoOfficialMatchedWorks: 0,
    seikoOfficialIncomplete: 0,
    seikoOfficialCoversMatched: 0,
    ndlInventoryCalls: 0,
    ndlCatalogCalls: 0,
    ndlMatched: 0,
    ndlManifestCalls: 0,
    ndlManifestMatched: 0,
    officialCalls: 0,
    officialMatched: 0,
    soundFujiCalls: 0,
    soundFujiMatched: 0,
    soundFujiCovers: 0,
    discogsSearchCalls: 0,
    discogsRows: 0,
    discogsMatched: 0,
    itunesCalls: 0,
    itunesTitleCalls: 0,
    itunesAlbums: 0,
  };
  const artist = artistNames(input.request, input.result, input.bundle);
  const useCuratedManifests = dependencies.useCuratedManifests ??
    (Boolean(dependencies.searchJapanPhysicalReleases) || !hasInjectedPublicSources);
  const findManifest = dependencies.findCuratedDiscography ?? findCuratedArtistDiscography;
  const resolvedManifest = useCuratedManifests
    ? findManifest(
        input.bundle.artist?.sourceId,
        [artist.primary, ...artist.aliases],
      )
    : null;
  const curatedManifest = resolvedManifest &&
      resolveItunesCountryCode(input.request.country) === resolvedManifest.country
    ? resolvedManifest
    : null;
  const baseCandidates = useCuratedManifests
    ? applyCuratedManifestEvidence(
        input.candidates,
        input.request,
        input.result,
        input.bundle,
        stats,
        () => curatedManifest,
      )
    : [...input.candidates];
  const historicallyGatedBaseCandidates = applyCuratedHistoricalCanonGate(
    baseCandidates,
    curatedManifest,
    stats,
  );
  const initialScoped = historicallyGatedBaseCandidates
    .filter(isScopeResearchable)
    .slice(0, limits.maxScopeCandidates);
  const shouldFetchSources = limits.maxScopeCandidates > 0;
  const hasSupplementCapacity = initialScoped.length < limits.maxScopeCandidates;
  const officialUrls = validOfficialUrls(input.result, input.bundle);
  const officialCandidates = officialCandidatesByWorkBreadth(initialScoped)
    .slice(0, limits.maxOfficialCandidates);
  const officialIds = new Set(officialCandidates.map((candidate) => candidate.candidate.id));
  const discogsQueries = shouldFetchSources
    ? uniqueStrings([
        input.bundle.artist?.name,
        input.result.artist.nameRomaji,
        input.request.artistName,
        input.result.artist.name,
      ]).slice(0, limits.maxDiscogsQueries)
    : [];

  stats.ndlInventoryCalls = shouldFetchSources ? 1 : 0;
  stats.officialCalls = officialUrls.length > 0 && officialCandidates.length > 0 ? 1 : 0;
  const inventoryPromise = shouldFetchSources
    ? safeNdlInventory(ndl, artist.primary)
    : Promise.resolve({ value: null, warnings: [] } satisfies NdlClientResult);
  const officialPromise = stats.officialCalls > 0
    ? safeOfficialResearch(officialResearch, {
        officialUrls,
        candidates: officialCandidates.map((candidate) => ({
          id: candidate.candidate.id,
          title: candidate.candidate.title,
          date: candidate.candidate.releaseDate ?? candidate.candidate.originalReleaseDate,
          catalogNumber: candidate.candidate.catalogNumber,
        })),
      })
    : Promise.resolve({
        value: null,
        error: officialUrls.length === 0
          ? "No official artist or label catalog root URL was available."
          : "The bounded official-catalog candidate budget was disabled or exhausted.",
        reasonCode: officialUrls.length === 0
          ? "OFFICIAL_CATALOG_ROOT_MISSING"
          : "OFFICIAL_CANDIDATE_LIMIT",
        retryable: false,
      } as const);
  const discogsPromise = searchDiscogsSources(
    discogs,
    discogsQueries,
    limits,
    stats,
  );
  const curatedPhysicalPromise = shouldFetchSources
    ? searchCuratedPhysicalInventory(
        searchJapanPhysicalReleases,
        curatedManifest,
        limits,
        stats,
      )
    : Promise.resolve({
        inventory: null,
        rows: [],
        complete: false,
        retryable: false,
      } satisfies CuratedPhysicalSearchState);
  const shouldFetchMomoeOfficial = Boolean(
    shouldFetchSources && curatedManifest?.slug === "momoe-yamaguchi" && momoeOfficialResearch,
  );
  stats.momoeOfficialCalls = shouldFetchMomoeOfficial ? 1 : 0;
  const momoeOfficialPromise = shouldFetchMomoeOfficial
    ? momoeOfficialResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchMomoeCosmosCarrier = Boolean(
    shouldFetchSources && curatedManifest?.slug === "momoe-yamaguchi" &&
      momoeCosmosCarrierResearch,
  );
  const momoeCosmosCarrierPromise = shouldFetchMomoeCosmosCarrier
    ? momoeCosmosCarrierResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchSeikoOfficial = Boolean(
    shouldFetchSources && curatedManifest?.slug === "seiko-matsuda" && seikoOfficialResearch,
  );
  stats.seikoOfficialCalls = shouldFetchSeikoOfficial ? 1 : 0;
  const seikoOfficialPromise = shouldFetchSeikoOfficial
    ? seikoOfficialResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchMihoKingCarrier = Boolean(
    shouldFetchSources && curatedManifest?.slug === "miho-nakayama" &&
      mihoKingCarrierResearch,
  );
  const mihoKingCarrierPromise = shouldFetchMihoKingCarrier
    ? mihoKingCarrierResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchMihoMellowCd = Boolean(
    shouldFetchSources && curatedManifest?.slug === "miho-nakayama" &&
      mihoMellowCdResearch,
  );
  const mihoMellowCdPromise = shouldFetchMihoMellowCd
    ? mihoMellowCdResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchSeikoRecovery = Boolean(
    shouldFetchSources && curatedManifest?.slug === "seiko-matsuda" &&
      seikoRecoveryResearch,
  );
  const seikoRecoveryPromise = shouldFetchSeikoRecovery
    ? seikoRecoveryResearch!().catch(() => null)
    : Promise.resolve(null);
  const shouldFetchAkinaRecovery = Boolean(
    shouldFetchSources && curatedManifest?.slug === "akina-nakamori" &&
      akinaRecoveryResearch,
  );
  const akinaRecoveryPromise = shouldFetchAkinaRecovery
    ? akinaRecoveryResearch!().catch(() => null)
    : Promise.resolve(null);
  const itunesPromise = shouldFetchSources
    ? safeItunesSearch(searchItunes, artist.primary, input.request.country, stats)
    : Promise.resolve({ albums: [], unavailable: false });
  const [
    inventory,
    official,
    discogsSearch,
    curatedPhysical,
    momoeOfficialCatalog,
    momoeCosmosCarrier,
    seikoOfficialCatalog,
    mihoKingCarrier,
    mihoMellowCd,
    seikoRecovery,
    akinaRecovery,
    itunes,
  ] = await Promise.all([
    inventoryPromise,
    officialPromise,
    discogsPromise,
    curatedPhysicalPromise,
    momoeOfficialPromise,
    momoeCosmosCarrierPromise,
    seikoOfficialPromise,
    mihoKingCarrierPromise,
    mihoMellowCdPromise,
    seikoRecoveryPromise,
    akinaRecoveryPromise,
    itunesPromise,
  ]);
  const inventoryValue = inventory.value;
  const ndlSingleManifests = inventoryValue
    ? await (async () => {
        stats.ndlManifestCalls = 1;
        try {
          return await ndlManifestFetcher(inventoryValue.records, [artist.primary, ...artist.aliases]);
        } catch {
          return { evidence: [], unavailable: true };
        }
      })()
    : { evidence: [], unavailable: inventory.warnings.some((warning) => warning.retryable) };
  stats.discogsRows = discogsSearch.rows.length;
  stats.itunesAlbums = itunes.albums.length;
  const supplemental = hasSupplementCapacity
    ? discoverDiscogsSupplementalCandidates({
      rows: discogsSearch.rows,
        existingCandidates: historicallyGatedBaseCandidates,
        request: input.request,
        artistCredit: input.result.artist.name,
        knownWorkIdsByMaster: knownWorkIdsByDiscogsMaster(
          historicallyGatedBaseCandidates,
          discogsSearch.rows,
        ),
        sourceComplete: !discogsSearch.incomplete,
        maximum: Math.max(0, limits.maxScopeCandidates - initialScoped.length),
      })
    : [];
  stats.supplementalCandidates = supplemental.length;
  const historicallyGatedSupplemental = applyCuratedHistoricalCanonGate(
    supplemental,
    curatedManifest,
    stats,
  );
  const rawCandidates = [
    ...historicallyGatedBaseCandidates,
    ...historicallyGatedSupplemental,
  ];
  const soundFujiRepresentatives = soundFujiWorkRepresentatives(
    rawCandidates.filter(isScopeResearchable),
  );
  const soundFujiLabels = uniqueStrings([
    ...rawCandidates.map((candidate) => candidate.candidate.label),
    ...(inventoryValue?.records.flatMap((record) => record.publishers) ?? []),
  ]).filter(isKingRecordsLabelOrPublisher);
  const soundFujiAttempted = Boolean(
    soundFujiResearch && soundFujiLabels.length > 0 && soundFujiRepresentatives.length > 0,
  );
  stats.soundFujiCalls = soundFujiAttempted ? 1 : 0;
  let soundFujiResult: SoundFujiArchiveResearchResult | null = null;
  if (soundFujiAttempted) {
    try {
      soundFujiResult = await soundFujiResearch!({
        artistNames: [artist.primary, ...artist.aliases],
        labelOrPublisherNames: soundFujiLabels,
        candidates: soundFujiRepresentatives,
      });
    } catch {
      soundFujiResult = null;
    }
  }
  const soundFuji = applySoundFujiEvidence(
    rawCandidates,
    soundFujiResult,
    soundFujiAttempted,
    stats,
  );
  const curatedPhysicalApplication = applyCuratedPhysicalEvidence({
    candidates: soundFuji.candidates,
    request: input.request,
    manifest: curatedManifest,
    physical: curatedPhysical,
    cdRows: discogsSearch.rows,
    stats,
  });
  const [akinaFixedMusicBrainzCarriers, curatedFixedMusicBrainzCarriers] = await Promise.all([
    fetchAkinaFixedMusicBrainzCarriers(curatedManifest, musicMetadata),
    fetchCuratedFixedMusicBrainzCarriers(curatedManifest, musicMetadata),
  ]);
  const curatedMusicBrainzCarrierApplication = applyCuratedMusicBrainzCarrierEvidence({
    candidates: curatedPhysicalApplication.candidates,
    manifest: curatedManifest,
    bundle: input.bundle,
    fixedCarriers: curatedFixedMusicBrainzCarriers,
  });
  const akinaFixedMusicBrainzCarrierApplication = applyAkinaFixedMusicBrainzCarrierEvidence({
    candidates: curatedMusicBrainzCarrierApplication,
    manifest: curatedManifest,
    carriers: akinaFixedMusicBrainzCarriers,
  });
  const akinaCarrierApplication = applyAkinaDiscogsCarrierEvidence({
    candidates: akinaFixedMusicBrainzCarrierApplication,
    manifest: curatedManifest,
    rows: discogsSearch.rows,
  });
  const akinaRecoveryApplication = applyAkinaNakamoriOfficialRecovery({
    candidates: akinaCarrierApplication,
    manifest: curatedManifest,
    recovery: akinaRecovery,
  });
  const mihoCarrierApplication = applyMihoNakayamaKingCarrierEvidence({
    candidates: akinaRecoveryApplication.candidates,
    manifest: curatedManifest,
    box: mihoKingCarrier,
    mellow: mihoMellowCd,
  });
  const momoeOfficialMatch = curatedManifest && momoeOfficialCatalog
    ? matchMomoeOfficialCatalogToCurated(curatedManifest, momoeOfficialCatalog)
    : null;
  const momoeOfficialApplication = applyMomoeOfficialEvidence({
    candidates: mihoCarrierApplication.candidates,
    manifest: curatedManifest,
    official: momoeOfficialMatch,
    stats,
  });
  const momoeCosmosCarrierApplication = applyMomoeCosmosSonyCarrierEvidence({
    candidates: momoeOfficialApplication.candidates,
    manifest: curatedManifest,
    carrier: momoeCosmosCarrier,
  });
  const momoeCarrierApplication = applyMomoeMusicBrainzCarrierEvidence({
    candidates: momoeCosmosCarrierApplication,
    manifest: curatedManifest,
    bundle: input.bundle,
    stats,
  });
  const seikoOfficialMatch = curatedManifest && seikoOfficialCatalog
    ? matchSeikoOfficial(curatedManifest, seikoOfficialCatalog)
    : null;
  const seikoOfficialApplication = applySeikoOfficialEvidence({
    candidates: momoeCarrierApplication,
    manifest: curatedManifest,
    official: seikoOfficialMatch,
    bundle: input.bundle,
    stats,
  });
  const seikoBoxCandidates = applySeikoSonyBoxCarrierEvidence({
    candidates: seikoOfficialApplication.candidates,
    manifest: curatedManifest,
    official: seikoOfficialCatalog,
  });
  const seikoRecoveryApplication = applySeikoMatsudaRecoveryEvidence({
    candidates: seikoBoxCandidates,
    manifest: curatedManifest,
    recovery: seikoRecovery,
  });
  const allCandidates = seikoRecoveryApplication.candidates;
  await input.onProgress?.({
    stage: "SOURCE_FETCH",
    processed: stats.curatedPhysicalMatchedWorks,
    total: curatedManifest?.works.filter((work) =>
      curatedWorkScopeDecision(work, input.request.target).verdict === "PASS").length ?? 0,
  });
  const scoped = allCandidates.filter(isScopeResearchable).slice(0, limits.maxScopeCandidates);
  stats.scopeCandidates = scoped.length;
  await input.onProgress?.({ stage: "SOURCE_FETCH", processed: scoped.length, total: scoped.length });

  let enrichedScope = await enrichWithNdl(
    breadthFirstByWork(scoped),
    inventory,
    ndl,
    artist,
    limits.maxNdlCatalogLookups,
    stats,
    input.onProgress,
  );
  enrichedScope = applyAkinaFixedNdlCarrierEvidence(enrichedScope, curatedManifest);
  enrichedScope = enrichWithNdlSingleManifest(enrichedScope, ndlSingleManifests, stats);
  enrichedScope = enrichWithOfficial(enrichedScope, official, officialIds, stats);
  const discogsEnrichment = enrichWithDiscogs(
    enrichedScope,
    discogsSearch,
    input.request,
    limits.maxDiscogsRowsPerCandidate,
    stats,
  );
  const enrichedById = new Map(discogsEnrichment.candidates.map((candidate) => [
    candidate.candidate.id,
    candidate,
  ]));
  const candidates = allCandidates.map((candidate) => enrichedById.get(candidate.candidate.id) ?? candidate);
  await input.onProgress?.({ stage: "SOURCE_MERGE", processed: candidates.length, total: candidates.length });
  const refreshDiscogsRows = discogsSearch.retryable
    ? async () => {
        const refreshed = await searchDiscogsSources(
          discogs,
          discogsQueries,
          limits,
          stats,
        );
        const rows = new Map(candidates.map((candidate) => [
          candidate.candidate.id,
          discogsRowsForCover(candidate, candidates, refreshed.rows)
            .slice(0, limits.maxDiscogsRowsPerCandidate),
        ]));
        return { rows, retryable: refreshed.retryable };
      }
    : undefined;
  const recoveredOfficialCoversByWorkId = new Map<string, {
    url: string;
    sourceUrl: string;
    auditedAsset?: {
      mime: "image/gif" | "image/jpeg" | "image/png";
      width: number;
      height: number;
      sha256: string;
      allowContentTypeMismatch?: boolean;
    };
  }>([
    ...seikoRecoveryApplication.coversByWorkId,
    ...akinaRecoveryApplication.coversByWorkId,
  ]);
  const lookupValidatedCover = createCoverLookup(
    candidates,
    discogsEnrichment.matches,
    itunes,
    {
      discogs,
      musicMetadata,
      validate,
      now,
      maxDiscogsDetails: limits.maxDiscogsCoverDetailsPerCandidate,
      minimumItunesArtistCollections: limits.minimumItunesArtistCollections,
      maxItunesTitleLookups: limits.maxItunesTitleLookups,
      soundFujiCoversByWorkId: soundFuji.coversByWorkId,
      momoeOfficialCoversByWorkId: momoeOfficialApplication.coversByWorkId,
      seikoOfficialCoversByWorkId: seikoOfficialApplication.coversByWorkId,
      recoveredOfficialCoversByWorkId,
      curatedDiscogsBindingsByWorkId: curatedPhysicalApplication.bindingsByWorkId,
      searchItunesByArtist: searchItunes,
      searchItunesByTitle,
      artistQuery: artist.primary,
      refreshDiscogsRows,
      country: input.request.country,
      stats,
    },
  );
  return { candidates, lookupValidatedCover, sourceStats: stats };
}
