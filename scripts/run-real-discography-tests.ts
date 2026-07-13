import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_FIXTURE_PATH,
  evaluateArtistBenchmark,
  findExpectedBenchmarkWork,
  isTrustedBenchmarkCoverUrl,
  isTrustedBenchmarkEvidenceUrl,
  loadBenchmarkManifest,
  normalizeBenchmarkText,
  benchmarkWorkAnchorMatches,
  outOfScopeExpectedBenchmarkWorks,
  parseApplicationOutput,
  selectFinalAcceptanceSuiteFixtures,
  type ArtistBenchmark,
  type ArtistBenchmarkReport,
  type DiscographyBenchmarkManifest,
  type WorkAnchor,
} from "./benchmark-discographies";
import {
  isAllowedVerifiedCoverAssetHost,
  isAllowedVerifiedCoverSourceUrl,
  validateCoverAsset,
  type CoverAssetValidationOptions,
  type CoverAssetValidationResult,
} from "../src/lib/ai/cover-asset-validation";
import type {
  AiSearchTaskView,
  ReleaseResearchCandidate,
  ReleaseResearchCandidateAudit,
  ReleaseResearchResult,
  ReleaseResearchRequest,
} from "../src/lib/ai/release-research-types";
import { validateOfficialMusicUrl } from "../src/lib/official-music/url-policy";
import { curatedPhysicalCdDateRelation } from "../src/lib/official-music/curated-discography";
import { AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS } from
  "../src/lib/official-music/akina-nakamori";

export type RealDiscographyCliOptions = {
  fixturePath: string;
  slugs: string[];
  acceptanceMode: "diagnostic" | "final-suite";
  /** Kept for CLI compatibility. Acceptance always aggregates every selected fixture. */
  continueOnFailure: boolean;
  includeLiveRemixBest: boolean;
  replayTaskIds: Record<string, string>;
  resumeTaskIds: Record<string, string>;
  replayInputPath: string | null;
  help: boolean;
};

type CompletedResearchTask = Pick<
  AiSearchTaskView,
  "id" | "status" | "errorMessage" | "parsedResult"
>;

export type RealDiscographyRuntime = {
  ensureLocalOwner(): Promise<{ id: string }>;
  runTask(input: ReleaseResearchRequest, ownerId: string): Promise<CompletedResearchTask>;
  loadCompletedTask?(taskId: string): Promise<CompletedResearchTask | null>;
  close(): Promise<void>;
};

type RunOptions = {
  runtime?: RealDiscographyRuntime;
  writeLine?: (line: string) => void;
  coverValidator?: (url: string) => Promise<CoverAssetValidationResult>;
};

export type RealDiscographyViolation = {
  stage: "task" | "integrity" | "cover" | "benchmark" | "canonical-accounting" | "runner";
  code: string;
  message: string;
  releaseId?: string;
};

export type CanonicalAccountingState =
  | "VERIFIED"
  | "PENDING_EVIDENCE"
  | "PENDING_COVER"
  | "OUT_OF_SCOPE";

export type CanonicalAccountingReport = {
  passed: boolean;
  expectedWorks: number;
  accountedWorks: number;
  stateCounts: Record<CanonicalAccountingState, number>;
  byCategory: Array<{
    category: string;
    expectedWorks: number;
    accountedWorks: number;
    stateCounts: Record<CanonicalAccountingState, number>;
  }>;
  pendingEvidence: Array<{ title: string; category: string; originalReleaseDate: string | null }>;
  pendingCover: Array<{ title: string; category: string; originalReleaseDate: string | null }>;
  outOfScope: Array<{ title: string; category: string; originalReleaseDate: string | null }>;
  unaccounted: Array<{ title: string; category: string; originalReleaseDate: string | null }>;
  violations: RealDiscographyViolation[];
};

export type RealDiscographyExecutionStep = {
  slug: string;
  source: "live" | "persisted-task" | "input-file";
  taskId: string | null;
};

type ReplayInput = {
  schemaVersion: 1;
  tasks: Array<{
    slug: string;
    task: CompletedResearchTask;
  }>;
};

const HELP = `Real discography acceptance runner (uses configured providers and may incur usage)

Usage:
  node --env-file=.env.local --import tsx --conditions=react-server scripts/run-real-discography-tests.ts --slugs=miho-nakayama,seiko-matsuda
  node --env-file=.env.local --import tsx --conditions=react-server scripts/run-real-discography-tests.ts --final-suite

Options:
  --slugs=<slug,...>          Required fixture slugs. Runs serially in the listed order.
  --final-suite               Run the complete versioned final suite; cannot be combined with --slugs.
  --fixture=<path>            Use a byte-identical copy of the versioned acceptance fixture.
  --continue-on-failure       Compatibility flag; all selected artists are always aggregated.
  --include-live-remix-best   Include live, remix, and best releases (default false).
  --replay-tasks=<map>        Offline DB replay: slug=taskId pairs; every selected slug is required.
  --replay-input=<path>       Offline replay from a schemaVersion=1 local JSON input bundle.
  --resume-tasks=<map>        Reuse mapped completed task IDs and run only missing selected slugs.
  --help, -h                  Show this help without loading runtime providers.

The runner uses the local owner and existing environment provider configuration.
It never accepts or prints an API key.
`;

function parseTaskIdMap(value: string, optionName: string) {
  const output: Record<string, string> = {};
  for (const item of value.split(",")) {
    const separator = item.indexOf("=");
    const slug = separator < 0 ? "" : item.slice(0, separator).trim();
    const taskId = separator < 0 ? "" : item.slice(separator + 1).trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) {
      throw new Error(`${optionName} must contain comma-separated slug=taskId pairs.`);
    }
    if (output[slug]) throw new Error(`${optionName} contains duplicate slug ${slug}.`);
    output[slug] = taskId;
  }
  if (Object.keys(output).length === 0) throw new Error(`${optionName} requires a value.`);
  return output;
}

