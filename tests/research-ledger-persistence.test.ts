import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
  type ComprehensiveDiscographySummary,
  type ComprehensiveLedgerEntry,
} from "@/lib/ai/comprehensive-discography";
import {
  buildResearchTaskProgressUpdate,
  calculateCoverRetry,
  decisionOutcomeForLedgerEntry,
  dispositionForResolution,
  planResearchLedgerPersistence,
  sequenceAppendedDecisions,
} from "@/lib/ai/research-ledger-persistence";

const now = new Date("2026-07-12T08:00:00.000Z");

function ledger(
  stage: ComprehensiveLedgerEntry["stage"],
  verdict: ComprehensiveLedgerEntry["verdict"],
  reasonCode: string,
  retryable = false,
): ComprehensiveLedgerEntry {
  return {
    stage,
    verdict,
    reasonCode,
    message: `${stage}: ${reasonCode}`,
    sourceUrls: [`https://evidence.example/${reasonCode}`],
    retryable,
    conflictIds: verdict === "REJECT" ? [`conflict-${reasonCode}`] : [],
  };
}

function result(
  id: string,
  overrides: Partial<ComprehensiveCandidateResult> = {},
): ComprehensiveCandidateResult {
  return {
    candidate: {
      id,
      title: `Title ${id}`,
      titleOriginal: null,
      category: "ORIGINAL_ALBUM",
      artistCredit: "Test Artist",
      releaseDate: "1985-01-02",
      originalReleaseDate: "1985",
      format: "CD",
      catalogNumber: `CAT-${id}`,
      barcode: null,
      label: "Test Label",
      originalPrice: null,
      editionType: null,
      isReissue: false,
      isRemaster: false,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "MEDIUM",
      warnings: [],
      sources: [{
        title: "MusicBrainz",
        url: `https://musicbrainz.org/release/${id}`,
        sourceType: "database",
      }],
      verification: null,
    },
    workId: `work-${id}`,
    editionId: `edition-${id}`,
    resolution: "PENDING_EVIDENCE",
    evidenceVerdict: "UNKNOWN",
    aiDecision: null,
    cover: null,
    ledger: [ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED")],
    ...overrides,
  };
}

const verified = result("verified", {
  resolution: "VERIFIED",
  evidenceVerdict: "PASS",
  aiDecision: {
    candidateId: "verified",
    decision: "ACCEPT",
    reasonCode: "EVIDENCE_CONSISTENT",
    reason: "Evidence is consistent.",
    conflictIds: [],
  },
  cover: {
    status: "FOUND",
    imageUrl: "https://coverartarchive.org/release/verified/front-500",
    sourceUrl: "https://coverartarchive.org/release/verified",
    provider: "cover-art-archive",
    checkedAt: now.toISOString(),
    contentSha256: "d".repeat(64),
    coverMatchLevel: "EDITION",
    sourceReleaseDate: "1988-02-10",
  },
  ledger: [
    ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
    ledger("AUTHORITATIVE", "PASS", "AUTHORITY_MATCH"),
    ledger("AI_AUDIT", "PASS", "EVIDENCE_CONSISTENT"),
    ledger("COVER", "PASS", "VALIDATED_EDITION_COVER_FOUND"),
  ],
});

const pendingEvidence = result("pending-evidence", {
  resolution: "PENDING_EVIDENCE",
  evidenceVerdict: "UNKNOWN",
  ledger: [
    ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
    ledger("AUTHORITATIVE", "UNKNOWN", "MISSING_STRONG_AUTHORITY"),
  ],
});

const pendingCover = result("pending-cover", {
  resolution: "PENDING_COVER",
  evidenceVerdict: "PASS",
  aiDecision: {
    candidateId: "pending-cover",
    decision: "ACCEPT",
    reasonCode: "EVIDENCE_CONSISTENT",
    reason: "Evidence is consistent.",
    conflictIds: [],
  },
  cover: {
    status: "UNAVAILABLE",
    reasonCode: "COVER_PROVIDER_UNAVAILABLE",
    reason: "Cover provider timed out.",
    retryable: true,
  },
  ledger: [
    ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
    ledger("AI_AUDIT", "PASS", "EVIDENCE_CONSISTENT"),
    ledger("COVER", "UNKNOWN", "COVER_PROVIDER_UNAVAILABLE", true),
  ],
});

const rejected = result("rejected", {
  resolution: "REJECTED",
  evidenceVerdict: "REJECT",
  ledger: [
    ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
    ledger("CORROBORATION", "REJECT", "CATALOG_CONFLICT"),
  ],
});

const outOfScope = result("out-of-scope", {
  resolution: "OUT_OF_SCOPE",
  evidenceVerdict: "OUT_OF_SCOPE",
  ledger: [
    ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
    ledger("SCOPE", "OUT_OF_SCOPE", "NON_JAPAN_EDITION"),
  ],
});

const results = [verified, pendingEvidence, pendingCover, rejected, outOfScope];
const summary: ComprehensiveDiscographySummary = {
  totalCandidates: 5,
  evidenceReadyForAi: 2,
  aiAccepted: 2,
  verified: 1,
  pendingEvidence: 1,
  pendingCover: 1,
  rejected: 1,
  outOfScope: 1,
};

test("resolution maps missing evidence and out-of-scope to deferred, not factual rejection", () => {
  assert.equal(dispositionForResolution("VERIFIED"), "ACCEPTED");
  assert.equal(dispositionForResolution("PENDING_EVIDENCE"), "DEFERRED");
  assert.equal(dispositionForResolution("PENDING_COVER"), "DEFERRED");
  assert.equal(dispositionForResolution("OUT_OF_SCOPE"), "DEFERRED");
  assert.equal(dispositionForResolution("REJECTED"), "REJECTED");
});

test("ledger verdicts preserve pass, defer, retry, and explicit rejection", () => {
  assert.equal(decisionOutcomeForLedgerEntry({ verdict: "PASS", retryable: false }), "PASS");
  assert.equal(decisionOutcomeForLedgerEntry({ verdict: "UNKNOWN", retryable: false }), "DEFER");
  assert.equal(decisionOutcomeForLedgerEntry({ verdict: "UNKNOWN", retryable: true }), "RETRY");
  assert.equal(decisionOutcomeForLedgerEntry({ verdict: "OUT_OF_SCOPE", retryable: false }), "DEFER");
  assert.equal(decisionOutcomeForLedgerEntry({ verdict: "REJECT", retryable: false }), "REJECT");
});

test("append sequencing is monotonic while entries from one stage run share an attempt", () => {
  const planned = [
    {
      stage: "AUTHORITATIVE",
      outcome: "PASS" as const,
      reasonCode: "AUTHORITY_A",
      reasonText: "Authority A matched.",
      retryable: false,
      evidence: {
        sourceUrls: [],
        conflictIds: [],
        resolution: "VERIFIED" as const,
        externalWorkId: "work",
        externalEditionId: "edition",
      },
    },
    {
      stage: "AUTHORITATIVE",
      outcome: "PASS" as const,
      reasonCode: "AUTHORITY_B",
      reasonText: "Authority B matched.",
      retryable: false,
      evidence: {
        sourceUrls: [],
        conflictIds: [],
        resolution: "VERIFIED" as const,
        externalWorkId: "work",
        externalEditionId: "edition",
      },
    },
    {
      stage: "COVER",
      outcome: "RETRY" as const,
      reasonCode: "COVER_TIMEOUT",
      reasonText: "Cover timed out.",
      retryable: true,
      evidence: {
        sourceUrls: [],
        conflictIds: [],
        resolution: "PENDING_COVER" as const,
        externalWorkId: "work",
        externalEditionId: "edition",
      },
    },
  ];
  const sequenced = sequenceAppendedDecisions([
    { sequence: 4, stage: "AUTHORITATIVE", attempt: 2 },
    { sequence: 8, stage: "COVER", attempt: 1 },
  ], planned);
  assert.deepEqual(sequenced.map((decision) => ({
    sequence: decision.sequence,
    stage: decision.stage,
    attempt: decision.attempt,
  })), [
    { sequence: 9, stage: "AUTHORITATIVE", attempt: 3 },
    { sequence: 10, stage: "AUTHORITATIVE", attempt: 3 },
    { sequence: 11, stage: "COVER", attempt: 2 },
  ]);
});

test("cover retry uses bounded exponential backoff without discarding the candidate", () => {
  const first = calculateCoverRetry(0, now, { baseDelayMs: 1_000, maxDelayMs: 4_000 });
  const second = calculateCoverRetry(1, now, { baseDelayMs: 1_000, maxDelayMs: 4_000 });
  const capped = calculateCoverRetry(10, now, { baseDelayMs: 1_000, maxDelayMs: 4_000 });
  assert.equal(first.attemptCount, 1);
  assert.equal(first.delayMs, 1_000);
  assert.equal(second.delayMs, 2_000);
  assert.equal(capped.delayMs, 4_000);
  assert.equal(capped.nextRetryAt.toISOString(), "2026-07-12T08:00:04.000Z");
});

test("persistence plan materializes candidates, append decisions, covers, and reconciled summaries", () => {
  const priorCandidates = new Map([
    ["verified", {
      coverAttemptCount: 2,
      coverStatus: "RETRY_WAIT" as const,
      coverNextRetryAt: new Date("2026-07-12T07:00:00.000Z"),
      coverImageUrl: null,
      coverImageSourceUrl: null,
      coverProvider: null,
      coverCheckedAt: null,
    }],
    ["pending-cover", {
      coverAttemptCount: 3,
      coverStatus: "RETRY_WAIT" as const,
      coverNextRetryAt: new Date("2026-07-12T07:00:00.000Z"),
      coverImageUrl: null,
      coverImageSourceUrl: null,
      coverProvider: null,
      coverCheckedAt: null,
    }],
  ]);
  const plan = planResearchLedgerPersistence({
    taskId: " task-1 ",
    results,
    summary,
    now,
    priorCandidates,
    retryPolicy: { baseDelayMs: 1_000, maxDelayMs: 4_000 },
  });

  assert.equal(plan.taskId, "task-1");
  assert.equal(plan.candidates.length, 5);
  const verifiedPlan = plan.candidates.find((candidate) => candidate.candidateKey === "verified")!;
  assert.equal(verifiedPlan.disposition, "ACCEPTED");
  assert.equal(verifiedPlan.coverStatus, "VALID");
  assert.equal(verifiedPlan.coverAttemptCount, 3);
  assert.equal(verifiedPlan.coverNextRetryAt, null);
  assert.equal(verifiedPlan.sourceProvider, "musicbrainz");
  assert.equal(verifiedPlan.decisions.length, 4);
  assert.equal(
    (verifiedPlan.payload.cover as { contentSha256?: string }).contentSha256,
    "d".repeat(64),
  );

  const coverPlan = plan.candidates.find((candidate) => candidate.candidateKey === "pending-cover")!;
  assert.equal(coverPlan.disposition, "DEFERRED");
  assert.equal(coverPlan.coverStatus, "RETRY_WAIT");
  assert.equal(coverPlan.coverAttemptCount, 4);
  assert.equal(coverPlan.coverNextRetryAt?.toISOString(), "2026-07-12T08:00:04.000Z");
  assert.equal(coverPlan.coverLastErrorCode, "COVER_PROVIDER_UNAVAILABLE");
  assert.equal(coverPlan.decisions.at(-1)?.outcome, "RETRY");

  assert.equal(plan.candidates.find((candidate) => candidate.candidateKey === "rejected")?.disposition, "REJECTED");
  assert.equal(plan.candidates.find((candidate) => candidate.candidateKey === "out-of-scope")?.disposition, "DEFERRED");
  const resolution = plan.stageSummaries.find((stage) => stage.stage === "RESOLUTION")!;
  assert.deepEqual(resolution, {
    stage: "RESOLUTION",
    sequence: 107,
    inputCount: 5,
    passedCount: 1,
    deferredCount: 3,
    rejectedCount: 1,
    mergedCount: 0,
    retryCount: 1,
    reasonCounts: {
      VERIFIED: 1,
      PENDING_EVIDENCE: 1,
      PENDING_COVER: 1,
      REJECTED: 1,
      OUT_OF_SCOPE: 1,
    },
    detailsComplete: true,
  });
  const authoritative = plan.stageSummaries.find((stage) => stage.stage === "AUTHORITATIVE")!;
  assert.equal(authoritative.inputCount, 2);
  assert.equal(authoritative.passedCount, 1);
  assert.equal(authoritative.deferredCount, 1);
  assert.equal(authoritative.rejectedCount, 0);
});

test("a passing authority wins over another unavailable authority in the stage summary", () => {
  const mixedAuthority = {
    ...verified,
    ledger: [
      ...verified.ledger,
      ledger("AUTHORITATIVE", "UNKNOWN", "OFFICIAL_CATALOG_UNAVAILABLE", true),
    ],
  };
  const plan = planResearchLedgerPersistence({
    taskId: "mixed-authority",
    results: [mixedAuthority],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  });
  const authority = plan.stageSummaries.find((stage) => stage.stage === "AUTHORITATIVE")!;
  assert.equal(authority.passedCount, 1);
  assert.equal(authority.deferredCount, 0);
  assert.equal(authority.retryCount, 1);
});

test("a work-rule scope exclusion wins over an earlier scope pass in the stage summary", () => {
  const scopedOut = {
    ...outOfScope,
    ledger: [
      ledger("DISCOVERY", "PASS", "CANDIDATE_DISCOVERED"),
      ledger("SCOPE", "PASS", "MB_SCOPE_MATCH"),
      ledger("SCOPE", "OUT_OF_SCOPE", "LATER_COMPOSITE_REISSUE_BUNDLE"),
    ],
  };
  const plan = planResearchLedgerPersistence({
    taskId: "scope-exclusion",
    results: [scopedOut],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 0,
      aiAccepted: 0,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 1,
    },
    now,
  });
  const scope = plan.stageSummaries.find((stage) => stage.stage === "SCOPE")!;
  assert.equal(scope.passedCount, 0);
  assert.equal(scope.deferredCount, 1);
});

