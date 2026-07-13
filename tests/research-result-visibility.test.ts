import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchFunnelMetrics,
  buildResearchOutcomeReasons,
  buildResearchProgressSteps,
  buildResearchStageAuditRows,
  decisiveResearchLedgerEntry,
  matchesResearchOutcomeReason,
  researchProgressDetail,
  researchReasonLabel,
  selectTrustedFinalReleases,
} from "@/lib/ai/research-result-visibility";
import type {
  ReleaseResearchCandidateAudit,
  ReleaseResearchLedgerEntry,
  ReleaseResearchStageSummaryView,
  ReleaseResearchVerificationSummary,
  ResearchCandidateResolution,
} from "@/lib/ai/release-research-types";

function ledger(
  stage: string,
  verdict: ReleaseResearchLedgerEntry["verdict"],
  reasonCode: string,
  options: { retryable?: boolean; sourceUrls?: string[]; message?: string } = {},
): ReleaseResearchLedgerEntry {
  return {
    stage,
    verdict,
    reasonCode,
    message: options.message ?? `${stage}: ${reasonCode}`,
    sourceUrls: options.sourceUrls ?? [],
    retryable: options.retryable ?? false,
    conflictIds: [],
  };
}

function audit(
  candidateId: string,
  resolution: ResearchCandidateResolution,
  entries: ReleaseResearchLedgerEntry[],
): ReleaseResearchCandidateAudit {
  return {
    candidateId,
    workId: `work:${candidateId}`,
    editionId: `edition:${candidateId}`,
    title: `Release ${candidateId}`,
    category: "SINGLE",
    releaseDate: "1985-01-01",
    catalogNumber: `CAT-${candidateId}`,
    resolution,
    evidenceVerdict: resolution === "REJECTED"
      ? "REJECT"
      : resolution === "OUT_OF_SCOPE"
        ? "OUT_OF_SCOPE"
        : resolution === "VERIFIED"
          ? "PASS"
          : "UNKNOWN",
    ledger: entries,
  };
}

const summary: ReleaseResearchVerificationSummary = {
  rawReleases: 342,
  releaseGroups: 96,
  canonicalEditions: 54,
  authoritativeMatches: 54,
  crossSourceMatches: 13,
  aiAccepted: 9,
  rejectedByEvidence: 0,
  rejectedByAi: 0,
  rejectedWithoutCover: 1,
  rejectedCoverUnavailable: 1,
};

test("research funnel uses persisted summary and exact audit evidence without downstream approximations", () => {
  const audits = [
    audit("verified", "VERIFIED", [
      ledger("AUTHORITATIVE", "PASS", "NDL_CONTROLLED_EDITION_MATCH"),
      ledger("COVER", "PASS", "VALIDATED_EDITION_COVER_FOUND"),
    ]),
    audit("scope", "OUT_OF_SCOPE", [
      ledger("AUTHORITATIVE", "PASS", "LEGACY_NATIONAL_MATCH", {
        sourceUrls: ["https://ndlsearch.ndl.go.jp/books/R100000002-I000000000001"],
      }),
      ledger("SCOPE", "OUT_OF_SCOPE", "MB_FORMAT_OUTSIDE_TARGET"),
    ]),
    audit("evidence", "PENDING_EVIDENCE", [
      ledger("AUTHORITATIVE", "PASS", "OFFICIAL_CATALOG_EDITION_MATCH"),
      ledger("CORROBORATION", "UNKNOWN", "DISCOGS_EXACT_EDITION_NOT_FOUND"),
    ]),
    audit("cover", "PENDING_COVER", [
      ledger("AI_AUDIT", "PASS", "EVIDENCE_CONSISTENT"),
      ledger("COVER", "UNKNOWN", "EXACT_COVER_NOT_FOUND"),
    ]),
  ];

  assert.deepEqual(
    Object.fromEntries(buildResearchFunnelMetrics(summary, audits).map((metric) => [metric.label, metric.value])),
    {
      原始版本: 342,
      作品分组: 96,
      国家书目: 2,
      跨源一致: 13,
      "AI 通过": 9,
      封面有效: 1,
      自动过滤: 3,
    },
  );

  const unavailable = Object.fromEntries(
    buildResearchFunnelMetrics(summary, undefined).map((metric) => [metric.label, metric.value]),
  );
  assert.equal(unavailable.国家书目, null);
  assert.equal(unavailable.封面有效, null);
  assert.equal(unavailable.自动过滤, null);
  assert.equal(unavailable["AI 通过"], 9);
});

