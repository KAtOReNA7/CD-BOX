import type {
  AiSearchTaskStatus,
  CoverStatus,
  Prisma,
  PrismaClient,
  ResearchDecisionOutcome,
  ResearchDisposition,
} from "@prisma/client";
import {
  isComprehensiveEvidenceReadyForAi,
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
  type ComprehensiveDiscographySummary,
  type ComprehensiveLedgerEntry,
} from "@/lib/ai/comprehensive-discography";
import { acquireResearchLedgerTaskLock } from "@/lib/ai/research-task-lock";

export const DEFAULT_COVER_RETRY_BASE_MS = 5 * 60_000;
export const DEFAULT_COVER_RETRY_MAX_MS = 24 * 60 * 60_000;

const stageSequence = {
  DISCOVERY: 100,
  SCOPE: 101,
  MUSICBRAINZ: 102,
  AUTHORITATIVE: 103,
  CORROBORATION: 104,
  AI_AUDIT: 105,
  COVER: 106,
  RESOLUTION: 107,
} as const;

type PriorCandidateState = {
  payload?: unknown;
  coverAttemptCount: number;
  coverStatus: CoverStatus;
  coverNextRetryAt: Date | null;
  coverImageUrl: string | null;
  coverImageSourceUrl: string | null;
  coverProvider: string | null;
  coverCheckedAt: Date | null;
  coverLastErrorCode?: string | null;
  coverLastErrorMessage?: string | null;
};

