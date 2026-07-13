import "server-only";

import type { ReleaseCategory } from "@prisma/client";
import {
  auditComprehensiveEvidenceWithAi,
  classifyComprehensiveEvidence,
  deterministicComprehensiveEvidenceDecision,
  requiresComprehensiveAiAudit,
  validateComprehensiveAiDecisions,
  type ComprehensiveAiDecision,
  type ComprehensiveEvidenceCandidate,
  type ComprehensiveEvidenceConflict,
  type ComprehensiveEvidenceObservation,
  type ComprehensiveEvidenceReadiness,
  type ComprehensiveEvidenceStage,
  type ComprehensiveEvidenceVerdict,
} from "@/lib/ai/comprehensive-evidence-audit";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import type { PersistedItunesEditionCoverBinding } from "@/lib/ai/itunes-enrichment";
import type {
  ArtistReleaseEditionEvidence,
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";

export type ComprehensiveCandidateResolution =
  | "VERIFIED"
  | "PENDING_EVIDENCE"
  | "PENDING_COVER"
  | "REJECTED"
  | "OUT_OF_SCOPE";

export const LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON =
  "LEGACY_VERIFIED_COVER_DATE_MISMATCH_QUARANTINED";
export const LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON =
  "LEGACY_VERIFIED_PHYSICAL_IDENTITY_INCOMPLETE_QUARANTINED";

export type ComprehensiveLedgerEntry = {
  stage: ComprehensiveEvidenceStage;
  verdict: ComprehensiveEvidenceVerdict;
  reasonCode: string;
  message: string;
  sourceUrls: string[];
  retryable: boolean;
  conflictIds: string[];
};

export type ComprehensiveDiscographyCandidate = {
  candidate: ReleaseResearchCandidate;
  workId: string;
  editionId: string;
  observations: ComprehensiveEvidenceObservation[];
  conflicts: ComprehensiveEvidenceConflict[];
};

export type ComprehensiveCoverLookupResult =
  | {
      status: "FOUND";
      imageUrl: string;
      sourceUrl: string;
      provider: string;
      checkedAt?: string;
      /**
       * SHA-256 of the bytes downloaded during this validation. Persisted
       * legacy candidates may omit it; every new provider validation records it.
       */
      contentSha256?: string;
      coverMatchLevel: "EDITION" | "WORK";
      sourceReleaseDate: string | null;
      /** Exact Apple entity metadata, present only for an edition-bound Apple cover. */
      appleEditionBinding?: PersistedItunesEditionCoverBinding;
    }
  | {
      status: "MISSING" | "UNAVAILABLE" | "INVALID";
      reasonCode: string;
      reason: string;
      retryable: boolean;
      /** Retryable exact Apple entity; legacy URL-only rows intentionally omit it. */
      appleEditionBinding?: PersistedItunesEditionCoverBinding;
    };

export type ComprehensiveCandidateResult = {
  candidate: ReleaseResearchCandidate;
  workId: string;
  editionId: string;
  resolution: ComprehensiveCandidateResolution;
  evidenceVerdict: ComprehensiveEvidenceVerdict;
  aiDecision: ComprehensiveAiDecision | null;
  cover: ComprehensiveCoverLookupResult | null;
  ledger: ComprehensiveLedgerEntry[];
};

export type ComprehensiveDiscographySummary = {
  totalCandidates: number;
  evidenceReadyForAi: number;
  aiAccepted: number;
  verified: number;
  pendingEvidence: number;
  pendingCover: number;
  rejected: number;
  outOfScope: number;
};

export type ComprehensiveDiscographyOutput = {
  results: ComprehensiveCandidateResult[];
  verifiedCandidates: ReleaseResearchCandidate[];
  summary: ComprehensiveDiscographySummary;
};

export type ComprehensiveDiscographyDependencies = {
  auditEvidence?: (
    candidates: readonly ComprehensiveEvidenceCandidate[],
    apiKeyOverride?: string,
  ) => Promise<ComprehensiveAiDecision[]>;
  lookupValidatedCover: (
    candidate: ComprehensiveDiscographyCandidate,
  ) => Promise<ComprehensiveCoverLookupResult>;
  now?: () => Date;
  aiBatchSize?: number;
  reviewAiRejections?: boolean;
  coverSelection?: "ALL_ACCEPTED_EDITIONS" | "EARLIEST_ACCEPTED_PER_WORK";
  coverConcurrency?: number;
  onAiCheckpoint?: (input: {
    decisions: ComprehensiveAiDecision[];
    unavailableCandidateIds: string[];
  }) => void | Promise<void>;
  onProgress?: (input: {
    processed: number;
    total: number;
    stage: "AI_AUDIT" | "COVER";
  }) => void | Promise<void>;
};

type AiRejectionReview =
  | {
      outcome: "CONFIRMED" | "DISAGREEMENT";
      initial: ComprehensiveAiDecision;
      reviewed: ComprehensiveAiDecision;
    }
  | {
      outcome: "UNAVAILABLE";
      initial: ComprehensiveAiDecision;
      failure: string;
    };

export type ResolveComprehensiveResolutionInput = {
  evidenceVerdict: ComprehensiveEvidenceVerdict;
  aiDecision: ComprehensiveAiDecision["decision"] | null;
  coverStatus: ComprehensiveCoverLookupResult["status"] | null;
};

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function aiAuditErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "AI evidence audit was unavailable.";
}

function aiAuditErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = "status" in error
    ? error.status
    : "statusCode" in error
      ? error.statusCode
      : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{3}$/u.test(value)) return Number(value);
  return null;
}

function isGlobalAiAuditProviderError(error: unknown) {
  const status = aiAuditErrorStatus(error);
  if (status !== null && (status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500)) {
    return true;
  }
  return /(?:authentication|authorization|unauthorized|forbidden|api[ -]?key|permission|rate[ -]?limit|quota|credit|billing|gateway|network|fetch failed|timeout|timed out|socket|connection|econn|enotfound|etimedout|eai_again|aborted|service unavailable|overloaded)/iu
    .test(aiAuditErrorMessage(error));
}

/**
 * Only malformed model output benefits from reducing the batch. Provider-wide
 * failures are independent of batch contents, so recursively retrying them
 * would multiply requests (and potentially cost) without isolating a bad item.
 */
function isSplittableAiAuditValidationError(error: unknown) {
  if (isGlobalAiAuditProviderError(error)) return false;
  const name = error instanceof Error ? error.name : "";
  const message = aiAuditErrorMessage(error);
  if (name === "ZodError" || name === "SyntaxError") return true;
  return /(?:malformed|invalid\s+json|json\s+(?:parse|schema)|schema\s+validation|parse\w*\s+json|unexpected\s+(?:token|end)|expected\s+property|unterminated|no\s+json|extract\w*\s+json|duplicate\s+candidate|did\s+not\s+return\s+one\s+decision|unknown\s+candidate\s+id|inconsistent\s+(?:acceptance|unknown\s+decision)|rejected\s+without\s+an\s+explicit|invented\s+or\s+misclassified|response\s+(?:shape|structure)|missing\s+candidate|candidate\s+id\s+missing)/iu
    .test(message);
}

