import type { AiSearchTask, Prisma, ReleaseFormat } from "@prisma/client";
import { localizedArtistNameUpdate } from "@/lib/artists/localized-artist-name";
import { aiConfig } from "@/lib/ai/client";
import {
  getConfiguredProviderCapabilities,
  sanitizeErrorMessage,
} from "@/lib/ai/provider-capabilities";
import type { AiProviderCapabilitySummary } from "@/lib/ai/provider-capabilities";
import {
  PUBLIC_METADATA_RESEARCH_MODE,
  researchPublicMetadataReleases,
} from "@/lib/ai/public-metadata-research";
import {
  parseReleaseResearchImportInput,
  parseReleaseResearchRequest,
} from "@/lib/ai/release-research-input";
import { verifyDiscographyResult } from "@/lib/ai/verified-discography";
import type {
  AiSearchTaskView,
  ReleaseResearchCandidate,
  ReleaseResearchImportInput,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import { prisma } from "@/lib/db/prisma";
import {
  buildImportedReleaseSourceRows,
  COVER_IMAGE_SOURCE_DESCRIPTION,
} from "@/lib/releases/cover-source";
import {
  isAllowedVerifiedCoverAssetHost,
  isAllowedVerifiedCoverAssetUrl,
  isAllowedVerifiedCoverSourceUrl,
  validateCoverAsset,
} from "@/lib/ai/cover-asset-validation";

function toTaskView(task: AiSearchTask): AiSearchTaskView {
  const progressState = readTaskProgress(task);
  return {
    id: task.id,
    status:
      task.status === "QUEUED"
        ? "pending"
        : task.status === "RUNNING"
          ? "running"
          : task.status === "SUCCEEDED"
            ? "succeeded"
            : "failed",
    ...progressState,
    query: task.query,
    model: task.model,
    errorMessage: task.errorMessage,
    rawResult: task.rawResult,
    parsedResult: task.parsedResult as ReleaseResearchResult | null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function readTaskProgress(task: AiSearchTask) {
  if (task.status === "SUCCEEDED") return { progress: 100, stage: "候选资料已准备完成" };
  if (task.status === "FAILED") return { progress: 100, stage: "任务执行失败" };

  const rawResult = task.rawResult;
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
    return task.status === "QUEUED"
      ? { progress: 5, stage: "等待后台任务启动" }
      : { progress: 15, stage: "正在联网检索发行资料" };
  }

  const progress = "progress" in rawResult && typeof rawResult.progress === "number"
    ? Math.max(0, Math.min(100, rawResult.progress))
    : task.status === "QUEUED" ? 5 : 15;
  const stage = "stage" in rawResult && typeof rawResult.stage === "string"
    ? rawResult.stage
    : task.status === "QUEUED" ? "等待后台任务启动" : "正在联网检索发行资料";

  return { progress, stage };
}

function progressPayload(progress: number, stage: string): Prisma.InputJsonObject {
  return { kind: "research-progress", progress, stage };
}

async function updateResearchProgress(taskId: string, progress: number, stage: string) {
  try {
    await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: { rawResult: progressPayload(progress, stage) },
    });
  } catch (error) {
    console.warn("Unable to persist optional AI research progress.", {
      taskId,
      progress,
      error: error instanceof Error ? error.message : "Unknown database error",
    });
  }
}

function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function assertCanUseOnlineResearch(capabilities: AiProviderCapabilitySummary) {
  if (!capabilities.configurationReady) {
    throw new Error("The AI provider configuration is incomplete. Configure the relay URL, model, and credential first.");
  }
  if (!capabilities.webSearchEnabled) {
    throw new Error("Online release research is disabled. Set AI_ENABLE_WEB_SEARCH=true to allow public-source research.");
  }
}

export function resolveReleaseResearchStrategy(capabilities: AiProviderCapabilitySummary) {
  if (capabilities.responsesSupport === "supported" && capabilities.webSearchSupport === "supported") {
    return { primary: "public-metadata" as const, nativeCapability: "supported" as const };
  }
  if (capabilities.responsesSupport === "unsupported" || capabilities.webSearchSupport === "unsupported") {
    return { primary: "public-metadata" as const, nativeCapability: "unsupported" as const };
  }
  return { primary: "public-metadata" as const, nativeCapability: "unknown" as const };
}

