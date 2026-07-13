import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  retryComprehensiveCovers,
  summarizeComprehensiveDiscography,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
  type ComprehensiveDiscographyOutput,
} from "@/lib/ai/comprehensive-discography";
import {
  assertCompletePersistedComprehensiveCandidateBinding,
  assertCompleteVerifiedComprehensiveCandidate,
  buildComprehensiveReleaseResearchResult,
  normalizeLegacySelectionOutOfScopeResult,
} from "@/lib/ai/comprehensive-release-result";
import { parseReleaseResearchRequest } from "@/lib/ai/release-research-input";
import {
  calculateCoverRetry,
  persistResearchLedgerInTransaction,
} from "@/lib/ai/research-ledger-persistence";
import type { ReleaseResearchResult } from "@/lib/ai/release-research-types";
import { createPersistedCoverRetryLookup } from "@/lib/ai/comprehensive-source-adapters";
import { acquireResearchLedgerTaskLock } from "@/lib/ai/research-task-lock";
import type { ArtistReleaseEvidenceBundle } from "@/lib/music-metadata/types";
import { prisma } from "@/lib/db/prisma";

const TASK_BATCH_SIZE = 1;
const DEFAULT_CANDIDATE_BATCH_SIZE = 8;
const MAX_CANDIDATE_BATCH_SIZE = 64;
const CLAIM_LEASE_MS = 60 * 60_000;
const CLAIM_ERROR_PREFIX = "SCHEDULED_COVER_RETRY_CLAIM:";