test("cover attempt counts include every immediate retry ledger entry", () => {
  const retried = {
    ...pendingCover,
    ledger: [
      ...pendingCover.ledger,
      ledger("COVER", "UNKNOWN", "COVER_RETRY_ONE", true),
      ledger("COVER", "UNKNOWN", "COVER_RETRY_TWO", true),
    ],
  };
  const plan = planResearchLedgerPersistence({
    taskId: "cover-attempts",
    results: [retried],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  });
  assert.equal(plan.candidates[0]?.coverAttemptCount, 3);
});

test("an unchanged persisted result does not append decisions or count the cover twice", () => {
  const first = planResearchLedgerPersistence({
    taskId: "idempotent-ledger",
    results: [verified],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  }).candidates[0]!;
  const second = planResearchLedgerPersistence({
    taskId: "idempotent-ledger",
    results: [verified],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
    priorCandidates: new Map([["verified", {
      payload: first.payload,
      coverAttemptCount: first.coverAttemptCount,
      coverStatus: first.coverStatus,
      coverNextRetryAt: first.coverNextRetryAt,
      coverImageUrl: first.coverImageUrl,
      coverImageSourceUrl: first.coverImageSourceUrl,
      coverProvider: first.coverProvider,
      coverCheckedAt: first.coverCheckedAt,
      coverLastErrorCode: first.coverLastErrorCode,
      coverLastErrorMessage: first.coverLastErrorMessage,
    }]]),
  }).candidates[0]!;
  assert.equal(second.decisions.length, 0);
  assert.equal(second.coverAttemptCount, first.coverAttemptCount);
});

