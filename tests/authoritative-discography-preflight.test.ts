import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadBenchmarkManifest,
  selectFinalAcceptanceSuiteFixtures,
  type ArtistBenchmark,
} from "../scripts/benchmark-discographies";
import {
  buildAuthoritativePreflightRequest,
  candidateMatchesDeclaredPhysicalCdDate,
  canonicalExpectations,
  evaluatePreparedCanonicalWorks,
  parseAuthoritativePreflightCliArgs,
  readArtistPreflightCheckpoint,
  writeArtistPreflightCheckpoint,
  withPublicMetadataOrganizerDisabled,
  type ArtistAuthoritativePreflight,
} from "../scripts/preflight-authoritative-discographies";
import type {
  ComprehensiveCoverLookupResult,
  ComprehensiveDiscographyCandidate,
} from "../src/lib/ai/comprehensive-discography";

const fixture = {
  slug: "fixture-artist",
  artist: {
    canonicalName: "Fixture Artist",
    aliases: [],
    country: "JP",
    musicbrainzArtistId: "00000000-0000-4000-8000-000000000001",
  },
  catalogStatus: "fixed",
  scope: { territory: "JP", includedCategories: ["SINGLE"], note: "fixture" },
  baselines: [{
    category: "SINGLE",
    kind: "exact",
    expected: 2,
    officialCatalogTotal: 3,
    asOf: "2026-07-13",
    scopeNote: "fixture",
    sources: [{ url: "https://example.com/authority", authority: "label", note: "fixture" }],
    expectedWorks: [
      {
        title: "Original CD",
        category: "SINGLE",
        originalReleaseDate: "1980-01-01",
        mediaScope: {
          originalFormats: ["CD"],
          physicalCd: "ORIGINAL_RELEASE",
          physicalCdReleaseDate: "1980-01-01",
        },
      },
      {
        title: "Later CD",
        category: "SINGLE",
        originalReleaseDate: "1981-01-01",
        mediaScope: {
          originalFormats: ["VINYL"],
          physicalCd: "LATER_OFFICIAL_EDITION",
          physicalCdAuthorityUrls: ["https://example.com/later"],
          physicalCdReleaseDate: "2000-01-01",
        },
      },
      {
        title: "Digital Only",
        category: "SINGLE",
        originalReleaseDate: "1982-01-01",
        mediaScope: {
          originalFormats: ["DIGITAL"],
          physicalCd: "NONE",
          exclusionReason: "DIGITAL_ONLY",
        },
      },
    ],
  }],
  requiredAnchors: [],
  negativeAnchors: [],
  editionTraps: [],
} satisfies ArtistBenchmark;

function candidate(
  id: string,
  title: string,
  originalReleaseDate: string,
  releaseDate: string,
  outOfScope = false,
  category: "SINGLE" | "ORIGINAL_ALBUM" = "SINGLE",
): ComprehensiveDiscographyCandidate {
  return {
    candidate: {
      id,
      title,
      titleOriginal: null,
      category,
      artistCredit: "Fixture Artist",
      releaseDate,
      originalReleaseDate,
      format: "CD",
      catalogNumber: null,
      barcode: null,
      label: null,
      originalPrice: null,
      editionType: null,
      isReissue: false,
      isRemaster: false,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [],
    },
    workId: `work-${title}`,
    editionId: id,
    observations: outOfScope ? [{
      id: `scope-${id}`,
      provider: "manifest",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "SCOPE",
      verdict: "OUT_OF_SCOPE",
      reasonCode: "DIGITAL_ONLY",
      reason: "No physical CD exists.",
      sourceUrl: "https://example.com/authority",
      matchedFields: ["format"],
    }] : [],
    conflicts: [],
  };
}

test("canonical expectations honor ORIGINAL_CD media scope and explicit NONE exclusion", () => {
  assert.deepEqual(
    canonicalExpectations(fixture).map((work) => [work.title, work.expectedOutcome]),
    [
      ["Original CD", "ORIGINAL_CD"],
      ["Later CD", "ORIGINAL_CD"],
      ["Digital Only", "OUT_OF_SCOPE"],
    ],
  );
  assert.deepEqual(buildAuthoritativePreflightRequest(fixture), {
    artistName: "Fixture Artist",
    country: "JP",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest: false,
  });
});

test("the reusable preflight is anchored to the eligible versioned final suite", async () => {
  const manifest = await loadBenchmarkManifest();
  assert.deepEqual(
    selectFinalAcceptanceSuiteFixtures(manifest).map((artist) => artist.slug),
    ["miho-nakayama", "seiko-matsuda", "akina-nakamori", "momoe-yamaguchi"],
  );
});

