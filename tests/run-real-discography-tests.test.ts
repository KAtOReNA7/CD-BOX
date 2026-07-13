import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadBenchmarkManifest,
  type ArtistBenchmark,
} from "../scripts/benchmark-discographies";
import type {
  ReleaseResearchCandidateAudit,
  ReleaseResearchResult,
} from "../src/lib/ai/release-research-types";
import { AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS } from
  "../src/lib/official-music/akina-nakamori";
import {
  assertRealDiscographyResultIntegrity,
  buildRealDiscographyExecutionPlan,
  buildRealDiscographyRequest,
  collectRealDiscographyResultViolations,
  evaluateCanonicalAccounting,
  parseRealDiscographyCliArgs,
  parseRealDiscographyReplayInput,
  redactRealDiscographyError,
  runRealDiscographyTests,
  selectFixtureSlugs,
  validateRealDiscographyCoverAssets,
  verifyCanonicalAcceptanceFixture,
  type RealDiscographyRuntime,
} from "../scripts/run-real-discography-tests";

function fullyAccountedPendingResult(fixture: ArtistBenchmark): ReleaseResearchResult {
  const works = fixture.baselines.flatMap((baseline) => baseline.expectedWorks ?? []);
  const audits: ReleaseResearchCandidateAudit[] = works.map((work, index) => {
    const physicalCd = work.mediaScope?.physicalCd;
    const outOfScope = physicalCd !== undefined &&
      !["ORIGINAL_RELEASE", "LATER_OFFICIAL_EDITION"].includes(physicalCd);
    const pendingCover = !outOfScope && index % 2 === 1;
    return {
      candidateId: `canonical-${index}`,
      workId: `work-${index}`,
      editionId: `edition-${index}`,
      title: work.title,
      category: work.category as ReleaseResearchCandidateAudit["category"],
      originalReleaseDate: work.originalReleaseDate ?? null,
      releaseDate: work.mediaScope?.physicalCdReleaseDate ?? work.originalReleaseDate ?? null,
      catalogNumber: work.mediaScope?.physicalCdCatalogNumber ?? null,
      resolution: outOfScope
        ? "OUT_OF_SCOPE"
        : pendingCover
          ? "PENDING_COVER"
          : "PENDING_EVIDENCE",
      evidenceVerdict: outOfScope
        ? "OUT_OF_SCOPE"
        : pendingCover
          ? "PASS"
          : "UNKNOWN",
      ledger: outOfScope
        ? [{
            stage: "SCOPE",
            verdict: "OUT_OF_SCOPE",
            reasonCode: work.mediaScope?.exclusionReason ?? "NO_CONFIRMED_PHYSICAL_CD",
            message: "The canonical work is explicitly outside the requested physical-CD scope.",
            sourceUrls: work.mediaScope?.physicalCdAuthorityUrls ?? [],
            retryable: false,
          }]
        : pendingCover
          ? [{
              stage: "COVER",
              verdict: "UNKNOWN",
              reasonCode: "COVER_RETRY_PENDING",
              message: "The physical edition is verified and its cover retry remains pending.",
              sourceUrls: [],
              retryable: true,
            }]
          : [{
              stage: "AUTHORITATIVE",
              verdict: "UNKNOWN",
              reasonCode: "PHYSICAL_EDITION_EVIDENCE_PENDING",
              message: "The canonical work remains queued for independent physical-edition evidence.",
              sourceUrls: [],
              retryable: true,
            }],
    };
  });
  const pendingEvidence = audits.filter((audit) => audit.resolution === "PENDING_EVIDENCE").length;
  const pendingCover = audits.filter((audit) => audit.resolution === "PENDING_COVER").length;
  const outOfScope = audits.filter((audit) => audit.resolution === "OUT_OF_SCOPE").length;
  return {
    artist: {
      name: fixture.artist.canonicalName,
      nameKana: null,
      nameRomaji: null,
      country: fixture.artist.country,
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: [],
    pipelineVersion: "multi-source-v2",
    verificationCandidates: audits,
    globalWarnings: [],
    verificationSummary: {
      rawReleases: audits.length,
      releaseGroups: audits.length,
      canonicalEditions: audits.length,
      authoritativeMatches: 0,
      crossSourceMatches: 0,
      aiAccepted: 0,
      rejectedByEvidence: 0,
      rejectedByAi: 0,
      rejectedWithoutCover: pendingCover,
      rejectedCoverUnavailable: 0,
      discoveredEditions: audits.length,
      evidenceReady: pendingCover,
      verified: 0,
      pendingEvidence,
      pendingCover,
      rejected: 0,
      outOfScope,
      verifiedWorks: 0,
    },
  };
}

test("real runner CLI parses comma-separated slugs and keeps safe defaults", () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs=the-beatles,miho-nakayama",
  ]);

  assert.deepEqual(options.slugs, ["the-beatles", "miho-nakayama"]);
  assert.equal(options.acceptanceMode, "diagnostic");
  assert.equal(options.continueOnFailure, false);
  assert.equal(options.includeLiveRemixBest, false);
  assert.equal(options.help, false);
});

test("real runner CLI supports explicit continuation, opt-in scope, and split values", () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs",
    "miho-nakayama, seiko-matsuda",
    "--fixture",
    "tests/fixtures/discography-benchmarks.json",
    "--continue-on-failure",
    "--include-live-remix-best",
  ]);

  assert.deepEqual(options.slugs, ["miho-nakayama", "seiko-matsuda"]);
  assert.equal(options.fixturePath, "tests/fixtures/discography-benchmarks.json");
  assert.equal(options.continueOnFailure, true);
  assert.equal(options.includeLiveRemixBest, true);
  assert.equal(options.acceptanceMode, "diagnostic");
});

