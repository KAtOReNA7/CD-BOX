import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComprehensiveReleaseResearchResult,
  selectVerifiedComprehensiveEditions,
} from "@/lib/ai/comprehensive-release-result";
import type { ComprehensiveCandidateResult } from "@/lib/ai/comprehensive-discography";
import type { ReleaseResearchCandidate, ReleaseResearchRequest, ReleaseResearchResult } from "@/lib/ai/release-research-types";
import type { ArtistReleaseEvidenceBundle } from "@/lib/music-metadata/types";

const request: ReleaseResearchRequest = {
  artistName: "中山美穂",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

function candidate(id: string, title: string, date: string): ReleaseResearchCandidate {
  return {
    id,
    title,
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "中山美穂",
    releaseDate: date,
    originalReleaseDate: "1988-02-10",
    format: "CD",
    catalogNumber: `K32X-${id}`,
    barcode: null,
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
      { title: "MusicBrainz group", url: `https://musicbrainz.org/release-group/${id}0000000-0000-0000-0000-000000000000`.slice(0, 73), sourceType: "database" },
      { title: "MusicBrainz release", url: `https://musicbrainz.org/release/${id}0000000-0000-0000-0000-000000000000`.slice(0, 67), sourceType: "database" },
    ],
    verification: null,
  };
}

function verified(id: string, workId: string, title: string, date: string): ComprehensiveCandidateResult {
  const imageUrl = `https://is1-ssl.mzstatic.com/image/${id}.jpg`;
  const sourceUrl = `https://music.apple.com/jp/album/example/${id}`;
  return {
    candidate: {
      ...candidate(id, title, date),
      coverImageUrl: imageUrl,
      coverImageSourceUrl: sourceUrl,
      confidence: "HIGH",
    },
    workId,
    editionId: `edition-${id}`,
    resolution: "VERIFIED",
    evidenceVerdict: "PASS",
    aiDecision: {
      candidateId: id,
      decision: "ACCEPT",
      reasonCode: "EVIDENCE_CONSISTENT",
      reason: "Deterministic evidence gates passed and no semantic review item requires AI resolution.",
      conflictIds: [],
    },
    cover: {
      status: "FOUND",
      imageUrl,
      sourceUrl,
      provider: "apple-music",
      checkedAt: "2026-07-12T00:00:00.000Z",
      contentSha256: id.padStart(64, "a").slice(-64),
      coverMatchLevel: "EDITION",
      sourceReleaseDate: date,
    },
    ledger: [
      { stage: "SCOPE", verdict: "PASS", reasonCode: "SCOPE_MATCH", message: "The candidate is in scope.", sourceUrls: [], retryable: false, conflictIds: [] },
      { stage: "MUSICBRAINZ", verdict: "PASS", reasonCode: "MB", message: "MB", sourceUrls: [`https://musicbrainz.org/release/${id}`], retryable: false, conflictIds: [] },
      { stage: "AUTHORITATIVE", verdict: "PASS", reasonCode: "NDL", message: "NDL", sourceUrls: [`https://ndlsearch.ndl.go.jp/books/R100000002-I${id}`], retryable: false, conflictIds: [] },
      { stage: "CORROBORATION", verdict: "PASS", reasonCode: "DETERMINISTIC_EVIDENCE_ACCEPTED", message: "Deterministic evidence gates passed with no semantic AI_REVIEW question, so this candidate was accepted without calling the AI provider.", sourceUrls: [], retryable: false, conflictIds: [] },
      { stage: "COVER", verdict: "PASS", reasonCode: "VALIDATED_EDITION_COVER_FOUND", message: "The cover is bound to this candidate.", sourceUrls: [sourceUrl], retryable: false, conflictIds: [] },
    ],
  };
}

