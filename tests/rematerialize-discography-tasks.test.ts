import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
} from "@/lib/ai/comprehensive-discography";
import { parsePersistedCoverRetryState } from "@/lib/ai/scheduled-cover-retry";
import type { ReleaseResearchCandidate } from "@/lib/ai/release-research-types";
import { SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS } from "@/lib/official-music/seiko-matsuda";
import {
  OFFLINE_REMATERIALIZATION_POLICY_VERSION,
  eventFromPlan,
  legacySeikoSourceSnapshotFingerprintForTesting,
  normalizeLegacySeikoSourceCandidateSnapshots,
  parseRematerializeDiscographyTaskOptions,
  prepareOfflineDiscographyRematerialization,
  type PersistedDiscographyTask,
} from "../scripts/rematerialize-discography-tasks";

const coverReleaseId = "11111111-1111-4111-8111-111111111111";
const coverImageUrl = `https://coverartarchive.org/release/${coverReleaseId}/front`;
const coverSourceUrl = `https://coverartarchive.org/release/${coverReleaseId}`;

function candidate(
  id: string,
  releaseDate: string,
  cover: boolean,
): ReleaseResearchCandidate {
  return {
    id,
    title: "Same canonical work",
    titleOriginal: "同じ作品",
    category: "SINGLE",
    artistCredit: "Fixture Artist",
    releaseDate,
    originalReleaseDate: "1986-01-01",
    format: "CD",
    catalogNumber: cover ? "CD-0002" : "CD-0001",
    barcode: cover ? "000000000002" : "000000000001",
    label: "Fixture Label",
    originalPrice: null,
    editionType: "ORIGINAL",
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    coverImageUrl: cover ? coverImageUrl : null,
    coverImageSourceUrl: cover ? coverSourceUrl : null,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: [{
      title: "MusicBrainz",
      url: `https://musicbrainz.org/release/${id}`,
      sourceType: "database",
    }],
  };
}