test("legacy cover quarantine clears stale database cover columns without counting a network attempt", () => {
  const first = planResearchLedgerPersistence({
    taskId: "legacy-cover-quarantine",
    results: [verified],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  }).candidates[0]!;
  const quarantined: ComprehensiveCandidateResult = {
    ...verified,
    candidate: {
      ...verified.candidate,
      coverImageUrl: null,
      coverImageSourceUrl: null,
    },
    resolution: "PENDING_COVER",
    cover: {
      status: "MISSING",
      reasonCode: LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
      reason: "The legacy cover date is not identity-compatible.",
      retryable: true,
    },
    ledger: [
      ...verified.ledger,
      ledger("COVER", "UNKNOWN", LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON, true),
    ],
  };
  const prior = new Map([[verified.candidate.id, {
    payload: first.payload,
    coverAttemptCount: first.coverAttemptCount,
    coverStatus: first.coverStatus,
    coverNextRetryAt: first.coverNextRetryAt,
    coverImageUrl: first.coverImageUrl,
    coverImageSourceUrl: first.coverImageSourceUrl,
    coverProvider: first.coverProvider,
    coverCheckedAt: first.coverCheckedAt,
    coverLastErrorCode: first.coverLastErrorCode,
    coverLastErrorMessage: first.coverLastErrorMessage,
  }]]);
  const next = planResearchLedgerPersistence({
    taskId: "legacy-cover-quarantine",
    results: [quarantined],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    priorCandidates: prior,
    clearPersistedCoverCandidateIds: new Set([verified.candidate.id]),
    now,
  });
  const candidatePlan = next.candidates[0]!;

  assert.equal(candidatePlan.coverImageUrl, null);
  assert.equal(candidatePlan.coverImageSourceUrl, null);
  assert.equal(candidatePlan.coverProvider, null);
  assert.equal(candidatePlan.coverStatus, "RETRY_WAIT");
  assert.equal(candidatePlan.coverAttemptCount, first.coverAttemptCount);
  assert.equal(candidatePlan.coverNextRetryAt!.getTime() > now.getTime(), true);
  assert.equal(candidatePlan.decisions.length, 1);
  assert.equal(candidatePlan.decisions[0]?.reasonCode, LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON);
  const coverStage = next.stageSummaries.find((stage) => stage.stage === "COVER")!;
  assert.equal(coverStage.passedCount, 0);
  assert.equal(coverStage.deferredCount, 1);
  assert.deepEqual(coverStage.reasonCounts, {
    [LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON]: 1,
  });
});