test("real runner CLI separates the versioned final suite from ad-hoc diagnostics", () => {
  const options = parseRealDiscographyCliArgs(["--final-suite"]);
  assert.equal(options.acceptanceMode, "final-suite");
  assert.deepEqual(options.slugs, []);
  assert.throws(
    () => parseRealDiscographyCliArgs(["--final-suite", "--slugs=miho-nakayama"]),
    /exactly one/,
  );
  assert.throws(
    () => parseRealDiscographyCliArgs(["--final-suite", "--include-live-remix-best"]),
    /incompatible/,
  );
});

test("real runner CLI refuses implicit, duplicate, empty, or unknown work", () => {
  assert.throws(
    () => parseRealDiscographyCliArgs([]),
    /exactly one/,
  );
  assert.throws(
    () => parseRealDiscographyCliArgs(["--slugs=miho-nakayama,,the-beatles"]),
    /without empty entries/,
  );
  assert.throws(
    () => parseRealDiscographyCliArgs(["--slugs=miho-nakayama,miho-nakayama"]),
    /must not contain duplicate/,
  );
  assert.throws(
    () => parseRealDiscographyCliArgs(["--slugs=miho-nakayama", "--all"]),
    /Unknown option: --all/,
  );
  assert.deepEqual(parseRealDiscographyCliArgs(["--help"]).slugs, []);
});

test("replay and resume CLI build explicit reusable execution plans", () => {
  const replay = parseRealDiscographyCliArgs([
    "--slugs=miho-nakayama,seiko-matsuda",
    "--replay-tasks=miho-nakayama=task_1,seiko-matsuda=task-2",
  ]);
  assert.deepEqual(buildRealDiscographyExecutionPlan(replay.slugs, replay), [
    { slug: "miho-nakayama", source: "persisted-task", taskId: "task_1" },
    { slug: "seiko-matsuda", source: "persisted-task", taskId: "task-2" },
  ]);

  const resume = parseRealDiscographyCliArgs([
    "--slugs=miho-nakayama,seiko-matsuda",
    "--resume-tasks=miho-nakayama=task_1",
  ]);
  assert.deepEqual(buildRealDiscographyExecutionPlan(resume.slugs, resume), [
    { slug: "miho-nakayama", source: "persisted-task", taskId: "task_1" },
    { slug: "seiko-matsuda", source: "live", taskId: null },
  ]);
  assert.throws(
    () => parseRealDiscographyCliArgs([
      "--slugs=miho-nakayama",
      "--replay-tasks=miho-nakayama=one",
      "--resume-tasks=miho-nakayama=one",
    ]),
    /at most one/,
  );
  assert.throws(
    () => buildRealDiscographyExecutionPlan(["miho-nakayama", "seiko-matsuda"], {
      replayTaskIds: { "miho-nakayama": "one" },
      resumeTaskIds: {},
      replayInputPath: null,
    }),
    /missing completed task IDs for: seiko-matsuda/,
  );
});

test("replay input accepts only completed, uniquely addressed task results", () => {
  assert.deepEqual(parseRealDiscographyReplayInput({
    schemaVersion: 1,
    tasks: [{
      slug: "miho-nakayama",
      task: { id: "task-1", status: "failed", errorMessage: "known failure", parsedResult: null },
    }],
  }).tasks[0]!.task.id, "task-1");
  assert.throws(
    () => parseRealDiscographyReplayInput({
      schemaVersion: 1,
      tasks: [{
        slug: "miho-nakayama",
        task: { id: "task-1", status: "running", errorMessage: null, parsedResult: null },
      }],
    }),
    /not a completed research task/,
  );
});

test("offline task replay never starts a provider task and preserves taskId", async () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs=miho-nakayama",
    "--replay-tasks=miho-nakayama=completed-task-1",
  ]);
  const lines: string[] = [];
  let providerCalls = 0;
  let ownerCalls = 0;
  let closed = false;
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => {
      ownerCalls += 1;
      return { id: "owner" };
    },
    runTask: async () => {
      providerCalls += 1;
      throw new Error("must not run");
    },
    loadCompletedTask: async (taskId) => ({
      id: taskId,
      status: "failed",
      errorMessage: "persisted failure",
      parsedResult: null,
    }),
    close: async () => {
      closed = true;
    },
  };
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
    coverValidator: async () => {
      throw new Error("offline replay must not download a cover");
    },
  });
  assert.deepEqual(result, { completed: 1, failures: 1, requested: 1 });
  assert.equal(providerCalls, 0);
  assert.equal(ownerCalls, 0);
  assert.equal(closed, true);
  assert.equal(JSON.parse(lines[0]!).taskId, "completed-task-1");
  assert.equal(JSON.parse(lines[0]!).offlineReplay, true);
});

test("local replay input runs without loading a runtime or checking remote covers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cd-box-replay-"));
  const inputPath = path.join(directory, "replay.json");
  try {
    await writeFile(inputPath, JSON.stringify({
      schemaVersion: 1,
      tasks: [{
        slug: "miho-nakayama",
        task: { id: "input-task-1", status: "failed", errorMessage: "offline fixture", parsedResult: null },
      }],
    }), "utf8");
    const options = parseRealDiscographyCliArgs([
      "--slugs=miho-nakayama",
      `--replay-input=${inputPath}`,
    ]);
    const lines: string[] = [];
    const result = await runRealDiscographyTests(options, {
      writeLine: (line) => lines.push(line),
      coverValidator: async () => {
        throw new Error("offline replay must not download a cover");
      },
    });
    assert.deepEqual(result, { completed: 1, failures: 1, requested: 1 });
    assert.equal(JSON.parse(lines[0]!).executionSource, "input-file");
    assert.equal(JSON.parse(lines[0]!).taskId, "input-task-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume reuses completed task IDs and runs only missing artists", async () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs=the-beatles,miho-nakayama",
    "--resume-tasks=the-beatles=reused-task",
  ]);
  const loaded: string[] = [];
  const live: string[] = [];
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "owner" }),
    loadCompletedTask: async (taskId) => {
      loaded.push(taskId);
      return { id: taskId, status: "failed", errorMessage: "old failure", parsedResult: null };
    },
    runTask: async (input) => {
      live.push(input.artistName);
      return { id: "new-task", status: "failed", errorMessage: "new failure", parsedResult: null };
    },
    close: async () => undefined,
  };
  const lines: string[] = [];
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
  });
  assert.deepEqual(result, { completed: 2, failures: 2, requested: 2 });
  assert.deepEqual(loaded, ["reused-task"]);
  assert.equal(live.length, 1);
  assert.deepEqual(lines.map((line) => JSON.parse(line).taskId), ["reused-task", "new-task"]);
});

