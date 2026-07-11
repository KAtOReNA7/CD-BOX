import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ArtistCreateInput } from "@/lib/artists/artist-input";

const verifiedReleaseWhere = {
  verificationStatus: "VERIFIED",
  coverImageUrl: { not: null },
  verificationEvidence: { not: Prisma.DbNull },
  verifiedAt: { not: null },
} satisfies Prisma.ReleaseWhereInput;

export async function createFollowedArtist(userId: string, input: ArtistCreateInput) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const existing = await transaction.artist.findFirst({
          where: {
            name: {
              equals: input.name,
              mode: "insensitive",
            },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        if (existing) {
          await transaction.userArtistFollow.upsert({
            where: {
              userId_artistId: {
                userId,
                artistId: existing.id,
              },
            },
            create: {
              userId,
              artistId: existing.id,
            },
            update: {},
          });

          return { artistId: existing.id, created: false };
        }

        const artist = await transaction.artist.create({
          data: {
            name: input.name,
            sortName: input.sortName ?? null,
            country: input.country ?? null,
            description: input.description ?? null,
            follows: {
              create: { userId },
            },
          },
          select: { id: true },
        });

        return { artistId: artist.id, created: true };
      }, {
        isolationLevel: "Serializable",
        // A newly started PostgreSQL connection can exceed Prisma's 2-second default.
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      const isRetryableTransactionError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "P2034" || error.code === "P2028");

      if (!isRetryableTransactionError || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Artist creation retry limit reached.");
}

export async function listDashboardArtists() {
  return prisma.artist.findMany({
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: {
      _count: {
        select: {
          releases: {
            where: verifiedReleaseWhere,
          },
          follows: true,
        },
      },
    },
  });
}

export async function getDashboardStats() {
  const [artistCount, releaseCount, followCount] = await prisma.$transaction([
    prisma.artist.count(),
    prisma.release.count({ where: verifiedReleaseWhere }),
    prisma.userArtistFollow.count(),
  ]);

  return { artistCount, releaseCount, followCount };
}

export async function listArtistOptions() {
  return prisma.artist.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
    },
  });
}
