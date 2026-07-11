import type { ArtistStats, ReleaseListItem } from "@/lib/releases/release-types";
import { hasPendingReviewWarning } from "@/lib/releases/release-filters";
import { releaseEvidenceSources } from "@/lib/releases/cover-source";

const categoryGroups = [
  { key: "ORIGINAL_ALBUM", label: "ORIGINAL_ALBUM", categories: ["ORIGINAL_ALBUM"] },
  { key: "SINGLE", label: "SINGLE", categories: ["SINGLE"] },
  { key: "BEST_COLLECTION", label: "BEST / COLLECTION", categories: ["BEST", "COLLECTION", "COMPILATION"] },
  { key: "LIVE", label: "LIVE", categories: ["LIVE"] },
  { key: "REMIX", label: "REMIX", categories: ["REMIX"] },
  { key: "OTHER", label: "OTHER", categories: ["BOX", "EP", "OTHER"] },
];

function isExcluded(release: ReleaseListItem) {
  return release.isExcludedByDefault || release.userStatus?.status === "EXCLUDED";
}

function isOwned(release: ReleaseListItem) {
  return release.userStatus?.status === "OWNED";
}

function rate(owned: number, total: number) {
  return total === 0 ? 0 : Math.round((owned / total) * 100);
}

export function computeArtistStats(releases: ReleaseListItem[]): ArtistStats {
  const denominator = releases.filter((release) => !isExcluded(release));
  const ownedDenominator = denominator.filter(isOwned);

  return {
    total: releases.length,
    owned: releases.filter(isOwned).length,
    notOwned: releases.filter((release) => release.userStatus?.status === "NOT_OWNED").length,
    wanted: releases.filter((release) => release.userStatus?.status === "WANTED").length,
    pendingReview: releases.filter(
      (release) => release.userStatus?.status === "PENDING_REVIEW" || hasPendingReviewWarning(release),
    ).length,
    excluded: releases.filter(isExcluded).length,
    missingCover: releases.filter((release) => !release.coverImageUrl).length,
    missingSource: releases.filter(
      (release) => releaseEvidenceSources(release.sources).length === 0,
    ).length,
    missingCatalog: releases.filter((release) => !release.originalCatalogNo).length,
    completionRate: rate(ownedDenominator.length, denominator.length),
    categoryCompletion: categoryGroups.map((group) => {
      const rows = denominator.filter((release) => group.categories.includes(release.category));
      const owned = rows.filter(isOwned).length;
      return {
        key: group.key,
        label: group.label,
        owned,
        total: rows.length,
        rate: rate(owned, rows.length),
      };
    }),
  };
}