test("integrity collection reports independent violations together", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = manifest.artists.find((item) => item.slug === "miho-nakayama");
  assert.ok(fixture);
  const violations = collectRealDiscographyResultViolations(fixture, {
    artist: { name: "wrong", nameKana: null, nameRomaji: null, country: "", officialSiteUrl: null },
    collectionScope: { target: "ALL_PHYSICAL", excludeReissues: false, includeCollaborations: false },
    releases: [],
    pipelineVersion: "legacy",
    verificationCandidates: undefined,
    globalWarnings: [],
    verificationSummary: null,
  });
  assert.deepEqual(new Set(violations.map((item) => item.code)), new Set([
    "ARTIST_IDENTITY_MISMATCH",
    "PIPELINE_VERSION_MISMATCH",
    "SCOPE_MISMATCH",
    "AUDIT_CONSERVATION",
  ]));
});

test("fixture selection preserves requested slug order and builds the core-CD request", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixtures = selectFixtureSlugs(manifest, ["the-beatles", "miho-nakayama"]);

  assert.deepEqual(fixtures.map((fixture) => fixture.slug), ["the-beatles", "miho-nakayama"]);
  assert.deepEqual(buildRealDiscographyRequest(fixtures[0]!), {
    artistName: "The Beatles",
    country: "GB",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest: false,
  });
  assert.throws(
    () => selectFixtureSlugs(manifest, ["not-a-fixture"]),
    /Unknown fixture slug: not-a-fixture/,
  );
});

test("continue-on-failure runs fake tasks serially and redacts key-shaped errors", async () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs=the-beatles,miho-nakayama",
    "--continue-on-failure",
  ]);
  const calls: string[] = [];
  const lines: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let closed = false;
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "cd-box-local-owner" }),
    runTask: async (input, ownerId) => {
      assert.equal(ownerId, "cd-box-local-owner");
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(input.artistName);
      await Promise.resolve();
      active -= 1;
      return {
        id: `task-${calls.length}`,
        status: "failed",
        errorMessage: "relay rejected sk-1234567890abcdef",
        parsedResult: null,
      };
    },
    close: async () => {
      closed = true;
    },
  };

  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
  });

  assert.deepEqual(calls, ["The Beatles", "中山美穂"]);
  assert.equal(maximumActive, 1);
  assert.equal(closed, true);
  assert.deepEqual(result, { completed: 2, failures: 2, requested: 2 });
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => JSON.parse(line).result === "task-failed"));
  assert.ok(lines.every((line) => line.includes("sk-[REDACTED]") && !line.includes("1234567890abcdef")));
  assert.ok(lines.every((line) => JSON.parse(line).benchmarkFixture.sha256.length === 64));
});

test("default acceptance policy aggregates every selected provider-backed task", async () => {
  const options = parseRealDiscographyCliArgs([
    "--slugs=the-beatles,miho-nakayama",
  ]);
  let calls = 0;
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "cd-box-local-owner" }),
    runTask: async () => {
      calls += 1;
      return {
        id: `failed-task-${calls}`,
        status: "failed",
        errorMessage: "source unavailable",
        parsedResult: null,
      };
    },
    close: async () => undefined,
  };
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: () => undefined,
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { completed: 2, failures: 2, requested: 2 });
});

test("final suite emits final acceptance only after every required member passes", async () => {
  const options = parseRealDiscographyCliArgs(["--final-suite"]);
  const lines: string[] = [];
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "cd-box-local-owner" }),
    runTask: async () => ({
      id: "failed-final-member",
      status: "failed",
      errorMessage: "fixture failure",
      parsedResult: null,
    }),
    close: async () => undefined,
  };
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
  });
  assert.deepEqual(result, { completed: 4, failures: 4, requested: 4 });
  assert.equal(lines.length, 5);
  assert.equal(JSON.parse(lines[0]!).finalAcceptance, false);
  const suite = JSON.parse(lines[4]!);
  assert.equal(suite.event, "real-discography-final-suite");
  assert.equal(suite.suiteId, "authoritative-original-cd-v1");
  assert.equal(suite.finalAcceptance, false);
  assert.equal(suite.requested, 4);
  assert.equal(suite.completed, 4);
  assert.equal(suite.failures, 4);
  assert.equal(suite.violationCount, 4);
});

