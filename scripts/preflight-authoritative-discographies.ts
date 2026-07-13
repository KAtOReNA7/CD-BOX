import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  benchmarkWorkAnchorMatches,
  loadBenchmarkManifest,
  selectFinalAcceptanceSuiteFixtures,
  type ArtistBenchmark,
  type WorkAnchor,
  type WorkMediaScopeAnchor,
} from "./benchmark-discographies";
import {
  applyComprehensiveWorkRules,
  comprehensiveCandidatesFromResearch,
  type ComprehensiveCoverLookupResult,
  type ComprehensiveDiscographyCandidate,
} from "../src/lib/ai/comprehensive-discography";
import { classifyComprehensiveEvidence } from "../src/lib/ai/comprehensive-evidence-audit";
import {
  prepareComprehensiveSourceEvidence,
  type ComprehensiveSourceStats,
} from "../src/lib/ai/comprehensive-source-adapters";
import { researchPublicMetadataReleases } from "../src/lib/ai/public-metadata-research";
import type { ReleaseResearchRequest } from "../src/lib/ai/release-research-types";
import {
  curatedPhysicalCdDateEvidenceKind,
  curatedPhysicalCdDateRelation,
  type CuratedPhysicalCdDateEvidenceKind,
  type CuratedWorkMediaScope,
} from "../src/lib/official-music/curated-discography";

type CanonicalExpectation = WorkAnchor & {
  expectedOutcome: "ORIGINAL_CD" | "OUT_OF_SCOPE";
};

export type AuthoritativeWorkPreflight = {
  title: string;
  category: string;
  originalReleaseDate: string | null;
  physicalCd: WorkMediaScopeAnchor["physicalCd"] | "UNDECLARED";
  expectedOutcome: CanonicalExpectation["expectedOutcome"];
  candidateCount: number;
  discovered: boolean;
  authorityEvidenceReady: boolean;
  explicitOutOfScope: boolean;
  selectedCandidateId: string | null;
  selectedWorkId: string | null;
  evidenceReasonCodes: string[];
  cover: ComprehensiveCoverLookupResult | null;
  passed: boolean;
};

export type ArtistAuthoritativePreflight = {
  slug: string;
  artist: string;
  elapsedMs: number;
  organizerStatus: "skipped";
  canonicalWorks: number;
  originalCdWorks: number;
  outOfScopeWorks: number;
  discoveredOriginalCdWorks: number;
  evidenceReadyOriginalCdWorks: number;
  validatedCoverOriginalCdWorks: number;
  explicitOutOfScopeWorks: number;
  sourceStats: ComprehensiveSourceStats;
  works: AuthoritativeWorkPreflight[];
  passed: boolean;
};

type EvaluatePreparedArtistInput = {
  fixture: ArtistBenchmark;
  candidates: readonly ComprehensiveDiscographyCandidate[];
  lookupValidatedCover: (
    candidate: ComprehensiveDiscographyCandidate,
  ) => Promise<ComprehensiveCoverLookupResult>;
  onCoverProgress?: (processed: number, total: number) => void | Promise<void>;
  classify?: typeof classifyComprehensiveEvidence;
};

export type AuthoritativePreflightCliOptions = {
  help: boolean;
  slugs: string[] | null;
  checkpointDir: string;
  offline: boolean;
  resume: boolean;
};

type ArtistPreflightCheckpoint = {
  schemaVersion: 2;
  policyVersion: typeof AUTHORITATIVE_PREFLIGHT_POLICY_VERSION;
  suiteId: string;
  fixtureHash: string;
  artist: ArtistAuthoritativePreflight;
};

export const AUTHORITATIVE_PREFLIGHT_POLICY_VERSION =
  "declared-physical-cd-date-v2" as const;

const DEFAULT_CHECKPOINT_DIR = path.join("var", "authoritative-discography-preflight");

const HELP = `Authoritative discography preflight (public sources only; never calls an AI model)

Usage:
  node --env-file=.env.local --import tsx --conditions=react-server scripts/preflight-authoritative-discographies.ts
  node --env-file=.env.local --import tsx --conditions=react-server scripts/preflight-authoritative-discographies.ts --slugs=miho-nakayama,seiko-matsuda

Options:
  --slugs=<slug,...>  Run a serial subset of finalAcceptanceSuite members.
  --checkpoint-dir=<path>
                      Persist one completed artist report at a time (default:
                      var/authoritative-discography-preflight).
  --offline           Read valid passed checkpoints only; never access public sources.
  --no-resume         Ignore existing checkpoints, but still replace them atomically.
  --help, -h          Show this help.

AI_ORGANIZE_PUBLIC_METADATA is forced to false inside this process. The script
does not load a database runtime and writes one JSON report to stdout.
`;

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function expectedOutcome(work: WorkAnchor): CanonicalExpectation["expectedOutcome"] {
  return work.mediaScope?.physicalCd === "NONE" || work.mediaScope?.physicalCd === "UNKNOWN"
    ? "OUT_OF_SCOPE"
    : "ORIGINAL_CD";
}