function readOptionValue(
  args: string[],
  index: number,
  name: string,
): { value: string; consumed: number } | null {
  const argument = args[index];
  if (argument === name) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }
  if (argument?.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value.`);
    return { value, consumed: 1 };
  }
  return null;
}

function parseSlugList(value: string) {
  const slugs = value.split(",").map((slug) => slug.trim());
  if (slugs.some((slug) => !slug)) {
    throw new Error("--slugs must be a comma-separated list without empty entries.");
  }
  for (const slug of slugs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`Invalid fixture slug: ${slug}`);
    }
  }
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("--slugs must not contain duplicate fixture slugs.");
  }
  return slugs;
}

export function parseRealDiscographyCliArgs(args: string[]): RealDiscographyCliOptions {
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let slugs: string[] | null = null;
  let finalSuite = false;
  let continueOnFailure = false;
  let includeLiveRemixBest = false;
  let replayTaskIds: Record<string, string> = {};
  let resumeTaskIds: Record<string, string> = {};
  let replayInputPath: string | null = null;
  let help = false;

  for (let index = 0; index < args.length;) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      index += 1;
      continue;
    }
    if (argument === "--continue-on-failure") {
      continueOnFailure = true;
      index += 1;
      continue;
    }
    if (argument === "--final-suite") {
      if (finalSuite) throw new Error("--final-suite may only be provided once.");
      finalSuite = true;
      index += 1;
      continue;
    }
    if (argument === "--include-live-remix-best") {
      includeLiveRemixBest = true;
      index += 1;
      continue;
    }

    const slugOption = readOptionValue(args, index, "--slugs");
    if (slugOption) {
      if (slugs !== null) throw new Error("--slugs may only be provided once.");
      slugs = parseSlugList(slugOption.value);
      index += slugOption.consumed;
      continue;
    }

    const fixtureOption = readOptionValue(args, index, "--fixture");
    if (fixtureOption) {
      fixturePath = fixtureOption.value;
      index += fixtureOption.consumed;
      continue;
    }

    const replayTasksOption = readOptionValue(args, index, "--replay-tasks");
    if (replayTasksOption) {
      if (Object.keys(replayTaskIds).length > 0) {
        throw new Error("--replay-tasks may only be provided once.");
      }
      replayTaskIds = parseTaskIdMap(replayTasksOption.value, "--replay-tasks");
      index += replayTasksOption.consumed;
      continue;
    }

    const resumeTasksOption = readOptionValue(args, index, "--resume-tasks");
    if (resumeTasksOption) {
      if (Object.keys(resumeTaskIds).length > 0) {
        throw new Error("--resume-tasks may only be provided once.");
      }
      resumeTaskIds = parseTaskIdMap(resumeTasksOption.value, "--resume-tasks");
      index += resumeTasksOption.consumed;
      continue;
    }

    const replayInputOption = readOptionValue(args, index, "--replay-input");
    if (replayInputOption) {
      if (replayInputPath !== null) throw new Error("--replay-input may only be provided once.");
      replayInputPath = replayInputOption.value;
      index += replayInputOption.consumed;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (!help && (slugs === null) === !finalSuite) {
    throw new Error("Choose exactly one of --slugs=<slug,...> (diagnostic) or --final-suite.");
  }
  if (finalSuite && includeLiveRemixBest) {
    throw new Error("--include-live-remix-best is incompatible with --final-suite.");
  }
  const replayModes = [
    Object.keys(replayTaskIds).length > 0,
    Object.keys(resumeTaskIds).length > 0,
    replayInputPath !== null,
  ].filter(Boolean).length;
  if (replayModes > 1) {
    throw new Error("Choose at most one of --replay-tasks, --resume-tasks, or --replay-input.");
  }

  return {
    fixturePath,
    slugs: slugs ?? [],
    acceptanceMode: finalSuite ? "final-suite" : "diagnostic",
    continueOnFailure,
    includeLiveRemixBest,
    replayTaskIds,
    resumeTaskIds,
    replayInputPath,
    help,
  };
}

export function buildRealDiscographyExecutionPlan(
  slugs: string[],
  options: Pick<RealDiscographyCliOptions, "replayTaskIds" | "resumeTaskIds" | "replayInputPath">,
): RealDiscographyExecutionStep[] {
  const selected = new Set(slugs);
  for (const slug of [...Object.keys(options.replayTaskIds), ...Object.keys(options.resumeTaskIds)]) {
    if (!selected.has(slug)) throw new Error(`Reusable task slug is not selected: ${slug}`);
  }
  if (options.replayInputPath) {
    return slugs.map((slug) => ({ slug, source: "input-file", taskId: null }));
  }
  if (Object.keys(options.replayTaskIds).length > 0) {
    const missing = slugs.filter((slug) => !options.replayTaskIds[slug]);
    if (missing.length > 0) {
      throw new Error(`Offline replay is missing completed task IDs for: ${missing.join(", ")}.`);
    }
    return slugs.map((slug) => ({
      slug,
      source: "persisted-task",
      taskId: options.replayTaskIds[slug]!,
    }));
  }
  return slugs.map((slug) => {
    const taskId = options.resumeTaskIds[slug];
    return taskId
      ? { slug, source: "persisted-task" as const, taskId }
      : { slug, source: "live" as const, taskId: null };
  });
}

export function selectFixtureSlugs(
  manifest: DiscographyBenchmarkManifest,
  slugs: string[],
) {
  const bySlug = new Map(manifest.artists.map((fixture) => [fixture.slug, fixture]));
  return slugs.map((slug) => {
    const fixture = bySlug.get(slug);
    if (!fixture) {
      throw new Error(
        `Unknown fixture slug: ${slug}. Available: ${manifest.artists.map((item) => item.slug).join(", ")}`,
      );
    }
    return fixture;
  });
}

export function buildRealDiscographyRequest(
  fixture: ArtistBenchmark,
  includeLiveRemixBest = false,
): ReleaseResearchRequest {
  return {
    artistName: fixture.artist.canonicalName,
    country: fixture.scope.territory,
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest,
  };
}

function shortenedSecret(secret: string) {
  if (secret.length <= 8) return `${secret.slice(0, 2)}...${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function redactRealDiscographyError(value: unknown) {
  let message = value instanceof Error ? value.message : String(value);
  const knownSecrets = [
    process.env.OPENAI_API_KEY,
    process.env.AI_GATEWAY_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
    process.env.DATABASE_URL,
    process.env.NEXTAUTH_SECRET,
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 4));

  for (const secret of knownSecrets) {
    message = message
      .split(secret).join("[REDACTED]")
      .split(shortenedSecret(secret)).join("[REDACTED]");
  }
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{1,8}\.\.\.[A-Za-z0-9_-]{2,8}\b/g, "sk-[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@");
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyCanonicalAcceptanceFixture(fixturePath: string) {
  const selectedPath = path.resolve(fixturePath);
  const canonicalPath = path.resolve(DEFAULT_FIXTURE_PATH);
  const [selected, canonical] = await Promise.all([
    readFile(selectedPath),
    selectedPath === canonicalPath ? Promise.resolve(null) : readFile(canonicalPath),
  ]);
  const selectedSha256 = sha256(selected);
  const canonicalSha256 = canonical ? sha256(canonical) : selectedSha256;
  if (selectedSha256 !== canonicalSha256) {
    throw new Error(
      "The real acceptance runner only accepts the versioned canonical fixture. Use benchmark-discographies.ts for custom diagnostic fixtures.",
    );
  }
  return {
    path: selectedPath,
    sha256: selectedSha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseRealDiscographyReplayInput(value: unknown): ReplayInput {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tasks)) {
    throw new Error("Replay input must be a schemaVersion=1 object with a tasks array.");
  }
  const seen = new Set<string>();
  const tasks = value.tasks.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.slug !== "string" || !isRecord(entry.task)) {
      throw new Error(`Replay input task ${index + 1} is invalid.`);
    }
    const slug = entry.slug;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || seen.has(slug)) {
      throw new Error(`Replay input task ${index + 1} has an invalid or duplicate slug.`);
    }
    seen.add(slug);
    const task = entry.task;
    if (typeof task.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(task.id) ||
      (task.status !== "succeeded" && task.status !== "failed") ||
      (task.errorMessage !== null && typeof task.errorMessage !== "string") ||
      (task.parsedResult !== null && !isRecord(task.parsedResult))) {
      throw new Error(`Replay input task ${slug} is not a completed research task.`);
    }
    const status: CompletedResearchTask["status"] = task.status === "succeeded"
      ? "succeeded"
      : "failed";
    return {
      slug,
      task: {
        id: task.id,
        status,
        errorMessage: task.errorMessage,
        parsedResult: task.parsedResult as ReleaseResearchResult | null,
      },
    };
  });
  return { schemaVersion: 1, tasks };
}

async function loadRealDiscographyReplayInput(inputPath: string) {
  const bytes = await readFile(path.resolve(inputPath));
  if (bytes.byteLength > 50 * 1024 * 1024) {
    throw new Error("Replay input exceeds the 50 MiB safety limit.");
  }
  return parseRealDiscographyReplayInput(JSON.parse(bytes.toString("utf8")) as unknown);
}

