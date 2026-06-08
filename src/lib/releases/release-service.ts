import type { Prisma, Release, ReleaseSource, UserReleaseStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  collectionStatuses,
  releaseCategories,
  releaseFormats,
  type BulkUpdateInput,
  type ReleaseFilters,
  type ReleaseListItem,
  type ReleasePatchInput,
  type ReleaseStatusPatchInput,
} from "@/lib/releases/release-types";
import { filterReleases } from "@/lib/releases/release-filters";
import { computeArtistStats } from "@/lib/releases/release-stats";

type DbRelease = Release & {
  sources: ReleaseSource[];
  userStatus: UserReleaseStatus[];
};

function toDate(value: string | null | undefined) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("releaseDate must be YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("releaseDate is invalid.");
  }
  return date;
}

function textOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function boolValue(value: unknown) {
  return value === true || value === "true";
}

export function normalizeStatus(value: unknown) {
  if (collectionStatuses.includes(value as (typeof collectionStatuses)[number])) {
    return value as (typeof collectionStatuses)[number];
  }
  throw new Error("Invalid collection status.");
}

export function parseReleasePatchInput(body: Record<string, unknown>): ReleasePatchInput {
  const input: ReleasePatchInput = {};

  if ("title" in body) {
    const title = textOrNull(body.title);
    if (!title) throw new Error("title is required.");
    input.title = title;
  }
  if ("category" in body) {
    if (!releaseCategories.includes(body.category as never)) throw new Error("Invalid category.");
    input.category = body.category as ReleasePatchInput["category"];
  }
  if ("releaseDate" in body) input.releaseDate = textOrNull(body.releaseDate);
  if ("format" in body) {
    if (!releaseFormats.includes(body.format as never)) throw new Error("Invalid format.");
    input.format = body.format as ReleasePatchInput["format"];
  }
  if ("catalogNumber" in body) input.catalogNumber = textOrNull(body.catalogNumber);
  if ("label" in body) input.label = textOrNull(body.label);
  if ("originalPrice" in body) input.originalPrice = textOrNull(body.originalPrice);
  if ("editionType" in body) input.editionType = textOrNull(body.editionType);
  if ("isReissue" in body) input.isReissue = boolValue(body.isReissue);
  if ("isRemaster" in body) input.isRemaster = boolValue(body.isRemaster);
  if ("isExcludedByDefault" in body) input.isExcludedByDefault = boolValue(body.isExcludedByDefault);
  if ("coverImageUrl" in body) input.coverImageUrl = textOrNull(body.coverImageUrl);
  if ("notes" in body) input.notes = textOrNull(body.notes);

  return input;
}

export function parseStatusPatchInput(body: Record<string, unknown>): ReleaseStatusPatchInput {
  const input: ReleaseStatusPatchInput = {};
  if ("status" in body) input.status = normalizeStatus(body.status);
  if ("priority" in body) {
    const priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error("priority must be an integer from 1 to 5.");
    }
    input.priority = priority;
  }
  if ("ownedCondition" in body) input.ownedCondition = textOrNull(body.ownedCondition);
  if ("ownedNotes" in body) input.ownedNotes = textOrNull(body.ownedNotes);
  return input;
}

export function parseBulkUpdateInput(body: Record<string, unknown>): BulkUpdateInput {
  const releaseIds = Array.isArray(body.releaseIds) ? body.releaseIds.map(String).filter(Boolean) : [];
  if (releaseIds.length === 0) throw new Error("releaseIds is required.");

  const artistId = textOrNull(body.artistId);
  if (!artistId) throw new Error("artistId is required.");

  const input: BulkUpdateInput = {
    artistId,
    releaseIds,
  };

  if ("status" in body && body.status) input.status = normalizeStatus(body.status);
  if ("priority" in body && body.priority !== null && body.priority !== "") {
    const priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error("priority must be an integer from 1 to 5.");
    }
    input.priority = priority;
  }
  if ("isExcludedByDefault" in body && body.isExcludedByDefault !== null) {
    input.isExcludedByDefault = boolValue(body.isExcludedByDefault);
  }

  if (!input.status && input.priority === undefined && input.isExcludedByDefault === undefined) {
    throw new Error("No bulk update operation was provided.");
  }

  return input;
}

function warningsToStrings(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.map(String) : [];
}

export function serializeRelease(release: DbRelease, userId?: string | null): ReleaseListItem {
  const status = userId ? release.userStatus.find((item) => item.userId === userId) : release.userStatus[0];
  return {
    id: release.id,
    artistId: release.artistId,
    category: release.category,
    title: release.title,
    originalReleaseDate: release.originalReleaseDate?.toISOString().slice(0, 10) ?? null,
    format: release.format,
    originalCatalogNo: release.originalCatalogNo,
    label: release.label,
    originalPrice: release.originalPrice,
    editionType: release.editionType,
    isReissue: release.isReissue,
    isRemaster: release.isRemaster,
    isExcludedByDefault: release.isExcludedByDefault,
    confidence: release.confidence,
    warnings: warningsToStrings(release.warnings),
    notes: release.notes,
    coverImageUrl: release.coverImageUrl,
    sources: release.sources.map((source) => ({
      id: source.id,
      url: source.url,
      label: source.label,
      description: source.description,
    })),
    userStatus: status
      ? {
          id: status.id,
          status: status.status,
          priority: status.priority,
          ownedCondition: status.ownedCondition,
          ownedNotes: status.ownedNotes,
          notes: status.notes,
        }
      : null,
  };
}