test("physical-identity quarantine is a terminal readiness gate without a fabricated AI decision", () => {
  const quarantined: ComprehensiveCandidateResult = {
    ...verified,
    candidate: { ...verified.candidate, format: null },
    resolution: "PENDING_EVIDENCE",
    evidenceVerdict: "UNKNOWN",
    aiDecision: null,
    ledger: [
      ...verified.ledger,
      ledger("SCOPE", "UNKNOWN", LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON),
    ],
  };
  const plan = planResearchLedgerPersistence({
    taskId: "legacy-physical-quarantine",
    results: [quarantined],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 0,
      aiAccepted: 0,
      verified: 0,
      pendingEvidence: 1,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  });
  const scope = plan.stageSummaries.find((stage) => stage.stage === "SCOPE")!;
  assert.equal(scope.passedCount, 0);
  assert.equal(scope.deferredCount, 1);
});

test("ledger persistence appends only an unchanged prior prefix suffix", () => {
  const first = planResearchLedgerPersistence({
    taskId: "ledger-prefix",
    results: [pendingCover],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  }).candidates[0]!;
  const prior = new Map([[pendingCover.candidate.id, {
    payload: first.payload,
    coverAttemptCount: first.coverAttemptCount,
    coverStatus: first.coverStatus,
    coverNextRetryAt: first.coverNextRetryAt,
    coverImageUrl: first.coverImageUrl,
    coverImageSourceUrl: first.coverImageSourceUrl,
    coverProvider: first.coverProvider,
    coverCheckedAt: first.coverCheckedAt,
    coverLastErrorCode: first.coverLastErrorCode,
    coverLastErrorMessage: first.coverLastErrorMessage,
  }]]);
  const appended = {
    ...pendingCover,
    ledger: [...pendingCover.ledger, ledger("COVER", "UNKNOWN", "ONE_NEW_SUFFIX", true)],
  };
  const next = planResearchLedgerPersistence({
    taskId: "ledger-prefix",
    results: [appended],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    priorCandidates: prior,
    now,
  }).candidates[0]!;
  assert.deepEqual(next.decisions.map((decision) => decision.reasonCode), ["ONE_NEW_SUFFIX"]);

  const rewritten = structuredClone(appended);
  rewritten.ledger[0]!.message = "rewritten history";
  assert.throws(() => planResearchLedgerPersistence({
    taskId: "ledger-prefix",
    results: [rewritten],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    priorCandidates: prior,
    now,
  }), /unchanged prefix/);
});