function normalizeId(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 200) {
    throw new TypeError(`${label} must contain between 1 and 200 characters.`);
  }
  return normalized;
}

export function createComprehensiveLedgerEntry(
  entry: ComprehensiveLedgerEntry,
): ComprehensiveLedgerEntry {
  if (entry.verdict === "REJECT" && entry.conflictIds.length === 0) {
    throw new TypeError("A REJECT ledger entry requires at least one explicit conflict id.");
  }
  return {
    ...entry,
    sourceUrls: uniqueStrings(entry.sourceUrls),
    conflictIds: uniqueStrings(entry.conflictIds),
  };
}

export function resolveComprehensiveCandidateResolution(
  input: ResolveComprehensiveResolutionInput,
): ComprehensiveCandidateResolution {
  if (input.evidenceVerdict === "OUT_OF_SCOPE") return "OUT_OF_SCOPE";
  if (input.evidenceVerdict === "REJECT") return "REJECTED";
  if (input.evidenceVerdict === "UNKNOWN") return "PENDING_EVIDENCE";
  if (input.aiDecision === null || input.aiDecision === "UNKNOWN") return "PENDING_EVIDENCE";
  if (input.aiDecision === "REJECT") return "REJECTED";
  return input.coverStatus === "FOUND" ? "VERIFIED" : "PENDING_COVER";
}

export function summarizeComprehensiveDiscography(
  results: readonly ComprehensiveCandidateResult[],
): ComprehensiveDiscographySummary {
  return {
    totalCandidates: results.length,
    evidenceReadyForAi: results.filter(isComprehensiveEvidenceReadyForAi).length,
    aiAccepted: results.filter((result) => result.aiDecision?.decision === "ACCEPT").length,
    verified: results.filter((result) => result.resolution === "VERIFIED").length,
    pendingEvidence: results.filter((result) => result.resolution === "PENDING_EVIDENCE").length,
    pendingCover: results.filter((result) => result.resolution === "PENDING_COVER").length,
    rejected: results.filter((result) => result.resolution === "REJECTED").length,
    outOfScope: results.filter((result) => result.resolution === "OUT_OF_SCOPE").length,
  };
}

/**
 * Evidence readiness is a pipeline-stage fact, while evidenceVerdict is the
 * terminal result. A candidate rejected or deferred by AI still reached the
 * AI stage, so derive this metric from the ledger as well as accepted legacy
 * payloads whose ledger may be absent.
 */
export function isComprehensiveEvidenceReadyForAi(
  result: Pick<ComprehensiveCandidateResult, "evidenceVerdict" | "ledger">,
) {
  if (result.ledger.some((entry) =>
    entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON &&
    entry.verdict === "UNKNOWN")) {
    return false;
  }
  return result.evidenceVerdict === "PASS" ||
    result.ledger.some((entry) => entry.stage === "AI_AUDIT");
}

function terminalEvidenceVerdict(
  resolution: ComprehensiveCandidateResolution,
  readinessVerdict: ComprehensiveEvidenceVerdict,
): ComprehensiveEvidenceVerdict {
  if (resolution === "OUT_OF_SCOPE") return "OUT_OF_SCOPE";
  if (resolution === "REJECTED") return "REJECT";
  if (resolution === "PENDING_EVIDENCE") return "UNKNOWN";
  return readinessVerdict;
}

function categoryFromMusicBrainz(evidence: MusicReleaseEvidence): ReleaseCategory {
  const types = [evidence.type, ...evidence.secondaryTypes]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.normalize("NFKC").trim().toLocaleLowerCase("en"));
  if (types.some((value) => value === "box set" || value === "box")) return "BOX";
  if (types.includes("live")) return "LIVE";
  if (types.some((value) => value === "remix" || value === "dj-mix")) return "REMIX";
  if (types.includes("compilation")) return "COLLECTION";
  if (types.includes("ep")) return "EP";
  if (types.includes("single")) return "SINGLE";
  if (types.includes("album")) return "ORIGINAL_ALBUM";
  return "OTHER";
}

function candidateFromEdition(
  edition: ArtistReleaseEditionEvidence,
  bundle: ArtistReleaseEvidenceBundle,
  result: ReleaseResearchResult,
): ReleaseResearchCandidate {
  const evidence = edition.evidence;
  const work = bundle.works?.find((candidate) => candidate.workId === edition.workId);
  const resolvedFormat = evidence.format ??
    (evidence.formats.length > 0 ? uniqueStrings(evidence.formats).join(" + ") : null);
  const sources = evidence.sources.map((source) => ({
    title: source.title,
    url: source.url,
    sourceType: "database" as const,
  }));
  const warnings = uniqueStrings([
    ...edition.scope.reasonCodes.map((code) => `SCOPE_${edition.scope.verdict}: ${code}`),
    !evidence.date ? "PENDING_REVIEW: MusicBrainz release date missing." : null,
    !evidence.catalogNumber ? "PENDING_REVIEW: MusicBrainz catalog number missing." : null,
    !resolvedFormat ? "PENDING_REVIEW: MusicBrainz format missing." : null,
  ]);
  return {
    id: `release-${evidence.sourceId}`,
    title: evidence.title,
    titleOriginal: null,
    category: categoryFromMusicBrainz(evidence),
    artistCredit: evidence.artistCredit ?? (evidence.artistNames.join(" & ") || result.artist.name),
    releaseDate: evidence.date,
    originalReleaseDate: work?.releaseGroup?.date ?? null,
    format: resolvedFormat,
    catalogNumber: evidence.catalogNumber,
    barcode: evidence.barcode,
    label: evidence.label,
    originalPrice: null,
    editionType: null,
    isReissue: null,
    isRemaster: null,
    isExcludedByDefault: edition.scope.verdict === "OUT_OF_SCOPE",
    coverImageUrl: evidence.coverUrl,
    coverImageSourceUrl: evidence.coverSourceUrl,
    notes: null,
    confidence: edition.scope.verdict === "PASS" && evidence.catalogNumber ? "MEDIUM" : "LOW",
    warnings,
    sources,
    verification: null,
  };
}

function musicBrainzObservation(
  candidate: ReleaseResearchCandidate,
  editionId: string,
): ComprehensiveEvidenceObservation {
  const sourceUrl = candidate.sources.find((source) =>
    /^https:\/\/musicbrainz\.org\/release\/[0-9a-f-]+$/i.test(source.url))?.url ?? null;
  return {
    id: `musicbrainz:${editionId}`,
    provider: "musicbrainz",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "MUSICBRAINZ",
    verdict: "PASS",
    reasonCode: "MUSICBRAINZ_EDITION_DISCOVERED",
    reason: "MusicBrainz supplied a detailed physical-release candidate.",
    sourceUrl,
    matchedFields: uniqueStrings([
      candidate.title ? "title" : null,
      candidate.artistCredit ? "artist" : null,
      candidate.releaseDate ? "date" : null,
      candidate.catalogNumber ? "catalogNumber" : null,
      candidate.barcode ? "barcode" : null,
      candidate.format ? "format" : null,
    ]),
    facts: {
      title: candidate.title,
      artist: candidate.artistCredit,
      date: candidate.releaseDate,
      catalogNumber: candidate.catalogNumber,
      barcode: candidate.barcode,
      format: candidate.format,
    },
  };
}