export function canonicalExpectations(fixture: ArtistBenchmark): CanonicalExpectation[] {
  return fixture.baselines.flatMap((baseline) => (baseline.expectedWorks ?? []).map((work) => ({
    ...work,
    expectedOutcome: expectedOutcome(work),
  })));
}

export function buildAuthoritativePreflightRequest(fixture: ArtistBenchmark): ReleaseResearchRequest {
  return {
    artistName: fixture.artist.canonicalName,
    country: fixture.scope.territory,
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest: false,
  };
}

export async function withPublicMetadataOrganizerDisabled<T>(operation: () => Promise<T>) {
  const previous = process.env.AI_ORGANIZE_PUBLIC_METADATA;
  process.env.AI_ORGANIZE_PUBLIC_METADATA = "false";
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.AI_ORGANIZE_PUBLIC_METADATA;
    else process.env.AI_ORGANIZE_PUBLIC_METADATA = previous;
  }
}

function candidateMatchesWork(
  candidate: ComprehensiveDiscographyCandidate,
  work: WorkAnchor,
) {
  return benchmarkWorkAnchorMatches(work, {
    title: candidate.candidate.title,
    category: candidate.candidate.category,
    originalReleaseDate: candidate.candidate.originalReleaseDate ?? candidate.candidate.releaseDate,
  });
}

function editionSort(
  left: ComprehensiveDiscographyCandidate,
  right: ComprehensiveDiscographyCandidate,
) {
  const leftDate = left.candidate.releaseDate ?? "9999-99-99";
  const rightDate = right.candidate.releaseDate ?? "9999-99-99";
  return leftDate.localeCompare(rightDate) || left.editionId.localeCompare(right.editionId);
}

type ExtendedWorkMediaScopeAnchor = WorkMediaScopeAnchor & {
  physicalCdDateEvidenceKind?: CuratedPhysicalCdDateEvidenceKind | null;
};

function curatedMediaScopeForPreflight(
  media: WorkMediaScopeAnchor,
): CuratedWorkMediaScope {
  const extended = media as ExtendedWorkMediaScopeAnchor;
  return {
    originalFormats: media.originalFormats,
    physicalCd: media.physicalCd,
    ...(media.physicalCdCountry !== undefined
      ? { physicalCdCountry: media.physicalCdCountry }
      : {}),
    physicalCdAuthorityUrls: media.physicalCdAuthorityUrls ?? [],
    physicalCdDateEvidenceKind: extended.physicalCdDateEvidenceKind ?? null,
    physicalCdReleaseDate: media.physicalCdReleaseDate ?? null,
    physicalCdCatalogNumber: media.physicalCdCatalogNumber ?? null,
    exclusionReason: media.exclusionReason ?? null,
  };
}

/**
 * Public preflight must rank only carrier dates the production policy could
 * publish. An exact original-CD declaration requires that exact complete day;
 * an AVAILABLE_BY declaration is only an upper bound and accepts an
 * independently verified earlier CD, never a later one.
 */
export function candidateMatchesDeclaredPhysicalCdDate(
  candidate: ComprehensiveDiscographyCandidate,
  work: WorkAnchor,
) {
  const media = work.mediaScope;
  if (!media || (media.physicalCd !== "ORIGINAL_RELEASE" &&
    media.physicalCd !== "LATER_OFFICIAL_EDITION")) return true;

  const curatedMedia = curatedMediaScopeForPreflight(media);
  const relation = curatedPhysicalCdDateRelation(
    curatedMedia,
    candidate.candidate.releaseDate,
  );
  return curatedPhysicalCdDateEvidenceKind(curatedMedia) === "AVAILABLE_BY"
    ? relation === "WITHIN_AVAILABLE_BY"
    : relation === "EXACT_EDITION_MATCH";
}

function evidenceReasonCodes(candidate: ComprehensiveDiscographyCandidate) {
  return uniqueStrings([
    ...candidate.observations.map((observation) => observation.reasonCode),
    ...candidate.conflicts.map((conflict) => conflict.reasonCode),
  ]).sort();
}

