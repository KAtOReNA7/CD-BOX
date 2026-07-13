import type {
  AiSearchTask,
  DatePrecision,
  Prisma,
  ReleaseFormat,
  ResearchStageSummary,
} from "@prisma/client";
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
import {
  applyComprehensiveWorkRules,
  comprehensiveCandidatesFromResearch,
  retryTransientComprehensiveCovers,
  runComprehensiveDiscographyPipeline,
} from "@/lib/ai/comprehensive-discography";
import { auditComprehensiveEvidenceWithAi } from "@/lib/ai/comprehensive-evidence-audit";
import { prepareComprehensiveSourceEvidence } from "@/lib/ai/comprehensive-source-adapters";
import { buildComprehensiveReleaseResearchResult } from "@/lib/ai/comprehensive-release-result";
import { persistResearchLedger } from "@/lib/ai/research-ledger-persistence";
import { acquireResearchLedgerTaskLock } from "@/lib/ai/research-task-lock";
import type {
  AiSearchTaskView,
  ReleaseResearchCandidate,
  ReleaseResearchImportInput,
  ReleaseResearchRequest,
  ReleaseResearchResult,
  ReleaseResearchStageSummaryView,
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
import { validateOfficialMusicUrl } from "@/lib/official-music/url-policy";

type TaskViewSource = Pick<
  AiSearchTask,
  | "id"
  | "status"
  | "progress"
  | "stage"
  | "query"
  | "model"
  | "errorMessage"
  | "rawResult"
  | "parsedResult"
  | "createdAt"
  | "updatedAt"
> & {
  stageSummaries?: readonly Pick<
    ResearchStageSummary,
    | "stage"
    | "sequence"
    | "inputCount"
    | "passedCount"
    | "deferredCount"
    | "rejectedCount"
    | "mergedCount"
    | "retryCount"
    | "reasonCounts"
    | "detailsComplete"
    | "startedAt"
    | "completedAt"
  >[];
};

function canonicalSnapshotJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalSnapshotJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalSnapshotJson(object[key])}`).join(",")}}`;
}

type ResearchImportTaskSnapshot = Pick<
  AiSearchTask,
  | "id"
  | "userId"
  | "query"
  | "request"
  | "pipelineVersion"
  | "resultSchemaVersion"
  | "status"
  | "rawResult"
  | "parsedResult"
  | "artistId"
  | "importedAt"
  | "updatedAt"
>;

export function assertResearchImportTaskSnapshotUnchanged(
  original: ResearchImportTaskSnapshot,
  locked: ResearchImportTaskSnapshot,
) {
  if (
    locked.id !== original.id ||
    locked.userId !== original.userId ||
    locked.status !== "SUCCEEDED" ||
    locked.artistId !== null ||
    locked.importedAt !== null ||
    locked.updatedAt.getTime() !== original.updatedAt.getTime() ||
    locked.query !== original.query ||
    locked.pipelineVersion !== original.pipelineVersion ||
    locked.resultSchemaVersion !== original.resultSchemaVersion ||
    canonicalSnapshotJson(locked.request) !== canonicalSnapshotJson(original.request) ||
    canonicalSnapshotJson(locked.rawResult) !== canonicalSnapshotJson(original.rawResult) ||
    canonicalSnapshotJson(locked.parsedResult) !== canonicalSnapshotJson(original.parsedResult)
  ) {
    throw new Error(
      "核验任务在封面复核期间已发生变化，当前导入已安全取消；请刷新任务结果后重试。",
    );
  }
}

function stageReasonCounts(value: Prisma.JsonValue | null): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const counts: Record<string, number> = {};
  for (const [reasonCode, count] of Object.entries(value)) {
    if (reasonCode.trim() && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      counts[reasonCode] = count;
    }
  }
  return counts;
}

