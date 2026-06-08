import type { ReleaseFilters, ReleaseListItem } from "@/lib/releases/release-types";

function includesText(value: string | null | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query);
}

function releaseYear(release: ReleaseListItem) {
  return release.originalReleaseDate ? Number(release.originalReleaseDate.slice(0, 4)) : null;
}

function decadeBounds(decade: ReleaseFilters["decade"]) {
  if (decade === "1980s") return [1980, 1989] as const;
  if (decade === "1990s") return [1990, 1999] as const;
  if (decade === "2000s") return [2000, 2009] as const;
  return null;
}

export function hasPendingReviewWarning(release: ReleaseListItem) {
  return release.warnings.some((warning) => warning.toLowerCase().includes("pending_review")) ||
    release.warnings.some((warning) => warning.toLowerCase().includes("pending review")) ||
    release.notes?.toLowerCase().includes("pending_review") ||
    release.notes?.toLowerCase().includes("pending review");
}

export function filterReleases(releases: ReleaseListItem[], filters: ReleaseFilters) {
  const query = filters.q?.trim().toLowerCase();
  const bounds = filters.decade === "custom"
    ? [
        filters.yearFrom ? Number(filters.yearFrom) : null,
        filters.yearTo ? Number(filters.yearTo) : null,
      ] as const
    : decadeBounds(filters.decade);

  return releases.filter((release) => {
    if (
      query &&
      !includesText(release.title, query) &&
      !includesText(release.originalCatalogNo, query) &&
      !includesText(release.notes, query)
    ) {
      return false;
    }

    if (filters.category && release.category !== filters.category) return false;
    if (filters.status && (release.userStatus?.status ?? "UNKNOWN") !== filters.status) return false;
    if (filters.confidence && (release.confidence ?? "") !== filters.confidence) return false;
    if (filters.excluded && release.isExcludedByDefault !== (filters.excluded === "true")) return false;
    if (filters.reissue && release.isReissue !== (filters.reissue === "true")) return false;
    if (filters.remaster && release.isRemaster !== (filters.remaster === "true")) return false;
    if (filters.missingCover === "true" && release.coverImageUrl) return false;
    if (filters.missingSource === "true" && release.sources.length > 0) return false;
    if (filters.missingCatalog === "true" && release.originalCatalogNo) return false;
    if (
      filters.pendingReview === "true" &&
      release.userStatus?.status !== "PENDING_REVIEW" &&
      !hasPendingReviewWarning(release)
    ) {
      return false;
    }

    if (bounds) {
      const year = releaseYear(release);
      if (!year) return false;
      const [from, to] = bounds;
      if (from && year < from) return false;
      if (to && year > to) return false;
    }

    return true;
  });
}
