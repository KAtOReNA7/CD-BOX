import assert from "node:assert/strict";
import test from "node:test";
import {
  applyComprehensiveWorkRules,
  addComprehensiveConflict,
  addComprehensiveObservation,
  comprehensiveCandidatesFromResearch,
  createComprehensiveLedgerEntry,
  resolveComprehensiveCandidateResolution,
  retryComprehensiveCovers,
  retryTransientComprehensiveCovers,
  runComprehensiveDiscographyPipeline,
  type ComprehensiveDiscographyCandidate,
} from "@/lib/ai/comprehensive-discography";
import type {
  ComprehensiveAiDecision,
  ComprehensiveEvidenceObservation,
} from "@/lib/ai/comprehensive-evidence-audit";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import type {
  ArtistReleaseEditionEvidence,
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";

const releaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function observation(
  id: string,
  overrides: Partial<ComprehensiveEvidenceObservation> = {},
): ComprehensiveEvidenceObservation {
  return {
    id,
    provider: id === "mb" ? "musicbrainz" : "king-records",
    role: id === "mb" ? "DISCOVERY" : "AUTHORITATIVE",
    strength: id === "mb" ? "SUPPORTING" : "STRONG",
    stage: id === "mb" ? "MUSICBRAINZ" : "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "SOURCE_MATCH",
    reason: "The supplied edition fields match.",
    sourceUrl: id === "mb"
      ? `https://musicbrainz.org/release/${releaseId}`
      : `https://example.com/${id}`,
    matchedFields: ["title", "artist", "catalogNumber", "date", "format"],
    facts: {
      title: "CATCH THE NITE",
      artist: "Miho Nakayama",
      catalogNumber: "K32X-240",
      date: "1988-02-10",
      format: "CD",
    },
    ...overrides,
  };
}

function readyCandidate(): ComprehensiveDiscographyCandidate {
  return {
    candidate: releaseCandidate(),
    workId: groupId,
    editionId: releaseId,
    observations: [observation("mb"), observation("official")],
    conflicts: [],
  };
}

function reviewableCandidate(): ComprehensiveDiscographyCandidate {
  return addComprehensiveConflict(readyCandidate(), {
    id: "title-review",
    certainty: "AI_REVIEW",
    reasonCode: "TITLE_CONFLICT",
    field: "title",
    sourceObservationIds: ["mb", "official"],
    message: "Compare the supplied cross-script title identities.",
  });
}

function accept(candidateId = `release-${releaseId}`): ComprehensiveAiDecision {
  return {
    candidateId,
    decision: "ACCEPT",
    reasonCode: "EVIDENCE_CONSISTENT",
    reason: "The edition evidence agrees.",
    conflictIds: [],
  };
}

test("evidence with no semantic ambiguity skips AI, checkpoints the automatic decision, and still validates its cover", async () => {
  const order: string[] = [];
  const aiProgress: Array<{ processed: number; total: number }> = [];
  let checkpoint: ComprehensiveAiDecision[] = [];
  const output = await runComprehensiveDiscographyPipeline([readyCandidate()], {
    auditEvidence: async () => {
      throw new Error("deterministic evidence must not call AI");
    },
    lookupValidatedCover: async () => {
      order.push("cover");
      return {
        status: "FOUND",
        imageUrl: "https://coverartarchive.org/release/example/front-500",
        sourceUrl: "https://coverartarchive.org/release/example",
        provider: "cover-art-archive",
        checkedAt: "2026-07-12T00:00:00.000Z",
        coverMatchLevel: "EDITION",
        sourceReleaseDate: "1988-02-10",
      };
    },
    onAiCheckpoint: ({ decisions }) => {
      checkpoint = decisions;
    },
    onProgress: ({ processed, total, stage }) => {
      if (stage === "AI_AUDIT") aiProgress.push({ processed, total });
    },
  });
  assert.deepEqual(order, ["cover"]);
  assert.deepEqual(aiProgress, []);
  assert.equal(checkpoint[0]?.decision, "ACCEPT");
  assert.equal(output.results[0]?.resolution, "VERIFIED");
  assert.equal(output.verifiedCandidates[0]?.coverImageUrl, "https://coverartarchive.org/release/example/front-500");
  assert.equal(output.results[0]?.ledger.some((entry) =>
    entry.reasonCode === "DETERMINISTIC_EVIDENCE_ACCEPTED"), true);
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "VALIDATED_EDITION_COVER_FOUND");
  assert.equal(output.summary.verified, 1);
});

test("incomplete physical-CD identities remain pending before AI and cover work", async () => {
  const cases: Array<[string, Partial<ReleaseResearchCandidate>]> = [
    ["year-only release date", { releaseDate: "1988" }],
    ["month-only original date", { originalReleaseDate: "1988-02" }],
    ["missing catalog", { catalogNumber: null }],
    ["missing format", { format: null }],
    ["non-CD format", { format: "Vinyl" }],
  ];
  for (const [label, overrides] of cases) {
    let aiCalls = 0;
    let coverCalls = 0;
    const value = readyCandidate();
    value.candidate = releaseCandidate(overrides);
    const output = await runComprehensiveDiscographyPipeline([value], {
      auditEvidence: async () => {
        aiCalls += 1;
        return [];
      },
      lookupValidatedCover: async () => {
        coverCalls += 1;
        throw new Error("an incomplete edition must not reach cover lookup");
      },
    });
    assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE", label);
    assert.equal(output.results[0]?.ledger.some((entry) =>
      entry.reasonCode === "PHYSICAL_EDITION_IDENTITY_INCOMPLETE"), true, label);
    assert.equal(aiCalls, 0, label);
    assert.equal(coverCalls, 0, label);
  }
});