test("final suite separates complete canonical accounting from publishable coverage", async () => {
  const manifest = await loadBenchmarkManifest();
  const byArtist = new Map(manifest.artists.map((fixture) => [fixture.artist.canonicalName, fixture]));
  const options = parseRealDiscographyCliArgs(["--final-suite"]);
  const lines: string[] = [];
  let calls = 0;
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "cd-box-local-owner" }),
    runTask: async (input) => {
      const fixture = byArtist.get(input.artistName);
      assert.ok(fixture);
      calls += 1;
      return {
        id: `accounted-task-${calls}`,
        status: "succeeded",
        errorMessage: null,
        parsedResult: fullyAccountedPendingResult(fixture),
      };
    },
    close: async () => undefined,
  };
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
    coverValidator: async () => {
      throw new Error("No pending candidate may be downloaded as a published cover.");
    },
  });

  assert.deepEqual(result, { completed: 4, failures: 0, requested: 4 });
  const members = lines.slice(0, -1).map((line) => JSON.parse(line));
  assert.equal(members.length, 4);
  assert.ok(members.every((member) => member.passed === true));
  assert.ok(members.every((member) => member.benchmark.canonicalAccountingPassed === true));
  assert.ok(members.every((member) => member.benchmark.publishableBenchmarkPassed === false));
  assert.ok(members.every((member) =>
    member.benchmark.canonicalAccounting.pendingEvidence.length > 0 ||
      member.benchmark.canonicalAccounting.pendingCover.length > 0));
  const suite = JSON.parse(lines.at(-1)!);
  assert.equal(suite.passed, true);
  assert.equal(suite.finalAcceptance, true);
  assert.equal(suite.canonicalAccountingPassed, true);
  assert.equal(suite.publishableBenchmarkPassed, false);
  assert.equal(suite.canonicalAccountingFailures, 0);
  assert.equal(suite.publishableBenchmarkFailures, 4);
});

test("canonical accounting rejects silent loss and unreasoned exclusion", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = manifest.artists.find((item) => item.slug === "akina-nakamori");
  assert.ok(fixture);
  const complete = fullyAccountedPendingResult(fixture);
  const accounted = evaluateCanonicalAccounting(fixture, complete);
  assert.equal(accounted.passed, true);
  assert.equal(accounted.accountedWorks, accounted.expectedWorks);
  assert.ok(accounted.stateCounts.PENDING_EVIDENCE > 0);
  assert.ok(accounted.stateCounts.PENDING_COVER > 0);
  assert.equal(accounted.stateCounts.OUT_OF_SCOPE, 1);

  const silentlyMissing = structuredClone(complete);
  silentlyMissing.verificationCandidates!.splice(0, 1);
  const missingReport = evaluateCanonicalAccounting(fixture, silentlyMissing);
  assert.equal(missingReport.passed, false);
  assert.equal(missingReport.unaccounted.length, 1);
  assert.ok(missingReport.violations.some((item) => item.code === "CANONICAL_WORK_UNACCOUNTED"));

  const unreasoned = structuredClone(complete);
  const excluded = unreasoned.verificationCandidates!.find((audit) =>
    audit.resolution === "OUT_OF_SCOPE");
  assert.ok(excluded);
  excluded.ledger[0]!.reasonCode = "";
  const exclusionReport = evaluateCanonicalAccounting(fixture, unreasoned);
  assert.equal(exclusionReport.passed, false);
  assert.ok(exclusionReport.violations.some((item) =>
    item.code === "CANONICAL_OUT_OF_SCOPE_REASON_MISSING"));

  const legacyDate = structuredClone(complete);
  delete legacyDate.verificationCandidates![0]!.originalReleaseDate;
  const legacyReport = evaluateCanonicalAccounting(fixture, legacyDate);
  assert.equal(legacyReport.passed, false);
  assert.ok(legacyReport.violations.some((item) =>
    item.code === "CANONICAL_ORIGINAL_DATE_MISSING"));
});

test("a published row without a cover still fails cover acceptance", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = manifest.artists.find((item) => item.slug === "miho-nakayama");
  assert.ok(fixture);
  const work = fixture.baselines[0]!.expectedWorks![0]!;
  const result = fullyAccountedPendingResult(fixture);
  result.releases = [{
    id: "published-without-cover",
    workId: "published-work",
    editionId: "published-edition",
    title: work.title,
    titleOriginal: null,
    category: work.category as ReleaseResearchCandidateAudit["category"],
    artistCredit: fixture.artist.canonicalName,
    releaseDate: work.mediaScope?.physicalCdReleaseDate ?? work.originalReleaseDate ?? null,
    originalReleaseDate: work.originalReleaseDate ?? null,
    format: "CD",
    catalogNumber: work.mediaScope?.physicalCdCatalogNumber ?? "TEST-1",
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
    verification: null,
  }];
  let validatorCalls = 0;
  await assert.rejects(
    validateRealDiscographyCoverAssets(result, async () => {
      validatorCalls += 1;
      throw new Error("The validator must not receive a missing URL.");
    }),
    /missing a cover identity/,
  );
  assert.equal(validatorCalls, 0);
});