function stageSummaryView(
  summary: NonNullable<TaskViewSource["stageSummaries"]>[number],
): ReleaseResearchStageSummaryView {
  return {
    stage: summary.stage,
    sequence: summary.sequence,
    inputCount: summary.inputCount,
    passedCount: summary.passedCount,
    deferredCount: summary.deferredCount,
    rejectedCount: summary.rejectedCount,
    mergedCount: summary.mergedCount,
    retryCount: summary.retryCount,
    reasonCounts: stageReasonCounts(summary.reasonCounts),
    detailsComplete: summary.detailsComplete,
    startedAt: summary.startedAt?.toISOString() ?? null,
    completedAt: summary.completedAt?.toISOString() ?? null,
  };
}

export function buildReleaseResearchTaskView(task: TaskViewSource): AiSearchTaskView {
  const progressState = readTaskProgress(task);
  const parsedResult = task.parsedResult as ReleaseResearchResult | null;
  const trustedFinalCandidateIds: string[] = [];
  for (const candidate of parsedResult?.releases ?? []) {
    if (isTrustedVerifiedCandidate(candidate)) trustedFinalCandidateIds.push(candidate.id);
  }
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
    parsedResult,
    trustedFinalCandidateIds,
    stageSummaries: (task.stageSummaries ?? []).map(stageSummaryView),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function readTaskProgress(task: Pick<AiSearchTask, "status" | "progress" | "stage" | "rawResult">) {
  if (task.status === "SUCCEEDED") return { progress: 100, stage: task.stage ?? "候选资料已准备完成" };
  if (task.status === "FAILED") return { progress: 100, stage: task.stage ?? "任务执行失败" };
  if (task.progress > 0 || task.stage) {
    return {
      progress: Math.max(0, Math.min(100, task.progress)),
      stage: task.stage ?? (task.status === "QUEUED" ? "等待后台任务启动" : "正在联网检索发行资料"),
    };
  }

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

type ResearchProgressUpdate = {
  progress: number;
  stage: string;
};

export function createResearchProgressCoordinator(
  persist: (update: ResearchProgressUpdate) => Promise<void>,
  initialProgress = 0,
) {
  let highestScheduled = Math.max(0, Math.min(100, Math.round(initialProgress)));
  let sealed = false;
  let queue: Promise<void> = Promise.resolve();

  const report = (progress: number, stage: string): Promise<boolean> => {
    if (!Number.isFinite(progress)) {
      return Promise.reject(new TypeError("Research progress must be finite."));
    }
    const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    const normalizedStage = stage.trim();
    if (!normalizedStage) {
      return Promise.reject(new TypeError("Research progress stage is required."));
    }
    if (sealed || normalizedProgress < highestScheduled) return Promise.resolve(false);

    highestScheduled = normalizedProgress;
    const pending = queue.then(async () => {
      await persist({ progress: normalizedProgress, stage: normalizedStage });
      return true;
    });
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const seal = async () => {
    sealed = true;
    await queue;
  };

  return {
    report,
    seal,
    current: () => highestScheduled,
  };
}

export function resolveResearchCoverRetryProgress(
  currentProgress: number,
  processed: number,
  total: number,
) {
  const ratio = total > 0 ? processed / total : 0;
  return Math.max(Math.round(currentProgress), Math.round(93 + ratio));
}

async function persistResearchProgress(
  taskId: string,
  { progress, stage }: ResearchProgressUpdate,
) {
  try {
    await prisma.aiSearchTask.updateMany({
      where: {
        id: taskId,
        status: "RUNNING",
        progress: { lte: progress },
      },
      data: { progress, stage },
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
    : "为执行可审计的最终核验，本次使用 MusicBrainz、国家书目或官方目录、Discogs 与真实封面来源。";
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
      request: toJsonSafe(validatedInput),
      model: aiConfig.textModel,
      pipelineVersion: "multi-source-v2",
      resultSchemaVersion: 2,
      status: "QUEUED",
      progress: 5,
      stage: "等待后台任务启动",
      rawResult: progressPayload(5, "等待后台任务启动"),
    },
  });

  return buildReleaseResearchTaskView(task);
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
      progress: 15,
      stage: "正在联网检索发行资料",
      startedAt: new Date(),
      rawResult: progressPayload(15, "正在联网检索发行资料"),
    },
  });

  const progressCoordinator = createResearchProgressCoordinator(
    (update) => persistResearchProgress(taskId, update),
    15,
  );
  const reportProgress = progressCoordinator.report;
  let failureTrace: Prisma.InputJsonObject | null = null;
  try {
    const strategy = resolveReleaseResearchStrategy(capabilities);

    await reportProgress(36, "正在查询 MusicBrainz 公共发行资料");
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
          await reportProgress(Math.round(phaseBase + ratio * phaseSpan), label);
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

    const discovered = comprehensiveCandidatesFromResearch(publicResult, publicResearch.evidence);
    await reportProgress(58, `已保留 ${discovered.length} 个实体版本，正在应用作品/版本规则`);
    const ruled = applyComprehensiveWorkRules(discovered, {
      excludeReissues: validatedInput.excludeReissues,
    });
    const prepared = await prepareComprehensiveSourceEvidence({
      request: validatedInput,
      result: publicResult,
      bundle: publicResearch.evidence,
      candidates: ruled,
      onProgress: async ({ stage, processed, total }) => {
        const ratio = total > 0 ? processed / total : 0;
        if (stage === "SOURCE_FETCH") {
          await reportProgress(64, "已并行取得国家书目、官方目录、Discogs 与 Apple 数据");
        } else if (stage === "NDL_MATCH") {
          await reportProgress(Math.round(64 + ratio * 10), `正在逐条核对权威书目（${processed}/${total}）`);
        } else {
          await reportProgress(76, "正在合并独立来源证据");
        }
      },
    });
    const pipelineCandidates = applyComprehensiveWorkRules(prepared.candidates, {
      excludeReissues: validatedInput.excludeReissues,
    });
    if (pipelineCandidates.length === 0) {
      throw new Error("Public metadata sources returned no physical release candidates.");
    }
    failureTrace = {
      ...(failureTrace ?? {}),
      sourceStats: toJsonSafe(prepared.sourceStats),
    } satisfies Prisma.InputJsonObject;
    await reportProgress(77, "AI 正在裁决第一批已提供证据");
    let aiBatchNumber = 0;
    let aiProgress = 77;
    const initialComprehensive = await runComprehensiveDiscographyPipeline(
      pipelineCandidates,
      {
        lookupValidatedCover: prepared.lookupValidatedCover,
        aiBatchSize: 20,
        coverSelection: validatedInput.excludeReissues || validatedInput.target === "ORIGINAL_CD"
          ? "EARLIEST_ACCEPTED_PER_WORK"
          : "ALL_ACCEPTED_EDITIONS",
        coverConcurrency: 6,
        auditEvidence: async (candidates, key) => {
          aiBatchNumber += 1;
          const batchNumber = aiBatchNumber;
          const startedAt = Date.now();
          await reportProgress(aiProgress, `AI 正在裁决第 ${batchNumber} 批证据`);
          const heartbeat = setInterval(() => {
            const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1_000));
            void reportProgress(
              aiProgress,
              `AI 正在裁决第 ${batchNumber} 批证据（已等待 ${seconds} 秒）`,
            );
          }, 10_000);
          heartbeat.unref?.();
          try {
            return await auditComprehensiveEvidenceWithAi(candidates, key);
          } finally {
            clearInterval(heartbeat);
          }
        },
        onAiCheckpoint: async (checkpoint) => {
          failureTrace = {
            ...(failureTrace ?? {}),
            aiCheckpoint: toJsonSafe(checkpoint),
          } satisfies Prisma.InputJsonObject;
          try {
            await prisma.aiSearchTask.update({
              where: { id: taskId },
              data: { rawResult: failureTrace },
            });
          } catch (error) {
            console.warn("Unable to persist optional AI decision checkpoint.", {
              taskId,
              error: error instanceof Error ? error.message : "Unknown database error",
            });
          }
        },
        onProgress: async ({ processed, total, stage }) => {
          const ratio = total > 0 ? processed / total : 0;
          const progress = stage === "AI_AUDIT"
            ? Math.round(77 + ratio * 8)
            : Math.round(86 + ratio * 7);
          if (stage === "AI_AUDIT") aiProgress = Math.max(aiProgress, progress);
          const label = stage === "AI_AUDIT"
            ? `AI 正在裁决已提供的证据（${processed}/${total}）`
            : `正在验证并补全封面（${processed}/${total}）`;
          await reportProgress(progress, label);
        },
      },
      apiKeyOverride,
    );
    const comprehensive = await retryTransientComprehensiveCovers(
      initialComprehensive,
      pipelineCandidates,
      prepared.lookupValidatedCover,
      {
        maxRounds: 2,
        onProgress: async ({ processed, total, round }) => {
          await reportProgress(
            resolveResearchCoverRetryProgress(
              progressCoordinator.current(),
              processed,
              total,
            ),
            `正在自动重试临时失败的封面（第 ${round} 轮，${processed}/${total}）`,
          );
        },
      },
    );
    failureTrace = {
      ...(failureTrace ?? {}),
      sourceStats: toJsonSafe(prepared.sourceStats),
      comprehensiveSummary: toJsonSafe(comprehensive.summary),
    } satisfies Prisma.InputJsonObject;
    await reportProgress(94, "正在保存逐条核验账本");
    await persistResearchLedger(
      prisma,
      taskId,
      comprehensive.results,
      comprehensive.summary,
      { sourceCandidates: pipelineCandidates },
    );
    const verified = buildComprehensiveReleaseResearchResult(
      validatedInput,
      publicResult,
      publicResearch.evidence,
      comprehensive,
    );
    const completedTrace = {
      ...(failureTrace ?? {}),
      sourceStats: toJsonSafe(prepared.sourceStats),
      verificationSummary: toJsonSafe(verified.verificationSummary ?? null),
      comprehensiveSummary: toJsonSafe(comprehensive.summary),
    } satisfies Prisma.InputJsonObject;

    await progressCoordinator.seal();
    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        stage: "候选资料已准备完成",
        completedAt: new Date(),
        rawResult: completedTrace,
        parsedResult: toJsonSafe(verified),
      },
    });

    return buildReleaseResearchTaskView(task);
  } catch (error) {
    const errorMessage = sanitizedResearchError(error, apiKeyOverride);
    await progressCoordinator.seal();
    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        progress: 100,
        stage: "任务执行失败",
        completedAt: new Date(),
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

    return buildReleaseResearchTaskView(task);
  }
}