test("an edition after an AVAILABLE_BY upper bound remains pending before AI and cover work", async () => {
  let aiCalls = 0;
  let coverCalls = 0;
  const value = readyCandidate();
  value.candidate = releaseCandidate({
    releaseDate: "2011-01-01",
    originalReleaseDate: "1980-07-01",
  });
  value.observations = [...value.observations, observation("available-by", {
    provider: "curated-official-manifest:test",
    role: "DISCOVERY",
    strength: "SUPPORTING",
    stage: "SCOPE",
    matchedFields: ["country", "format"],
    facts: {
      physicalCd: "LATER_OFFICIAL_EDITION",
      physicalCdDateEvidenceKind: "AVAILABLE_BY",
      physicalCdReleaseDate: "2010-05-26",
    },
  })];
  const output = await runComprehensiveDiscographyPipeline([value], {
    auditEvidence: async () => {
      aiCalls += 1;
      return [];
    },
    lookupValidatedCover: async () => {
      coverCalls += 1;
      throw new Error("a later edition must not reach cover lookup");
    },
  });
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.ledger.some((entry) =>
    entry.reasonCode === "PHYSICAL_CD_AFTER_AVAILABLE_BY"), true);
  assert.equal(aiCalls, 0);
  assert.equal(coverCalls, 0);
});

test("only AI_REVIEW candidates enter the model batch and AI progress total", async () => {
  const automatic = readyCandidate();
  const reviewable = {
    ...reviewableCandidate(),
    candidate: releaseCandidate({ id: "reviewable-candidate" }),
    workId: "reviewable-work",
    editionId: "reviewable-edition",
  };
  const auditedIds: string[] = [];
  const aiProgress: Array<{ processed: number; total: number }> = [];
  let checkpoint: ComprehensiveAiDecision[] = [];
  const output = await runComprehensiveDiscographyPipeline([automatic, reviewable], {
    auditEvidence: async (batch) => {
      auditedIds.push(...batch.map((candidate) => candidate.candidateId));
      return batch.map((candidate) => accept(candidate.candidateId));
    },
    lookupValidatedCover: async (candidate) => ({
      status: "FOUND",
      imageUrl: `https://coverartarchive.org/release/${candidate.editionId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${candidate.editionId}`,
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: candidate.candidate.releaseDate,
    }),
    onAiCheckpoint: ({ decisions }) => {
      checkpoint = decisions;
    },
    onProgress: ({ processed, total, stage }) => {
      if (stage === "AI_AUDIT") aiProgress.push({ processed, total });
    },
  });

  assert.deepEqual(auditedIds, ["reviewable-candidate"]);
  assert.deepEqual(aiProgress, [{ processed: 1, total: 1 }]);
  assert.deepEqual(checkpoint.map((decision) => decision.candidateId), [
    automatic.candidate.id,
    reviewable.candidate.id,
  ]);
  assert.equal(output.summary.verified, 2);
});

test("records a WORK cover without claiming that it matches the physical edition", async () => {
  const output = await runComprehensiveDiscographyPipeline([readyCandidate()], {
    auditEvidence: async () => [accept()],
    lookupValidatedCover: async () => ({
      status: "FOUND",
      imageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/work/600x600bb.jpg",
      sourceUrl: "https://music.apple.com/jp/album/example/123",
      provider: "apple-music",
      checkedAt: "2026-07-12T00:00:00.000Z",
      coverMatchLevel: "WORK",
      sourceReleaseDate: "2015-09-16T00:00:00Z",
    }),
  });

  assert.equal(output.results[0]?.resolution, "VERIFIED");
  assert.equal(output.results[0]?.cover?.status === "FOUND"
    ? output.results[0]?.cover.coverMatchLevel
    : null, "WORK");
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "VALIDATED_WORK_COVER_FOUND");
  assert.match(output.results[0]?.ledger.at(-1)?.message ?? "", /not this physical edition/u);
});

test("AI UNKNOWN remains pending evidence and never spends a cover lookup", async () => {
  let coverCalls = 0;
  const output = await runComprehensiveDiscographyPipeline([reviewableCandidate()], {
    auditEvidence: async () => [{
      candidateId: `release-${releaseId}`,
      decision: "UNKNOWN",
      reasonCode: "INSUFFICIENT_EVIDENCE",
      reason: "The title relationship cannot be resolved.",
      conflictIds: [],
    }],
    lookupValidatedCover: async () => {
      coverCalls += 1;
      return { status: "MISSING", reasonCode: "NO_COVER", reason: "No cover.", retryable: false };
    },
  });
  assert.equal(coverCalls, 0);
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.evidenceVerdict, "UNKNOWN");
  assert.equal(output.results[0]?.ledger.at(-1)?.verdict, "UNKNOWN");
  assert.equal(output.summary.evidenceReadyForAi, 1);
});

