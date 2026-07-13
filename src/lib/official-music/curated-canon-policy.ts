export type CuratedCatalogStatus = "active" | "fixed";

export const curatedHistoricalNonCanonicalReasonCode =
  "CURATED_HISTORICAL_NON_CANONICAL_WORK" as const;
export const curatedCanonicalTitleDateConflictReasonCode =
  "CURATED_CANONICAL_TITLE_DATE_CONFLICT" as const;

export type CuratedHistoricalCanonOutOfScopeReasonCode =
  | typeof curatedHistoricalNonCanonicalReasonCode
  | typeof curatedCanonicalTitleDateConflictReasonCode;

export type CuratedHistoricalCanonBoundaryDecision =
  | {
      outcome: "CANONICAL_MEMBER";
      reasonCode: null;
    }
  | {
      outcome: "POST_CUTOFF_NEW_WORK";
      reasonCode: null;
    }
  | {
      outcome: "OUT_OF_SCOPE";
      reasonCode: CuratedHistoricalCanonOutOfScopeReasonCode;
    };

function realIsoDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/**
 * A partial or invalid original date can never prove that an unlisted work was
 * released after an active catalogue's authority cutoff.
 */
export function isCompleteOriginalReleaseDateAfterAsOf(
  originalReleaseDate: string | null | undefined,
  asOf: string,
) {
  const date = realIsoDate(originalReleaseDate);
  const cutoff = realIsoDate(asOf);
  return Boolean(date && cutoff && date > cutoff);
}

/**
 * Shared closed-history boundary policy. Callers remain responsible for
 * proving that the baseline is a complete, category-specific work manifest.
 */
export function evaluateCuratedHistoricalCanonBoundary(input: {
  catalogStatus: CuratedCatalogStatus;
  isCanonicalMember: boolean;
  hasCanonicalTitleDateConflict: boolean;
  originalReleaseDate: string | null | undefined;
  asOf: string;
}): CuratedHistoricalCanonBoundaryDecision {
  if (input.isCanonicalMember) {
    return { outcome: "CANONICAL_MEMBER", reasonCode: null };
  }
  // A known canonical title/alias with a different or incomplete original
  // date is conflicting evidence, not proof of a later new work. This blocks a
  // separately-grouped reissue from bypassing an active catalogue cutoff by
  // presenting its edition date as the work's original date.
  if (input.hasCanonicalTitleDateConflict) {
    return {
      outcome: "OUT_OF_SCOPE",
      reasonCode: curatedCanonicalTitleDateConflictReasonCode,
    };
  }
  if (input.catalogStatus === "active" &&
    isCompleteOriginalReleaseDateAfterAsOf(input.originalReleaseDate, input.asOf)) {
    return { outcome: "POST_CUTOFF_NEW_WORK", reasonCode: null };
  }
  return {
    outcome: "OUT_OF_SCOPE",
    reasonCode: curatedHistoricalNonCanonicalReasonCode,
  };
}