async function lookupCoverWithRecovery(
  candidate: ComprehensiveDiscographyCandidate,
  lookup: EvaluatePreparedArtistInput["lookupValidatedCover"],
) {
  let result = await lookup(candidate);
  // The public acceptance runner has no persisted scheduler behind it. Give a
  // freshly evicted exact-source lookup one delayed chance after a terminal
  // response, and two chances when the provider explicitly reports a
  // retryable outage. Permanent corruption still fails closed.
  const delays = "retryable" in result && result.retryable ? [750, 1_500] : [750];
  for (const delayMs of delays) {
    if (result.status === "FOUND") return result;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    result = await lookup(candidate);
  }
  return result;
}

export async function evaluatePreparedCanonicalWorks(
  input: EvaluatePreparedArtistInput,
): Promise<AuthoritativeWorkPreflight[]> {
  const classify = input.classify ?? classifyComprehensiveEvidence;
  const expectations = canonicalExpectations(input.fixture);
  const originalCdTotal = expectations.filter((work) => work.expectedOutcome === "ORIGINAL_CD").length;
  let coversProcessed = 0;
  const reports: AuthoritativeWorkPreflight[] = [];

  for (const work of expectations) {
    const matches = input.candidates.filter((candidate) => candidateMatchesWork(candidate, work));
    const readiness = matches.map((candidate) => ({
      candidate,
      readiness: classify({
        candidateId: candidate.candidate.id,
        workId: candidate.workId,
        editionId: candidate.editionId,
        title: candidate.candidate.title,
        artistCredit: candidate.candidate.artistCredit,
        observations: candidate.observations,
        conflicts: candidate.conflicts,
      }),
    }));
    const ready = readiness
      .filter((item) => item.readiness.eligibleForAi &&
        candidateMatchesDeclaredPhysicalCdDate(item.candidate, work))
      .map((item) => item.candidate)
      .sort(editionSort);
    const explicitOutOfScope = matches.some((candidate) =>
      candidate.observations.some((observation) => observation.verdict === "OUT_OF_SCOPE"));
    const selected = ready[0] ?? null;
    let cover: ComprehensiveCoverLookupResult | null = null;

    if (work.expectedOutcome === "ORIGINAL_CD" && selected) {
      try {
        cover = await lookupCoverWithRecovery(selected, input.lookupValidatedCover);
      } catch (error) {
        cover = {
          status: "UNAVAILABLE",
          reasonCode: "PREFLIGHT_COVER_LOOKUP_FAILED",
          reason: error instanceof Error ? error.message : "Cover lookup failed.",
          retryable: true,
        };
      }
      coversProcessed += 1;
      await input.onCoverProgress?.(coversProcessed, originalCdTotal);
    }

    const evidenceCodes = uniqueStrings(readiness.flatMap((item) => [
      item.readiness.reasonCode,
      ...evidenceReasonCodes(item.candidate),
    ])).sort();
    const passed = work.expectedOutcome === "OUT_OF_SCOPE"
      ? matches.length > 0 && explicitOutOfScope
      : matches.length > 0 && ready.length > 0 && cover?.status === "FOUND";

    reports.push({
      title: work.title,
      category: work.category,
      originalReleaseDate: work.originalReleaseDate ?? null,
      physicalCd: work.mediaScope?.physicalCd ?? "UNDECLARED",
      expectedOutcome: work.expectedOutcome,
      candidateCount: matches.length,
      discovered: matches.length > 0,
      authorityEvidenceReady: ready.length > 0,
      explicitOutOfScope,
      selectedCandidateId: selected?.candidate.id ?? null,
      selectedWorkId: selected?.workId ?? null,
      evidenceReasonCodes: evidenceCodes,
      cover,
      passed,
    });
  }

  return reports;
}