test("an accepted correct edition without a cover is PENDING_COVER, not REJECTED", async () => {
  const output = await runComprehensiveDiscographyPipeline([readyCandidate()], {
    auditEvidence: async () => [accept()],
    lookupValidatedCover: async () => ({
      status: "UNAVAILABLE",
      reasonCode: "COVER_PROVIDER_UNAVAILABLE",
      reason: "The exact cover provider timed out.",
      retryable: true,
    }),
  });
  assert.equal(output.results[0]?.resolution, "PENDING_COVER");
  assert.equal(output.results[0]?.ledger.at(-1)?.retryable, true);
  assert.equal(output.summary.pendingCover, 1);
  assert.equal(output.summary.rejected, 0);
  assert.equal(output.verifiedCandidates.length, 0);
});

test("temporary AI failure becomes retryable UNKNOWN instead of failing the pipeline", async () => {
  let coverCalls = 0;
  const output = await runComprehensiveDiscographyPipeline([reviewableCandidate()], {
    auditEvidence: async () => {
      throw new Error("relay timeout");
    },
    lookupValidatedCover: async () => {
      coverCalls += 1;
      return { status: "MISSING", reasonCode: "NO_COVER", reason: "No cover.", retryable: false };
    },
  });
  assert.equal(coverCalls, 0);
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.evidenceVerdict, "UNKNOWN");
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "AI_AUDIT_UNAVAILABLE");
  assert.equal(output.summary.evidenceReadyForAi, 1);
});

test("a malformed AI batch is bisected so valid candidate decisions are not discarded", async () => {
  const first = reviewableCandidate();
  const second = {
    ...reviewableCandidate(),
    candidate: releaseCandidate({ id: "second-candidate" }),
    workId: "second-work",
    editionId: "second-edition",
  };
  let auditCalls = 0;
  const output = await runComprehensiveDiscographyPipeline([first, second], {
    auditEvidence: async (batch) => {
      auditCalls += 1;
      if (batch.length > 1) throw new Error("malformed combined response");
      return [accept(batch[0]!.candidateId)];
    },
    lookupValidatedCover: async (candidate) => ({
      status: "FOUND",
      imageUrl: `https://coverartarchive.org/release/${candidate.editionId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${candidate.editionId}`,
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: candidate.candidate.releaseDate,
    }),
  });
  assert.equal(auditCalls, 3);
  assert.equal(output.summary.aiAccepted, 2);
  assert.equal(output.summary.verified, 2);
});

test("a batch response missing candidate ids is bisected as a validation failure", async () => {
  const first = reviewableCandidate();
  const second = {
    ...reviewableCandidate(),
    candidate: releaseCandidate({ id: "missing-id-second" }),
    workId: "missing-id-work-second",
    editionId: "missing-id-edition-second",
  };
  let auditCalls = 0;
  const output = await runComprehensiveDiscographyPipeline([first, second], {
    auditEvidence: async (batch) => {
      auditCalls += 1;
      return [accept(batch[0]!.candidateId)];
    },
    lookupValidatedCover: async (candidate) => ({
      status: "FOUND",
      imageUrl: `https://coverartarchive.org/release/${candidate.editionId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${candidate.editionId}`,
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: candidate.candidate.releaseDate,
    }),
  });

  assert.equal(auditCalls, 3);
  assert.equal(output.summary.verified, 2);
});

test("provider-wide AI failures mark the whole batch UNKNOWN without recursive request amplification", async () => {
  const first = reviewableCandidate();
  const second = {
    ...reviewableCandidate(),
    candidate: releaseCandidate({ id: "provider-failure-second" }),
    workId: "provider-failure-work-second",
    editionId: "provider-failure-edition-second",
  };
  let auditCalls = 0;
  let coverCalls = 0;
  let unavailableCandidateIds: string[] = [];
  const failure = Object.assign(new Error("403 gateway authentication failed"), { status: 403 });
  const output = await runComprehensiveDiscographyPipeline([first, second], {
    aiBatchSize: 1,
    auditEvidence: async () => {
      auditCalls += 1;
      throw failure;
    },
    lookupValidatedCover: async () => {
      coverCalls += 1;
      return { status: "MISSING", reasonCode: "NO_COVER", reason: "No cover.", retryable: false };
    },
    onAiCheckpoint: (checkpoint) => {
      unavailableCandidateIds = checkpoint.unavailableCandidateIds;
    },
  });

  assert.equal(auditCalls, 1);
  assert.equal(coverCalls, 0);
  assert.equal(output.summary.pendingEvidence, 2);
  assert.equal(output.results.every((result) =>
    result.ledger.at(-1)?.reasonCode === "AI_AUDIT_UNAVAILABLE"), true);
  assert.deepEqual(new Set(unavailableCandidateIds), new Set([
    first.candidate.id,
    second.candidate.id,
  ]));
});

