import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
  summarizeComprehensiveDiscography,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
  type ComprehensiveDiscographyOutput,
} from "../src/lib/ai/comprehensive-discography";
import {
  buildComprehensiveReleaseResearchResult,
  hasCanonicalLegacySelectionScopeConclusion,
  mergeComprehensiveEvidenceSources,
  reconcileLegacyVerifiedCandidateForOfflineRematerialization,
} from "../src/lib/ai/comprehensive-release-result";
import { parseReleaseResearchRequest } from "../src/lib/ai/release-research-input";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchCandidateAudit,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "../src/lib/ai/release-research-types";
import { persistResearchLedgerInTransaction } from "../src/lib/ai/research-ledger-persistence";
import { acquireResearchLedgerTaskLock } from "../src/lib/ai/research-task-lock";
import {
  parsePersistedSchemaV2CandidateState,
  sanitizeScheduledCoverRetryError,
} from "../src/lib/ai/scheduled-cover-retry";
import { prisma } from "../src/lib/db/prisma";
import type { ArtistReleaseEvidenceBundle } from "../src/lib/music-metadata/types";
import { SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS } from "../src/lib/official-music/seiko-matsuda";

export const OFFLINE_REMATERIALIZATION_POLICY_VERSION =
  "multi-source-v2-selection-legacy-quarantine-seiko-source-snapshot-2026-07-13";

const MAX_TASK_IDS = 64;
const taskSelect = {
  id: true,
  request: true,
  pipelineVersion: true,
  resultSchemaVersion: true,
  status: true,
  rawResult: true,
  parsedResult: true,
  completedAt: true,
  updatedAt: true,
  importedAt: true,
  candidates: {
    orderBy: { candidateKey: "asc" as const },
    select: {
      candidateKey: true,
      payload: true,
      coverStatus: true,
      releaseId: true,
    },
  },
} satisfies Prisma.AiSearchTaskSelect;

export type PersistedDiscographyTask = Prisma.AiSearchTaskGetPayload<{
  select: typeof taskSelect;
}>;

export type RematerializeDiscographyTaskOptions = {
  taskIds: string[];
};

export type OfflineDiscographyRematerialization = {
  taskId: string;
  changed: boolean;
  request: ReleaseResearchRequest;
  results: ComprehensiveCandidateResult[];
  sourceCandidates: ComprehensiveDiscographyCandidate[];
  output: ComprehensiveDiscographyOutput;
  parsedResult: ReleaseResearchResult;
  rawResult: Record<string, unknown>;
  quarantinedCoverCandidateIds: string[];
  quarantinedPhysicalIdentityCandidateIds: string[];
  normalizedLegacySeikoSourceCandidateIds: string[];
};