function pendingCover(id: string, workId: string, title: string, date: string): ComprehensiveCandidateResult {
  const value = verified(id, workId, title, date);
  return {
    ...value,
    resolution: "PENDING_COVER",
    cover: {
      status: "MISSING",
      reasonCode: "EXACT_COVER_NOT_FOUND",
      reason: "No exact cover was found yet.",
      retryable: false,
    },
  };
}

test("selects one earliest verified edition per work without collapsing same-day different works", () => {
  const values = [
    verified("1", "work-a", "Title A", "1990-01-01"),
    verified("2", "work-a", "Title A", "2000-01-01"),
    verified("3", "work-b", "Different title", "1990-01-01"),
  ];
  assert.deepEqual([...selectVerifiedComprehensiveEditions(request, values)].sort(), ["1", "3"]);
});

test("selects the earliest fully verified edition when an earlier edition still needs a cover", () => {
  const values = [
    pendingCover("1", "work-a", "Title A", "1988-02-10"),
    verified("2", "work-a", "Title A", "1992-07-22"),
  ];
  assert.deepEqual([...selectVerifiedComprehensiveEditions(request, values)], ["2"]);
});

test("prefers a precise edition date over an overlapping year-only date", () => {
  const values = [
    verified("year", "work-a", "Title A", "1988"),
    verified("day", "work-a", "Title A", "1988-02-10"),
  ];
  assert.deepEqual([...selectVerifiedComprehensiveEditions(request, values)], ["day"]);
});

test("builds multi-source-v2 attestations and keeps superseded editions in the audit ledger", () => {
  const values = [
    verified("1", "work-a", "Title A", "1990-01-01"),
    verified("2", "work-a", "Title A", "2000-01-01"),
  ];
  const base = {
    artist: { name: "中山美穂", nameKana: "なかやま みほ", nameRomaji: "Miho Nakayama", country: "JP", officialSiteUrl: null },
    collectionScope: { target: "ORIGINAL_CD", excludeReissues: true, includeCollaborations: true },
    releases: values.map((value) => value.candidate),
    globalWarnings: [],
  } satisfies ReleaseResearchResult;
  const bundle = {
    query: { artistName: "中山美穂", targetCountry: "JP", target: "ORIGINAL_CD" },
    artist: null,
    releases: [],
    sourceWhitelist: [],
    warnings: [],
    stats: { artistResultsInspected: 1, releaseGroupsFetched: 1, releasesFetched: 2, releasesAccepted: 1, coverLookups: 0 },
  } satisfies ArtistReleaseEvidenceBundle;
  const built = buildComprehensiveReleaseResearchResult(request, base, bundle, {
    results: values,
    verifiedCandidates: values.map((value) => value.candidate),
    summary: { totalCandidates: 2, evidenceReadyForAi: 2, aiAccepted: 2, verified: 2, pendingEvidence: 0, pendingCover: 0, rejected: 0, outOfScope: 0 },
  }, new Date("2026-07-12T00:00:00.000Z"));
  assert.equal(built.releases.length, 1);
  assert.equal(built.releases[0]?.verification?.method, "multi-source-v2");
  assert.equal(built.releases[0]?.verification?.coverProvider, "apple-music");
  assert.equal(built.releases[0]?.verification?.coverContentSha256, "1".padStart(64, "a"));
  assert.equal(built.releases[0]?.verification?.coverMatchLevel, "EDITION");
  assert.equal(built.releases[0]?.verification?.sourceReleaseDate, "1990-01-01");
  assert.equal(built.verificationCandidates?.[0]?.originalReleaseDate, "1988-02-10");
  assert.deepEqual(built.releases[0]?.verification?.corroboratingSourceUrls, [
    "https://musicbrainz.org/release/1",
  ]);
  assert.equal(built.verificationCandidates?.[1]?.resolution, "OUT_OF_SCOPE");
  assert.equal(built.verificationCandidates?.[1]?.ledger.at(-1)?.reasonCode, "LATER_EDITION_NOT_SELECTED");

  const originalCover = values[0]!.cover;
  assert.ok(originalCover?.status === "FOUND");
  const workCoverValue: ComprehensiveCandidateResult = {
    ...values[0]!,
    cover: {
      ...originalCover,
      coverMatchLevel: "WORK",
      sourceReleaseDate: "2015-09-16T00:00:00Z",
    },
  };
  const workBuilt = buildComprehensiveReleaseResearchResult(request, {
    ...base,
    releases: [workCoverValue.candidate],
  }, bundle, {
    results: [workCoverValue],
    verifiedCandidates: [workCoverValue.candidate],
    summary: { totalCandidates: 1, evidenceReadyForAi: 1, aiAccepted: 1, verified: 1, pendingEvidence: 0, pendingCover: 0, rejected: 0, outOfScope: 0 },
  }, new Date("2026-07-12T00:00:00.000Z"));
  assert.equal(workBuilt.releases[0]?.verification?.coverMatchLevel, "WORK");
  assert.equal(workBuilt.releases[0]?.verification?.sourceReleaseDate, "2015-09-16T00:00:00Z");
});