test("concurrent cover workers serialize progress updates in monotonic order", async () => {
  const first = readyCandidate();
  const second = {
    ...readyCandidate(),
    candidate: releaseCandidate({ id: "progress-second" }),
    workId: "progress-work-second",
    editionId: "progress-edition-second",
  };
  const coverProgress: number[] = [];
  await runComprehensiveDiscographyPipeline([first, second], {
    coverConcurrency: 2,
    auditEvidence: async (batch) => batch.map((candidate) => accept(candidate.candidateId)),
    lookupValidatedCover: async (candidate) => ({
      status: "FOUND",
      imageUrl: `https://coverartarchive.org/release/${candidate.editionId}/front-500`,
      sourceUrl: `https://coverartarchive.org/release/${candidate.editionId}`,
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: candidate.candidate.releaseDate,
    }),
    onProgress: async ({ processed, stage }) => {
      if (stage !== "COVER") return;
      if (processed === 1) await new Promise((resolve) => setTimeout(resolve, 10));
      coverProgress.push(processed);
    },
  });
  assert.deepEqual(coverProgress, [1, 2]);
});

test("a rejected first pass and accepted second review become retryable UNKNOWN", async () => {
  const source = addComprehensiveConflict(readyCandidate(), {
    id: "title-review",
    certainty: "AI_REVIEW",
    reasonCode: "TITLE_CONFLICT",
    field: "title",
    sourceObservationIds: ["mb", "official"],
    message: "Compare the two supplied title notations.",
  });
  let calls = 0;
  let coverCalls = 0;
  let checkpoint: ComprehensiveAiDecision[] = [];
  const output = await runComprehensiveDiscographyPipeline([source], {
    auditEvidence: async () => {
      calls += 1;
      return calls === 1 ? [{
        candidateId: source.candidate.id,
        decision: "REJECT",
        reasonCode: "TITLE_CONFLICT",
        reason: "The first pass considered the titles different.",
        conflictIds: ["title-review"],
      }] : [accept(source.candidate.id)];
    },
    lookupValidatedCover: async () => {
      coverCalls += 1;
      return { status: "MISSING", reasonCode: "NO_COVER", reason: "No cover.", retryable: false };
    },
    onAiCheckpoint: ({ decisions }) => {
      checkpoint = decisions;
    },
  });
  assert.equal(calls, 2);
  assert.equal(coverCalls, 0);
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.aiDecision?.decision, "UNKNOWN");
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "AI_REVIEW_DISAGREEMENT");
  assert.equal(output.results[0]?.ledger.at(-1)?.retryable, true);
  assert.equal(checkpoint[0]?.decision, "UNKNOWN");
});

test("a rejected first pass and UNKNOWN second review remain UNKNOWN", async () => {
  const source = addComprehensiveConflict(readyCandidate(), {
    id: "title-review",
    certainty: "AI_REVIEW",
    reasonCode: "TITLE_CONFLICT",
    field: "title",
    sourceObservationIds: ["mb", "official"],
    message: "Compare the two supplied title notations.",
  });
  let calls = 0;
  const output = await runComprehensiveDiscographyPipeline([source], {
    auditEvidence: async () => {
      calls += 1;
      return calls === 1 ? [{
        candidateId: source.candidate.id,
        decision: "REJECT",
        reasonCode: "TITLE_CONFLICT",
        reason: "The first pass considered the titles different.",
        conflictIds: ["title-review"],
      }] : [{
        candidateId: source.candidate.id,
        decision: "UNKNOWN",
        reasonCode: "INSUFFICIENT_EVIDENCE",
        reason: "The second pass could not establish a conflict.",
        conflictIds: [],
      }];
    },
    lookupValidatedCover: async () => {
      throw new Error("cover must not run");
    },
  });
  assert.equal(calls, 2);
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.aiDecision?.decision, "UNKNOWN");
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "AI_REVIEW_DISAGREEMENT");
});

test("only two agreeing AI rejection passes discard an edition", async () => {
  const source = addComprehensiveConflict(readyCandidate(), {
    id: "title-review",
    certainty: "AI_REVIEW",
    reasonCode: "TITLE_CONFLICT",
    field: "title",
    sourceObservationIds: ["mb", "official"],
    message: "Compare the two supplied title notations.",
  });
  let calls = 0;
  const output = await runComprehensiveDiscographyPipeline([source], {
    auditEvidence: async () => {
      calls += 1;
      return [{
        candidateId: source.candidate.id,
        decision: "REJECT",
        reasonCode: "TITLE_CONFLICT",
        reason: calls === 1
          ? "The first pass found a supplied title conflict."
          : "The second pass independently confirmed the supplied title conflict.",
        conflictIds: ["title-review"],
      }];
    },
    lookupValidatedCover: async () => {
      throw new Error("cover must not run");
    },
  });
  assert.equal(calls, 2);
  assert.equal(output.results[0]?.resolution, "REJECTED");
  assert.equal(output.results[0]?.evidenceVerdict, "REJECT");
  assert.equal(output.results[0]?.aiDecision?.decision, "REJECT");
  assert.equal(output.summary.evidenceReadyForAi, 1);
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "AI_REJECTION_CONFIRMED");
  assert.deepEqual(output.results[0]?.ledger.at(-1)?.conflictIds, ["title-review"]);
});

