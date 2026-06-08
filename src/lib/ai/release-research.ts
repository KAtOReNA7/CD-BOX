import type { AiSearchTask, Prisma, ReleaseFormat } from "@prisma/client";
import { aiConfig, createWebSearchResponse } from "@/lib/ai/client";
import { assertCanUseWebSearch, getConfiguredProviderCapabilities } from "@/lib/ai/provider-capabilities";
import { parseReleaseResearchResponse } from "@/lib/ai/release-research-parser";
import type {
  AiSearchTaskView,
  ReleaseResearchCandidate,
  ReleaseResearchImportInput,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import { prisma } from "@/lib/db/prisma";

function buildResearchPrompt(input: ReleaseResearchRequest) {
  return `Research physical CD releases for a Japanese artist collection database.

Artist: ${input.artistName}
Country/region: ${input.country}
Collection scope: ${input.target}
Exclude reissues: ${input.excludeReissues}
Include collaborations: ${input.includeCollaborations}
Include Live / Remix / Best: ${input.includeLiveRemixBest}

Search strategy:
1. Prefer official artist discography and label pages.
2. Then use King Records, Sony Music, Universal Music Japan, Avex, Victor, and other label pages.
3. Then use Tower Records, HMV, CDJapan, CDJournal, ORICON.
4. For ACG, voice actor, or game music, VGMdb may be used.
5. Do not use Wikipedia as the only source.

Rules:
- Return only JSON matching the requested schema. No markdown.
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
    query: task.query,
    model: task.model,
    errorMessage: task.errorMessage,
    rawResult: task.rawResult,
    parsedResult: task.parsedResult as ReleaseResearchResult | null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
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

export async function createAndRunReleaseResearchTask(input: ReleaseResearchRequest, userId: string) {
  assertCanUseWebSearch(getConfiguredProviderCapabilities());

  const task = await prisma.aiSearchTask.create({
    data: {
      userId,
      query: JSON.stringify(input),
      model: aiConfig.textModel,
      status: "QUEUED",
    },
  });

  return runReleaseResearchTask(task.id, input);
}

export async function runReleaseResearchTask(taskId: string, input: ReleaseResearchRequest) {
  assertCanUseWebSearch(getConfiguredProviderCapabilities());

  await prisma.aiSearchTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", errorMessage: null },
  });

  try {
    const response = await createWebSearchResponse({
      forceSearch: true,
      systemPrompt:
        "You are a meticulous discography researcher for physical CD collectors. Use web_search and return strict JSON only.",
      userPrompt: buildResearchPrompt(input),
    });
    const rawText = outputTextFromResponse(response);
    const parsed = parseReleaseResearchResponse(rawText);

    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        rawResult: {
          outputText: rawText,
          response: toJsonSafe(response),
        } satisfies Prisma.InputJsonObject,
        parsedResult: toJsonSafe(parsed),
      },
    });

    return toTaskView(task);
  } catch (error) {
    const task = await prisma.aiSearchTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Release research failed.",
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

async function resolveArtist(input: ReleaseResearchImportInput, parsed: ReleaseResearchResult) {
  if (input.artistMode === "existing" && input.artistId) {
    return prisma.artist.findUniqueOrThrow({ where: { id: input.artistId } });
  }

  const name = (input.artistName ?? parsed.artist.name).trim();
  const existing = await prisma.artist.findFirst({ where: { name } });
  if (existing) return existing;

  return prisma.artist.create({
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

  const artist = await resolveArtist(input, parsed);
  const selected = new Set(input.selectedCandidateIds);
  const excluded = new Set(input.excludedCandidateIds);
  const pendingReview = new Set(input.pendingReviewCandidateIds);
  let imported = 0;
  let skippedDuplicates = 0;
  let pendingReviewCount = 0;
  let excludedCount = 0;

  for (const candidate of parsed.releases) {
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
      const duplicate = await prisma.release.findFirst({
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

    const release = await prisma.release.create({
      data: {
        artistId: artist.id,
        category: candidate.category,
        title: candidate.title,
        originalReleaseDate: toDate(candidate.originalReleaseDate ?? candidate.releaseDate),
        format: normalizeFormat(candidate.format),
        originalCatalogNo: candidate.catalogNumber,
        label: candidate.label,
        isReissue: candidate.isReissue ?? false,
        notes: candidateNotes(candidate, forcedPendingReview),
        coverImageUrl: candidate.coverImageUrl,
      },
    });

    await prisma.userReleaseStatus.create({
      data: {
        userId,
        releaseId: release.id,
        status: forcedExcluded ? "EXCLUDED" : "UNKNOWN",
        priority: candidate.confidence === "HIGH" ? 2 : candidate.confidence === "MEDIUM" ? 3 : 5,
        notes: forcedPendingReview ? "PENDING_REVIEW" : null,
      },
    });

    const sourceRows = [
      ...candidate.sources,
      candidate.coverImageSourceUrl
        ? {
            title: "Cover image source",
            url: candidate.coverImageSourceUrl,
            sourceType: "other" as const,
          }
        : null,
    ].filter((source): source is NonNullable<typeof source> => Boolean(source));

    for (const source of sourceRows) {
      await prisma.releaseSource.create({
        data: {
          releaseId: release.id,
          url: source.url,
          label: source.title,
          description: source.sourceType,
        },
      });
    }

    imported += 1;
    if (forcedPendingReview) pendingReviewCount += 1;
    if (forcedExcluded) excludedCount += 1;
  }

  await prisma.aiSearchTask.update({
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
}