function scopeObservation(
  verdict: "PASS" | "UNKNOWN" | "OUT_OF_SCOPE",
  reasonCodes: readonly string[],
  editionId: string,
): ComprehensiveEvidenceObservation {
  return {
    id: `scope:${editionId}`,
    provider: "musicbrainz",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "SCOPE",
    verdict,
    reasonCode: reasonCodes[0] ?? (verdict === "PASS" ? "SCOPE_MATCHED" : "SCOPE_UNRESOLVED"),
    reason: reasonCodes.length > 0
      ? reasonCodes.join(", ")
      : verdict === "PASS"
        ? "The detailed edition explicitly matches the requested scope."
        : "The detailed edition scope could not be resolved.",
    sourceUrl: null,
    // A PASS verdict is emitted only after the detailed MusicBrainz edition
    // explicitly satisfies the requested territory and physical-format gate.
    // Preserve those resolved fields so a weaker later source ambiguity cannot
    // erase an already proven scope match.
    matchedFields: verdict === "PASS" ? ["country", "format"] : [],
  };
}

function musicBrainzIds(candidate: ReleaseResearchCandidate) {
  let workId: string | null = null;
  let editionId: string | null = null;
  for (const source of candidate.sources) {
    const group = source.url.match(/^https:\/\/musicbrainz\.org\/release-group\/([0-9a-f-]+)$/i);
    const release = source.url.match(/^https:\/\/musicbrainz\.org\/release\/([0-9a-f-]+)$/i);
    if (group) workId = group[1];
    if (release) editionId = release[1];
  }
  return {
    workId: workId ?? `work:${candidate.id}`,
    editionId: editionId ?? candidate.id,
  };
}

/**
 * Migration bridge: prefer every MusicBrainz detailed edition when the new
 * bundle fields exist, otherwise retain the legacy canonical result rows.
 * Authority adapters append observations with addComprehensiveObservation.
 */
export function comprehensiveCandidatesFromResearch(
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
): ComprehensiveDiscographyCandidate[] {
  if (bundle.discoveredEditions && bundle.discoveredEditions.length > 0) {
    return bundle.discoveredEditions.map((edition) => {
      const candidate = candidateFromEdition(edition, bundle, result);
      const editionId = edition.evidence.sourceId;
      return {
        candidate,
        workId: edition.workId,
        editionId,
        observations: [
          musicBrainzObservation(candidate, editionId),
          scopeObservation(edition.scope.verdict, edition.scope.reasonCodes, editionId),
        ],
        conflicts: [],
      };
    });
  }

  return result.releases.map((candidate) => {
    const ids = musicBrainzIds(candidate);
    return {
      candidate,
      ...ids,
      observations: [
        musicBrainzObservation(candidate, ids.editionId),
        scopeObservation("PASS", ["LEGACY_CANONICAL_SCOPE_PASS"], ids.editionId),
      ],
      conflicts: [],
    };
  });
}

export function addComprehensiveObservation(
  candidate: ComprehensiveDiscographyCandidate,
  observation: ComprehensiveEvidenceObservation,
): ComprehensiveDiscographyCandidate {
  const observations = candidate.observations.filter((item) => item.id !== observation.id);
  return { ...candidate, observations: [...observations, observation] };
}

export function addComprehensiveConflict(
  candidate: ComprehensiveDiscographyCandidate,
  conflict: ComprehensiveEvidenceConflict,
): ComprehensiveDiscographyCandidate {
  const conflicts = candidate.conflicts.filter((item) => item.id !== conflict.id);
  return { ...candidate, conflicts: [...conflicts, conflict] };
}

function normalizedWorkTitle(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und").replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function normalizedWorkIdentifier(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleUpperCase("und").replace(/[^\p{L}\p{N}]/gu, "");
}

function workDate(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.candidate.originalReleaseDate ?? candidate.candidate.releaseDate;
}

type DeclaredOriginalCdIdentity = {
  releaseDate: string;
  catalogNumber: string | null;
};

function declaredOriginalCdIdentity(
  candidate: ComprehensiveDiscographyCandidate,
): DeclaredOriginalCdIdentity | null {
  const identities = candidate.observations
    .filter((item) =>
      item.stage === "SCOPE" && item.verdict === "PASS" &&
      item.facts?.physicalCd === "ORIGINAL_RELEASE" &&
      item.facts.physicalCdReleaseDate)
    .map((item) => ({
      releaseDate: item.facts!.physicalCdReleaseDate!,
      catalogNumber: item.facts!.physicalCdCatalogNumber ?? null,
    }));
  const unique = new Map(identities.map((identity) => [
    `${identity.releaseDate}:${normalizedWorkIdentifier(identity.catalogNumber)}`,
    identity,
  ]));
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

function matchesDeclaredOriginalCdDate(candidate: ComprehensiveDiscographyCandidate) {
  const identity = declaredOriginalCdIdentity(candidate);
  return !identity || candidate.candidate.releaseDate === identity.releaseDate;
}

type PartialReleaseDateInterval = {
  start: number;
  end: number;
  precision: 1 | 2 | 3;
};

function partialReleaseDateInterval(
  value: string | null | undefined,
): PartialReleaseDateInterval | null {
  const match = value?.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const exact = Date.UTC(year, month! - 1, day);
    const parsed = new Date(exact);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month! - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return { start: exact, end: exact, precision: 3 };
  }
  if (month !== null) {
    return {
      start: Date.UTC(year, month - 1, 1),
      end: Date.UTC(year, month, 0),
      precision: 2,
    };
  }
  return {
    start: Date.UTC(year, 0, 1),
    end: Date.UTC(year, 11, 31),
    precision: 1,
  };
}

type PublicationGateFailure = {
  reasonCode:
    | "PHYSICAL_EDITION_IDENTITY_INCOMPLETE"
    | "PHYSICAL_CD_AFTER_AVAILABLE_BY";
  message: string;
  retryable: boolean;
};

function physicalCdFormat(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC").toUpperCase();
  return /(?:^|[^A-Z])(?:CD|BLU[ _-]?SPEC(?:[ _-]?CD)?|COMPACT[ _-]?DISC)(?:[^A-Z]|$)/u
    .test(normalized);
}

