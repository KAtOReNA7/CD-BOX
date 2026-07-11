import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotEnv } from "dotenv";
import type {
  CollectionStatus,
  Prisma,
  ReleaseCategory,
  ReleaseFormat,
} from "@prisma/client";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
} from "@/lib/ai/release-research-types";
import {
  isAllowedVerifiedCoverAssetUrl,
  isAllowedVerifiedCoverSourceUrl,
} from "@/lib/ai/cover-asset-validation";
import {
  COVER_IMAGE_SOURCE_DESCRIPTION,
} from "@/lib/releases/cover-source";

export type ExistingReleaseForBackfill = {
  id: string;
  title: string;
  originalCatalogNo: string | null;
  originalReleaseDate: Date | string | null;
  coverImageUrl: string | null;
  updatedAt?: Date | string | null;
  userStatus?: Array<{ userId: string; status: CollectionStatus }>;
};

export type VerifiedBackfillMatch = {
  release: ExistingReleaseForBackfill;
  candidate: ReleaseResearchCandidate;
  matchedBy: "catalog-number" | "title-and-date";
};

export type BackfillCoverConflict = VerifiedBackfillMatch & {
  existingCoverImageUrl: string;
  verifiedCoverImageUrl: string;
};

export type VerifiedBackfillPlan = {
  matches: VerifiedBackfillMatch[];
  coverConflicts: BackfillCoverConflict[];
  unmatchedReleaseIds: string[];
  eligibleCandidateCount: number;
};

type CurrentReleaseMetadata = ExistingReleaseForBackfill & {
  category: ReleaseCategory;
  format: ReleaseFormat;
  label: string | null;
  originalPrice: string | null;
  editionType: string | null;
  isReissue: boolean;
  isRemaster: boolean;
};

export type VerifiedSourceRow = {
  url: string;
  label: string;
  description: string;
};

