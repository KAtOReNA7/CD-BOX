import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCompletedPendingCoverRetryUpdate,
  assertScheduledCoverRetryClaimOwnership,
  isLockedCoverRetryCandidateDue,
  isLockedCoverRetryTaskEligible,
  parsePersistedCandidateResultState,
  parsePersistedCoverRetryState,
  sanitizeScheduledCoverRetryError,
} from "@/lib/ai/scheduled-cover-retry";
import {
  parseSelectedTaskCoverRetryOptions,
  runSelectedTaskCoverRetries,
} from "../scripts/retry-selected-task-covers";

function payload() {
  const candidate = {
    id: "candidate-1",
    title: "Verified work",
    titleOriginal: null,
    category: "SINGLE",
    artistCredit: "Fixture Artist",
    releaseDate: "1986-01-01",
    originalReleaseDate: "1986-01-01",
    format: "CD",
    catalogNumber: "CAT-1",
    barcode: null,
    label: "Fixture Label",
    editionType: "ORIGINAL",
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    warnings: [],
    sources: [],
  };
  return {
    schemaVersion: 2,
    externalWorkId: "work-1",
    externalEditionId: "edition-1",
    candidate,
    sourceCandidate: {
      candidate,
      workId: "work-1",
      editionId: "edition-1",
      observations: [],
      conflicts: [],
    },
    evidenceVerdict: "PASS",
    aiDecision: {
      candidateId: "candidate-1",
      decision: "ACCEPT",
      reasonCode: "EVIDENCE_CONSISTENT",
      reason: "Evidence agrees.",
      conflictIds: [],
    },
    cover: {
      status: "MISSING",
      reasonCode: "EXACT_COVER_NOT_FOUND",
      reason: "Not indexed yet.",
      retryable: false,
    },
    resolution: "PENDING_COVER",
    ledger: [
      {
        stage: "AI_AUDIT",
        verdict: "PASS",
        reasonCode: "EVIDENCE_CONSISTENT",
        message: "Evidence agrees.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      },
      {
        stage: "COVER",
        verdict: "UNKNOWN",
        reasonCode: "EXACT_COVER_NOT_FOUND",
        message: "Not indexed yet.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      },
    ],
  };
}

test("scheduled cover retry accepts only complete identity-bound schema v2 payloads", () => {
  const parsed = parsePersistedCoverRetryState(payload(), "candidate-1");
  assert.equal(parsed.result.workId, "work-1");
  assert.equal(parsed.sourceCandidate.editionId, "edition-1");

  assert.throws(
    () => parsePersistedCoverRetryState({ ...payload(), schemaVersion: 1 }, "candidate-1"),
    /schema v2/,
  );
  assert.throws(
    () => parsePersistedCoverRetryState({
      ...payload(),
      sourceCandidate: { ...payload().sourceCandidate, workId: "other-work" },
    }, "candidate-1"),
    /schema v2/,
  );
  assert.throws(
    () => parsePersistedCoverRetryState({
      ...payload(),
      sourceCandidate: {
        ...payload().sourceCandidate,
        candidate: { ...payload().sourceCandidate.candidate, title: "Different edition" },
      },
    }, "candidate-1"),
    /schema v2/,
  );
  assert.throws(
    () => parsePersistedCoverRetryState(payload(), "other-candidate"),
    /incomplete or invalid/,
  );
});

test("schema-v2 parsing rejects every resolution that contradicts evidence, AI, cover, or ledger", () => {
  const mismatchedResolutions = [
    "VERIFIED",
    "PENDING_EVIDENCE",
    "REJECTED",
    "OUT_OF_SCOPE",
  ] as const;
  for (const resolution of mismatchedResolutions) {
    assert.throws(
      () => parsePersistedCoverRetryState({ ...payload(), resolution }, "candidate-1"),
      /resolution contradicts/,
      resolution,
    );
  }

  const shouldBePendingEvidence = structuredClone(payload());
  shouldBePendingEvidence.evidenceVerdict = "UNKNOWN";
  shouldBePendingEvidence.aiDecision = null as never;
  assert.throws(
    () => parsePersistedCoverRetryState(shouldBePendingEvidence, "candidate-1"),
    /resolution contradicts/,
  );

  const pendingWithoutUnknownLedger = structuredClone(payload());
  pendingWithoutUnknownLedger.resolution = "PENDING_EVIDENCE";
  pendingWithoutUnknownLedger.evidenceVerdict = "UNKNOWN";
  pendingWithoutUnknownLedger.aiDecision = null as never;
  pendingWithoutUnknownLedger.cover = null as never;
  pendingWithoutUnknownLedger.ledger = pendingWithoutUnknownLedger.ledger
    .filter((entry) => entry.verdict !== "UNKNOWN");
  assert.throws(
    () => parsePersistedCoverRetryState(pendingWithoutUnknownLedger, "candidate-1"),
    /no ledger verdict/,
  );

  const pendingWithHistoricalAiPass = structuredClone(payload());
  pendingWithHistoricalAiPass.resolution = "PENDING_EVIDENCE";
  pendingWithHistoricalAiPass.evidenceVerdict = "UNKNOWN";
  pendingWithHistoricalAiPass.aiDecision = null as never;
  pendingWithHistoricalAiPass.cover = null as never;
  pendingWithHistoricalAiPass.ledger.push({
    stage: "SCOPE",
    verdict: "UNKNOWN",
    reasonCode: "AUTHORITY_REVIEW_PENDING",
    message: "Authoritative evidence remains unresolved.",
    sourceUrls: [],
    retryable: true,
    conflictIds: [],
  });
  assert.throws(
    () => parsePersistedCoverRetryState(pendingWithHistoricalAiPass, "candidate-1"),
    /no AI decision retains a contradictory terminal AI audit/,
  );

  const rejectedWithoutRejectLedger = structuredClone(payload());
  rejectedWithoutRejectLedger.resolution = "REJECTED";
  rejectedWithoutRejectLedger.evidenceVerdict = "REJECT";
  rejectedWithoutRejectLedger.aiDecision = null as never;
  rejectedWithoutRejectLedger.cover = null as never;
  assert.throws(
    () => parsePersistedCoverRetryState(rejectedWithoutRejectLedger, "candidate-1"),
    /no ledger verdict/,
  );

  const outWithoutScopeLedger = structuredClone(payload());
  outWithoutScopeLedger.resolution = "OUT_OF_SCOPE";
  outWithoutScopeLedger.evidenceVerdict = "OUT_OF_SCOPE";
  outWithoutScopeLedger.aiDecision = null as never;
  outWithoutScopeLedger.cover = null as never;
  assert.throws(
    () => parsePersistedCoverRetryState(outWithoutScopeLedger, "candidate-1"),
    /no ledger verdict/,
  );

  const coverReasonMismatch = structuredClone(payload());
  coverReasonMismatch.ledger.at(-1)!.reasonCode = "DIFFERENT_COVER_REASON";
  assert.throws(
    () => parsePersistedCoverRetryState(coverReasonMismatch, "candidate-1"),
    /no bound unresolved cover conclusion/,
  );

  const coverMessageMismatch = structuredClone(payload());
  coverMessageMismatch.ledger.at(-1)!.message = "Different cover conclusion.";
  assert.throws(
    () => parsePersistedCoverRetryState(coverMessageMismatch, "candidate-1"),
    /no bound unresolved cover conclusion/,
  );

  const coverConflictMismatch = structuredClone(payload());
  (coverConflictMismatch.ledger.at(-1)! as Record<string, unknown>).conflictIds =
    ["unexpected-cover-conflict"];
  assert.throws(
    () => parsePersistedCoverRetryState(coverConflictMismatch, "candidate-1"),
    /no bound unresolved cover conclusion/,
  );

  const invalidConflictId = structuredClone(payload()) as Record<string, unknown>;
  const invalidLedger = invalidConflictId.ledger as Array<Record<string, unknown>>;
  invalidLedger[0]!.conflictIds = [123];
  assert.throws(
    () => parsePersistedCoverRetryState(invalidConflictId, "candidate-1"),
    /structurally incomplete/,
  );

  const rejectWithoutConflict = structuredClone(payload()) as Record<string, unknown>;
  const rejectLedger = rejectWithoutConflict.ledger as Array<Record<string, unknown>>;
  rejectLedger[0]!.verdict = "REJECT";
  rejectLedger[0]!.conflictIds = [];
  assert.throws(
    () => parsePersistedCoverRetryState(rejectWithoutConflict, "candidate-1"),
    /structurally incomplete/,
  );
});

test("legacy schema v1 retains its bound result for public-evidence reconstruction", () => {
  const legacy = { ...payload(), schemaVersion: 1 } as Record<string, unknown>;
  delete legacy.sourceCandidate;
  delete legacy.ledger;
  const parsed = parsePersistedCandidateResultState(legacy, "candidate-1");
  assert.equal(parsed.result.workId, "work-1");
  assert.equal(parsed.result.editionId, "edition-1");
  assert.equal(parsed.result.resolution, "PENDING_COVER");
  assert.deepEqual(parsed.result.ledger, []);
});

test("scheduled cover retry errors redact configured and transport credentials", () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-secret-value";
  try {
    const sanitized = sanitizeScheduledCoverRetryError(new Error(
      "Bearer abc123 sk-test-secret-value " +
      "postgresql://owner:password@localhost/cdbox?api_key=visible",
    ));
    assert.doesNotMatch(sanitized, /abc123|test-secret|owner:password|visible/);
    assert.doesNotMatch(sanitized, /https?:\/\/|postgres(?:ql)?:\/\//i);
    assert.match(sanitized, /\[redacted\]/i);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("a completed pending-cover attempt leaves its claim and backs off from completion time", () => {
  const completedAt = new Date("2026-07-13T08:30:00.000Z");
  const update = buildCompletedPendingCoverRetryUpdate(
    0,
    completedAt,
    {
      status: "MISSING",
      reasonCode: "EXACT_COVER_NOT_FOUND",
      reason: "No exact cover is indexed yet.",
      retryable: false,
    },
  );

  assert.equal(update.coverStatus, "RETRY_WAIT");
  assert.equal(update.coverAttemptCount, 1);
  assert.equal(update.coverCheckedAt, completedAt);
  assert.equal(update.coverNextRetryAt.toISOString(), "2026-07-13T08:35:00.000Z");
  assert.equal(update.coverLastErrorCode, "EXACT_COVER_NOT_FOUND");
  assert.doesNotMatch(update.coverLastErrorCode, /SCHEDULED_COVER_RETRY_CLAIM/);
});

test("a locked cover claim uses the fresh post-lock task and candidate state", () => {
  const dueAt = new Date("2026-07-13T08:00:00.000Z");
  const now = new Date("2026-07-13T08:30:00.000Z");
  const eligibleTask = {
    status: "SUCCEEDED",
    pipelineVersion: "multi-source-v2",
    resultSchemaVersion: 2,
    importedAt: null,
    artistId: null,
  };
  assert.equal(isLockedCoverRetryTaskEligible(eligibleTask), true);
  assert.equal(isLockedCoverRetryTaskEligible({
    ...eligibleTask,
    importedAt: new Date("2026-07-13T08:15:00.000Z"),
    artistId: "artist-1",
  }), false);

  const dueCandidate = {
    releaseId: null,
    coverStatus: "RETRY_WAIT",
    coverNextRetryAt: dueAt,
  };
  assert.equal(isLockedCoverRetryCandidateDue(dueCandidate, now), true);
  assert.equal(isLockedCoverRetryCandidateDue({
    ...dueCandidate,
    releaseId: "release-1",
  }, now), false);
  assert.equal(isLockedCoverRetryCandidateDue({
    ...dueCandidate,
    coverNextRetryAt: new Date("2026-07-13T09:00:00.000Z"),
  }, now), false);
});

test("an old worker cannot persist after a newer worker owns its expired lease", () => {
  assert.doesNotThrow(() => assertScheduledCoverRetryClaimOwnership(2, 2));
  assert.throws(
    () => assertScheduledCoverRetryClaimOwnership(0, 2),
    /claim expired before it could be persisted/,
  );
  assert.throws(
    () => assertScheduledCoverRetryClaimOwnership(1, 2),
    /claim expired before it could be persisted/,
  );
});

test("selected cover retry requires one bounded explicit task allowlist", () => {
  assert.deepEqual(
    parseSelectedTaskCoverRetryOptions([
      "--task-ids=task-0001,task-0002,task-0001",
      "--max-batches=9",
    ]),
    { taskIds: ["task-0001", "task-0002"], maxBatches: 9 },
  );
  assert.throws(
    () => parseSelectedTaskCoverRetryOptions([]),
    /Exactly one --task-ids/,
  );
  assert.throws(
    () => parseSelectedTaskCoverRetryOptions(["--task-ids=task-0001", "--max-batches=65"]),
    /integer from 1 through 64/,
  );
  assert.throws(
    () => parseSelectedTaskCoverRetryOptions(["--task-ids=task-0001", "--secret=sk-do-not-log"]),
    /Unknown option\. Allowed options/,
  );
});

test("selected cover retry removes each completed task from the remaining allowlist", async () => {
  const receivedAllowlists: string[][] = [];
  const receivedBatchSizes: number[] = [];
  const events: Record<string, unknown>[] = [];
  const batches = [
    {
      skippedForActiveResearch: false,
      tasks: [{ taskId: "task-due2", attempted: 1, found: 0, pending: 4 }],
    },
    {
      skippedForActiveResearch: false,
      tasks: [{ taskId: "task-due1", attempted: 0, found: 0, pending: 0 }],
    },
    { skippedForActiveResearch: false, tasks: [] },
  ];
  let call = 0;
  const summary = await runSelectedTaskCoverRetries(
    { taskIds: ["task-due1", "task-due2", "task-notdue"], maxBatches: 8 },
    {
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      processBatch: async (_now, options) => {
        receivedAllowlists.push([...options.taskIds]);
        receivedBatchSizes.push(options.candidateBatchSize);
        return batches[call++]!;
      },
      emit: (event) => events.push({ ...event }),
    },
  );

  assert.deepEqual(summary, { attempted: 1, found: 0, batchesProcessed: 3 });
  assert.deepEqual(receivedBatchSizes, [64, 64, 64]);
  assert.deepEqual(receivedAllowlists, [
    ["task-due1", "task-due2", "task-notdue"],
    ["task-due1", "task-notdue"],
    ["task-notdue"],
  ]);
  assert.deepEqual(Object.keys(events[0]!).sort(), [
    "attempted",
    "batch",
    "event",
    "found",
    "pending",
    "skippedForActiveResearch",
    "taskId",
  ]);
  assert.doesNotMatch(
    JSON.stringify(events),
    /https?:\/\/|\bsk-[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\//i,
  );
});

test("selected cover retry obeys its hard batch limit", async () => {
  let calls = 0;
  const summary = await runSelectedTaskCoverRetries(
    { taskIds: ["task-0001", "task-0002", "task-0003", "task-0004"], maxBatches: 3 },
    {
      processBatch: async (_now, options) => {
        calls += 1;
        return {
          skippedForActiveResearch: false,
          tasks: [{ taskId: options.taskIds[0]!, attempted: 0, found: 0, pending: 1 }],
        };
      },
      emit: () => undefined,
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(summary, { attempted: 0, found: 0, batchesProcessed: 3 });
});

test("selected cover retry processes one task at most once per invocation", async () => {
  let calls = 0;
  const summary = await runSelectedTaskCoverRetries(
    { taskIds: ["task-0001"], maxBatches: 64 },
    {
      processBatch: async () => {
        calls += 1;
        return {
          skippedForActiveResearch: false,
          tasks: [{ taskId: "task-0001", attempted: 46, found: 0, pending: 46 }],
        };
      },
      emit: () => undefined,
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(summary, { attempted: 46, found: 0, batchesProcessed: 1 });
});

test("selected cover retry emits identity-free monotonic candidate progress before batch completion", async () => {
  const events: Record<string, unknown>[] = [];
  const summary = await runSelectedTaskCoverRetries(
    { taskIds: ["task-0001"], maxBatches: 1 },
    {
      processBatch: async (_now, options) => {
        await options.onProgress?.({
          taskId: "task-0001",
          completed: 0,
          total: 3,
          found: 0,
          pending: 0,
        });
        await options.onProgress?.({
          taskId: "task-0001",
          completed: 1,
          total: 3,
          found: 0,
          pending: 1,
        });
        await options.onProgress?.({
          taskId: "task-0001",
          completed: 2,
          total: 3,
          found: 1,
          pending: 1,
        });
        await options.onProgress?.({
          taskId: "task-0001",
          completed: 3,
          total: 3,
          found: 1,
          pending: 2,
        });
        return {
          skippedForActiveResearch: false,
          tasks: [{ taskId: "task-0001", attempted: 3, found: 1, pending: 2 }],
        };
      },
      emit: (event) => events.push({ ...event }),
    },
  );

  assert.deepEqual(summary, { attempted: 3, found: 1, batchesProcessed: 1 });
  const progressEvents = events.filter((event) =>
    event.event === "selected-task-cover-retry-progress");
  assert.deepEqual(progressEvents.map((event) => event.completed), [0, 1, 2, 3]);
  assert.deepEqual(progressEvents.map((event) => event.total), [3, 3, 3, 3]);
  assert.deepEqual(progressEvents.map((event) => event.found), [0, 0, 1, 1]);
  assert.deepEqual(progressEvents.map((event) => event.pending), [0, 1, 1, 2]);
  assert.deepEqual(Object.keys(progressEvents[0]!).sort(), [
    "batch",
    "completed",
    "event",
    "found",
    "pending",
    "taskId",
    "total",
  ]);
  assert.equal(events.at(-1)?.event, "selected-task-cover-retry");
  assert.doesNotMatch(
    JSON.stringify(events),
    /title|payload|https?:\/\/|\bsk-[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\//i,
  );
});

test("local lifecycle starts one hidden cover worker and validates it before stopping", () => {
  const start = readFileSync("scripts/local-start.ps1", "utf8");
  const stop = readFileSync("scripts/local-stop.ps1", "utf8");
  assert.match(start, /Start-Process[\s\S]*-WindowStyle Hidden/);
  assert.match(start, /run-cover-retry-worker\.ts/);
  assert.match(start, /cover-retry-worker\.pid/);
  assert.match(start, /already running as process/);
  assert.match(start, /was not overwritten/);
  assert.match(stop, /run-cover-retry-worker\\\.ts/);
  assert.match(stop, /Remove-Item -LiteralPath \$workerPidPath -Force -ErrorAction SilentlyContinue/);
  assert.match(stop, /belongs to a different process/);
});

test("scheduled retry uses the persisted cover-only lookup instead of public discovery preparation", () => {
  const source = readFileSync("src/lib/ai/scheduled-cover-retry.ts", "utf8");
  assert.match(source, /createPersistedCoverRetryLookup/);
  assert.doesNotMatch(source, /prepareComprehensiveSourceEvidence/);
  assert.doesNotMatch(source, /comprehensiveCandidatesFromResearch/);
  assert.doesNotMatch(source, /applyComprehensiveWorkRules/);
});
