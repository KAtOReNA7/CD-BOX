import type {
  CollectionScopeTarget,
  ReleaseResearchCandidate,
  ReleaseResearchResult,
  ResearchConfidence,
} from "@/lib/ai/release-research-types";

const nonCdFormatPattern =
  /\b(lp|vinyl|cassette|tape|dvd|blu[-\s]?ray)\b|レコード|カセット|テープ|ブルーレイ/i;

function capConfidence(confidence: ResearchConfidence, max: ResearchConfidence): ResearchConfidence {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return rank[confidence] > rank[max] ? max : confidence;
}

function hasWarning(warnings: string[], needle: string) {
  return warnings.some((warning) => warning.toLowerCase().includes(needle.toLowerCase()));
}

function isWikiSource(url: string, title: string) {
  return /wikipedia\.org|wikidata\.org/i.test(url) || /wikipedia|wiki/i.test(title);
}

function isNonCdPhysical(format: string | null) {
  return Boolean(format && nonCdFormatPattern.test(format));
}

export function applyReleaseQualityGate(
  release: Omit<ReleaseResearchCandidate, "id"> | ReleaseResearchCandidate,
  options: {
    target: CollectionScopeTarget;
    excludeReissues: boolean;
  },
) {
  const warnings = [...release.warnings];
  let confidence = release.confidence;
  let isExcludedByDefault = release.isExcludedByDefault;
  let pendingReview = false;

  if (!release.catalogNumber) {
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
    if (!hasWarning(warnings, "catalogNumber")) {
      warnings.push("PENDING_REVIEW: missing catalogNumber.");
    }
  }

  if (release.sources.length === 0) {
    confidence = "LOW";
    pendingReview = true;
    if (!hasWarning(warnings, "source")) {
      warnings.push("PENDING_REVIEW: no source URL provided.");
    }
  }

  if (
    release.sources.length > 0 &&
    release.sources.every((source) => isWikiSource(source.url, source.title))
  ) {
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
    if (!hasWarning(warnings, "only wiki source")) {
      warnings.push("PENDING_REVIEW: only wiki source.");
    }
  }

  if (options.target === "ORIGINAL_CD" && isNonCdPhysical(release.format)) {
    isExcludedByDefault = true;
    pendingReview = true;
    if (!hasWarning(warnings, "non-CD")) {
      warnings.push("EXCLUDED_BY_DEFAULT: non-CD physical format under ORIGINAL_CD scope.");
    }
  }

  if (release.isReissue === true && options.excludeReissues) {
    isExcludedByDefault = true;
    if (!hasWarning(warnings, "reissue")) {
      warnings.push("EXCLUDED_BY_DEFAULT: reissue under excludeReissues=true.");
    }
  }

  return {
    ...release,
    confidence,
    warnings,
    isExcludedByDefault,
    quality: {
      missingCatalogNumber: !release.catalogNumber,
      missingSources: release.sources.length === 0,
      wikiOnlySources:
        release.sources.length > 0 &&
        release.sources.every((source) => isWikiSource(source.url, source.title)),
      nonCdPhysicalUnderOriginalCd: options.target === "ORIGINAL_CD" && isNonCdPhysical(release.format),
      pendingReview,
      safeToImportByDefault:
        confidence === "HIGH" &&
        !isExcludedByDefault &&
        release.sources.length > 0 &&
        Boolean(release.catalogNumber),
    },
  };
}

export function applyResearchQualityGates(result: ReleaseResearchResult): ReleaseResearchResult {
  return {
    ...result,
    releases: result.releases.map((release, index) => ({
      ...applyReleaseQualityGate(release, {
        target: result.collectionScope.target,
        excludeReissues: result.collectionScope.excludeReissues,
      }),
      id: release.id || `candidate-${index + 1}`,
    })),
  };
}

export function summarizeResearchQuality(releases: ReleaseResearchCandidate[]) {
  return {
    total: releases.length,
    safeToImport: releases.filter(
      (release) =>
        release.confidence === "HIGH" &&
        !release.isExcludedByDefault &&
        release.sources.length > 0 &&
        Boolean(release.catalogNumber),
    ).length,
    pendingReview: releases.filter((release) =>
      release.warnings.some((warning) => warning.includes("PENDING_REVIEW")),
    ).length,
    missingCatalog: releases.filter((release) => !release.catalogNumber).length,
    missingSources: releases.filter((release) => release.sources.length === 0).length,
    defaultExcluded: releases.filter((release) => release.isExcludedByDefault).length,
  };
}