function validIsoDay(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function partialIsoDateInterval(value: string | null | undefined) {
  if (!value) return null;
  const timestampMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T.+(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  if (timestampMatch && !Number.isFinite(Date.parse(value))) return null;
  const match = timestampMatch ?? value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (year < 1000 || year > 2999 || month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const start = Date.UTC(year, month! - 1, day);
    const parsed = new Date(start);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 ||
      parsed.getUTCDate() !== day) return null;
    return { start, end: start + 24 * 60 * 60_000 - 1, precision: 3 as const };
  }
  if (month !== null) {
    return {
      start: Date.UTC(year, month - 1, 1),
      end: Date.UTC(year, month, 1) - 1,
      precision: 2 as const,
    };
  }
  return {
    start: Date.UTC(year, 0, 1),
    end: Date.UTC(year + 1, 0, 1) - 1,
    precision: 1 as const,
  };
}

function physicalCdFormat(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC").toUpperCase();
  return /(?:^|[^A-Z])(?:CD|BLU[ -]?SPEC(?:[ -]?CD)?|COMPACT[ -]?DISC)(?:[^A-Z]|$)/.test(normalized);
}

function sourceFamily(value: string) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "musicbrainz.org") return "musicbrainz";
  if (hostname === "discogs.com" || hostname.endsWith(".discogs.com")) return "discogs";
  if (hostname === "ndlsearch.ndl.go.jp") return "ndl";
  return `authority:${hostname}`;
}