export type CoverRetryPolicy = {
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type PlannedResearchDecision = {
  stage: string;
  outcome: ResearchDecisionOutcome;
  reasonCode: string;
  reasonText: string;
  retryable: boolean;
  evidence: {
    sourceUrls: string[];
    conflictIds: string[];
    resolution: ComprehensiveCandidateResult["resolution"];
    externalWorkId: string;
    externalEditionId: string;
  };
};

export type SequencedResearchDecision = PlannedResearchDecision & {
  sequence: number;
  attempt: number;
};

export type PlannedResearchCandidate = {
  candidateKey: string;
  entityKind: "EDITION";
  sourceProvider: string | null;
  sourceRecordId: string;
  title: string;
  category: ComprehensiveCandidateResult["candidate"]["category"];
  artistCredit: string;
  releaseDate: Date | null;
  datePrecision: "YEAR" | "MONTH" | "DAY" | null;
  catalogNumber: string | null;
  barcode: string | null;
  payload: Record<string, unknown>;
  disposition: ResearchDisposition;
  lastStage: string;
  finalReasonCode: string;
  retryable: boolean;
  coverImageUrl: string | null;
  coverImageSourceUrl: string | null;
  coverStatus: CoverStatus;
  coverProvider: string | null;
  coverCheckedAt: Date | null;
  coverAttemptCount: number;
  coverNextRetryAt: Date | null;
  coverLastErrorCode: string | null;
  coverLastErrorMessage: string | null;
  decisions: PlannedResearchDecision[];
};

export type PlannedResearchStageSummary = {
  stage: string;
  sequence: number;
  inputCount: number;
  passedCount: number;
  deferredCount: number;
  rejectedCount: number;
  mergedCount: number;
  retryCount: number;
  reasonCounts: Record<string, number>;
  detailsComplete: true;
};

export type ResearchLedgerPersistencePlan = {
  taskId: string;
  candidates: PlannedResearchCandidate[];
  stageSummaries: PlannedResearchStageSummary[];
};

export type PlanResearchLedgerInput = {
  taskId: string;
  results: readonly ComprehensiveCandidateResult[];
  summary: ComprehensiveDiscographySummary;
  sourceCandidates?: readonly ComprehensiveDiscographyCandidate[];
  now?: Date;
  priorCandidates?: ReadonlyMap<string, PriorCandidateState>;
  retryPolicy?: CoverRetryPolicy;
  /**
   * Explicit offline-quarantine instruction. These ids must have a deferred,
   * non-FOUND cover and null candidate URLs; unlike normal retries their stale
   * database cover columns must not be inherited from the prior row.
   */
  clearPersistedCoverCandidateIds?: ReadonlySet<string>;
};

function nonBlank(value: string | null | undefined) {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  return normalized || null;
}

function normalizedTaskId(value: string) {
  const taskId = nonBlank(value);
  if (!taskId || taskId.length > 200) {
    throw new TypeError("taskId must contain between 1 and 200 characters.");
  }
  return taskId;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function dateFromIso(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partialDate(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return { date: null, precision: null } as const;
  const precision = match[3] ? "DAY" as const : match[2] ? "MONTH" as const : "YEAR" as const;
  const date = new Date(`${match[1]}-${match[2] ?? "01"}-${match[3] ?? "01"}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? { date: null, precision: null } as const
    : { date, precision };
}

function validateRetryPolicy(policy: CoverRetryPolicy = {}) {
  const baseDelayMs = policy.baseDelayMs ?? DEFAULT_COVER_RETRY_BASE_MS;
  const maxDelayMs = policy.maxDelayMs ?? DEFAULT_COVER_RETRY_MAX_MS;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 1_000) {
    throw new TypeError("cover retry baseDelayMs must be at least 1000 milliseconds.");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new TypeError("cover retry maxDelayMs must be at least baseDelayMs.");
  }
  return { baseDelayMs: Math.trunc(baseDelayMs), maxDelayMs: Math.trunc(maxDelayMs) };
}

export function calculateCoverRetry(
  previousAttemptCount: number,
  now: Date,
  policy: CoverRetryPolicy = {},
) {
  const { baseDelayMs, maxDelayMs } = validateRetryPolicy(policy);
  const safePrevious = Number.isInteger(previousAttemptCount) && previousAttemptCount >= 0
    ? previousAttemptCount
    : 0;
  const attemptCount = safePrevious + 1;
  const exponent = Math.min(safePrevious, 30);
  const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
  return {
    attemptCount,
    delayMs,
    nextRetryAt: new Date(now.getTime() + delayMs),
  };
}

export function dispositionForResolution(
  resolution: ComprehensiveCandidateResult["resolution"],
): ResearchDisposition {
  if (resolution === "VERIFIED") return "ACCEPTED";
  if (resolution === "REJECTED") return "REJECTED";
  // OUT_OF_SCOPE is not a factual rejection. It can become eligible under a
  // different collection scope and therefore remains deferred.
  return "DEFERRED";
}

export function decisionOutcomeForLedgerEntry(
  entry: Pick<ComprehensiveLedgerEntry, "verdict" | "retryable">,
): ResearchDecisionOutcome {
  if (entry.verdict === "PASS") return "PASS";
  if (entry.verdict === "REJECT") return "REJECT";
  return entry.retryable ? "RETRY" : "DEFER";
}

export function sequenceAppendedDecisions(
  existing: readonly { sequence: number; stage: string; attempt: number }[],
  planned: readonly PlannedResearchDecision[],
): SequencedResearchDecision[] {
  let sequence = existing.reduce((maximum, decision) =>
    Math.max(maximum, decision.sequence), -1);
  const attemptsByStage = new Map<string, number>();
  for (const decision of existing) {
    attemptsByStage.set(
      decision.stage,
      Math.max(attemptsByStage.get(decision.stage) ?? 0, decision.attempt),
    );
  }
  const currentRunAttemptByStage = new Map<string, number>();
  return planned.map((decision) => {
    sequence += 1;
    const attempt = currentRunAttemptByStage.get(decision.stage) ??
      (attemptsByStage.get(decision.stage) ?? 0) + 1;
    currentRunAttemptByStage.set(decision.stage, attempt);
    return { ...decision, sequence, attempt };
  });
}

function finalLedgerEntry(result: ComprehensiveCandidateResult) {
  const targetVerdict = result.resolution === "VERIFIED"
    ? "PASS"
    : result.resolution === "REJECTED"
      ? "REJECT"
      : result.resolution === "OUT_OF_SCOPE"
        ? "OUT_OF_SCOPE"
        : "UNKNOWN";
  return [...result.ledger].reverse().find((entry) => entry.verdict === targetVerdict) ??
    result.ledger.at(-1) ?? null;
}

function appendedLedgerEntries(
  result: ComprehensiveCandidateResult,
  prior: PriorCandidateState | undefined,
) {
  if (!prior?.payload || typeof prior.payload !== "object" || Array.isArray(prior.payload)) {
    return result.ledger;
  }
  const priorLedger = (prior.payload as Record<string, unknown>).ledger;
  if (!Array.isArray(priorLedger)) return result.ledger;
  if (
    priorLedger.length > result.ledger.length ||
    priorLedger.some((entry, index) => stableJson(entry) !== stableJson(result.ledger[index]))
  ) {
    throw new TypeError(
      "A persisted research ledger update must preserve the complete prior ledger as an unchanged prefix.",
    );
  }
  return result.ledger.slice(priorLedger.length);
}

function inferredProvider(result: ComprehensiveCandidateResult) {
  const source = result.candidate.sources.find((candidateSource) => {
    try {
      return new URL(candidateSource.url).hostname.toLowerCase() === "musicbrainz.org";
    } catch {
      return false;
    }
  });
  if (source) return "musicbrainz";
  return result.cover?.status === "FOUND" ? result.cover.provider : null;
}

function coverState(
  result: ComprehensiveCandidateResult,
  prior: PriorCandidateState | undefined,
  now: Date,
  retryPolicy: CoverRetryPolicy | undefined,
  unchanged = false,
  clearPersistedCover = false,
) {
  if (clearPersistedCover && (
    result.resolution !== "PENDING_COVER" ||
    !result.cover ||
    result.cover.status === "FOUND" ||
    result.candidate.coverImageUrl !== null ||
    result.candidate.coverImageSourceUrl !== null
  )) {
    throw new TypeError(
      "An explicit persisted-cover clear requires a null, deferred candidate cover.",
    );
  }
  const previousAttempts = prior?.coverAttemptCount ?? 0;
  if (clearPersistedCover) {
    const deferredCover = result.cover;
    if (!deferredCover || deferredCover.status === "FOUND") {
      throw new TypeError("An explicit persisted-cover clear requires a deferred cover state.");
    }
    const { baseDelayMs, maxDelayMs } = validateRetryPolicy(retryPolicy);
    const delayMs = Math.min(
      maxDelayMs,
      baseDelayMs * (2 ** Math.min(Math.max(0, previousAttempts), 30)),
    );
    return {
      coverImageUrl: null,
      coverImageSourceUrl: null,
      coverStatus: "RETRY_WAIT" as const,
      coverProvider: null,
      coverCheckedAt: now,
      // Quarantine is a local correction, not a provider request.
      coverAttemptCount: previousAttempts,
      coverNextRetryAt: new Date(now.getTime() + delayMs),
      coverLastErrorCode: deferredCover.reasonCode,
      coverLastErrorMessage: deferredCover.reason,
    };
  }
  const needsFoundStateReconciliation = Boolean(
    prior && result.cover?.status === "FOUND" && prior.coverStatus !== "VALID",
  );
  if (unchanged && prior && !needsFoundStateReconciliation && !clearPersistedCover) {
    return {
      coverImageUrl: prior.coverImageUrl,
      coverImageSourceUrl: prior.coverImageSourceUrl,
      coverStatus: prior.coverStatus,
      coverProvider: prior.coverProvider,
      coverCheckedAt: prior.coverCheckedAt,
      coverAttemptCount: prior.coverAttemptCount,
      coverNextRetryAt: prior.coverNextRetryAt,
      coverLastErrorCode: prior.coverLastErrorCode ?? null,
      coverLastErrorMessage: prior.coverLastErrorMessage ?? null,
    };
  }
  const currentCoverEntries = result.ledger.filter((entry) => entry.stage === "COVER").length;
  const priorPayload = prior?.payload && typeof prior.payload === "object" && !Array.isArray(prior.payload)
    ? prior.payload as Record<string, unknown>
    : null;
  const priorLedger = Array.isArray(priorPayload?.ledger) ? priorPayload.ledger : [];
  const priorCoverEntries = priorLedger.filter((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as Record<string, unknown>).stage === "COVER").length;
  const attemptsInThisRun = prior
    ? Math.max(0, currentCoverEntries - priorCoverEntries)
    : Math.max(1, currentCoverEntries);
  if (prior && attemptsInThisRun === 0 && !needsFoundStateReconciliation && !clearPersistedCover) {
    return {
      coverImageUrl: prior.coverImageUrl,
      coverImageSourceUrl: prior.coverImageSourceUrl,
      coverStatus: prior.coverStatus,
      coverProvider: prior.coverProvider,
      coverCheckedAt: prior.coverCheckedAt,
      coverAttemptCount: prior.coverAttemptCount,
      coverNextRetryAt: prior.coverNextRetryAt,
      coverLastErrorCode: prior.coverLastErrorCode ?? null,
      coverLastErrorMessage: prior.coverLastErrorMessage ?? null,
    };
  }
  if (result.cover?.status === "FOUND") {
    return {
      coverImageUrl: result.cover.imageUrl,
      coverImageSourceUrl: result.cover.sourceUrl,
      coverStatus: "VALID" as const,
      coverProvider: result.cover.provider,
      coverCheckedAt: dateFromIso(result.cover.checkedAt) ?? now,
      coverAttemptCount: previousAttempts + attemptsInThisRun,
      coverNextRetryAt: null,
      coverLastErrorCode: null,
      coverLastErrorMessage: null,
    };
  }

  if (result.cover) {
    const shouldRetry = result.cover.retryable || result.cover.status === "MISSING";
    const retry = shouldRetry
      ? calculateCoverRetry(
          previousAttempts + attemptsInThisRun - 1,
          now,
          retryPolicy,
        )
      : null;
    return {
      coverImageUrl: clearPersistedCover
        ? null
        : result.candidate.coverImageUrl ?? prior?.coverImageUrl ?? null,
      coverImageSourceUrl: clearPersistedCover
        ? null
        : result.candidate.coverImageSourceUrl ?? prior?.coverImageSourceUrl ?? null,
      coverStatus: retry ? "RETRY_WAIT" as const : "INVALID" as const,
      coverProvider: clearPersistedCover ? null : prior?.coverProvider ?? null,
      coverCheckedAt: now,
      coverAttemptCount: retry?.attemptCount ?? previousAttempts + attemptsInThisRun,
      coverNextRetryAt: retry?.nextRetryAt ?? null,
      coverLastErrorCode: result.cover.reasonCode,
      coverLastErrorMessage: result.cover.reason,
    };
  }

  return {
    coverImageUrl: clearPersistedCover
      ? null
      : result.candidate.coverImageUrl ?? prior?.coverImageUrl ?? null,
    coverImageSourceUrl: clearPersistedCover
      ? null
      : result.candidate.coverImageSourceUrl ?? prior?.coverImageSourceUrl ?? null,
    coverStatus: prior?.coverStatus ?? (result.candidate.coverImageUrl ? "QUEUED" as const : "MISSING" as const),
    coverProvider: clearPersistedCover ? null : prior?.coverProvider ?? null,
    coverCheckedAt: prior?.coverCheckedAt ?? null,
    coverAttemptCount: previousAttempts,
    coverNextRetryAt: prior?.coverNextRetryAt ?? null,
    coverLastErrorCode: prior?.coverLastErrorCode ?? null,
    coverLastErrorMessage: prior?.coverLastErrorMessage ?? null,
  };
}

function summarizeResults(results: readonly ComprehensiveCandidateResult[]): ComprehensiveDiscographySummary {
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

function assertSummaryMatches(
  results: readonly ComprehensiveCandidateResult[],
  supplied: ComprehensiveDiscographySummary,
) {
  const actual = summarizeResults(results);
  for (const key of Object.keys(actual) as Array<keyof ComprehensiveDiscographySummary>) {
    if (actual[key] !== supplied[key]) {
      throw new TypeError(`Comprehensive summary ${key} does not match its candidate results.`);
    }
  }
}

type StageAccumulator = {
  candidateIds: Set<string>;
  passed: Set<string>;
  deferred: Set<string>;
  excluded: Set<string>;
  rejected: Set<string>;
  retried: Set<string>;
  reasonCounts: Record<string, number>;
};

function stageSummaries(
  results: readonly ComprehensiveCandidateResult[],
  summary: ComprehensiveDiscographySummary,
) {
  const stages = new Map<string, StageAccumulator>();
  for (const result of results) {
    const lastCoverIndex = result.ledger.findLastIndex((entry) => entry.stage === "COVER");
    for (const [entryIndex, entry] of result.ledger.entries()) {
      // Cover history is append-only, but the terminal cover gate is the last
      // observation for that candidate. A stale historical PASS must not win
      // over a later quarantine or retry miss.
      if (entry.stage === "COVER" && entryIndex !== lastCoverIndex) continue;
      const accumulator = stages.get(entry.stage) ?? {
        candidateIds: new Set<string>(),
        passed: new Set<string>(),
        deferred: new Set<string>(),
        excluded: new Set<string>(),
        rejected: new Set<string>(),
        retried: new Set<string>(),
        reasonCounts: {},
      };
      const candidateId = result.candidate.id;
      accumulator.candidateIds.add(candidateId);
      accumulator.reasonCounts[entry.reasonCode] =
        (accumulator.reasonCounts[entry.reasonCode] ?? 0) + 1;
      if (
        entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON &&
        entry.verdict === "UNKNOWN"
      ) {
        accumulator.rejected.delete(candidateId);
        accumulator.passed.delete(candidateId);
        accumulator.excluded.delete(candidateId);
        accumulator.deferred.add(candidateId);
      } else if (entry.verdict === "REJECT") {
        accumulator.rejected.add(candidateId);
        accumulator.passed.delete(candidateId);
        accumulator.deferred.delete(candidateId);
        accumulator.excluded.delete(candidateId);
      } else if (entry.verdict === "UNKNOWN" || entry.verdict === "OUT_OF_SCOPE") {
        if (entry.stage === "SCOPE" && entry.verdict === "OUT_OF_SCOPE") {
          accumulator.excluded.add(candidateId);
          accumulator.deferred.add(candidateId);
          accumulator.passed.delete(candidateId);
        }
        if (
          !accumulator.rejected.has(candidateId) &&
          !accumulator.passed.has(candidateId) &&
          !accumulator.excluded.has(candidateId)
        ) {
          accumulator.deferred.add(candidateId);
        }
        if (entry.retryable) accumulator.retried.add(candidateId);
      } else if (
        !accumulator.rejected.has(candidateId) &&
        !accumulator.excluded.has(candidateId)
      ) {
        accumulator.passed.add(candidateId);
        accumulator.deferred.delete(candidateId);
      }
      stages.set(entry.stage, accumulator);
    }
  }

  const summaries: PlannedResearchStageSummary[] = [...stages.entries()].map(([stage, value]) => ({
    stage,
    sequence: stageSequence[stage as keyof typeof stageSequence] ?? 106,
    inputCount: value.candidateIds.size,
    passedCount: value.passed.size,
    deferredCount: value.deferred.size,
    rejectedCount: value.rejected.size,
    mergedCount: 0,
    retryCount: value.retried.size,
    reasonCounts: value.reasonCounts,
    detailsComplete: true,
  }));
  summaries.push({
    stage: "RESOLUTION",
    sequence: stageSequence.RESOLUTION,
    inputCount: summary.totalCandidates,
    passedCount: summary.verified,
    deferredCount: summary.pendingEvidence + summary.pendingCover + summary.outOfScope,
    rejectedCount: summary.rejected,
    mergedCount: 0,
    retryCount: results.filter((result) => result.ledger.some((entry) => entry.retryable)).length,
    reasonCounts: {
      VERIFIED: summary.verified,
      PENDING_EVIDENCE: summary.pendingEvidence,
      PENDING_COVER: summary.pendingCover,
      REJECTED: summary.rejected,
      OUT_OF_SCOPE: summary.outOfScope,
    },
    detailsComplete: true,
  });
  return summaries.sort((left, right) => left.sequence - right.sequence || left.stage.localeCompare(right.stage));
}

export function planResearchLedgerPersistence(
  input: PlanResearchLedgerInput,
): ResearchLedgerPersistencePlan {
  const taskId = normalizedTaskId(input.taskId);
  assertSummaryMatches(input.results, input.summary);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("now must be a valid Date.");
  validateRetryPolicy(input.retryPolicy);

  const candidateIds = input.results.map((result) => nonBlank(result.candidate.id));
  if (candidateIds.some((candidateId) => !candidateId) ||
      new Set(candidateIds).size !== candidateIds.length) {
    throw new TypeError("Comprehensive results require unique, non-empty candidate ids.");
  }
  const resultCandidateIds = new Set(candidateIds as string[]);
  for (const candidateId of input.clearPersistedCoverCandidateIds ?? []) {
    if (!resultCandidateIds.has(candidateId)) {
      throw new TypeError("An explicit persisted-cover clear references an unknown candidate id.");
    }
  }
  const sourceCandidates = new Map<string, ComprehensiveDiscographyCandidate>();
  for (const sourceCandidate of input.sourceCandidates ?? []) {
    const sourceId = nonBlank(sourceCandidate.candidate.id);
    if (!sourceId || sourceCandidates.has(sourceId)) {
      throw new TypeError("Persisted source candidates require unique, non-empty candidate ids.");
    }
    sourceCandidates.set(sourceId, sourceCandidate);
  }

  const candidates = input.results.map((result) => {
    const candidateKey = nonBlank(result.candidate.id)!;
    const lastEntry = finalLedgerEntry(result);
    if (!lastEntry) {
      throw new TypeError(`Comprehensive candidate ${candidateKey} has no audit ledger entries.`);
    }
    const date = partialDate(result.candidate.releaseDate);
    const prior = input.priorCandidates?.get(candidateKey);
    const sourceCandidate = sourceCandidates.get(candidateKey);
    const payload = {
      schemaVersion: sourceCandidate ? 2 : 1,
      externalWorkId: result.workId,
      externalEditionId: result.editionId,
      candidate: result.candidate,
      ...(sourceCandidate ? { sourceCandidate } : {}),
      evidenceVerdict: result.evidenceVerdict,
      aiDecision: result.aiDecision,
      cover: result.cover,
      resolution: result.resolution,
      ledger: result.ledger,
    };
    const unchanged = prior?.payload !== undefined &&
      stableJson(prior.payload) === stableJson(payload);
    const cover = coverState(
      result,
      prior,
      now,
      input.retryPolicy,
      unchanged,
      input.clearPersistedCoverCandidateIds?.has(candidateKey) ?? false,
    );
    const decisions: PlannedResearchDecision[] = unchanged ? [] : appendedLedgerEntries(result, prior).map((entry) => ({
      stage: entry.stage,
      outcome: decisionOutcomeForLedgerEntry(entry),
      reasonCode: entry.reasonCode,
      reasonText: entry.message,
      retryable: entry.retryable,
      evidence: {
        sourceUrls: [...entry.sourceUrls],
        conflictIds: [...entry.conflictIds],
        resolution: result.resolution,
        externalWorkId: result.workId,
        externalEditionId: result.editionId,
      },
    }));
    return {
      candidateKey,
      entityKind: "EDITION" as const,
      sourceProvider: inferredProvider(result),
      sourceRecordId: result.editionId,
      title: result.candidate.title,
      category: result.candidate.category,
      artistCredit: result.candidate.artistCredit,
      releaseDate: date.date,
      datePrecision: date.precision,
      catalogNumber: result.candidate.catalogNumber,
      barcode: result.candidate.barcode,
      payload,
      disposition: dispositionForResolution(result.resolution),
      lastStage: lastEntry.stage,
      finalReasonCode: lastEntry.reasonCode,
      retryable: result.ledger.some((entry) => entry.retryable),
      ...cover,
      decisions,
    } satisfies PlannedResearchCandidate;
  });

  return {
    taskId,
    candidates,
    stageSummaries: stageSummaries(input.results, input.summary),
  };
}

export type ResearchTaskProgressInput = {
  progress: number;
  stage: string;
  status?: AiSearchTaskStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

export function buildResearchTaskProgressUpdate(
  input: ResearchTaskProgressInput,
  now = new Date(),
) {
  if (!Number.isFinite(input.progress)) throw new TypeError("progress must be a finite number.");
  const stage = nonBlank(input.stage);
  if (!stage || stage.length > 500) throw new TypeError("stage must contain between 1 and 500 characters.");
  const status = input.status;
  const terminal = status === "SUCCEEDED" || status === "FAILED";
  return {
    progress: Math.max(0, Math.min(100, Math.round(input.progress))),
    stage,
    status,
    startedAt: input.startedAt === undefined
      ? status === "RUNNING" ? now : undefined
      : input.startedAt,
    completedAt: input.completedAt === undefined
      ? terminal ? now : undefined
      : input.completedAt,
  };
}

export async function updateResearchTaskProgress(
  database: PrismaClient,
  taskId: string,
  input: ResearchTaskProgressInput,
) {
  return database.aiSearchTask.update({
    where: { id: normalizedTaskId(taskId) },
    data: buildResearchTaskProgressUpdate(input),
  });
}

export type PersistResearchLedgerOptions = {
  now?: Date;
  retryPolicy?: CoverRetryPolicy;
  sourceCandidates?: readonly ComprehensiveDiscographyCandidate[];
  clearPersistedCoverCandidateIds?: ReadonlySet<string>;
};

/**
 * Persist a complete research ledger using the caller's transaction. Keeping
 * this entry point separate lets background reconciliation update the task's
 * public result in the same commit as its candidate/decision rows.
 */
export async function persistResearchLedgerInTransaction(
  database: Prisma.TransactionClient,
  taskId: string,
  results: readonly ComprehensiveCandidateResult[],
  summary: ComprehensiveDiscographySummary,
  options: PersistResearchLedgerOptions = {},
) {
  const normalizedId = normalizedTaskId(taskId);
  const now = options.now ?? new Date();

  // PostgreSQL exposes advisory-lock functions as `void`. Prisma cannot
  // deserialize that pseudo-type, so cast the selected value while keeping
  // the lock scoped to this transaction.
  await acquireResearchLedgerTaskLock(database, normalizedId);
  const existingCandidates = await database.researchCandidate.findMany({
      where: { taskId: normalizedId },
      select: {
        candidateKey: true,
        payload: true,
        coverAttemptCount: true,
        coverStatus: true,
        coverNextRetryAt: true,
        coverImageUrl: true,
        coverImageSourceUrl: true,
        coverProvider: true,
        coverCheckedAt: true,
        coverLastErrorCode: true,
        coverLastErrorMessage: true,
      },
    });
    const priorCandidates = new Map(existingCandidates.map((candidate) => [candidate.candidateKey, candidate]));
    const plan = planResearchLedgerPersistence({
      taskId: normalizedId,
      results,
      summary,
      sourceCandidates: options.sourceCandidates,
      now,
      retryPolicy: options.retryPolicy,
      priorCandidates,
      clearPersistedCoverCandidateIds: options.clearPersistedCoverCandidateIds,
    });
    let decisionsAppended = 0;
    const persistedCandidates: Array<{
      id: string;
      candidate: PlannedResearchCandidate;
    }> = [];

    for (const candidate of plan.candidates) {
      const row = await database.researchCandidate.upsert({
        where: {
          taskId_candidateKey: {
            taskId: normalizedId,
            candidateKey: candidate.candidateKey,
          },
        },
        create: {
          taskId: normalizedId,
          candidateKey: candidate.candidateKey,
          entityKind: candidate.entityKind,
          sourceProvider: candidate.sourceProvider,
          sourceRecordId: candidate.sourceRecordId,
          title: candidate.title,
          category: candidate.category,
          artistCredit: candidate.artistCredit,
          releaseDate: candidate.releaseDate,
          datePrecision: candidate.datePrecision,
          catalogNumber: candidate.catalogNumber,
          barcode: candidate.barcode,
          payload: jsonValue(candidate.payload),
          disposition: candidate.disposition,
          lastStage: candidate.lastStage,
          finalReasonCode: candidate.finalReasonCode,
          retryable: candidate.retryable,
          coverImageUrl: candidate.coverImageUrl,
          coverImageSourceUrl: candidate.coverImageSourceUrl,
          coverStatus: candidate.coverStatus,
          coverProvider: candidate.coverProvider,
          coverCheckedAt: candidate.coverCheckedAt,
          coverAttemptCount: candidate.coverAttemptCount,
          coverNextRetryAt: candidate.coverNextRetryAt,
          coverLastErrorCode: candidate.coverLastErrorCode,
          coverLastErrorMessage: candidate.coverLastErrorMessage,
        },
        update: {
          sourceProvider: candidate.sourceProvider,
          sourceRecordId: candidate.sourceRecordId,
          title: candidate.title,
          category: candidate.category,
          artistCredit: candidate.artistCredit,
          releaseDate: candidate.releaseDate,
          datePrecision: candidate.datePrecision,
          catalogNumber: candidate.catalogNumber,
          barcode: candidate.barcode,
          payload: jsonValue(candidate.payload),
          disposition: candidate.disposition,
          lastStage: candidate.lastStage,
          finalReasonCode: candidate.finalReasonCode,
          retryable: candidate.retryable,
          coverImageUrl: candidate.coverImageUrl,
          coverImageSourceUrl: candidate.coverImageSourceUrl,
          coverStatus: candidate.coverStatus,
          coverProvider: candidate.coverProvider,
          coverCheckedAt: candidate.coverCheckedAt,
          coverAttemptCount: candidate.coverAttemptCount,
          coverNextRetryAt: candidate.coverNextRetryAt,
          coverLastErrorCode: candidate.coverLastErrorCode,
          coverLastErrorMessage: candidate.coverLastErrorMessage,
        },
      });
      persistedCandidates.push({ id: row.id, candidate });
    }

    const existingDecisionRows = persistedCandidates.length > 0
      ? await database.researchDecision.findMany({
          where: { candidateId: { in: persistedCandidates.map((item) => item.id) } },
          orderBy: [{ candidateId: "asc" }, { sequence: "asc" }],
          select: { candidateId: true, sequence: true, stage: true, attempt: true },
        })
      : [];
    const existingByCandidate = new Map<string, typeof existingDecisionRows>();
    for (const decision of existingDecisionRows) {
      const values = existingByCandidate.get(decision.candidateId) ?? [];
      values.push(decision);
      existingByCandidate.set(decision.candidateId, values);
    }
    const decisionRows = persistedCandidates.flatMap(({ id, candidate }) =>
      sequenceAppendedDecisions(existingByCandidate.get(id) ?? [], candidate.decisions)
        .map((decision) => ({
          candidateId: id,
          sequence: decision.sequence,
          attempt: decision.attempt,
          stage: decision.stage,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
          reasonText: decision.reasonText,
          retryable: decision.retryable,
          evidence: jsonValue(decision.evidence),
        })));
    for (let offset = 0; offset < decisionRows.length; offset += 500) {
      const created = await database.researchDecision.createMany({
        data: decisionRows.slice(offset, offset + 500),
      });
      decisionsAppended += created.count;
    }

    for (const stage of plan.stageSummaries) {
      await database.researchStageSummary.upsert({
        where: { taskId_stage: { taskId: normalizedId, stage: stage.stage } },
        create: {
          taskId: normalizedId,
          ...stage,
          reasonCounts: jsonValue(stage.reasonCounts),
          startedAt: now,
          completedAt: now,
        },
        update: {
          sequence: stage.sequence,
          inputCount: stage.inputCount,
          passedCount: stage.passedCount,
          deferredCount: stage.deferredCount,
          rejectedCount: stage.rejectedCount,
          mergedCount: stage.mergedCount,
          retryCount: stage.retryCount,
          reasonCounts: jsonValue(stage.reasonCounts),
          detailsComplete: true,
          completedAt: now,
        },
      });
    }

    await database.aiSearchTask.update({
      where: { id: normalizedId },
      data: {
        pipelineVersion: "multi-source-v2",
        resultSchemaVersion: 2,
      },
    });

  return {
    candidatesUpserted: plan.candidates.length,
    decisionsAppended,
    stageSummariesUpserted: plan.stageSummaries.length,
  };
}

export async function persistResearchLedger(
  database: PrismaClient,
  taskId: string,
  results: readonly ComprehensiveCandidateResult[],
  summary: ComprehensiveDiscographySummary,
  options: PersistResearchLedgerOptions = {},
) {
  return database.$transaction(
    (transaction) => persistResearchLedgerInTransaction(
      transaction,
      taskId,
      results,
      summary,
      options,
    ),
    { maxWait: 10_000, timeout: 120_000 },
  );
}