export function normalizeCatalogNumber(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeReleaseTitle(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

export function normalizeReleaseDate(value: Date | string | null | undefined) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

function candidateIsEligible(candidate: ReleaseResearchCandidate) {
  const verification = candidate.verification;
  const coverProvider = verification?.coverProvider;
  const sourceUrls = candidate.sources.map((source) => source.url);
  return verification?.status === "VERIFIED" &&
    verification.method === "musicbrainz-ndl-discogs-ai" &&
    verification.aiDecision === "ACCEPT" &&
    Boolean(coverProvider && candidate.coverImageUrl &&
      isAllowedVerifiedCoverAssetUrl(candidate.coverImageUrl, coverProvider)) &&
    Boolean(coverProvider && candidate.coverImageSourceUrl &&
      isAllowedVerifiedCoverSourceUrl(candidate.coverImageSourceUrl, coverProvider)) &&
    candidate.confidence === "HIGH" &&
    sourceUrls.some((url) => /^https:\/\/musicbrainz\.org\/release-group\/[0-9a-f-]+$/i.test(url)) &&
    sourceUrls.some((url) => /^https:\/\/musicbrainz\.org\/release\/[0-9a-f-]+$/i.test(url)) &&
    sourceUrls.some((url) => /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/i.test(url)) &&
    sourceUrls.some((url) => /^https:\/\/www\.discogs\.com\/release\/\d+$/i.test(url)) &&
    verification.sourceUrls.length >= 4 &&
    verification.sourceUrls.every((url) => sourceUrls.includes(url)) &&
    isFreshEvidenceTime(verification.checkedAt) &&
    isFreshEvidenceTime(verification.coverCheckedAt);
}

function isFreshEvidenceTime(value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    timestamp <= now + 5 * 60_000 &&
    timestamp >= now - 7 * 24 * 60 * 60_000;
}

function indexCandidates(
  candidates: readonly ReleaseResearchCandidate[],
  keyOf: (candidate: ReleaseResearchCandidate) => string,
) {
  const index = new Map<string, ReleaseResearchCandidate[]>();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (!key) continue;
    const values = index.get(key) ?? [];
    values.push(candidate);
    index.set(key, values);
  }
  return index;
}

function indexCandidatesByManyKeys(
  candidates: readonly ReleaseResearchCandidate[],
  keysOf: (candidate: ReleaseResearchCandidate) => readonly string[],
) {
  const index = new Map<string, ReleaseResearchCandidate[]>();
  for (const candidate of candidates) {
    for (const key of new Set(keysOf(candidate).filter(Boolean))) {
      const values = index.get(key) ?? [];
      values.push(candidate);
      index.set(key, values);
    }
  }
  return index;
}

function titleAndDateKey(title: string | null | undefined, date: Date | string | null | undefined) {
  const normalizedTitle = normalizeReleaseTitle(title);
  const normalizedDate = normalizeReleaseDate(date);
  return normalizedTitle && normalizedDate ? `${normalizedTitle}|${normalizedDate}` : "";
}

function coverConflict(
  release: ExistingReleaseForBackfill,
  candidate: ReleaseResearchCandidate,
) {
  const existing = release.coverImageUrl?.trim() ?? "";
  const verified = candidate.coverImageUrl?.trim() ?? "";
  return existing && existing !== verified
    ? { existingCoverImageUrl: existing, verifiedCoverImageUrl: verified }
    : null;
}

function unchangedSincePlan(
  current: ExistingReleaseForBackfill,
  planned: ExistingReleaseForBackfill,
) {
  const currentUpdatedAt = current.updatedAt ? new Date(current.updatedAt).getTime() : null;
  const plannedUpdatedAt = planned.updatedAt ? new Date(planned.updatedAt).getTime() : null;
  if (currentUpdatedAt !== null && plannedUpdatedAt !== null) {
    return Number.isFinite(currentUpdatedAt) && currentUpdatedAt === plannedUpdatedAt;
  }
  return current.title === planned.title &&
    current.originalCatalogNo === planned.originalCatalogNo &&
    normalizeReleaseDate(current.originalReleaseDate) === normalizeReleaseDate(planned.originalReleaseDate) &&
    current.coverImageUrl === planned.coverImageUrl;
}

/**
 * Produces a one-to-one, fail-closed plan. A candidate key must be unique and
 * a candidate may be claimed by only one existing release in each match pass.
 */
export function planVerifiedLibraryBackfill(
  releases: readonly ExistingReleaseForBackfill[],
  candidates: readonly ReleaseResearchCandidate[],
): VerifiedBackfillPlan {
  const eligibleCandidates = candidates.filter(candidateIsEligible);
  const catalogIndex = indexCandidates(
    eligibleCandidates,
    (candidate) => normalizeCatalogNumber(candidate.catalogNumber),
  );
  const titleDateIndex = indexCandidatesByManyKeys(
    eligibleCandidates,
    (candidate) => [candidate.title, candidate.titleOriginal]
      .map((title) => titleAndDateKey(
        title,
        candidate.originalReleaseDate ?? candidate.releaseDate,
      )),
  );
  const unresolved = new Map(releases.map((release) => [release.id, release]));
  const usedCandidateIds = new Set<string>();
  const matches: VerifiedBackfillMatch[] = [];
  const coverConflicts: BackfillCoverConflict[] = [];

  const matchPass = (
    matchedBy: VerifiedBackfillMatch["matchedBy"],
    index: ReadonlyMap<string, ReleaseResearchCandidate[]>,
    keyOf: (release: ExistingReleaseForBackfill) => string,
  ) => {
    const claims = new Map<string, Array<{
      release: ExistingReleaseForBackfill;
      candidate: ReleaseResearchCandidate;
    }>>();

    for (const release of unresolved.values()) {
      const key = keyOf(release);
      const indexed = key ? index.get(key) : undefined;
      if (!indexed || indexed.length !== 1) continue;
      const candidate = indexed[0];
      if (usedCandidateIds.has(candidate.id)) continue;
      const values = claims.get(candidate.id) ?? [];
      values.push({ release, candidate });
      claims.set(candidate.id, values);
    }

    for (const [candidateId, values] of claims) {
      if (values.length !== 1) continue;
      const { release, candidate } = values[0];
      unresolved.delete(release.id);
      usedCandidateIds.add(candidateId);
      const conflict = coverConflict(release, candidate);
      const match = { release, candidate, matchedBy };
      if (conflict) {
        coverConflicts.push({ ...match, ...conflict });
      } else {
        matches.push(match);
      }
    }
  };

  matchPass(
    "catalog-number",
    catalogIndex,
    (release) => normalizeCatalogNumber(release.originalCatalogNo),
  );
  matchPass(
    "title-and-date",
    titleDateIndex,
    (release) => titleAndDateKey(release.title, release.originalReleaseDate),
  );

  return {
    matches,
    coverConflicts,
    unmatchedReleaseIds: [...unresolved.keys()],
    eligibleCandidateCount: eligibleCandidates.length,
  };
}

export function collectionStatusAfterVerification(status: CollectionStatus): CollectionStatus {
  return status === "PENDING_REVIEW" ? "NOT_OWNED" : status;
}

function normalizeReleaseFormat(value: string | null): ReleaseFormat {
  const format = (value ?? "CD").normalize("NFKC").toUpperCase();
  if (format.includes("SHM")) return "SHM_CD";
  if (format.includes("BLU")) return "BLU_SPEC_CD";
  if (format.includes("HYBRID")) return "HYBRID_SACD";
  if (format.includes("SACD")) return "SACD";
  if (format.includes("DVD")) return "CD_DVD";
  if (format.includes("BOX")) return "BOX_SET";
  if (format.includes("CD")) return "CD";
  return "OTHER";
}

function verifiedDate(candidate: ReleaseResearchCandidate) {
  const value = candidate.originalReleaseDate ?? candidate.releaseDate;
  const normalized = normalizeReleaseDate(value);
  return normalized ? new Date(`${normalized}T00:00:00.000Z`) : null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Builds metadata only. In particular, neither Release.notes nor user notes exist in this update. */
export function buildVerifiedReleaseUpdate(
  current: CurrentReleaseMetadata,
  candidate: ReleaseResearchCandidate,
): Prisma.ReleaseUncheckedUpdateInput {
  if (!candidateIsEligible(candidate)) {
    throw new TypeError("Only a fully verified candidate can be used for a library backfill.");
  }
  const checkedAt = new Date(candidate.verification!.checkedAt);
  const data: Prisma.ReleaseUncheckedUpdateInput = {
    category: candidate.category,
    title: candidate.title,
    format: candidate.format ? normalizeReleaseFormat(candidate.format) : current.format,
    isReissue: candidate.isReissue ?? current.isReissue,
    isRemaster: candidate.isRemaster ?? current.isRemaster,
    isExcludedByDefault: candidate.isExcludedByDefault,
    confidence: candidate.confidence,
    warnings: jsonInput(candidate.warnings),
    verificationStatus: "VERIFIED",
    verificationEvidence: jsonInput(candidate.verification),
    verifiedAt: checkedAt,
  };

  const releaseDate = verifiedDate(candidate);
  if (releaseDate) data.originalReleaseDate = releaseDate;
  if (candidate.catalogNumber !== null) data.originalCatalogNo = candidate.catalogNumber;
  if (candidate.label !== null) data.label = candidate.label;
  if (candidate.originalPrice !== null) data.originalPrice = candidate.originalPrice;
  if (candidate.editionType !== null) data.editionType = candidate.editionType;
  if (!current.coverImageUrl?.trim()) data.coverImageUrl = candidate.coverImageUrl;
  return data;
}

function safeHttpsUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}

export function buildVerifiedSourceRows(candidate: ReleaseResearchCandidate): VerifiedSourceRow[] {
  const rows = new Map<string, VerifiedSourceRow>();
  for (const source of candidate.sources) {
    const url = safeHttpsUrl(source.url);
    const key = url ? `${url}\u0000evidence` : "";
    if (!url || rows.has(key)) continue;
    rows.set(key, {
      url,
      label: source.title,
      description: `Verified ${source.sourceType} source`,
    });
  }
  for (const value of candidate.verification?.sourceUrls ?? []) {
    const url = safeHttpsUrl(value);
    const key = url ? `${url}\u0000evidence` : "";
    if (!url || rows.has(key)) continue;
    rows.set(key, {
      url,
      label: "Verification source",
      description: "Source used by the cross-source verification gate",
    });
  }
  const coverSource = safeHttpsUrl(candidate.coverImageSourceUrl);
  if (coverSource) {
    rows.set(`${coverSource}\u0000cover`, {
      url: coverSource,
      label: "Verified cover source",
      description: COVER_IMAGE_SOURCE_DESCRIPTION,
    });
  }
  return [...rows.values()];
}

type BackfillSummary = {
  mode: "dry-run" | "apply";
  artistsScanned: number;
  artistsSucceeded: number;
  artistsFailed: number;
  releasesScanned: number;
  verifiedCandidates: number;
  matchedByCatalog: number;
  matchedByTitleAndDate: number;
  coverConflicts: number;
  unmatched: number;
  wouldUpdate: number;
  updated: number;
  sourcesWouldAdd: number;
  sourcesAdded: number;
  statusesWouldChange: number;
  statusesChanged: number;
  concurrentSkips: number;
  fatalFailures: number;
  failures: Array<{ artistId: string | null; artistName: string | null; reason: string }>;
};

function safeFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown backfill failure.";
  return message
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, "[redacted-key]")
    .replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function emptySummary(apply: boolean): BackfillSummary {
  return {
    mode: apply ? "apply" : "dry-run",
    artistsScanned: 0,
    artistsSucceeded: 0,
    artistsFailed: 0,
    releasesScanned: 0,
    verifiedCandidates: 0,
    matchedByCatalog: 0,
    matchedByTitleAndDate: 0,
    coverConflicts: 0,
    unmatched: 0,
    wouldUpdate: 0,
    updated: 0,
    sourcesWouldAdd: 0,
    sourcesAdded: 0,
    statusesWouldChange: 0,
    statusesChanged: 0,
    concurrentSkips: 0,
    fatalFailures: 0,
    failures: [],
  };
}