test("prepared evaluation requires discovery, authority readiness, a validated cover, and explicit OUT", async () => {
  const coverCalls: string[] = [];
  const found: ComprehensiveCoverLookupResult = {
    status: "FOUND",
    imageUrl: "https://coverartarchive.org/release/example/front-500",
    sourceUrl: "https://coverartarchive.org/release/example",
    provider: "cover-art-archive",
    coverMatchLevel: "WORK",
    sourceReleaseDate: "1980-01-01",
  };
  const works = await evaluatePreparedCanonicalWorks({
    fixture,
    candidates: [
      candidate("later-edition", "Original CD", "1980-01-01", "1990-01-01"),
      candidate("original-edition", "Original CD", "1980-01-01", "1980-01-01"),
      candidate("later-cd", "Later CD", "1981-01-01", "2000-01-01"),
      candidate("digital", "Digital Only", "1982-01-01", "1982-01-01", true),
    ],
    classify: (item) => ({
      verdict: item.candidateId === "later-cd" ? "UNKNOWN" : "PASS",
      reasonCode: item.candidateId === "later-cd" ? "MISSING_STRONG_AUTHORITY" : "EVIDENCE_READY",
      eligibleForAi: item.candidateId !== "later-cd",
    }),
    lookupValidatedCover: async (item) => {
      coverCalls.push(item.candidate.id);
      return found;
    },
  });

  assert.equal(works[0]?.selectedCandidateId, "original-edition");
  assert.equal(works[0]?.passed, true);
  assert.equal(works[1]?.discovered, true);
  assert.equal(works[1]?.authorityEvidenceReady, false);
  assert.equal(works[1]?.cover, null);
  assert.equal(works[1]?.passed, false);
  assert.equal(works[2]?.explicitOutOfScope, true);
  assert.equal(works[2]?.passed, true);
  assert.deepEqual(coverCalls, ["original-edition"]);
});

test("preflight rejects later editions for an exact original CD and enforces AVAILABLE_BY as an upper bound", async () => {
  const found: ComprehensiveCoverLookupResult = {
    status: "FOUND",
    imageUrl: "https://coverartarchive.org/release/example/front-500",
    sourceUrl: "https://coverartarchive.org/release/example",
    provider: "cover-art-archive",
    coverMatchLevel: "EDITION",
    sourceReleaseDate: "1999-12-31",
  };
  const classify = () => ({
    verdict: "PASS" as const,
    reasonCode: "EVIDENCE_READY" as const,
    eligibleForAi: true,
  });
  const lookupValidatedCover = async () => found;
  const [originalWork, laterWork] = canonicalExpectations(fixture);
  assert.ok(originalWork);
  assert.ok(laterWork);
  assert.equal(candidateMatchesDeclaredPhysicalCdDate(
    candidate("partial-original", "Original CD", "1980-01-01", "1980"),
    originalWork,
  ), false);
  assert.equal(candidateMatchesDeclaredPhysicalCdDate(
    candidate("exact-original", "Original CD", "1980-01-01", "1980-01-01"),
    originalWork,
  ), true);
  assert.equal(candidateMatchesDeclaredPhysicalCdDate(
    candidate("within-upper-bound", "Later CD", "1981-01-01", "1999-12-31"),
    laterWork,
  ), true);
  assert.equal(candidateMatchesDeclaredPhysicalCdDate(
    candidate("after-upper-bound", "Later CD", "1981-01-01", "2000-01-02"),
    laterWork,
  ), false);

  const rejected = await evaluatePreparedCanonicalWorks({
    fixture,
    candidates: [
      candidate("wrong-original", "Original CD", "1980-01-01", "1990-01-01"),
      candidate("after-upper-bound", "Later CD", "1981-01-01", "2000-01-02"),
    ],
    classify,
    lookupValidatedCover,
  });
  assert.equal(rejected[0]?.discovered, true);
  assert.equal(rejected[0]?.authorityEvidenceReady, false);
  assert.equal(rejected[0]?.selectedCandidateId, null);
  assert.equal(rejected[0]?.cover, null);
  assert.equal(rejected[0]?.passed, false);
  assert.equal(rejected[1]?.discovered, true);
  assert.equal(rejected[1]?.authorityEvidenceReady, false);
  assert.equal(rejected[1]?.selectedCandidateId, null);
  assert.equal(rejected[1]?.passed, false);

  const accepted = await evaluatePreparedCanonicalWorks({
    fixture,
    candidates: [
      candidate("exact-original", "Original CD", "1980-01-01", "1980-01-01"),
      candidate("within-upper-bound", "Later CD", "1981-01-01", "1999-12-31"),
    ],
    classify,
    lookupValidatedCover,
  });
  assert.equal(accepted[0]?.selectedCandidateId, "exact-original");
  assert.equal(accepted[0]?.passed, true);
  assert.equal(accepted[1]?.selectedCandidateId, "within-upper-bound");
  assert.equal(accepted[1]?.passed, true);
});

