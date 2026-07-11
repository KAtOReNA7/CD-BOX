import type { AiSearchTask, Prisma, ReleaseFormat } from "@prisma/client";
import {
  aiConfig,
  createWebSearchResponse,
  isResponsesEndpointUnsupportedError,
} from "@/lib/ai/client";
import {
  enrichReleaseResearchResultWithItunes,
} from "@/lib/ai/itunes-enrichment";
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
import { parseReleaseResearchResponse } from "@/lib/ai/release-research-parser";
import { applyReleaseQualityGate } from "@/lib/ai/release-research-quality";
import type {
  AiSearchTaskView,
  ReleaseResearchCandidate,
  ReleaseResearchImportInput,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import { prisma } from "@/lib/db/prisma";
import { buildImportedReleaseSourceRows } from "@/lib/releases/cover-source";

function buildResearchPrompt(input: ReleaseResearchRequest) {
  return `Research physical CD releases for a Japanese artist collection database.

Artist: ${input.artistName}
Country/region: ${input.country}
Collection scope: ${input.target}
Exclude reissues: ${input.excludeReissues}
Include collaborations: ${input.includeCollaborations}
Include Live / Remix / Best: ${input.includeLiveRemixBest}

Search strategy:
1. Resolve the artist's official native-script name first, then search with both that name and romanized aliases.
2. Prefer official artist discography and label pages.
3. Then use King Records, Sony Music, Universal Music Japan, Avex, Victor, and other label pages.
4. Then use Tower Records, HMV, CDJapan, CDJournal, ORICON, and Apple Music.
5. For ACG, voice actor, or game music, VGMdb may be used.
6. Do not use Wikipedia as the only source.

Rules:
- Return only JSON matching the requested schema. No markdown.
- artist.name must use the official native-script name whenever one exists. For Japanese artists use Japanese kanji/kana, and for Chinese artists use Chinese characters.
- Put a Latin-script romanization in artist.nameRomaji and Japanese phonetic kana in artist.nameKana when available.
- Preserve collaboration credits such as "Miho Nakayama & WANDS" in artistCredit.
- Do not invent catalog numbers, dates, covers, or source URLs.
- coverImageUrl may only be filled when a real source explicitly provides the cover image URL.
- If catalogNumber is missing, set confidence no higher than MEDIUM and include a warning.
- If sources are missing, set confidence to LOW and include a warning.
- If all sources are Wikipedia or wiki-derived, set confidence no higher than MEDIUM and include a warning.
- Under ORIGINAL_CD scope, LP, Vinyl, record, cassette, tape, DVD, and Blu-ray formats must be excluded by default.
- If a release is a reissue and excludeReissues is true, set isExcludedByDefault to true.
- Each release should include at least one source when possible.

JSON schema:
{
  "artist": {
    "name": string,
    "nameKana": string | null,
    "nameRomaji": string | null,
    "country": string,
    "officialSiteUrl": string | null
  },
  "collectionScope": {
    "target": "ORIGINAL_CD" | "ALL_CD" | "ALL_PHYSICAL",
    "excludeReissues": boolean,
    "includeCollaborations": boolean
  },
  "releases": [
    {
      "title": string,
      "titleOriginal": string | null,
      "category": "ORIGINAL_ALBUM" | "SINGLE" | "BEST" | "COLLECTION" | "LIVE" | "REMIX" | "BOX" | "EP" | "OTHER",
      "artistCredit": string,
      "releaseDate": string | null,
      "originalReleaseDate": string | null,
      "format": string | null,
      "catalogNumber": string | null,
      "barcode": string | null,
      "label": string | null,
      "originalPrice": string | null,
      "editionType": string | null,
      "isReissue": boolean | null,
      "isRemaster": boolean | null,
      "isExcludedByDefault": boolean,
      "coverImageUrl": string | null,
      "coverImageSourceUrl": string | null,
      "notes": string | null,
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "warnings": string[],
      "sources": [
        {
          "title": string,
          "url": string,
          "sourceType": "official" | "retailer" | "database" | "news" | "other"
        }
      ]
    }
  ],
  "globalWarnings": string[]
}`;
}

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

function outputTextFromResponse(response: unknown) {
  const maybe = response as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };

  if (maybe.output_text) {
    return maybe.output_text;
  }

  return (
    maybe.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join("\n") ?? ""
  );
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
  if (capabilities.responsesSupport === "unsupported" || capabilities.webSearchSupport === "unsupported") {
    return { primary: "public-metadata" as const, nativeCapability: "unsupported" as const };
  }
  if (capabilities.responsesSupport === "supported" && capabilities.webSearchSupport === "supported") {
    return { primary: "native-web-search" as const, nativeCapability: "supported" as const };
  }
  return { primary: "native-web-search" as const, nativeCapability: "unknown" as const };
}