test("an unavailable second rejection review cannot discard an edition", async () => {
  const source = addComprehensiveConflict(readyCandidate(), {
    id: "title-review",
    certainty: "AI_REVIEW",
    reasonCode: "TITLE_CONFLICT",
    field: "title",
    sourceObservationIds: ["mb", "official"],
    message: "Compare the two supplied title notations.",
  });
  let calls = 0;
  const output = await runComprehensiveDiscographyPipeline([source], {
    auditEvidence: async () => {
      calls += 1;
      if (calls === 2) throw new Error("review relay timeout");
      return [{
        candidateId: source.candidate.id,
        decision: "REJECT",
        reasonCode: "TITLE_CONFLICT",
        reason: "The first pass considered the titles different.",
        conflictIds: ["title-review"],
      }];
    },
    lookupValidatedCover: async () => {
      throw new Error("cover must not run");
    },
  });
  assert.equal(calls, 2);
  assert.equal(output.results[0]?.resolution, "PENDING_EVIDENCE");
  assert.equal(output.results[0]?.aiDecision?.decision, "UNKNOWN");
  assert.equal(output.results[0]?.ledger.at(-1)?.reasonCode, "AI_REJECTION_REVIEW_UNAVAILABLE");
  assert.equal(output.results[0]?.ledger.at(-1)?.retryable, true);
});

test("original-CD cover work targets only the earliest accepted edition per work", async () => {
  const first = readyCandidate();
  const later = {
    ...readyCandidate(),
    candidate: releaseCandidate({
      id: "later-edition",
      releaseDate: "1992-07-22",
      catalogNumber: "KICS-240",
    }),
    editionId: "later-edition",
  };
  const coverCalls: string[] = [];
  const output = await runComprehensiveDiscographyPipeline([later, first], {
    coverSelection: "EARLIEST_ACCEPTED_PER_WORK",
    auditEvidence: async (batch) => batch.map((candidate) => accept(candidate.candidateId)),
    lookupValidatedCover: async (candidate) => {
      coverCalls.push(candidate.candidate.id);
      return {
        status: "FOUND",
        imageUrl: `https://coverartarchive.org/release/${candidate.editionId}/front-500`,
        sourceUrl: `https://coverartarchive.org/release/${candidate.editionId}`,
        provider: "cover-art-archive",
        coverMatchLevel: "EDITION",
        sourceReleaseDate: candidate.candidate.releaseDate,
      };
    },
  });
  assert.deepEqual(coverCalls, [first.candidate.id]);
  assert.equal(output.results.find((result) => result.candidate.id === "later-edition")?.resolution, "OUT_OF_SCOPE");
  assert.equal(output.results.find((result) => result.candidate.id === "later-edition")?.evidenceVerdict, "OUT_OF_SCOPE");
  assert.equal(output.results.find((result) => result.candidate.id === "later-edition")?.ledger.at(-1)?.reasonCode, "LATER_EDITION_NOT_SELECTED");
});

test("an incomplete canonical representation cannot displace a complete provider edition", async () => {
  const providerEdition = readyCandidate();
  const canonicalRepresentation: ComprehensiveDiscographyCandidate = {
    ...readyCandidate(),
    candidate: releaseCandidate({
      id: "canonical-representation",
      releaseDate: null,
      originalReleaseDate: "1988-02-12",
      catalogNumber: null,
      editionType: "OFFICIAL_COMPLETE_CATALOGUE_REPRESENTATION",
    }),
    editionId: "canonical-representation",
    observations: [
      ...readyCandidate().observations,
      observation("curated", {
        provider: "curated-official-manifest:miho-test",
        reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
        facts: {
          artist: "中山美穂",
          title: "CATCH THE NITE",
          category: "ORIGINAL_ALBUM",
          date: "1988-02-12",
          manifestEntryKey: "ORIGINAL_ALBUM:1",
        },
      }),
    ],
  };
  const coverCalls: string[] = [];
  const output = await runComprehensiveDiscographyPipeline([
    providerEdition,
    canonicalRepresentation,
  ], {
    coverSelection: "EARLIEST_ACCEPTED_PER_WORK",
    auditEvidence: async (batch) => batch.map((candidate) => accept(candidate.candidateId)),
    lookupValidatedCover: async (candidate) => {
      coverCalls.push(candidate.candidate.id);
      return {
        status: "FOUND",
        imageUrl: "https://coverartarchive.org/release/canonical/front-500",
        sourceUrl: "https://coverartarchive.org/release/canonical",
        provider: "cover-art-archive",
        coverMatchLevel: "WORK",
        sourceReleaseDate: candidate.candidate.originalReleaseDate,
      };
    },
  });
  assert.deepEqual(coverCalls, [providerEdition.candidate.id]);
  assert.equal(output.verifiedCandidates[0]?.id, providerEdition.candidate.id);
  const incomplete = output.results.find((result) =>
    result.candidate.id === "canonical-representation");
  assert.equal(incomplete?.resolution, "PENDING_EVIDENCE");
  assert.equal(incomplete?.ledger.some((entry) =>
    entry.reasonCode === "PHYSICAL_EDITION_IDENTITY_INCOMPLETE"), true);
});

test("explicit conflict rejects, while unknown authority never rejects", async () => {
  const explicit = addComprehensiveConflict(readyCandidate(), {
    id: "barcode-conflict",
    certainty: "EXPLICIT",
    reasonCode: "BARCODE_CONFLICT",
    field: "barcode",
    sourceObservationIds: ["mb", "official"],
    message: "Two complete barcodes conflict.",
  });
  const unknown = addComprehensiveObservation(readyCandidate(), observation("official", {
    verdict: "UNKNOWN",
    reasonCode: "OFFICIAL_TEMPORARILY_UNAVAILABLE",
    reason: "The official catalogue timed out.",
    retryable: true,
  }));
  let aiCalls = 0;
  const output = await runComprehensiveDiscographyPipeline([
    explicit,
    { ...unknown, candidate: releaseCandidate({ id: "unknown-candidate" }), editionId: "unknown-edition" },
  ], {
    auditEvidence: async () => {
      aiCalls += 1;
      return [];
    },
    lookupValidatedCover: async () => {
      throw new Error("cover must not run");
    },
  });
  assert.equal(aiCalls, 0);
  assert.equal(output.results[0]?.resolution, "REJECTED");
  assert.equal(output.results[1]?.resolution, "PENDING_EVIDENCE");
});