function result(
  id: string,
  releaseDate: string,
  resolution: "VERIFIED" | "PENDING_COVER",
): ComprehensiveCandidateResult {
  const hasCover = resolution === "VERIFIED";
  return {
    candidate: candidate(id, releaseDate, hasCover),
    workId: "work-1",
    editionId: `edition-${id}`,
    resolution,
    evidenceVerdict: "PASS",
    aiDecision: {
      candidateId: id,
      decision: "ACCEPT",
      reasonCode: "EVIDENCE_CONSISTENT",
      reason: "Persisted sources agree.",
      conflictIds: [],
    },
    cover: hasCover
      ? {
          status: "FOUND",
          imageUrl: coverImageUrl,
          sourceUrl: coverSourceUrl,
          provider: "cover-art-archive",
          checkedAt: "2026-07-12T05:00:00.000Z",
          contentSha256: "a".repeat(64),
          coverMatchLevel: "EDITION",
          sourceReleaseDate: releaseDate,
        }
      : {
          status: "MISSING",
          reasonCode: "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
          reason: "The persisted source was temporarily unavailable.",
          retryable: true,
        },
    ledger: [
      {
        stage: "SCOPE",
        verdict: "PASS",
        reasonCode: "REQUEST_SCOPE_MATCH",
        message: "The persisted candidate is inside the requested scope.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      },
      {
        stage: "AUTHORITATIVE",
        verdict: "PASS",
        reasonCode: "AUTHORITY_MATCH",
        message: "The persisted authority matches.",
        sourceUrls: ["https://example.invalid/authority"],
        retryable: false,
        conflictIds: [],
      },
      {
        stage: "MUSICBRAINZ",
        verdict: "PASS",
        reasonCode: "PHYSICAL_EDITION_MATCH",
        message: "The persisted physical edition matches.",
        sourceUrls: [`https://musicbrainz.org/release/${id}`],
        retryable: false,
        conflictIds: [],
      },
      {
        stage: "AI_AUDIT",
        verdict: "PASS",
        reasonCode: "EVIDENCE_CONSISTENT",
        message: "Persisted sources agree.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      },
      {
        stage: "COVER",
        verdict: hasCover ? "PASS" : "UNKNOWN",
        reasonCode: hasCover ? "EXACT_COVER_FOUND" : "COVER_SOURCE_TEMPORARILY_UNAVAILABLE",
        message: hasCover
          ? "The persisted cover was validated."
          : "The persisted source was temporarily unavailable.",
        sourceUrls: hasCover ? [coverSourceUrl] : [],
        retryable: !hasCover,
        conflictIds: [],
      },
    ],
  };
}

function candidatePayload(value: ComprehensiveCandidateResult): Prisma.JsonValue {
  const sourceCandidate: ComprehensiveDiscographyCandidate = {
    candidate: value.candidate,
    workId: value.workId,
    editionId: value.editionId,
    observations: [],
    conflicts: [],
  };
  return {
    schemaVersion: 2,
    externalWorkId: value.workId,
    externalEditionId: value.editionId,
    candidate: value.candidate,
    sourceCandidate,
    evidenceVerdict: value.evidenceVerdict,
    aiDecision: value.aiDecision,
    cover: value.cover,
    resolution: value.resolution,
    ledger: value.ledger,
  } as unknown as Prisma.JsonValue;
}

function task(): PersistedDiscographyTask {
  const pending = result("candidate-pending", "1986-02-01", "PENDING_COVER");
  const verified = result("candidate-verified", "1986-03-01", "VERIFIED");
  return {
    id: "task-0001",
    request: {
      artistName: "Fixture Artist",
      country: "Japan",
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
      includeLiveRemixBest: false,
    },
    pipelineVersion: "multi-source-v2",
    resultSchemaVersion: 2,
    status: "SUCCEEDED",
    rawResult: {
      evidence: {
        query: {
          artistName: "Fixture Artist",
          targetCountry: "Japan",
          target: "ORIGINAL_CD",
        },
        artist: null,
        releases: [],
        sourceWhitelist: ["musicbrainz.org"],
        warnings: [],
        stats: {
          artistResultsInspected: 1,
          releasesFetched: 2,
          releasesAcceptedBeforeGrouping: 2,
          releasesAccepted: 2,
          coverLookups: 2,
        },
      },
      comprehensiveSummary: { stale: true },
    },
    parsedResult: {
      artist: {
        name: "Fixture Artist",
        nameKana: null,
        nameRomaji: null,
        country: "Japan",
        officialSiteUrl: null,
      },
      collectionScope: {
        target: "ORIGINAL_CD",
        excludeReissues: true,
        includeCollaborations: true,
      },
      releases: [],
      pipelineVersion: "multi-source-v2",
      verificationCandidates: [
        {
          candidateId: pending.candidate.id,
          workId: pending.workId,
          editionId: pending.editionId,
          title: pending.candidate.title,
          category: pending.candidate.category,
          releaseDate: pending.candidate.releaseDate,
          catalogNumber: pending.candidate.catalogNumber,
          resolution: pending.resolution,
          evidenceVerdict: pending.evidenceVerdict,
          ledger: pending.ledger,
        },
        {
          candidateId: verified.candidate.id,
          workId: verified.workId,
          editionId: verified.editionId,
          title: verified.candidate.title,
          category: verified.candidate.category,
          releaseDate: verified.candidate.releaseDate,
          catalogNumber: verified.candidate.catalogNumber,
          resolution: "OUT_OF_SCOPE",
          evidenceVerdict: "OUT_OF_SCOPE",
          ledger: [...verified.ledger, {
            stage: "SELECTION",
            verdict: "OUT_OF_SCOPE",
            reasonCode: "LATER_EDITION_NOT_SELECTED",
            message: "The edition remains in the audit ledger but the requested scope keeps one verified edition per work.",
            sourceUrls: [],
            retryable: false,
            conflictIds: [],
          }],
        },
      ],
      globalWarnings: [],
      verificationSummary: null,
    },
    completedAt: new Date("2026-07-12T06:00:00.000Z"),
    updatedAt: new Date("2026-07-12T06:01:00.000Z"),
    importedAt: null,
    candidates: [pending, verified].map((value) => ({
      candidateKey: value.candidate.id,
      payload: candidatePayload(value),
      coverStatus: value.resolution === "VERIFIED" ? "VALID" : "RETRY_WAIT",
      releaseId: null,
    })),
  };
}

function verifiedRow(persisted: PersistedDiscographyTask) {
  return persisted.candidates.find((candidateRow) =>
    candidateRow.candidateKey === "candidate-verified")!;
}

function mutateVerifiedPayload(
  persisted: PersistedDiscographyTask,
  mutate: (
    payload: Record<string, unknown>,
    candidate: Record<string, unknown>,
    sourceCandidate: Record<string, unknown>,
    sourceRelease: Record<string, unknown>,
  ) => void,
) {
  const row = verifiedRow(persisted);
  const payload = structuredClone(row.payload) as Record<string, unknown>;
  const candidateValue = payload.candidate as Record<string, unknown>;
  const sourceCandidate = payload.sourceCandidate as Record<string, unknown>;
  const sourceRelease = sourceCandidate.candidate as Record<string, unknown>;
  mutate(payload, candidateValue, sourceCandidate, sourceRelease);
  row.payload = payload as Prisma.JsonValue;
  return payload;
}

function persistedAfterPlan(
  persisted: PersistedDiscographyTask,
  plan: ReturnType<typeof prepareOfflineDiscographyRematerialization>,
): PersistedDiscographyTask {
  const resultById = new Map(plan.results.map((value) => [value.candidate.id, value]));
  const sourceById = new Map(plan.sourceCandidates.map((value) => [value.candidate.id, value]));
  return {
    ...persisted,
    parsedResult: plan.parsedResult as unknown as Prisma.JsonValue,
    rawResult: plan.rawResult as Prisma.JsonValue,
    candidates: persisted.candidates.map((row) => {
      const value = resultById.get(row.candidateKey)!;
      const sourceCandidate = sourceById.get(row.candidateKey)!;
      return {
        ...row,
        payload: {
          schemaVersion: 2,
          externalWorkId: value.workId,
          externalEditionId: value.editionId,
          candidate: value.candidate,
          sourceCandidate,
          evidenceVerdict: value.evidenceVerdict,
          aiDecision: value.aiDecision,
          cover: value.cover,
          resolution: value.resolution,
          ledger: value.ledger,
        } as unknown as Prisma.JsonValue,
        coverStatus: value.resolution === "VERIFIED"
          ? "VALID" as const
          : value.resolution === "PENDING_COVER"
            ? "RETRY_WAIT" as const
            : row.coverStatus,
      };
    }),
  };
}

const legacyMusicBrainzReleaseGroupId = "22aa22aa-22aa-42aa-82aa-22aa22aa22aa";
const legacyMusicBrainzReleaseId = "33333333-3333-4333-8333-333333333333";
const legacyMusicBrainzReleaseGroupUrl =
  `https://musicbrainz.org/release-group/${legacyMusicBrainzReleaseGroupId}`;
const legacyMusicBrainzReleaseUrl =
  `https://musicbrainz.org/release/${legacyMusicBrainzReleaseId}`;

function legacyMusicBrainzPublishedTask(
  workId = legacyMusicBrainzReleaseGroupId,
) {
  const initial = task();
  const row = verifiedRow(initial);
  const payload = structuredClone(row.payload) as Record<string, unknown>;
  const sources = [{
    title: "MusicBrainz release",
    url: legacyMusicBrainzReleaseUrl,
    sourceType: "database",
  }, {
    title: "MusicBrainz release group",
    url: legacyMusicBrainzReleaseGroupUrl,
    sourceType: "database",
  }];
  payload.externalWorkId = workId;
  const candidateValue = payload.candidate as Record<string, unknown>;
  candidateValue.sources = structuredClone(sources);
  const sourceCandidate = payload.sourceCandidate as Record<string, unknown>;
  sourceCandidate.workId = workId;
  (sourceCandidate.candidate as Record<string, unknown>).sources = structuredClone(sources);
  const ledger = payload.ledger as Array<Record<string, unknown>>;
  const musicBrainzLedger = ledger.find((entry) => entry.stage === "MUSICBRAINZ")!;
  musicBrainzLedger.sourceUrls = [legacyMusicBrainzReleaseUrl];
  row.payload = payload as Prisma.JsonValue;

  const audits = (initial.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const audit = audits.find((value) => value.candidateId === "candidate-verified")!;
  audit.workId = workId;
  const selection = (audit.ledger as Array<Record<string, unknown>>).at(-1)!;
  audit.ledger = [...structuredClone(ledger), structuredClone(selection)];

  const first = prepareOfflineDiscographyRematerialization(initial);
  const persisted = persistedAfterPlan(initial, first);
  const release = ((persisted.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!;
  const verification = release.verification as Record<string, unknown>;
  verification.corroboratingSourceUrls = [
    ...(verification.corroboratingSourceUrls as string[]),
    legacyMusicBrainzReleaseGroupUrl,
  ];
  verification.sourceUrls = [
    ...(verification.sourceUrls as string[]),
    legacyMusicBrainzReleaseGroupUrl,
  ];
  return persisted;
}

const seikoLegacySourceSnapshotCases = [
  {
    key: "SINGLE:22",
    candidateKey: "curated-seiko-matsuda-single-22",
    groupId: "19eace7b-472f-4623-8c5e-f668f20d17b2",
    releaseId: "7d23b526-affb-4a6f-8783-9f06e954c4ac",
    includeReleaseSource: false,
    legacyOfficialTitle: null,
  },
  {
    key: "SINGLE:29",
    candidateKey: "curated-seiko-matsuda-single-29",
    groupId: null,
    releaseId: "66666666-6666-4666-8666-666666666666",
    includeReleaseSource: true,
    legacyOfficialTitle: null,
  },
  {
    key: "SINGLE:71",
    candidateKey: "curated-seiko-matsuda-single-71",
    groupId: "a7115395-0a0e-4c6a-8f3e-7e3177af923c",
    releaseId: "d8cd86c9-dbeb-4c90-901e-ca6b263f3d23",
    includeReleaseSource: false,
    legacyOfficialTitle: "\u677e\u7530\u8056\u5b50 official entity",
  },
  {
    key: "ORIGINAL_ALBUM:29",
    candidateKey: "curated-seiko-matsuda-original_album-29",
    groupId: "ca0a9735-b047-4857-8086-6926a5b5c695",
    releaseId: "373608a5-0310-4e6b-854a-4a9e69f5ad89",
    includeReleaseSource: true,
    legacyOfficialTitle: null,
  },
  {
    key: "ORIGINAL_ALBUM:35",
    candidateKey: "curated-seiko-matsuda-original_album-35",
    groupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
    releaseId: "7468e7b1-27f3-4db7-a60c-787916e1a246",
    includeReleaseSource: false,
    legacyOfficialTitle: "\u677e\u7530\u8056\u5b50 official entity",
  },
] as const;

type SeikoLegacySourceSnapshotCase = typeof seikoLegacySourceSnapshotCases[number];

function seikoLegacySourceSnapshotTask(fixture: SeikoLegacySourceSnapshotCase) {
  const initial = task();
  const row = verifiedRow(initial);
  const payload = structuredClone(row.payload) as Record<string, unknown>;
  const candidateValue = payload.candidate as Record<string, unknown>;
  const sourceCandidate = payload.sourceCandidate as Record<string, unknown>;
  const sourceRelease = sourceCandidate.candidate as Record<string, unknown>;
  const workId = `curated-official-manifest:seiko-matsuda:${fixture.key}`;
  const editionId =
    `curated-official-manifest:seiko-matsuda:representation:${fixture.key}`;
  const officialUrl = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[fixture.key];
  const pageId = officialUrl.split("/").at(-1)!;
  const officialImageUrl =
    `https://www.seikomatsuda.co.jp/discography/images/upload/${pageId}.gif`;
  const releaseUrl = `https://musicbrainz.org/release/${fixture.releaseId}`;
  const sources: Array<Record<string, unknown>> = [{
    title: "Seiko Matsuda official work entity",
    url: officialUrl,
    sourceType: "official",
  }];
  if (fixture.includeReleaseSource) {
    sources.unshift({
      title: "MusicBrainz release",
      url: releaseUrl,
      sourceType: "database",
    });
  }
  if (fixture.groupId) {
    sources.push({
      title: "MusicBrainz release group",
      url: `https://musicbrainz.org/release-group/${fixture.groupId}`,
      sourceType: "database",
    });
  }

  candidateValue.id = fixture.candidateKey;
  candidateValue.sources = structuredClone(sources);
  candidateValue.coverImageUrl = officialImageUrl;
  candidateValue.coverImageSourceUrl = officialUrl;
  sourceRelease.id = fixture.candidateKey;
  sourceRelease.sources = structuredClone(sources);
  sourceRelease.coverImageUrl = officialImageUrl;
  sourceRelease.coverImageSourceUrl = officialUrl;
  payload.externalWorkId = workId;
  payload.externalEditionId = editionId;
  sourceCandidate.workId = workId;
  sourceCandidate.editionId = editionId;
  (payload.aiDecision as Record<string, unknown>).candidateId = fixture.candidateKey;
  payload.cover = {
    status: "FOUND",
    imageUrl: officialImageUrl,
    sourceUrl: officialUrl,
    provider: "official-label",
    checkedAt: "2026-07-12T05:00:00.000Z",
    contentSha256: "b".repeat(64),
    coverMatchLevel: "WORK",
    sourceReleaseDate: candidateValue.releaseDate,
  };
  const oldLedger = payload.ledger as Array<Record<string, unknown>>;
  const scope = oldLedger.find((entry) => entry.stage === "SCOPE")!;
  const ai = oldLedger.find((entry) => entry.stage === "AI_AUDIT")!;
  payload.ledger = [{
    stage: "DISCOVERY",
    verdict: "PASS",
    reasonCode: "CANDIDATE_DISCOVERED",
    message: "The fixed physical edition was discovered.",
    sourceUrls: sources.map((source) => source.url),
    retryable: false,
    conflictIds: [],
  }, scope, {
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
    message: "The exact fixed Seiko official entity was verified.",
    sourceUrls: [officialUrl],
    retryable: false,
    conflictIds: [],
  }, {
    stage: "MUSICBRAINZ",
    verdict: "PASS",
    reasonCode: fixture.groupId
      ? "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"
      : "PHYSICAL_EDITION_MATCH",
    message: "The exact MusicBrainz edition was verified.",
    sourceUrls: [releaseUrl],
    retryable: false,
    conflictIds: [],
  }, ai, {
    stage: "COVER",
    verdict: "PASS",
    reasonCode: "VALIDATED_WORK_COVER_FOUND",
    message: "The exact official work cover was verified.",
    sourceUrls: [officialUrl],
    retryable: false,
    conflictIds: [],
  }];
  row.candidateKey = fixture.candidateKey;
  row.payload = payload as Prisma.JsonValue;

  const audits = (initial.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const audit = audits.find((value) => value.candidateId === "candidate-verified")!;
  const selection = (audit.ledger as Array<Record<string, unknown>>).at(-1)!;
  audit.candidateId = fixture.candidateKey;
  audit.workId = workId;
  audit.editionId = editionId;
  audit.title = candidateValue.title;
  audit.category = candidateValue.category;
  audit.releaseDate = candidateValue.releaseDate;
  audit.originalReleaseDate = candidateValue.originalReleaseDate;
  audit.catalogNumber = candidateValue.catalogNumber;
  audit.ledger = [
    ...structuredClone(payload.ledger as Array<Record<string, unknown>>),
    structuredClone(selection),
  ];

  if (fixture.groupId) {
    const rawResult = initial.rawResult as Record<string, unknown>;
    const evidence = rawResult.evidence as Record<string, unknown>;
    evidence.works = [{
      workId: fixture.groupId,
      releaseGroup: {
        entityType: "release-group",
        sourceId: fixture.groupId,
        releaseGroupId: fixture.groupId,
        sourceUrl: `https://musicbrainz.org/release-group/${fixture.groupId}`,
      },
      editions: [{
        workId: fixture.groupId,
        evidence: {
          entityType: "release",
          sourceId: fixture.releaseId,
          releaseGroupId: fixture.groupId,
          sourceUrl: releaseUrl,
        },
      }],
    }];
  }

  const strictPlan = prepareOfflineDiscographyRematerialization(initial);
  const persisted = persistedAfterPlan(initial, strictPlan);
  assert.doesNotThrow(
    () => prepareOfflineDiscographyRematerialization(persisted),
    `strict Seiko fixture must be idempotent before legacy mutation: ${fixture.key}`,
  );
  const persistedRow = persisted.candidates.find((candidateRow) =>
    candidateRow.candidateKey === fixture.candidateKey)!;
  // JSON persistence does not preserve object aliases between candidate and
  // sourceCandidate. Reproduce that boundary before creating the legacy row.
  const persistedPayload = JSON.parse(JSON.stringify(persistedRow.payload)) as Record<string, unknown>;
  const persistedSourceCandidate = persistedPayload.sourceCandidate as Record<string, unknown>;
  const persistedSourceRelease = persistedSourceCandidate.candidate as Record<string, unknown>;
  const legacySources: Array<Record<string, unknown>> = fixture.includeReleaseSource
    ? [{
        title: "MusicBrainz release",
        url: releaseUrl,
        sourceType: "database",
      }]
    : [];
  if (fixture.legacyOfficialTitle) {
    legacySources.push({
      title: fixture.legacyOfficialTitle,
      url: officialUrl,
      sourceType: "official",
    });
  }
  persistedSourceRelease.sources = legacySources;
  persistedRow.payload = persistedPayload as Prisma.JsonValue;
  return persisted;
}

function seikoLegacySourceSnapshotTestFingerprints(
  persisted: PersistedDiscographyTask,
  fixture: SeikoLegacySourceSnapshotCase,
) {
  const row = persisted.candidates.find((candidateRow) =>
    candidateRow.candidateKey === fixture.candidateKey)!;
  const payload = row.payload as Prisma.JsonObject;
  const resultCandidate = payload.candidate as Prisma.JsonObject;
  const sourceCandidate = payload.sourceCandidate as Prisma.JsonObject;
  const sourceRelease = sourceCandidate.candidate as Prisma.JsonObject;
  return new Map([[
    fixture.candidateKey,
    legacySeikoSourceSnapshotFingerprintForTesting(
      sourceRelease.sources,
      resultCandidate.sources,
    ),
  ]]);
}

test("offline rematerialization requires one explicit bounded task allowlist", () => {
  assert.deepEqual(
    parseRematerializeDiscographyTaskOptions([
      "--task-ids=task-0001,task-0002,task-0001",
    ]),
    { taskIds: ["task-0001", "task-0002"] },
  );
  assert.throws(
    () => parseRematerializeDiscographyTaskOptions([]),
    /Exactly one --task-ids/,
  );
  assert.throws(
    () => parseRematerializeDiscographyTaskOptions([
      "--task-ids=task-0001",
      "--online",
    ]),
    /no other options/,
  );
  assert.throws(
    () => parseRematerializeDiscographyTaskOptions([
      `--task-ids=${Array.from({ length: 65 }, (_, index) =>
        `task-${String(index).padStart(4, "0")}`).join(",")}`,
    ]),
    /at most 64/,
  );
});

test("offline rematerialization applies current selection without changing evidence states", () => {
  const persisted = task();
  const payloadsBefore = JSON.stringify(persisted.candidates.map((candidateRow) => candidateRow.payload));
  const plan = prepareOfflineDiscographyRematerialization(persisted);

  assert.equal(plan.changed, true);
  assert.equal(plan.results[0]!.resolution, "PENDING_COVER");
  assert.equal(plan.results[1]!.resolution, "VERIFIED");
  assert.deepEqual(plan.parsedResult.releases.map((release) => release.id), ["candidate-verified"]);
  assert.equal(
    plan.parsedResult.verificationCandidates?.find((audit) =>
      audit.candidateId === "candidate-verified")?.resolution,
    "VERIFIED",
  );
  assert.equal(plan.output.summary.verified, 1);
  assert.equal(plan.output.summary.pendingCover, 1);
  assert.deepEqual(plan.rawResult.comprehensiveSummary, plan.output.summary);
  assert.deepEqual(plan.rawResult.offlineRematerialization, {
    policyVersion: OFFLINE_REMATERIALIZATION_POLICY_VERSION,
    source: "persisted-candidate-states",
    quarantinedCoverCandidateIds: [],
    quarantinedPhysicalIdentityCandidateIds: [],
    normalizedLegacySeikoSourceCandidateIds: [],
  });
  assert.equal(
    plan.parsedResult.releases[0]!.verification?.checkedAt,
    "2026-07-12T06:00:00.000Z",
  );
  assert.equal(
    JSON.stringify(persisted.candidates.map((candidateRow) => candidateRow.payload)),
    payloadsBefore,
  );

  const repeated = prepareOfflineDiscographyRematerialization({
    ...persisted,
    parsedResult: plan.parsedResult as unknown as Prisma.JsonValue,
    rawResult: plan.rawResult as Prisma.JsonValue,
  });
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.parsedResult, plan.parsedResult);
  assert.deepEqual(repeated.rawResult, plan.rawResult);
});

test("offline rematerialization normalizes only the five exact legacy Seiko source snapshots", () => {
  for (const fixture of seikoLegacySourceSnapshotCases) {
    const persisted = seikoLegacySourceSnapshotTask(fixture);
    const row = persisted.candidates.find((candidateRow) =>
      candidateRow.candidateKey === fixture.candidateKey)!;
    const payloadBefore = structuredClone(row.payload) as Record<string, unknown>;
    const resultBefore = payloadBefore.candidate as Record<string, unknown>;
    const sourceBefore = payloadBefore.sourceCandidate as Record<string, unknown>;
    const evidence = (persisted.rawResult as Record<string, unknown>)
      .evidence as Parameters<typeof normalizeLegacySeikoSourceCandidateSnapshots>[1];
    const testFingerprints = seikoLegacySourceSnapshotTestFingerprints(persisted, fixture);
    const normalizedIngress = normalizeLegacySeikoSourceCandidateSnapshots(
      persisted.candidates,
      evidence,
      testFingerprints,
    );
    assert.deepEqual(normalizedIngress.normalizedCandidateIds, [fixture.candidateKey]);
    const manual = structuredClone(persisted);
    manual.candidates = normalizedIngress.normalizedCandidates;
    assert.doesNotThrow(
      () => prepareOfflineDiscographyRematerialization(manual),
      `strict normalized Seiko fixture must remain valid: ${fixture.key}`,
    );
    let plan: ReturnType<typeof prepareOfflineDiscographyRematerialization>;
    try {
      plan = prepareOfflineDiscographyRematerialization(persisted, testFingerprints);
    } catch (error) {
      throw new Error(`Seiko fixture ${fixture.key} failed.`, { cause: error });
    }
    const normalizedSource = plan.sourceCandidates.find((candidateValue) =>
      candidateValue.candidate.id === fixture.candidateKey)!;

    assert.equal(plan.changed, true, fixture.key);
    assert.deepEqual(
      plan.normalizedLegacySeikoSourceCandidateIds,
      [fixture.candidateKey],
      fixture.key,
    );
    assert.deepEqual(
      normalizedSource.candidate.sources,
      resultBefore.sources,
      fixture.key,
    );
    assert.deepEqual(normalizedSource.observations, sourceBefore.observations, fixture.key);
    assert.deepEqual(normalizedSource.conflicts, sourceBefore.conflicts, fixture.key);
    assert.deepEqual(
      plan.results.find((candidateValue) =>
        candidateValue.candidate.id === fixture.candidateKey)!.candidate,
      resultBefore,
      fixture.key,
    );
    if (fixture.groupId && !fixture.includeReleaseSource) {
      const releaseUrl = `https://musicbrainz.org/release/${fixture.releaseId}`;
      assert.equal(
        (resultBefore.sources as Array<Record<string, unknown>>).some((source) =>
          source.url === releaseUrl),
        false,
        fixture.key,
      );
      assert.deepEqual(
        plan.parsedResult.releases.find((release) =>
          release.id === fixture.candidateKey)!.sources.find((source) =>
          source.url === releaseUrl),
        {
          title: "MusicBrainz",
          url: releaseUrl,
          sourceType: "database",
        },
        // The legacy binding is ledger + raw tuple; the strict published
        // assertion is the third gate and must materialize the exact source.
        fixture.key,
      );
    }
    assert.deepEqual(
      (plan.rawResult.offlineRematerialization as Record<string, unknown>)
        .normalizedLegacySeikoSourceCandidateIds,
      [fixture.candidateKey],
      fixture.key,
    );
    assert.deepEqual(
      eventFromPlan(plan).normalizedLegacySeikoSourceCandidateIds,
      [fixture.candidateKey],
      fixture.key,
    );
    assert.deepEqual(row.payload, payloadBefore as unknown as Prisma.JsonValue, fixture.key);

    const normalizedPersisted = persistedAfterPlan(persisted, plan);
    assert.doesNotThrow(() => parsePersistedCoverRetryState(
      normalizedPersisted.candidates.find((candidateRow) =>
        candidateRow.candidateKey === fixture.candidateKey)!.payload,
      fixture.candidateKey,
    ), fixture.key);
    const repeated = prepareOfflineDiscographyRematerialization(normalizedPersisted);
    assert.equal(repeated.changed, false, fixture.key);
    assert.deepEqual(
      repeated.normalizedLegacySeikoSourceCandidateIds,
      [fixture.candidateKey],
      fixture.key,
    );
    assert.deepEqual(repeated.parsedResult, plan.parsedResult, fixture.key);
    assert.deepEqual(repeated.rawResult, plan.rawResult, fixture.key);
  }
});

test("legacy Seiko source normalization fails closed on every approximate snapshot", () => {
  const fixture = seikoLegacySourceSnapshotCases[0];
  const parts = (persisted: PersistedDiscographyTask) => {
    const row = persisted.candidates.find((candidateRow) =>
      candidateRow.candidateKey === fixture.candidateKey)!;
    const payload = row.payload as Prisma.JsonObject;
    const candidateValue = payload.candidate as Prisma.JsonObject;
    const sourceCandidate = payload.sourceCandidate as Prisma.JsonObject;
    const sourceRelease = sourceCandidate.candidate as Prisma.JsonObject;
    const rawResult = persisted.rawResult as Prisma.JsonObject;
    const evidence = rawResult.evidence as Prisma.JsonObject;
    const works = evidence.works as Prisma.JsonArray;
    return {
      persisted,
      row,
      payload,
      candidateValue,
      sourceCandidate,
      sourceRelease,
      ledger: payload.ledger as Prisma.JsonArray,
      rawResult,
      evidence,
      works,
    };
  };
  const reject = (
    label: string,
    mutate: (value: ReturnType<typeof parts>) => void,
    pattern = /persisted|identity-bound|complete|invalid|divergent/,
  ) => {
    const persisted = seikoLegacySourceSnapshotTask(fixture);
    const testFingerprints = seikoLegacySourceSnapshotTestFingerprints(persisted, fixture);
    const value = parts(persisted);
    mutate(value);
    assert.throws(
      () => prepareOfflineDiscographyRematerialization(persisted, testFingerprints),
      pattern,
      label,
    );
  };

  reject("foreign result source", ({ candidateValue, ledger }) => {
    const foreign = {
      title: "Foreign source",
      url: "https://example.invalid/foreign",
      sourceType: "other",
    };
    (candidateValue.sources as Prisma.JsonArray).push(foreign);
    const discovery = ledger.find((entry) =>
      (entry as Prisma.JsonObject).stage === "DISCOVERY") as Prisma.JsonObject;
    (discovery.sourceUrls as Prisma.JsonArray).push(foreign.url);
  });
  reject("shared foreign source", ({ candidateValue, sourceRelease, ledger }) => {
    const foreign = {
      title: "Foreign source",
      url: "https://example.invalid/shared-foreign",
      sourceType: "other",
    };
    (candidateValue.sources as Prisma.JsonArray).push(foreign);
    (sourceRelease.sources as Prisma.JsonArray).push(structuredClone(foreign));
    const discovery = ledger.find((entry) =>
      (entry as Prisma.JsonObject).stage === "DISCOVERY") as Prisma.JsonObject;
    (discovery.sourceUrls as Prisma.JsonArray).push(foreign.url);
  });
  reject("wrong candidate key", ({ row }) => {
    row.candidateKey = `${fixture.candidateKey}-suffix`;
  });
  for (const field of ["workId", "editionId"] as const) {
    reject(`wrong ${field}`, ({ payload, sourceCandidate }) => {
      const payloadField = field === "workId" ? "externalWorkId" : "externalEditionId";
      const next = `${String(payload[payloadField])}:suffix`;
      payload[payloadField] = next;
      sourceCandidate[field] = next;
    });
  }
  reject("non-source identity change", ({ sourceRelease }) => {
    sourceRelease.label = "Different label";
  });
  reject("sourceCandidate URL absent from result", ({ sourceRelease }) => {
    (sourceRelease.sources as Prisma.JsonArray).push({
      title: "Foreign source",
      url: "https://example.invalid/source-only",
      sourceType: "other",
    });
  });
  reject("unexpected old official source", ({ sourceRelease }) => {
    (sourceRelease.sources as Prisma.JsonArray).push({
      title: "\u677e\u7530\u8056\u5b50 official entity",
      url: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[fixture.key],
      sourceType: "official",
    });
  });
  reject("legacy source already contains the group", ({ sourceRelease }) => {
    (sourceRelease.sources as Prisma.JsonArray).push({
      title: "MusicBrainz release group",
      url: `https://musicbrainz.org/release-group/${fixture.groupId}`,
      sourceType: "database",
    });
  });
  reject("wrong exact official metadata", ({ candidateValue }) => {
    const official = (candidateValue.sources as Prisma.JsonArray).find((source) =>
      (source as Prisma.JsonObject).url ===
        SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[fixture.key]) as Prisma.JsonObject;
    official.title = "Seiko official page";
  });
  reject("wrong exact group metadata", ({ candidateValue }) => {
    const group = (candidateValue.sources as Prisma.JsonArray).find((source) =>
      (source as Prisma.JsonObject).url ===
        `https://musicbrainz.org/release-group/${fixture.groupId}`) as Prisma.JsonObject;
    group.sourceType = "official";
  });

  reject("missing official authority", ({ ledger }) => {
    const index = ledger.findIndex((entry) =>
      (entry as Prisma.JsonObject).reasonCode ===
        "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED");
    ledger.splice(index, 1);
  });
  reject("duplicate official authority", ({ ledger }) => {
    const authority = ledger.find((entry) =>
      (entry as Prisma.JsonObject).reasonCode ===
        "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED")!;
    ledger.push(structuredClone(authority));
  });
  reject("missing exact discovery", ({ ledger }) => {
    const discovery = ledger.find((entry) =>
      (entry as Prisma.JsonObject).stage === "DISCOVERY") as Prisma.JsonObject;
    discovery.reasonCode = "DISCOVERED_BY_OTHER_RULE";
  });
  reject("missing exact cover pass", ({ ledger }) => {
    const cover = ledger.find((entry) =>
      (entry as Prisma.JsonObject).stage === "COVER") as Prisma.JsonObject;
    cover.reasonCode = "VALIDATED_EDITION_COVER_FOUND";
  });
  reject("wrong targeted MusicBrainz reason", ({ ledger }) => {
    const musicBrainz = ledger.find((entry) =>
      (entry as Prisma.JsonObject).stage === "MUSICBRAINZ") as Prisma.JsonObject;
    musicBrainz.reasonCode = "PHYSICAL_EDITION_MATCH";
  });

  reject("missing raw work", ({ evidence }) => {
    evidence.works = [];
  });
  reject("duplicate raw work", ({ works }) => {
    works.push(structuredClone(works[0]!));
  });
  reject("missing raw release", ({ works }) => {
    (works[0] as Prisma.JsonObject).editions = [];
  });
  reject("duplicate raw release", ({ works }) => {
    const editions = (works[0] as Prisma.JsonObject).editions as Prisma.JsonArray;
    editions.push(structuredClone(editions[0]!));
  });

  reject(
    "already imported",
    ({ persisted }) => {
      persisted.importedAt = new Date("2026-07-12T07:00:00.000Z");
    },
    /already imported task/,
  );
  reject(
    "already linked",
    ({ row }) => {
      row.releaseId = "release-in-library";
    },
    /already linked to a library release/,
  );
  reject(
    "previous audit drifted again",
    ({ rawResult }) => {
      (rawResult.offlineRematerialization as Prisma.JsonObject)
        .normalizedLegacySeikoSourceCandidateIds = [fixture.candidateKey];
    },
    /became divergent again/,
  );
});

test("legacy Seiko normalization accepts only the two fixed recovery-title snapshots", () => {
  for (const fixture of seikoLegacySourceSnapshotCases.filter((value) =>
    value.legacyOfficialTitle !== null)) {
    const wrong = seikoLegacySourceSnapshotTask(fixture);
    const testFingerprints = seikoLegacySourceSnapshotTestFingerprints(wrong, fixture);
    const row = wrong.candidates.find((candidateRow) =>
      candidateRow.candidateKey === fixture.candidateKey)!;
    const payload = row.payload as Prisma.JsonObject;
    const sourceRelease = (payload.sourceCandidate as Prisma.JsonObject)
      .candidate as Prisma.JsonObject;
    const official = (sourceRelease.sources as Prisma.JsonArray).find((source) =>
      (source as Prisma.JsonObject).url ===
        SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[fixture.key]) as Prisma.JsonObject;
    official.title = "A nearly matching old title";
    assert.throws(
      () => prepareOfflineDiscographyRematerialization(wrong, testFingerprints),
      /identity-bound/,
      fixture.key,
    );
  }
});

test("offline rematerialization normalizes only canonical legacy selection-out evidence", () => {
  const conclusions = [
    [
      "LATER_EDITION_NOT_SELECTED",
      "The requested original-CD scope keeps the earliest AI-accepted edition for this work; this later edition remains in the audit ledger.",
    ],
    [
      "DECLARED_ORIGINAL_CD_DATE_MISMATCH",
      "The official manifest declares an original physical-CD issue, so a later reissue cannot replace that unresolved original edition.",
    ],
  ] as const;
  for (const [reasonCode, message] of conclusions) {
    const persisted = task();
    const row = verifiedRow(persisted);
    const payload = structuredClone(row.payload) as Record<string, unknown>;
    const candidateValue = payload.candidate as Record<string, unknown>;
    const sourceRelease = (payload.sourceCandidate as Record<string, unknown>)
      .candidate as Record<string, unknown>;
    candidateValue.coverImageUrl = null;
    candidateValue.coverImageSourceUrl = null;
    sourceRelease.coverImageUrl = null;
    sourceRelease.coverImageSourceUrl = null;
    payload.cover = null;
    payload.resolution = "OUT_OF_SCOPE";
    payload.evidenceVerdict = "PASS";
    payload.ledger = (payload.ledger as Array<Record<string, unknown>>)
      .filter((entry) => entry.stage !== "COVER")
      .concat({
        stage: "SCOPE",
        verdict: "OUT_OF_SCOPE",
        reasonCode,
        message,
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      });
    row.payload = payload as Prisma.JsonValue;
    row.coverStatus = "INVALID";

    const audits = (persisted.parsedResult as Record<string, unknown>)
      .verificationCandidates as Array<Record<string, unknown>>;
    const audit = audits.find((value) => value.candidateId === "candidate-verified")!;
    audit.resolution = "OUT_OF_SCOPE";
    audit.evidenceVerdict = "PASS";
    audit.ledger = structuredClone(payload.ledger);

    const plan = prepareOfflineDiscographyRematerialization(persisted);
    const normalized = plan.results.find((resultValue) =>
      resultValue.candidate.id === "candidate-verified")!;
    assert.equal(plan.changed, true, reasonCode);
    assert.equal(normalized.resolution, "OUT_OF_SCOPE", reasonCode);
    assert.equal(normalized.evidenceVerdict, "OUT_OF_SCOPE", reasonCode);
    assert.equal(normalized.aiDecision?.decision, "ACCEPT", reasonCode);
    assert.equal(normalized.cover, null, reasonCode);
    assert.equal(normalized.ledger.length, (payload.ledger as unknown[]).length, reasonCode);
    assert.equal(
      plan.parsedResult.verificationCandidates?.find((value) =>
        value.candidateId === "candidate-verified")?.evidenceVerdict,
      "OUT_OF_SCOPE",
      reasonCode,
    );

    const repeated = prepareOfflineDiscographyRematerialization(
      persistedAfterPlan(persisted, plan),
    );
    assert.equal(repeated.changed, false, reasonCode);
  }

  const malformed = task();
  const malformedPayload = verifiedRow(malformed).payload as Prisma.JsonObject;
  malformedPayload.resolution = "OUT_OF_SCOPE";
  malformedPayload.evidenceVerdict = "PASS";
  malformedPayload.cover = null;
  const malformedCandidate = malformedPayload.candidate as Prisma.JsonObject;
  malformedCandidate.coverImageUrl = null;
  malformedCandidate.coverImageSourceUrl = null;
  const malformedSourceRelease = (malformedPayload.sourceCandidate as Prisma.JsonObject)
    .candidate as Prisma.JsonObject;
  malformedSourceRelease.coverImageUrl = null;
  malformedSourceRelease.coverImageSourceUrl = null;
  malformedPayload.ledger = (malformedPayload.ledger as Prisma.JsonArray)
    .filter((entry) => (entry as Prisma.JsonObject).stage !== "COVER")
    .concat({
      stage: "SCOPE",
      verdict: "OUT_OF_SCOPE",
      reasonCode: "LATER_EDITION_NOT_SELECTED",
      message: "Non-canonical selection conclusion.",
      sourceUrls: [],
      retryable: false,
      conflictIds: [],
    });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(malformed),
    /resolution contradicts/,
  );
});

test("offline rematerialization quarantines a legacy VERIFIED edition-cover date mismatch", () => {
  const persisted = task();
  const oldPayload = mutateVerifiedPayload(
    persisted,
    (payload) => {
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
    },
  );
  const oldLedger = structuredClone(oldPayload.ledger) as unknown[];
  const plan = prepareOfflineDiscographyRematerialization(persisted);
  const quarantined = plan.results.find((value) =>
    value.candidate.id === "candidate-verified")!;
  const source = plan.sourceCandidates.find((value) =>
    value.candidate.id === "candidate-verified")!;

  assert.equal(plan.changed, true);
  assert.equal(quarantined.resolution, "PENDING_COVER");
  assert.equal(quarantined.evidenceVerdict, "PASS");
  assert.equal(quarantined.aiDecision?.decision, "ACCEPT");
  assert.equal(quarantined.candidate.coverImageUrl, null);
  assert.equal(quarantined.candidate.coverImageSourceUrl, null);
  assert.equal(source.candidate.coverImageUrl, null);
  assert.equal(source.candidate.coverImageSourceUrl, null);
  assert.equal(quarantined.cover?.status, "MISSING");
  assert.equal(quarantined.cover?.status === "MISSING" && quarantined.cover.retryable, true);
  assert.deepEqual(quarantined.ledger.slice(0, oldLedger.length), oldLedger);
  assert.equal(
    quarantined.ledger.filter((entry) =>
      entry.reasonCode === LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON).length,
    1,
  );
  assert.equal(quarantined.ledger.at(-1)?.stage, "COVER");
  assert.equal(quarantined.ledger.at(-1)?.verdict, "UNKNOWN");
  assert.deepEqual(plan.quarantinedCoverCandidateIds, ["candidate-verified"]);
  assert.deepEqual(plan.parsedResult.releases, []);
  assert.doesNotThrow(() => parsePersistedCoverRetryState(
    persistedAfterPlan(persisted, plan).candidates.find((row) =>
      row.candidateKey === "candidate-verified")!.payload,
    "candidate-verified",
  ));

  const repeated = prepareOfflineDiscographyRematerialization(
    persistedAfterPlan(persisted, plan),
  );
  assert.equal(repeated.changed, false);

  const prefixed = legacyMusicBrainzPublishedTask(
    `musicbrainz-release-group:${legacyMusicBrainzReleaseGroupId}`,
  );
  const prefixedPlan = prepareOfflineDiscographyRematerialization(prefixed);
  assert.equal(prefixedPlan.changed, true);
  assert.equal(
    prefixedPlan.parsedResult.releases[0]!.verification!.sourceUrls
      .includes(legacyMusicBrainzReleaseGroupUrl),
    false,
  );
  assert.equal(
    repeated.results.find((value) => value.candidate.id === "candidate-verified")!.ledger
      .filter((entry) => entry.reasonCode === LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON).length,
    1,
  );
  assert.deepEqual(repeated.parsedResult, plan.parsedResult);
  assert.deepEqual(repeated.rawResult, plan.rawResult);
});

for (const defect of ["NULL_FORMAT", "YEAR_DATE"] as const) {
  test(`offline rematerialization preserves but defers a VERIFIED ${defect} physical identity`, () => {
    const persisted = task();
    mutateVerifiedPayload(
      persisted,
      (_payload, candidateValue, _sourceCandidate, sourceRelease) => {
        if (defect === "NULL_FORMAT") {
          candidateValue.format = null;
          sourceRelease.format = null;
        } else {
          candidateValue.releaseDate = "1986";
          sourceRelease.releaseDate = "1986";
          const audit = (persisted.parsedResult as Record<string, unknown>)
            .verificationCandidates as Array<Record<string, unknown>>;
          audit.find((value) => value.candidateId === "candidate-verified")!.releaseDate = "1986";
        }
      },
    );
    const plan = prepareOfflineDiscographyRematerialization(persisted);
    const deferred = plan.results.find((value) =>
      value.candidate.id === "candidate-verified")!;
    const source = plan.sourceCandidates.find((value) =>
      value.candidate.id === "candidate-verified")!;

    assert.equal(deferred.resolution, "PENDING_EVIDENCE");
    assert.equal(deferred.evidenceVerdict, "UNKNOWN");
    assert.equal(deferred.aiDecision, null);
    assert.equal(deferred.cover?.status, "FOUND");
    assert.equal(deferred.candidate.coverImageUrl, coverImageUrl);
    assert.equal(source.candidate.coverImageUrl, coverImageUrl);
    assert.equal(
      deferred.ledger.filter((entry) =>
        entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON).length,
      1,
    );
    assert.equal(deferred.ledger.at(-1)?.stage, "SCOPE");
    assert.equal(deferred.ledger.at(-1)?.verdict, "UNKNOWN");
    assert.equal(
      defect === "NULL_FORMAT" ? deferred.candidate.format : deferred.candidate.releaseDate,
      defect === "NULL_FORMAT" ? null : "1986",
    );
    assert.deepEqual(plan.quarantinedPhysicalIdentityCandidateIds, ["candidate-verified"]);
    assert.equal(plan.output.summary.evidenceReadyForAi, 1);
    assert.equal(plan.output.summary.aiAccepted, 1);

    const repeated = prepareOfflineDiscographyRematerialization(
      persistedAfterPlan(persisted, plan),
    );
    assert.equal(repeated.changed, false);
    assert.equal(
      repeated.results.find((value) => value.candidate.id === "candidate-verified")!.ledger
        .filter((entry) =>
          entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON).length,
      1,
    );
  });
}

test("offline rematerialization fails closed on incomplete or mismatched persisted state", () => {
  const legacy = task();
  const legacyPayload: Record<string, Prisma.JsonValue> = {
    ...(legacy.candidates[0]!.payload as Prisma.JsonObject),
    schemaVersion: 1,
  };
  delete legacyPayload.sourceCandidate;
  legacy.candidates[0]!.payload = legacyPayload;
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(legacy),
    /complete cover-retry schema v2 row/,
  );

  const mismatched = task();
  (mismatched.parsedResult as Record<string, unknown>).verificationCandidates = [];
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(mismatched),
    /does not account for every candidate/,
  );

  const running = task();
  running.status = "RUNNING";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(running),
    /Only succeeded multi-source-v2 schema-v2/,
  );

  const missingEvidence = task();
  missingEvidence.rawResult = { comprehensiveSummary: {} };
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingEvidence),
    /no complete persisted public evidence bundle/,
  );

  const alteredSelection = task();
  const alteredSelectionAudits = (alteredSelection.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const alteredSelectionLedger = alteredSelectionAudits.find((audit) =>
    audit.candidateId === "candidate-verified")!.ledger as Array<Record<string, unknown>>;
  alteredSelectionLedger.at(-1)!.message = "A non-canonical legacy selection message.";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(alteredSelection),
    /audit is not identity-bound/,
  );

  const duplicatedSelection = task();
  const duplicatedSelectionAudits = (duplicatedSelection.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const duplicatedSelectionLedger = duplicatedSelectionAudits.find((audit) =>
    audit.candidateId === "candidate-verified")!.ledger as Array<Record<string, unknown>>;
  duplicatedSelectionLedger.push(structuredClone(duplicatedSelectionLedger.at(-1)!));
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(duplicatedSelection),
    /audit is not identity-bound/,
  );
});