const boundCandidateIdentityFields = [
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

type PersistedCoverRetryState = {
  result: ComprehensiveCandidateResult;
  sourceCandidate: ComprehensiveDiscographyCandidate;
};

type PersistedCandidateResultState = {
  payload: Record<string, unknown>;
  result: ComprehensiveCandidateResult;
};

type LockedCoverRetryTaskGate = {
  status: string;
  pipelineVersion: string;
  resultSchemaVersion: number;
  importedAt: Date | null;
  artistId: string | null;
};

type LockedCoverRetryCandidateGate = {
  releaseId: string | null;
  coverStatus: string;
  coverNextRetryAt: Date | null;
};

export function isLockedCoverRetryTaskEligible(
  task: LockedCoverRetryTaskGate | null,
): task is LockedCoverRetryTaskGate {
  return Boolean(
    task &&
    task.status === "SUCCEEDED" &&
    task.pipelineVersion === "multi-source-v2" &&
    task.resultSchemaVersion === 2 &&
    task.importedAt === null &&
    task.artistId === null,
  );
}

export function isLockedCoverRetryCandidateDue(
  candidate: LockedCoverRetryCandidateGate,
  now: Date,
) {
  return candidate.releaseId === null &&
    (candidate.coverStatus === "RETRY_WAIT" || candidate.coverStatus === "CHECKING") &&
    candidate.coverNextRetryAt !== null &&
    candidate.coverNextRetryAt <= now;
}

export function assertScheduledCoverRetryClaimOwnership(
  ownedClaims: number,
  expectedClaims: number,
) {
  if (ownedClaims !== expectedClaims) {
    throw new TypeError("The scheduled cover retry claim expired before it could be persisted.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizedIdentityValue(value: unknown) {
  return value === undefined ? null : value;
}

function hasBoundCandidateIdentity(
  resultCandidate: Record<string, unknown>,
  sourceCandidate: Record<string, unknown>,
) {
  return boundCandidateIdentityFields.every((field) =>
    JSON.stringify(normalizedIdentityValue(resultCandidate[field])) ===
      JSON.stringify(normalizedIdentityValue(sourceCandidate[field])));
}

function isReleaseResearchResult(value: unknown): value is ReleaseResearchResult {
  const candidate = record(value);
  const artist = record(candidate?.artist);
  return candidate?.pipelineVersion === "multi-source-v2" &&
    Boolean(nonBlankString(artist?.name)) &&
    Array.isArray(candidate?.releases) &&
    Array.isArray(candidate?.globalWarnings);
}

function isEvidenceBundle(value: unknown): value is ArtistReleaseEvidenceBundle {
  const candidate = record(value);
  return Boolean(record(candidate?.query)) &&
    Array.isArray(candidate?.releases) &&
    Array.isArray(candidate?.sourceWhitelist) &&
    Array.isArray(candidate?.warnings) &&
    Boolean(record(candidate?.stats));
}

/**
 * Decode only payloads written by research-ledger-persistence schema v2.
 * Legacy rows are reconstructed from their original public evidence bundle
 * by the task-level worker; this decoder never guesses identity observations.
 */
export function parsePersistedCoverRetryState(
  value: unknown,
  expectedCandidateId?: string,
): PersistedCoverRetryState {
  const parsed = parsePersistedSchemaV2CandidateState(value, expectedCandidateId);
  assertCompleteVerifiedComprehensiveCandidate(parsed.result, parsed.sourceCandidate);
  return parsed;
}

/**
 * Decode a complete schema-v2 candidate/source pair without assuming that a
 * legacy VERIFIED conclusion is still publishable under the current policy.
 * Offline rematerialization uses this boundary before deterministic
 * quarantine; the cover worker adds the stricter publication assertion above.
 */
export function parsePersistedSchemaV2CandidateState(
  value: unknown,
  expectedCandidateId?: string,
): PersistedCoverRetryState {
  const parsed = parsePersistedCandidateResultState(value, expectedCandidateId);
  const payload = parsed.payload;
  const resultCandidate = record(payload?.candidate)!;
  const sourceCandidate = record(payload?.sourceCandidate);
  const sourceRelease = record(sourceCandidate?.candidate);
  const candidateId = parsed.result.candidate.id;
  const sourceCandidateId = nonBlankString(sourceRelease?.id);

  if (
    payload?.schemaVersion !== 2 ||
    !sourceRelease ||
    !sourceCandidateId ||
    candidateId !== sourceCandidateId ||
    sourceCandidate?.workId !== parsed.result.workId ||
    sourceCandidate?.editionId !== parsed.result.editionId ||
    !hasBoundCandidateIdentity(resultCandidate, sourceRelease) ||
    !Array.isArray(sourceCandidate?.observations) ||
    !Array.isArray(sourceCandidate?.conflicts)
  ) {
    throw new TypeError("The persisted research candidate is not a complete cover-retry schema v2 row.");
  }

  const typedSourceCandidate = sourceCandidate as unknown as ComprehensiveDiscographyCandidate;
  assertCompletePersistedComprehensiveCandidateBinding(parsed.result, typedSourceCandidate);
  return {
    result: parsed.result,
    sourceCandidate: typedSourceCandidate,
  };
}

export function parsePersistedCandidateResultState(
  value: unknown,
  expectedCandidateId?: string,
): PersistedCandidateResultState {
  const payload = record(value);
  const resultCandidate = record(payload?.candidate);
  const candidateId = nonBlankString(resultCandidate?.id);
  const workId = nonBlankString(payload?.externalWorkId);
  const editionId = nonBlankString(payload?.externalEditionId);
  const resolution = payload?.resolution;
  const evidenceVerdict = payload?.evidenceVerdict;
  const ledger = Array.isArray(payload?.ledger)
    ? payload.ledger
    : payload?.schemaVersion === 1
      ? []
      : null;
  if (
    !payload ||
    (payload.schemaVersion !== 1 && payload.schemaVersion !== 2) ||
    !candidateId ||
    (expectedCandidateId && candidateId !== expectedCandidateId) ||
    !workId ||
    !editionId ||
    ledger === null ||
    !["VERIFIED", "PENDING_EVIDENCE", "PENDING_COVER", "REJECTED", "OUT_OF_SCOPE"].includes(
      String(resolution),
    ) ||
    !["PASS", "UNKNOWN", "REJECT", "OUT_OF_SCOPE"].includes(String(evidenceVerdict))
  ) {
    throw new TypeError("The persisted research candidate result is incomplete or invalid.");
  }
  return {
    payload,
    result: {
      candidate: resultCandidate as unknown as ComprehensiveCandidateResult["candidate"],
      workId,
      editionId,
      resolution: resolution as ComprehensiveCandidateResult["resolution"],
      evidenceVerdict: evidenceVerdict as ComprehensiveCandidateResult["evidenceVerdict"],
      aiDecision: (payload.aiDecision ?? null) as ComprehensiveCandidateResult["aiDecision"],
      cover: (payload.cover ?? null) as ComprehensiveCandidateResult["cover"],
      ledger: ledger as unknown as ComprehensiveCandidateResult["ledger"],
    },
  };
}

function outputFromResults(results: readonly ComprehensiveCandidateResult[]): ComprehensiveDiscographyOutput {
  const copied = [...results];
  return {
    results: copied,
    verifiedCandidates: copied
      .filter((result) => result.resolution === "VERIFIED")
      .map((result) => result.candidate),
    summary: summarizeComprehensiveDiscography(copied),
  };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function sanitizeScheduledCoverRetryError(error: unknown) {
  let message = error instanceof Error ? error.message : "Scheduled cover retry failed.";
  const secrets = [
    process.env.OPENAI_API_KEY,
    process.env.AI_GATEWAY_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
    process.env.DATABASE_URL,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.AUTH_GITHUB_SECRET,
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 4));
  for (const secret of secrets) message = message.split(secret).join("[redacted]");
  return message
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{4,}\b/gu, "sk-[redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\b(?:https?|postgres(?:ql)?):\/\/[^\s]+/giu, "[redacted-url]")
    .slice(0, 1_000);
}

export function buildCompletedPendingCoverRetryUpdate(
  previousAttemptCount: number,
  completedAt: Date,
  cover: ComprehensiveCandidateResult["cover"],
) {
  if (Number.isNaN(completedAt.getTime())) {
    throw new TypeError("A completed cover retry requires a valid completion time.");
  }
  const retry = calculateCoverRetry(previousAttemptCount, completedAt);
  const unresolvedCover = cover?.status === "FOUND" ? null : cover;
  const reasonCode = unresolvedCover?.reasonCode &&
    /^[A-Z0-9_]{1,128}$/u.test(unresolvedCover.reasonCode)
    ? unresolvedCover.reasonCode
    : "SCHEDULED_COVER_RETRY_PENDING";
  const reason = unresolvedCover?.reason?.trim()
    ? sanitizeScheduledCoverRetryError(new Error(unresolvedCover.reason))
    : "No exact validated cover was found during the scheduled retry.";
  return {
    coverStatus: "RETRY_WAIT" as const,
    coverCheckedAt: completedAt,
    coverAttemptCount: retry.attemptCount,
    coverNextRetryAt: retry.nextRetryAt,
    coverLastErrorCode: reasonCode,
    coverLastErrorMessage: reason,
  };
}

async function deferFailedCandidates(
  candidates: readonly {
    id: string;
    coverAttemptCount: number;
  }[],
  now: Date,
  error: unknown,
  claimToken: string,
) {
  const message = sanitizeScheduledCoverRetryError(error);
  await Promise.all(candidates.map((candidate) => {
    const retry = calculateCoverRetry(candidate.coverAttemptCount, now);
    return prisma.researchCandidate.updateMany({
      where: {
        id: candidate.id,
        coverStatus: "CHECKING",
        coverLastErrorCode: claimToken,
      },
      data: {
        coverStatus: "RETRY_WAIT",
        coverAttemptCount: retry.attemptCount,
        coverNextRetryAt: retry.nextRetryAt,
        coverLastErrorCode: "SCHEDULED_COVER_RETRY_FAILED",
        coverLastErrorMessage: message,
      },
    });
  }));
}

async function claimDueCandidates(
  taskId: string,
  now: Date,
  candidateBatchSize: number,
) {
  return prisma.$transaction(async (transaction) => {
    await acquireResearchLedgerTaskLock(transaction, taskId);
    const task = await transaction.aiSearchTask.findUnique({
      where: { id: taskId },
      include: { candidates: { orderBy: { candidateKey: "asc" } } },
    });
    if (!isLockedCoverRetryTaskEligible(task)) {
      return { task: null, claimToken: "", candidates: [] };
    }
    const candidates = task.candidates
      .filter((candidate) => isLockedCoverRetryCandidateDue(candidate, now))
      .sort((left, right) =>
        left.coverNextRetryAt!.getTime() - right.coverNextRetryAt!.getTime() ||
        left.candidateKey.localeCompare(right.candidateKey))
      .slice(0, candidateBatchSize);
    if (candidates.length === 0) return { task, claimToken: "", candidates: [] };

    const claimToken = `${CLAIM_ERROR_PREFIX}${randomUUID()}`;
    const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
    const candidateIds = candidates.map((candidate) => candidate.id);
    await transaction.researchCandidate.updateMany({
      where: {
        id: { in: candidateIds },
        taskId,
        releaseId: null,
        coverStatus: { in: ["RETRY_WAIT", "CHECKING"] },
        coverNextRetryAt: { lte: now },
      },
      data: {
        coverStatus: "CHECKING",
        coverNextRetryAt: leaseUntil,
        coverLastErrorCode: claimToken,
        coverLastErrorMessage: null,
      },
    });
    const claimed = await transaction.researchCandidate.findMany({
      where: {
        id: { in: candidateIds },
        taskId,
        releaseId: null,
        coverStatus: "CHECKING",
        coverLastErrorCode: claimToken,
      },
      select: { id: true },
    });
    const claimedIds = new Set(claimed.map((candidate) => candidate.id));
    return {
      task,
      claimToken,
      candidates: candidates.filter((candidate) => claimedIds.has(candidate.id)),
    };
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function retryTaskCovers(
  discoveredTask: Awaited<ReturnType<typeof findDueTasks>>[number],
  now: Date,
  candidateBatchSize: number,
  onProgress?: ScheduledCoverRetryBatchOptions["onProgress"],
) {
  const claim = await claimDueCandidates(discoveredTask.id, now, candidateBatchSize);
  const dueRows = claim.candidates;
  const task = claim.task;
  if (!task || dueRows.length === 0) {
    return { taskId: discoveredTask.id, attempted: 0, found: 0, pending: 0 };
  }

  try {
    const request = parseReleaseResearchRequest(task.request);
    if (!isReleaseResearchResult(task.parsedResult)) {
      throw new TypeError("The research task has no complete multi-source-v2 result.");
    }
    const rawResult = record(task.rawResult);
    if (!isEvidenceBundle(rawResult?.evidence)) {
      throw new TypeError("The research task has no persisted public-source evidence bundle.");
    }

    const states = task.candidates.map((candidate) => {
      const parsed = parsePersistedCandidateResultState(candidate.payload, candidate.candidateKey);
      const sourceCandidate = parsed.payload.schemaVersion === 2
        ? parsePersistedCoverRetryState(candidate.payload, candidate.candidateKey).sourceCandidate
        : null;
      return {
        ...parsed,
        result: normalizeLegacySelectionOutOfScopeResult(parsed.result),
        sourceCandidate,
      };
    });
    const stateById = new Map(states.map((state) => [state.result.candidate.id, state]));
    const dueIds = new Set(dueRows.map((candidate) => candidate.candidateKey));
    const pendingDueIds = new Set([...dueIds].filter((candidateId) =>
      stateById.get(candidateId)?.result.resolution === "PENDING_COVER" &&
      stateById.get(candidateId)?.sourceCandidate !== null));
    const terminalDueRows = dueRows
      .filter((candidate) => !pendingDueIds.has(candidate.candidateKey));
    const terminalDueRowIds = terminalDueRows
      .map((candidate) => candidate.id);
    let lastProgressKey: string | null = null;
    const reportProgress = async (progress: Omit<ScheduledCoverRetryProgress, "taskId">) => {
      const update = { taskId: task.id, ...progress };
      const key = `${update.completed}:${update.total}:${update.found}:${update.pending}`;
      if (key === lastProgressKey) return;
      lastProgressKey = key;
      await onProgress?.(update);
    };
    await reportProgress({
      completed: 0,
      total: pendingDueIds.size,
      found: 0,
      pending: 0,
    });

    const persistedSources = states.flatMap((state) => state.sourceCandidate ? [state.sourceCandidate] : []);
    let output = outputFromResults(states.map((state) => state.result));
    if (pendingDueIds.size > 0) {
      const persistedById = new Map(persistedSources.map((candidate) => [
        candidate.candidate.id,
        candidate,
      ]));
      for (const candidateId of pendingDueIds) {
        const state = stateById.get(candidateId)!;
        const persisted = persistedById.get(candidateId);
        if (
          !persisted ||
          persisted.workId !== state.result.workId ||
          persisted.editionId !== state.result.editionId
        ) {
          throw new TypeError(
            "A scheduled cover retry requires the exact persisted schema-v2 work and edition identity.",
          );
        }
      }
      const lookupPersistedCover = createPersistedCoverRetryLookup({
        candidates: persistedSources,
        results: states.map((state) => state.result),
        bundle: rawResult.evidence,
      });
      output = await retryComprehensiveCovers(
        output,
        persistedSources,
        lookupPersistedCover,
        {
          maxRounds: 1,
          concurrency: 4,
          includeMissing: true,
          candidateIds: pendingDueIds,
          onProgress: ({ processed, total, found, pending }) => reportProgress({
            completed: processed,
            total,
            found,
            pending,
          }),
        },
      );
    }

    const completedAt = new Date(Math.max(now.getTime(), Date.now()));
    const nextResult = buildComprehensiveReleaseResearchResult(
      request,
      task.parsedResult,
      rawResult.evidence,
      output,
      completedAt,
    );
    await prisma.$transaction(async (transaction) => {
      await acquireResearchLedgerTaskLock(transaction, task.id);
      const ownedClaims = await transaction.researchCandidate.count({
        where: {
          id: { in: dueRows.map((candidate) => candidate.id) },
          coverStatus: "CHECKING",
          coverLastErrorCode: claim.claimToken,
        },
      });
      assertScheduledCoverRetryClaimOwnership(ownedClaims, dueRows.length);
      await persistResearchLedgerInTransaction(
        transaction,
        task.id,
        output.results,
        output.summary,
        { now: completedAt, sourceCandidates: persistedSources },
      );
      const resultByCandidateId = new Map(output.results.map((result) => [
        result.candidate.id,
        result,
      ]));
      for (const candidate of dueRows) {
        if (!pendingDueIds.has(candidate.candidateKey)) continue;
        const result = resultByCandidateId.get(candidate.candidateKey);
        if (result?.resolution !== "PENDING_COVER") continue;
        const update = buildCompletedPendingCoverRetryUpdate(
          candidate.coverAttemptCount,
          completedAt,
          result.cover,
        );
        const reconciled = await transaction.researchCandidate.updateMany({
          where: { id: candidate.id, taskId: task.id },
          data: update,
        });
        if (reconciled.count !== 1) {
          throw new TypeError("A completed scheduled cover retry could not be reconciled.");
        }
      }
      await transaction.aiSearchTask.update({
        where: { id: task.id },
        data: {
          parsedResult: jsonValue(nextResult),
          rawResult: jsonValue({
            ...rawResult,
            comprehensiveSummary: output.summary,
            verificationSummary: nextResult.verificationSummary ?? null,
            scheduledCoverRetry: {
              checkedAt: completedAt.toISOString(),
              attempted: pendingDueIds.size,
              remaining: output.summary.pendingCover,
            },
          }),
        },
      });
      if (terminalDueRowIds.length > 0) {
        const legacyOrUnboundIds = terminalDueRows
          .filter((candidate) =>
            stateById.get(candidate.candidateKey)?.result.resolution === "PENDING_COVER")
          .map((candidate) => candidate.id);
        const noLongerPendingIds = terminalDueRows
          .filter((candidate) =>
            stateById.get(candidate.candidateKey)?.result.resolution !== "PENDING_COVER")
          .map((candidate) => candidate.id);
        if (legacyOrUnboundIds.length > 0) {
          await transaction.researchCandidate.updateMany({
            where: {
              id: { in: legacyOrUnboundIds },
              coverStatus: "CHECKING",
              coverLastErrorCode: claim.claimToken,
            },
            data: {
              coverStatus: "INVALID",
              coverNextRetryAt: null,
              coverLastErrorCode: "SCHEDULED_COVER_RETRY_SCHEMA_V2_REQUIRED",
              coverLastErrorMessage:
                "Automatic cover retry requires an identity-bound schema-v2 source candidate.",
            },
          });
        }
        if (noLongerPendingIds.length > 0) {
          await transaction.researchCandidate.updateMany({
            where: {
              id: { in: noLongerPendingIds },
              coverStatus: "CHECKING",
              coverLastErrorCode: claim.claimToken,
            },
            data: {
              coverStatus: "INVALID",
              coverNextRetryAt: null,
              coverLastErrorCode: "SCHEDULED_COVER_RETRY_NOT_PENDING",
              coverLastErrorMessage: "The persisted candidate no longer has a pending-cover resolution.",
            },
          });
        }
      }
    }, { maxWait: 10_000, timeout: 120_000 });

    const found = [...pendingDueIds].filter((candidateId) =>
      output.results.find((result) => result.candidate.id === candidateId)?.resolution === "VERIFIED").length;
    return {
      taskId: task.id,
      attempted: pendingDueIds.size,
      found,
      pending: output.summary.pendingCover,
    };
  } catch (error) {
    const failedAt = new Date(Math.max(now.getTime(), Date.now()));
    await deferFailedCandidates(dueRows, failedAt, error, claim.claimToken);
    throw error;
  }
}

async function findDueTasks(now: Date, taskIds?: readonly string[]) {
  const selectedTaskIds = taskIds
    ? [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))]
    : null;
  if (selectedTaskIds?.length === 0) return [];
  const oldestDueCandidate = await prisma.researchCandidate.findFirst({
    where: {
      ...(selectedTaskIds ? { taskId: { in: selectedTaskIds } } : {}),
      releaseId: null,
      coverStatus: { in: ["RETRY_WAIT", "CHECKING"] },
      coverNextRetryAt: { lte: now },
      task: {
        is: {
          status: "SUCCEEDED",
          pipelineVersion: "multi-source-v2",
          resultSchemaVersion: 2,
          importedAt: null,
          artistId: null,
        },
      },
    },
    orderBy: [
      { coverNextRetryAt: "asc" },
      { updatedAt: "asc" },
      { id: "asc" },
    ],
    select: { taskId: true },
  });
  if (!oldestDueCandidate) return [];

  return prisma.aiSearchTask.findMany({
    where: {
      id: oldestDueCandidate.taskId,
      status: "SUCCEEDED",
      pipelineVersion: "multi-source-v2",
      resultSchemaVersion: 2,
      importedAt: null,
      artistId: null,
    },
    include: {
      candidates: { orderBy: { candidateKey: "asc" } },
    },
    take: TASK_BATCH_SIZE,
  });
}

export type ScheduledCoverRetryBatchResult = {
  skippedForActiveResearch: boolean;
  tasks: Array<{
    taskId: string;
    attempted: number;
    found: number;
    pending: number;
  }>;
};

export type ScheduledCoverRetryProgress = {
  taskId: string;
  completed: number;
  total: number;
  found: number;
  pending: number;
};

export type ScheduledCoverRetryBatchOptions = {
  /**
   * Restrict a maintenance run to explicitly selected completed research
   * tasks. The normal background worker omits this option and retains its
   * global oldest-due ordering.
   */
  taskIds?: readonly string[];
  /**
   * A selected maintenance run may amortize one public-source preparation
   * across more due covers. The unattended worker retains the smaller
   * default; every caller is capped to a bounded 64-candidate batch.
   */
  candidateBatchSize?: number;
  /**
   * Receive bounded, identity-free counters after a task is claimed and after
   * each candidate finishes. No candidate payload or provider value crosses
   * this maintenance callback.
   */
  onProgress?: (progress: ScheduledCoverRetryProgress) => void | Promise<void>;
};

/**
 * Run one bounded local batch. It never calls an LLM or any catalogue
 * discovery path: it may re-contact only exact provider entities already
 * sealed into a schema-v2 candidate and re-run the image validator.
 */
export async function processScheduledCoverRetryBatch(
  now = new Date(),
  options: ScheduledCoverRetryBatchOptions = {},
): Promise<ScheduledCoverRetryBatchResult> {
  const activeResearch = await prisma.aiSearchTask.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (activeResearch > 0) {
    return { skippedForActiveResearch: true, tasks: [] };
  }

  const tasks = await findDueTasks(now, options.taskIds);
  const candidateBatchSize = Math.min(
    MAX_CANDIDATE_BATCH_SIZE,
    Math.max(1, Math.trunc(options.candidateBatchSize ?? DEFAULT_CANDIDATE_BATCH_SIZE)),
  );
  const completed = [];
  for (const task of tasks) {
    completed.push(await retryTaskCovers(task, now, candidateBatchSize, options.onProgress));
  }
  return { skippedForActiveResearch: false, tasks: completed };
}
