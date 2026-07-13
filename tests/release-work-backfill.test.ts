import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildReleaseWorkBackfillPlan,
  deriveReleaseCoverBackfill,
  extractMusicBrainzReleaseGroupIds,
  planLegacyResearchTask,
  type LegacyReleaseForWorkBackfill,
} from "../scripts/backfill-release-works";

const groupA = "00000000-0000-4000-8000-000000000001";
const groupB = "00000000-0000-4000-8000-000000000002";

function release(
  id: string,
  overrides: Partial<LegacyReleaseForWorkBackfill> = {},
): LegacyReleaseForWorkBackfill {
  return {
    id,
    artistId: "artist-1",
    title: `Title ${id}`,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: "1985-01-01T00:00:00.000Z",
    editionReleaseDate: null,
    editionDatePrecision: null,
    workId: null,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    coverStatus: "MISSING",
    coverProvider: null,
    coverCheckedAt: null,
    verificationStatus: "UNVERIFIED",
    verificationEvidence: null,
    verifiedAt: null,
    sources: [],
    ...overrides,
  };
}

const releaseWithDuplicateGroupEvidence = release("grouped-1", {
  sources: [{
    url: `https://musicbrainz.org/release-group/${groupA}`,
    label: "MusicBrainz",
    description: "database",
  }],
  verificationEvidence: {
    sourceUrls: [
      `https://musicbrainz.org/release-group/${groupA}`,
      "https://musicbrainz.org/release/not-a-release-group",
    ],
  },
});
assert.deepEqual(extractMusicBrainzReleaseGroupIds(releaseWithDuplicateGroupEvidence), [groupA]);

const groupedPlan = buildReleaseWorkBackfillPlan([
  releaseWithDuplicateGroupEvidence,
  release("grouped-2", {
    originalReleaseDate: "1992-07-22T00:00:00.000Z",
    sources: [{
      url: `https://musicbrainz.org/release-group/${groupA}`,
      label: null,
      description: null,
    }],
  }),
]);
assert.equal(groupedPlan.groups.length, 1);
assert.equal(groupedPlan.groups[0]?.musicBrainzReleaseGroupId, groupA);
assert.deepEqual(groupedPlan.groups[0]?.releases.map((item) => item.id), ["grouped-1", "grouped-2"]);
assert.equal(groupedPlan.groups[0]?.representative.id, "grouped-1");
assert.equal(groupedPlan.conflicts.length, 0);

// Same-day titles are not evidence of duplication. Without a stable external
// work identity, the migration must create one work per legacy row.
const sameDayPlan = buildReleaseWorkBackfillPlan([
  release("same-day-a", { title: "作品 A" }),
  release("same-day-b", { title: "作品 B" }),
]);
assert.equal(sameDayPlan.groups.length, 2);
assert.ok(sameDayPlan.groups.every((group) => group.musicBrainzReleaseGroupId === null));

const conflictingPlan = buildReleaseWorkBackfillPlan([
  release("ambiguous", {
    sources: [
      { url: `https://musicbrainz.org/release-group/${groupA}`, label: null, description: null },
      { url: `https://musicbrainz.org/release-group/${groupB}`, label: null, description: null },
    ],
  }),
]);
assert.equal(conflictingPlan.groups.length, 1);
assert.equal(conflictingPlan.groups[0]?.musicBrainzReleaseGroupId, null);
assert.equal(conflictingPlan.conflicts[0]?.reason, "multiple-release-groups");

const crossArtistPlan = buildReleaseWorkBackfillPlan([
  release("artist-a", {
    artistId: "artist-a",
    sources: [{ url: `https://musicbrainz.org/release-group/${groupA}`, label: null, description: null }],
  }),
  release("artist-b", {
    artistId: "artist-b",
    sources: [{ url: `https://musicbrainz.org/release-group/${groupA}`, label: null, description: null }],
  }),
  release("already-linked", { workId: "work-existing" }),
]);
assert.equal(crossArtistPlan.groups.length, 2);
assert.ok(crossArtistPlan.groups.every((group) => group.musicBrainzReleaseGroupId === null));
assert.deepEqual(crossArtistPlan.alreadyLinkedReleaseIds, ["already-linked"]);
assert.equal(crossArtistPlan.conflicts.length, 2);

const checkedAt = "2026-07-12T04:00:00.000Z";
const verifiedCover = deriveReleaseCoverBackfill(release("verified-cover", {
  coverImageUrl: "https://coverartarchive.org/release/example/front-500",
  verificationStatus: "VERIFIED",
  verificationEvidence: { coverProvider: "cover-art-archive", coverCheckedAt: checkedAt },
  verifiedAt: checkedAt,
  sources: [{
    url: "https://coverartarchive.org/release/example",
    label: "Cover Art Archive",
    description: "cover-image-source",
  }],
}));
assert.equal(verifiedCover.coverStatus, "VALID");
assert.equal(verifiedCover.coverProvider, "cover-art-archive");
assert.equal(verifiedCover.coverCheckedAt?.toISOString(), checkedAt);
assert.equal(verifiedCover.coverImageSourceUrl, "https://coverartarchive.org/release/example");

