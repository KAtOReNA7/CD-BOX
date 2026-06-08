import { prisma } from "@/lib/db/prisma";

export async function listDashboardArtists() {
  return prisma.artist.findMany({
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: {
      _count: {
        select: { releases: true, follows: true },
      },
    },
  });
}

export async function getArtistWithReleases(id: string) {
  return prisma.artist.findUnique({
    where: { id },
    include: {
      releases: {
        orderBy: [{ originalReleaseDate: "asc" }, { title: "asc" }],
        include: {
          sources: true,
          userStatus: true,
        },
      },
    },
  });
}