function fallbackRequest(artist: { name: string; country: string | null }): ReleaseResearchRequest {
  return {
    artistName: artist.name,
    country: artist.country ?? "JP",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: false,
    includeLiveRemixBest: true,
  };
}

function researchTaskMatchesArtist(
  task: { query: string; parsedResult: unknown },
  artistName: string,
) {
  const expected = normalizeReleaseTitle(artistName);
  if (!expected) return false;
  const parsed = task.parsedResult;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "artist" in parsed) {
    const artist = parsed.artist;
    if (artist && typeof artist === "object" && !Array.isArray(artist)) {
      const values = ["name", "nameKana", "nameRomaji"].map((key) =>
        key in artist && typeof artist[key as keyof typeof artist] === "string"
          ? artist[key as keyof typeof artist] as string
          : "");
      if (values.some((value) => normalizeReleaseTitle(value) === expected)) return true;
    }
  }
  try {
    const query = JSON.parse(task.query) as { artistName?: unknown };
    return typeof query.artistName === "string" && normalizeReleaseTitle(query.artistName) === expected;
  } catch {
    return false;
  }
}

function countMissingSources(
  existing: readonly { url: string; description: string | null }[],
  candidate: ReleaseResearchCandidate,
) {
  const keys = new Set(existing.map((source) =>
    `${source.url.trim()}\u0000${source.description === COVER_IMAGE_SOURCE_DESCRIPTION ? "cover" : "evidence"}`));
  return buildVerifiedSourceRows(candidate).filter((source) => !keys.has(
    `${source.url}\u0000${source.description === COVER_IMAGE_SOURCE_DESCRIPTION ? "cover" : "evidence"}`,
  )).length;
}