function sanitizedResearchError(error: unknown, apiKeyOverride?: string) {
  return sanitizeErrorMessage(
    error instanceof Error ? error.message : "Release research failed.",
    apiKeyOverride ?? process.env.OPENAI_API_KEY,
  ).slice(0, 2_000);
}

function withPublicFallbackWarning(
  result: ReleaseResearchResult,
  reason: "declared-unsupported" | "verification-required",
) {
  const warning = reason === "declared-unsupported"
    ? "中转站已明确标记为不支持原生 Responses/web_search，本次直接使用公共资料源。"
    : "为执行可审计的最终核验，本次直接使用 MusicBrainz、日本国立国会图书馆国家书目、Discogs 与真实封面来源。";
  return {
    ...result,
    globalWarnings: [...new Set([...result.globalWarnings, warning])],
  };
}

export async function createReleaseResearchTask(input: ReleaseResearchRequest, userId: string) {
  const validatedInput = parseReleaseResearchRequest(input);
  assertCanUseOnlineResearch(getConfiguredProviderCapabilities());

  const activeTask = await prisma.aiSearchTask.findFirst({
    where: {
      userId,
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { gte: new Date(Date.now() - 15 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (activeTask) {
    throw new Error("An online research task is already running. Wait for it to finish before starting another.");
  }

  const recentTaskCount = await prisma.aiSearchTask.count({
    where: {
      userId,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });

  if (recentTaskCount >= 3) {
    throw new Error("Too many online research requests. Wait one minute and try again.");
  }

  const task = await prisma.aiSearchTask.create({
    data: {
      userId,
      query: JSON.stringify(validatedInput),
      model: aiConfig.textModel,
      status: "QUEUED",
      rawResult: progressPayload(5, "等待后台任务启动"),
    },
  });

  return toTaskView(task);
}

export async function createAndRunReleaseResearchTask(
  input: ReleaseResearchRequest,
  userId: string,
  apiKeyOverride?: string,
) {
  const validatedInput = parseReleaseResearchRequest(input);
  const task = await createReleaseResearchTask(validatedInput, userId);
  return runReleaseResearchTask(task.id, validatedInput, apiKeyOverride);
}

export async function runReleaseResearchTask(
  taskId: string,
  input: ReleaseResearchRequest,
  apiKeyOverride?: string,
) {
  const validatedInput = parseReleaseResearchRequest(input);
  const capabilityEnv = apiKeyOverride
    ? {
        ...process.env,
        OPENAI_API_KEY: apiKeyOverride,
      }
    : process.env;
  const capabilities = getConfiguredProviderCapabilities(capabilityEnv);
  assertCanUseOnlineResearch(capabilities);

  await prisma.aiSearchTask.update({
    where: { id: taskId },
    data: {
      status: "RUNNING",
      errorMessage: null,
      rawResult: progressPayload(15, "正在联网检索发行资料"),
    },
  });

  let failureTrace: Prisma.InputJsonObject | null = null;
  try {
    const strategy = resolveReleaseResearchStrategy(capabilities);

    await updateResearchProgress(taskId, 36, "正在查询 MusicBrainz 公共发行资料");
    const publicResearch = await researchPublicMetadataReleases(
      validatedInput,
      apiKeyOverride,
      {
        onEvidenceProgress: async ({ phase, processed, total }) => {
          const phaseBase = phase === "release-groups" ? 36 : phase === "releases" ? 42 : 48;
          const phaseSpan = phase === "covers" ? 10 : 5;
          const ratio = total > 0 ? processed / total : 0;
          const label = phase === "release-groups"
            ? "正在获取完整作品分组"
            : phase === "releases"
              ? "正在获取完整日本 CD 版本"
              : `正在逐张查找 Cover Art Archive 封面（${processed}/${total}）`;
          await updateResearchProgress(taskId, Math.round(phaseBase + ratio * phaseSpan), label);
        },
      },
    );
    const fallbackReason = strategy.nativeCapability === "unsupported"
      ? "declared-unsupported" as const
      : "verification-required" as const;
    const publicResult = withPublicFallbackWarning(publicResearch.result, fallbackReason);
    failureTrace = {
      mode: PUBLIC_METADATA_RESEARCH_MODE,
      fallbackReason: {
        kind: fallbackReason,
        message: null,
      },
      evidence: toJsonSafe(publicResearch.evidence),
      organizerStatus: publicResearch.organizer.status,
      organizerError: publicResearch.organizer.error,
      outputText: publicResearch.organizer.outputText,
      response: publicResearch.organizer.response === null
        ? null
        : toJsonSafe(publicResearch.organizer.response),
    } satisfies Prisma.InputJsonObject;

    if (publicResult.releases.length === 0) {
      throw new Error("Public metadata sources returned no deterministic release candidates.");
    }

    await updateResearchProgress(taskId, 58, "已按作品归并，正在准备独立来源核验");
    const verified = await verifyDiscographyResult(
      validatedInput,
      publicResult,
      publicResearch.evidence,
      apiKeyOverride,
      {
        onProgress: async ({ processed, total, stage }) => {
          const ratio = total > 0 ? processed / total : 0;
          await updateResearchProgress(taskId, Math.round(60 + ratio * 24), stage);
        },
      },
    );
    await updateResearchProgress(taskId, 94, "正在保存最终核验结果");
    const completedTrace = {
      ...(failureTrace ?? {}),
      verificationSummary: toJsonSafe(verified.verificationSummary ?? null),
    } satisfies Prisma.InputJsonObject;

    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        rawResult: completedTrace,
        parsedResult: toJsonSafe(verified),
      },
    });

    return toTaskView(task);
  } catch (error) {
    const errorMessage = sanitizedResearchError(error, apiKeyOverride);
    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage,
        rawResult: {
          ...(failureTrace ?? {}),
          kind: "research-error",
          progress: 100,
          stage: "任务执行失败",
          error: errorMessage,
        } satisfies Prisma.InputJsonObject,
      },
    });

    return toTaskView(task);
  }
}