test("offline rematerialization refuses every incomplete VERIFIED publication binding", () => {
  const mutateVerifiedPayload = (
    mutate: (payload: Record<string, unknown>) => void,
  ) => {
    const persisted = task();
    const row = persisted.candidates.find((candidateRow) =>
      candidateRow.candidateKey === "candidate-verified")!;
    const payload = structuredClone(row.payload) as Record<string, unknown>;
    mutate(payload);
    row.payload = payload as Prisma.JsonValue;
    return persisted;
  };

  const missingAsset = mutateVerifiedPayload((payload) => {
    (payload.candidate as Record<string, unknown>).coverImageUrl = null;
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingAsset),
    /provider-bound cover attestation/,
  );

  const mismatchedSource = mutateVerifiedPayload((payload) => {
    (payload.candidate as Record<string, unknown>).coverImageSourceUrl =
      "https://coverartarchive.org/release/22222222-2222-4222-8222-222222222222";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(mismatchedSource),
    /provider-bound cover attestation/,
  );

  const missingMatchLevel = mutateVerifiedPayload((payload) => {
    delete (payload.cover as Record<string, unknown>).coverMatchLevel;
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingMatchLevel),
    /provider-bound cover attestation/,
  );

  const unsupportedProvider = mutateVerifiedPayload((payload) => {
    (payload.cover as Record<string, unknown>).provider = "unverified-cdn";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(unsupportedProvider),
    /provider-bound cover attestation/,
  );

  const invalidCoverTimestamp = mutateVerifiedPayload((payload) => {
    (payload.cover as Record<string, unknown>).checkedAt = "2026-07-12T05:00:00Z";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(invalidCoverTimestamp),
    /provider-bound cover attestation/,
  );

  const invalidCoverHash = mutateVerifiedPayload((payload) => {
    (payload.cover as Record<string, unknown>).contentSha256 = "not-a-sha256";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(invalidCoverHash),
    /provider-bound cover attestation/,
  );

  const futureCoverTimestamp = mutateVerifiedPayload((payload) => {
    (payload.cover as Record<string, unknown>).checkedAt = "2027-07-12T05:00:00.000Z";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(futureCoverTimestamp),
    /future cover\.checkedAt timestamp/,
  );

  const invalidSourceTitle = mutateVerifiedPayload((payload) => {
    const candidateSource = ((payload.candidate as Record<string, unknown>)
      .sources as Array<Record<string, unknown>>)[0]!;
    const sourceRelease = (payload.sourceCandidate as Record<string, unknown>)
      .candidate as Record<string, unknown>;
    const sourceCandidateSource = (sourceRelease.sources as Array<Record<string, unknown>>)[0]!;
    candidateSource.title = "";
    sourceCandidateSource.title = "";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(invalidSourceTitle),
    /structurally incomplete/,
  );

  const invalidSourceType = mutateVerifiedPayload((payload) => {
    const candidateSource = ((payload.candidate as Record<string, unknown>)
      .sources as Array<Record<string, unknown>>)[0]!;
    const sourceRelease = (payload.sourceCandidate as Record<string, unknown>)
      .candidate as Record<string, unknown>;
    const sourceCandidateSource = (sourceRelease.sources as Array<Record<string, unknown>>)[0]!;
    candidateSource.sourceType = "untrusted";
    sourceCandidateSource.sourceType = "untrusted";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(invalidSourceType),
    /structurally incomplete/,
  );

  const missingCoverPass = mutateVerifiedPayload((payload) => {
    payload.ledger = (payload.ledger as Array<Record<string, unknown>>)
      .filter((entry) => entry.stage !== "COVER");
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingCoverPass),
    /exactly bound to a PASS ledger/,
  );

  const incompleteWorkBinding = mutateVerifiedPayload((payload) => {
    payload.externalWorkId = "";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(incompleteWorkBinding),
    /incomplete or invalid/,
  );

  const mismatchedSourceIdentity = mutateVerifiedPayload((payload) => {
    (payload.sourceCandidate as Record<string, unknown>).editionId = "other-edition";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(mismatchedSourceIdentity),
    /complete cover-retry schema v2 row/,
  );
});

test("offline quarantine never masks a second defect or an old audit identity conflict", () => {
  const unsupportedFormat = task();
  mutateVerifiedPayload(
    unsupportedFormat,
    (_payload, candidateValue, _sourceCandidate, sourceRelease) => {
      candidateValue.format = "";
      sourceRelease.format = "";
    },
  );
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(unsupportedFormat),
    /incomplete physical-CD identity/,
  );

  const twoDefects = task();
  mutateVerifiedPayload(
    twoDefects,
    (payload, candidateValue, _sourceCandidate, sourceRelease) => {
      candidateValue.format = null;
      sourceRelease.format = null;
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
    },
  );
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(twoDefects),
    /cover date inconsistent with its incomplete candidate identity/,
  );

  const conflictingQuarantineLedger = task();
  const conflictingMarker = {
    stage: "AUTHORITATIVE",
    verdict: "UNKNOWN",
    reasonCode: LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
    message: "Conflicting legacy marker.",
    sourceUrls: [],
    retryable: false,
    conflictIds: [],
  };
  mutateVerifiedPayload(
    conflictingQuarantineLedger,
    (payload) => {
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
      (payload.ledger as Array<Record<string, unknown>>)
        .splice(-1, 0, conflictingMarker);
    },
  );
  const conflictingMarkerAudits = (conflictingQuarantineLedger.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const conflictingMarkerAudit = conflictingMarkerAudits.find((value) =>
    value.candidateId === "candidate-verified")!;
  (conflictingMarkerAudit.ledger as Array<Record<string, unknown>>)
    .splice(-2, 0, structuredClone(conflictingMarker));
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(conflictingQuarantineLedger),
    /already contains a quarantine ledger marker/,
  );

  const conflictingAudit = task();
  mutateVerifiedPayload(
    conflictingAudit,
    (payload) => {
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
    },
  );
  const audits = (conflictingAudit.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  audits.find((value) => value.candidateId === "candidate-verified")!
    .originalReleaseDate = "1985-12-31";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(conflictingAudit),
    /audit is not identity-bound/,
  );

  const conflictingPublishedRelease = task();
  const payload = verifiedRow(conflictingPublishedRelease).payload as Prisma.JsonObject;
  const persistedCandidate = structuredClone(payload.candidate) as Record<string, unknown>;
  (conflictingPublishedRelease.parsedResult as Record<string, unknown>).releases = [{
    ...persistedCandidate,
    title: "Wrong published title",
    workId: payload.externalWorkId,
    editionId: payload.externalEditionId,
  }];
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(conflictingPublishedRelease),
    /published release set/,
  );
});

test("offline rematerialization requires an exact, fully attested published release set", () => {
  const initial = task();
  const first = prepareOfflineDiscographyRematerialization(initial);
  const persisted = persistedAfterPlan(initial, first);
  const releases = (persisted.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>;
  assert.equal(releases.length, 1);
  const verification = releases[0]!.verification as Record<string, unknown>;
  verification.checkedAt = "2026-07-12T05:30:00.000Z";
  const preserved = prepareOfflineDiscographyRematerialization(persisted);
  assert.equal(
    preserved.parsedResult.releases[0]?.verification?.checkedAt,
    "2026-07-12T05:30:00.000Z",
  );

  const duplicate = structuredClone(persisted);
  const duplicateReleases = (duplicate.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>;
  duplicateReleases.push(structuredClone(duplicateReleases[0]!));
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(duplicate),
    /duplicate published release ids/,
  );

  const missing = structuredClone(persisted);
  (missing.parsedResult as Record<string, unknown>).releases = [];
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missing),
    /published release set/,
  );

  const alteredIdentity = structuredClone(persisted);
  const alteredRelease = ((alteredIdentity.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!;
  alteredRelease.titleOriginal = "wrong original title";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(alteredIdentity),
    /not completely bound/,
  );

  const alteredVerification = structuredClone(persisted);
  const alteredAttestation = (((alteredVerification.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!.verification as Record<string, unknown>);
  alteredAttestation.coverProvider = "discogs";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(alteredVerification),
    /not completely bound/,
  );

  const alteredSourceMetadata = structuredClone(persisted);
  const alteredSources = (((alteredSourceMetadata.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!.sources as Array<Record<string, unknown>>);
  alteredSources.forEach((source) => {
    source.title = "Tampered source title";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(alteredSourceMetadata),
    /not completely bound/,
  );

  const alteredSourceType = structuredClone(persisted);
  const alteredTypedSources = (((alteredSourceType.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!.sources as Array<Record<string, unknown>>);
  alteredTypedSources.forEach((source) => {
    source.sourceType = "news";
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(alteredSourceType),
    /not completely bound/,
  );

  const futureAttestation = structuredClone(persisted);
  const futureVerification = (((futureAttestation.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!.verification as Record<string, unknown>);
  futureVerification.checkedAt = "2027-07-12T05:30:00.000Z";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(futureAttestation),
    /future verification\.checkedAt timestamp/,
  );
});

test("offline rematerialization removes only one exactly bound legacy MusicBrainz release-group verification URL", () => {
  const persisted = legacyMusicBrainzPublishedTask();
  const plan = prepareOfflineDiscographyRematerialization(persisted);
  const normalizedVerification = plan.parsedResult.releases[0]!.verification!;
  assert.equal(plan.changed, true);
  assert.deepEqual(normalizedVerification.corroboratingSourceUrls, [
    legacyMusicBrainzReleaseUrl,
  ]);
  assert.equal(
    normalizedVerification.sourceUrls.includes(legacyMusicBrainzReleaseGroupUrl),
    false,
  );
  assert.equal(
    plan.parsedResult.releases[0]!.sources.some((source) =>
      source.url === legacyMusicBrainzReleaseGroupUrl),
    true,
  );
  const repeated = prepareOfflineDiscographyRematerialization(
    persistedAfterPlan(persisted, plan),
  );
  assert.equal(repeated.changed, false);

  const verificationOf = (value: PersistedDiscographyTask) =>
    (((value.parsedResult as Record<string, unknown>).releases as Array<Record<string, unknown>>)
      [0]!.verification as Record<string, unknown>);

  const missingExpected = legacyMusicBrainzPublishedTask();
  const missingExpectedVerification = verificationOf(missingExpected);
  missingExpectedVerification.corroboratingSourceUrls = [legacyMusicBrainzReleaseGroupUrl];
  missingExpectedVerification.sourceUrls =
    (missingExpectedVerification.sourceUrls as string[])
      .filter((url) => url !== legacyMusicBrainzReleaseUrl);
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingExpected),
    /not completely bound/,
  );

  const secondExtra = legacyMusicBrainzPublishedTask();
  const secondExtraVerification = verificationOf(secondExtra);
  const secondGroupUrl =
    "https://musicbrainz.org/release-group/44444444-4444-4444-8444-444444444444";
  (secondExtraVerification.corroboratingSourceUrls as string[]).push(secondGroupUrl);
  (secondExtraVerification.sourceUrls as string[]).push(secondGroupUrl);
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(secondExtra),
    /not completely bound/,
  );

  const duplicatedGroup = legacyMusicBrainzPublishedTask();
  const duplicatedGroupVerification = verificationOf(duplicatedGroup);
  (duplicatedGroupVerification.corroboratingSourceUrls as string[])
    .push(legacyMusicBrainzReleaseGroupUrl);
  (duplicatedGroupVerification.sourceUrls as string[])
    .push(legacyMusicBrainzReleaseGroupUrl);
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(duplicatedGroup),
    /not completely bound/,
  );

  for (const invalidGroupUrl of [
    `https://musicbrainz.org/artist/${legacyMusicBrainzReleaseGroupId}`,
    `https://example.com/release-group/${legacyMusicBrainzReleaseGroupId}`,
    legacyMusicBrainzReleaseGroupUrl.replace(
      legacyMusicBrainzReleaseGroupId,
      legacyMusicBrainzReleaseGroupId.toUpperCase(),
    ),
    `${legacyMusicBrainzReleaseGroupUrl}/`,
    `${legacyMusicBrainzReleaseGroupUrl}?inc=releases`,
    `${legacyMusicBrainzReleaseGroupUrl}#legacy`,
    legacyMusicBrainzReleaseGroupUrl.replace(
      "https://musicbrainz.org/",
      "https://musicbrainz.org:443/",
    ),
  ]) {
    const wrongLocation = legacyMusicBrainzPublishedTask();
    const wrongLocationVerification = verificationOf(wrongLocation);
    wrongLocationVerification.corroboratingSourceUrls =
      (wrongLocationVerification.corroboratingSourceUrls as string[])
        .map((url) => url === legacyMusicBrainzReleaseGroupUrl ? invalidGroupUrl : url);
    wrongLocationVerification.sourceUrls =
      (wrongLocationVerification.sourceUrls as string[])
        .map((url) => url === legacyMusicBrainzReleaseGroupUrl ? invalidGroupUrl : url);
    assert.throws(
      () => prepareOfflineDiscographyRematerialization(wrongLocation),
      /not completely bound/,
      invalidGroupUrl,
    );
  }

  const missingCandidateSource = legacyMusicBrainzPublishedTask();
  const missingSourcePayload = verifiedRow(missingCandidateSource).payload as Prisma.JsonObject;
  const withoutGroupSource = (missingSourcePayload.candidate as Prisma.JsonObject)
    .sources as Prisma.JsonArray;
  (missingSourcePayload.candidate as Prisma.JsonObject).sources = withoutGroupSource
    .filter((source) =>
      (source as Prisma.JsonObject).url !== legacyMusicBrainzReleaseGroupUrl);
  const missingSourceCandidate = missingSourcePayload.sourceCandidate as Prisma.JsonObject;
  (missingSourceCandidate.candidate as Prisma.JsonObject).sources = structuredClone(
    (missingSourcePayload.candidate as Prisma.JsonObject).sources,
  );
  const missingSourceRelease = ((missingCandidateSource.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!;
  missingSourceRelease.sources = (missingSourceRelease.sources as Array<Record<string, unknown>>)
    .filter((source) => source.url !== legacyMusicBrainzReleaseGroupUrl);
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingCandidateSource),
    /not completely bound/,
  );

  const workWithoutGroupId = legacyMusicBrainzPublishedTask();
  const workPayload = verifiedRow(workWithoutGroupId).payload as Prisma.JsonObject;
  const unrelatedWorkId =
    `musicbrainz-release-group:${legacyMusicBrainzReleaseGroupId}:suffix`;
  workPayload.externalWorkId = unrelatedWorkId;
  (workPayload.sourceCandidate as Prisma.JsonObject).workId = unrelatedWorkId;
  const workAudits = (workWithoutGroupId.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  workAudits.find((audit) => audit.candidateId === "candidate-verified")!.workId =
    unrelatedWorkId;
  const workRelease = ((workWithoutGroupId.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!;
  workRelease.workId = unrelatedWorkId;
  (workRelease.verification as Record<string, unknown>).workId = unrelatedWorkId;
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(workWithoutGroupId),
    /not completely bound/,
  );

  const releaseNotInCandidateSources = legacyMusicBrainzPublishedTask();
  const unrelatedReleaseUrl =
    "https://musicbrainz.org/release/55555555-5555-4555-8555-555555555555";
  const unrelatedReleasePayload = verifiedRow(releaseNotInCandidateSources)
    .payload as Prisma.JsonObject;
  const unrelatedReleaseLedger = unrelatedReleasePayload.ledger as Prisma.JsonArray;
  const unrelatedMusicBrainzEntry = unrelatedReleaseLedger.find((entry) =>
    (entry as Prisma.JsonObject).stage === "MUSICBRAINZ") as Prisma.JsonObject;
  unrelatedMusicBrainzEntry.sourceUrls = [unrelatedReleaseUrl];
  const unrelatedReleaseAudits = (releaseNotInCandidateSources.parsedResult as Record<string, unknown>)
    .verificationCandidates as Array<Record<string, unknown>>;
  const unrelatedAuditEntry = (unrelatedReleaseAudits.find((audit) =>
    audit.candidateId === "candidate-verified")!.ledger as Array<Record<string, unknown>>)
    .find((entry) => entry.stage === "MUSICBRAINZ")!;
  unrelatedAuditEntry.sourceUrls = [unrelatedReleaseUrl];
  const unrelatedPublishedRelease = ((releaseNotInCandidateSources.parsedResult as Record<string, unknown>)
    .releases as Array<Record<string, unknown>>)[0]!;
  const unrelatedVerification = unrelatedPublishedRelease.verification as Record<string, unknown>;
  unrelatedVerification.corroboratingSourceUrls =
    (unrelatedVerification.corroboratingSourceUrls as string[])
      .map((url) => url === legacyMusicBrainzReleaseUrl ? unrelatedReleaseUrl : url);
  unrelatedVerification.sourceUrls = (unrelatedVerification.sourceUrls as string[])
    .map((url) => url === legacyMusicBrainzReleaseUrl ? unrelatedReleaseUrl : url);
  (unrelatedPublishedRelease.sources as Array<Record<string, unknown>>).push({
    title: "MusicBrainz",
    url: unrelatedReleaseUrl,
    sourceType: "database",
  });
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(releaseNotInCandidateSources),
    /not completely bound/,
  );

  for (const mutation of [
    { url: legacyMusicBrainzReleaseGroupUrl, field: "title", value: "MusicBrainz group" },
    { url: legacyMusicBrainzReleaseGroupUrl, field: "sourceType", value: "official" },
    { url: legacyMusicBrainzReleaseUrl, field: "title", value: "MusicBrainz" },
    { url: legacyMusicBrainzReleaseUrl, field: "sourceType", value: "official" },
  ] as const) {
    const wrongSourceMetadata = legacyMusicBrainzPublishedTask();
    const metadataPayload = verifiedRow(wrongSourceMetadata).payload as Prisma.JsonObject;
    const metadataCandidate = metadataPayload.candidate as Prisma.JsonObject;
    const candidateSource = (metadataCandidate.sources as Prisma.JsonArray)
      .find((source) => (source as Prisma.JsonObject).url === mutation.url) as Prisma.JsonObject;
    candidateSource[mutation.field] = mutation.value;
    const metadataSourceCandidate = metadataPayload.sourceCandidate as Prisma.JsonObject;
    const sourceCandidateSource = ((metadataSourceCandidate.candidate as Prisma.JsonObject)
      .sources as Prisma.JsonArray)
      .find((source) => (source as Prisma.JsonObject).url === mutation.url) as Prisma.JsonObject;
    sourceCandidateSource[mutation.field] = mutation.value;
    const metadataRelease = ((wrongSourceMetadata.parsedResult as Record<string, unknown>)
      .releases as Array<Record<string, unknown>>)[0]!;
    const publishedSource = (metadataRelease.sources as Array<Record<string, unknown>>)
      .find((source) => source.url === mutation.url)!;
    publishedSource[mutation.field] = mutation.value;
    assert.throws(
      () => prepareOfflineDiscographyRematerialization(wrongSourceMetadata),
      /not completely bound/,
      `${mutation.url}:${mutation.field}`,
    );
  }

  const missingMusicBrainzPass = legacyMusicBrainzPublishedTask();
  const missingPassPayload = verifiedRow(missingMusicBrainzPass).payload as Prisma.JsonObject;
  const missingPassLedger = missingPassPayload.ledger as Prisma.JsonArray;
  const passEntry = missingPassLedger.find((entry) =>
    (entry as Prisma.JsonObject).stage === "MUSICBRAINZ") as Prisma.JsonObject;
  passEntry.stage = "CORROBORATION";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(missingMusicBrainzPass),
    /not completely bound/,
  );
});

test("offline quarantine refuses cover-worker races and already imported candidates", () => {
  const checking = task();
  checking.candidates[0]!.coverStatus = "CHECKING";
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(checking),
    /cover is CHECKING/,
  );

  const imported = task();
  imported.importedAt = new Date("2026-07-12T07:00:00.000Z");
  mutateVerifiedPayload(
    imported,
    (payload) => {
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
    },
  );
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(imported),
    /already imported task/,
  );

  const linked = task();
  verifiedRow(linked).releaseId = "release-in-library";
  mutateVerifiedPayload(
    linked,
    (payload) => {
      (payload.cover as Record<string, unknown>).sourceReleaseDate = "1985-12-31";
    },
  );
  assert.throws(
    () => prepareOfflineDiscographyRematerialization(linked),
    /already linked to a library release/,
  );
});