test("schema v2 retains source observations and counts only newly appended cover attempts", () => {
  const appleEditionBinding = {
    schemaVersion: 1 as const,
    provider: "apple-music" as const,
    collectionId: 44,
    artistId: 99,
    artistName: "Test Artist",
    collectionName: pendingCover.candidate.title,
    releaseDate: "1985-01-02",
    imageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
    sourceUrl: "https://music.apple.com/jp/album/test/44",
    artistQuery: "Test Artist",
    candidateIdentity: {
      id: pendingCover.candidate.id,
      title: pendingCover.candidate.title,
      titleOriginal: pendingCover.candidate.titleOriginal,
      category: pendingCover.candidate.category,
      artistCredit: pendingCover.candidate.artistCredit,
      releaseDate: "1985-01-02",
      originalReleaseDate: pendingCover.candidate.originalReleaseDate,
    },
  };
  const boundPendingCover: ComprehensiveCandidateResult = {
    ...pendingCover,
    cover: {
      ...pendingCover.cover!,
      appleEditionBinding,
    },
  };
  const sourceCandidate: ComprehensiveDiscographyCandidate = {
    candidate: boundPendingCover.candidate,
    workId: boundPendingCover.workId,
    editionId: boundPendingCover.editionId,
    observations: [],
    conflicts: [],
  };
  const baseSummary = {
    totalCandidates: 1,
    evidenceReadyForAi: 1,
    aiAccepted: 1,
    verified: 0,
    pendingEvidence: 0,
    pendingCover: 1,
    rejected: 0,
    outOfScope: 0,
  };
  const first = planResearchLedgerPersistence({
    taskId: "scheduled-cover-v2",
    results: [boundPendingCover],
    summary: baseSummary,
    sourceCandidates: [sourceCandidate],
    now,
  }).candidates[0]!;
  assert.equal(first.payload.schemaVersion, 2);
  assert.deepEqual(first.payload.sourceCandidate, sourceCandidate);
  assert.deepEqual(
    (first.payload.cover as typeof boundPendingCover.cover)?.appleEditionBinding,
    appleEditionBinding,
  );

  const retried = {
    ...boundPendingCover,
    ledger: [...boundPendingCover.ledger, ledger("COVER", "UNKNOWN", "SCHEDULED_MISS", false)],
  };
  const second = planResearchLedgerPersistence({
    taskId: "scheduled-cover-v2",
    results: [retried],
    summary: baseSummary,
    sourceCandidates: [sourceCandidate],
    now,
    priorCandidates: new Map([[boundPendingCover.candidate.id, {
      payload: first.payload,
      coverAttemptCount: first.coverAttemptCount,
      coverStatus: first.coverStatus,
      coverNextRetryAt: first.coverNextRetryAt,
      coverImageUrl: first.coverImageUrl,
      coverImageSourceUrl: first.coverImageSourceUrl,
      coverProvider: first.coverProvider,
      coverCheckedAt: first.coverCheckedAt,
      coverLastErrorCode: first.coverLastErrorCode,
      coverLastErrorMessage: first.coverLastErrorMessage,
    }]]),
  }).candidates[0]!;
  assert.equal(second.coverAttemptCount, first.coverAttemptCount + 1);
});