test("ledger constructor refuses a REJECT without an explicit conflict id", () => {
  assert.throws(() => createComprehensiveLedgerEntry({
    stage: "CORROBORATION",
    verdict: "REJECT",
    reasonCode: "OTHER_CONFLICT",
    message: "No explicit conflict was supplied.",
    sourceUrls: [],
    retryable: false,
    conflictIds: [],
  }), /requires at least one explicit conflict/);
});

test("pure resolution keeps missing evidence and missing cover separate", () => {
  assert.equal(resolveComprehensiveCandidateResolution({
    evidenceVerdict: "UNKNOWN",
    aiDecision: null,
    coverStatus: null,
  }), "PENDING_EVIDENCE");
  assert.equal(resolveComprehensiveCandidateResolution({
    evidenceVerdict: "PASS",
    aiDecision: "ACCEPT",
    coverStatus: "MISSING",
  }), "PENDING_COVER");
});

test("automatic cover retry promotes only transient pending covers", async () => {
  const source = readyCandidate();
  const initial = await runComprehensiveDiscographyPipeline([source], {
    auditEvidence: async () => [accept(source.candidate.id)],
    lookupValidatedCover: async () => ({
      status: "UNAVAILABLE",
      reasonCode: "COVER_TIMEOUT",
      reason: "Timed out.",
      retryable: true,
    }),
  });
  let retryCalls = 0;
  const retried = await retryTransientComprehensiveCovers(initial, [source], async () => {
    retryCalls += 1;
    return {
      status: "FOUND",
      imageUrl: "https://coverartarchive.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/front-500",
      sourceUrl: "https://coverartarchive.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10",
    };
  });
  assert.equal(retryCalls, 1);
  assert.equal(retried.results[0]?.resolution, "VERIFIED");
  assert.equal(retried.summary.verified, 1);
  assert.equal(retried.results[0]?.ledger.at(-1)?.reasonCode, "VALIDATED_EDITION_COVER_FOUND_ON_RETRY");

  const missing = {
    ...initial,
    results: initial.results.map((result) => ({
      ...result,
      cover: { status: "MISSING" as const, reasonCode: "NO_COVER", reason: "No cover.", retryable: false },
    })),
  };
  await retryTransientComprehensiveCovers(missing, [source], async () => {
    retryCalls += 1;
    throw new Error("must not be called");
  });
  assert.equal(retryCalls, 1);

  const scheduledProgress: Array<{
    processed: number;
    total: number;
    round: number;
    found: number;
    pending: number;
  }> = [];
  const scheduled = await retryComprehensiveCovers(missing, [source], async () => {
    retryCalls += 1;
    return {
      status: "FOUND",
      imageUrl: "https://coverartarchive.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/front-500",
      sourceUrl: "https://coverartarchive.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "cover-art-archive",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10",
    };
  }, {
    includeMissing: true,
    candidateIds: new Set([source.candidate.id]),
    onProgress: (progress) => {
      scheduledProgress.push(progress);
    },
  });
  assert.equal(retryCalls, 2);
  assert.equal(scheduled.results[0]?.resolution, "VERIFIED");
  assert.deepEqual(scheduledProgress, [
    { processed: 0, total: 1, round: 1, found: 0, pending: 0 },
    { processed: 1, total: 1, round: 1, found: 1, pending: 0 },
  ]);

  let mismatchedLookupCalls = 0;
  const mismatched = await retryTransientComprehensiveCovers(
    initial,
    [{ ...source, workId: "different-work" }],
    async () => {
      mismatchedLookupCalls += 1;
      throw new Error("an identity mismatch must fail before cover lookup");
    },
  );
  assert.equal(mismatchedLookupCalls, 0);
  assert.equal(mismatched.results[0]?.resolution, "PENDING_COVER");
  assert.equal(mismatched.results[0]?.cover?.status, "INVALID");
  assert.equal(
    mismatched.results[0]?.ledger.at(-1)?.reasonCode,
    "COVER_RETRY_IDENTITY_MISMATCH",
  );
});

function musicBrainzEdition(id: string, date: string, catalogNumber: string): MusicReleaseEvidence {
  return {
    entityType: "release",
    sourceId: id,
    releaseGroupId: groupId,
    title: "CATCH THE NITE",
    artistCredit: "Miho Nakayama",
    artistNames: ["Miho Nakayama"],
    artistAliases: [],
    date,
    type: "Album",
    secondaryTypes: [],
    country: "JP",
    label: "King Records",
    catalogNumber,
    format: "CD",
    labels: [{ name: "King Records", catalogNumber }],
    formats: ["CD"],
    barcode: null,
    status: "Official",
    sourceUrl: `https://musicbrainz.org/release/${id}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [
      {
        provider: "musicbrainz",
        title: "MusicBrainz release group",
        url: `https://musicbrainz.org/release-group/${groupId}`,
      },
      {
        provider: "musicbrainz",
        title: "MusicBrainz release",
        url: `https://musicbrainz.org/release/${id}`,
      },
    ],
  };
}