function normalizedHostname(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function categoryAuthorityHostAllowed(
  fixture: ArtistBenchmark,
  category: string,
  value: string,
) {
  const hostname = normalizedHostname(value);
  if (hostname === "ndlsearch.ndl.go.jp") return true;
  const baseline = fixture.baselines.find((item) => item.category === category);
  const categoryHostAllowed = Boolean(baseline?.sources.some((source) => {
    const authorityHost = normalizedHostname(source.url);
    return hostname === authorityHost || hostname.endsWith(`.${authorityHost}`) ||
      authorityHost.endsWith(`.${hostname}`);
  }));
  if (!categoryHostAllowed) return false;
  return validateOfficialMusicUrl(value).ok ||
    Boolean(baseline?.sources.some((source) => source.url === value));
}

function resolutionDecisionPresent(audit: ReleaseResearchCandidateAudit) {
  if (audit.resolution === "VERIFIED") {
    return audit.evidenceVerdict === "PASS" && audit.ledger.some((entry) =>
      entry.stage === "COVER" && entry.verdict === "PASS");
  }
  if (audit.resolution === "REJECTED") {
    return audit.evidenceVerdict === "REJECT" && audit.ledger.some((entry) => entry.verdict === "REJECT");
  }
  if (audit.resolution === "OUT_OF_SCOPE") {
    // A factual scope exclusion carries OUT_OF_SCOPE evidence. Selection can
    // also supersede an otherwise verified later edition; in that case the
    // underlying evidence correctly remains PASS while the terminal ledger
    // records why the edition is not part of the requested final set.
    return (audit.evidenceVerdict === "OUT_OF_SCOPE" || audit.evidenceVerdict === "PASS") &&
      audit.ledger.some((entry) =>
      entry.verdict === "OUT_OF_SCOPE");
  }
  if (audit.resolution === "PENDING_COVER") {
    return audit.evidenceVerdict === "PASS" && audit.ledger.some((entry) =>
      entry.stage === "COVER" && entry.verdict === "UNKNOWN");
  }
  if (audit.resolution === "PENDING_EVIDENCE") {
    return audit.evidenceVerdict === "UNKNOWN" && audit.ledger.some((entry) =>
      entry.stage !== "COVER" && entry.verdict === "UNKNOWN");
  }
  return false;
}

function collectAuditConservationViolations(result: ReleaseResearchResult) {
  const violations: string[] = [];
  const audits = result.verificationCandidates;
  const summary = result.verificationSummary;
  if (!audits || !summary || summary.discoveredEditions === undefined) {
    return ["Real acceptance requires a complete candidate audit ledger and verification summary."];
  }
  if (audits.length !== summary.discoveredEditions) {
    violations.push("Candidate audit ledger does not conserve the discovered-edition count.");
  }
  const ids = new Set<string>();
  for (const audit of audits) {
    if (!audit.candidateId || ids.has(audit.candidateId) || !audit.workId || !audit.editionId) {
      violations.push(`Candidate ${audit.candidateId || "(missing id)"} has a missing or duplicate identity.`);
    }
    ids.add(audit.candidateId);
    if (audit.ledger.length === 0 || !resolutionDecisionPresent(audit)) {
      violations.push(`Candidate ${audit.candidateId} has no terminal decision matching ${audit.resolution}.`);
    }
    for (const entry of audit.ledger) {
      if (!entry.stage.trim() || !entry.reasonCode.trim() || !entry.message.trim() ||
        entry.sourceUrls.some((url) => !/^https:\/\//i.test(url))) {
        violations.push(`Candidate ${audit.candidateId} has an incomplete audit decision.`);
      }
    }
  }

  const count = (resolution: ReleaseResearchCandidateAudit["resolution"]) =>
    audits.filter((audit) => audit.resolution === resolution).length;
  const expectedCounts: Array<[number | undefined, number, string]> = [
    [summary.verified, result.releases.length, "verified release"],
    [summary.verified, count("VERIFIED"), "verified audit"],
    [summary.pendingEvidence, count("PENDING_EVIDENCE"), "pending-evidence"],
    [summary.pendingCover, count("PENDING_COVER"), "pending-cover"],
    [summary.rejected, count("REJECTED"), "rejected"],
    [summary.outOfScope, count("OUT_OF_SCOPE"), "out-of-scope"],
    [summary.verifiedWorks, new Set(result.releases.map((release) => release.workId)).size, "verified-work"],
  ];
  for (const [reported, actual, label] of expectedCounts) {
    if (reported === undefined || reported !== actual) {
      violations.push(`Verification summary ${label} count does not match its candidate ledger.`);
    }
  }
  const terminalCount = [
    "VERIFIED",
    "PENDING_EVIDENCE",
    "PENDING_COVER",
    "REJECTED",
    "OUT_OF_SCOPE",
  ].reduce((total, resolution) => total + audits.filter((audit) =>
    audit.resolution === resolution).length, 0);
  if (terminalCount !== audits.length) {
    violations.push("Candidate audit ledger contains a non-terminal resolution.");
  }
  return violations;
}

type ManifestCanonicalWork = {
  id: string;
  anchor: WorkAnchor;
  requiresScopeExclusion: boolean;
};

function emptyCanonicalStateCounts(): Record<CanonicalAccountingState, number> {
  return {
    VERIFIED: 0,
    PENDING_EVIDENCE: 0,
    PENDING_COVER: 0,
    OUT_OF_SCOPE: 0,
  };
}

function canonicalManifestWorks(fixture: ArtistBenchmark): ManifestCanonicalWork[] {
  return fixture.baselines.flatMap((baseline, baselineIndex) =>
    (baseline.expectedWorks ?? []).map((anchor, workIndex) => ({
      id: `${baselineIndex}:${workIndex}`,
      anchor,
      requiresScopeExclusion: anchor.mediaScope !== undefined &&
        !["ORIGINAL_RELEASE", "LATER_OFFICIAL_EDITION"].includes(anchor.mediaScope.physicalCd),
    })));
}

function explicitCanonicalScopeExclusion(audit: ReleaseResearchCandidateAudit) {
  return audit.resolution === "OUT_OF_SCOPE" &&
    audit.evidenceVerdict === "OUT_OF_SCOPE" &&
    audit.ledger.some((entry) =>
      entry.stage === "SCOPE" && entry.verdict === "OUT_OF_SCOPE" &&
      entry.reasonCode.trim().length > 0 && entry.message.trim().length > 0);
}

function auditMatchesCanonicalWork(
  work: ManifestCanonicalWork,
  audit: ReleaseResearchCandidateAudit,
) {
  return benchmarkWorkAnchorMatches(work.anchor, {
    title: audit.title,
    category: audit.category,
    originalReleaseDate: audit.originalReleaseDate,
  });
}

function auditTitleMatchesCanonicalWork(
  work: ManifestCanonicalWork,
  audit: ReleaseResearchCandidateAudit,
) {
  const acceptedTitles = new Set([work.anchor.title, ...(work.anchor.aliases ?? [])]
    .map(normalizeBenchmarkText));
  return audit.category === work.anchor.category &&
    acceptedTitles.has(normalizeBenchmarkText(audit.title));
}

/**
 * Conserves manifest works independently from publication coverage. Pending
 * candidates remain pending and never become final releases merely to satisfy
 * the manifest count. Matching is intentionally work-level and requires the
 * stable originalReleaseDate carried by the audit view.
 */
export function evaluateCanonicalAccounting(
  fixture: ArtistBenchmark,
  result: ReleaseResearchResult,
): CanonicalAccountingReport {
  const works = canonicalManifestWorks(fixture);
  const audits = result.verificationCandidates ?? [];
  const violations: RealDiscographyViolation[] = [];
  const add = (code: string, message: string) => {
    violations.push({ stage: "canonical-accounting", code, message });
  };
  const configuredExpectedWorks = fixture.baselines.reduce(
    (total, baseline) => total + baseline.expected,
    0,
  );
  if (works.length === 0 && configuredExpectedWorks > 0) {
    add(
      "CANONICAL_MANIFEST_MISSING",
      "The benchmark declares canonical counts but has no versioned expectedWorks ledger.",
    );
  }

  const matchesByAuditIndex = audits.map((audit) => works
    .filter((work) => auditMatchesCanonicalWork(work, audit))
    .map((work) => work.id));
  const ambiguousAuditIndexes = new Set<number>();
  for (const [auditIndex, matches] of matchesByAuditIndex.entries()) {
    if (matches.length <= 1) continue;
    ambiguousAuditIndexes.add(auditIndex);
    add(
      "CANONICAL_AUDIT_AMBIGUOUS",
      `Candidate ${audits[auditIndex]!.candidateId} matches more than one canonical manifest work.`,
    );
  }

  const stateCounts = emptyCanonicalStateCounts();
  const byCategory = new Map<string, {
    category: string;
    expectedWorks: number;
    accountedWorks: number;
    stateCounts: Record<CanonicalAccountingState, number>;
  }>();
  const pendingEvidence: CanonicalAccountingReport["pendingEvidence"] = [];
  const pendingCover: CanonicalAccountingReport["pendingCover"] = [];
  const outOfScope: CanonicalAccountingReport["outOfScope"] = [];
  const unaccounted: CanonicalAccountingReport["unaccounted"] = [];
  let accountedWorks = 0;

  for (const work of works) {
    const categorySummary = byCategory.get(work.anchor.category) ?? {
      category: work.anchor.category,
      expectedWorks: 0,
      accountedWorks: 0,
      stateCounts: emptyCanonicalStateCounts(),
    };
    categorySummary.expectedWorks += 1;
    byCategory.set(work.anchor.category, categorySummary);

    const matchingAudits = audits.filter((_, auditIndex) =>
      !ambiguousAuditIndexes.has(auditIndex) && matchesByAuditIndex[auditIndex]?.[0] === work.id);
    const publishedCandidateIds = new Set(result.releases
      .filter((release) => benchmarkWorkAnchorMatches(work.anchor, release))
      .map((release) => release.id));
    const eligibleStates = new Set<CanonicalAccountingState>();
    for (const audit of matchingAudits) {
      if (!resolutionDecisionPresent(audit)) continue;
      if (audit.resolution === "VERIFIED" && publishedCandidateIds.has(audit.candidateId)) {
        eligibleStates.add("VERIFIED");
      } else if (audit.resolution === "PENDING_COVER" && !work.requiresScopeExclusion) {
        eligibleStates.add("PENDING_COVER");
      } else if (audit.resolution === "PENDING_EVIDENCE" && !work.requiresScopeExclusion) {
        eligibleStates.add("PENDING_EVIDENCE");
      } else if (explicitCanonicalScopeExclusion(audit)) {
        eligibleStates.add("OUT_OF_SCOPE");
      }
    }

    const selectedState = ([
      "VERIFIED",
      "PENDING_COVER",
      "PENDING_EVIDENCE",
      "OUT_OF_SCOPE",
    ] as const).find((state) => eligibleStates.has(state)) ?? null;
    const identity = {
      title: work.anchor.title,
      category: work.anchor.category,
      originalReleaseDate: work.anchor.originalReleaseDate ?? null,
    };
    if (selectedState) {
      accountedWorks += 1;
      categorySummary.accountedWorks += 1;
      stateCounts[selectedState] += 1;
      categorySummary.stateCounts[selectedState] += 1;
      if (selectedState === "PENDING_EVIDENCE") pendingEvidence.push(identity);
      if (selectedState === "PENDING_COVER") pendingCover.push(identity);
      if (selectedState === "OUT_OF_SCOPE") outOfScope.push(identity);
      continue;
    }

    unaccounted.push(identity);
    const titleMatchesWithoutOriginalDate = audits.filter((audit) =>
      audit.originalReleaseDate === undefined && auditTitleMatchesCanonicalWork(work, audit));
    if (titleMatchesWithoutOriginalDate.length > 0) {
      add(
        "CANONICAL_ORIGINAL_DATE_MISSING",
        `${work.anchor.category} ${work.anchor.title} has legacy audit rows without originalReleaseDate; rematerialize the persisted result before acceptance.`,
      );
    }
    if (matchingAudits.some((audit) =>
      audit.resolution === "OUT_OF_SCOPE" && !explicitCanonicalScopeExclusion(audit))) {
      add(
        "CANONICAL_OUT_OF_SCOPE_REASON_MISSING",
        `${work.anchor.category} ${work.anchor.title} was excluded without a reasoned SCOPE decision.`,
      );
    }
    if (matchingAudits.some((audit) =>
      audit.resolution === "VERIFIED" && !publishedCandidateIds.has(audit.candidateId))) {
      add(
        "CANONICAL_VERIFIED_RELEASE_MISSING",
        `${work.anchor.category} ${work.anchor.title} has a VERIFIED audit row that is absent from the published result.`,
      );
    }
    add(
      "CANONICAL_WORK_UNACCOUNTED",
      `${work.anchor.category} ${work.anchor.title} is not VERIFIED, pending, or explicitly OUT_OF_SCOPE.`,
    );
  }

  return {
    passed: violations.length === 0 && accountedWorks === works.length,
    expectedWorks: works.length,
    accountedWorks,
    stateCounts,
    byCategory: [...byCategory.values()].sort((left, right) =>
      left.category.localeCompare(right.category, "en")),
    pendingEvidence,
    pendingCover,
    outOfScope,
    unaccounted,
    violations,
  };
}

function collectOutOfScopeCanonicalCarrierViolations(
  fixture: ArtistBenchmark,
  result: ReleaseResearchResult,
) {
  const violations: string[] = [];
  const excludedWorks = outOfScopeExpectedBenchmarkWorks(fixture);
  for (const work of excludedWorks) {
    const finalMatches = result.releases.filter((release) =>
      benchmarkWorkAnchorMatches(work, release));
    if (finalMatches.length > 0) {
      violations.push(`Out-of-scope canonical work ${work.title} leaked into ORIGINAL_CD results.`);
    }
    const auditMatches = (result.verificationCandidates ?? []).filter((audit) =>
      benchmarkWorkAnchorMatches(work, {
        title: audit.title,
        category: audit.category,
        originalReleaseDate: audit.originalReleaseDate,
      }));
    if (auditMatches.length !== 1 || auditMatches[0]!.resolution !== "OUT_OF_SCOPE" ||
      !auditMatches[0]!.ledger.some((entry) =>
        entry.stage === "SCOPE" && entry.verdict === "OUT_OF_SCOPE" && entry.reasonCode.trim())) {
      violations.push(
        `Out-of-scope canonical work ${work.title} lacks one explicit carrier-scope audit decision.`,
      );
    }
  }
  return violations;
}

function assertTrustedReleaseEvidence(
  fixture: ArtistBenchmark,
  release: ReleaseResearchCandidate,
  audit: ReleaseResearchCandidateAudit,
) {
  const verification = release.verification;
  if (!verification) throw new Error(`Release ${release.title} has no verification attestation.`);
  if (!release.id.trim() || !release.title.trim() || !release.artistCredit.trim() ||
    !release.workId?.trim() || !release.category.trim()) {
    throw new Error("A final release has an incomplete work identity.");
  }
  const sourceByUrl = new Map(release.sources.map((source) => [source.url, source]));
  const attestedSources = new Set(verification.sourceUrls);
  const authorityUrls = verification.authoritySourceUrls ?? [];
  const corroboratingUrls = verification.corroboratingSourceUrls ?? [];
  const authorityLedgerUrls = new Set(audit.ledger
    .filter((entry) => entry.stage === "AUTHORITATIVE" && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const corroboratingLedgerUrls = new Set(audit.ledger
    .filter((entry) => ["MUSICBRAINZ", "CORROBORATION"].includes(entry.stage) && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const trustedAuthorities = authorityUrls.filter((url) =>
    isTrustedBenchmarkEvidenceUrl(fixture, url, true) &&
    categoryAuthorityHostAllowed(fixture, release.category, url) &&
    sourceByUrl.has(url) && attestedSources.has(url) && authorityLedgerUrls.has(url));
  const trustedCorroborations = corroboratingUrls.filter((url) =>
    isTrustedBenchmarkEvidenceUrl(fixture, url) &&
    sourceByUrl.has(url) && attestedSources.has(url) && corroboratingLedgerUrls.has(url));
  const physicalEntityCorroborations = trustedCorroborations.filter((url) =>
    /^https:\/\/musicbrainz\.org\/release\/[0-9a-f-]+$/i.test(url) ||
    /^https:\/\/www\.discogs\.com\/release\/\d+$/i.test(url) ||
    /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/i.test(url) ||
    (sourceByUrl.get(url)?.sourceType === "official" && validateOfficialMusicUrl(url).ok));
  const independentlyCorroborated = trustedAuthorities.some((authority) =>
    physicalEntityCorroborations.some((corroboration) =>
      sourceFamily(authority) !== sourceFamily(corroboration)));
  if (trustedAuthorities.length === 0 || !independentlyCorroborated) {
    throw new Error(`Release ${release.title} lacks work-bound authority and independent corroboration.`);
  }
  if (!physicalCdFormat(release.format) || !validIsoDay(release.releaseDate) ||
    !validIsoDay(release.originalReleaseDate) || !release.catalogNumber?.trim() ||
    !release.editionId?.trim() || release.isExcludedByDefault) {
    throw new Error(`Release ${release.title} lacks a complete trusted physical-CD edition identity.`);
  }
  const matchedFields = new Set(verification.matchedFields);
  if (!["artist", "title", "date", "catalogNumber", "format"].every((field) => matchedFields.has(field))) {
    throw new Error(`Release ${release.title} does not attest every required physical-CD identity field.`);
  }
  if (verification.workId !== release.workId || verification.editionId !== release.editionId) {
    throw new Error(`Release ${release.title} has conflicting work or edition identifiers.`);
  }
  if (!release.coverImageSourceUrl ||
    !isAllowedVerifiedCoverSourceUrl(release.coverImageSourceUrl, verification.coverProvider) ||
    !sourceByUrl.has(release.coverImageSourceUrl)) {
    throw new Error(`Release ${release.title} has no provider-bound cover source.`);
  }
  const coverLedgerBound = audit.ledger.some((entry) =>
    entry.stage === "COVER" && entry.verdict === "PASS" &&
    entry.sourceUrls.includes(release.coverImageSourceUrl!));
  const sourceDate = partialIsoDateInterval(verification.sourceReleaseDate);
  if (!coverLedgerBound || !verification.coverMatchLevel || !sourceDate) {
    throw new Error(`Release ${release.title} has no work/edition-bound cover attestation.`);
  }
  const editionDate = Date.parse(`${release.releaseDate!}T00:00:00.000Z`);
  const workDate = Date.parse(`${release.originalReleaseDate!}T00:00:00.000Z`);
  if (verification.coverMatchLevel === "EDITION" &&
    (editionDate < sourceDate.start || editionDate > sourceDate.end)) {
    throw new Error(`Release ${release.title} has a cover date inconsistent with its edition.`);
  }
  if (verification.coverMatchLevel === "WORK" &&
    (!(["apple-music", "official-label"] as const).includes(
      verification.coverProvider as "apple-music" | "official-label") || sourceDate.end < workDate)) {
    throw new Error(`Release ${release.title} has an invalid work-level cover binding.`);
  }

  const expectedWork = findExpectedBenchmarkWork(fixture, release);
  const mediaScope = expectedWork?.mediaScope;
  if (mediaScope) {
    if (mediaScope.physicalCd !== "ORIGINAL_RELEASE" &&
      mediaScope.physicalCd !== "LATER_OFFICIAL_EDITION") {
      throw new Error(`Release ${release.title} is outside the canonical physical-CD carrier scope.`);
    }
    const curatedMediaScope = mediaScope as Parameters<typeof curatedPhysicalCdDateRelation>[0];
    const dateRelation = curatedPhysicalCdDateRelation(curatedMediaScope, release.releaseDate);
    // An EXACT_EDITION fixture tuple proves that particular carrier exists;
    // it is not a command to select that carrier over an independently
    // verified earlier Japanese CD. AVAILABLE_BY is the only fixture date
    // relation that constrains a different selected edition.
    if (dateRelation === "AFTER_AVAILABLE_BY") {
      throw new Error(`Release ${release.title} is later than the authoritative physical-CD available-by date.`);
    }
    if (mediaScope.physicalCdAuthorityUrls?.length) {
      const scopeLedgerUrls = new Set(audit.ledger
        .filter((entry) => ["SCOPE", "AUTHORITATIVE"].includes(entry.stage) && entry.verdict === "PASS")
        .flatMap((entry) => entry.sourceUrls));
      const carrierBound = mediaScope.physicalCdAuthorityUrls.some((url) =>
        sourceByUrl.has(url) && scopeLedgerUrls.has(url));
      if (!carrierBound) {
        throw new Error(`Release ${release.title} lacks its declared physical-CD authority binding.`);
      }
    }
  }
}

export function assertRealDiscographyResultIntegrity(
  fixture: ArtistBenchmark,
  result: ReleaseResearchResult,
) {
  const violations = collectRealDiscographyResultViolations(fixture, result);
  if (violations.length > 0) {
    throw new Error(violations.map((item) => item.message).join("\n"));
  }
}

export function collectRealDiscographyResultViolations(
  fixture: ArtistBenchmark,
  result: ReleaseResearchResult,
): RealDiscographyViolation[] {
  const violations: RealDiscographyViolation[] = [];
  const add = (code: string, message: string, releaseId?: string) => {
    violations.push({ stage: "integrity", code, message, ...(releaseId ? { releaseId } : {}) });
  };
  const allowedNames = new Set([
    fixture.artist.canonicalName,
    ...fixture.artist.aliases,
  ].map(normalizeBenchmarkText).filter(Boolean));
  const observedNames = [
    result.artist.name,
    result.artist.nameKana,
    result.artist.nameRomaji,
  ].map(normalizeBenchmarkText).filter(Boolean);
  if (!observedNames.some((name) => allowedNames.has(name))) {
    add("ARTIST_IDENTITY_MISMATCH", `Research result artist identity does not match fixture ${fixture.slug}.`);
  }
  if (result.pipelineVersion !== "multi-source-v2") {
    add("PIPELINE_VERSION_MISMATCH", "Research result was not produced by the multi-source-v2 pipeline.");
  }
  if (
    result.collectionScope.target !== "ORIGINAL_CD" ||
    result.collectionScope.excludeReissues !== true ||
    result.collectionScope.includeCollaborations !== true
  ) {
    add("SCOPE_MISMATCH", "Research result scope does not match the real acceptance request.");
  }

  for (const message of collectAuditConservationViolations(result)) add("AUDIT_CONSERVATION", message);
  for (const message of collectOutOfScopeCanonicalCarrierViolations(fixture, result)) {
    add("OUT_OF_SCOPE_ACCOUNTING", message);
  }
  const auditsById = new Map((result.verificationCandidates ?? []).map((audit) => [audit.candidateId, audit]));

  for (const release of result.releases) {
    if (!release.workId) {
      add("WORK_ID_MISSING", `Release ${release.title} is missing an explicit workId.`, release.id);
    }
    const verification = release.verification;
    if (
      verification?.status !== "VERIFIED" ||
      verification.method !== "multi-source-v2" ||
      verification.policyVersion !== "multi-source-v2" ||
      verification.aiDecision !== "ACCEPT"
    ) {
      add("ATTESTATION_INVALID", `Release ${release.title} is missing a trusted multi-source-v2 verification attestation.`, release.id);
    }
    const audit = auditsById.get(release.id);
    if (!audit || audit.resolution !== "VERIFIED" || audit.workId !== release.workId ||
      audit.editionId !== release.editionId || audit.category !== release.category ||
      normalizeBenchmarkText(audit.title) !== normalizeBenchmarkText(release.title)) {
      add("VERIFIED_LEDGER_MISSING", `Release ${release.title} has no matching VERIFIED candidate ledger.`, release.id);
    }
    if (!isTrustedBenchmarkCoverUrl(release.coverImageUrl, verification?.coverProvider)) {
      add("COVER_HOST_INVALID", `Release ${release.title} has no cover on an approved validated asset host.`, release.id);
    }
    if (audit) {
      try {
        assertTrustedReleaseEvidence(fixture, release, audit);
      } catch (error) {
        add("TRUSTED_EVIDENCE_INVALID", redactRealDiscographyError(error), release.id);
      }
    }
  }
  return violations;
}

function normalizedCoverAssetIdentity(value: string) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname)}`;
}

const auditedUniversalMimeMismatchAssets = Object.values(
  AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS,
).filter((spec) =>
  spec.provider === "universal-music-japan" &&
  spec.auditedAsset.allowContentTypeMismatch);

function allowsAuditedUniversalMimeMismatch(release: ReleaseResearchCandidate) {
  const persistedHash = release.verification?.coverContentSha256?.toLowerCase();
  if (
    release.verification?.coverProvider !== "official-label" ||
    !release.coverImageUrl ||
    !release.coverImageSourceUrl ||
    !persistedHash
  ) return false;

  let assetUrl: URL;
  try {
    assetUrl = new URL(release.coverImageUrl);
  } catch {
    return false;
  }
  if (
    assetUrl.protocol !== "https:" ||
    assetUrl.hostname.toLowerCase() !== "content-jp.umgi.net" ||
    assetUrl.username ||
    assetUrl.password ||
    assetUrl.port
  ) return false;

  const assetPath = assetUrl.pathname.toLocaleLowerCase("en");
  return auditedUniversalMimeMismatchAssets.some((spec) => {
    const catalog = spec.catalogNumber.toLocaleLowerCase("en");
    return release.coverImageSourceUrl === spec.sourceUrl &&
      persistedHash === spec.auditedAsset.sha256 &&
      assetPath.startsWith(`/products/${catalog.slice(0, 2)}/${catalog}_`) &&
      /_extralarge\.(?:jpe?g|png)$/iu.test(assetPath);
  });
}

export async function validateRealDiscographyCoverAssets(
  result: ReleaseResearchResult,
  coverValidator: (
    url: string,
    options?: Pick<CoverAssetValidationOptions, "allowImageTypeMismatch">,
  ) => Promise<CoverAssetValidationResult> = (url, options) =>
    validateCoverAsset(url, { timeoutMs: 15_000, retryCount: 1, ...options }),
  suiteOwners: Map<string, string> = new Map(),
  ownerNamespace = "",
) {
  const jobs = new Map<string, ReleaseResearchCandidate>();
  const localAssetOwners = new Map<string, string>();
  const persistedHashOwners = new Map<string, string>();
  const persistedHashFailures: string[] = [];
  const failures: string[] = [];
  for (const release of result.releases) {
    if (!release.coverImageUrl || !release.workId || !release.verification) {
      failures.push(`Release ${release.title} is missing a cover identity.`);
      continue;
    }
    const ownerId = ownerNamespace ? `${ownerNamespace}:${release.workId}` : release.workId;
    let identity: string;
    try {
      identity = normalizedCoverAssetIdentity(release.coverImageUrl);
    } catch {
      failures.push(`Release ${release.title} has an invalid cover asset URL.`);
      continue;
    }
    const identityKey = `asset:${identity}`;
    const owner = localAssetOwners.get(identityKey) ?? suiteOwners.get(identityKey);
    if (owner && owner !== ownerId) {
      failures.push(`The same cover asset is reused by different works (${owner}, ${ownerId}).`);
      continue;
    }
    localAssetOwners.set(identityKey, ownerId);
    const persistedHash = release.verification.coverContentSha256;
    if (persistedHash) {
      if (!/^[a-f0-9]{64}$/iu.test(persistedHash)) {
        persistedHashFailures.push(
          `${release.title}: persisted cover validation hash is invalid`,
        );
      } else {
        const contentKey = `sha256:${persistedHash.toLowerCase()}`;
        const contentOwner = persistedHashOwners.get(contentKey) ?? suiteOwners.get(contentKey);
        if (contentOwner && contentOwner !== ownerId) {
          persistedHashFailures.push(
            `${release.title}: persisted cover content is already used by work ${contentOwner}`,
          );
        } else {
          persistedHashOwners.set(contentKey, ownerId);
        }
      }
    }
    if (!jobs.has(release.coverImageUrl)) jobs.set(release.coverImageUrl, release);
  }
  if (failures.length > 0) {
    throw new Error(`Cover acceptance failed:\n${failures.join("\n")}`);
  }

  const pending = [...jobs.entries()];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pending.length) {
      const [url, release] = pending[nextIndex++]!;
      const validation = await coverValidator(
        url,
        allowsAuditedUniversalMimeMismatch(release)
          ? { allowImageTypeMismatch: true }
          : undefined,
      );
      const provider = release.verification!.coverProvider;
      if (!validation.ok || !validation.finalHost ||
        !isAllowedVerifiedCoverAssetHost(validation.finalHost, provider) ||
        validation.width === null || validation.height === null ||
        validation.width < 64 || validation.height < 64 ||
        !/^[a-f0-9]{64}$/i.test(validation.contentSha256 ?? "")) {
        failures.push(`${release.title}: ${validation.reason}`);
        continue;
      }
      const contentKey = `sha256:${validation.contentSha256!.toLowerCase()}`;
      const persistedHash = release.verification!.coverContentSha256?.toLowerCase();
      if (persistedHash && persistedHash !== validation.contentSha256!.toLowerCase()) {
        failures.push(
          `${release.title}: downloaded cover content no longer matches its persisted validation hash`,
        );
        continue;
      }
      const contentOwner = suiteOwners.get(contentKey);
      const ownerId = ownerNamespace ? `${ownerNamespace}:${release.workId}` : release.workId!;
      if (contentOwner && contentOwner !== ownerId) {
        failures.push(
          `${release.title}: downloaded cover content is already used by work ${contentOwner}`,
        );
      } else {
        suiteOwners.set(`asset:${normalizedCoverAssetIdentity(url)}`, ownerId);
        suiteOwners.set(contentKey, ownerId);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(6, Math.max(1, pending.length)) },
    () => worker(),
  ));
  failures.push(...persistedHashFailures);
  if (failures.length > 0) {
    throw new Error(`Cover acceptance failed:\n${failures.join("\n")}`);
  }
}

function collectBenchmarkViolations(report: ArtistBenchmarkReport): RealDiscographyViolation[] {
  const violations: RealDiscographyViolation[] = [];
  const add = (code: string, message: string) => {
    violations.push({ stage: "benchmark", code, message });
  };
  for (const item of report.missing) add(item.reasonCode, item.note);
  for (const item of report.extra) add(item.reasonCode, item.note);
  for (const item of report.pendingEvidence) {
    add("PENDING_EVIDENCE", `${item.category} ${item.title} still has pending evidence.`);
  }
  for (const item of report.pendingCover) {
    add("PENDING_COVER", `${item.category} ${item.title} still has a pending cover.`);
  }
  for (const item of report.unexplainedRejections) {
    add("UNEXPLAINED_REJECTION", `${item.category} ${item.title} has an unexplained rejection.`);
  }
  for (const baseline of report.baselines) {
    if (!baseline.met) {
      add("BASELINE_MISMATCH", `${baseline.category} expected ${baseline.expected} but observed ${baseline.actual}.`);
    }
  }
  if (!report.passed && violations.length === 0) {
    add("THRESHOLD_NOT_MET", "One or more benchmark metrics did not meet the configured threshold.");
  }
  return violations;
}

function collectPublishedResultViolations(report: ArtistBenchmarkReport) {
  const all = collectBenchmarkViolations(report);
  const publicationCodes = new Set([
    ...report.extra.map((item) => item.reasonCode),
    "PENDING_EVIDENCE",
    "PENDING_COVER",
    "UNEXPLAINED_REJECTION",
  ]);
  return all.filter((violation) => publicationCodes.has(violation.code));
}

async function benchmarkSummary(
  fixture: ArtistBenchmark,
  task: CompletedResearchTask,
  manifest: DiscographyBenchmarkManifest,
  finalAcceptance: boolean,
  coverValidator?: (url: string) => Promise<CoverAssetValidationResult>,
  coverOwners?: Map<string, string>,
  validateCoverAssets = true,
) {
  if (!task.parsedResult) throw new Error("Succeeded research task has no parsed result.");
  const violations = collectRealDiscographyResultViolations(fixture, task.parsedResult);
  if (validateCoverAssets) {
    try {
      await validateRealDiscographyCoverAssets(
        task.parsedResult,
        coverValidator,
        coverOwners,
        fixture.slug,
      );
    } catch (error) {
      const messages = redactRealDiscographyError(error).split(/\r?\n/).filter(Boolean);
      for (const message of messages) {
        violations.push({ stage: "cover", code: "COVER_ASSET_INVALID", message });
      }
    }
  }
  const datasets = parseApplicationOutput(task.parsedResult);
  const dataset = datasets[0];
  if (!dataset) throw new Error("Benchmark parser returned no application dataset.");
  const report = evaluateArtistBenchmark(
    fixture,
    dataset.releases,
    dataset.rejections,
    manifest.defaultMetrics,
    { finalAcceptance, manifestAsOf: manifest.asOf },
  );
  const canonicalAccounting = evaluateCanonicalAccounting(fixture, task.parsedResult);
  const publishableBenchmarkViolations = collectBenchmarkViolations(report);
  if (finalAcceptance) {
    violations.push(...canonicalAccounting.violations);
    // A lower published count is not a silent loss when every missing work is
    // explicitly pending. Invalid rows that were actually published remain a
    // hard failure regardless of canonical conservation.
    violations.push(...collectPublishedResultViolations(report));
  } else {
    violations.push(...publishableBenchmarkViolations);
  }

  return {
    passed: violations.length === 0 && (finalAcceptance
      ? canonicalAccounting.passed
      : report.passed),
    canonicalAccountingPassed: canonicalAccounting.passed,
    canonicalAccounting,
    publishableBenchmarkPassed: report.passed,
    publishableBenchmarkViolations,
    coverAssetsChecked: validateCoverAssets,
    violations,
    summary: report.summary,
    metrics: report.metrics,
    baselines: report.baselines.map((baseline) => {
      const canonicalCategory = canonicalAccounting.byCategory.find((item) =>
        item.category === baseline.category);
      const outOfScopeOfficial = baseline.officialCatalogTotal === undefined
        ? 0
        : (baseline.expectedWorks ?? []).filter((work) =>
          work.mediaScope?.physicalCd !== "ORIGINAL_RELEASE" &&
          work.mediaScope?.physicalCd !== "LATER_OFFICIAL_EDITION").length;
      return {
        category: baseline.category,
        diagnosticKind: baseline.kind,
        finalKind: finalAcceptance ? baseline.finalSnapshotKind ?? baseline.kind : null,
        expectedOriginalCd: baseline.expected,
        actualOriginalCd: baseline.actual,
        officialCanonicalTotal: baseline.officialCatalogTotal ?? baseline.expectedWorks?.length ?? baseline.expected,
        outOfScopeOfficial,
        canonicalAccounted: canonicalCategory?.accountedWorks ?? 0,
        delta: baseline.delta,
        met: baseline.met,
      };
    }),
    issueCounts: {
      missing: report.missing.length,
      extra: report.extra.length,
      pendingEvidence: report.pendingEvidence.length,
      pendingCover: report.pendingCover.length,
      unexplainedRejections: report.unexplainedRejections.length,
    },
    missingAnchors: report.missing
      .filter((item) => item.reasonCode === "ANCHOR_MISSING" && item.title)
      .map((item) => item.title),
  };
}

async function loadRuntime(): Promise<RealDiscographyRuntime> {
  const [researchModule, ownerModule, databaseModule] = await Promise.all([
    import("../src/lib/ai/release-research"),
    import("../src/lib/auth/local-owner"),
    import("../src/lib/db/prisma"),
  ]);

  return {
    ensureLocalOwner: ownerModule.upsertLocalOwner,
    runTask: (input, ownerId) =>
      researchModule.createAndRunReleaseResearchTask(input, ownerId),
    loadCompletedTask: async (taskId) => {
      const task = await databaseModule.prisma.aiSearchTask.findFirst({
        where: { id: taskId, status: { in: ["SUCCEEDED", "FAILED"] } },
        include: { stageSummaries: { orderBy: { sequence: "asc" } } },
      });
      return task ? researchModule.buildReleaseResearchTaskView(task) : null;
    },
    close: () => databaseModule.prisma.$disconnect(),
  };
}

export async function runRealDiscographyTests(
  options: RealDiscographyCliOptions,
  runOptions: RunOptions = {},
) {
  const fixtureProvenance = await verifyCanonicalAcceptanceFixture(options.fixturePath);
  const manifest = await loadBenchmarkManifest(options.fixturePath);
  const fixtures = options.acceptanceMode === "final-suite"
    ? selectFinalAcceptanceSuiteFixtures(manifest)
    : selectFixtureSlugs(manifest, options.slugs);
  const executionPlan = buildRealDiscographyExecutionPlan(
    fixtures.map((fixture) => fixture.slug),
    options,
  );
  const replayInput = options.replayInputPath
    ? await loadRealDiscographyReplayInput(options.replayInputPath)
    : null;
  const replayTasks = new Map(replayInput?.tasks.map((entry) => [entry.slug, entry.task]) ?? []);
  if (replayInput) {
    const missing = fixtures.filter((fixture) => !replayTasks.has(fixture.slug));
    const selected = new Set(fixtures.map((fixture) => fixture.slug));
    const extra = replayInput.tasks.filter((entry) => !selected.has(entry.slug));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error([
        missing.length > 0 ? `Replay input is missing: ${missing.map((item) => item.slug).join(", ")}.` : "",
        extra.length > 0 ? `Replay input contains unselected slugs: ${extra.map((item) => item.slug).join(", ")}.` : "",
      ].filter(Boolean).join(" "));
    }
  }
  const needsRuntime = executionPlan.some((step) => step.source !== "input-file");
  const runtime = needsRuntime ? (runOptions.runtime ?? await loadRuntime()) : null;
  const writeLine = runOptions.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  let completed = 0;
  let failures = 0;
  let benchmarkedMembers = 0;
  let canonicalAccountingFailures = 0;
  let publishableBenchmarkFailures = 0;
  const coverOwners = new Map<string, string>();
  const offlineReplay = Boolean(options.replayInputPath || Object.keys(options.replayTaskIds).length > 0);
  const suiteViolations: Array<{ slug: string; taskId: string | null; violations: RealDiscographyViolation[] }> = [];

  try {
    const hasLiveSteps = executionPlan.some((step) => step.source === "live");
    const owner = hasLiveSteps ? await runtime!.ensureLocalOwner() : null;
    for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
      const fixture = fixtures[fixtureIndex]!;
      const step = executionPlan[fixtureIndex]!;
      const startedAt = Date.now();
      const request = buildRealDiscographyRequest(fixture, options.includeLiveRemixBest);
      completed += 1;
      let task: CompletedResearchTask | null = null;
      try {
        if (step.source === "input-file") {
          task = replayTasks.get(fixture.slug) ?? null;
        } else if (step.source === "persisted-task") {
          if (!runtime?.loadCompletedTask) {
            throw new Error("The selected runtime cannot load completed task IDs.");
          }
          task = await runtime.loadCompletedTask(step.taskId!);
        } else {
          // Deliberately serial: the next paid/provider-backed task starts only after this one completes.
          task = await runtime!.runTask(request, owner!.id);
        }
        if (!task) throw new Error(`Completed task ${step.taskId ?? "(input)"} was not found.`);

        if (task.status !== "succeeded") {
          failures += 1;
          const violations: RealDiscographyViolation[] = [{
            stage: "task",
            code: "TASK_FAILED",
            message: redactRealDiscographyError(task.errorMessage ?? "Research task did not succeed."),
          }];
          suiteViolations.push({ slug: fixture.slug, taskId: task.id, violations });
          writeLine(JSON.stringify({
            event: "real-discography-summary",
            slug: fixture.slug,
            artist: fixture.artist.canonicalName,
            result: "task-failed",
            passed: false,
            taskId: task.id,
            taskStatus: task.status,
            executionSource: step.source,
            offlineReplay,
            acceptanceMode: options.acceptanceMode,
            finalAcceptance: false,
            includeLiveRemixBest: options.includeLiveRemixBest,
            elapsedMs: Date.now() - startedAt,
            benchmarkFixture: fixtureProvenance,
            violations,
            error: violations[0]!.message,
          }));
          continue;
        }

        const benchmark = await benchmarkSummary(
          fixture,
          task,
          manifest,
          options.acceptanceMode === "final-suite",
          runOptions.coverValidator,
          coverOwners,
          !offlineReplay,
        );
        benchmarkedMembers += 1;
        if (!benchmark.canonicalAccountingPassed) canonicalAccountingFailures += 1;
        if (!benchmark.publishableBenchmarkPassed) publishableBenchmarkFailures += 1;
        if (!benchmark.passed) failures += 1;
        if (benchmark.violations.length > 0) {
          suiteViolations.push({ slug: fixture.slug, taskId: task.id, violations: benchmark.violations });
        }
        writeLine(JSON.stringify({
          event: "real-discography-summary",
          slug: fixture.slug,
          artist: fixture.artist.canonicalName,
          result: benchmark.passed ? "passed" : "benchmark-failed",
          passed: benchmark.passed,
          taskId: task.id,
          taskStatus: task.status,
          executionSource: step.source,
          offlineReplay,
          acceptanceMode: options.acceptanceMode,
          finalAcceptance: false,
          suiteMemberPassed: options.acceptanceMode === "final-suite" ? benchmark.passed : null,
          includeLiveRemixBest: options.includeLiveRemixBest,
          elapsedMs: Date.now() - startedAt,
          benchmarkFixture: fixtureProvenance,
          violations: benchmark.violations,
          benchmark,
        }));
      } catch (error) {
        failures += 1;
        const violations: RealDiscographyViolation[] = [{
          stage: "runner",
          code: "RUNNER_ERROR",
          message: redactRealDiscographyError(error),
        }];
        suiteViolations.push({ slug: fixture.slug, taskId: task?.id ?? step.taskId, violations });
        writeLine(JSON.stringify({
          event: "real-discography-summary",
          slug: fixture.slug,
          artist: fixture.artist.canonicalName,
          result: "runner-error",
          passed: false,
          taskId: task?.id ?? step.taskId,
          taskStatus: task?.status ?? null,
          executionSource: step.source,
          offlineReplay,
          acceptanceMode: options.acceptanceMode,
          finalAcceptance: false,
          includeLiveRemixBest: options.includeLiveRemixBest,
          elapsedMs: Date.now() - startedAt,
          benchmarkFixture: fixtureProvenance,
          violations,
          error: violations[0]!.message,
        }));
      }
    }
  } finally {
    await runtime?.close();
  }

  if (options.acceptanceMode === "final-suite") {
    const passed = failures === 0 && completed === fixtures.length;
    const finalAcceptance = passed && !offlineReplay;
    writeLine(JSON.stringify({
      event: "real-discography-final-suite",
      suiteId: manifest.finalAcceptanceSuite!.id,
      acceptanceMode: "final-suite",
      finalAcceptance,
      canonicalAccountingPassed: canonicalAccountingFailures === 0 && benchmarkedMembers === fixtures.length,
      publishableBenchmarkPassed: publishableBenchmarkFailures === 0 && benchmarkedMembers === fixtures.length,
      offlineReplay,
      replayPassed: offlineReplay ? passed : null,
      passed,
      requested: fixtures.length,
      completed,
      failures,
      canonicalAccountingFailures,
      publishableBenchmarkFailures,
      violationCount: suiteViolations.reduce((total, item) => total + item.violations.length, 0),
      violations: suiteViolations,
      benchmarkFixture: fixtureProvenance,
    }));
  }

  return { completed, failures, requested: fixtures.length };
}

async function runCli() {
  try {
    const options = parseRealDiscographyCliArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    const result = await runRealDiscographyTests(options);
    if (result.failures > 0 || result.completed < result.requested) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: "real-discography-runner",
      result: "configuration-error",
      error: redactRealDiscographyError(error),
    })}\n`);
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) void runCli();