export function parseAuthoritativePreflightCliArgs(
  args: readonly string[],
): AuthoritativePreflightCliOptions {
  if (args.some((argument) => argument === "--help" || argument === "-h")) {
    return {
      help: true,
      slugs: null,
      checkpointDir: DEFAULT_CHECKPOINT_DIR,
      offline: false,
      resume: true,
    };
  }
  const unknown = args.find((argument) =>
    argument !== "--offline" &&
    argument !== "--no-resume" &&
    !argument.startsWith("--slugs=") &&
    !argument.startsWith("--checkpoint-dir="));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  const slugArguments = args.filter((argument) => argument.startsWith("--slugs="));
  if (slugArguments.length > 1) throw new Error("--slugs may only be provided once.");
  const checkpointArguments = args.filter((argument) => argument.startsWith("--checkpoint-dir="));
  if (checkpointArguments.length > 1) {
    throw new Error("--checkpoint-dir may only be provided once.");
  }
  const checkpointDir = checkpointArguments[0]?.slice("--checkpoint-dir=".length).trim()
    ?? DEFAULT_CHECKPOINT_DIR;
  if (!checkpointDir) throw new Error("--checkpoint-dir requires a non-empty path.");
  const slugs = slugArguments.length === 0
    ? null
    : slugArguments[0]!.slice("--slugs=".length).split(",").map((slug) => slug.trim());
  if (slugs && (slugs.some((slug) => !slug) || new Set(slugs).size !== slugs.length)) {
    throw new Error("--slugs must contain unique, non-empty slugs.");
  }
  const offline = args.includes("--offline");
  const resume = !args.includes("--no-resume");
  if (offline && !resume) throw new Error("--offline cannot be combined with --no-resume.");
  return { help: false, slugs, checkpointDir, offline, resume };
}

export function authoritativeFixtureHash(fixture: ArtistBenchmark) {
  return createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
}

function checkpointPath(checkpointDir: string, slug: string) {
  return path.join(checkpointDir, `${slug}.json`);
}

