import { prisma } from "@/lib/db/prisma";
import {
  type BulkUpdateInput,
  type ReleaseFilters,
  type ReleasePatchInput,
  type ReleaseStatusPatchInput,
} from "@/lib/releases/release-types";
import { serializeRelease } from "@/lib/releases/release-serialization";
import { textOrNull, toReleaseDate } from "@/lib/releases/release-validation";
import { filterReleases } from "@/lib/releases/release-filters";
import { computeArtistStats } from "@/lib/releases/release-stats";

export {
  normalizeStatus,
  parseBulkUpdateInput,
  parseReleasePatchInput,
  parseStatusPatchInput,
} from "@/lib/releases/release-validation";

export { serializeRelease } from "@/lib/releases/release-serialization";

export async function getArtistLibrary(artistId: string, userId?: string | null, filters: ReleaseFilters = {}) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      releases: {
        orderBy: [{ originalReleaseDate: "asc" }, { title: "asc" }],
        include: {
          sources: true,
          userStatus: userId ? { where: { userId } } : false,
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
      userStatus: userId ? { where: { userId } } : false,
    },
  });

  return release ? { release: serializeRelease(release, userId), artist: release.artist } : null;
}

export async function updateRelease(releaseId: string, userId: string, input: ReleasePatchInput) {
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
      originalReleaseDate: input.releaseDate === undefined ? undefined : toReleaseDate(input.releaseDate),
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
    include: {
      sources: true,
      userStatus: { where: { userId } },
    },
  });

  return {
    release: serializeRelease(release, userId),
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
      status: input.status ?? "NOT_OWNED",
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
          status: input.status ?? "NOT_OWNED",
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