async function runCli() {
  const apply = process.argv.slice(2).includes("--apply");
  const summary = emptySummary(apply);
  let database: (typeof import("@/lib/db/prisma"))["prisma"] | null = null;

  try {
    if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
      throw new TypeError("Unknown command-line argument.");
    }
    loadDotEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
    const [databaseModule, researchModule, verificationModule, inputModule, coverModule] = await Promise.all([
      import("@/lib/db/prisma"),
      import("@/lib/ai/public-metadata-research"),
      import("@/lib/ai/verified-discography"),
      import("@/lib/ai/release-research-input"),
      import("@/lib/ai/cover-asset-validation"),
    ]);
    database = databaseModule.prisma;

    const recentResearchTasks = await database.aiSearchTask.findMany({
      where: { status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { query: true, parsedResult: true },
    });

    const artists = await database.artist.findMany({
      where: { releases: { some: { verificationStatus: "UNVERIFIED" } } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        country: true,
        aiSearchTasks: {
          where: { status: "SUCCEEDED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { query: true },
        },
        releases: {
          where: { verificationStatus: "UNVERIFIED" },
          orderBy: { id: "asc" },
          select: {
            id: true,
            title: true,
            category: true,
            originalReleaseDate: true,
            format: true,
            originalCatalogNo: true,
            label: true,
            originalPrice: true,
            editionType: true,
            isReissue: true,
            isRemaster: true,
            coverImageUrl: true,
            updatedAt: true,
            sources: { select: { url: true, description: true } },
            userStatus: { select: { userId: true, status: true } },
          },
        },
      },
    });
    summary.artistsScanned = artists.length;

    for (const artist of artists) {
      summary.releasesScanned += artist.releases.length;
      try {
        let request = fallbackRequest(artist);
        const storedQuery = artist.aiSearchTasks[0]?.query ?? recentResearchTasks.find((task) =>
          researchTaskMatchesArtist(task, artist.name))?.query;
        if (storedQuery) {
          try {
            const stored = inputModule.parseReleaseResearchRequest(JSON.parse(storedQuery));
            request = inputModule.parseReleaseResearchRequest({
              ...stored,
              country: stored.country || artist.country || "JP",
            });
          } catch {
            request = fallbackRequest(artist);
          }
        }

        const publicMetadata = await researchModule.researchPublicMetadataReleases(request);
        const verified = await verificationModule.verifyDiscographyResult(
          request,
          publicMetadata.result,
          publicMetadata.evidence,
        );
        const plan = planVerifiedLibraryBackfill(artist.releases, verified.releases);
        const replaceableCoverUrls = new Map<string, string>();
        const recoverableCoverMatches: VerifiedBackfillMatch[] = [];
        for (const conflict of plan.coverConflicts) {
          const checked = await coverModule.validateCoverAsset(conflict.existingCoverImageUrl);
          if (!checked.ok && !checked.retryable) {
            replaceableCoverUrls.set(conflict.release.id, conflict.existingCoverImageUrl);
            recoverableCoverMatches.push({
              release: conflict.release,
              candidate: conflict.candidate,
              matchedBy: conflict.matchedBy,
            });
          }
        }
        const effectiveMatches = [...plan.matches, ...recoverableCoverMatches];
        summary.verifiedCandidates += plan.eligibleCandidateCount;
        summary.matchedByCatalog += effectiveMatches.filter((match) =>
          match.matchedBy === "catalog-number").length;
        summary.matchedByTitleAndDate += effectiveMatches.filter((match) =>
          match.matchedBy === "title-and-date").length;
        summary.coverConflicts += plan.coverConflicts.length - recoverableCoverMatches.length;
        summary.unmatched += plan.unmatchedReleaseIds.length;

        if (!apply) {
          summary.wouldUpdate += effectiveMatches.length;
          for (const match of effectiveMatches) {
            const current = artist.releases.find((release) => release.id === match.release.id)!;
            summary.sourcesWouldAdd += countMissingSources(current.sources, match.candidate);
            summary.statusesWouldChange += current.userStatus.filter((status) =>
              collectionStatusAfterVerification(status.status) !== status.status).length;
          }
          summary.artistsSucceeded += 1;
          continue;
        }

        const transactionResult = await database.$transaction(async (transaction) => {
          let updated = 0;
          let sourcesAdded = 0;
          let statusesChanged = 0;
          let coverConflicts = 0;
          let concurrentSkips = 0;

          for (const match of effectiveMatches) {
            const current = await transaction.release.findUnique({
              where: { id: match.release.id },
              select: {
                id: true,
                title: true,
                category: true,
                originalReleaseDate: true,
                format: true,
                originalCatalogNo: true,
                label: true,
                originalPrice: true,
                editionType: true,
                isReissue: true,
                isRemaster: true,
                coverImageUrl: true,
                updatedAt: true,
                verificationStatus: true,
                sources: { select: { url: true, description: true } },
              },
            });
            if (!current || current.verificationStatus !== "UNVERIFIED") {
              concurrentSkips += 1;
              continue;
            }
            if (!unchangedSincePlan(current, match.release)) {
              concurrentSkips += 1;
              continue;
            }
            const conflict = coverConflict(current, match.candidate);
            const replaceableCoverUrl = replaceableCoverUrls.get(current.id);
            const canReplaceInvalidCover = Boolean(
              conflict &&
              replaceableCoverUrl &&
              current.coverImageUrl === replaceableCoverUrl,
            );
            if (conflict && !canReplaceInvalidCover) {
              coverConflicts += 1;
              continue;
            }

            await transaction.release.update({
              where: { id: current.id },
              data: buildVerifiedReleaseUpdate(
                canReplaceInvalidCover ? { ...current, coverImageUrl: null } : current,
                match.candidate,
              ),
            });
            if (canReplaceInvalidCover) {
              await transaction.releaseSource.deleteMany({
                where: {
                  releaseId: current.id,
                  description: COVER_IMAGE_SOURCE_DESCRIPTION,
                },
              });
            }
            const existingSourceKeys = new Set(current.sources
              .filter((source) => !canReplaceInvalidCover || source.description !== COVER_IMAGE_SOURCE_DESCRIPTION)
              .map((source) =>
                `${source.url.trim()}\u0000${source.description === COVER_IMAGE_SOURCE_DESCRIPTION ? "cover" : "evidence"}`));
            const missingSources = buildVerifiedSourceRows(match.candidate).filter((source) =>
              !existingSourceKeys.has(
                `${source.url}\u0000${source.description === COVER_IMAGE_SOURCE_DESCRIPTION ? "cover" : "evidence"}`,
              ));
            if (missingSources.length > 0) {
              const result = await transaction.releaseSource.createMany({
                data: missingSources.map((source) => ({
                  releaseId: current.id,
                  ...source,
                })),
              });
              sourcesAdded += result.count;
            }
            const statusResult = await transaction.userReleaseStatus.updateMany({
              where: {
                releaseId: current.id,
                userId: { in: match.release.userStatus?.map((status) => status.userId) ?? [] },
                status: "PENDING_REVIEW",
              },
              data: { status: "NOT_OWNED" },
            });
            statusesChanged += statusResult.count;
            updated += 1;
          }
          return { updated, sourcesAdded, statusesChanged, coverConflicts, concurrentSkips };
        }, { maxWait: 5_000, timeout: 60_000 });

        summary.updated += transactionResult.updated;
        summary.sourcesAdded += transactionResult.sourcesAdded;
        summary.statusesChanged += transactionResult.statusesChanged;
        summary.coverConflicts += transactionResult.coverConflicts;
        summary.concurrentSkips += transactionResult.concurrentSkips;
        summary.artistsSucceeded += 1;
      } catch (error) {
        summary.artistsFailed += 1;
        summary.failures.push({
          artistId: artist.id,
          artistName: artist.name,
          reason: safeFailureReason(error),
        });
      }
    }
  } catch (error) {
    summary.fatalFailures += 1;
    summary.failures.push({
      artistId: null,
      artistName: null,
      reason: safeFailureReason(error),
    });
  } finally {
    await database?.$disconnect().catch(() => undefined);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.artistsFailed > 0 || summary.fatalFailures > 0) process.exitCode = 1;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) void runCli();