export async function getArtistLibrary(artistId: string, userId?: string | null, filters: ReleaseFilters = {}) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      releases: {
        orderBy: [{ originalReleaseDate: "asc" }, { title: "asc" }],
        include: {
          sources: true,
          userStatus: userId ? { where: { userId } } : true,
        },
      },
    },
  });

  if (!artist) return null;

  const releases = artist.releases.map((release) => serializeRelease(release, userId));
  const filteredReleases = filterReleases(releases, filters);

  return {
    artist: {
      id: artist.id,
      name: artist.name,
      description: artist.description,
      country: artist.country,
    },
    releases,
    filteredReleases,
    stats: computeArtistStats(releases),
  };
}

export async function getReleaseDetailView(releaseId: string, userId?: string | null) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      artist: true,
      sources: true,
      userStatus: userId ? { where: { userId } } : true,
    },
  });

  return release ? { release: serializeRelease(release, userId), artist: release.artist } : null;
}

export async function updateRelease(releaseId: string, input: ReleasePatchInput) {
  const existing = await prisma.release.findUniqueOrThrow({
    where: { id: releaseId },
    select: { artistId: true },
  });
  const duplicate =
    input.catalogNumber === undefined || input.catalogNumber === null
      ? null
      : await prisma.release.findFirst({
          where: {
            artistId: existing.artistId,
            originalCatalogNo: input.catalogNumber,
            id: { not: releaseId },
          },
          select: { id: true, title: true },
        });

  const release = await prisma.release.update({
    where: { id: releaseId },
    data: {
      title: input.title,
      category: input.category,
      originalReleaseDate: input.releaseDate === undefined ? undefined : toDate(input.releaseDate),
      format: input.format,
      originalCatalogNo: input.catalogNumber,
      label: input.label,
      originalPrice: input.originalPrice,
      editionType: input.editionType,
      isReissue: input.isReissue,
      isRemaster: input.isRemaster,
      isExcludedByDefault: input.isExcludedByDefault,
      coverImageUrl: input.coverImageUrl,
      notes: input.notes,
    },
    include: { sources: true, userStatus: true },
  });

  return {
    release: serializeRelease(release),
    duplicateCatalogWarning: duplicate ? `Catalog number already exists on "${duplicate.title}".` : null,
  };
}

export async function updateUserReleaseStatus(releaseId: string, userId: string, input: ReleaseStatusPatchInput) {
  const release = await prisma.release.findUniqueOrThrow({ where: { id: releaseId }, select: { id: true } });
  const status = await prisma.userReleaseStatus.upsert({
    where: {
      userId_releaseId: {
        userId,
        releaseId: release.id,
      },
    },
    update: {
      status: input.status,
      priority: input.priority,
      ownedCondition: input.ownedCondition,
      ownedNotes: input.ownedNotes,
    },
    create: {
      userId,
      releaseId: release.id,
      status: input.status ?? "UNKNOWN",
      priority: input.priority ?? 3,
      ownedCondition: input.ownedCondition,
      ownedNotes: input.ownedNotes,
    },
  });

  return status;
}

export async function bulkUpdateReleases(userId: string, input: BulkUpdateInput) {
  const releases = await prisma.release.findMany({
    where: {
      artistId: input.artistId,
      id: { in: input.releaseIds },
    },
    select: { id: true },
  });
  const releaseIds = releases.map((release) => release.id);

  if (releaseIds.length === 0) {
    return { updatedStatuses: 0, updatedReleases: 0 };
  }

  let updatedStatuses = 0;
  if (input.status || input.priority !== undefined) {
    for (const releaseId of releaseIds) {
      await prisma.userReleaseStatus.upsert({
        where: { userId_releaseId: { userId, releaseId } },
        update: {
          status: input.status,
          priority: input.priority,
        },
        create: {
          userId,
          releaseId,
          status: input.status ?? "UNKNOWN",
          priority: input.priority ?? 3,
        },
      });
      updatedStatuses += 1;
    }
  }

  const releaseUpdate =
    input.isExcludedByDefault === undefined
      ? { count: 0 }
      : await prisma.release.updateMany({
          where: {
            artistId: input.artistId,
            id: { in: releaseIds },
          },
          data: { isExcludedByDefault: input.isExcludedByDefault },
        });

  return {
    updatedStatuses,
    updatedReleases: releaseUpdate.count,
  };
}

export async function addReleaseSource(releaseId: string, input: { url: string; label?: string | null }) {
  const url = textOrNull(input.url);
  if (!url) throw new Error("url is required.");

  return prisma.releaseSource.create({
    data: {
      releaseId,
      url,
      label: textOrNull(input.label) ?? "Manual source",
    },
  });
}

export async function deleteReleaseSource(releaseId: string, sourceId: string) {
  await prisma.releaseSource.deleteMany({
    where: {
      id: sourceId,
      releaseId,
    },
  });
}