export async function getReleaseResearchTask(taskId: string, userId: string) {
  const task = await prisma.aiSearchTask.findFirst({
    where: {
      id: taskId,
      userId,
    },
  });

  return task ? toTaskView(task) : null;
}

function normalizeFormat(format: string | null): ReleaseFormat {
  const text = (format ?? "CD").toUpperCase();
  if (text.includes("SHM")) return "SHM_CD";
  if (text.includes("BLU")) return "BLU_SPEC_CD";
  if (text.includes("HYBRID") || text.includes("SACD")) return "HYBRID_SACD";
  if (text.includes("DVD")) return "CD_DVD";
  if (text.includes("BOX")) return "BOX_SET";
  if (text.includes("CD")) return "CD";
  return "OTHER";
}

function comparableCatalogNumber(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function comparableReleaseTitle(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function toDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveArtist(
  input: ReleaseResearchImportInput,
  parsed: ReleaseResearchResult,
  allowedArtistNames: ReadonlySet<string>,
  db: Prisma.TransactionClient,
) {
  const preferredName = (input.artistName ?? parsed.artist.name).trim();

  if (input.artistMode === "existing" && input.artistId) {
    const artist = await db.artist.findUniqueOrThrow({ where: { id: input.artistId } });
    if (![artist.name, artist.sortName].some((value) => allowedArtistNames.has(normalizeArtistIdentity(value)))) {
      throw new Error("所选艺人与该核验任务的艺人身份不一致，不能导入。");
    }
    const localizedUpdate = localizedArtistNameUpdate(artist.name, artist.sortName, preferredName);
    return localizedUpdate
      ? db.artist.update({ where: { id: artist.id }, data: localizedUpdate })
      : artist;
  }

  const name = preferredName;
  if (!name) throw new Error("artistName is required.");
  if (!allowedArtistNames.has(normalizeArtistIdentity(name))) {
    throw new Error("新建艺人名称必须使用核验结果或任务查询中的受控名称。");
  }

  const existingArtists = await db.artist.findMany({ orderBy: { id: "asc" } });
  const identityMatches = existingArtists.filter((artist) =>
    [artist.name, artist.sortName].some((value) => allowedArtistNames.has(normalizeArtistIdentity(value))));
  if (identityMatches.length > 1) {
    throw new Error("Multiple existing artist libraries match this verified artist identity; merge them before importing.");
  }
  if (identityMatches.length === 1) {
    const artist = identityMatches[0]!;
    const localizedUpdate = localizedArtistNameUpdate(artist.name, artist.sortName, name);
    return localizedUpdate
      ? db.artist.update({ where: { id: artist.id }, data: localizedUpdate })
      : artist;
  }

  return db.artist.create({
    data: {
      name,
      country: parsed.artist.country,
    },
  });
}

function candidateNotes(candidate: ReleaseResearchCandidate, pendingReview: boolean) {
  const parts = [
    candidate.notes,
    candidate.artistCredit ? `Artist credit: ${candidate.artistCredit}` : null,
    candidate.editionType ? `Edition: ${candidate.editionType}` : null,
    candidate.originalPrice ? `Original price: ${candidate.originalPrice}` : null,
    candidate.barcode ? `Barcode: ${candidate.barcode}` : null,
    pendingReview ? "PENDING_REVIEW" : null,
    candidate.warnings.length ? `Warnings: ${candidate.warnings.join("; ")}` : null,
  ];

  return parts.filter(Boolean).join("\n");
}

function normalizeArtistIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function allowedArtistIdentities(parsed: ReleaseResearchResult, taskQuery: string) {
  let queryArtist: string | null = null;
  try {
    queryArtist = parseReleaseResearchRequest(JSON.parse(taskQuery)).artistName;
  } catch {
    // A completed server-created task should be valid; parsed source names remain authoritative.
  }
  return new Set([
    parsed.artist.name,
    parsed.artist.nameKana,
    parsed.artist.nameRomaji,
    queryArtist,
  ].map(normalizeArtistIdentity).filter(Boolean));
}

function isCompletedVerifiedResearchTrace(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.mode === PUBLIC_METADATA_RESEARCH_MODE &&
    "verificationSummary" in value &&
    value.verificationSummary !== null;
}

const MAX_VERIFICATION_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function isFreshVerificationTimestamp(value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    timestamp <= now + MAX_CLOCK_SKEW_MS &&
    timestamp >= now - MAX_VERIFICATION_AGE_MS;
}

export function isTrustedVerifiedCandidate(candidate: ReleaseResearchCandidate) {
  const sourceUrls = candidate.sources.map((source) => source.url);
  const musicBrainzGroupUrl = sourceUrls.find((value) =>
    /^https:\/\/musicbrainz\.org\/release-group\/[0-9a-f-]+$/i.test(value));
  const musicBrainzReleaseUrl = sourceUrls.find((value) =>
    /^https:\/\/musicbrainz\.org\/release\/[0-9a-f-]+$/i.test(value));
  const discogsReleaseUrl = sourceUrls.find((value) =>
    /^https:\/\/www\.discogs\.com\/release\/\d+$/i.test(value));
  const ndlBibliographyUrl = sourceUrls.find((value) =>
    /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/i.test(value));
  const coverProvider = candidate.verification?.coverProvider;
  const trustedCoverSource = Boolean(coverProvider && candidate.coverImageSourceUrl &&
    isAllowedVerifiedCoverSourceUrl(candidate.coverImageSourceUrl, coverProvider));
  const attestedSources = new Set(candidate.verification?.sourceUrls ?? []);

  return candidate.verification?.status === "VERIFIED" &&
    candidate.verification.method === "musicbrainz-ndl-discogs-ai" &&
    candidate.verification.aiDecision === "ACCEPT" &&
    isFreshVerificationTimestamp(candidate.verification.checkedAt) &&
    isFreshVerificationTimestamp(candidate.verification.coverCheckedAt) &&
    Boolean(musicBrainzGroupUrl && attestedSources.has(musicBrainzGroupUrl)) &&
    Boolean(musicBrainzReleaseUrl && attestedSources.has(musicBrainzReleaseUrl)) &&
    Boolean(ndlBibliographyUrl && attestedSources.has(ndlBibliographyUrl)) &&
    Boolean(discogsReleaseUrl && attestedSources.has(discogsReleaseUrl)) &&
    sourceUrls.every((value) => /^https:\/\//i.test(value)) &&
    candidate.verification.sourceUrls.every((value) => sourceUrls.includes(value)) &&
    attestedSources.size >= 4 &&
    Boolean(coverProvider && candidate.coverImageUrl &&
      isAllowedVerifiedCoverAssetUrl(candidate.coverImageUrl, coverProvider)) &&
    trustedCoverSource &&
    candidate.confidence === "HIGH" &&
    candidate.sources.length >= 4;
}

export async function importReleaseResearchCandidates(
  taskId: string,
  userId: string,
  input: ReleaseResearchImportInput,
) {
  const validatedInput = parseReleaseResearchImportInput(input);
  const task = await prisma.aiSearchTask.findFirstOrThrow({
    where: {
      id: taskId,
      userId,
      status: "SUCCEEDED",
    },
  });
  const parsed = task.parsedResult as ReleaseResearchResult | null;

  if (!parsed) {
    throw new Error("No parsed research result is available for this task.");
  }
  if (!isCompletedVerifiedResearchTrace(task.rawResult)) {
    throw new Error("该任务不是服务端完成的跨源核验结果，不能导入。");
  }

  const selected = new Set(validatedInput.selectedCandidateIds);
  const candidateIds = new Set(parsed.releases.map((candidate) => candidate.id));
  const unknownSelectedId = validatedInput.selectedCandidateIds.find((candidateId) => !candidateIds.has(candidateId));
  if (unknownSelectedId) throw new Error(`Unknown release candidate: ${unknownSelectedId}`);
  if (Object.keys(validatedInput.candidateEdits).length > 0) {
    throw new Error("已通过自动核验的发行资料不可在导入时修改；请重新搜索以重新核验证据。");
  }
  if (validatedInput.excludedCandidateIds.length > 0 || validatedInput.pendingReviewCandidateIds.length > 0) {
    throw new Error("自动核验结果不再接受人工排除或待核对状态。");
  }

  const candidates = parsed.releases;
  const allowedArtistNames = allowedArtistIdentities(parsed, task.query);
  for (const candidate of candidates) {
    if (!selected.has(candidate.id)) continue;
    if (!isTrustedVerifiedCandidate(candidate)) {
      throw new Error(`候选“${candidate.title}”未满足国家书目、跨源、AI 与封面硬门禁，不能导入。`);
    }
    const coverCheck = await validateCoverAsset(candidate.coverImageUrl!);
    if (
      !coverCheck.ok ||
      !coverCheck.finalHost ||
      !isAllowedVerifiedCoverAssetHost(coverCheck.finalHost, candidate.verification!.coverProvider)
    ) {
      const suffix = coverCheck.retryable ? "封面来源暂时不可用，请稍后重试。" : "封面已失效或不是可验证的真实图片。";
      throw new Error(`候选“${candidate.title}”无法导入：${suffix}`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const artistLockIdentity = validatedInput.artistMode === "existing" && validatedInput.artistId
      ? `artist-id:${validatedInput.artistId}`
      : `artist-identities:${[...allowedArtistNames].sort().join("|")}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistLockIdentity}, 0))`;
    const artist = await resolveArtist(validatedInput, parsed, allowedArtistNames, tx);
    const claimedTask = await tx.aiSearchTask.updateMany({
      where: {
        id: taskId,
        userId,
        artistId: null,
      },
      data: { artistId: artist.id },
    });
    if (claimedTask.count !== 1) {
      throw new Error("该核验任务已经导入过，不能重复导入。");
    }
    await tx.$queryRaw`SELECT "id" FROM "Artist" WHERE "id" = ${artist.id} FOR UPDATE`;
    await tx.userArtistFollow.upsert({
      where: {
        userId_artistId: {
          userId,
          artistId: artist.id,
        },
      },
      create: {
        userId,
        artistId: artist.id,
      },
      update: {},
    });
    let imported = 0;
    let updatedDuplicates = 0;
    let coverConflicts = 0;

    for (const candidate of candidates) {
      if (!selected.has(candidate.id)) {
        continue;
      }

      const catalogKey = comparableCatalogNumber(candidate.catalogNumber);
      const existingReleases = await tx.release.findMany({
        where: { artistId: artist.id },
        select: {
          id: true,
          title: true,
          notes: true,
          coverImageUrl: true,
          originalCatalogNo: true,
          originalReleaseDate: true,
        },
      });
      let duplicateMatches = catalogKey
        ? existingReleases.filter((release) =>
            comparableCatalogNumber(release.originalCatalogNo) === catalogKey)
        : [];
      if (duplicateMatches.length === 0) {
        const titleKey = comparableReleaseTitle(candidate.title);
        const releaseDate = toDate(candidate.originalReleaseDate ?? candidate.releaseDate)?.getTime() ?? null;
        if (titleKey && releaseDate !== null) {
          duplicateMatches = existingReleases.filter((release) =>
            release.originalCatalogNo === null &&
            comparableReleaseTitle(release.title) === titleKey &&
            release.originalReleaseDate?.getTime() === releaseDate);
        }
      }
      if (duplicateMatches.length > 1) {
        throw new Error(`品番“${candidate.catalogNumber}”在现有艺人库中对应多个条目，请先合并重复数据。`);
      }
      const duplicate = duplicateMatches[0] ?? null;
      if (
        duplicate?.coverImageUrl &&
        duplicate.coverImageUrl !== candidate.coverImageUrl
      ) {
        coverConflicts += 1;
        continue;
      }
      const releaseData = {
          artistId: artist.id,
          category: candidate.category,
          title: candidate.title,
          originalReleaseDate: toDate(candidate.originalReleaseDate ?? candidate.releaseDate),
          format: normalizeFormat(candidate.format),
          originalCatalogNo: candidate.catalogNumber,
          label: candidate.label,
          originalPrice: candidate.originalPrice,
          editionType: candidate.editionType,
          isReissue: candidate.isReissue ?? false,
          isRemaster: candidate.isRemaster ?? false,
          isExcludedByDefault: candidate.isExcludedByDefault,
          confidence: candidate.confidence,
          warnings: candidate.warnings,
          notes: candidateNotes(candidate, false),
          coverImageUrl: candidate.coverImageUrl,
          verificationStatus: "VERIFIED" as const,
          verificationEvidence: toJsonSafe(candidate.verification),
          verifiedAt: new Date(candidate.verification!.checkedAt),
      };
      const release = duplicate
        ? await tx.release.update({
            where: { id: duplicate.id },
            data: {
              ...releaseData,
              notes: duplicate.notes || releaseData.notes,
            },
          })
        : await tx.release.create({ data: releaseData });

      await tx.userReleaseStatus.upsert({
        where: { userId_releaseId: { userId, releaseId: release.id } },
        create: {
          userId,
          releaseId: release.id,
          status: "NOT_OWNED",
          priority: 2,
        },
        update: {},
      });
      await tx.userReleaseStatus.updateMany({
        where: {
          userId,
          releaseId: release.id,
          status: "PENDING_REVIEW",
        },
        data: { status: "NOT_OWNED" },
      });

      const uniqueSources = buildImportedReleaseSourceRows(
        candidate.sources,
        candidate.coverImageSourceUrl,
      );

      const sourceRoleKey = (source: { url: string; description: string | null }) =>
        `${source.url}\u0000${source.description === COVER_IMAGE_SOURCE_DESCRIPTION ? "cover" : "evidence"}`;
      const existingSources = new Set(
        (await tx.releaseSource.findMany({
          where: { releaseId: release.id },
          select: { url: true, description: true },
        })).map(sourceRoleKey),
      );
      const missingSources = uniqueSources.filter((source) => !existingSources.has(sourceRoleKey(source)));
      if (missingSources.length > 0) {
        await tx.releaseSource.createMany({
          data: missingSources.map((source) => ({
            releaseId: release.id,
            url: source.url,
            label: source.label,
            description: source.description,
          })),
        });
      }

      if (duplicate) updatedDuplicates += 1;
      else imported += 1;
    }

    return {
      artistId: artist.id,
      imported,
      updatedDuplicates,
      coverConflicts,
      skippedDuplicates: 0,
      pendingReview: 0,
      excluded: 0,
    };
  }, { maxWait: 5_000, timeout: 30_000 });
}