test("real runner preserves identity, evidence, 青い珊瑚礁 AVAILABLE_BY, and cover invariants", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = manifest.artists.find((item) => item.slug === "miho-nakayama");
  assert.ok(fixture);
  const parsedResult = {
    artist: {
      name: "WRONG ARTIST",
      nameKana: null,
      nameRomaji: null,
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD" as const,
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: [],
    pipelineVersion: "multi-source-v2" as const,
    verificationCandidates: [],
    globalWarnings: [],
    verificationSummary: null,
  };
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, parsedResult),
    /artist identity does not match/,
  );

  const options = parseRealDiscographyCliArgs(["--slugs=miho-nakayama"]);
  const lines: string[] = [];
  const runtime: RealDiscographyRuntime = {
    ensureLocalOwner: async () => ({ id: "cd-box-local-owner" }),
    runTask: async () => ({
      id: "wrong-artist-task",
      status: "succeeded",
      errorMessage: null,
      parsedResult,
    }),
    close: async () => undefined,
  };
  const result = await runRealDiscographyTests(options, {
    runtime,
    writeLine: (line) => lines.push(line),
  });
  assert.deepEqual(result, { completed: 1, failures: 1, requested: 1 });
  assert.equal(JSON.parse(lines[0]!).result, "benchmark-failed");
  assert.ok(JSON.parse(lines[0]!).violations.some((item: { code: string }) =>
    item.code === "ARTIST_IDENTITY_MISMATCH"));

  const authorityUrl = "https://ndlsearch.ndl.go.jp/books/R100000002-I000000000000-00";
  const corroboratingUrl = "https://musicbrainz.org/release/00000000-0000-4000-8000-000000000001";
  const trustedResult: ReleaseResearchResult = {
    ...parsedResult,
    artist: { ...parsedResult.artist, name: fixture.artist.canonicalName },
    releases: [{
      id: "candidate-1",
      workId: "work-1",
      editionId: "edition-1",
      title: "「C」",
      titleOriginal: null,
      category: "SINGLE",
      artistCredit: fixture.artist.canonicalName,
      releaseDate: "1985-06-21",
      originalReleaseDate: "1985-06-21",
      format: "CD",
      catalogNumber: "K10X-230",
      barcode: null,
      label: "King Records",
      originalPrice: null,
      editionType: null,
      isReissue: false,
      isRemaster: false,
      isExcludedByDefault: false,
      coverImageUrl: "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001/front-500",
      coverImageSourceUrl: "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001",
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [
        { title: "NDL", url: authorityUrl, sourceType: "database" },
        { title: "MusicBrainz", url: corroboratingUrl, sourceType: "database" },
        { title: "Cover Art Archive", url: "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001", sourceType: "database" },
      ],
      verification: {
        status: "VERIFIED",
        method: "multi-source-v2",
        policyVersion: "multi-source-v2",
        aiDecision: "ACCEPT",
        aiReason: "Evidence agrees.",
        checkedAt: new Date().toISOString(),
        matchedFields: ["artist", "title", "date", "catalogNumber", "format"],
        sourceUrls: [authorityUrl, corroboratingUrl],
        authoritySourceUrls: [authorityUrl],
        corroboratingSourceUrls: [corroboratingUrl],
        workId: "work-1",
        editionId: "edition-1",
        coverProvider: "cover-art-archive",
        coverCheckedAt: new Date().toISOString(),
        coverMatchLevel: "EDITION",
        sourceReleaseDate: "1985-06-21",
      },
    }],
    verificationCandidates: [{
      candidateId: "candidate-1",
      workId: "work-1",
      editionId: "edition-1",
      title: "「C」",
      category: "SINGLE",
      releaseDate: "1985-06-21",
      catalogNumber: "K10X-230",
      resolution: "VERIFIED",
      evidenceVerdict: "PASS",
      ledger: [
        { stage: "AUTHORITATIVE", verdict: "PASS", reasonCode: "NDL_EXACT", message: "NDL exact work binding.", sourceUrls: [authorityUrl], retryable: false },
        { stage: "MUSICBRAINZ", verdict: "PASS", reasonCode: "MB_EXACT", message: "MusicBrainz exact edition binding.", sourceUrls: [corroboratingUrl], retryable: false },
        { stage: "COVER", verdict: "PASS", reasonCode: "VALIDATED_EDITION_COVER_FOUND", message: "Validated cover.", sourceUrls: ["https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001"], retryable: false },
      ],
    }],
    verificationSummary: {
      rawReleases: 1,
      releaseGroups: 1,
      canonicalEditions: 1,
      authoritativeMatches: 1,
      crossSourceMatches: 1,
      aiAccepted: 1,
      rejectedByEvidence: 0,
      rejectedByAi: 0,
      rejectedWithoutCover: 0,
      rejectedCoverUnavailable: 0,
      discoveredEditions: 1,
      evidenceReady: 1,
      verified: 1,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 0,
      verifiedWorks: 1,
    },
  };
  assert.doesNotThrow(() => assertRealDiscographyResultIntegrity(fixture, trustedResult));

  for (const sourceReleaseDate of ["1985", "1985-06"]) {
    const partialCoverDate = structuredClone(trustedResult);
    partialCoverDate.releases[0]!.verification!.sourceReleaseDate = sourceReleaseDate;
    assert.doesNotThrow(
      () => assertRealDiscographyResultIntegrity(fixture, partialCoverDate),
      `cover source precision ${sourceReleaseDate} should contain the exact edition day`,
    );
  }
  for (const sourceReleaseDate of ["1985-07", "1984"]) {
    const incompatibleCoverDate = structuredClone(trustedResult);
    incompatibleCoverDate.releases[0]!.verification!.sourceReleaseDate = sourceReleaseDate;
    assert.throws(
      () => assertRealDiscographyResultIntegrity(fixture, incompatibleCoverDate),
      /cover date inconsistent with its edition/,
      sourceReleaseDate,
    );
  }

  const withSupersededEdition = structuredClone(trustedResult);
  withSupersededEdition.verificationCandidates!.push({
    candidateId: "candidate-1-later",
    workId: "work-1",
    editionId: "edition-1-later",
    title: "「C」",
    category: "SINGLE",
    releaseDate: "1990-01-01",
    catalogNumber: "K10X-230",
    resolution: "OUT_OF_SCOPE",
    evidenceVerdict: "PASS",
    ledger: [
      {
        stage: "AUTHORITATIVE",
        verdict: "PASS",
        reasonCode: "NDL_EXACT",
        message: "The later edition is factually verified.",
        sourceUrls: [authorityUrl],
        retryable: false,
      },
      {
        stage: "SELECTION",
        verdict: "OUT_OF_SCOPE",
        reasonCode: "LATER_EDITION_NOT_SELECTED",
        message: "The requested scope keeps the earliest verified edition.",
        sourceUrls: [],
        retryable: false,
      },
    ],
  });
  withSupersededEdition.verificationSummary!.discoveredEditions = 2;
  withSupersededEdition.verificationSummary!.outOfScope = 1;
  assert.doesNotThrow(() =>
    assertRealDiscographyResultIntegrity(fixture, withSupersededEdition));

  const withoutAudit = { ...trustedResult, verificationCandidates: undefined };
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, withoutAudit),
    /complete candidate audit ledger/,
  );
  const invalidResolution = structuredClone(trustedResult);
  (invalidResolution.verificationCandidates![0] as { resolution: string }).resolution = "NOT_TERMINAL";
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, invalidResolution),
    /no terminal decision matching NOT_TERMINAL/,
  );
  const vinyl = structuredClone(trustedResult);
  vinyl.releases[0]!.format = "Vinyl";
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, vinyl),
    /physical-CD edition identity/,
  );
  const groupOnly = structuredClone(trustedResult);
  const releaseUrl = groupOnly.releases[0]!.verification!.corroboratingSourceUrls![0]!;
  const groupUrl = releaseUrl.replace("/release/", "/release-group/");
  groupOnly.releases[0]!.sources = groupOnly.releases[0]!.sources.map((source) =>
    source.url === releaseUrl ? { ...source, url: groupUrl } : source);
  groupOnly.releases[0]!.verification!.sourceUrls = groupOnly.releases[0]!.verification!.sourceUrls.map((url) =>
    url === releaseUrl ? groupUrl : url);
  groupOnly.releases[0]!.verification!.corroboratingSourceUrls = [groupUrl];
  groupOnly.verificationCandidates![0]!.ledger = groupOnly.verificationCandidates![0]!.ledger.map((entry) => ({
    ...entry,
    sourceUrls: entry.sourceUrls.map((url) => url === releaseUrl ? groupUrl : url),
  }));
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, groupOnly),
    /independent corroboration/,
  );
  const carrierFixture = structuredClone(fixture);
  carrierFixture.baselines = [{
    ...carrierFixture.baselines[0]!,
    expected: 1,
    officialCatalogTotal: 2,
    expectedWorks: [
      {
        title: "「C」",
        category: "SINGLE",
        originalReleaseDate: "1985-06-21",
        mediaScope: {
          originalFormats: ["CD"],
          physicalCd: "ORIGINAL_RELEASE",
          physicalCdAuthorityUrls: [],
          physicalCdReleaseDate: "1985-06-21",
          physicalCdCatalogNumber: "K10X-230",
        },
      },
      {
        title: "Digital-only canonical work",
        category: "SINGLE",
        originalReleaseDate: "1986-01-01",
        mediaScope: {
          originalFormats: ["DIGITAL"],
          physicalCd: "NONE",
          exclusionReason: "DIGITAL_ONLY",
        },
      },
    ],
  }];
  const carrierResult = structuredClone(trustedResult);
  carrierResult.verificationCandidates!.push({
    candidateId: "candidate-digital",
    workId: "work-digital",
    editionId: "edition-digital",
    title: "Digital-only canonical work",
    category: "SINGLE",
    originalReleaseDate: "1986-01-01",
    releaseDate: "1986-01-01",
    catalogNumber: null,
    resolution: "OUT_OF_SCOPE",
    evidenceVerdict: "OUT_OF_SCOPE",
    ledger: [{
      stage: "SCOPE",
      verdict: "OUT_OF_SCOPE",
      reasonCode: "DIGITAL_ONLY",
      message: "The canonical work has no physical-CD edition.",
      sourceUrls: [],
      retryable: false,
    }],
  });
  carrierResult.verificationSummary!.discoveredEditions = 2;
  carrierResult.verificationSummary!.outOfScope = 1;
  assert.doesNotThrow(() => assertRealDiscographyResultIntegrity(carrierFixture, carrierResult));

  const independentlyVerifiedAlternateCarrier = structuredClone(carrierResult);
  independentlyVerifiedAlternateCarrier.releases[0]!.catalogNumber = "KICS-9999";
  independentlyVerifiedAlternateCarrier.verificationCandidates![0]!.catalogNumber = "KICS-9999";
  assert.doesNotThrow(() =>
    assertRealDiscographyResultIntegrity(carrierFixture, independentlyVerifiedAlternateCarrier));

  const availableByFixture = structuredClone(carrierFixture);
  const availableByWork = availableByFixture.baselines[0]!.expectedWorks![0]!;
  availableByWork.title = "青い珊瑚礁";
  availableByWork.originalReleaseDate = "1980-07-01";
  availableByWork.mediaScope = {
    originalFormats: ["VINYL"],
    physicalCd: "LATER_OFFICIAL_EDITION",
    physicalCdAuthorityUrls: [],
    physicalCdReleaseDate: "2010-05-26",
    physicalCdCatalogNumber: "SRCL-20061 ～ SRCL-20133",
  };
  (availableByWork.mediaScope as typeof availableByWork.mediaScope & {
    physicalCdRepresentationKind: "CONTAINER_INCLUSION";
  }).physicalCdRepresentationKind = "CONTAINER_INCLUSION";
  const earlierVerifiedCd = structuredClone(carrierResult);
  earlierVerifiedCd.releases[0]!.title = "青い珊瑚礁";
  earlierVerifiedCd.releases[0]!.originalReleaseDate = "1980-07-01";
  earlierVerifiedCd.releases[0]!.releaseDate = "2004-11-17";
  earlierVerifiedCd.releases[0]!.catalogNumber = "SRCL-5676";
  earlierVerifiedCd.releases[0]!.verification!.sourceReleaseDate = "2004-11-17";
  earlierVerifiedCd.verificationCandidates![0]!.title = "青い珊瑚礁";
  earlierVerifiedCd.verificationCandidates![0]!.releaseDate = "2004-11-17";
  earlierVerifiedCd.verificationCandidates![0]!.catalogNumber = "SRCL-5676";
  assert.doesNotThrow(() =>
    assertRealDiscographyResultIntegrity(availableByFixture, earlierVerifiedCd));

  const afterAvailableBy = structuredClone(earlierVerifiedCd);
  afterAvailableBy.releases[0]!.releaseDate = "2011-01-01";
  afterAvailableBy.releases[0]!.verification!.sourceReleaseDate = "2011-01-01";
  afterAvailableBy.verificationCandidates![0]!.releaseDate = "2011-01-01";
  assert.throws(
    () => assertRealDiscographyResultIntegrity(availableByFixture, afterAvailableBy),
    /later than the authoritative physical-CD available-by date/,
  );
  const missingCarrierAudit = structuredClone(carrierResult);
  missingCarrierAudit.verificationCandidates = missingCarrierAudit.verificationCandidates!.slice(0, 1);
  missingCarrierAudit.verificationSummary!.discoveredEditions = 1;
  missingCarrierAudit.verificationSummary!.outOfScope = 0;
  assert.throws(
    () => assertRealDiscographyResultIntegrity(carrierFixture, missingCarrierAudit),
    /explicit carrier-scope audit decision/,
  );

  await assert.doesNotReject(() => validateRealDiscographyCoverAssets(trustedResult, async () => ({
    ok: true,
    reason: "valid",
    retryable: false,
    sourceHost: "coverartarchive.org",
    finalHost: "coverartarchive.org",
    redirects: 0,
    status: 200,
    contentType: "image/jpeg",
    bytesRead: 4096,
    imageFormat: "jpeg",
    width: 500,
    height: 500,
    contentSha256: "a".repeat(64),
    attempts: 1,
  })));
  await assert.rejects(
    validateRealDiscographyCoverAssets(trustedResult, async () => ({
      ok: false,
      reason: "invalid-image-data",
      retryable: false,
      sourceHost: "coverartarchive.org",
      finalHost: "coverartarchive.org",
      redirects: 0,
      status: 200,
      contentType: "image/jpeg",
      bytesRead: 128,
      imageFormat: "jpeg",
      width: null,
      height: null,
      attempts: 1,
    })),
    /Cover acceptance failed/,
  );
  const sharedCover = structuredClone(trustedResult);
  sharedCover.releases.push({
    ...structuredClone(sharedCover.releases[0]!),
    id: "candidate-2",
    workId: "work-2",
    editionId: "edition-2",
    title: "Different work",
    verification: {
      ...structuredClone(sharedCover.releases[0]!.verification!),
      workId: "work-2",
      editionId: "edition-2",
    },
  });
  await assert.rejects(
    validateRealDiscographyCoverAssets(sharedCover, async () => {
      throw new Error("duplicate covers must fail before fetch");
    }),
    /same cover asset is reused/,
  );
  const sameContent = structuredClone(sharedCover);
  sameContent.releases[1]!.coverImageUrl =
    "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000002/front-500";
  await assert.rejects(
    validateRealDiscographyCoverAssets(sameContent, async (url) => ({
      ok: true,
      reason: "valid",
      retryable: false,
      sourceHost: "coverartarchive.org",
      finalHost: "coverartarchive.org",
      redirects: 0,
      status: 200,
      contentType: "image/jpeg",
      bytesRead: url.length,
      imageFormat: "jpeg",
      width: 500,
      height: 500,
      contentSha256: "b".repeat(64),
      attempts: 1,
    })),
    /downloaded cover content is already used/,
  );

  const persistedDuplicate = structuredClone(sameContent);
  persistedDuplicate.releases[0]!.verification!.coverContentSha256 = "b".repeat(64);
  persistedDuplicate.releases[1]!.verification!.coverContentSha256 = "b".repeat(64);
  let persistedDuplicateDownloads = 0;
  await assert.rejects(
    validateRealDiscographyCoverAssets(persistedDuplicate, async (url) => {
      persistedDuplicateDownloads += 1;
      return {
        ok: true,
        reason: "valid",
        retryable: false,
        sourceHost: "coverartarchive.org",
        finalHost: "coverartarchive.org",
        redirects: 0,
        status: 200,
        contentType: "image/jpeg",
        bytesRead: url.length,
        imageFormat: "jpeg",
        width: 500,
        height: 500,
        contentSha256: "b".repeat(64),
        attempts: 1,
      };
    }),
    /persisted cover content is already used/,
  );
  assert.equal(persistedDuplicateDownloads, 2, "persisted hashes must not skip online revalidation");

  const changedSincePersistence = structuredClone(trustedResult);
  changedSincePersistence.releases[0]!.verification!.coverContentSha256 = "d".repeat(64);
  await assert.rejects(
    validateRealDiscographyCoverAssets(changedSincePersistence, async () => ({
      ok: true,
      reason: "valid",
      retryable: false,
      sourceHost: "coverartarchive.org",
      finalHost: "coverartarchive.org",
      redirects: 0,
      status: 200,
      contentType: "image/jpeg",
      bytesRead: 4096,
      imageFormat: "jpeg",
      width: 500,
      height: 500,
      contentSha256: "e".repeat(64),
      attempts: 1,
    })),
    /no longer matches its persisted validation hash/,
  );

  const universalSpec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS["ORIGINAL_ALBUM:15"];
  const auditedMimeMismatch = structuredClone(trustedResult);
  auditedMimeMismatch.releases[0]!.coverImageUrl =
    "https://content-jp.umgi.net/products/up/upch-7267_test_extralarge.jpg";
  auditedMimeMismatch.releases[0]!.coverImageSourceUrl = universalSpec.sourceUrl;
  auditedMimeMismatch.releases[0]!.verification!.coverProvider = "official-label";
  auditedMimeMismatch.releases[0]!.verification!.coverContentSha256 =
    universalSpec.auditedAsset.sha256;
  let observedMimeMismatchOption: boolean | undefined;
  const universalValidation = async (
    _url: string,
    options?: { allowImageTypeMismatch?: boolean },
  ) => {
    observedMimeMismatchOption = options?.allowImageTypeMismatch;
    return {
      ok: true as const,
      reason: "valid" as const,
      retryable: false,
      sourceHost: "content-jp.umgi.net",
      finalHost: "content-jp.umgi.net",
      redirects: 0,
      status: 200,
      contentType: "image/jpeg",
      bytesRead: 4096,
      imageFormat: "png" as const,
      width: universalSpec.auditedAsset.width,
      height: universalSpec.auditedAsset.height,
      contentSha256: universalSpec.auditedAsset.sha256,
      attempts: 1,
    };
  };
  await assert.doesNotReject(() =>
    validateRealDiscographyCoverAssets(auditedMimeMismatch, universalValidation));
  assert.equal(observedMimeMismatchOption, true);

  await assert.rejects(
    validateRealDiscographyCoverAssets(auditedMimeMismatch, async (url, options) => ({
      ...await universalValidation(url, options),
      contentSha256: "f".repeat(64),
    })),
    /no longer matches its persisted validation hash/,
    "the audited MIME exception must not bypass the persisted content hash",
  );

  const unauditedMimeMismatch = structuredClone(auditedMimeMismatch);
  unauditedMimeMismatch.releases[0]!.coverImageSourceUrl =
    "https://www.universal-music.co.jp/nakamori-akina/products/different/";
  let unauditedOption: boolean | undefined;
  await assert.rejects(
    validateRealDiscographyCoverAssets(unauditedMimeMismatch, async (_url, options) => {
      unauditedOption = options?.allowImageTypeMismatch;
      return {
        ...await universalValidation(_url, options),
        ok: false as const,
        reason: "image-type-mismatch" as const,
      };
    }),
    /image-type-mismatch/,
  );
  assert.equal(unauditedOption, undefined);

  const suiteOwners = new Map<string, string>();
  const validCover = async () => ({
    ok: true as const,
    reason: "valid" as const,
    retryable: false,
    sourceHost: "coverartarchive.org",
    finalHost: "coverartarchive.org",
    redirects: 0,
    status: 200,
    contentType: "image/jpeg",
    bytesRead: 4096,
    imageFormat: "jpeg" as const,
    width: 500,
    height: 500,
    contentSha256: "c".repeat(64),
    attempts: 1,
  });
  await validateRealDiscographyCoverAssets(trustedResult, validCover, suiteOwners, "miho-nakayama");
  await assert.rejects(
    validateRealDiscographyCoverAssets(trustedResult, validCover, suiteOwners, "akina-nakamori"),
    /same cover asset is reused by different works/,
  );
});

