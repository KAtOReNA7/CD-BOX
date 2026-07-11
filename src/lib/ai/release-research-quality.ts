import type {
  CollectionScopeTarget,
  ReleaseResearchCandidate,
  ReleaseResearchResult,
  ResearchConfidence,
} from "@/lib/ai/release-research-types";

const cdFormatPattern = /\b(cd|8cm\s*cd)\b|cdシングル|cdアルバム/i;
const nonCdFormatPattern =
  /\b(lp|vinyl|cassette|tape|dvd|blu[-\s]?ray)\b|レコード|カセット|テープ|ブルーレイ/i;
const unknownFormatPattern = /unknown|unclear|不明|未確認|不詳/i;
const riskyWarningPattern =
  /no explicit source url|fabricated|guessed|unknown catalog|suspected hallucination|hallucination/i;
const managedQualityWarnings = new Set([
  "PENDING_REVIEW: missing catalogNumber.",
  "PENDING_REVIEW: no source URL provided.",
  "PENDING_REVIEW: only wiki source.",
  "EXCLUDED_BY_DEFAULT: non-CD format excluded under ORIGINAL_CD scope.",
  "EXCLUDED_BY_DEFAULT: reissue excluded by scope.",
  "EXCLUDED_BY_DEFAULT: remaster excluded by scope.",
  "PENDING_REVIEW: unknown release format.",
]);

function capConfidence(confidence: ResearchConfidence, max: ResearchConfidence): ResearchConfidence {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return rank[confidence] > rank[max] ? max : confidence;
}

function raiseConfidence(confidence: ResearchConfidence, min: ResearchConfidence): ResearchConfidence {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return rank[confidence] < rank[min] ? min : confidence;
}

function hasWarning(warnings: string[], needle: string) {
  return warnings.some((warning) => warning.toLowerCase().includes(needle.toLowerCase()));
}

function hasRiskyWarning(warnings: string[]) {
  return warnings.some((warning) => riskyWarningPattern.test(warning));
}

function isWikiSource(url: string, title: string) {
  return /wikipedia\.org|wikidata\.org/i.test(url) || /wikipedia|wiki/i.test(title);
}

function hasReleaseDate(release: Omit<ReleaseResearchCandidate, "id"> | ReleaseResearchCandidate) {
  return Boolean(release.originalReleaseDate || release.releaseDate);
}

function isCdFormat(format: string | null) {
  return Boolean(format && cdFormatPattern.test(format) && !nonCdFormatPattern.test(format));
}

function isUnknownFormat(format: string | null) {
  return !format || unknownFormatPattern.test(format);
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
  const warnings = release.warnings.filter((warning) => !managedQualityWarnings.has(warning));
  let confidence = release.confidence;
  let isExcludedByDefault = release.isExcludedByDefault;
  let pendingReview = false;

  const missingCatalogNumber = !release.catalogNumber;
  const missingSources = release.sources.length === 0;
  const wikiOnlySources =
    release.sources.length > 0 && release.sources.every((source) => isWikiSource(source.url, source.title));
  const nonCdPhysicalUnderOriginalCd = options.target === "ORIGINAL_CD" && isNonCdPhysical(release.format);
  const unknownFormat = isUnknownFormat(release.format);
  const incompleteStructuredFields = !hasReleaseDate(release) || !release.format || !release.label;
  const riskyWarnings = hasRiskyWarning(warnings);
  const explicitPendingReview = warnings.some((warning) => warning.includes("PENDING_REVIEW"));

  if (explicitPendingReview) {
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
  }

  if (missingCatalogNumber) {
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
    if (!hasWarning(warnings, "catalogNumber")) {
      warnings.push("PENDING_REVIEW: missing catalogNumber.");
    }
  }

  if (missingSources) {
    confidence = "LOW";
    pendingReview = true;
    if (!hasWarning(warnings, "source")) {
      warnings.push("PENDING_REVIEW: no source URL provided.");
    }
  }

  if (wikiOnlySources) {
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
    if (!hasWarning(warnings, "only wiki source")) {
      warnings.push("PENDING_REVIEW: only wiki source.");
    }
  }

  if (nonCdPhysicalUnderOriginalCd) {
    isExcludedByDefault = true;
    confidence = capConfidence(confidence, "MEDIUM");
    pendingReview = true;
    if (!hasWarning(warnings, "non-CD")) {
      warnings.push("EXCLUDED_BY_DEFAULT: non-CD format excluded under ORIGINAL_CD scope.");
    }
  }

  if (release.isReissue === true && options.excludeReissues) {
    isExcludedByDefault = true;
    confidence = capConfidence(confidence, "MEDIUM");
    if (!hasWarning(warnings, "reissue excluded by scope")) {
      warnings.push("EXCLUDED_BY_DEFAULT: reissue excluded by scope.");
    }
  }

  if (release.isRemaster === true && options.excludeReissues) {
    isExcludedByDefault = true;
    confidence = capConfidence(confidence, "MEDIUM");
    if (!hasWarning(warnings, "remaster excluded by scope")) {
      warnings.push("EXCLUDED_BY_DEFAULT: remaster excluded by scope.");
    }
  }

  if (!missingSources && !missingCatalogNumber) {
    confidence = raiseConfidence(confidence, "MEDIUM");
  }

  if (incompleteStructuredFields) {
    confidence = capConfidence(confidence, "MEDIUM");
  }

  if (
    !missingSources &&
    !missingCatalogNumber &&
    hasReleaseDate(release) &&
    isCdFormat(release.format) &&
    release.isReissue !== true &&
    release.isRemaster !== true &&
    !riskyWarnings &&
    !explicitPendingReview &&
    !wikiOnlySources
  ) {
    confidence = "HIGH";
  }

  if (unknownFormat && !hasReleaseDate(release)) {
    confidence = "LOW";
    pendingReview = true;
    if (!hasWarning(warnings, "format")) {
      warnings.push("PENDING_REVIEW: unknown release format.");
    }
  }

  if (missingCatalogNumber && !hasReleaseDate(release)) {
    confidence = "LOW";
    pendingReview = true;
  }

  if (riskyWarnings) {
    confidence = "LOW";
    pendingReview = true;
  }

  if (missingCatalogNumber) {
    confidence = capConfidence(confidence, "MEDIUM");
  }

  if (missingSources) {
    confidence = "LOW";
  }

  if (wikiOnlySources) {
    confidence = capConfidence(confidence, "MEDIUM");
  }

  return {
    ...release,
    confidence,
    warnings,
    isExcludedByDefault,
    quality: {
      missingCatalogNumber,
      missingSources,
      wikiOnlySources,
      nonCdPhysicalUnderOriginalCd,
      pendingReview,
      safeToImportByDefault:
        confidence === "HIGH" &&
        !isExcludedByDefault &&
        !explicitPendingReview &&
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
        !release.warnings.some((warning) => warning.includes("PENDING_REVIEW")) &&
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