class MissingNativeWebSearchCallError extends Error {
  constructor() {
    super("The AI provider returned no web_search call, so the native result was rejected as offline-only.");
    this.name = "MissingNativeWebSearchCallError";
  }
}

function researchErrorKind(error: unknown) {
  if (error instanceof MissingNativeWebSearchCallError || isResponsesEndpointUnsupportedError(error)) {
    return "native-search-unsupported";
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/402|429|quota|credit|billing|rate.?limit/.test(message)) return "quota";
  if (/401|403|api.?key|unauthori[sz]ed|forbidden|authentication/.test(message)) return "authentication";
  if (/model.*(?:not found|unsupported|unavailable)|no such model/.test(message)) return "model";
  if (/json|parse|schema|no json object|output/.test(message)) return "invalid-output";
  return "transport";
}

function sanitizedResearchError(error: unknown, apiKeyOverride?: string) {
  return sanitizeErrorMessage(
    error instanceof Error ? error.message : "Release research failed.",
    apiKeyOverride ?? process.env.OPENAI_API_KEY,
  ).slice(0, 2_000);
}

function withPublicFallbackWarning(
  result: ReleaseResearchResult,
  reason: "declared-unsupported" | ReturnType<typeof researchErrorKind>,
) {
  const warning = reason === "declared-unsupported"
    ? "中转站已明确标记为不支持原生 Responses/web_search，本次直接使用公共资料源。"
    : `原生 web_search 未完成（${reason}），本次已改用公共资料源。`;
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
    let nativeError: unknown = null;

    if (strategy.primary === "native-web-search") {
      await updateResearchProgress(taskId, 24, "正在尝试中转站原生 web_search");
      try {
        const response = await createWebSearchResponse(
          {
            forceSearch: true,
            systemPrompt:
              "You are a meticulous discography researcher for physical CD collectors. Use web_search and return strict JSON only.",
            userPrompt: buildResearchPrompt(validatedInput),
          },
          apiKeyOverride,
        );

        if (!hasWebSearchCall(response)) throw new MissingNativeWebSearchCallError();

        await updateResearchProgress(taskId, 68, "正在解析和校验原生搜索结果");
        const rawText = outputTextFromResponse(response);
        const parsed = parseReleaseResearchResponse(rawText);

        await updateResearchProgress(taskId, 80, "正在补全原文艺人名与发行封面");
        const enriched = await enrichReleaseResearchResultWithItunes(parsed, {
          artistQuery: validatedInput.artistName,
        });

        await updateResearchProgress(taskId, 94, "正在保存原生搜索候选资料");
        const task = await prisma.aiSearchTask.update({
          where: { id: taskId },
          data: {
            status: "SUCCEEDED",
            rawResult: {
              mode: "native-web-search",
              outputText: rawText,
              response: toJsonSafe(response),
            } satisfies Prisma.InputJsonObject,
            parsedResult: toJsonSafe(enriched),
          },
        });

        return toTaskView(task);
      } catch (error) {
        nativeError = error;
      }
    }

    await updateResearchProgress(taskId, 36, "正在查询 MusicBrainz 公共发行资料");
    const publicResearch = await researchPublicMetadataReleases(
      validatedInput,
      apiKeyOverride,
    );
    const fallbackReason = strategy.nativeCapability === "unsupported"
      ? "declared-unsupported" as const
      : researchErrorKind(nativeError);
    const publicResult = withPublicFallbackWarning(publicResearch.result, fallbackReason);
    const fallbackMessage = nativeError ? sanitizedResearchError(nativeError, apiKeyOverride) : null;
    failureTrace = {
      mode: PUBLIC_METADATA_RESEARCH_MODE,
      fallbackReason: {
        kind: fallbackReason,
        message: fallbackMessage,
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
      throw new Error(
        nativeError
          ? `Native search failed (${researchErrorKind(nativeError)}) and public metadata sources returned no deterministic release candidates.`
          : "Public metadata sources returned no deterministic release candidates.",
      );
    }

    await updateResearchProgress(taskId, 76, "正在校验公共资料来源与字段");
    const enriched = await enrichReleaseResearchResultWithItunes(publicResult, {
      artistQuery: validatedInput.artistName,
    });
    await updateResearchProgress(taskId, 94, "正在保存公共资料源候选");

    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        rawResult: failureTrace,
        parsedResult: toJsonSafe(enriched),
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

function toDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveArtist(
  input: ReleaseResearchImportInput,
  parsed: ReleaseResearchResult,
  db: Prisma.TransactionClient,
) {
  if (input.artistMode === "existing" && input.artistId) {
    return db.artist.findUniqueOrThrow({ where: { id: input.artistId } });
  }

  const name = (input.artistName ?? parsed.artist.name).trim();
  if (!name) throw new Error("artistName is required.");

  const existing = await db.artist.findFirst({ where: { name } });
  if (existing) return existing;

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

  const selected = new Set(validatedInput.selectedCandidateIds);
  const excluded = new Set(validatedInput.excludedCandidateIds);
  const pendingReview = new Set(validatedInput.pendingReviewCandidateIds);
  const candidateIds = new Set(parsed.releases.map((candidate) => candidate.id));
  const unknownSelectedId = validatedInput.selectedCandidateIds.find((candidateId) => !candidateIds.has(candidateId));
  if (unknownSelectedId) throw new Error(`Unknown release candidate: ${unknownSelectedId}`);

  const candidates = parsed.releases.map((candidate) => {
    const edit = validatedInput.candidateEdits[candidate.id];
    if (!edit) return candidate;

    const coverImageSourceUrl =
      edit.coverImageUrl === candidate.coverImageUrl
        ? candidate.coverImageSourceUrl
        : null;

    return {
      ...applyReleaseQualityGate(
        { ...candidate, ...edit, coverImageSourceUrl },
        {
          target: parsed.collectionScope.target,
          excludeReissues: parsed.collectionScope.excludeReissues,
        },
      ),
      id: candidate.id,
    };
  });

  return prisma.$transaction(async (tx) => {
    const artist = await resolveArtist(validatedInput, parsed, tx);
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
    let skippedDuplicates = 0;
    let pendingReviewCount = 0;
    let excludedCount = 0;

    for (const candidate of candidates) {
      if (!selected.has(candidate.id)) {
        continue;
      }

      const forcedPendingReview =
        pendingReview.has(candidate.id) ||
        candidate.confidence !== "HIGH" ||
        !candidate.catalogNumber ||
        candidate.sources.length === 0 ||
        candidate.warnings.some((warning) => warning.includes("PENDING_REVIEW"));
      const forcedExcluded = excluded.has(candidate.id) || candidate.isExcludedByDefault;

      if (candidate.catalogNumber) {
        const duplicate = await tx.release.findFirst({
          where: {
            artistId: artist.id,
            title: candidate.title,
            originalCatalogNo: candidate.catalogNumber,
          },
          select: { id: true },
        });

        if (duplicate) {
          skippedDuplicates += 1;
          continue;
        }
      }

      const release = await tx.release.create({
        data: {
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
          notes: candidateNotes(candidate, forcedPendingReview),
          coverImageUrl: candidate.coverImageUrl,
        },
      });

      await tx.userReleaseStatus.create({
        data: {
          userId,
          releaseId: release.id,
          status: forcedExcluded ? "EXCLUDED" : forcedPendingReview ? "PENDING_REVIEW" : "NOT_OWNED",
          priority: candidate.confidence === "HIGH" ? 2 : candidate.confidence === "MEDIUM" ? 3 : 5,
          notes: forcedPendingReview ? "PENDING_REVIEW" : null,
        },
      });

      const uniqueSources = buildImportedReleaseSourceRows(
        candidate.sources,
        candidate.coverImageSourceUrl,
      );

      if (uniqueSources.length > 0) {
        await tx.releaseSource.createMany({
          data: uniqueSources.map((source) => ({
            releaseId: release.id,
            url: source.url,
            label: source.label,
            description: source.description,
          })),
        });
      }

      imported += 1;
      if (forcedPendingReview) pendingReviewCount += 1;
      if (forcedExcluded) excludedCount += 1;
    }

    await tx.aiSearchTask.update({
      where: { id: taskId },
      data: { artistId: artist.id },
    });

    return {
      artistId: artist.id,
      imported,
      skippedDuplicates,
      pendingReview: pendingReviewCount,
      excluded: excludedCount,
    };
  }, { maxWait: 5_000, timeout: 30_000 });
}

function hasWebSearchCall(response: unknown) {
  const output = (response as { output?: Array<{ type?: string }> }).output;
  return output?.some((item) => item.type === "web_search_call") ?? false;
}