test("Seiko 2010 editions cannot satisfy the declared 2001 original-CD dates", async () => {
  const manifest = await loadBenchmarkManifest();
  const seiko = manifest.artists.find((artist) => artist.slug === "seiko-matsuda");
  assert.ok(seiko);
  let coverCalls = 0;
  const reports = await evaluatePreparedCanonicalWorks({
    fixture: seiko,
    candidates: [
      candidate(
        "seiko-love-emotion-1-2010",
        "SEIKO LOVE & EMOTION VOL.1",
        "2001-06-20",
        "2010-05-26",
        false,
        "ORIGINAL_ALBUM",
      ),
      candidate(
        "seiko-love-emotion-2-2010",
        "SEIKO LOVE & EMOTION VOL.2",
        "2001-11-28",
        "2010-05-26",
        false,
        "ORIGINAL_ALBUM",
      ),
    ],
    classify: () => ({
      verdict: "PASS",
      reasonCode: "EVIDENCE_READY",
      eligibleForAi: true,
    }),
    lookupValidatedCover: async () => {
      coverCalls += 1;
      throw new Error("a mismatched carrier date must not reach cover lookup");
    },
  });

  for (const title of ["SEIKO LOVE & EMOTION VOL.1", "SEIKO LOVE & EMOTION VOL.2"]) {
    const report = reports.find((item) => item.title === title);
    assert.ok(report);
    assert.equal(report.discovered, true);
    assert.equal(report.authorityEvidenceReady, false);
    assert.equal(report.selectedCandidateId, null);
    assert.equal(report.cover, null);
    assert.equal(report.passed, false);
  }
  assert.equal(coverCalls, 0);
});

test("AI organizer is forced off for the whole operation and the caller environment is restored", async () => {
  const previous = process.env.AI_ORGANIZE_PUBLIC_METADATA;
  process.env.AI_ORGANIZE_PUBLIC_METADATA = "true";
  try {
    await assert.rejects(
      withPublicMetadataOrganizerDisabled(async () => {
        assert.equal(process.env.AI_ORGANIZE_PUBLIC_METADATA, "false");
        throw new Error("fixture failure");
      }),
      /fixture failure/,
    );
    assert.equal(process.env.AI_ORGANIZE_PUBLIC_METADATA, "true");
  } finally {
    if (previous === undefined) delete process.env.AI_ORGANIZE_PUBLIC_METADATA;
    else process.env.AI_ORGANIZE_PUBLIC_METADATA = previous;
  }
});

test("public preflight CLI resumes by default and offline mode cannot disable resume", () => {
  assert.deepEqual(
    parseAuthoritativePreflightCliArgs([
      "--slugs=miho-nakayama,seiko-matsuda",
      "--checkpoint-dir=var/custom-preflight",
      "--offline",
    ]),
    {
      help: false,
      slugs: ["miho-nakayama", "seiko-matsuda"],
      checkpointDir: "var/custom-preflight",
      offline: true,
      resume: true,
    },
  );
  assert.throws(
    () => parseAuthoritativePreflightCliArgs(["--offline", "--no-resume"]),
    /cannot be combined/,
  );
});

test("passed public preflight checkpoints are atomic, fixture-bound, and reusable offline", async () => {
  const checkpointDir = await mkdtemp(path.join(tmpdir(), "cd-box-preflight-"));
  const artist: ArtistAuthoritativePreflight = {
    slug: fixture.slug,
    artist: fixture.artist.canonicalName,
    elapsedMs: 123,
    organizerStatus: "skipped",
    canonicalWorks: 3,
    originalCdWorks: 2,
    outOfScopeWorks: 1,
    discoveredOriginalCdWorks: 2,
    evidenceReadyOriginalCdWorks: 2,
    validatedCoverOriginalCdWorks: 2,
    explicitOutOfScopeWorks: 1,
    sourceStats: {} as never,
    works: [],
    passed: true,
  };
  try {
    await writeArtistPreflightCheckpoint({
      checkpointDir,
      suiteId: "suite-v1",
      fixtureHash: "fixture-hash-v1",
      artist,
    });
    assert.deepEqual(
      await readArtistPreflightCheckpoint({
        checkpointDir,
        slug: fixture.slug,
        suiteId: "suite-v1",
        fixtureHash: "fixture-hash-v1",
      }),
      artist,
    );
    assert.equal(
      await readArtistPreflightCheckpoint({
        checkpointDir,
        slug: fixture.slug,
        suiteId: "suite-v1",
        fixtureHash: "changed-fixture",
      }),
      null,
    );
    await writeFile(
      path.join(checkpointDir, `${fixture.slug}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        suiteId: "suite-v1",
        fixtureHash: "fixture-hash-v1",
        artist,
      })}\n`,
      "utf8",
    );
    assert.equal(
      await readArtistPreflightCheckpoint({
        checkpointDir,
        slug: fixture.slug,
        suiteId: "suite-v1",
        fixtureHash: "fixture-hash-v1",
      }),
      null,
    );
    await writeFile(
      path.join(checkpointDir, `${fixture.slug}.json`),
      `${JSON.stringify({
        schemaVersion: 2,
        policyVersion: "legacy-preflight-policy",
        suiteId: "suite-v1",
        fixtureHash: "fixture-hash-v1",
        artist,
      })}\n`,
      "utf8",
    );
    assert.equal(
      await readArtistPreflightCheckpoint({
        checkpointDir,
        slug: fixture.slug,
        suiteId: "suite-v1",
        fixtureHash: "fixture-hash-v1",
      }),
      null,
    );
  } finally {
    await rm(checkpointDir, { recursive: true, force: true });
  }
});