test("Akina final acceptance requires Crazy Love to be explicitly OUT_OF_SCOPE", async () => {
  const manifest = await loadBenchmarkManifest();
  const fixture = manifest.artists.find((item) => item.slug === "akina-nakamori");
  assert.ok(fixture);
  const result: ReleaseResearchResult = {
    artist: {
      name: fixture.artist.canonicalName,
      nameKana: null,
      nameRomaji: null,
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: [],
    pipelineVersion: "multi-source-v2",
    verificationCandidates: [{
      candidateId: "akina-crazy-love",
      workId: "akina-single-51",
      editionId: "akina-single-51-digital",
      title: "Crazy Love",
      category: "SINGLE",
      originalReleaseDate: "2010-07-13",
      releaseDate: "2010-07-13",
      catalogNumber: null,
      resolution: "OUT_OF_SCOPE",
      evidenceVerdict: "OUT_OF_SCOPE",
      ledger: [{
        stage: "SCOPE",
        verdict: "OUT_OF_SCOPE",
        reasonCode: "DIGITAL_ONLY",
        message: "The canonical single has no physical-CD edition.",
        sourceUrls: ["https://www.universal-music.co.jp/nakamori-akina/products/upch-1990/"],
        retryable: false,
      }],
    }],
    globalWarnings: [],
    verificationSummary: {
      rawReleases: 1,
      releaseGroups: 1,
      canonicalEditions: 1,
      authoritativeMatches: 1,
      crossSourceMatches: 0,
      aiAccepted: 0,
      rejectedByEvidence: 0,
      rejectedByAi: 0,
      rejectedWithoutCover: 0,
      rejectedCoverUnavailable: 0,
      discoveredEditions: 1,
      evidenceReady: 0,
      verified: 0,
      pendingEvidence: 0,
      pendingCover: 0,
      rejected: 0,
      outOfScope: 1,
      verifiedWorks: 0,
    },
  };
  assert.doesNotThrow(() => assertRealDiscographyResultIntegrity(fixture, result));

  const missingExplicitOut = structuredClone(result);
  missingExplicitOut.verificationCandidates = [];
  missingExplicitOut.verificationSummary!.discoveredEditions = 0;
  missingExplicitOut.verificationSummary!.outOfScope = 0;
  assert.throws(
    () => assertRealDiscographyResultIntegrity(fixture, missingExplicitOut),
    /Crazy Love lacks one explicit carrier-scope audit decision/,
  );
});

test("canonical fixture provenance and already-shortened credentials are handled safely", async () => {
  const options = parseRealDiscographyCliArgs(["--slugs=miho-nakayama"]);
  const provenance = await verifyCanonicalAcceptanceFixture(options.fixturePath);
  assert.equal(provenance.sha256.length, 64);
  await assert.rejects(
    verifyCanonicalAcceptanceFixture("package.json"),
    /only accepts the versioned canonical fixture/,
  );
  assert.equal(redactRealDiscographyError("relay rejected sk-A...mDxn"), "relay rejected sk-[REDACTED]");
});