function researchResult(): ReleaseResearchResult {
  return {
    artist: {
      name: "中山美穂",
      nameKana: "なかやま みほ",
      nameRomaji: "Miho Nakayama",
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: [releaseCandidate()],
    globalWarnings: [],
    verificationSummary: null,
  };
}

test("research bridge preserves every detailed edition in one work", () => {
  const first = musicBrainzEdition(releaseId, "1988-02-10", "K32X-240");
  first.format = null;
  first.formats = ["CD", "Blu-ray"];
  const reissueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const reissue = musicBrainzEdition(reissueId, "1992-07-22", "KICS-240");
  const discoveredEditions: ArtistReleaseEditionEvidence[] = [
    { workId: groupId, evidence: first, scope: { verdict: "PASS", reasonCodes: [] } },
    { workId: groupId, evidence: reissue, scope: { verdict: "OUT_OF_SCOPE", reasonCodes: ["EXPLICIT_REISSUE"] } },
  ];
  const bundle: ArtistReleaseEvidenceBundle = {
    query: { artistName: "Miho Nakayama", targetCountry: "JP", target: "ORIGINAL_CD" },
    artist: null,
    releases: [],
    discoveredEditions,
    works: [{ workId: groupId, releaseGroup: null, editions: discoveredEditions }],
    sourceWhitelist: first.sources.concat(reissue.sources).map((source) => source.url),
    warnings: [],
    stats: {
      artistResultsInspected: 1,
      releaseGroupsFetched: 1,
      releasesFetched: 2,
      releasesAcceptedBeforeGrouping: 1,
      releaseGroupsAccepted: 1,
      releasesDeduplicated: 0,
      releasesAccepted: 1,
      coverLookups: 0,
    },
  };
  const candidates = comprehensiveCandidatesFromResearch(researchResult(), bundle);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.workId), [groupId, groupId]);
  assert.deepEqual(candidates.map((candidate) => candidate.editionId), [releaseId, reissueId]);
  assert.equal(candidates[0]?.candidate.format, "CD + Blu-ray");
  assert.equal(candidates[0]?.observations.find((item) => item.stage === "MUSICBRAINZ")
    ?.matchedFields.includes("format"), true);
  assert.deepEqual(
    candidates[0]?.observations.find((item) => item.stage === "SCOPE")?.matchedFields,
    ["country", "format"],
  );
  assert.equal(candidates[1]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "OUT_OF_SCOPE");
});

function workRuleCandidate(
  id: string,
  workId: string,
  title: string,
  date: string,
): ComprehensiveDiscographyCandidate {
  return {
    candidate: releaseCandidate({
      id,
      title,
      category: "SINGLE",
      releaseDate: date,
      originalReleaseDate: date,
    }),
    workId,
    editionId: `edition-${id}`,
    observations: [],
    conflicts: [],
  };
}

test("work rules never merge same-title works across dates and exclude only provable later composite reissue bundles", () => {
  const values = [
    workRuleCandidate("a", "work-a", "ROSÉCOLOR", "1990-02-10"),
    workRuleCandidate("a-duplicate", "work-a-duplicate", "ROSÉCOLOR", "1992-07-22"),
    workRuleCandidate("b", "work-b", "人魚姫 mermaid", "1988-07-11"),
    workRuleCandidate("bundle", "work-bundle", "ROSÉCOLOR / 人魚姫 (mermaid)", "1992-07-22"),
    workRuleCandidate("same-day", "work-same-day", "Unrelated title", "1992-07-22"),
  ];
  const ruled = applyComprehensiveWorkRules(values, { excludeReissues: true });
  assert.equal(ruled[1]?.workId, "work-a-duplicate");
  assert.equal(
    ruled[3]?.observations.find((item) => item.reasonCode === "LATER_COMPOSITE_REISSUE_BUNDLE")?.verdict,
    "OUT_OF_SCOPE",
  );
  assert.equal(ruled[4]?.observations.some((item) => item.verdict === "OUT_OF_SCOPE"), false);
});

test("work rules merge only an exact duplicate fingerprint with a shared edition identifier", () => {
  const values = [
    workRuleCandidate("first", "work-first", "Same title", "1988-01-01"),
    workRuleCandidate("duplicate", "work-duplicate", "Same title", "1988-01-01"),
    workRuleCandidate("different-date", "work-different-date", "Same title", "1989-01-01"),
  ];
  const ruled = applyComprehensiveWorkRules(values, { excludeReissues: true });
  assert.equal(ruled[0]?.workId, ruled[1]?.workId);
  assert.equal(ruled[2]?.workId, "work-different-date");
});