export async function getReleaseResearchTask(taskId: string, userId: string) {
  const task = await prisma.aiSearchTask.findFirst({
    where: {
      id: taskId,
      userId,
    },
    select: {
      id: true,
      status: true,
      progress: true,
      stage: true,
      query: true,
      model: true,
      errorMessage: true,
      rawResult: true,
      parsedResult: true,
      createdAt: true,
      updatedAt: true,
      stageSummaries: {
        orderBy: [{ sequence: "asc" }, { stage: "asc" }],
        select: {
          stage: true,
          sequence: true,
          inputCount: true,
          passedCount: true,
          deferredCount: true,
          rejectedCount: true,
          mergedCount: true,
          retryCount: true,
          reasonCounts: true,
          detailsComplete: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });

  return task ? buildReleaseResearchTaskView(task) : null;
}

function normalizeFormat(format: string | null): ReleaseFormat {
  const text = (format ?? "").toUpperCase();
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
  const match = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2] ?? "01");
  const day = Number(match[3] ?? "01");
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
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

function datePrecision(value: string | null): DatePrecision | null {
  if (!value || !toDate(value)) return null;
  if (/^\d{4}$/.test(value)) return "YEAR";
  if (/^\d{4}-\d{2}$/.test(value)) return "MONTH";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? "DAY" : null;
}

export function candidateExternalIds(candidate: ReleaseResearchCandidate) {
  const musicBrainzReleaseGroupIds = new Set<string>();
  const musicBrainzReleaseIds = new Set<string>();
  const discogsReleaseIds = new Set<number>();
  for (const source of candidate.sources) {
    const group = source.url.match(/^https:\/\/musicbrainz\.org\/release-group\/([0-9a-f-]+)$/i);
    const release = source.url.match(/^https:\/\/musicbrainz\.org\/release\/([0-9a-f-]+)$/i);
    const discogs = source.url.match(/^https:\/\/www\.discogs\.com\/release\/(\d+)$/i);
    if (group) musicBrainzReleaseGroupIds.add(group[1]!.toLowerCase());
    if (release) musicBrainzReleaseIds.add(release[1]!.toLowerCase());
    if (discogs) discogsReleaseIds.add(Number(discogs[1]));
  }
  if (musicBrainzReleaseGroupIds.size > 1) {
    throw new Error(`候选“${candidate.title}”包含多个 MusicBrainz 作品标识，不能自动确定作品身份。`);
  }
  if (musicBrainzReleaseIds.size > 1) {
    throw new Error(`候选“${candidate.title}”包含多个 MusicBrainz 版本标识，不能自动确定版本身份。`);
  }
  if (discogsReleaseIds.size > 1) {
    throw new Error(`候选“${candidate.title}”包含多个 Discogs 版本标识，不能自动确定版本身份。`);
  }
  let musicBrainzReleaseGroupId = [...musicBrainzReleaseGroupIds][0] ?? null;
  const musicBrainzReleaseId = [...musicBrainzReleaseIds][0] ?? null;
  const discogsReleaseId = [...discogsReleaseIds][0] ?? null;
  if (
    !musicBrainzReleaseGroupId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(candidate.verification?.workId ?? "")
  ) {
    musicBrainzReleaseGroupId = candidate.verification!.workId!.toLowerCase();
  }
  return { musicBrainzReleaseGroupId, musicBrainzReleaseId, discogsReleaseId };
}

export async function upsertCandidateWork(
  candidate: ReleaseResearchCandidate,
  artistId: string,
  db: Prisma.TransactionClient,
) {
  const ids = candidateExternalIds(candidate);
  if (!ids.musicBrainzReleaseGroupId && !ids.discogsReleaseId) {
    throw new Error(`候选“${candidate.title}”缺少可核验的 MusicBrainz 作品或 Discogs 版本标识，不能建立作品/版本关系。`);
  }
  const musicBrainzWork = ids.musicBrainzReleaseGroupId
    ? await db.releaseWork.findUnique({
        where: { musicBrainzReleaseGroupId: ids.musicBrainzReleaseGroupId },
      })
    : null;
  const linkedSources = ids.discogsReleaseId
    ? await db.releaseWorkSource.findMany({
      where: {
        provider: "www.discogs.com",
        externalId: String(ids.discogsReleaseId),
      },
      include: { work: true },
    })
    : [];
  const discogsWorks = new Map(linkedSources.map((source) => [source.work.id, source.work]));
  if (discogsWorks.size > 1) {
    throw new Error(`Discogs 版本 ${ids.discogsReleaseId} 对应多个作品，必须先修复作品身份冲突。`);
  }
  const discogsWork = [...discogsWorks.values()][0] ?? null;
  if (musicBrainzWork && discogsWork && musicBrainzWork.id !== discogsWork.id) {
    throw new Error(`候选“${candidate.title}”的 MusicBrainz 与 Discogs 标识分别属于不同作品。`);
  }
  if (
    discogsWork?.musicBrainzReleaseGroupId &&
    ids.musicBrainzReleaseGroupId &&
    discogsWork.musicBrainzReleaseGroupId !== ids.musicBrainzReleaseGroupId
  ) {
    throw new Error(`候选“${candidate.title}”的 Discogs 版本已绑定到另一个 MusicBrainz 作品。`);
  }
  const existing = musicBrainzWork ?? discogsWork;
  if (existing && existing.artistId !== artistId) {
    throw new Error(`候选“${candidate.title}”的外部作品标识已属于其他艺人。`);
  }
  const originalReleaseDate = toDate(candidate.originalReleaseDate ?? candidate.releaseDate);
  const work = existing
    ? await db.releaseWork.update({
        where: { id: existing.id },
        data: {
          title: candidate.title,
          titleOriginal: candidate.titleOriginal,
          artistCredit: candidate.artistCredit,
          category: candidate.category,
          originalReleaseDate,
          originalDatePrecision: datePrecision(candidate.originalReleaseDate ?? candidate.releaseDate),
          musicBrainzReleaseGroupId: ids.musicBrainzReleaseGroupId ?? existing.musicBrainzReleaseGroupId,
          verificationStatus: "VERIFIED",
          verificationEvidence: toJsonSafe(candidate.verification),
          verifiedAt: new Date(candidate.verification!.checkedAt),
        },
      })
    : await db.releaseWork.create({
        data: {
          artistId,
          title: candidate.title,
          titleOriginal: candidate.titleOriginal,
          artistCredit: candidate.artistCredit,
          category: candidate.category,
          originalReleaseDate,
          originalDatePrecision: datePrecision(candidate.originalReleaseDate ?? candidate.releaseDate),
          musicBrainzReleaseGroupId: ids.musicBrainzReleaseGroupId,
          verificationStatus: "VERIFIED",
          verificationEvidence: toJsonSafe(candidate.verification),
          verifiedAt: new Date(candidate.verification!.checkedAt),
        },
      });

  const authority = new Set(candidate.verification?.authoritySourceUrls ?? []);
  const corroborating = new Set(candidate.verification?.corroboratingSourceUrls ?? []);
  const persistedSources = await db.releaseWorkSource.findMany({
    where: { workId: work.id },
    select: { url: true, externalId: true },
  });
  const existingSources = new Set(persistedSources.map((source) => source.url));
  const discogsSourceUrl = candidate.sources.find((source) =>
    source.url === `https://www.discogs.com/release/${ids.discogsReleaseId}`)?.url;
  const persistedDiscogsSource = discogsSourceUrl
    ? persistedSources.find((source) => source.url === discogsSourceUrl)
    : null;
  if (
    persistedDiscogsSource?.externalId &&
    persistedDiscogsSource.externalId !== String(ids.discogsReleaseId)
  ) {
    throw new Error(`Discogs 来源 ${discogsSourceUrl} 的持久化标识与来源 URL 冲突。`);
  }
  if (discogsSourceUrl && persistedDiscogsSource && !persistedDiscogsSource.externalId) {
    await db.releaseWorkSource.updateMany({
      where: { workId: work.id, url: discogsSourceUrl, externalId: null },
      data: {
        provider: "www.discogs.com",
        externalId: String(ids.discogsReleaseId),
      },
    });
  }
  const workSources = candidate.sources.filter((source) => !existingSources.has(source.url));
  if (workSources.length > 0) {
    await db.releaseWorkSource.createMany({
      data: workSources.map((source) => {
        const url = new URL(source.url);
        return {
          workId: work.id,
          provider: url.hostname.toLowerCase(),
          role: authority.has(source.url) ? "authority" : corroborating.has(source.url) ? "corroboration" : "discovery",
          externalId: source.url.includes("musicbrainz.org/release-group/")
            ? ids.musicBrainzReleaseGroupId
            : source.url.match(/^https:\/\/www\.discogs\.com\/release\/(\d+)$/i)?.[1] ?? null,
          url: source.url,
          label: source.title,
        };
      }),
    });
  }
  return { work, ids };
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

function parseAttestedReleaseDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u) ??
    value.match(/^(\d{4})-(\d{2})-(\d{2})T.+(?:Z|[+-]\d{2}:\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) return null;
  const parsedTimestamp = value.includes("T") ? Date.parse(value) : calendarCheck.getTime();
  if (!Number.isFinite(parsedTimestamp)) return null;
  const precision = match[3] ? 3 : match[2] ? 2 : 1;
  const timestamp = calendarCheck.getTime();
  const intervalEnd = precision === 3
    ? timestamp + 24 * 60 * 60_000 - 1
    : precision === 2
      ? Date.UTC(year, month, 0, 23, 59, 59, 999)
      : Date.UTC(year, 11, 31, 23, 59, 59, 999);
  return { timestamp, intervalEnd, year, precision };
}

function validExactReleaseDay(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value ?? "") &&
    parseAttestedReleaseDate(value)?.precision === 3;
}

function physicalCdFormat(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC").toUpperCase();
  return /(?:^|[^A-Z])(?:CD|BLU[ _-]?SPEC(?:[ _-]?CD)?|COMPACT[ _-]?DISC)(?:[^A-Z]|$)/u
    .test(normalized);
}

function physicalEditionSourceFamily(value: string) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en").replace(/^www\./u, "");
    if (host === "musicbrainz.org") return "musicbrainz";
    if (host === "discogs.com") return "discogs";
    if (host === "ndlsearch.ndl.go.jp") return "ndl-search";
    return host;
  } catch {
    return null;
  }
}