test("a terminal COVER quarantine hides a historical cover PASS from funnel counts", () => {
  const quarantined = audit("quarantined", "PENDING_COVER", [
    ledger("COVER", "PASS", "VALIDATED_EDITION_COVER_FOUND"),
    ledger("COVER", "UNKNOWN", "LEGACY_VERIFIED_COVER_DATE_MISMATCH_QUARANTINED", {
      retryable: true,
    }),
  ]);
  const metrics = Object.fromEntries(
    buildResearchFunnelMetrics(summary, [quarantined])
      .map((metric) => [metric.key, metric.value]),
  );
  assert.equal(metrics["cover-valid"], 0);
});

test("decisive ledger reason follows the final resolution instead of blindly using the last row", () => {
  const pendingEvidence = audit("pending", "PENDING_EVIDENCE", [
    ledger("AUTHORITATIVE", "UNKNOWN", "NDL_CATALOG_NOT_FOUND"),
    ledger("AI_AUDIT", "UNKNOWN", "AI_REVIEW_DISAGREEMENT"),
    ledger("CORROBORATION", "PASS", "DISCOGS_EXACT_EDITION_MATCH"),
  ]);
  const outOfScope = audit("scope", "OUT_OF_SCOPE", [
    ledger("SCOPE", "OUT_OF_SCOPE", "MB_FORMAT_OUTSIDE_TARGET"),
    ledger("SELECTION", "OUT_OF_SCOPE", "LATER_EDITION_NOT_SELECTED"),
  ]);
  const rejected = audit("rejected", "REJECTED", [
    ledger("CORROBORATION", "REJECT", "CATALOG_CONFLICT"),
    ledger("AI_AUDIT", "REJECT", "AI_REJECTION_CONFIRMED"),
    ledger("COVER", "UNKNOWN", "COVER_NOT_RUN"),
  ]);

  assert.equal(decisiveResearchLedgerEntry(pendingEvidence)?.reasonCode, "AI_REVIEW_DISAGREEMENT");
  assert.equal(decisiveResearchLedgerEntry(outOfScope)?.reasonCode, "LATER_EDITION_NOT_SELECTED");
  assert.equal(decisiveResearchLedgerEntry(rejected)?.reasonCode, "AI_REJECTION_CONFIRMED");
});