function publicationGateFailure(
  candidate: ComprehensiveDiscographyCandidate,
): PublicationGateFailure | null {
  const releaseDate = partialReleaseDateInterval(candidate.candidate.releaseDate);
  const originalReleaseDate = partialReleaseDateInterval(
    candidate.candidate.originalReleaseDate,
  );
  const incompleteFields = uniqueStrings([
    releaseDate?.precision === 3 ? null : "releaseDate",
    originalReleaseDate?.precision === 3 ? null : "originalReleaseDate",
    candidate.candidate.catalogNumber?.trim() ? null : "catalogNumber",
    physicalCdFormat(candidate.candidate.format) ? null : "format",
  ]);
  if (incompleteFields.length > 0) {
    return {
      reasonCode: "PHYSICAL_EDITION_IDENTITY_INCOMPLETE",
      message: `The physical-CD edition cannot be published until these exact identity fields are independently attested: ${incompleteFields.join(", ")}.`,
      retryable: true,
    };
  }

  const afterAvailableBy = candidate.observations.some((observation) => {
    if (
      observation.stage !== "SCOPE" ||
      observation.verdict !== "PASS" ||
      observation.facts?.physicalCd !== "LATER_OFFICIAL_EDITION" ||
      observation.facts?.physicalCdDateEvidenceKind !== "AVAILABLE_BY"
    ) return false;
    const upperBound = partialReleaseDateInterval(
      observation.facts.physicalCdReleaseDate,
    );
    return upperBound?.precision === 3 && releaseDate!.start > upperBound.end;
  });
  if (afterAvailableBy) {
    return {
      reasonCode: "PHYSICAL_CD_AFTER_AVAILABLE_BY",
      message: "This edition is later than the authoritative date by which a physical CD was already available, so it cannot replace the unresolved earlier edition.",
      retryable: false,
    };
  }
  return null;
}

function editionDateSort(
  left: ComprehensiveDiscographyCandidate,
  right: ComprehensiveDiscographyCandidate,
) {
  const hasCanonicalManifestIdentity = (candidate: ComprehensiveDiscographyCandidate) =>
    candidate.observations.some((item) =>
      item.verdict === "PASS" &&
      item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" &&
      item.provider.normalize("NFKC").toLocaleLowerCase("en")
        .startsWith("curated-official-manifest:"));
  // When an exact official manifest and a provider record share a bridged
  // work id but disagree on canonical work metadata, retain the manifest
  // representation. Physical-edition chronology is compared only after the
  // canonical identity is secured; otherwise an earlier dated metadata row
  // can overwrite the authoritative title/date while still passing evidence.
  const canonicalOrder = Number(hasCanonicalManifestIdentity(right)) -
    Number(hasCanonicalManifestIdentity(left));
  const leftDate = partialReleaseDateInterval(left.candidate.releaseDate);
  const rightDate = partialReleaseDateInterval(right.candidate.releaseDate);
  let dateOrder = 0;
  if (leftDate && rightDate) {
    if (leftDate.end < rightDate.start) dateOrder = -1;
    else if (rightDate.end < leftDate.start) dateOrder = 1;
    else dateOrder = rightDate.precision - leftDate.precision;
  } else if (leftDate || rightDate) {
    dateOrder = leftDate ? -1 : 1;
  }
  const hasDeclaredOriginalCatalog = (candidate: ComprehensiveDiscographyCandidate) => {
    const identity = declaredOriginalCdIdentity(candidate);
    return Boolean(identity?.catalogNumber &&
      normalizedWorkIdentifier(candidate.candidate.catalogNumber) ===
        normalizedWorkIdentifier(identity.catalogNumber));
  };
  const declaredOriginalCatalogOrder = Number(hasDeclaredOriginalCatalog(right)) -
    Number(hasDeclaredOriginalCatalog(left));
  return canonicalOrder || dateOrder || declaredOriginalCatalogOrder ||
    Number(Boolean(right.candidate.catalogNumber)) - Number(Boolean(left.candidate.catalogNumber)) ||
    left.editionId.localeCompare(right.editionId);
}

function hasExplicitStrongIdentifierConflict(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.conflicts.some((conflict) => {
    if (conflict.certainty !== "EXPLICIT") return false;
    const field = conflict.field.normalize("NFKC").toLocaleLowerCase("und").replace(/[^a-z]/g, "");
    return field.includes("catalog") || field.includes("barcode");
  });
}

function hasSameExactDuplicateWorkFacts(
  left: ComprehensiveDiscographyCandidate,
  right: ComprehensiveDiscographyCandidate,
) {
  const leftCandidate = left.candidate;
  const rightCandidate = right.candidate;
  if (normalizedWorkTitle(leftCandidate.title) !== normalizedWorkTitle(rightCandidate.title)) return false;

  const leftDate = partialReleaseDateInterval(leftCandidate.originalReleaseDate);
  const rightDate = partialReleaseDateInterval(rightCandidate.originalReleaseDate);
  if (
    leftDate?.precision !== 3 ||
    rightDate?.precision !== 3 ||
    leftDate.start !== rightDate.start
  ) {
    return false;
  }
  return true;
}

function canJoinDuplicateWorkCluster(
  candidate: ComprehensiveDiscographyCandidate,
  cluster: readonly ComprehensiveDiscographyCandidate[],
) {
  if (cluster.length === 0 || hasExplicitStrongIdentifierConflict(candidate)) return false;
  if (cluster.some((member) =>
    hasExplicitStrongIdentifierConflict(member) ||
    !hasSameExactDuplicateWorkFacts(candidate, member))) {
    return false;
  }

  const catalog = normalizedWorkIdentifier(candidate.candidate.catalogNumber);
  const barcode = normalizedWorkIdentifier(candidate.candidate.barcode);
  const clusterCatalogs = new Set(cluster
    .map((member) => normalizedWorkIdentifier(member.candidate.catalogNumber))
    .filter(Boolean));
  const clusterBarcodes = new Set(cluster
    .map((member) => normalizedWorkIdentifier(member.candidate.barcode))
    .filter(Boolean));
  const sharedIdentifier = Boolean(
    (catalog && clusterCatalogs.has(catalog)) ||
    (barcode && clusterBarcodes.has(barcode)),
  );
  if (!sharedIdentifier) return false;

  const catalogConflict = Boolean(catalog && [...clusterCatalogs].some((value) => value !== catalog));
  const barcodeConflict = Boolean(barcode && [...clusterBarcodes].some((value) => value !== barcode));
  return !catalogConflict && !barcodeConflict;
}