test("a found payload repairs a stale retry status without inventing another lookup", () => {
  const first = planResearchLedgerPersistence({
    taskId: "cover-state-reconcile",
    results: [verified],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  }).candidates[0]!;
  const repaired = planResearchLedgerPersistence({
    taskId: "cover-state-reconcile",
    results: [verified],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
    priorCandidates: new Map([[verified.candidate.id, {
      payload: first.payload,
      coverAttemptCount: first.coverAttemptCount,
      coverStatus: "RETRY_WAIT" as const,
      coverNextRetryAt: new Date("2026-07-12T07:00:00.000Z"),
      coverImageUrl: null,
      coverImageSourceUrl: null,
      coverProvider: null,
      coverCheckedAt: null,
      coverLastErrorCode: "TASK_UPDATE_FAILED",
      coverLastErrorMessage: "retry",
    }]]),
  }).candidates[0]!;
  assert.equal(repaired.coverStatus, "VALID");
  assert.equal(repaired.coverAttemptCount, first.coverAttemptCount);
  assert.equal(repaired.coverNextRetryAt, null);
});

test("a correct edition with no known cover stays queued for long-term retry", () => {
  const missing = {
    ...pendingCover,
    cover: {
      status: "MISSING" as const,
      reasonCode: "EXACT_COVER_NOT_FOUND",
      reason: "No exact cover is indexed yet.",
      retryable: false,
    },
  };
  const plan = planResearchLedgerPersistence({
    taskId: "missing-cover-retry",
    results: [missing],
    summary: {
      totalCandidates: 1,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 1,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  });
  assert.equal(plan.candidates[0]?.coverStatus, "RETRY_WAIT");
  assert.equal(plan.candidates[0]?.coverNextRetryAt instanceof Date, true);
});

test("plan rejects stale summaries and duplicate candidate identities", () => {
  assert.throws(() => planResearchLedgerPersistence({
    taskId: "task",
    results,
    summary: { ...summary, verified: 2 },
    now,
  }), /summary verified/);
  assert.throws(() => planResearchLedgerPersistence({
    taskId: "task",
    results: [verified, { ...pendingEvidence, candidate: { ...pendingEvidence.candidate, id: "verified" } }],
    summary: {
      totalCandidates: 2,
      evidenceReadyForAi: 1,
      aiAccepted: 1,
      verified: 1,
      pendingEvidence: 1,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
    },
    now,
  }), /unique, non-empty candidate ids/);
});

test("task progress helper clamps progress and stamps lifecycle transitions", () => {
  assert.deepEqual(buildResearchTaskProgressUpdate({
    progress: 47.6,
    stage: " Evidence audit ",
    status: "RUNNING",
  }, now), {
    progress: 48,
    stage: "Evidence audit",
    status: "RUNNING",
    startedAt: now,
    completedAt: undefined,
  });
  assert.deepEqual(buildResearchTaskProgressUpdate({
    progress: 150,
    stage: "Completed",
    status: "SUCCEEDED",
  }, now), {
    progress: 100,
    stage: "Completed",
    status: "SUCCEEDED",
    startedAt: undefined,
    completedAt: now,
  });
  assert.throws(() => buildResearchTaskProgressUpdate({ progress: Number.NaN, stage: "bad" }), /finite/);
});
