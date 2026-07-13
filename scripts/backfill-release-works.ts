import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotEnv } from "dotenv";
import {
  PrismaClient,
  type CoverStatus,
  type Prisma,
  type ReleaseCategory,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const musicBrainzReleaseGroupPattern =
  /^https:\/\/musicbrainz\.org\/release-group\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const coverSourceDescription = "cover-image-source";

const releaseCategories = new Set<ReleaseCategory>([
  "ORIGINAL_ALBUM",
  "SINGLE",
  "BEST",
  "COLLECTION",
  "COMPILATION",
  "LIVE",
  "REMIX",
  "BOX",
  "EP",
  "OTHER",
]);

type JsonRecord = Record<string, unknown>;

export type LegacyReleaseForWorkBackfill = {
  id: string;
  artistId: string;
  title: string;
  category: ReleaseCategory;
  originalReleaseDate: Date | string | null;
  editionReleaseDate?: Date | string | null;
  editionDatePrecision?: "YEAR" | "MONTH" | "DAY" | null;
  workId?: string | null;
  coverImageUrl: string | null;
  coverImageSourceUrl?: string | null;
  coverStatus?: CoverStatus | null;
  coverProvider?: string | null;
  coverCheckedAt?: Date | string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  verificationEvidence: unknown;
  verifiedAt: Date | string | null;
  sources: Array<{
    url: string;
    label: string | null;
    description: string | null;
  }>;
};

export type ReleaseWorkBackfillGroup = {
  key: string;
  musicBrainzReleaseGroupId: string | null;
  releases: LegacyReleaseForWorkBackfill[];
  representative: LegacyReleaseForWorkBackfill;
  originalReleaseDate: Date | null;
};

export type ReleaseWorkBackfillPlan = {
  groups: ReleaseWorkBackfillGroup[];
  alreadyLinkedReleaseIds: string[];
  conflicts: Array<{
    releaseId: string;
    reason: "multiple-release-groups" | "release-group-crosses-artists";
    releaseGroupIds: string[];
  }>;
};

type LegacyTaskForAuditBackfill = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  query: string;
  rawResult: unknown;
  parsedResult: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyResearchCandidatePlan = {
  candidateKey: string;
  entityKind: "WORK" | "EDITION";
  sourceProvider: string | null;
  sourceRecordId: string | null;
  title: string;
  category: ReleaseCategory | null;
  releaseDate: Date | null;
  datePrecision: "YEAR" | "MONTH" | "DAY" | null;
  catalogNumber: string | null;
  barcode: string | null;
  payload: JsonRecord;
  disposition: "ACCEPTED" | "DEFERRED";
  finalReasonCode: "LEGACY_VERIFIED_ACCEPT" | "LEGACY_DETAIL_NOT_RECORDED";
  retryable: boolean;
  coverImageUrl: string | null;
  coverImageSourceUrl: string | null;
  coverStatus: "MISSING" | "QUEUED" | "VALID";
  coverProvider: string | null;
  coverCheckedAt: Date | null;
};

export type LegacyResearchTaskPlan = {
  request: JsonRecord | null;
  candidates: LegacyResearchCandidatePlan[];
  stageSummary: {
    inputCount: number;
    passedCount: number;
    deferredCount: number;
    rejectedCount: number;
    mergedCount: number;
    retryCount: number;
    reasonCounts: JsonRecord;
    detailsComplete: false;
  };
};

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function earliestDate(releases: readonly LegacyReleaseForWorkBackfill[]) {
  const dates = releases
    .map((release) => validDate(release.originalReleaseDate))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  return dates[0] ?? null;
}

function representativeRelease(releases: readonly LegacyReleaseForWorkBackfill[]) {
  return [...releases].sort((left, right) => {
    const leftDate = validDate(left.originalReleaseDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDate = validDate(right.originalReleaseDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftDate - rightDate || left.id.localeCompare(right.id);
  })[0]!;
}

export function extractMusicBrainzReleaseGroupIds(
  release: Pick<LegacyReleaseForWorkBackfill, "sources" | "verificationEvidence">,
) {
  const evidence = asRecord(release.verificationEvidence);
  const evidenceUrls = Array.isArray(evidence?.sourceUrls)
    ? evidence.sourceUrls.filter((value): value is string => typeof value === "string")
    : [];
  const ids = [...release.sources.map((source) => source.url), ...evidenceUrls]
    .flatMap((url) => {
      const match = url.match(musicBrainzReleaseGroupPattern);
      return match?.[1] ? [match[1].toLowerCase()] : [];
    });
  return [...new Set(ids)].sort();
}

export function buildReleaseWorkBackfillPlan(
  releases: readonly LegacyReleaseForWorkBackfill[],
): ReleaseWorkBackfillPlan {
  const alreadyLinkedReleaseIds = releases
    .filter((release) => Boolean(release.workId))
    .map((release) => release.id)
    .sort();
  const unlinked = releases.filter((release) => !release.workId);
  const candidateIds = new Map<string, string[]>();
  const artistsByGroupId = new Map<string, Set<string>>();

  for (const release of unlinked) {
    const ids = extractMusicBrainzReleaseGroupIds(release);
    candidateIds.set(release.id, ids);
    for (const id of ids) {
      const artists = artistsByGroupId.get(id) ?? new Set<string>();
      artists.add(release.artistId);
      artistsByGroupId.set(id, artists);
    }
  }

  const grouped = new Map<string, {
    musicBrainzReleaseGroupId: string | null;
    releases: LegacyReleaseForWorkBackfill[];
  }>();
  const conflicts: ReleaseWorkBackfillPlan["conflicts"] = [];

  for (const release of unlinked) {
    const ids = candidateIds.get(release.id) ?? [];
    const crossesArtists = ids.length === 1 && (artistsByGroupId.get(ids[0]!)?.size ?? 0) > 1;
    const canGroup = ids.length === 1 && !crossesArtists;
    const key = canGroup
      ? `musicbrainz-release-group:${ids[0]}`
      : `legacy-release:${release.id}`;
    if (ids.length > 1) {
      conflicts.push({ releaseId: release.id, reason: "multiple-release-groups", releaseGroupIds: ids });
    } else if (crossesArtists) {
      conflicts.push({ releaseId: release.id, reason: "release-group-crosses-artists", releaseGroupIds: ids });
    }
    const group = grouped.get(key) ?? {
      musicBrainzReleaseGroupId: canGroup ? ids[0]! : null,
      releases: [],
    };
    group.releases.push(release);
    grouped.set(key, group);
  }

  const groups = [...grouped.entries()].map(([key, group]) => ({
    key,
    musicBrainzReleaseGroupId: group.musicBrainzReleaseGroupId,
    releases: group.releases.sort((left, right) => left.id.localeCompare(right.id)),
    representative: representativeRelease(group.releases),
    originalReleaseDate: earliestDate(group.releases),
  })).sort((left, right) => left.key.localeCompare(right.key));

  return { groups, alreadyLinkedReleaseIds, conflicts };
}

export function deriveReleaseCoverBackfill(
  release: LegacyReleaseForWorkBackfill,
) {
  const evidence = asRecord(release.verificationEvidence);
  const evidenceProvider = asString(evidence?.coverProvider);
  const evidenceCheckedAt = validDate(asString(evidence?.coverCheckedAt));
  const coverSource = release.sources.find((source) =>
    source.description === coverSourceDescription && /^https?:\/\//i.test(source.url));
  const hasCover = Boolean(release.coverImageUrl?.trim());
  const status = release.verificationStatus === "VERIFIED" && hasCover
    ? "VALID" as const
    : release.coverStatus && release.coverStatus !== "MISSING"
      ? release.coverStatus
      : hasCover ? "QUEUED" as const : "MISSING" as const;

  return {
    coverStatus: status,
    coverProvider: release.coverProvider ?? evidenceProvider,
    coverCheckedAt: validDate(release.coverCheckedAt) ?? evidenceCheckedAt,
    coverImageSourceUrl: release.coverImageSourceUrl ?? coverSource?.url ?? null,
  };
}

function parsePartialDate(value: unknown) {
  if (typeof value !== "string") return { date: null, precision: null } as const;
  const match = value.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return { date: null, precision: null } as const;
  const precision = match[3] ? "DAY" as const : match[2] ? "MONTH" as const : "YEAR" as const;
  const normalized = `${match[1]}-${match[2] ?? "01"}-${match[3] ?? "01"}T00:00:00.000Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? { date: null, precision: null } as const
    : { date, precision };
}

function candidateKeyFromEvidence(evidence: JsonRecord, fallback: string) {
  const releaseGroupId = asString(evidence.releaseGroupId);
  if (releaseGroupId) return `release-group-${releaseGroupId}`;
  const sourceId = asString(evidence.sourceId);
  return sourceId ? `release-${sourceId}` : fallback;
}

function validReleaseCategory(value: unknown): ReleaseCategory | null {
  return typeof value === "string" && releaseCategories.has(value as ReleaseCategory)
    ? value as ReleaseCategory
    : null;
}

function warningReasonCounts(rawResult: JsonRecord | null, verificationSummary: JsonRecord | null) {
  const counts: JsonRecord = {};
  const evidence = asRecord(rawResult?.evidence);
  const warnings = Array.isArray(evidence?.warnings) ? evidence.warnings : [];
  for (const warningValue of warnings) {
    const warning = asRecord(warningValue);
    const code = asString(warning?.code);
    if (code) counts[code] = asNonNegativeInteger(warning?.count);
  }
  if (verificationSummary) {
    for (const [key, value] of Object.entries(verificationSummary)) {
      if (typeof value === "number" && Number.isFinite(value)) counts[`verification.${key}`] = value;
    }
  }
  counts.LEGACY_DETAIL_NOT_RECORDED = true;
  return counts;
}

export function planLegacyResearchTask(task: LegacyTaskForAuditBackfill): LegacyResearchTaskPlan {
  const rawResult = asRecord(task.rawResult);
  const parsedResult = asRecord(task.parsedResult);
  const evidenceBundle = asRecord(rawResult?.evidence);
  const stats = asRecord(evidenceBundle?.stats);
  const verificationSummary = asRecord(rawResult?.verificationSummary) ??
    asRecord(parsedResult?.verificationSummary);
  const rawRows = Array.isArray(evidenceBundle?.releases) ? evidenceBundle.releases : [];
  const finalRows = Array.isArray(parsedResult?.releases) ? parsedResult.releases : [];
  const finalById = new Map<string, JsonRecord>();
  for (const value of finalRows) {
    const row = asRecord(value);
    const id = asString(row?.id);
    if (row && id) finalById.set(id, row);
  }

  const candidates = new Map<string, LegacyResearchCandidatePlan>();
  const addCandidate = (candidateKey: string, evidence: JsonRecord | null, final: JsonRecord | null) => {
    const verification = asRecord(final?.verification);
    const accepted = Boolean(
      verificationSummary &&
      verification?.status === "VERIFIED" &&
      verification?.aiDecision === "ACCEPT",
    );
    const date = parsePartialDate(
      final?.originalReleaseDate ?? final?.releaseDate ?? evidence?.date,
    );
    const coverImageUrl = asString(final?.coverImageUrl) ?? asString(evidence?.coverUrl);
    const coverImageSourceUrl = asString(final?.coverImageSourceUrl) ?? asString(evidence?.coverSourceUrl);
    const releaseGroupId = asString(evidence?.releaseGroupId) ??
      (candidateKey.startsWith("release-group-") ? candidateKey.slice("release-group-".length) : null);
    const coverCheckedAt = validDate(asString(verification?.coverCheckedAt));
    candidates.set(candidateKey, {
      candidateKey,
      entityKind: releaseGroupId ? "WORK" : "EDITION",
      sourceProvider: evidence ? "musicbrainz" : null,
      sourceRecordId: asString(evidence?.sourceId),
      title: asString(final?.title) ?? asString(evidence?.title) ?? "Legacy candidate",
      category: validReleaseCategory(final?.category),
      releaseDate: date.date,
      datePrecision: date.precision,
      catalogNumber: asString(final?.catalogNumber) ?? asString(evidence?.catalogNumber),
      barcode: asString(final?.barcode) ?? asString(evidence?.barcode),
      payload: {
        legacyEvidence: evidence,
        legacyFinal: final,
        auditCompleteness: "aggregate-only",
      },
      disposition: accepted ? "ACCEPTED" : "DEFERRED",
      finalReasonCode: accepted ? "LEGACY_VERIFIED_ACCEPT" : "LEGACY_DETAIL_NOT_RECORDED",
      retryable: !accepted,
      coverImageUrl,
      coverImageSourceUrl,
      coverStatus: accepted && coverImageUrl ? "VALID" : coverImageUrl ? "QUEUED" : "MISSING",
      coverProvider: asString(verification?.coverProvider),
      coverCheckedAt,
    });
  };

  rawRows.forEach((value, index) => {
    const item = asRecord(value);
    const evidence = asRecord(item?.evidence);
    if (!evidence) return;
    const candidateKey = candidateKeyFromEvidence(evidence, `legacy-evidence-${index + 1}`);
    addCandidate(candidateKey, evidence, finalById.get(candidateKey) ?? null);
  });
  for (const [candidateKey, final] of finalById) {
    if (!candidates.has(candidateKey)) addCandidate(candidateKey, null, final);
  }

  let request: JsonRecord | null = null;
  try {
    request = asRecord(JSON.parse(task.query));
  } catch {
    request = null;
  }

  const candidateValues = [...candidates.values()].sort((left, right) =>
    left.candidateKey.localeCompare(right.candidateKey));
  const passedCount = candidateValues.filter((candidate) => candidate.disposition === "ACCEPTED").length;
  const rawCount = asNonNegativeInteger(verificationSummary?.rawReleases) ||
    asNonNegativeInteger(stats?.releasesFetched) || candidateValues.length;
  const mergedCount = Math.min(
    asNonNegativeInteger(stats?.releasesDeduplicated),
    Math.max(0, rawCount - passedCount),
  );
  const inputCount = Math.max(rawCount, passedCount + mergedCount);
  const deferredCount = Math.max(0, inputCount - passedCount - mergedCount);

  return {
    request,
    candidates: candidateValues,
    stageSummary: {
      inputCount,
      passedCount,
      deferredCount,
      rejectedCount: 0,
      mergedCount,
      retryCount: 0,
      reasonCounts: warningReasonCounts(rawResult, verificationSummary),
      detailsComplete: false,
    },
  };
}

function workVerificationData(group: ReleaseWorkBackfillGroup) {
  const verified = group.releases
    .filter((release) => release.verificationStatus === "VERIFIED")
    .sort((left, right) => {
      const leftDate = validDate(left.verifiedAt)?.getTime() ?? 0;
      const rightDate = validDate(right.verifiedAt)?.getTime() ?? 0;
      return rightDate - leftDate;
    })[0] ?? null;
  return {
    verificationStatus: verified ? "VERIFIED" as const : "DISCOVERED" as const,
    verifiedAt: validDate(verified?.verifiedAt),
    verificationEvidence: {
      schemaVersion: 1,
      method: "legacy-release-work-backfill",
      inferredOriginalDate: Boolean(group.originalReleaseDate),
      releaseIds: group.releases.map((release) => release.id),
      releaseVerification: verified?.verificationEvidence ?? null,
    },
  };
}

export async function applyReleaseWorkBackfill(
  database: PrismaClient,
  releases: readonly LegacyReleaseForWorkBackfill[],
  tasks: readonly LegacyTaskForAuditBackfill[],
) {
  const workPlan = buildReleaseWorkBackfillPlan(releases);
  const summary = {
    worksCreated: 0,
    releasesLinked: 0,
    candidatesUpserted: 0,
    decisionsUpserted: 0,
    stageSummariesUpserted: 0,
    conflicts: workPlan.conflicts.length,
  };

  await database.$transaction(async (transaction) => {
    for (const group of workPlan.groups) {
      const verification = workVerificationData(group);
      let work = group.musicBrainzReleaseGroupId
        ? await transaction.releaseWork.findUnique({
            where: { musicBrainzReleaseGroupId: group.musicBrainzReleaseGroupId },
          })
        : null;
      if (work && work.artistId !== group.representative.artistId) {
        throw new Error(`MusicBrainz release group ${group.musicBrainzReleaseGroupId} crosses artists.`);
      }
      if (!work) {
        work = await transaction.releaseWork.create({
          data: {
            artistId: group.representative.artistId,
            title: group.representative.title,
            category: group.representative.category,
            originalReleaseDate: group.originalReleaseDate,
            originalDatePrecision: group.originalReleaseDate ? "DAY" : null,
            musicBrainzReleaseGroupId: group.musicBrainzReleaseGroupId,
            verificationStatus: verification.verificationStatus,
            verificationEvidence: jsonInput(verification.verificationEvidence),
            verifiedAt: verification.verifiedAt,
          },
        });
        summary.worksCreated += 1;
      }

      if (group.musicBrainzReleaseGroupId) {
        const sourceUrl = `https://musicbrainz.org/release-group/${group.musicBrainzReleaseGroupId}`;
        const existingSource = await transaction.releaseWorkSource.findFirst({
          where: { workId: work.id, provider: "musicbrainz", externalId: group.musicBrainzReleaseGroupId },
          select: { id: true },
        });
        if (!existingSource) {
          await transaction.releaseWorkSource.create({
            data: {
              workId: work.id,
              provider: "musicbrainz",
              role: "identity",
              externalId: group.musicBrainzReleaseGroupId,
              url: sourceUrl,
              label: "MusicBrainz release group",
            },
          });
        }
      }

      for (const release of group.releases) {
        const editionReleaseDate = validDate(release.editionReleaseDate) ??
          validDate(release.originalReleaseDate);
        await transaction.release.update({
          where: { id: release.id },
          data: {
            workId: work.id,
            editionReleaseDate,
            editionDatePrecision: editionReleaseDate
              ? release.editionDatePrecision ?? "DAY"
              : null,
            ...deriveReleaseCoverBackfill(release),
          },
        });
        summary.releasesLinked += 1;
      }
    }

    for (const task of tasks) {
      const plan = planLegacyResearchTask(task);
      for (const candidate of plan.candidates) {
        const row = await transaction.researchCandidate.upsert({
          where: {
            taskId_candidateKey: {
              taskId: task.id,
              candidateKey: candidate.candidateKey,
            },
          },
          update: {},
          create: {
            taskId: task.id,
            candidateKey: candidate.candidateKey,
            entityKind: candidate.entityKind,
            sourceProvider: candidate.sourceProvider,
            sourceRecordId: candidate.sourceRecordId,
            title: candidate.title,
            category: candidate.category,
            releaseDate: candidate.releaseDate,
            datePrecision: candidate.datePrecision,
            catalogNumber: candidate.catalogNumber,
            barcode: candidate.barcode,
            payload: jsonInput(candidate.payload),
            disposition: candidate.disposition,
            lastStage: "legacy-pipeline",
            finalReasonCode: candidate.finalReasonCode,
            retryable: candidate.retryable,
            coverImageUrl: candidate.coverImageUrl,
            coverImageSourceUrl: candidate.coverImageSourceUrl,
            coverStatus: candidate.coverStatus,
            coverProvider: candidate.coverProvider,
            coverCheckedAt: candidate.coverCheckedAt,
          },
        });
        summary.candidatesUpserted += 1;
        const decision = await transaction.researchDecision.upsert({
          where: { candidateId_sequence: { candidateId: row.id, sequence: 0 } },
          update: {},
          create: {
            candidateId: row.id,
            sequence: 0,
            stage: "legacy-pipeline",
            outcome: candidate.disposition === "ACCEPTED" ? "PASS" : "DEFER",
            reasonCode: candidate.finalReasonCode,
            retryable: candidate.retryable,
            evidence: jsonInput({ detailsComplete: false, legacyTaskStatus: task.status }),
          },
        });
        if (decision) summary.decisionsUpserted += 1;
      }

      await transaction.researchStageSummary.upsert({
        where: { taskId_stage: { taskId: task.id, stage: "legacy-pipeline" } },
        update: {},
        create: {
          taskId: task.id,
          stage: "legacy-pipeline",
          sequence: 0,
          ...plan.stageSummary,
          reasonCounts: jsonInput(plan.stageSummary.reasonCounts),
          startedAt: task.createdAt,
          completedAt: ["SUCCEEDED", "FAILED"].includes(task.status) ? task.updatedAt : null,
        },
      });
      summary.stageSummariesUpserted += 1;
      await transaction.aiSearchTask.update({
        where: { id: task.id },
        data: {
          request: plan.request ? jsonInput(plan.request) : undefined,
          progress: ["SUCCEEDED", "FAILED"].includes(task.status) ? 100 : undefined,
          stage: ["SUCCEEDED", "FAILED"].includes(task.status) ? "legacy-pipeline-backfilled" : undefined,
          startedAt: task.createdAt,
          completedAt: ["SUCCEEDED", "FAILED"].includes(task.status) ? task.updatedAt : undefined,
        },
      });
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  return summary;
}

async function runCli() {
  const apply = process.argv.includes("--apply");
  const envPath = path.resolve(process.cwd(), ".env.local");
  loadDotEnv({ path: envPath, override: false, quiet: true });
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Configure it in the ignored .env.local file before running this backfill.",
    );
  }
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const releases = await database.release.findMany({
      orderBy: [{ artistId: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        artistId: true,
        title: true,
        category: true,
        originalReleaseDate: true,
        editionReleaseDate: true,
        editionDatePrecision: true,
        workId: true,
        coverImageUrl: true,
        coverImageSourceUrl: true,
        coverStatus: true,
        coverProvider: true,
        coverCheckedAt: true,
        verificationStatus: true,
        verificationEvidence: true,
        verifiedAt: true,
        sources: {
          select: { url: true, label: true, description: true },
        },
      },
    });
    const tasks = await database.aiSearchTask.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        query: true,
        rawResult: true,
        parsedResult: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const workPlan = buildReleaseWorkBackfillPlan(releases);

    if (!apply) {
      process.stdout.write(`${JSON.stringify({
        mode: "dry-run",
        releases: releases.length,
        plannedWorks: workPlan.groups.length,
        alreadyLinked: workPlan.alreadyLinkedReleaseIds.length,
        conflicts: workPlan.conflicts,
        legacyTasks: tasks.length,
        legacyCandidates: tasks.reduce((count, task) =>
          count + planLegacyResearchTask(task).candidates.length, 0),
      }, null, 2)}\n`);
      return;
    }

    const summary = await applyReleaseWorkBackfill(database, releases, tasks);
    process.stdout.write(`${JSON.stringify({ mode: "apply", ...summary }, null, 2)}\n`);
  } finally {
    await database.$disconnect();
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) void runCli();