test("refuses to publish malformed VERIFIED runtime results", () => {
  const baseValue = verified("1", "work-a", "Title A", "1990-01-01");
  const base = {
    artist: { name: "中山美穂", nameKana: null, nameRomaji: null, country: "JP", officialSiteUrl: null },
    collectionScope: { target: "ORIGINAL_CD", excludeReissues: true, includeCollaborations: true },
    releases: [baseValue.candidate],
    globalWarnings: [],
  } satisfies ReleaseResearchResult;
  const bundle = {
    query: { artistName: "中山美穂", targetCountry: "JP", target: "ORIGINAL_CD" },
    artist: null,
    releases: [],
    sourceWhitelist: [],
    warnings: [],
    stats: { artistResultsInspected: 1, releaseGroupsFetched: 1, releasesFetched: 1, releasesAccepted: 1, coverLookups: 1 },
  } satisfies ArtistReleaseEvidenceBundle;
  const build = (value: ComprehensiveCandidateResult) =>
    buildComprehensiveReleaseResearchResult(request, base, bundle, {
      results: [value],
      verifiedCandidates: [value.candidate],
      summary: { totalCandidates: 1, evidenceReadyForAi: 1, aiAccepted: 1, verified: 1, pendingEvidence: 0, pendingCover: 0, rejected: 0, outOfScope: 0 },
    });

  const missingCoverUrl = structuredClone(baseValue);
  missingCoverUrl.candidate.coverImageUrl = null;
  assert.throws(() => build(missingCoverUrl), /provider-bound cover attestation/);

  const wrongCoverLedger = structuredClone(baseValue);
  wrongCoverLedger.ledger.at(-1)!.sourceUrls = ["https://music.apple.com/jp/album/other/2"];
  assert.throws(() => build(wrongCoverLedger), /exactly bound to a PASS ledger/);

  const terminalCoverUnknown = structuredClone(baseValue);
  terminalCoverUnknown.ledger.push({
    stage: "COVER",
    verdict: "UNKNOWN",
    reasonCode: "COVER_REVALIDATION_PENDING",
    message: "A later cover gate is still pending.",
    sourceUrls: [],
    retryable: true,
    conflictIds: [],
  });
  assert.throws(() => build(terminalCoverUnknown), /exactly bound to a PASS ledger/);

  const mismatchedDate = structuredClone(baseValue);
  assert.ok(mismatchedDate.cover?.status === "FOUND");
  mismatchedDate.cover.sourceReleaseDate = "1991-01-01";
  assert.throws(() => build(mismatchedDate), /cover date inconsistent/);

  const incompleteIdentity = structuredClone(baseValue);
  incompleteIdentity.candidate.catalogNumber = null;
  assert.throws(() => build(incompleteIdentity), /incomplete physical-CD identity/);

  const missingEvidence = structuredClone(baseValue);
  missingEvidence.ledger = missingEvidence.ledger.filter((entry) => entry.stage !== "AUTHORITATIVE");
  assert.throws(() => build(missingEvidence), /complete PASS identity evidence/);

  const forgedAcceptReason = structuredClone(baseValue);
  forgedAcceptReason.aiDecision!.reasonCode = "INSUFFICIENT_EVIDENCE" as never;
  assert.throws(
    () => build(forgedAcceptReason),
    /invalid AI decision contract/,
  );

  const nonStringConflictIds = structuredClone(baseValue) as unknown as Record<string, unknown>;
  const nonStringLedger = nonStringConflictIds.ledger as Array<Record<string, unknown>>;
  nonStringLedger[0]!.conflictIds = [42];
  assert.throws(
    () => build(nonStringConflictIds as unknown as ComprehensiveCandidateResult),
    /incomplete PASS evidence ledger/,
  );

  const laterAuthorityReject = structuredClone(baseValue);
  laterAuthorityReject.ledger.push({
    stage: "AUTHORITATIVE",
    verdict: "REJECT",
    reasonCode: "LATER_AUTHORITY_CONFLICT",
    message: "A later authority rejects this identity.",
    sourceUrls: ["https://ndlsearch.ndl.go.jp/books/R100000002-Iconflict"],
    retryable: false,
    conflictIds: ["authority-conflict"],
  });
  assert.throws(
    () => build(laterAuthorityReject),
    /retains rejected or out-of-scope evidence/,
  );

  const laterOutOfScope = structuredClone(baseValue);
  laterOutOfScope.ledger.push({
    stage: "SCOPE",
    verdict: "OUT_OF_SCOPE",
    reasonCode: "LATER_SCOPE_EXCLUSION",
    message: "A later scope gate excludes this candidate.",
    sourceUrls: [],
    retryable: false,
    conflictIds: [],
  });
  assert.throws(
    () => build(laterOutOfScope),
    /retains rejected or out-of-scope evidence/,
  );

  const terminalAiUnknown = structuredClone(baseValue);
  terminalAiUnknown.ledger.push({
    stage: "AI_AUDIT",
    verdict: "UNKNOWN",
    reasonCode: "LATER_AI_REVIEW_PENDING",
    message: "A later AI review is unresolved.",
    sourceUrls: [],
    retryable: true,
    conflictIds: [],
  });
  assert.throws(
    () => build(terminalAiUnknown),
    /not bound to its terminal PASS audit/,
  );

  const weakSourcesAfterPass = structuredClone(baseValue);
  weakSourcesAfterPass.ledger.splice(-1, 0, {
    stage: "AUTHORITATIVE",
    verdict: "UNKNOWN",
    reasonCode: "SECOND_AUTHORITY_UNAVAILABLE",
    message: "A weaker secondary source is unavailable.",
    sourceUrls: [],
    retryable: true,
    conflictIds: [],
  }, {
    stage: "SCOPE",
    verdict: "UNKNOWN",
    reasonCode: "WEAK_SCOPE_SOURCE_UNAVAILABLE",
    message: "One weak scope source is unavailable after a conclusive pass.",
    sourceUrls: [],
    retryable: true,
    conflictIds: [],
  });
  assert.doesNotThrow(() => build(weakSourcesAfterPass));

  const aiAudited = structuredClone(baseValue);
  aiAudited.aiDecision!.reason = "The semantic audit accepted the supplied identity.";
  aiAudited.ledger = aiAudited.ledger.filter((entry) =>
    entry.reasonCode !== "DETERMINISTIC_EVIDENCE_ACCEPTED");
  aiAudited.ledger.splice(-1, 0, {
    stage: "AI_AUDIT",
    verdict: "PASS",
    reasonCode: "EVIDENCE_CONSISTENT",
    message: "The semantic audit accepted the supplied identity.",
    sourceUrls: [],
    retryable: false,
    conflictIds: [],
  });
  assert.doesNotThrow(() => build(aiAudited));
});