type RematerializationEvent = {
  event: "offline-discography-rematerialization";
  taskId: string;
  changed: boolean;
  candidates: number;
  verified: number;
  pendingEvidence: number;
  pendingCover: number;
  rejected: number;
  outOfScope: number;
  releases: number;
  quarantinedCover: number;
  quarantinedPhysicalIdentity: number;
  normalizedLegacySeikoSourceCandidateIds: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

const legacySeikoSourceIdentityFields = [
  "id",
  "title",
  "titleOriginal",
  "category",
  "artistCredit",
  "releaseDate",
  "originalReleaseDate",
  "format",
  "catalogNumber",
  "barcode",
  "label",
  "editionType",
  "isReissue",
  "isRemaster",
  "isExcludedByDefault",
] as const;

type LegacySeikoSourceSnapshotRule = {
  candidateKey: string;
  workId: string;
  editionId: string;
  officialUrl: string;
  legacyOfficialTitle: string | null;
  musicBrainzReleaseGroupId: string | null;
  legacySourcesSha256: string;
  targetSourcesSha256: string;
};

export type LegacySeikoSourceSnapshotFingerprint = Pick<
  LegacySeikoSourceSnapshotRule,
  "legacySourcesSha256" | "targetSourcesSha256"
>;

const legacySeikoRecoverySourceTitle = "\u677e\u7530\u8056\u5b50 official entity";
const legacySeikoSourceSnapshotRules = [
  {
    candidateKey: "curated-seiko-matsuda-single-22",
    workId: "curated-official-manifest:seiko-matsuda:SINGLE:22",
    editionId: "curated-official-manifest:seiko-matsuda:representation:SINGLE:22",
    officialUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:22"],
    legacyOfficialTitle: null,
    musicBrainzReleaseGroupId: "19eace7b-472f-4623-8c5e-f668f20d17b2",
    legacySourcesSha256: "16415aecb14ea51d8f1d29dce922d929a03a16882ad4d58f0ee6e03b7535b379",
    targetSourcesSha256: "e4916955eb4e755c14c66e544e2465e22d7611a7bfe8d19c1c83c32fd9753a69",
  },
  {
    candidateKey: "curated-seiko-matsuda-single-29",
    workId: "curated-official-manifest:seiko-matsuda:SINGLE:29",
    editionId: "curated-official-manifest:seiko-matsuda:representation:SINGLE:29",
    officialUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:29"],
    legacyOfficialTitle: null,
    musicBrainzReleaseGroupId: null,
    legacySourcesSha256: "16415aecb14ea51d8f1d29dce922d929a03a16882ad4d58f0ee6e03b7535b379",
    targetSourcesSha256: "9b192c343730064101b5d435bfe14b9325d237f44a1c214cce38f4ffe49011fe",
  },
  {
    candidateKey: "curated-seiko-matsuda-single-71",
    workId: "curated-official-manifest:seiko-matsuda:SINGLE:71",
    editionId: "curated-official-manifest:seiko-matsuda:representation:SINGLE:71",
    officialUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:71"],
    legacyOfficialTitle: legacySeikoRecoverySourceTitle,
    musicBrainzReleaseGroupId: "a7115395-0a0e-4c6a-8f3e-7e3177af923c",
    legacySourcesSha256: "bb6e8d944c94f47302736d90b0f460d08db24d74cc03e2e81785cd3bb81e46f7",
    targetSourcesSha256: "8cf63e1b7184fcd4cd3f8e71b284384787c0ec0ce182204566e6dc89fc84c638",
  },
  {
    candidateKey: "curated-seiko-matsuda-original_album-29",
    workId: "curated-official-manifest:seiko-matsuda:ORIGINAL_ALBUM:29",
    editionId:
      "curated-official-manifest:seiko-matsuda:representation:ORIGINAL_ALBUM:29",
    officialUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["ORIGINAL_ALBUM:29"],
    legacyOfficialTitle: null,
    musicBrainzReleaseGroupId: "ca0a9735-b047-4857-8086-6926a5b5c695",
    legacySourcesSha256: "6049206871bb9b6ca1e5820660c23476c3cbe19ca2c8c8de4ea64146e385a408",
    targetSourcesSha256: "7b3038325535194cac0d32ddb21db1dfe6046778274ba7f201d17a8006116f57",
  },
  {
    candidateKey: "curated-seiko-matsuda-original_album-35",
    workId: "curated-official-manifest:seiko-matsuda:ORIGINAL_ALBUM:35",
    editionId:
      "curated-official-manifest:seiko-matsuda:representation:ORIGINAL_ALBUM:35",
    officialUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["ORIGINAL_ALBUM:35"],
    legacyOfficialTitle: legacySeikoRecoverySourceTitle,
    musicBrainzReleaseGroupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
    legacySourcesSha256: "f7177a3f2dc23ad5160161ebec26241641b5253b56e2a3bf66b9c3e7f175cb7b",
    targetSourcesSha256: "341e17aa8424c359abc145acffb1694e427326476abc3ecf944654725e08a80e",
  },
] as const satisfies readonly LegacySeikoSourceSnapshotRule[];

const legacySeikoSourceSnapshotRuleByCandidateId = new Map<
  string,
  LegacySeikoSourceSnapshotRule
>(
  legacySeikoSourceSnapshotRules.map((rule) => [rule.candidateKey, rule]),
);

function normalizedIdentityValue(value: unknown) {
  return value === undefined ? null : value;
}

function exactSource(
  title: string,
  url: string,
  sourceType: "official" | "database",
) {
  return { title, url, sourceType };
}

function sourceArraySha256(sources: unknown) {
  return createHash("sha256").update(canonicalJson(sources)).digest("hex");
}

export function legacySeikoSourceSnapshotFingerprintForTesting(
  legacySources: unknown,
  targetSources: unknown,
): LegacySeikoSourceSnapshotFingerprint {
  return {
    legacySourcesSha256: sourceArraySha256(legacySources),
    targetSourcesSha256: sourceArraySha256(targetSources),
  };
}

function exactPassLedgerEntry(
  result: ComprehensiveCandidateResult,
  stage: string,
  reasonCode: string,
  sourceUrl: string,
) {
  const matching = result.ledger.filter((entry) =>
    entry.stage === stage && entry.reasonCode === reasonCode);
  return matching.length === 1 &&
    matching[0]!.verdict === "PASS" &&
    canonicalJson(matching[0]!.sourceUrls) === canonicalJson([sourceUrl]) &&
    matching[0]!.retryable === false &&
    matching[0]!.conflictIds.length === 0;
}

function hasExactLegacySeikoMusicBrainzBinding(
  result: ComprehensiveCandidateResult,
  evidence: ArtistReleaseEvidenceBundle,
  releaseGroupId: string,
) {
  // Three of the five fixed historical rows stored the targeted release only
  // in the PASS ledger and raw work/edition evidence, not in candidate.sources.
  // Do not invent that missing source here. The old published release is still
  // checked below against mergeComprehensiveEvidenceSources, which must add
  // this exact ledger URL with its canonical source metadata before any state
  // is accepted or rewritten.
  const releaseGroupUrl = `https://musicbrainz.org/release-group/${releaseGroupId}`;
  const musicBrainzPasses = result.ledger.filter((entry) =>
    entry.stage === "MUSICBRAINZ" &&
    entry.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY");
  if (
    musicBrainzPasses.length !== 1 ||
    musicBrainzPasses[0]!.verdict !== "PASS" ||
    musicBrainzPasses[0]!.sourceUrls.length !== 1 ||
    musicBrainzPasses[0]!.retryable ||
    musicBrainzPasses[0]!.conflictIds.length !== 0
  ) {
    return false;
  }
  const releaseUrl = musicBrainzPasses[0]!.sourceUrls[0]!;
  const releaseMatch = releaseUrl.match(
    /^https:\/\/musicbrainz\.org\/release\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u,
  );
  if (!releaseMatch || !Array.isArray(evidence.works)) return false;
  const releaseId = releaseMatch[1]!;
  const exactWorks = evidence.works.filter((work) =>
    work.workId === releaseGroupId &&
    work.releaseGroup?.entityType === "release-group" &&
    work.releaseGroup.sourceId === releaseGroupId &&
    work.releaseGroup.releaseGroupId === releaseGroupId &&
    work.releaseGroup.sourceUrl === releaseGroupUrl);
  if (exactWorks.length !== 1) return false;

  const occurrences = evidence.works.flatMap((work) =>
    work.editions.map((edition) => ({ work, edition })))
    .filter(({ edition }) =>
      edition.evidence.sourceId === releaseId ||
      edition.evidence.sourceUrl === releaseUrl);
  return occurrences.length === 1 &&
    occurrences[0]!.work === exactWorks[0] &&
    occurrences[0]!.edition.workId === releaseGroupId &&
    occurrences[0]!.edition.evidence.entityType === "release" &&
    occurrences[0]!.edition.evidence.sourceId === releaseId &&
    occurrences[0]!.edition.evidence.releaseGroupId === releaseGroupId &&
    occurrences[0]!.edition.evidence.sourceUrl === releaseUrl;
}

function matchesExactLegacySeikoSourceSnapshot(
  candidateKey: string,
  payload: Record<string, unknown>,
  evidence: ArtistReleaseEvidenceBundle,
  rule: LegacySeikoSourceSnapshotRule,
  fingerprint: LegacySeikoSourceSnapshotFingerprint,
) {
  const resultCandidate = record(payload.candidate);
  const sourceCandidate = record(payload.sourceCandidate);
  const sourceRelease = record(sourceCandidate?.candidate);
  if (
    payload.schemaVersion !== 2 ||
    payload.resolution !== "VERIFIED" ||
    !resultCandidate ||
    !sourceCandidate ||
    !sourceRelease ||
    candidateKey !== rule.candidateKey ||
    resultCandidate.id !== candidateKey ||
    payload.externalWorkId !== rule.workId ||
    payload.externalEditionId !== rule.editionId ||
    sourceCandidate.workId !== rule.workId ||
    sourceCandidate.editionId !== rule.editionId ||
    !Array.isArray(sourceCandidate.observations) ||
    !Array.isArray(sourceCandidate.conflicts) ||
    !Array.isArray(payload.ledger) ||
    !legacySeikoSourceIdentityFields.every((field) =>
      canonicalJson(normalizedIdentityValue(resultCandidate[field])) ===
        canonicalJson(normalizedIdentityValue(sourceRelease[field]))) ||
    !Array.isArray(resultCandidate.sources) ||
    !Array.isArray(sourceRelease.sources)
  ) {
    return false;
  }

  const resultSources = resultCandidate.sources.map(record);
  const legacySources = sourceRelease.sources.map(record);
  if (resultSources.some((source) => !source) || legacySources.some((source) => !source)) {
    return false;
  }
  const typedResultSources = resultSources as Record<string, unknown>[];
  const typedLegacySources = legacySources as Record<string, unknown>[];
  const resultUrls = typedResultSources.map((source) => nonBlankString(source.url));
  const legacyUrls = typedLegacySources.map((source) => nonBlankString(source.url));
  if (
    resultUrls.some((url) => !url) ||
    legacyUrls.some((url) => !url) ||
    new Set(resultUrls).size !== resultUrls.length ||
    new Set(legacyUrls).size !== legacyUrls.length ||
    !legacyUrls.every((url) => resultUrls.includes(url))
  ) {
    return false;
  }

  if (
    sourceArraySha256(typedLegacySources) !== fingerprint.legacySourcesSha256 ||
    sourceArraySha256(typedResultSources) !== fingerprint.targetSourcesSha256
  ) {
    return false;
  }

  const result = {
    candidate: resultCandidate as unknown as ComprehensiveCandidateResult["candidate"],
    workId: rule.workId,
    editionId: rule.editionId,
    resolution: payload.resolution as ComprehensiveCandidateResult["resolution"],
    evidenceVerdict: payload.evidenceVerdict as ComprehensiveCandidateResult["evidenceVerdict"],
    aiDecision: payload.aiDecision as ComprehensiveCandidateResult["aiDecision"],
    cover: payload.cover as ComprehensiveCandidateResult["cover"],
    ledger: payload.ledger as ComprehensiveCandidateResult["ledger"],
  } satisfies ComprehensiveCandidateResult;
  const legacyByUrl = new Map(typedLegacySources.map((source) => [source.url, source]));
  const expectedOfficialSource = exactSource(
    "Seiko Matsuda official work entity",
    rule.officialUrl,
    "official",
  );
  const legacyOfficialSource = legacyByUrl.get(rule.officialUrl);
  if (rule.legacyOfficialTitle === null) {
    if (legacyOfficialSource) return false;
  } else if (
    canonicalJson(legacyOfficialSource) !== canonicalJson(exactSource(
      rule.legacyOfficialTitle,
      rule.officialUrl,
      "official",
    ))
  ) {
    return false;
  }

  const additions: Record<string, unknown>[] = [expectedOfficialSource];
  if (rule.musicBrainzReleaseGroupId) {
    const releaseGroupUrl =
      `https://musicbrainz.org/release-group/${rule.musicBrainzReleaseGroupId}`;
    if (legacyByUrl.has(releaseGroupUrl)) return false;
    additions.push(exactSource(
      "MusicBrainz release group",
      releaseGroupUrl,
      "database",
    ));
    if (!hasExactLegacySeikoMusicBrainzBinding(
      {
        candidate: resultCandidate as unknown as ComprehensiveCandidateResult["candidate"],
        workId: rule.workId,
        editionId: rule.editionId,
        resolution: payload.resolution as ComprehensiveCandidateResult["resolution"],
        evidenceVerdict: payload.evidenceVerdict as ComprehensiveCandidateResult["evidenceVerdict"],
        aiDecision: payload.aiDecision as ComprehensiveCandidateResult["aiDecision"],
        cover: payload.cover as ComprehensiveCandidateResult["cover"],
        ledger: payload.ledger as ComprehensiveCandidateResult["ledger"],
      },
      evidence,
      rule.musicBrainzReleaseGroupId,
    )) {
      return false;
    }
  }

  const expectedResultSources = [...new Map([
    ...typedLegacySources,
    ...additions,
  ].map((source) => [source.url, source])).values()];
  if (canonicalJson(typedResultSources) !== canonicalJson(expectedResultSources)) {
    return false;
  }

  const discovery = result.ledger.filter((entry) =>
    entry.stage === "DISCOVERY" && entry.reasonCode === "CANDIDATE_DISCOVERED");
  return discovery.length === 1 &&
    discovery[0]!.verdict === "PASS" &&
    canonicalJson(discovery[0]!.sourceUrls) === canonicalJson(resultUrls) &&
    discovery[0]!.retryable === false &&
    discovery[0]!.conflictIds.length === 0 &&
    exactPassLedgerEntry(
      result,
      "AUTHORITATIVE",
      "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
      rule.officialUrl,
    ) &&
    exactPassLedgerEntry(
      result,
      "COVER",
      "VALIDATED_WORK_COVER_FOUND",
      rule.officialUrl,
    ) &&
    record(result.cover)?.status === "FOUND" &&
    record(result.cover)?.sourceUrl === rule.officialUrl &&
    resultCandidate.coverImageSourceUrl === rule.officialUrl;
}

export function normalizeLegacySeikoSourceCandidateSnapshots(
  candidates: PersistedDiscographyTask["candidates"],
  evidence: ArtistReleaseEvidenceBundle,
  testOnlyFingerprints?: ReadonlyMap<string, LegacySeikoSourceSnapshotFingerprint>,
) {
  const normalizedCandidateIds: string[] = [];
  const normalizedCandidates = candidates.map((candidate) => {
    const rule = legacySeikoSourceSnapshotRuleByCandidateId.get(candidate.candidateKey);
    const payload = record(candidate.payload);
    const resultCandidate = record(payload?.candidate);
    const sourceCandidate = record(payload?.sourceCandidate);
    const sourceRelease = record(sourceCandidate?.candidate);
    if (
      !rule ||
      !payload ||
      !resultCandidate ||
      !sourceCandidate ||
      !sourceRelease ||
      canonicalJson(resultCandidate.sources) === canonicalJson(sourceRelease.sources) ||
      !matchesExactLegacySeikoSourceSnapshot(
        candidate.candidateKey,
        payload,
        evidence,
        rule,
        testOnlyFingerprints?.get(candidate.candidateKey) ?? rule,
      )
    ) {
      return candidate;
    }
    normalizedCandidateIds.push(candidate.candidateKey);
    return {
      ...candidate,
      payload: {
        ...payload,
        sourceCandidate: {
          ...sourceCandidate,
          candidate: {
            ...sourceRelease,
            sources: resultCandidate.sources,
          },
        },
      } as Prisma.JsonValue,
    };
  });
  return { normalizedCandidates, normalizedCandidateIds };
}

function priorNormalizedLegacySeikoSourceCandidateIds(
  rawResult: Record<string, unknown>,
  candidateIds: ReadonlySet<string>,
) {
  const prior = record(rawResult.offlineRematerialization)
    ?.normalizedLegacySeikoSourceCandidateIds;
  if (prior === undefined) return [];
  if (
    !Array.isArray(prior) ||
    prior.some((candidateId) =>
      typeof candidateId !== "string" ||
      !legacySeikoSourceSnapshotRuleByCandidateId.has(candidateId) ||
      !candidateIds.has(candidateId)) ||
    new Set(prior).size !== prior.length
  ) {
    throw new TypeError(
      "The persisted legacy Seiko source-snapshot audit is invalid.",
    );
  }
  return [...prior].sort((left, right) => left.localeCompare(right));
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isReleaseResearchResult(value: unknown): value is ReleaseResearchResult {
  const candidate = record(value);
  const artist = record(candidate?.artist);
  const scope = record(candidate?.collectionScope);
  return candidate?.pipelineVersion === "multi-source-v2" &&
    Boolean(nonBlankString(artist?.name)) &&
    Boolean(scope) &&
    Array.isArray(candidate?.releases) &&
    Array.isArray(candidate?.verificationCandidates) &&
    Array.isArray(candidate?.globalWarnings);
}

function isEvidenceBundle(value: unknown): value is ArtistReleaseEvidenceBundle {
  const candidate = record(value);
  const query = record(candidate?.query);
  const stats = record(candidate?.stats);
  const numericStats = [
    stats?.artistResultsInspected,
    stats?.releasesFetched,
    stats?.releasesAcceptedBeforeGrouping,
    stats?.releasesAccepted,
    stats?.coverLookups,
  ];
  return Boolean(query) &&
    Boolean(nonBlankString(query?.artistName)) &&
    Boolean(nonBlankString(query?.targetCountry)) &&
    ["ORIGINAL_CD", "ALL_CD", "ALL_PHYSICAL"].includes(String(query?.target)) &&
    Array.isArray(candidate?.releases) &&
    Array.isArray(candidate?.sourceWhitelist) &&
    Array.isArray(candidate?.warnings) &&
    Boolean(stats) &&
    numericStats.every((value) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function assertScopeMatchesRequest(
  request: ReleaseResearchRequest,
  parsed: ReleaseResearchResult,
  evidence: ArtistReleaseEvidenceBundle,
) {
  if (
    parsed.collectionScope.target !== request.target ||
    parsed.collectionScope.excludeReissues !== request.excludeReissues ||
    parsed.collectionScope.includeCollaborations !== request.includeCollaborations ||
    evidence.query.target !== request.target
  ) {
    throw new TypeError("The persisted request, result, and evidence scopes do not match.");
  }
}

function assertAuditMatchesResult(
  audit: ReleaseResearchCandidateAudit,
  result: ComprehensiveCandidateResult,
) {
  const canonicalSelectionConclusion = {
    stage: "SELECTION",
    verdict: "OUT_OF_SCOPE",
    reasonCode: "LATER_EDITION_NOT_SELECTED",
    message:
      "The edition remains in the audit ledger but the requested scope keeps one verified edition per work.",
    sourceUrls: [],
    retryable: false,
    conflictIds: [],
  };
  const ledgerPrefixMatches = audit.ledger.length >= result.ledger.length &&
    result.ledger.every((entry, index) =>
      canonicalJson(entry) === canonicalJson(audit.ledger[index]));
  const directConclusionMatches =
    audit.resolution === result.resolution &&
    audit.evidenceVerdict === result.evidenceVerdict &&
    audit.ledger.length === result.ledger.length;
  const normalizedLegacySelectionConclusionMatches =
    result.resolution === "OUT_OF_SCOPE" &&
    result.evidenceVerdict === "OUT_OF_SCOPE" &&
    audit.resolution === "OUT_OF_SCOPE" &&
    audit.evidenceVerdict === "PASS" &&
    audit.ledger.length === result.ledger.length &&
    hasCanonicalLegacySelectionScopeConclusion(result);
  const selectionConclusionMatches =
    result.resolution === "VERIFIED" &&
    audit.resolution === "OUT_OF_SCOPE" &&
    audit.evidenceVerdict === "OUT_OF_SCOPE" &&
    audit.ledger.slice(result.ledger.length).length === 1 &&
    canonicalJson(audit.ledger[result.ledger.length]) ===
      canonicalJson(canonicalSelectionConclusion);
  if (
    audit.candidateId !== result.candidate.id ||
    audit.workId !== result.workId ||
    audit.editionId !== result.editionId ||
    audit.title !== result.candidate.title ||
    audit.category !== result.candidate.category ||
    audit.releaseDate !== result.candidate.releaseDate ||
    (audit.originalReleaseDate !== undefined &&
      audit.originalReleaseDate !== result.candidate.originalReleaseDate) ||
    audit.catalogNumber !== result.candidate.catalogNumber ||
    !ledgerPrefixMatches ||
    (!directConclusionMatches &&
      !normalizedLegacySelectionConclusionMatches &&
      !selectionConclusionMatches)
  ) {
    throw new TypeError("The persisted result audit is not identity-bound to its candidate payload.");
  }
}

function uniqueSortedStrings(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: readonly string[] | undefined, right: readonly string[]) {
  return Array.isArray(left) &&
    canonicalJson(uniqueSortedStrings(left)) === canonicalJson(uniqueSortedStrings(right));
}

function canonicalSourceSet(values: ReleaseResearchCandidate["sources"]) {
  return canonicalJson([...values].sort((left, right) =>
    left.url.localeCompare(right.url) ||
    left.title.localeCompare(right.title) ||
    left.sourceType.localeCompare(right.sourceType)));
}

const musicBrainzReleaseGroupUrlPattern =
  /^https:\/\/musicbrainz\.org\/release-group\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const musicBrainzReleaseUrlPattern =
  /^https:\/\/musicbrainz\.org\/release\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isUniqueStringArray(value: readonly string[] | undefined): value is readonly string[] {
  return Array.isArray(value) && new Set(value).size === value.length;
}

function matchesExactLegacyMusicBrainzReleaseGroupVerification(
  release: ReleaseResearchCandidate,
  result: ComprehensiveCandidateResult,
  expectedCorroboratingSourceUrls: readonly string[],
  expectedSourceUrls: readonly string[],
) {
  const verification = release.verification;
  if (
    !verification ||
    !isUniqueStringArray(verification.corroboratingSourceUrls) ||
    !isUniqueStringArray(verification.sourceUrls)
  ) {
    return false;
  }
  const expectedCorroborating = new Set(expectedCorroboratingSourceUrls);
  const expectedSources = new Set(expectedSourceUrls);
  const corroboratingExtras = verification.corroboratingSourceUrls
    .filter((url) => !expectedCorroborating.has(url));
  const sourceExtras = verification.sourceUrls
    .filter((url) => !expectedSources.has(url));
  if (
    verification.corroboratingSourceUrls.length !==
      expectedCorroboratingSourceUrls.length + 1 ||
    verification.sourceUrls.length !== expectedSourceUrls.length + 1 ||
    !expectedCorroboratingSourceUrls.every((url) =>
      verification.corroboratingSourceUrls!.includes(url)) ||
    !expectedSourceUrls.every((url) => verification.sourceUrls.includes(url)) ||
    corroboratingExtras.length !== 1 ||
    sourceExtras.length !== 1 ||
    corroboratingExtras[0] !== sourceExtras[0]
  ) {
    return false;
  }
  const releaseGroupUrl = corroboratingExtras[0]!;
  const releaseGroupMatch = releaseGroupUrl.match(musicBrainzReleaseGroupUrlPattern);
  if (!releaseGroupMatch) return false;
  const releaseGroupId = releaseGroupMatch[1]!;
  const exactGroupSource = result.candidate.sources.some((source) =>
    source.title === "MusicBrainz release group" &&
    source.url === releaseGroupUrl &&
    source.sourceType === "database");
  const exactReleaseSource = result.ledger.some((entry) => {
    if (
      entry.stage !== "MUSICBRAINZ" ||
      entry.verdict !== "PASS" ||
      entry.sourceUrls.length !== 1 ||
      !musicBrainzReleaseUrlPattern.test(entry.sourceUrls[0]!)
    ) {
      return false;
    }
    const releaseUrl = entry.sourceUrls[0]!;
    return result.candidate.sources.some((source) =>
      source.title === "MusicBrainz release" &&
      source.url === releaseUrl &&
      source.sourceType === "database");
  });
  return exactGroupSource &&
    exactReleaseSource &&
    (
      result.workId === releaseGroupId ||
      result.workId === `musicbrainz-release-group:${releaseGroupId}`
    );
}

function boundIsoTimestamp(
  value: unknown,
  label: string,
  taskUpdatedAt: Date,
) {
  if (typeof value !== "string") {
    throw new TypeError(`The persisted result contains no ${label} timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`The persisted result contains an invalid ${label} timestamp.`);
  }
  if (parsed.getTime() > taskUpdatedAt.getTime()) {
    throw new TypeError(`The persisted result contains a future ${label} timestamp.`);
  }
  return parsed;
}

const publishedIdentityFields = [
  "id",
  "title",
  "titleOriginal",
  "category",
  "artistCredit",
  "releaseDate",
  "originalReleaseDate",
  "format",
  "catalogNumber",
  "barcode",
  "label",
  "originalPrice",
  "editionType",
  "isReissue",
  "isRemaster",
  "isExcludedByDefault",
  "coverImageUrl",
  "coverImageSourceUrl",
  "notes",
  "confidence",
  "warnings",
] as const;

function assertPublishedReleaseMatchesResult(
  release: ReleaseResearchCandidate,
  result: ComprehensiveCandidateResult,
  taskUpdatedAt: Date,
  options: { allowLegacyMusicBrainzReleaseGroup: boolean },
) {
  const verification = release.verification;
  const cover = result.cover;
  const authoritySourceUrls = uniqueSortedStrings(result.ledger
    .filter((entry) => entry.stage === "AUTHORITATIVE" && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const corroboratingSourceUrls = uniqueSortedStrings(result.ledger
    .filter((entry) =>
      ["MUSICBRAINZ", "CORROBORATION"].includes(entry.stage) && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const verificationSourceUrls = uniqueSortedStrings([
    ...authoritySourceUrls,
    ...corroboratingSourceUrls,
  ]);
  const expectedReleaseSources = mergeComprehensiveEvidenceSources(
    result.candidate,
    result,
  );
  const expectedMatchedFields = uniqueSortedStrings([
    "artist",
    "title",
    ...(result.candidate.releaseDate ? ["date"] : []),
    ...(result.candidate.catalogNumber ? ["catalogNumber"] : []),
    ...(result.candidate.barcode ? ["barcode"] : []),
    ...(result.candidate.format ? ["format"] : []),
  ]);
  const exactVerificationSources =
    sameStringSet(verification?.corroboratingSourceUrls, corroboratingSourceUrls) &&
    sameStringSet(verification?.sourceUrls, verificationSourceUrls);
  const exactLegacyMusicBrainzSources =
    options.allowLegacyMusicBrainzReleaseGroup &&
    matchesExactLegacyMusicBrainzReleaseGroupVerification(
      release,
      result,
      corroboratingSourceUrls,
      verificationSourceUrls,
    );
  if (
    result.resolution !== "VERIFIED" ||
    !cover || cover.status !== "FOUND" ||
    !publishedIdentityFields.every((field) =>
      canonicalJson(release[field]) === canonicalJson(result.candidate[field])) ||
    release.workId !== result.workId ||
    release.editionId !== result.editionId ||
    !verification ||
    verification.status !== "VERIFIED" ||
    verification.method !== "multi-source-v2" ||
    verification.policyVersion !== "multi-source-v2" ||
    verification.aiDecision !== "ACCEPT" ||
    verification.aiReason !== result.aiDecision?.reason ||
    verification.workId !== result.workId ||
    verification.editionId !== result.editionId ||
    verification.coverProvider !== cover.provider ||
    verification.coverMatchLevel !== cover.coverMatchLevel ||
    verification.sourceReleaseDate !== cover.sourceReleaseDate ||
    (verification.coverContentSha256 ?? null) !== (cover.contentSha256 ?? null) ||
    !sameStringSet(verification.matchedFields, expectedMatchedFields) ||
    !sameStringSet(verification.authoritySourceUrls, authoritySourceUrls) ||
    (!exactVerificationSources && !exactLegacyMusicBrainzSources) ||
    canonicalSourceSet(release.sources) !== canonicalSourceSet(expectedReleaseSources)
  ) {
    throw new TypeError("A published release is not completely bound to its verified persisted candidate.");
  }
  const checkedAt = boundIsoTimestamp(
    verification.checkedAt,
    "verification.checkedAt",
    taskUpdatedAt,
  );
  const expectedCoverCheckedAt = cover.checkedAt ?? checkedAt.toISOString();
  if (verification.coverCheckedAt !== expectedCoverCheckedAt) {
    throw new TypeError("A published release cover timestamp is not bound to its persisted cover result.");
  }
  boundIsoTimestamp(
    verification.coverCheckedAt,
    "verification.coverCheckedAt",
    taskUpdatedAt,
  );
}

function assertPersistedVerifiedCoverTimeline(
  result: ComprehensiveCandidateResult,
  taskUpdatedAt: Date,
) {
  if (result.resolution !== "VERIFIED" || result.cover?.status !== "FOUND" ||
      result.cover.checkedAt === undefined) {
    return;
  }
  boundIsoTimestamp(result.cover.checkedAt, "cover.checkedAt", taskUpdatedAt);
}

function stableAttestationDate(
  task: PersistedDiscographyTask,
  parsed: ReleaseResearchResult,
) {
  if (
    !task.completedAt ||
    Number.isNaN(task.completedAt.getTime()) ||
    Number.isNaN(task.updatedAt.getTime()) ||
    task.completedAt.getTime() > task.updatedAt.getTime()
  ) {
    throw new TypeError("A succeeded research task requires a valid bounded completion timestamp.");
  }
  const priorDates = new Map(parsed.releases.map((release) => [
    release.id,
    boundIsoTimestamp(
      release.verification?.checkedAt,
      "verification.checkedAt",
      task.updatedAt,
    ),
  ]));
  return (result: ComprehensiveCandidateResult) =>
    priorDates.get(result.candidate.id) ?? task.completedAt!;
}

function outputFromResults(
  results: readonly ComprehensiveCandidateResult[],
): ComprehensiveDiscographyOutput {
  const copied = [...results];
  return {
    results: copied,
    verifiedCandidates: copied
      .filter((result) => result.resolution === "VERIFIED")
      .map((result) => result.candidate),
    summary: summarizeComprehensiveDiscography(copied),
  };
}

export function parseRematerializeDiscographyTaskOptions(
  args: readonly string[],
): RematerializeDiscographyTaskOptions {
  const taskArguments = args.filter((argument) => argument.startsWith("--task-ids="));
  if (
    args.some((argument) => !argument.startsWith("--task-ids=")) ||
    taskArguments.length !== 1
  ) {
    throw new Error("Exactly one --task-ids option is required; no other options are allowed.");
  }
  const taskIds = [...new Set(taskArguments[0]!.slice("--task-ids=".length)
    .split(",")
    .map((taskId) => taskId.trim())
    .filter(Boolean))];
  if (taskIds.length === 0) throw new Error("--task-ids requires at least one task id.");
  if (taskIds.length > MAX_TASK_IDS) {
    throw new Error(`--task-ids accepts at most ${MAX_TASK_IDS} task ids.`);
  }
  if (taskIds.some((taskId) => !/^[a-z0-9_-]{8,128}$/iu.test(taskId))) {
    throw new Error("--task-ids contains an invalid task id.");
  }
  return { taskIds };
}

/**
 * Rebuild only the task's derived result and summary from complete persisted
 * candidate states. No adapter, fetch implementation, or model client is
 * reachable from this function. The only permitted state changes are the two
 * deterministic legacy VERIFIED quarantines and the exact Seiko source
 * snapshot normalization enforced below.
 */
export function prepareOfflineDiscographyRematerialization(
  task: PersistedDiscographyTask,
  testOnlyLegacySeikoSourceSnapshotFingerprints?: ReadonlyMap<
    string,
    LegacySeikoSourceSnapshotFingerprint
  >,
): OfflineDiscographyRematerialization {
  if (
    task.status !== "SUCCEEDED" ||
    task.pipelineVersion !== "multi-source-v2" ||
    task.resultSchemaVersion !== 2
  ) {
    throw new TypeError(
      "Only succeeded multi-source-v2 schema-v2 research tasks may be rematerialized.",
    );
  }
  if (!task.request) throw new TypeError("The research task has no persisted request.");
  const request = parseReleaseResearchRequest(task.request);
  if (!isReleaseResearchResult(task.parsedResult)) {
    throw new TypeError("The research task has no complete multi-source-v2 parsed result.");
  }
  const rawResult = record(task.rawResult);
  if (!rawResult || !isEvidenceBundle(rawResult.evidence)) {
    throw new TypeError("The research task has no complete persisted public evidence bundle.");
  }
  assertScopeMatchesRequest(request, task.parsedResult, rawResult.evidence);
  if (task.candidates.length === 0) {
    throw new TypeError("The research task has no persisted candidate states.");
  }
  if (task.candidates.some((candidate) => candidate.coverStatus === "CHECKING")) {
    throw new TypeError(
      "Offline rematerialization cannot run while a selected candidate cover is CHECKING.",
    );
  }

  const candidateKeySet = new Set(task.candidates.map((candidate) => candidate.candidateKey));
  const priorNormalizedLegacySeikoIds =
    priorNormalizedLegacySeikoSourceCandidateIds(rawResult, candidateKeySet);
  const normalizedIngress = normalizeLegacySeikoSourceCandidateSnapshots(
    task.candidates,
    rawResult.evidence,
    testOnlyLegacySeikoSourceSnapshotFingerprints,
  );
  if (normalizedIngress.normalizedCandidateIds.some((candidateId) =>
    priorNormalizedLegacySeikoIds.includes(candidateId))) {
    throw new TypeError(
      "A previously normalized legacy Seiko source snapshot became divergent again.",
    );
  }
  if (normalizedIngress.normalizedCandidateIds.length > 0 && task.importedAt) {
    throw new TypeError(
      "Offline rematerialization cannot normalize legacy Seiko sources in an already imported task.",
    );
  }
  for (const candidate of task.candidates) {
    if (
      normalizedIngress.normalizedCandidateIds.includes(candidate.candidateKey) &&
      candidate.releaseId
    ) {
      throw new TypeError(
        "Offline rematerialization cannot normalize legacy Seiko sources for a candidate already linked to a library release.",
      );
    }
  }
  const persistedStates = normalizedIngress.normalizedCandidates.map((candidate) =>
    parsePersistedSchemaV2CandidateState(candidate.payload, candidate.candidateKey));
  const persistedResults = persistedStates.map((state) => state.result);
  persistedResults.forEach((result) =>
    assertPersistedVerifiedCoverTimeline(result, task.updatedAt));
  const candidateIds = persistedResults.map((result) => result.candidate.id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("Persisted candidate states require unique candidate ids.");
  }

  // Validate the old public audit and any published release against the raw
  // persisted state before applying a quarantine correction. This prevents a
  // repair from hiding a pre-existing work/edition or audit identity mismatch.
  const auditById = new Map(task.parsedResult.verificationCandidates!
    .map((audit) => [audit.candidateId, audit]));
  if (
    auditById.size !== task.parsedResult.verificationCandidates!.length ||
    auditById.size !== persistedResults.length
  ) {
    throw new TypeError("The persisted result audit does not account for every candidate exactly once.");
  }
  for (const result of persistedResults) {
    const audit = auditById.get(result.candidate.id);
    if (!audit) {
      throw new TypeError("The persisted result audit is missing a candidate state.");
    }
    assertAuditMatchesResult(audit, result);
  }
  const persistedResultById = new Map(persistedResults.map((result) => [result.candidate.id, result]));
  const publishedReleaseIds = task.parsedResult.releases.map((release) => release.id);
  if (new Set(publishedReleaseIds).size !== publishedReleaseIds.length) {
    throw new TypeError("The persisted result contains duplicate published release ids.");
  }
  const directVerifiedAuditIds = task.parsedResult.verificationCandidates!
    .filter((audit) => audit.resolution === "VERIFIED")
    .map((audit) => audit.candidateId);
  if (
    canonicalJson(uniqueSortedStrings(publishedReleaseIds)) !==
      canonicalJson(uniqueSortedStrings(directVerifiedAuditIds))
  ) {
    throw new TypeError(
      "The published release set does not exactly match the direct VERIFIED audit candidates.",
    );
  }
  for (const release of task.parsedResult.releases) {
    const result = persistedResultById.get(release.id);
    if (!result) {
      throw new TypeError("A published release has no persisted candidate state.");
    }
    assertPublishedReleaseMatchesResult(release, result, task.updatedAt, {
      allowLegacyMusicBrainzReleaseGroup: true,
    });
  }

  const reconciled = persistedStates.map((state) =>
    reconcileLegacyVerifiedCandidateForOfflineRematerialization(
      state.result,
      state.sourceCandidate,
    ));
  const quarantineById = new Map(reconciled
    .filter((state) => state.quarantine !== null)
    .map((state) => [state.result.candidate.id, state.quarantine!]));
  if (quarantineById.size > 0 && task.importedAt) {
    throw new TypeError(
      "Offline rematerialization cannot quarantine candidates from an already imported task.",
    );
  }
  for (const candidate of task.candidates) {
    if (quarantineById.has(candidate.candidateKey) && candidate.releaseId) {
      throw new TypeError(
        "Offline rematerialization cannot quarantine a candidate already linked to a library release.",
      );
    }
  }
  const results = reconciled.map((state) => state.result);
  const sourceCandidates = reconciled.map((state) => state.sourceCandidate);
  const candidateStatesChanged = normalizedIngress.normalizedCandidateIds.length > 0 ||
    reconciled.some((state, index) =>
      canonicalJson(state.result) !== canonicalJson(persistedStates[index]!.result) ||
      canonicalJson(state.sourceCandidate) !== canonicalJson(persistedStates[index]!.sourceCandidate));
  const quarantinedCoverCandidateIds = results
    .filter((result) => result.resolution === "PENDING_COVER" && result.ledger.some((entry) =>
      entry.reasonCode === LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON))
    .map((result) => result.candidate.id);
  const quarantinedPhysicalIdentityCandidateIds = results
    .filter((result) => result.resolution === "PENDING_EVIDENCE" && result.ledger.some((entry) =>
      entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON))
    .map((result) => result.candidate.id);

  const beforeCandidateStates = canonicalJson(results);
  const output = outputFromResults(results);
  const parsedResult = buildComprehensiveReleaseResearchResult(
    request,
    task.parsedResult,
    rawResult.evidence,
    output,
    stableAttestationDate(task, task.parsedResult),
  );
  const nextResultById = new Map(results.map((result) => [result.candidate.id, result]));
  for (const release of parsedResult.releases) {
    const result = nextResultById.get(release.id);
    if (!result) {
      throw new TypeError("A rematerialized release has no persisted candidate state.");
    }
    assertPublishedReleaseMatchesResult(release, result, task.updatedAt, {
      allowLegacyMusicBrainzReleaseGroup: false,
    });
  }
  if (canonicalJson(results) !== beforeCandidateStates) {
    throw new TypeError("Offline rematerialization attempted to mutate persisted evidence conclusions.");
  }
  const normalizedLegacySeikoSourceCandidateIds = uniqueSortedStrings([
    ...priorNormalizedLegacySeikoIds,
    ...normalizedIngress.normalizedCandidateIds,
  ]);
  const nextRawResult = {
    ...rawResult,
    comprehensiveSummary: output.summary,
    verificationSummary: parsedResult.verificationSummary ?? null,
    offlineRematerialization: {
      policyVersion: OFFLINE_REMATERIALIZATION_POLICY_VERSION,
      source: "persisted-candidate-states",
      quarantinedCoverCandidateIds,
      quarantinedPhysicalIdentityCandidateIds,
      normalizedLegacySeikoSourceCandidateIds,
    },
  };
  return {
    taskId: task.id,
    changed: candidateStatesChanged ||
      canonicalJson(task.parsedResult) !== canonicalJson(parsedResult) ||
      canonicalJson(rawResult) !== canonicalJson(nextRawResult),
    request,
    results,
    sourceCandidates,
    output,
    parsedResult,
    rawResult: nextRawResult,
    quarantinedCoverCandidateIds,
    quarantinedPhysicalIdentityCandidateIds,
    normalizedLegacySeikoSourceCandidateIds,
  };
}

async function loadAndPrepareSelectedTasks(
  database: PrismaClient,
  taskIds: readonly string[],
) {
  const tasks = await database.aiSearchTask.findMany({
    where: { id: { in: [...taskIds] } },
    select: taskSelect,
  });
  if (tasks.length !== taskIds.length) {
    throw new TypeError("One or more explicitly selected research tasks do not exist.");
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return taskIds.map((taskId) => {
    const task = byId.get(taskId);
    if (!task) throw new TypeError("An explicitly selected research task is missing.");
    return prepareOfflineDiscographyRematerialization(task);
  });
}

export function eventFromPlan(plan: OfflineDiscographyRematerialization): RematerializationEvent {
  return {
    event: "offline-discography-rematerialization",
    taskId: plan.taskId,
    changed: plan.changed,
    candidates: plan.output.summary.totalCandidates,
    verified: plan.output.summary.verified,
    pendingEvidence: plan.output.summary.pendingEvidence,
    pendingCover: plan.output.summary.pendingCover,
    rejected: plan.output.summary.rejected,
    outOfScope: plan.output.summary.outOfScope,
    releases: plan.parsedResult.releases.length,
    quarantinedCover: plan.quarantinedCoverCandidateIds.length,
    quarantinedPhysicalIdentity: plan.quarantinedPhysicalIdentityCandidateIds.length,
    normalizedLegacySeikoSourceCandidateIds:
      plan.normalizedLegacySeikoSourceCandidateIds,
  };
}

export async function rematerializeDiscographyTasks(
  options: RematerializeDiscographyTaskOptions,
  database: PrismaClient = prisma,
  emit: (event: RematerializationEvent) => void = (event) => console.log(JSON.stringify(event)),
) {
  const activeResearch = await database.aiSearchTask.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (activeResearch > 0) {
    throw new TypeError("Offline rematerialization requires all active research tasks to finish first.");
  }

  // Validate the complete allowlist before making the first write. Each task is
  // validated again under its ledger advisory lock to close the race between
  // this fail-closed preflight and the transactional update.
  await loadAndPrepareSelectedTasks(database, options.taskIds);
  const events: RematerializationEvent[] = [];
  for (const taskId of options.taskIds) {
    const event = await database.$transaction(async (transaction) => {
      await acquireResearchLedgerTaskLock(transaction, taskId);
      const task = await transaction.aiSearchTask.findUnique({
        where: { id: taskId },
        select: taskSelect,
      });
      if (!task) throw new TypeError("An explicitly selected research task no longer exists.");
      const plan = prepareOfflineDiscographyRematerialization(task);
      if (plan.changed) {
        await persistResearchLedgerInTransaction(
          transaction,
          taskId,
          plan.results,
          plan.output.summary,
          {
            now: task.updatedAt,
            sourceCandidates: plan.sourceCandidates,
            clearPersistedCoverCandidateIds: new Set(plan.quarantinedCoverCandidateIds),
          },
        );
        await transaction.aiSearchTask.update({
          where: { id: taskId },
          data: {
            parsedResult: jsonValue(plan.parsedResult),
            rawResult: jsonValue(plan.rawResult),
          },
        });
      }
      return eventFromPlan(plan);
    }, { maxWait: 10_000, timeout: 120_000 });
    events.push(event);
    emit(event);
  }
  return events;
}

async function main() {
  await rematerializeDiscographyTasks(
    parseRematerializeDiscographyTaskOptions(process.argv.slice(2)),
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "offline-discography-rematerialization-fatal",
      errorType: error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/u.test(error.name)
        ? error.name
        : "Error",
      errorMessage: sanitizeScheduledCoverRetryError(error),
    }));
    process.exitCode = 1;
  });
}