export async function readArtistPreflightCheckpoint(input: {
  checkpointDir: string;
  slug: string;
  suiteId: string;
  fixtureHash: string;
}) {
  try {
    const raw = await readFile(checkpointPath(input.checkpointDir, input.slug), "utf8");
    const value = JSON.parse(raw) as Partial<ArtistPreflightCheckpoint>;
    if (
      value.schemaVersion !== 2 ||
      value.policyVersion !== AUTHORITATIVE_PREFLIGHT_POLICY_VERSION ||
      value.suiteId !== input.suiteId ||
      value.fixtureHash !== input.fixtureHash ||
      value.artist?.slug !== input.slug ||
      value.artist.passed !== true
    ) {
      return null;
    }
    return value.artist;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : null;
    if (code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeArtistPreflightCheckpoint(input: {
  checkpointDir: string;
  suiteId: string;
  fixtureHash: string;
  artist: ArtistAuthoritativePreflight;
}) {
  await mkdir(input.checkpointDir, { recursive: true });
  const destination = checkpointPath(input.checkpointDir, input.artist.slug);
  const temporary = `${destination}.${process.pid}.tmp`;
  const value: ArtistPreflightCheckpoint = {
    schemaVersion: 2,
    policyVersion: AUTHORITATIVE_PREFLIGHT_POLICY_VERSION,
    suiteId: input.suiteId,
    fixtureHash: input.fixtureHash,
    artist: input.artist,
  };
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
}

function progress(event: Record<string, unknown>) {
  process.stderr.write(`${JSON.stringify({ event: "authoritative-preflight-progress", ...event })}\n`);
}

async function preflightArtist(fixture: ArtistBenchmark): Promise<ArtistAuthoritativePreflight> {
  const startedAt = Date.now();
  const request = buildAuthoritativePreflightRequest(fixture);
  progress({ slug: fixture.slug, stage: "public-metadata", elapsedMs: 0 });
  const publicResearch = await researchPublicMetadataReleases(request, undefined, {
    onEvidenceProgress: ({ phase, processed, total }) => {
      progress({
        slug: fixture.slug,
        stage: `public-metadata:${phase}`,
        processed,
        total,
        elapsedMs: Date.now() - startedAt,
      });
    },
  });
  if (publicResearch.organizer.status !== "skipped") {
    throw new Error(`AI organizer safety invariant failed: ${publicResearch.organizer.status}`);
  }

  const discovered = comprehensiveCandidatesFromResearch(publicResearch.result, publicResearch.evidence);
  const ruled = applyComprehensiveWorkRules(discovered, { excludeReissues: true });
  progress({
    slug: fixture.slug,
    stage: "comprehensive-sources",
    candidates: ruled.length,
    elapsedMs: Date.now() - startedAt,
  });
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: publicResearch.result,
    bundle: publicResearch.evidence,
    candidates: ruled,
    onProgress: ({ stage, processed, total }) => {
      progress({
        slug: fixture.slug,
        stage: `comprehensive-sources:${stage.toLowerCase()}`,
        processed,
        total,
        elapsedMs: Date.now() - startedAt,
      });
    },
  });
  const candidates = applyComprehensiveWorkRules(prepared.candidates, { excludeReissues: true });
  const works = await evaluatePreparedCanonicalWorks({
    fixture,
    candidates,
    lookupValidatedCover: prepared.lookupValidatedCover,
    onCoverProgress: (processed, total) => {
      progress({
        slug: fixture.slug,
        stage: "cover-validation",
        processed,
        total,
        elapsedMs: Date.now() - startedAt,
      });
    },
  });
  const originalCd = works.filter((work) => work.expectedOutcome === "ORIGINAL_CD");
  const outOfScope = works.filter((work) => work.expectedOutcome === "OUT_OF_SCOPE");
  const result: ArtistAuthoritativePreflight = {
    slug: fixture.slug,
    artist: fixture.artist.canonicalName,
    elapsedMs: Date.now() - startedAt,
    organizerStatus: "skipped",
    canonicalWorks: works.length,
    originalCdWorks: originalCd.length,
    outOfScopeWorks: outOfScope.length,
    discoveredOriginalCdWorks: originalCd.filter((work) => work.discovered).length,
    evidenceReadyOriginalCdWorks: originalCd.filter((work) => work.authorityEvidenceReady).length,
    validatedCoverOriginalCdWorks: originalCd.filter((work) => work.cover?.status === "FOUND").length,
    explicitOutOfScopeWorks: outOfScope.filter((work) => work.explicitOutOfScope).length,
    sourceStats: prepared.sourceStats,
    works,
    passed: works.every((work) => work.passed),
  };
  progress({
    slug: fixture.slug,
    stage: "complete",
    passed: result.passed,
    elapsedMs: result.elapsedMs,
  });
  return result;
}

async function runCli() {
  const options = parseAuthoritativePreflightCliArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  await withPublicMetadataOrganizerDisabled(async () => {
    const startedAt = Date.now();
    const manifest = await loadBenchmarkManifest();
    const suite = manifest.finalAcceptanceSuite;
    if (!suite) throw new Error("The authoritative manifest has no finalAcceptanceSuite.");
    const suiteFixtures = selectFinalAcceptanceSuiteFixtures(manifest);
    const suiteSlugs = new Set(suite.artistSlugs);
    const selectedSlugs = options.slugs ?? suite.artistSlugs;
    for (const slug of selectedSlugs) {
      if (!suiteSlugs.has(slug)) throw new Error(`${slug} is not a finalAcceptanceSuite member.`);
    }
    const fixturesBySlug = new Map(suiteFixtures.map((fixture) => [fixture.slug, fixture]));
    const artists: ArtistAuthoritativePreflight[] = [];
    const resumedSlugs: string[] = [];
    for (const slug of selectedSlugs) {
      const fixture = fixturesBySlug.get(slug);
      if (!fixture) throw new Error(`Missing final-suite fixture: ${slug}`);
      const fixtureHash = authoritativeFixtureHash(fixture);
      const checkpoint = options.resume
        ? await readArtistPreflightCheckpoint({
            checkpointDir: options.checkpointDir,
            slug,
            suiteId: suite.id,
            fixtureHash,
          })
        : null;
      if (checkpoint) {
        resumedSlugs.push(slug);
        progress({ slug, stage: "checkpoint-reused", elapsedMs: 0 });
        artists.push(checkpoint);
        continue;
      }
      if (options.offline) {
        throw new Error(`No valid passed checkpoint is available for ${slug}.`);
      }
      const artist = await preflightArtist(fixture);
      artists.push(artist);
      if (artist.passed) {
        await writeArtistPreflightCheckpoint({
          checkpointDir: options.checkpointDir,
          suiteId: suite.id,
          fixtureHash,
          artist,
        });
        progress({ slug, stage: "checkpoint-saved", elapsedMs: artist.elapsedMs });
      }
    }
    const report = {
      schemaVersion: 1,
      policyVersion: AUTHORITATIVE_PREFLIGHT_POLICY_VERSION,
      suiteId: suite.id,
      mode: "public-authoritative-no-ai",
      organizerForcedDisabled: true,
      databaseWrites: false,
      serial: true,
      checkpointDir: options.checkpointDir,
      offline: options.offline,
      resumedSlugs,
      elapsedMs: Date.now() - startedAt,
      selectedSlugs,
      artists,
      passed: artists.length === selectedSlugs.length && artists.every((artist) => artist.passed),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  void runCli().catch((error) => {
    const message = error instanceof Error ? error.message : "Authoritative preflight failed.";
    process.stderr.write(`${JSON.stringify({
      event: "authoritative-preflight-error",
      message: message
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
        .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@"),
    })}\n`);
    process.exitCode = 1;
  });
}