function isPhysicalEditionSource(
  value: string,
  source: ReleaseResearchCandidate["sources"][number] | undefined,
) {
  return /^https:\/\/musicbrainz\.org\/release\/[0-9a-f-]+$/iu.test(value) ||
    /^https:\/\/(?:www\.)?discogs\.com\/release\/\d+$/iu.test(value) ||
    /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/iu.test(value) ||
    Boolean(source?.sourceType === "official" && validateOfficialMusicUrl(value).ok);
}

function hasTrustedCoverMatchAttestation(candidate: ReleaseResearchCandidate) {
  const verification = candidate.verification;
  const sourceDate = parseAttestedReleaseDate(verification?.sourceReleaseDate);
  if (!verification || !sourceDate) return false;

  if (verification.coverMatchLevel === "EDITION") {
    const editionDate = parseAttestedReleaseDate(
      candidate.releaseDate ?? candidate.originalReleaseDate,
    );
    return editionDate !== null && editionDate.precision === 3 &&
      editionDate.timestamp >= sourceDate.timestamp &&
      editionDate.timestamp <= sourceDate.intervalEnd;
  }

  if (verification.coverMatchLevel === "WORK") {
    const workDate = parseAttestedReleaseDate(candidate.originalReleaseDate);
    return (verification.coverProvider === "apple-music" ||
      verification.coverProvider === "official-label") &&
      workDate !== null &&
      sourceDate.intervalEnd >= workDate.timestamp;
  }

  return false;
}