test("work rules accept a missing secondary identifier but refuse conflicting or partial duplicate evidence", () => {
  const catalogOnly = workRuleCandidate("catalog-only", "work-catalog-only", "Shared work", "1988-01-01");
  catalogOnly.candidate = {
    ...catalogOnly.candidate,
    catalogNumber: "K10X-100",
    barcode: null,
  };
  const catalogAndBarcode = workRuleCandidate(
    "catalog-and-barcode",
    "work-catalog-and-barcode",
    "Shared work",
    "1988-01-01",
  );
  catalogAndBarcode.candidate = {
    ...catalogAndBarcode.candidate,
    category: "OTHER",
    catalogNumber: "K10X 100",
    barcode: "4988003000100",
  };
  const conflictingBarcode = workRuleCandidate(
    "conflicting-barcode",
    "work-conflicting-barcode",
    "Shared work",
    "1988-01-01",
  );
  conflictingBarcode.candidate = {
    ...conflictingBarcode.candidate,
    catalogNumber: "K10X-100",
    barcode: "4988003000999",
  };
  const partialDate = workRuleCandidate("partial-date", "work-partial-date", "Shared work", "1988");
  partialDate.candidate = {
    ...partialDate.candidate,
    catalogNumber: "K10X-100",
    barcode: null,
  };

  const ruled = applyComprehensiveWorkRules(
    [catalogOnly, catalogAndBarcode, conflictingBarcode, partialDate],
    { excludeReissues: true },
  );
  assert.equal(ruled[0]?.workId, ruled[1]?.workId);
  assert.equal(ruled[2]?.workId, "work-conflicting-barcode");
  assert.equal(ruled[3]?.workId, "work-partial-date");
});

test("work rules merge by a shared barcode when catalog is absent and stop on explicit identifier conflicts", () => {
  const barcodeOnly = workRuleCandidate("barcode-only", "work-barcode-only", "Barcode work", "1988-01-01");
  barcodeOnly.candidate = {
    ...barcodeOnly.candidate,
    catalogNumber: null,
    barcode: "4988003000100",
  };
  const barcodeAndCatalog = workRuleCandidate(
    "barcode-and-catalog",
    "work-barcode-and-catalog",
    "Barcode work",
    "1988-01-01",
  );
  barcodeAndCatalog.candidate = {
    ...barcodeAndCatalog.candidate,
    catalogNumber: "K10X-100",
    barcode: "4988 0030 00100",
  };
  const explicitlyConflicted = workRuleCandidate(
    "explicit-conflict",
    "work-explicit-conflict",
    "Barcode work",
    "1988-01-01",
  );
  explicitlyConflicted.candidate = {
    ...explicitlyConflicted.candidate,
    catalogNumber: null,
    barcode: "4988003000100",
  };
  explicitlyConflicted.conflicts = [{
    id: "explicit-barcode-conflict",
    certainty: "EXPLICIT",
    reasonCode: "BARCODE_CONFLICT",
    field: "barcode",
    sourceObservationIds: ["source-a", "source-b"],
    message: "Two supplied barcodes conflict.",
  }];

  const ruled = applyComprehensiveWorkRules(
    [barcodeOnly, barcodeAndCatalog, explicitlyConflicted],
    { excludeReissues: true },
  );
  assert.equal(ruled[0]?.workId, ruled[1]?.workId);
  assert.equal(ruled[2]?.workId, "work-explicit-conflict");
});

test("composite reissue rules compare partial-date intervals instead of date strings", () => {
  const values = [
    workRuleCandidate("year-overlap", "work-year-overlap", "A", "1988"),
    workRuleCandidate("year-peer", "work-year-peer", "B", "1987-01-01"),
    workRuleCandidate("year-bundle", "work-year-bundle", "A / B", "1988-07-01"),
    workRuleCandidate("month-overlap", "work-month-overlap", "C", "1988-07"),
    workRuleCandidate("month-peer", "work-month-peer", "D", "1987-01-01"),
    workRuleCandidate("month-bundle", "work-month-bundle", "C / D", "1988-07-22"),
    workRuleCandidate("earlier-year", "work-earlier-year", "E", "1988"),
    workRuleCandidate("earlier-month", "work-earlier-month", "F", "1988-12"),
    workRuleCandidate("later-bundle", "work-later-bundle", "E / F", "1989-01"),
  ];
  const ruled = applyComprehensiveWorkRules(values, { excludeReissues: true });
  const scopeVerdict = (id: string) => ruled
    .find((candidate) => candidate.candidate.id === id)
    ?.observations.find((item) => item.reasonCode === "LATER_COMPOSITE_REISSUE_BUNDLE")
    ?.verdict;

  assert.equal(scopeVerdict("year-bundle"), undefined);
  assert.equal(scopeVerdict("month-bundle"), undefined);
  assert.equal(scopeVerdict("later-bundle"), "OUT_OF_SCOPE");
});

test("work rules preserve composite titles when prior component works are not proven and classify explicit remix versions", () => {
  const values = [
    workRuleCandidate("original", "work-original", "WAKU WAKUさせて", "1986-11-21"),
    workRuleCandidate("unproven", "work-unproven", "WAKU WAKUさせて / 未知の曲", "1992-07-22"),
    workRuleCandidate("party", "work-party", "WAKU WAKU SASETE (PARTY VERSION)", "1986-12-10"),
  ];
  const ruled = applyComprehensiveWorkRules(values, { excludeReissues: true });
  assert.equal(ruled[1]?.observations.some((item) => item.verdict === "OUT_OF_SCOPE"), false);
  assert.equal(ruled[2]?.candidate.category, "REMIX");
});