function splitCompositeWorkTitle(value: string) {
  return value
    .normalize("NFKC")
    .split(/\s*[\/／]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function replaceScopeObservation(
  candidate: ComprehensiveDiscographyCandidate,
  verdict: "PASS" | "UNKNOWN" | "OUT_OF_SCOPE",
  reasonCode: string,
  reason: string,
) {
  return addComprehensiveObservation(candidate, {
    id: `scope:work-rule:${candidate.editionId}`,
    provider: "cd-box-work-rules",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "SCOPE",
    verdict,
    reasonCode,
    reason,
    sourceUrl: null,
    matchedFields: ["title", "originalReleaseDate"],
  });
}

/**
 * Applies work-level rules without deleting an edition. Exact duplicate
 * release groups share one work identity. A later composite title is treated
 * as a reissue bundle only when every slash-separated component already exists
 * as an earlier standalone work; a shared release date by itself is never a
 * merge signal.
 */
export function applyComprehensiveWorkRules(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  options: { excludeReissues: boolean },
) {
  const byWork = new Map<string, ComprehensiveDiscographyCandidate[]>();
  for (const candidate of candidates) {
    const values = byWork.get(candidate.workId) ?? [];
    values.push(candidate);
    byWork.set(candidate.workId, values);
  }
  const representatives = [...byWork.entries()].map(([workId, values]) => ({
    workId,
    candidate: [...values].sort((left, right) =>
      (workDate(left) ?? "9999").localeCompare(workDate(right) ?? "9999") ||
      left.editionId.localeCompare(right.editionId))[0]!,
  }));

  const canonicalWorkId = new Map<string, string>();
  const duplicateClusters: Array<typeof representatives> = [];
  for (const representative of [...representatives].sort((left, right) =>
    left.workId.localeCompare(right.workId))) {
    const cluster = duplicateClusters.find((values) =>
      canJoinDuplicateWorkCluster(
        representative.candidate,
        values.map((value) => value.candidate),
      ));
    if (cluster) cluster.push(representative);
    else duplicateClusters.push([representative]);
  }
  for (const cluster of duplicateClusters) {
    if (cluster.length < 2) continue;
    const canonical = cluster[0]!.workId;
    for (const { workId } of cluster.slice(1)) canonicalWorkId.set(workId, canonical);
  }

  const standaloneSingles = representatives.filter((item) =>
    item.candidate.candidate.category === "SINGLE" &&
    splitCompositeWorkTitle(item.candidate.candidate.title).length === 1);
  const standaloneByTitle = new Map<string, typeof standaloneSingles>();
  for (const item of standaloneSingles) {
    const key = normalizedWorkTitle(item.candidate.candidate.title);
    const values = standaloneByTitle.get(key) ?? [];
    values.push(item);
    standaloneByTitle.set(key, values);
  }

  const bundledWorkIds = new Set<string>();
  if (options.excludeReissues) {
    for (const item of representatives) {
      if (item.candidate.candidate.category !== "SINGLE") continue;
      const parts = splitCompositeWorkTitle(item.candidate.candidate.title);
      if (parts.length < 2) continue;
      const compositeDate = partialReleaseDateInterval(workDate(item.candidate));
      if (!compositeDate) continue;
      const allEarlier = parts.every((part) => {
        const matches = standaloneByTitle.get(normalizedWorkTitle(part)) ?? [];
        return matches.some((match) => {
          const standaloneDate = partialReleaseDateInterval(workDate(match.candidate));
          return Boolean(standaloneDate && standaloneDate.end < compositeDate.start);
        });
      });
      if (allEarlier) bundledWorkIds.add(item.workId);
    }
  }

  return candidates.map((candidate) => {
    let next = {
      ...candidate,
      workId: canonicalWorkId.get(candidate.workId) ?? candidate.workId,
    };
    if (bundledWorkIds.has(candidate.workId)) {
      next = replaceScopeObservation(
        next,
        "OUT_OF_SCOPE",
        "LATER_COMPOSITE_REISSUE_BUNDLE",
        "Every component of this later composite title is already represented by an earlier standalone work.",
      );
    }
    if (
      next.candidate.category === "SINGLE" &&
      /(?:party|club|extended|dance|remix)\s+version/iu.test(next.candidate.title)
    ) {
      next = {
        ...next,
        candidate: { ...next.candidate, category: "REMIX" },
      };
    }
    return next;
  });
}

function toEvidenceCandidate(
  candidate: ComprehensiveDiscographyCandidate,
): ComprehensiveEvidenceCandidate {
  return {
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  };
}

function initialLedger(candidate: ComprehensiveDiscographyCandidate) {
  const entries: ComprehensiveLedgerEntry[] = [createComprehensiveLedgerEntry({
    stage: "DISCOVERY",
    verdict: "PASS",
    reasonCode: "CANDIDATE_DISCOVERED",
    message: "The physical edition remains represented in the comprehensive pipeline.",
    sourceUrls: candidate.candidate.sources.map((source) => source.url),
    retryable: false,
    conflictIds: [],
  })];
  for (const observation of candidate.observations) {
    entries.push(createComprehensiveLedgerEntry({
      stage: observation.stage,
      verdict: observation.verdict,
      reasonCode: observation.reasonCode,
      message: observation.reason,
      sourceUrls: observation.sourceUrl ? [observation.sourceUrl] : [],
      retryable: observation.retryable ?? false,
      conflictIds: [],
    }));
  }
  for (const conflict of candidate.conflicts) {
    entries.push(createComprehensiveLedgerEntry({
      stage: "CORROBORATION",
      verdict: conflict.certainty === "EXPLICIT" ? "REJECT" : "UNKNOWN",
      reasonCode: conflict.reasonCode,
      message: conflict.message,
      sourceUrls: candidate.observations
        .filter((observation) => conflict.sourceObservationIds.includes(observation.id))
        .map((observation) => observation.sourceUrl)
        .filter((sourceUrl): sourceUrl is string => Boolean(sourceUrl)),
      retryable: false,
      conflictIds: [conflict.id],
    }));
  }
  return entries;
}

export async function runComprehensiveDiscographyPipeline(
  candidates: readonly ComprehensiveDiscographyCandidate[],
  dependencies: ComprehensiveDiscographyDependencies,
  apiKeyOverride?: string,
): Promise<ComprehensiveDiscographyOutput> {
  const normalized = candidates.map((candidate) => ({
    ...candidate,
    workId: normalizeId(candidate.workId, "workId"),
    editionId: normalizeId(candidate.editionId, "editionId"),
  }));
  const candidateIds = normalized.map((candidate) => candidate.candidate.id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("Comprehensive discography candidates require unique candidate ids.");
  }

  const auditEvidence = dependencies.auditEvidence ?? auditComprehensiveEvidenceWithAi;
  const batchSize = Math.min(80, Math.max(1, Math.trunc(dependencies.aiBatchSize ?? 40)));
  const evidenceCandidates = normalized.map(toEvidenceCandidate);
  const publicationGateById = new Map(normalized
    .map((candidate) => [candidate.candidate.id, publicationGateFailure(candidate)] as const)
    .filter((entry): entry is readonly [string, PublicationGateFailure] => entry[1] !== null));
  const readinessById = new Map<string, ComprehensiveEvidenceReadiness>(
    evidenceCandidates.map((candidate) => {
      const gateFailure = publicationGateById.get(candidate.candidateId);
      return [candidate.candidateId, gateFailure
        ? {
            verdict: "UNKNOWN",
            reasonCode: gateFailure.reasonCode,
            eligibleForAi: false,
          }
        : classifyComprehensiveEvidence(candidate)];
    }),
  );
  const decisionsById = new Map<string, ComprehensiveAiDecision>();
  const deterministicallyAcceptedIds = new Set<string>();
  for (const candidate of evidenceCandidates) {
    if (publicationGateById.has(candidate.candidateId)) continue;
    const decision = deterministicComprehensiveEvidenceDecision(candidate);
    if (!decision) continue;
    decisionsById.set(candidate.candidateId, decision);
    deterministicallyAcceptedIds.add(candidate.candidateId);
  }
  const aiCandidates = evidenceCandidates.filter((candidate) =>
    !publicationGateById.has(candidate.candidateId) && requiresComprehensiveAiAudit(candidate));
  const aiFailures = new Map<string, string>();
  let aiProviderFailure: string | null = null;
  let progressQueue = Promise.resolve();
  const reportProgress = (input: {
    processed: number;
    total: number;
    stage: "AI_AUDIT" | "COVER";
  }) => {
    if (!dependencies.onProgress) return Promise.resolve();
    const pending = progressQueue.then(() => dependencies.onProgress!(input));
    progressQueue = pending.catch(() => undefined);
    return pending;
  };

  const auditBatch = async (
    batch: readonly ComprehensiveEvidenceCandidate[],
    decisionTarget = decisionsById,
    failureTarget = aiFailures,
  ): Promise<void> => {
    const knownProviderFailure = aiProviderFailure;
    if (knownProviderFailure) {
      batch.forEach((candidate) => failureTarget.set(candidate.candidateId, knownProviderFailure));
      return;
    }
    let returnedDecisions: ComprehensiveAiDecision[];
    try {
      returnedDecisions = await auditEvidence(batch, apiKeyOverride);
    } catch (error) {
      if (batch.length > 1 && isSplittableAiAuditValidationError(error)) {
        const middle = Math.ceil(batch.length / 2);
        await auditBatch(batch.slice(0, middle), decisionTarget, failureTarget);
        await auditBatch(batch.slice(middle), decisionTarget, failureTarget);
        return;
      }
      const message = aiAuditErrorMessage(error);
      if (isGlobalAiAuditProviderError(error)) aiProviderFailure = message;
      batch.forEach((candidate) => failureTarget.set(candidate.candidateId, message));
      return;
    }

    try {
      const decisions = validateComprehensiveAiDecisions(returnedDecisions, batch);
      decisions.forEach((decision) => {
        decisionTarget.set(decision.candidateId, decision);
        failureTarget.delete(decision.candidateId);
      });
    } catch (error) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await auditBatch(batch.slice(0, middle), decisionTarget, failureTarget);
        await auditBatch(batch.slice(middle), decisionTarget, failureTarget);
        return;
      }
      const message = aiAuditErrorMessage(error);
      failureTarget.set(batch[0]!.candidateId, message);
    }
  };

  for (let offset = 0; offset < aiCandidates.length; offset += batchSize) {
    const batch = aiCandidates.slice(offset, offset + batchSize);
    await auditBatch(batch);
    await reportProgress({
      processed: Math.min(aiCandidates.length, offset + batch.length),
      total: aiCandidates.length,
      stage: "AI_AUDIT",
    });
  }
  const rejectionReviews = new Map<string, AiRejectionReview>();
  if (dependencies.reviewAiRejections !== false) {
    const rejectedForReview = aiCandidates.filter((candidate) =>
      decisionsById.get(candidate.candidateId)?.decision === "REJECT");
    const reviewedDecisions = new Map<string, ComprehensiveAiDecision>();
    const reviewFailures = new Map<string, string>();
    for (let offset = 0; offset < rejectedForReview.length; offset += batchSize) {
      await auditBatch(
        rejectedForReview.slice(offset, offset + batchSize),
        reviewedDecisions,
        reviewFailures,
      );
    }
    for (const candidate of rejectedForReview) {
      const candidateId = candidate.candidateId;
      const initial = decisionsById.get(candidateId)!;
      const reviewed = reviewedDecisions.get(candidateId);
      if (reviewed?.decision === "REJECT") {
        rejectionReviews.set(candidateId, { outcome: "CONFIRMED", initial, reviewed });
        continue;
      }
      if (reviewed) {
        rejectionReviews.set(candidateId, { outcome: "DISAGREEMENT", initial, reviewed });
        decisionsById.set(candidateId, {
          candidateId,
          decision: "UNKNOWN",
          reasonCode: "INSUFFICIENT_EVIDENCE",
          reason: `The required second AI review disagreed with the initial rejection (${initial.decision} then ${reviewed.decision}).`,
          conflictIds: [],
        });
        continue;
      }

      const failure = reviewFailures.get(candidateId) ??
        "The required second AI rejection review returned no validated decision.";
      rejectionReviews.set(candidateId, { outcome: "UNAVAILABLE", initial, failure });
      decisionsById.set(candidateId, {
        candidateId,
        decision: "UNKNOWN",
        reasonCode: "INSUFFICIENT_EVIDENCE",
        reason: "The initial rejection could not be confirmed by the required second AI review.",
        conflictIds: [],
      });
      aiFailures.set(candidateId, failure);
    }
  }
  await dependencies.onAiCheckpoint?.({
    decisions: evidenceCandidates
      .map((candidate) => decisionsById.get(candidate.candidateId))
      .filter((decision): decision is ComprehensiveAiDecision => Boolean(decision)),
    unavailableCandidateIds: [...aiFailures.keys()],
  });

  const results: ComprehensiveCandidateResult[] = [];
  const allAcceptedItems = normalized.filter((item) =>
    !publicationGateById.has(item.candidate.id) &&
    decisionsById.get(item.candidate.id)?.decision === "ACCEPT" &&
    matchesDeclaredOriginalCdDate(item));
  const acceptedItems = dependencies.coverSelection === "EARLIEST_ACCEPTED_PER_WORK"
    ? [...new Map(allAcceptedItems.map((item) => [item.workId, item.workId])).keys()]
        .map((workId) => allAcceptedItems
          .filter((item) => item.workId === workId)
          .sort(editionDateSort)[0]!)
    : allAcceptedItems;
  const coverSelectedIds = new Set(acceptedItems.map((item) => item.candidate.id));
  const coversById = new Map<string, ComprehensiveCoverLookupResult>();
  const coverConcurrency = Math.min(
    8,
    Math.max(1, Math.trunc(dependencies.coverConcurrency ?? 4)),
    Math.max(1, acceptedItems.length),
  );
  let nextCoverIndex = 0;
  let coversProcessed = 0;
  const coverWorker = async () => {
    while (nextCoverIndex < acceptedItems.length) {
      const item = acceptedItems[nextCoverIndex++]!;
      let cover: ComprehensiveCoverLookupResult;
      try {
        cover = await dependencies.lookupValidatedCover(item);
      } catch {
        cover = {
          status: "UNAVAILABLE",
          reasonCode: "COVER_LOOKUP_FAILED",
          reason: "Cover lookup failed; the provider will be retried without persisting transport details.",
          retryable: true,
        };
      }
      coversById.set(item.candidate.id, cover);
      coversProcessed += 1;
      await reportProgress({
        processed: coversProcessed,
        total: acceptedItems.length,
        stage: "COVER",
      });
    }
  };
  await Promise.all(Array.from({ length: coverConcurrency }, () => coverWorker()));

  for (const item of normalized) {
    const readiness = readinessById.get(item.candidate.id)!;
    const ledger = initialLedger(item);
    const gateFailure = publicationGateById.get(item.candidate.id);
    if (gateFailure) {
      ledger.push(createComprehensiveLedgerEntry({
        stage: "SCOPE",
        verdict: "UNKNOWN",
        reasonCode: gateFailure.reasonCode,
        message: gateFailure.message,
        sourceUrls: [],
        retryable: gateFailure.retryable,
        conflictIds: [],
      }));
    }
    let decision = decisionsById.get(item.candidate.id) ?? null;
    let cover: ComprehensiveCoverLookupResult | null = null;
    let candidate = item.candidate;

    if (readiness.verdict === "PASS") {
      const rejectionReview = rejectionReviews.get(item.candidate.id);
      const aiFailure = aiFailures.get(item.candidate.id);
      if (deterministicallyAcceptedIds.has(item.candidate.id)) {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "CORROBORATION",
          verdict: "PASS",
          reasonCode: "DETERMINISTIC_EVIDENCE_ACCEPTED",
          message: "Deterministic evidence gates passed with no semantic AI_REVIEW question, so this candidate was accepted without calling the AI provider.",
          sourceUrls: [],
          retryable: false,
          conflictIds: [],
        }));
      } else if (rejectionReview?.outcome === "CONFIRMED") {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: "REJECT",
          reasonCode: "AI_REJECTION_CONFIRMED",
          message: `Two AI audit passes independently rejected this candidate. Initial (${rejectionReview.initial.reasonCode}): ${rejectionReview.initial.reason} Review (${rejectionReview.reviewed.reasonCode}): ${rejectionReview.reviewed.reason}`,
          sourceUrls: [],
          retryable: false,
          conflictIds: uniqueStrings([
            ...rejectionReview.initial.conflictIds,
            ...rejectionReview.reviewed.conflictIds,
          ]),
        }));
      } else if (rejectionReview?.outcome === "DISAGREEMENT") {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: "UNKNOWN",
          reasonCode: "AI_REVIEW_DISAGREEMENT",
          message: `The initial AI audit rejected this candidate (${rejectionReview.initial.reasonCode}: ${rejectionReview.initial.reason}), but the required second review returned ${rejectionReview.reviewed.decision} (${rejectionReview.reviewed.reasonCode}: ${rejectionReview.reviewed.reason}). The conflict therefore remains unresolved.`,
          sourceUrls: [],
          retryable: true,
          conflictIds: [],
        }));
      } else if (rejectionReview?.outcome === "UNAVAILABLE") {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: "UNKNOWN",
          reasonCode: "AI_REJECTION_REVIEW_UNAVAILABLE",
          message: `The initial AI audit rejected this candidate (${rejectionReview.initial.reasonCode}: ${rejectionReview.initial.reason}), but the required second review was unavailable: ${rejectionReview.failure}`,
          sourceUrls: [],
          retryable: true,
          conflictIds: [],
        }));
      } else if (aiFailure) {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: "UNKNOWN",
          reasonCode: "AI_AUDIT_UNAVAILABLE",
          message: aiFailure,
          sourceUrls: [],
          retryable: true,
          conflictIds: [],
        }));
      } else if (!decision) {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: "UNKNOWN",
          reasonCode: "AI_DECISION_MISSING",
          message: "The AI audit returned no validated decision for this candidate.",
          sourceUrls: [],
          retryable: true,
          conflictIds: [],
        }));
      } else {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "AI_AUDIT",
          verdict: decision.decision === "ACCEPT"
            ? "PASS"
            : decision.decision === "REJECT"
              ? "REJECT"
              : "UNKNOWN",
          reasonCode: decision.reasonCode,
          message: decision.reason,
          sourceUrls: [],
          retryable: decision.decision === "UNKNOWN",
          conflictIds: decision.conflictIds,
        }));
      }
    } else {
      decision = null;
    }

    const selectedForCover = decision?.decision === "ACCEPT" &&
      coverSelectedIds.has(item.candidate.id);
    if (selectedForCover) {
      cover = coversById.get(item.candidate.id) ?? {
        status: "UNAVAILABLE",
        reasonCode: "COVER_RESULT_MISSING",
        reason: "The cover worker returned no result.",
        retryable: true,
      };
      if (cover.status === "FOUND") {
        candidate = {
          ...candidate,
          coverImageUrl: cover.imageUrl,
          coverImageSourceUrl: cover.sourceUrl,
          confidence: "HIGH",
        };
        ledger.push(createComprehensiveLedgerEntry({
          stage: "COVER",
          verdict: "PASS",
          reasonCode: cover.coverMatchLevel === "EDITION"
            ? "VALIDATED_EDITION_COVER_FOUND"
            : "VALIDATED_WORK_COVER_FOUND",
          message: cover.coverMatchLevel === "EDITION"
            ? `A validated ${cover.provider} cover matches this edition (source release date ${cover.sourceReleaseDate ?? "unknown"}) and was checked at ${cover.checkedAt ?? (dependencies.now ?? (() => new Date()))().toISOString()}.`
            : `A validated ${cover.provider} cover matches the work, not this physical edition (source release date ${cover.sourceReleaseDate ?? "unknown"}), and was checked at ${cover.checkedAt ?? (dependencies.now ?? (() => new Date()))().toISOString()}.`,
          sourceUrls: [cover.sourceUrl],
          retryable: false,
          conflictIds: [],
        }));
      } else {
        ledger.push(createComprehensiveLedgerEntry({
          stage: "COVER",
          verdict: "UNKNOWN",
          reasonCode: cover.reasonCode,
          message: cover.reason,
          sourceUrls: [],
          retryable: cover.retryable,
          conflictIds: [],
        }));
      }
    }

    const outsideDeclaredOriginalCdDate = decision?.decision === "ACCEPT" &&
      !matchesDeclaredOriginalCdDate(item);
    if (outsideDeclaredOriginalCdDate) {
      ledger.push(createComprehensiveLedgerEntry({
        stage: "SCOPE",
        verdict: "OUT_OF_SCOPE",
        reasonCode: "DECLARED_ORIGINAL_CD_DATE_MISMATCH",
        message: "The official manifest declares an original physical-CD issue, so a later reissue cannot replace that unresolved original edition.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      }));
    } else if (decision?.decision === "ACCEPT" && !selectedForCover) {
      ledger.push(createComprehensiveLedgerEntry({
        stage: "SCOPE",
        verdict: "OUT_OF_SCOPE",
        reasonCode: "LATER_EDITION_NOT_SELECTED",
        message: "The requested original-CD scope keeps the earliest AI-accepted edition for this work; this later edition remains in the audit ledger.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      }));
    }
    const resolution = decision?.decision === "ACCEPT" && !selectedForCover
      ? "OUT_OF_SCOPE" as const
      : resolveComprehensiveCandidateResolution({
          evidenceVerdict: readiness.verdict,
          aiDecision: decision?.decision ?? null,
          coverStatus: cover?.status ?? null,
        });
    const evidenceVerdict = terminalEvidenceVerdict(resolution, readiness.verdict);
    results.push({
      candidate,
      workId: item.workId,
      editionId: item.editionId,
      resolution,
      evidenceVerdict,
      aiDecision: decision,
      cover,
      ledger,
    });
  }

  return {
    results,
    verifiedCandidates: results
      .filter((result) => result.resolution === "VERIFIED")
      .map((result) => result.candidate),
    summary: summarizeComprehensiveDiscography(results),
  };
}

export type ComprehensiveCoverRetryOptions = {
  maxRounds?: number;
  concurrency?: number;
  /**
   * A scheduled retry is allowed to revisit a deterministic miss because a
   * public catalogue can gain artwork later. In-task retries leave this false
   * so a fresh task does not hammer sources that already returned a complete
   * negative response.
   */
  includeMissing?: boolean;
  candidateIds?: ReadonlySet<string>;
  onProgress?: (input: {
    processed: number;
    total: number;
    round: number;
    found: number;
    pending: number;
  }) => void | Promise<void>;
};

const coverRetryIdentityFields = [
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

function hasCoverRetryIdentity(
  result: ComprehensiveCandidateResult,
  source: ComprehensiveDiscographyCandidate,
) {
  if (result.workId !== source.workId || result.editionId !== source.editionId) return false;
  return coverRetryIdentityFields.every((field) =>
    (result.candidate[field] ?? null) === (source.candidate[field] ?? null));
}

export async function retryComprehensiveCovers(
  output: ComprehensiveDiscographyOutput,
  candidates: readonly ComprehensiveDiscographyCandidate[],
  lookupValidatedCover: ComprehensiveDiscographyDependencies["lookupValidatedCover"],
  options: ComprehensiveCoverRetryOptions = {},
): Promise<ComprehensiveDiscographyOutput> {
  const maxRounds = Math.min(3, Math.max(0, Math.trunc(options.maxRounds ?? 2)));
  const concurrency = Math.min(8, Math.max(1, Math.trunc(options.concurrency ?? 4)));
  const candidateById = new Map<string, ComprehensiveDiscographyCandidate>();
  const ambiguousCandidateIds = new Set<string>();
  for (const candidate of candidates) {
    const candidateId = candidate.candidate.id;
    if (candidateById.has(candidateId)) ambiguousCandidateIds.add(candidateId);
    else candidateById.set(candidateId, candidate);
  }
  let results = [...output.results];
  let progressQueue = Promise.resolve();

  for (let round = 1; round <= maxRounds; round += 1) {
    const retryable = results.filter((result) =>
      result.resolution === "PENDING_COVER" &&
      result.aiDecision?.decision === "ACCEPT" &&
      (!options.candidateIds || options.candidateIds.has(result.candidate.id)) &&
      ((result.cover?.status === "UNAVAILABLE" && result.cover.retryable) ||
        (options.includeMissing === true && result.cover?.status === "MISSING")));
    if (retryable.length === 0) break;
    let processed = 0;
    let foundInRound = 0;
    let nextIndex = 0;
    const updates = new Map<string, ComprehensiveCandidateResult>();
    if (options.onProgress) {
      const pending = progressQueue.then(() => options.onProgress!({
        processed: 0,
        total: retryable.length,
        round,
        found: 0,
        pending: 0,
      }));
      progressQueue = pending.catch(() => undefined);
      await pending;
    }
    const worker = async () => {
      while (nextIndex < retryable.length) {
        const result = retryable[nextIndex++]!;
        const sourceCandidate = candidateById.get(result.candidate.id);
        let cover: ComprehensiveCoverLookupResult;
        if (!sourceCandidate) {
          cover = {
            status: "UNAVAILABLE",
            reasonCode: "COVER_RETRY_SOURCE_MISSING",
            reason: "The cover retry could not restore this candidate's source evidence.",
            retryable: true,
          };
        } else if (
          ambiguousCandidateIds.has(result.candidate.id) ||
          !hasCoverRetryIdentity(result, sourceCandidate)
        ) {
          cover = {
            status: "INVALID",
            reasonCode: "COVER_RETRY_IDENTITY_MISMATCH",
            reason: "The cover retry source did not match the persisted work and edition identity.",
            retryable: false,
          };
        } else {
          try {
            cover = await lookupValidatedCover(sourceCandidate);
          } catch {
            cover = {
              status: "UNAVAILABLE",
              reasonCode: "COVER_RETRY_FAILED",
              reason: "Cover retry failed; the provider will be retried without persisting transport details.",
              retryable: true,
            };
          }
        }
        if (cover.status === "FOUND") {
          foundInRound += 1;
          updates.set(result.candidate.id, {
            ...result,
            candidate: {
              ...result.candidate,
              coverImageUrl: cover.imageUrl,
              coverImageSourceUrl: cover.sourceUrl,
              confidence: "HIGH",
            },
            cover,
            resolution: "VERIFIED",
            ledger: [...result.ledger, createComprehensiveLedgerEntry({
              stage: "COVER",
              verdict: "PASS",
              reasonCode: cover.coverMatchLevel === "EDITION"
                ? "VALIDATED_EDITION_COVER_FOUND_ON_RETRY"
                : "VALIDATED_WORK_COVER_FOUND_ON_RETRY",
              message: cover.coverMatchLevel === "EDITION"
                ? `A validated ${cover.provider} edition cover was found on automatic retry ${round}.`
                : `A validated ${cover.provider} work-level cover (source release date ${cover.sourceReleaseDate ?? "unknown"}) was found on automatic retry ${round}; it does not attest this physical edition.`,
              sourceUrls: [cover.sourceUrl],
              retryable: false,
              conflictIds: [],
            })],
          });
        } else {
          updates.set(result.candidate.id, {
            ...result,
            cover,
            resolution: "PENDING_COVER",
            ledger: [...result.ledger, createComprehensiveLedgerEntry({
              stage: "COVER",
              verdict: "UNKNOWN",
              reasonCode: cover.reasonCode,
              message: cover.reason,
              sourceUrls: [],
              retryable: cover.retryable,
              conflictIds: [],
            })],
          });
        }
        processed += 1;
        if (options.onProgress) {
          const input = {
            processed,
            total: retryable.length,
            round,
            found: foundInRound,
            pending: processed - foundInRound,
          };
          const pending = progressQueue.then(() => options.onProgress!(input));
          progressQueue = pending.catch(() => undefined);
          await pending;
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(concurrency, Math.max(1, retryable.length)) },
      () => worker(),
    ));
    results = results.map((result) => updates.get(result.candidate.id) ?? result);
  }

  return {
    results,
    verifiedCandidates: results
      .filter((result) => result.resolution === "VERIFIED")
      .map((result) => result.candidate),
    summary: summarizeComprehensiveDiscography(results),
  };
}

export function retryTransientComprehensiveCovers(
  output: ComprehensiveDiscographyOutput,
  candidates: readonly ComprehensiveDiscographyCandidate[],
  lookupValidatedCover: ComprehensiveDiscographyDependencies["lookupValidatedCover"],
  options: Omit<ComprehensiveCoverRetryOptions, "includeMissing"> = {},
) {
  return retryComprehensiveCovers(
    output,
    candidates,
    lookupValidatedCover,
    { ...options, includeMissing: false },
  );
}

export type {
  ComprehensiveAiDecision,
  ComprehensiveEvidenceCandidate,
  ComprehensiveEvidenceConflict,
  ComprehensiveEvidenceObservation,
  ComprehensiveEvidenceStage,
  ComprehensiveEvidenceVerdict,
} from "@/lib/ai/comprehensive-evidence-audit";