test("outcome reasons count every non-final candidate exactly once and support exact audit filtering", () => {
  const first = audit("one", "OUT_OF_SCOPE", [
    ledger("SCOPE", "OUT_OF_SCOPE", "MB_FORMAT_OUTSIDE_TARGET"),
  ]);
  const second = audit("two", "OUT_OF_SCOPE", [
    ledger("SCOPE", "OUT_OF_SCOPE", "MB_FORMAT_OUTSIDE_TARGET"),
  ]);
  const retryable = audit("three", "PENDING_COVER", [
    ledger("COVER", "UNKNOWN", "COVER_SOURCE_TEMPORARILY_UNAVAILABLE", { retryable: true }),
  ]);
  const verified = audit("four", "VERIFIED", [
    ledger("COVER", "PASS", "VALIDATED_EDITION_COVER_FOUND"),
  ]);

  const reasons = buildResearchOutcomeReasons([first, second, retryable, verified]);
  assert.equal(reasons.length, 2);
  assert.deepEqual(reasons.map((reason) => ({
    resolution: reason.resolution,
    code: reason.reasonCode,
    count: reason.count,
    retryable: reason.retryable,
  })), [
    { resolution: "OUT_OF_SCOPE", code: "MB_FORMAT_OUTSIDE_TARGET", count: 2, retryable: false },
    { resolution: "PENDING_COVER", code: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE", count: 1, retryable: true },
  ]);
  assert.equal(matchesResearchOutcomeReason(first, reasons[0]!), true);
  assert.equal(matchesResearchOutcomeReason(retryable, reasons[0]!), false);
});

test("research progress exposes all seven persisted pipeline phases at their real thresholds", () => {
  assert.deepEqual(buildResearchProgressSteps(5).map((step) => step.status), [
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  assert.deepEqual(buildResearchProgressSteps(64).map((step) => step.status), [
    "complete",
    "complete",
    "active",
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  assert.deepEqual(buildResearchProgressSteps(94).map((step) => step.status), [
    "complete",
    "complete",
    "complete",
    "complete",
    "complete",
    "complete",
    "active",
  ]);
  assert.equal(buildResearchProgressSteps(100).every((step) => step.status === "complete"), true);
  assert.match(researchProgressDetail(80), /批次与已等待秒数/);
  assert.match(researchProgressDetail(92), /封面来源/);
});

test("stage audit rows preserve every persisted count and explain loss without subtraction", () => {
  const summaries: ReleaseResearchStageSummaryView[] = [{
    stage: "SCOPE",
    sequence: 101,
    inputCount: 20,
    passedCount: 12,
    deferredCount: 5,
    rejectedCount: 2,
    mergedCount: 1,
    retryCount: 3,
    reasonCounts: {
      CURATED_HISTORICAL_NON_CANONICAL_WORK: 4,
      CURATED_CANONICAL_TITLE_DATE_CONFLICT: 2,
    },
    detailsComplete: false,
    startedAt: null,
    completedAt: null,
  }, {
    stage: "RESOLUTION",
    sequence: 107,
    inputCount: 20,
    passedCount: 9,
    deferredCount: 8,
    rejectedCount: 3,
    mergedCount: 0,
    retryCount: 2,
    reasonCounts: { VERIFIED: 9, PENDING_EVIDENCE: 8, REJECTED: 3 },
    detailsComplete: true,
    startedAt: null,
    completedAt: null,
  }];

  const rows = buildResearchStageAuditRows(summaries);
  assert.equal(rows.length, 2);
  assert.deepEqual({
    input: rows[0]?.inputCount,
    passed: rows[0]?.passedCount,
    deferred: rows[0]?.deferredCount,
    rejected: rows[0]?.rejectedCount,
    merged: rows[0]?.mergedCount,
    retries: rows[0]?.retryCount,
    complete: rows[0]?.detailsComplete,
  }, {
    input: 20,
    passed: 12,
    deferred: 5,
    rejected: 2,
    merged: 1,
    retries: 3,
    complete: false,
  });
  assert.match(rows[0]?.explanation ?? "", /不能用相邻数字直接相减/);
  assert.deepEqual(rows[0]?.reasons.map((reason) => reason.reasonCode), [
    "CURATED_HISTORICAL_NON_CANONICAL_WORK",
    "CURATED_CANONICAL_TITLE_DATE_CONFLICT",
  ]);
  assert.equal(rows[1]?.reasons[0]?.label, "已通过全部终验门禁");
});

test("reason labels explain canonical and corroboration gates in Chinese", () => {
  assert.match(researchReasonLabel("CURATED_HISTORICAL_NON_CANONICAL_WORK"), /历史正典/);
  assert.match(researchReasonLabel("CURATED_CANONICAL_TITLE_DATE_CONFLICT"), /日期.*冲突/);
  assert.match(researchReasonLabel("MISSING_INDEPENDENT_CORROBORATION"), /独立来源佐证/);
});

test("final release selection trusts only server-approved candidate ids", () => {
  const releases = [{ id: "trusted", title: "Trusted" }, { id: "weak", title: "Weak" }];
  assert.deepEqual(selectTrustedFinalReleases(releases, ["trusted", "missing"]), [releases[0]]);
  assert.deepEqual(selectTrustedFinalReleases(releases, []), []);
});