assert.equal(deriveReleaseCoverBackfill(release("queued-cover", {
  coverImageUrl: "https://example.com/unverified.jpg",
})).coverStatus, "QUEUED");
assert.equal(deriveReleaseCoverBackfill(release("missing-cover")).coverStatus, "MISSING");
assert.equal(deriveReleaseCoverBackfill(release("retry-cover", {
  coverStatus: "RETRY_WAIT",
})).coverStatus, "RETRY_WAIT");

const legacyTask = planLegacyResearchTask({
  id: "task-1",
  status: "SUCCEEDED",
  query: JSON.stringify({ artistName: "中山美穂", target: "ORIGINAL_CD" }),
  createdAt: new Date("2026-07-12T00:00:00.000Z"),
  updatedAt: new Date("2026-07-12T01:00:00.000Z"),
  rawResult: {
    verificationSummary: { rawReleases: 10, aiAccepted: 1 },
    evidence: {
      stats: { releasesFetched: 10, releasesDeduplicated: 2 },
      warnings: [{ code: "outside-country-filtered", count: 3 }],
      releases: [
        {
          evidence: {
            sourceId: "release-1",
            releaseGroupId: groupA,
            title: "作品 A",
            date: "1985-01",
            catalogNumber: "K32X-1",
          },
        },
        {
          evidence: {
            sourceId: "release-2",
            releaseGroupId: groupB,
            title: "作品 B",
            date: "1986",
            catalogNumber: "K32X-2",
          },
        },
      ],
    },
  },
  parsedResult: {
    verificationSummary: { rawReleases: 10, aiAccepted: 1 },
    releases: [{
      id: `release-group-${groupA}`,
      title: "作品 A",
      category: "ORIGINAL_ALBUM",
      releaseDate: "1985-01",
      catalogNumber: "K32X-1",
      coverImageUrl: "https://coverartarchive.org/release/release-1/front-500",
      coverImageSourceUrl: "https://coverartarchive.org/release/release-1",
      verification: {
        status: "VERIFIED",
        aiDecision: "ACCEPT",
        coverProvider: "cover-art-archive",
        coverCheckedAt: checkedAt,
      },
    }],
  },
});
assert.deepEqual(legacyTask.request, { artistName: "中山美穂", target: "ORIGINAL_CD" });
assert.equal(legacyTask.candidates.length, 2);
assert.equal(legacyTask.candidates[0]?.disposition, "ACCEPTED");
assert.equal(legacyTask.candidates[0]?.entityKind, "WORK");
assert.equal(legacyTask.candidates[0]?.datePrecision, "MONTH");
assert.equal(legacyTask.candidates[0]?.coverStatus, "VALID");
assert.equal(legacyTask.candidates[1]?.disposition, "DEFERRED");
assert.equal(legacyTask.candidates[1]?.datePrecision, "YEAR");
assert.deepEqual(legacyTask.stageSummary, {
  inputCount: 10,
  passedCount: 1,
  deferredCount: 7,
  rejectedCount: 0,
  mergedCount: 2,
  retryCount: 0,
  reasonCounts: {
    "outside-country-filtered": 3,
    "verification.rawReleases": 10,
    "verification.aiAccepted": 1,
    LEGACY_DETAIL_NOT_RECORDED: true,
  },
  detailsComplete: false,
});

const unverifiedLegacyTask = planLegacyResearchTask({
  id: "task-2",
  status: "SUCCEEDED",
  query: "not-json",
  rawResult: { evidence: { stats: { releasesFetched: 1 }, releases: [] } },
  parsedResult: {
    releases: [{ id: "legacy-final", title: "Unverified result", releaseDate: "1990-01-01" }],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});
assert.equal(unverifiedLegacyTask.request, null);
assert.equal(unverifiedLegacyTask.candidates[0]?.disposition, "DEFERRED");
assert.equal(unverifiedLegacyTask.candidates[0]?.finalReasonCode, "LEGACY_DETAIL_NOT_RECORDED");

const schema = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(
  path.resolve("prisma/migrations/20260712160000_release_work_audit/migration.sql"),
  "utf8",
);
assert.match(schema, /model ReleaseWork \{/);
assert.match(schema, /model ResearchCandidate \{/);
assert.match(schema, /model ResearchDecision \{/);
assert.match(schema, /model ResearchStageSummary \{/);
assert.match(schema, /@@unique\(\[taskId, candidateKey\]\)/);
assert.match(schema, /@@index\(\[coverStatus, coverNextRetryAt\]\)/);
assert.match(migration, /"coverStatus" = 'VALID'/);
assert.match(migration, /"verificationStatus" <> 'VERIFIED'/);
assert.match(migration, /"ResearchCandidate_taskId_fkey"/);
assert.match(migration, /"ResearchDecision_candidateId_fkey"/);
assert.match(migration, /"ResearchStageSummary_taskId_fkey"/);
assert.match(migration, /"Release_coverAttemptCount_check"/);
assert.doesNotMatch(migration, /DROP COLUMN|DROP TABLE/);

console.log("Release work backfill tests passed.");