export function isTrustedVerifiedCandidate(candidate: ReleaseResearchCandidate) {
  if (candidate.isExcludedByDefault || candidate.verification?.status !== "VERIFIED") {
    return false;
  }
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

  if (candidate.verification?.method === "multi-source-v2") {
    const authoritySourceUrls = candidate.verification.authoritySourceUrls ?? [];
    const corroboratingSourceUrls = candidate.verification.corroboratingSourceUrls ?? [];
    const sourceByUrl = new Map(candidate.sources.map((source) => [source.url, source]));
    const matchedFields = new Set(candidate.verification.matchedFields);
    const completePhysicalIdentity =
      validExactReleaseDay(candidate.releaseDate) &&
      validExactReleaseDay(candidate.originalReleaseDate) &&
      Boolean(candidate.catalogNumber?.trim()) &&
      physicalCdFormat(candidate.format) &&
      Boolean(candidate.workId?.trim() && candidate.editionId?.trim()) &&
      candidate.verification.workId === candidate.workId &&
      candidate.verification.editionId === candidate.editionId &&
      ["artist", "title", "date", "catalogNumber", "format"]
        .every((field) => matchedFields.has(field));
    const trustedAuthority = authoritySourceUrls.length > 0 && authoritySourceUrls.every((value) => {
      const source = sourceByUrl.get(value);
      if (!source || !attestedSources.has(value)) return false;
      if (/^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/i.test(value)) {
        return true;
      }
      return source.sourceType === "official" && validateOfficialMusicUrl(value).ok;
    });
    const independentCorroborationAttested = corroboratingSourceUrls.some((value) => {
      const source = sourceByUrl.get(value);
      if (!isPhysicalEditionSource(value, source) ||
        !attestedSources.has(value) || !source) return false;
      const corroboratingFamily = physicalEditionSourceFamily(value);
      return corroboratingFamily !== null && authoritySourceUrls.some((authorityUrl) => {
        const authorityFamily = physicalEditionSourceFamily(authorityUrl);
        return authorityUrl !== value && authorityFamily !== null &&
          authorityFamily !== corroboratingFamily;
      });
    });
    return candidate.verification.policyVersion === "multi-source-v2" &&
      candidate.verification.aiDecision === "ACCEPT" &&
      completePhysicalIdentity &&
      isFreshVerificationTimestamp(candidate.verification.checkedAt) &&
      isFreshVerificationTimestamp(candidate.verification.coverCheckedAt) &&
      hasTrustedCoverMatchAttestation(candidate) &&
      independentCorroborationAttested &&
      trustedAuthority &&
      candidate.verification.sourceUrls.every((value) =>
        sourceByUrl.has(value) && /^https:\/\//i.test(value)) &&
      Boolean(coverProvider && candidate.coverImageUrl &&
        isAllowedVerifiedCoverAssetUrl(candidate.coverImageUrl, coverProvider)) &&
      trustedCoverSource &&
      candidate.confidence === "HIGH" &&
      candidate.sources.length >= 2;
  }

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
    await acquireResearchLedgerTaskLock(tx, taskId);
    const lockedTask = await tx.aiSearchTask.findFirst({
      where: { id: taskId, userId, status: "SUCCEEDED" },
    });
    if (!lockedTask) {
      throw new Error("核验任务已失效，当前导入已安全取消。请刷新后重试。");
    }
    assertResearchImportTaskSnapshotUnchanged(task, lockedTask);
    const conflictingCandidateState = await tx.researchCandidate.count({
      where: {
        taskId,
        OR: [
          { coverStatus: "CHECKING" },
          { releaseId: { not: null } },
        ],
      },
    });
    if (conflictingCandidateState > 0) {
      throw new Error(
        "核验任务正在复核封面或已关联收藏条目，当前导入已安全取消；请稍后刷新任务结果。",
      );
    }
    const artistLockIdentity = validatedInput.artistMode === "existing" && validatedInput.artistId
      ? `artist-id:${validatedInput.artistId}`
      : `artist-identities:${[...allowedArtistNames].sort().join("|")}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistLockIdentity}, 0))::text AS lock_result`;
    const artist = await resolveArtist(validatedInput, parsed, allowedArtistNames, tx);
    const claimedTask = await tx.aiSearchTask.updateMany({
      where: {
        id: taskId,
        userId,
        artistId: null,
      },
      data: { artistId: artist.id, importedAt: new Date() },
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

      const { work, ids } = await upsertCandidateWork(candidate, artist.id, tx);

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
          musicBrainzReleaseId: true,
        },
      });
      let duplicateMatches = ids.musicBrainzReleaseId
        ? existingReleases.filter((release) => release.musicBrainzReleaseId === ids.musicBrainzReleaseId)
        : [];
      if (duplicateMatches.length === 0) duplicateMatches = catalogKey
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
          workId: work.id,
          category: candidate.category,
          title: candidate.title,
          originalReleaseDate: toDate(candidate.originalReleaseDate ?? candidate.releaseDate),
          editionReleaseDate: toDate(candidate.releaseDate),
          editionDatePrecision: datePrecision(candidate.releaseDate),
          format: normalizeFormat(candidate.format),
          originalCatalogNo: candidate.catalogNumber,
          musicBrainzReleaseId: ids.musicBrainzReleaseId,
          discogsReleaseId: ids.discogsReleaseId,
          barcode: candidate.barcode,
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
          coverImageSourceUrl: candidate.coverImageSourceUrl,
          coverStatus: "VALID" as const,
          coverProvider: candidate.verification!.coverProvider,
          coverCheckedAt: new Date(candidate.verification!.coverCheckedAt),
          coverAttemptCount: 1,
          coverNextRetryAt: null,
          coverLastErrorCode: null,
          coverLastErrorMessage: null,
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

      await tx.researchCandidate.updateMany({
        where: { taskId, candidateKey: candidate.id },
        data: { workId: work.id, releaseId: release.id },
      });

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
