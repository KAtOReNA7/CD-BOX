import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isAllowedCoverAssetUrl,
  isAllowedVerifiedCoverAssetUrl,
  type VerifiedCoverProvider,
} from "../src/lib/ai/cover-asset-validation";
import {
  evaluateCuratedHistoricalCanonBoundary,
} from "../src/lib/official-music/curated-canon-policy";

export type BaselineKind = "exact" | "minimum";

export type BenchmarkSource = {
  url: string;
  authority: string;
  note: string;
};

export type DiscographyBaseline = {
  category: string;
  kind: BaselineKind;
  /** Complete official numbered canon before the default ORIGINAL_CD carrier filter. */
  officialCatalogTotal?: number;
  expected: number;
  expectedWorks?: WorkAnchor[];
  asOf: string;
  /** Date on which an active catalogue snapshot was rechecked against its authority. */
  snapshotVerifiedAt?: string;
  /** Final acceptance closes this otherwise-active baseline at the snapshot. */
  finalSnapshotKind?: "exact";
  /** Latest canonical work confirmed during that authority recheck. */
  latestAuthorityAnchor?: WorkAnchor & { sourceUrl: string };
  scopeNote: string;
  sources: BenchmarkSource[];
};

export type WorkAnchor = {
  title: string;
  aliases?: string[];
  category: string;
  originalReleaseDate?: string;
  mediaScope?: WorkMediaScopeAnchor;
};

export type WorkMediaScopeAnchor = {
  originalFormats: Array<"CD" | "VINYL" | "CASSETTE" | "DIGITAL" | "OTHER_PHYSICAL">;
  physicalCd: "ORIGINAL_RELEASE" | "LATER_OFFICIAL_EDITION" | "NONE" | "UNKNOWN";
  physicalCdCountry?: string | null;
  physicalCdAuthorityUrls?: string[];
  physicalCdReleaseDate?: string | null;
  physicalCdCatalogNumber?: string | null;
  exclusionReason?: "CASSETTE_ONLY" | "DIGITAL_ONLY" | "NO_CONFIRMED_PHYSICAL_CD";
};

function isDefaultOriginalCdWork(work: WorkAnchor) {
  const availability = work.mediaScope?.physicalCd;
  return availability === undefined ||
    availability === "ORIGINAL_RELEASE" ||
    availability === "LATER_OFFICIAL_EDITION";
}

function inScopeExpectedWorks(baseline: DiscographyBaseline) {
  if (!baseline.expectedWorks) return [];
  return baseline.officialCatalogTotal === undefined
    ? baseline.expectedWorks
    : baseline.expectedWorks.filter(isDefaultOriginalCdWork);
}

function outOfScopeOfficialWorks(baseline: DiscographyBaseline) {
  if (!baseline.expectedWorks || baseline.officialCatalogTotal === undefined) return [];
  return baseline.expectedWorks.filter((work) => !isDefaultOriginalCdWork(work));
}

export type NegativeAnchor = {
  title: string;
  aliases?: string[];
  disallowedCategories: string[];
  reason: string;
};

export type BenchmarkThresholds = {
  minimumAnchorRecall: number;
  minimumCoreRecall: number;
  minimumEvidenceCoverage: number;
  minimumCoverCoverage: number;
  maximumDuplicateRate: number;
  minimumExplainedRejectionCoverage: number;
};

export type ArtistBenchmark = {
  slug: string;
  artist: {
    canonicalName: string;
    aliases: string[];
    country: string;
    musicbrainzArtistId: string;
  };
  catalogStatus: "fixed" | "active";
  scope: {
    territory: string;
    includedCategories: string[];
    note: string;
  };
  baselines: DiscographyBaseline[];
  requiredAnchors: WorkAnchor[];
  negativeAnchors: NegativeAnchor[];
  editionTraps: Array<{ kind: string; description: string }>;
  comparisonSources?: Array<{ url: string; note: string }>;
  metrics?: Partial<BenchmarkThresholds>;
};

export type DiscographyBenchmarkManifest = {
  schemaVersion: number;
  asOf: string;
  grain: "work";
  methodology: string;
  defaultMetrics: BenchmarkThresholds;
  finalAcceptanceSuite?: {
    id: string;
    maxAuthorityAgeDays: number;
    /** Keeps the final suite focused on prolific catalogues, not small diagnostic fixtures. */
    minimumOriginalCdWorks: number;
    artistSlugs: string[];
  };
  artists: ArtistBenchmark[];
};

export type ApplicationDataset = {
  artist: string;
  releases: unknown[];
  rejections: unknown[];
};

export type BenchmarkGap = {
  title: string | null;
  category: string;
  reasonCode: "ANCHOR_MISSING" | "CANONICAL_WORK_MISSING" | "COUNT_SHORTFALL";
  count: number;
  note: string;
};

export type BenchmarkExtra = {
  title: string | null;
  category: string;
  reasonCode:
    | "DUPLICATE_WORK"
    | "KNOWN_NON_CORE"
    | "EXACT_COUNT_OVERFLOW"
    | "NON_CANONICAL_WORK"
    | "CANONICAL_TITLE_DATE_CONFLICT"
    | "OUT_OF_SCOPE_OFFICIAL_WORK"
    | "DUPLICATE_CANONICAL_WORK"
    | "UNREQUESTED_FINAL_CATEGORY"
    | "UNMANIFESTED_FINAL_WORK";
  count: number;
  note: string;
};

export type BenchmarkPendingItem = {
  title: string;
  category: string;
  workKey: string;
};

export type BaselineResult = DiscographyBaseline & {
  actual: number;
  delta: number;
  met: boolean;
};

export type ArtistBenchmarkReport = {
  artist: string;
  slug: string;
  catalogStatus: "fixed" | "active";
  scope: ArtistBenchmark["scope"];
  summary: {
    inputRows: number;
    acceptedRows: number;
    uniqueCoreWorks: number;
    rejectedRows: number;
  };
  baselines: BaselineResult[];
  metrics: {
    anchorRecall: number;
    coreRecall: number;
    evidenceCoverage: number;
    coverCoverage: number;
    duplicateRate: number;
    explainedRejectionCoverage: number;
  };
  thresholds: BenchmarkThresholds;
  missing: BenchmarkGap[];
  extra: BenchmarkExtra[];
  pendingEvidence: BenchmarkPendingItem[];
  pendingCover: BenchmarkPendingItem[];
  unexplainedRejections: BenchmarkPendingItem[];
  passed: boolean;
};

export type FinalAcceptanceEligibility = {
  eligible: boolean;
  reasons: string[];
};

export type BenchmarkEvaluationOptions = {
  /** Closes active catalogues at the versioned manifest snapshot. */
  finalAcceptance?: boolean;
  manifestAsOf?: string;
};

type JsonRecord = Record<string, unknown>;

type NormalizedRelease = {
  raw: JsonRecord;
  title: string;
  category: string;
  workKey: string;
  semanticKey: string;
  originalReleaseDate: string | null;
  evidenceUrls: string[];
  coverUrl: string | null;
  rejected: boolean;
  rejectionStage: string | null;
  rejectionReason: string | null;
};

export type MusicBrainzLiveResult = {
  releases: unknown[];
  requests: number;
  warnings: string[];
};

export type SourceOnlyAssessment = {
  status: "PASS" | "PASS_WITH_PARTIAL_SOURCE" | "SOURCE_GAP" | "INCONCLUSIVE_PARTIAL_SOURCE";
  passed: boolean;
  conclusive: boolean;
  retrievalComplete: boolean;
  anchorRecallMet: boolean;
  lowerBoundRecallMet: boolean;
  evidenceCoverageMet: boolean;
  canonicalWorkGateMet: boolean;
  missingAnchorTitles: string[];
  nonCanonicalTitles: string[];
  countShortfalls: Array<{ category: string; count: number }>;
  note: string;
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE_PATH = path.resolve(
  scriptDirectory,
  "../src/data/authoritative-discography-manifests.json",
);

const STRICT_THRESHOLDS: BenchmarkThresholds = {
  minimumAnchorRecall: 1,
  minimumCoreRecall: 1,
  minimumEvidenceCoverage: 1,
  minimumCoverCoverage: 1,
  maximumDuplicateRate: 0,
  minimumExplainedRejectionCoverage: 1,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid discography benchmark fixture: ${message}`);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function normalizedHostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function sameDomainOrSubdomain(hostname: string, authorityHostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const authority = authorityHostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return host === authority || host.endsWith(`.${authority}`);
}

const trustedPublicMetadataHosts = [
  "musicbrainz.org",
  "ndlsearch.ndl.go.jp",
  "discogs.com",
] as const;

function fixtureAuthorityHosts(fixture: ArtistBenchmark) {
  return [...new Set(fixture.baselines.flatMap((baseline) => baseline.sources)
    .map((source) => normalizedHostname(source.url))
    .filter((host): host is string => Boolean(host)))];
}

export function isTrustedBenchmarkEvidenceUrl(
  fixture: ArtistBenchmark,
  value: string,
  authorityOnly = false,
) {
  if (!safeHttpsUrl(value)) return false;
  const hostname = normalizedHostname(value);
  if (!hostname) return false;
  if ([
    "example",
    "example.com",
    "example.net",
    "example.org",
    "invalid",
    "localhost",
    "test",
  ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) return false;
  const authorityHosts = ["ndlsearch.ndl.go.jp", ...fixtureAuthorityHosts(fixture)];
  const allowedHosts = authorityOnly
    ? authorityHosts
    : [...trustedPublicMetadataHosts, ...authorityHosts];
  return allowedHosts.some((allowed) => sameDomainOrSubdomain(hostname, allowed));
}

export function isTrustedBenchmarkCoverUrl(
  value: string | null | undefined,
  provider?: VerifiedCoverProvider | null,
) {
  return Boolean(value && (
    provider
      ? isAllowedVerifiedCoverAssetUrl(value, provider)
      : isAllowedCoverAssetUrl(value)
  ));
}

export function normalizeBenchmarkText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function validateThreshold(value: unknown, key: string) {
  requireCondition(typeof value === "number" && value >= 0 && value <= 1, `${key} must be 0..1`);
}

function validateWorkAnchorValue(value: unknown, pathLabel: string) {
  requireCondition(isRecord(value), `${pathLabel} must be an object`);
  requireCondition(
    typeof value.title === "string" && value.title.trim().length > 0,
    `${pathLabel}.title is required`,
  );
  requireCondition(
    typeof value.category === "string" && value.category.trim().length > 0,
    `${pathLabel}.category is required`,
  );
  if (value.aliases !== undefined) {
    requireCondition(
      Array.isArray(value.aliases) && value.aliases.every((alias) =>
        typeof alias === "string" && alias.trim().length > 0),
      `${pathLabel}.aliases is invalid`,
    );
  }
  if (value.originalReleaseDate !== undefined) {
    requireCondition(
      typeof value.originalReleaseDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.originalReleaseDate),
      `${pathLabel}.originalReleaseDate is invalid`,
    );
  }
  if (value.mediaScope !== undefined) {
    const mediaPath = `${pathLabel}.mediaScope`;
    requireCondition(isRecord(value.mediaScope), `${mediaPath} must be an object`);
    const media = value.mediaScope;
    const allowedFormats = new Set(["CD", "VINYL", "CASSETTE", "DIGITAL", "OTHER_PHYSICAL"]);
    requireCondition(
      Array.isArray(media.originalFormats) && media.originalFormats.length > 0 &&
        media.originalFormats.every((format) => typeof format === "string" && allowedFormats.has(format)),
      `${mediaPath}.originalFormats is invalid`,
    );
    requireCondition(
      new Set(media.originalFormats as unknown[]).size === (media.originalFormats as unknown[]).length,
      `${mediaPath}.originalFormats must be unique`,
    );
    requireCondition(
      media.physicalCd === "ORIGINAL_RELEASE" ||
        media.physicalCd === "LATER_OFFICIAL_EDITION" ||
        media.physicalCd === "NONE" || media.physicalCd === "UNKNOWN",
      `${mediaPath}.physicalCd is invalid`,
    );
    if (media.physicalCd === "ORIGINAL_RELEASE") {
      requireCondition(
        (media.originalFormats as unknown[]).includes("CD"),
        `${mediaPath} ORIGINAL_RELEASE physicalCd requires CD in originalFormats`,
      );
    }
    if (media.physicalCdCountry !== undefined && media.physicalCdCountry !== null) {
      requireCondition(
        typeof media.physicalCdCountry === "string" && /^[A-Z]{2}$/.test(media.physicalCdCountry),
        `${mediaPath}.physicalCdCountry is invalid`,
      );
    }
    if (media.physicalCd === "NONE" || media.physicalCd === "UNKNOWN") {
      requireCondition(
        media.physicalCdCountry === undefined || media.physicalCdCountry === null,
        `${mediaPath} ${media.physicalCd} physicalCd cannot have physicalCdCountry`,
      );
    }
    if (media.physicalCdAuthorityUrls !== undefined) {
      requireCondition(
        Array.isArray(media.physicalCdAuthorityUrls) &&
          media.physicalCdAuthorityUrls.every((url) => typeof url === "string" && safeHttpsUrl(url)) &&
          new Set(media.physicalCdAuthorityUrls).size === media.physicalCdAuthorityUrls.length,
        `${mediaPath}.physicalCdAuthorityUrls is invalid`,
      );
    }
    const cdAuthorityCount = Array.isArray(media.physicalCdAuthorityUrls)
      ? media.physicalCdAuthorityUrls.length
      : 0;
    if (media.physicalCd === "LATER_OFFICIAL_EDITION") {
      requireCondition(
        cdAuthorityCount > 0,
        `${mediaPath} LATER_OFFICIAL_EDITION requires physicalCdAuthorityUrls`,
      );
    }
    if (media.physicalCd === "NONE" || media.physicalCd === "UNKNOWN") {
      requireCondition(
        cdAuthorityCount === 0,
        `${mediaPath} ${media.physicalCd} physicalCd cannot have physicalCdAuthorityUrls`,
      );
    }
    if (media.physicalCdReleaseDate !== undefined && media.physicalCdReleaseDate !== null) {
      requireCondition(
        typeof media.physicalCdReleaseDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(media.physicalCdReleaseDate),
        `${mediaPath}.physicalCdReleaseDate is invalid`,
      );
    }
    if (media.physicalCdCatalogNumber !== undefined && media.physicalCdCatalogNumber !== null) {
      requireCondition(
        typeof media.physicalCdCatalogNumber === "string" && media.physicalCdCatalogNumber.trim().length > 0,
        `${mediaPath}.physicalCdCatalogNumber is invalid`,
      );
    }
    if (media.physicalCd === "NONE" || media.physicalCd === "UNKNOWN") {
      requireCondition(
        (media.physicalCdReleaseDate === undefined || media.physicalCdReleaseDate === null) &&
          (media.physicalCdCatalogNumber === undefined || media.physicalCdCatalogNumber === null),
        `${mediaPath} ${media.physicalCd} physicalCd cannot have CD edition metadata`,
      );
    }
    const exclusionReasons = new Set([
      "CASSETTE_ONLY",
      "DIGITAL_ONLY",
      "NO_CONFIRMED_PHYSICAL_CD",
    ]);
    if (media.exclusionReason !== undefined) {
      requireCondition(
        typeof media.exclusionReason === "string" && exclusionReasons.has(media.exclusionReason),
        `${mediaPath}.exclusionReason is invalid`,
      );
    }
    if (media.physicalCd === "NONE") {
      requireCondition(
        typeof media.exclusionReason === "string",
        `${mediaPath} NONE physicalCd requires exclusionReason`,
      );
    } else {
      requireCondition(
        media.exclusionReason === undefined,
        `${mediaPath}.exclusionReason is only valid when physicalCd is NONE`,
      );
    }
    if (media.exclusionReason === "CASSETTE_ONLY") {
      requireCondition(
        (media.originalFormats as unknown[]).length === 1 && media.originalFormats[0] === "CASSETTE",
        `${mediaPath} CASSETTE_ONLY requires originalFormats [CASSETTE]`,
      );
    }
    if (media.exclusionReason === "DIGITAL_ONLY") {
      requireCondition(
        (media.originalFormats as unknown[]).length === 1 && media.originalFormats[0] === "DIGITAL",
        `${mediaPath} DIGITAL_ONLY requires originalFormats [DIGITAL]`,
      );
    }
  }
}

export function validateBenchmarkManifest(value: unknown): asserts value is DiscographyBenchmarkManifest {
  requireCondition(isRecord(value), "root must be an object");
  requireCondition(value.schemaVersion === 1, "schemaVersion must be 1");
  requireCondition(value.grain === "work", "grain must be work");
  requireCondition(typeof value.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.asOf), "asOf must be YYYY-MM-DD");
  requireCondition(typeof value.methodology === "string" && value.methodology.length > 0, "methodology is required");
  requireCondition(isRecord(value.defaultMetrics), "defaultMetrics is required");

  const defaultMetrics = value.defaultMetrics;
  validateThreshold(defaultMetrics.minimumAnchorRecall, "minimumAnchorRecall");
  validateThreshold(defaultMetrics.minimumCoreRecall, "minimumCoreRecall");
  validateThreshold(defaultMetrics.minimumEvidenceCoverage, "minimumEvidenceCoverage");
  validateThreshold(defaultMetrics.minimumCoverCoverage, "minimumCoverCoverage");
  validateThreshold(defaultMetrics.maximumDuplicateRate, "maximumDuplicateRate");
  validateThreshold(defaultMetrics.minimumExplainedRejectionCoverage, "minimumExplainedRejectionCoverage");

  requireCondition(Array.isArray(value.artists) && value.artists.length > 0, "artists must be non-empty");
  const slugs = new Set<string>();
  for (const [artistIndex, artistValue] of value.artists.entries()) {
    requireCondition(isRecord(artistValue), `artists[${artistIndex}] must be an object`);
    requireCondition(typeof artistValue.slug === "string" && artistValue.slug.length > 0, `artists[${artistIndex}].slug is required`);
    requireCondition(!slugs.has(artistValue.slug), `duplicate artist slug ${artistValue.slug}`);
    slugs.add(artistValue.slug);
    requireCondition(isRecord(artistValue.artist), `${artistValue.slug}.artist is required`);
    requireCondition(typeof artistValue.artist.canonicalName === "string", `${artistValue.slug}.artist.canonicalName is required`);
    requireCondition(Array.isArray(artistValue.artist.aliases), `${artistValue.slug}.artist.aliases must be an array`);
    requireCondition(artistValue.artist.aliases.every((alias) => typeof alias === "string" && alias.trim().length > 0), `${artistValue.slug}.artist.aliases must contain non-empty strings`);
    requireCondition(typeof artistValue.artist.country === "string" && /^[A-Z]{2}$/.test(artistValue.artist.country), `${artistValue.slug}.artist.country must be an ISO alpha-2 code`);
    requireCondition(typeof artistValue.artist.musicbrainzArtistId === "string", `${artistValue.slug}.artist.musicbrainzArtistId is required`);
    requireCondition(artistValue.catalogStatus === "fixed" || artistValue.catalogStatus === "active", `${artistValue.slug}.catalogStatus is invalid`);
    requireCondition(isRecord(artistValue.scope), `${artistValue.slug}.scope is required`);
    requireCondition(Array.isArray(artistValue.scope.includedCategories) && artistValue.scope.includedCategories.length > 0, `${artistValue.slug}.scope.includedCategories is required`);
    requireCondition(Array.isArray(artistValue.baselines) && artistValue.baselines.length > 0, `${artistValue.slug}.baselines is required`);
    requireCondition(Array.isArray(artistValue.requiredAnchors), `${artistValue.slug}.requiredAnchors must be an array`);
    requireCondition(Array.isArray(artistValue.negativeAnchors), `${artistValue.slug}.negativeAnchors must be an array`);
    requireCondition(Array.isArray(artistValue.editionTraps), `${artistValue.slug}.editionTraps must be an array`);

    if (artistValue.metrics !== undefined) {
      requireCondition(isRecord(artistValue.metrics), `${artistValue.slug}.metrics must be an object`);
      for (const key of Object.keys(STRICT_THRESHOLDS) as Array<keyof BenchmarkThresholds>) {
        if (artistValue.metrics[key] !== undefined) validateThreshold(artistValue.metrics[key], `${artistValue.slug}.metrics.${key}`);
      }
    }

    const baselineCategories = new Set<string>();
    for (const [baselineIndex, baselineValue] of artistValue.baselines.entries()) {
      requireCondition(isRecord(baselineValue), `${artistValue.slug}.baselines[${baselineIndex}] must be an object`);
      requireCondition(typeof baselineValue.category === "string", `${artistValue.slug}.baselines[${baselineIndex}].category is required`);
      requireCondition(!baselineCategories.has(baselineValue.category), `${artistValue.slug} has duplicate baseline category ${baselineValue.category}`);
      baselineCategories.add(baselineValue.category);
      requireCondition(baselineValue.kind === "exact" || baselineValue.kind === "minimum", `${artistValue.slug}.baselines[${baselineIndex}].kind is invalid`);
      requireCondition(
        artistValue.catalogStatus === "fixed" ? baselineValue.kind === "exact" : baselineValue.kind === "minimum",
        `${artistValue.slug} must use ${artistValue.catalogStatus === "fixed" ? "exact" : "minimum"} baselines for a ${artistValue.catalogStatus} catalog`,
      );
      requireCondition(Number.isInteger(baselineValue.expected) && Number(baselineValue.expected) > 0, `${artistValue.slug}.baselines[${baselineIndex}].expected must be a positive integer`);
      if (baselineValue.officialCatalogTotal !== undefined) {
        requireCondition(
          Number.isInteger(baselineValue.officialCatalogTotal) &&
            Number(baselineValue.officialCatalogTotal) >= Number(baselineValue.expected),
          `${artistValue.slug}.baselines[${baselineIndex}].officialCatalogTotal must be an integer greater than or equal to expected`,
        );
      }
      requireCondition(typeof baselineValue.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(baselineValue.asOf), `${artistValue.slug}.baselines[${baselineIndex}].asOf is invalid`);
      if (baselineValue.snapshotVerifiedAt !== undefined) {
        requireCondition(
          typeof baselineValue.snapshotVerifiedAt === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(baselineValue.snapshotVerifiedAt),
          `${artistValue.slug}.baselines[${baselineIndex}].snapshotVerifiedAt is invalid`,
        );
      }
      if (baselineValue.finalSnapshotKind !== undefined) {
        requireCondition(
          artistValue.catalogStatus === "active" && baselineValue.finalSnapshotKind === "exact",
          `${artistValue.slug}.baselines[${baselineIndex}].finalSnapshotKind is invalid`,
        );
      }
      requireCondition(Array.isArray(baselineValue.sources) && baselineValue.sources.length > 0, `${artistValue.slug}.baselines[${baselineIndex}].sources is required`);
      for (const sourceValue of baselineValue.sources) {
        requireCondition(isRecord(sourceValue) && typeof sourceValue.url === "string" && safeHttpsUrl(sourceValue.url), `${artistValue.slug} has an invalid authority URL`);
        requireCondition(typeof sourceValue.authority === "string" && typeof sourceValue.note === "string", `${artistValue.slug} source provenance is incomplete`);
      }
      if (baselineValue.expectedWorks !== undefined) {
        requireCondition(
          Array.isArray(baselineValue.expectedWorks),
          `${artistValue.slug}.baselines[${baselineIndex}].expectedWorks must be an array`,
        );
        requireCondition(
          baselineValue.expectedWorks.length ===
            (baselineValue.officialCatalogTotal ?? baselineValue.expected),
          `${artistValue.slug}.baselines[${baselineIndex}].expectedWorks must contain exactly ${baselineValue.officialCatalogTotal ?? baselineValue.expected} works`,
        );
        const variantOwners = new Map<string, number>();
        for (const [workIndex, workValue] of baselineValue.expectedWorks.entries()) {
          const workPath = `${artistValue.slug}.baselines[${baselineIndex}].expectedWorks[${workIndex}]`;
          validateWorkAnchorValue(workValue, workPath);
          requireCondition(
            workValue.category === baselineValue.category,
            `${workPath}.category must equal baseline category ${baselineValue.category}`,
          );
          const variants = new Set([
            workValue.title,
            ...(Array.isArray(workValue.aliases) ? workValue.aliases : []),
          ].map((item) => normalizeBenchmarkText(String(item))));
          requireCondition(!variants.has(""), `${workPath} has an empty normalized title`);
          for (const variant of variants) {
            requireCondition(
              !variantOwners.has(variant),
              `${artistValue.slug}.baselines[${baselineIndex}].expectedWorks titles and aliases must be unique`,
            );
            variantOwners.set(variant, workIndex);
          }
        }
        if (baselineValue.officialCatalogTotal !== undefined) {
          const scopedWorks = (baselineValue.expectedWorks as WorkAnchor[])
            .filter(isDefaultOriginalCdWork);
          requireCondition(
            scopedWorks.length === baselineValue.expected,
            `${artistValue.slug}.baselines[${baselineIndex}].expected must equal the ${scopedWorks.length} ORIGINAL_CD-scope works in expectedWorks`,
          );
          requireCondition(
            (baselineValue.expectedWorks as WorkAnchor[]).every((work) => work.mediaScope !== undefined),
            `${artistValue.slug}.baselines[${baselineIndex}].officialCatalogTotal requires mediaScope on every expected work`,
          );
        }
      }
      if (baselineValue.latestAuthorityAnchor !== undefined) {
        const anchorPath = `${artistValue.slug}.baselines[${baselineIndex}].latestAuthorityAnchor`;
        requireCondition(isRecord(baselineValue.latestAuthorityAnchor), `${anchorPath} must be an object`);
        const latestAuthorityAnchor = baselineValue.latestAuthorityAnchor;
        validateWorkAnchorValue(latestAuthorityAnchor, anchorPath);
        requireCondition(
          latestAuthorityAnchor.category === baselineValue.category,
          `${anchorPath}.category must equal baseline category ${baselineValue.category}`,
        );
        requireCondition(
          typeof latestAuthorityAnchor.originalReleaseDate === "string",
          `${anchorPath}.originalReleaseDate is required`,
        );
        requireCondition(
          typeof latestAuthorityAnchor.sourceUrl === "string" &&
            safeHttpsUrl(latestAuthorityAnchor.sourceUrl),
          `${anchorPath}.sourceUrl is invalid`,
        );
        requireCondition(
          (baselineValue.sources as BenchmarkSource[]).some((source) =>
            source.url === latestAuthorityAnchor.sourceUrl),
          `${anchorPath}.sourceUrl must be declared by the same baseline`,
        );
      }
    }

    for (const [anchorIndex, anchorValue] of artistValue.requiredAnchors.entries()) {
      validateWorkAnchorValue(
        anchorValue,
        `${artistValue.slug}.requiredAnchors[${anchorIndex}]`,
      );
    }
  }

  if (value.finalAcceptanceSuite !== undefined) {
    requireCondition(isRecord(value.finalAcceptanceSuite), "finalAcceptanceSuite must be an object");
    requireCondition(
      typeof value.finalAcceptanceSuite.id === "string" && value.finalAcceptanceSuite.id.trim().length > 0,
      "finalAcceptanceSuite.id is required",
    );
    requireCondition(
      Number.isInteger(value.finalAcceptanceSuite.maxAuthorityAgeDays) &&
        Number(value.finalAcceptanceSuite.maxAuthorityAgeDays) >= 1 &&
        Number(value.finalAcceptanceSuite.maxAuthorityAgeDays) <= 366,
      "finalAcceptanceSuite.maxAuthorityAgeDays must be 1..366",
    );
    requireCondition(
      Number.isInteger(value.finalAcceptanceSuite.minimumOriginalCdWorks) &&
        Number(value.finalAcceptanceSuite.minimumOriginalCdWorks) >= 1 &&
        Number(value.finalAcceptanceSuite.minimumOriginalCdWorks) <= 1_000,
      "finalAcceptanceSuite.minimumOriginalCdWorks must be 1..1000",
    );
    requireCondition(
      Array.isArray(value.finalAcceptanceSuite.artistSlugs) &&
        value.finalAcceptanceSuite.artistSlugs.length >= 2 &&
        value.finalAcceptanceSuite.artistSlugs.every((slug) => typeof slug === "string" && slugs.has(slug)),
      "finalAcceptanceSuite.artistSlugs must contain at least two known artists",
    );
    requireCondition(
      new Set(value.finalAcceptanceSuite.artistSlugs).size === value.finalAcceptanceSuite.artistSlugs.length,
      "finalAcceptanceSuite.artistSlugs must be unique",
    );
  }
}

export async function loadBenchmarkManifest(fixturePath = DEFAULT_FIXTURE_PATH) {
  const parsed: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
  validateBenchmarkManifest(parsed);
  return parsed;
}

function firstString(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nestedRecord(record: JsonRecord, key: string) {
  return isRecord(record[key]) ? record[key] : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function canonicalCategory(value: string | null, secondaryTypes: string[]) {
  const category = (value ?? "UNKNOWN")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const secondary = secondaryTypes.map((item) => item.toUpperCase());

  if (category === "SINGLE" || category.endsWith("_SINGLE")) return "SINGLE";
  if (category === "ORIGINAL_ALBUM" || category === "STUDIO_ALBUM") return "ORIGINAL_ALBUM";
  if (category === "COLLECTION" || category === "COMPILATION" || secondary.includes("COMPILATION")) return "COLLECTION";
  if (category === "LIVE" || category === "LIVE_ALBUM" || secondary.includes("LIVE")) return "LIVE";
  if (category === "REMIX" || category === "REMIX_ALBUM" || secondary.includes("REMIX")) return "REMIX";
  if (category === "SOUNDTRACK" || secondary.includes("SOUNDTRACK")) return "SOUNDTRACK";
  if (category === "ALBUM") return "ORIGINAL_ALBUM";
  if (category === "EP") return "EP";
  return category || "UNKNOWN";
}

function categoryFromRelease(record: JsonRecord) {
  const secondaryTypes = [
    ...stringArray(record.secondaryTypes),
    ...stringArray(record["secondary-types"]),
  ];
  return canonicalCategory(
    firstString(record, ["category", "releaseCategory", "primaryType", "primary-type", "type"]),
    secondaryTypes,
  );
}

function urlFromValue(value: unknown): string[] {
  if (typeof value === "string") return isHttpUrl(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(urlFromValue);
  if (!isRecord(value)) return [];
  const direct = firstString(value, ["url", "sourceUrl", "href"]);
  return direct && isHttpUrl(direct) ? [direct] : [];
}

function evidenceUrls(record: JsonRecord) {
  const verification = nestedRecord(record, "verification");
  const values: unknown[] = [
    record.sources,
    record.sourceUrls,
    record.sourceUrl,
    record.evidence,
    verification?.sources,
    verification?.evidence,
    verification?.sourceUrls,
    verification?.authoritySourceUrls,
    verification?.corroboratingSourceUrls,
  ];
  return [...new Set(values.flatMap(urlFromValue))];
}

function coverUrl(record: JsonRecord) {
  const verification = nestedRecord(record, "verification");
  const candidates = [
    firstString(record, ["coverImageUrl", "coverUrl", "coverAssetUrl", "artworkUrl", "imageUrl"]),
    verification ? firstString(verification, ["coverImageUrl", "coverUrl", "coverAssetUrl"]) : null,
  ];
  return candidates.find((value): value is string => Boolean(value && isHttpUrl(value))) ?? null;
}

function rejectionInfo(record: JsonRecord) {
  const verification = nestedRecord(record, "verification");
  const decision = (
    firstString(record, ["decision", "status", "verificationStatus", "result"]) ??
    (verification ? firstString(verification, ["decision", "status", "result"]) : null) ??
    ""
  ).toUpperCase();
  const rejected = record.included === false || ["REJECT", "REJECTED", "EXCLUDE", "EXCLUDED", "HIDDEN"].includes(decision);
  const stage = firstString(record, ["stage", "rejectionStage", "filteredAtStage"])
    ?? (verification ? firstString(verification, ["stage", "rejectionStage"]) : null);
  const reason = firstString(record, ["reasonCode", "rejectionReason", "reason", "message"])
    ?? (verification ? firstString(verification, ["reasonCode", "rejectionReason", "reason"]) : null);
  return { rejected, stage, reason };
}

function normalizeRelease(value: unknown): NormalizedRelease | null {
  if (!isRecord(value)) return null;
  const title = firstString(value, ["title", "name", "releaseTitle"]);
  if (!title) return null;
  const category = categoryFromRelease(value);
  const semanticKey = `${category}:${normalizeBenchmarkText(title)}`;
  const explicitWorkId = firstString(value, ["workId", "releaseGroupId", "release-group-id"]);
  const originalReleaseDate = firstString(value, [
    "originalReleaseDate",
    "firstReleaseDate",
    "first-release-date",
    "releaseDate",
  ]);
  const rejection = rejectionInfo(value);
  return {
    raw: value,
    title,
    category,
    semanticKey,
    workKey: explicitWorkId ? `id:${explicitWorkId}` : `semantic:${semanticKey}`,
    originalReleaseDate,
    evidenceUrls: evidenceUrls(value),
    coverUrl: coverUrl(value),
    rejected: rejection.rejected,
    rejectionStage: rejection.stage,
    rejectionReason: rejection.reason,
  };
}

function titleVariants(anchor: { title: string; aliases?: string[] }) {
  return new Set([anchor.title, ...(anchor.aliases ?? [])].map(normalizeBenchmarkText));
}

function anchorMatches(anchor: WorkAnchor, release: NormalizedRelease) {
  if (anchor.category !== release.category || !titleVariants(anchor).has(normalizeBenchmarkText(release.title))) {
    return false;
  }
  if (!anchor.originalReleaseDate) return true;
  return release.originalReleaseDate?.slice(0, 10) === anchor.originalReleaseDate;
}

export function findExpectedBenchmarkWork(
  fixture: ArtistBenchmark,
  input: { title: string; category: string; originalReleaseDate: string | null | undefined },
) {
  const normalized: NormalizedRelease = {
    raw: {},
    title: input.title,
    category: input.category,
    workKey: "lookup",
    semanticKey: "lookup",
    originalReleaseDate: input.originalReleaseDate ?? null,
    evidenceUrls: [],
    coverUrl: null,
    rejected: false,
    rejectionStage: null,
    rejectionReason: null,
  };
  const matches = fixture.baselines.flatMap((baseline) => inScopeExpectedWorks(baseline))
    .filter((work) => anchorMatches(work, normalized));
  return matches.length === 1 ? matches[0]! : null;
}

export function outOfScopeExpectedBenchmarkWorks(fixture: ArtistBenchmark) {
  return fixture.baselines.flatMap((baseline) => outOfScopeOfficialWorks(baseline));
}

export function benchmarkWorkAnchorMatches(
  anchor: WorkAnchor,
  input: { title: string; category: string; originalReleaseDate: string | null | undefined },
) {
  return anchorMatches(anchor, {
    raw: {},
    title: input.title,
    category: input.category,
    workKey: "match",
    semanticKey: "match",
    originalReleaseDate: input.originalReleaseDate ?? null,
    evidenceUrls: [],
    coverUrl: null,
    rejected: false,
    rejectionStage: null,
    rejectionReason: null,
  });
}

function negativeAnchorMatches(anchor: NegativeAnchor, release: NormalizedRelease) {
  return anchor.disallowedCategories.includes(release.category)
    && titleVariants(anchor).has(normalizeBenchmarkText(release.title));
}

function isoDayNumber(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 86_400_000) : null;
}

function localIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function latestDatedWork(works: readonly WorkAnchor[]) {
  return works
    .filter((work): work is WorkAnchor & { originalReleaseDate: string } =>
      typeof work.originalReleaseDate === "string")
    .sort((left, right) =>
      right.originalReleaseDate.localeCompare(left.originalReleaseDate) ||
      left.title.localeCompare(right.title, "und"))[0] ?? null;
}

export function assessArtistFinalAcceptanceEligibility(
  manifest: DiscographyBenchmarkManifest,
  fixture: ArtistBenchmark,
  now = new Date(),
): FinalAcceptanceEligibility {
  const reasons: string[] = [];
  const suite = manifest.finalAcceptanceSuite;
  const maxAuthorityAgeDays = suite?.maxAuthorityAgeDays ?? 30;
  const manifestDay = isoDayNumber(manifest.asOf);
  // Authority snapshots are calendar dates. Use the machine's configured local
  // timezone so a Shanghai/Japan acceptance run does not regress to yesterday
  // during the first UTC hours of the day.
  const referenceDate = localIsoDate(now);
  const referenceDay = isoDayNumber(referenceDate);
  if (manifestDay === null || referenceDay === null || manifestDay > referenceDay ||
    referenceDay - manifestDay > maxAuthorityAgeDays) {
    reasons.push(
      `manifest snapshot ${manifest.asOf} is missing, future-dated, or older than ${maxAuthorityAgeDays} days at ${referenceDate}.`,
    );
  }

  const scopeCategories = new Set(fixture.scope.includedCategories);
  const baselineCategories = new Set(fixture.baselines.map((baseline) => baseline.category));
  for (const category of scopeCategories) {
    if (!baselineCategories.has(category)) {
      reasons.push(`${category} is in final scope but has no baseline.`);
    }
  }
  for (const category of baselineCategories) {
    if (!scopeCategories.has(category)) {
      reasons.push(`${category} has a baseline but is outside final scope.`);
    }
  }

  const expectedOriginalCdWorks = fixture.baselines.reduce(
    (total, baseline) => total + baseline.expected,
    0,
  );
  const minimumOriginalCdWorks = suite?.minimumOriginalCdWorks ?? 1;
  if (expectedOriginalCdWorks < minimumOriginalCdWorks) {
    reasons.push(
      `only ${expectedOriginalCdWorks} ORIGINAL_CD works are declared; final suite requires at least ${minimumOriginalCdWorks}.`,
    );
  }

  for (const baseline of fixture.baselines) {
    const scopedWorks = inScopeExpectedWorks(baseline);
    if (!baseline.expectedWorks || scopedWorks.length !== baseline.expected) {
      reasons.push(`${baseline.category} has no complete ORIGINAL_CD expectedWorks manifest.`);
      continue;
    }
    if (fixture.catalogStatus !== "active") continue;

    if (baseline.finalSnapshotKind !== "exact") {
      reasons.push(`${baseline.category} is not declared as an exact final snapshot.`);
    }
    const checkedDay = baseline.snapshotVerifiedAt
      ? isoDayNumber(baseline.snapshotVerifiedAt)
      : null;
    const baselineDay = isoDayNumber(baseline.asOf);
    if (referenceDay === null || manifestDay === null || baselineDay === null || checkedDay === null ||
      checkedDay < baselineDay ||
      checkedDay !== manifestDay || checkedDay > referenceDay ||
      referenceDay - checkedDay > maxAuthorityAgeDays) {
      reasons.push(
        `${baseline.category} authority check must match the final manifest snapshot ${manifest.asOf} and be no older than ${maxAuthorityAgeDays} days.`,
      );
    }

    const declaredLatest = baseline.latestAuthorityAnchor;
    const actualLatest = latestDatedWork(scopedWorks);
    if (!declaredLatest || !actualLatest ||
      !anchorMatches(actualLatest, {
        raw: {},
        title: declaredLatest.title,
        category: declaredLatest.category,
        workKey: "eligibility",
        semanticKey: "eligibility",
        originalReleaseDate: declaredLatest.originalReleaseDate ?? null,
        evidenceUrls: [declaredLatest.sourceUrl],
        coverUrl: null,
        rejected: false,
        rejectionStage: null,
        rejectionReason: null,
      })) {
      reasons.push(`${baseline.category} has no exact latestAuthorityAnchor for its latest canonical work.`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export function selectFinalAcceptanceSuiteFixtures(
  manifest: DiscographyBenchmarkManifest,
) {
  const suite = manifest.finalAcceptanceSuite;
  if (!suite) throw new Error("The canonical manifest does not declare a finalAcceptanceSuite.");
  const bySlug = new Map(manifest.artists.map((fixture) => [fixture.slug, fixture]));
  const fixtures = suite.artistSlugs.map((slug) => bySlug.get(slug)!);
  const failures = fixtures.flatMap((fixture) => {
    const eligibility = assessArtistFinalAcceptanceEligibility(manifest, fixture);
    return eligibility.reasons.map((reason) => `${fixture.slug}: ${reason}`);
  });
  if (!fixtures.some((fixture) => fixture.catalogStatus === "active") ||
    !fixtures.some((fixture) => fixture.catalogStatus === "fixed")) {
    failures.push("finalAcceptanceSuite must include at least one active and one fixed catalogue.");
  }
  if (failures.length > 0) {
    throw new Error(`Final acceptance suite is not eligible:\n${failures.join("\n")}`);
  }
  return fixtures;
}

function coverage(covered: number, total: number) {
  return total === 0 ? 1 : covered / total;
}

function rate(part: number, total: number) {
  return total === 0 ? 0 : part / total;
}

function thresholdsFor(
  fixture: ArtistBenchmark,
  defaults: BenchmarkThresholds = STRICT_THRESHOLDS,
): BenchmarkThresholds {
  return { ...defaults, ...(fixture.metrics ?? {}) };
}

export function evaluateArtistBenchmark(
  fixture: ArtistBenchmark,
  releases: unknown[],
  rejections: unknown[] = [],
  defaultThresholds: BenchmarkThresholds = STRICT_THRESHOLDS,
  options: BenchmarkEvaluationOptions = {},
): ArtistBenchmarkReport {
  const normalizedRows = releases.map(normalizeRelease).filter((release): release is NormalizedRelease => release !== null);
  const explicitRejections = rejections.map(normalizeRelease).filter((release): release is NormalizedRelease => release !== null);
  const rejectedRows = [...normalizedRows.filter((release) => release.rejected), ...explicitRejections];
  const acceptedRows = normalizedRows.filter((release) => !release.rejected);
  const includedCategories = new Set(fixture.scope.includedCategories);
  const coreRows = acceptedRows.filter((release) => includedCategories.has(release.category));

  const uniqueByWorkKey = new Map<string, NormalizedRelease>();
  const semanticOwners = new Map<string, string>();
  const duplicates: NormalizedRelease[] = [];
  for (const release of coreRows) {
    const existingWork = uniqueByWorkKey.get(release.workKey);
    const semanticOwner = semanticOwners.get(release.semanticKey);
    if (existingWork || (semanticOwner && semanticOwner !== release.workKey)) {
      duplicates.push(release);
    }
    if (!existingWork) uniqueByWorkKey.set(release.workKey, release);
    if (!semanticOwner) semanticOwners.set(release.semanticKey, release.workKey);
  }
  const uniqueCore = [...uniqueByWorkKey.values()];

  const actualByCategory = new Map<string, number>();
  for (const release of uniqueCore) {
    actualByCategory.set(release.category, (actualByCategory.get(release.category) ?? 0) + 1);
  }

  const baselineResults: BaselineResult[] = fixture.baselines.map((baseline) => {
    const actual = actualByCategory.get(baseline.category) ?? 0;
    const exactAtFinalSnapshot = options.finalAcceptance && baseline.finalSnapshotKind === "exact";
    return {
      ...baseline,
      actual,
      delta: actual - baseline.expected,
      met: baseline.kind === "exact" || exactAtFinalSnapshot
        ? actual === baseline.expected
        : actual >= baseline.expected,
    };
  });

  const missing: BenchmarkGap[] = [];
  for (const anchor of fixture.requiredAnchors) {
    if (!uniqueCore.some((release) => anchorMatches(anchor, release))) {
      missing.push({
        title: anchor.title,
        category: anchor.category,
        reasonCode: "ANCHOR_MISSING",
        count: 1,
        note: "Required authoritative anchor was not present in the normalized core-work output.",
      });
    }
  }
  for (const baseline of fixture.baselines) {
    if (!baseline.expectedWorks) continue;
    const categoryRows = uniqueCore.filter((release) => release.category === baseline.category);
    for (const expectedWork of inScopeExpectedWorks(baseline)) {
      const matches = categoryRows.filter((release) => anchorMatches(expectedWork, release));
      if (matches.length === 0) {
        missing.push({
          title: expectedWork.title,
          category: baseline.category,
          reasonCode: "CANONICAL_WORK_MISSING",
          count: 1,
          note: "A work from the baseline's complete canonical manifest was not present with its required title/alias and original date.",
        });
      }
    }
  }
  for (const baseline of baselineResults) {
    if (baseline.actual < baseline.expected) {
      missing.push({
        title: null,
        category: baseline.category,
        reasonCode: "COUNT_SHORTFALL",
        count: baseline.expected - baseline.actual,
        note: `${baseline.kind} baseline is short by ${baseline.expected - baseline.actual} work(s); fixture anchors identify only known examples, not every missing title.`,
      });
    }
  }

  const extra: BenchmarkExtra[] = duplicates.map((release) => ({
    title: release.title,
    category: release.category,
    reasonCode: "DUPLICATE_WORK",
    count: 1,
    note: "Multiple input rows normalize to the same category/title work. Keep editions beneath one work instead of counting them twice.",
  }));
  for (const release of acceptedRows.filter((item) => !includedCategories.has(item.category))) {
    extra.push({
      title: release.title,
      category: release.category,
      reasonCode: "UNREQUESTED_FINAL_CATEGORY",
      count: 1,
      note: "A final row belongs to a category outside the requested benchmark scope.",
    });
  }
  for (const release of coreRows) {
    const knownNegative = fixture.negativeAnchors.find((anchor) => negativeAnchorMatches(anchor, release));
    if (knownNegative) {
      extra.push({
        title: release.title,
        category: release.category,
        reasonCode: "KNOWN_NON_CORE",
        count: 1,
        note: knownNegative.reason,
      });
    }
  }
  for (const baseline of fixture.baselines) {
    if (!baseline.expectedWorks) continue;
    const scopedExpectedWorks = inScopeExpectedWorks(baseline);
    const excludedOfficialWorks = outOfScopeOfficialWorks(baseline);
    const categoryRows = uniqueCore.filter((release) => release.category === baseline.category);
    for (const expectedWork of scopedExpectedWorks) {
      const matches = categoryRows.filter((release) => anchorMatches(expectedWork, release));
      if (matches.length > 1) {
        extra.push({
          title: expectedWork.title,
          category: baseline.category,
          reasonCode: "DUPLICATE_CANONICAL_WORK",
          count: matches.length - 1,
          note: "More than one final row claims the same canonical work through its title or aliases.",
        });
      }
    }
    for (const release of uniqueCore) {
      if (release.category !== baseline.category) continue;
      if (scopedExpectedWorks.some((expectedWork) => anchorMatches(expectedWork, release))) {
        continue;
      }
      const excludedOfficialWork = excludedOfficialWorks.find((work) => anchorMatches(work, release));
      if (excludedOfficialWork) {
        extra.push({
          title: release.title,
          category: baseline.category,
          reasonCode: "OUT_OF_SCOPE_OFFICIAL_WORK",
          count: 1,
          note: excludedOfficialWork.mediaScope?.exclusionReason === "CASSETTE_ONLY"
            ? "This official numbered work is cassette-only and has no confirmed physical-CD edition."
            : excludedOfficialWork.mediaScope?.exclusionReason === "DIGITAL_ONLY"
              ? "This official numbered work is digital-only and has no physical-CD edition."
              : "This official numbered work is explicitly outside the default ORIGINAL_CD carrier scope.",
        });
        continue;
      }
      const boundary = evaluateCuratedHistoricalCanonBoundary({
        catalogStatus: fixture.catalogStatus,
        isCanonicalMember: false,
        hasCanonicalTitleDateConflict: baseline.expectedWorks.some((work) =>
          work.category === release.category &&
          titleVariants(work).has(normalizeBenchmarkText(release.title))),
        originalReleaseDate: release.originalReleaseDate,
        asOf: baseline.asOf,
      });
      if (boundary.outcome !== "OUT_OF_SCOPE") {
        if (options.finalAcceptance && boundary.outcome === "POST_CUTOFF_NEW_WORK") {
          extra.push({
            title: release.title,
            category: baseline.category,
            reasonCode: "UNMANIFESTED_FINAL_WORK",
            count: 1,
            note: `Final acceptance is closed at ${options.manifestAsOf ?? baseline.asOf}; update the authoritative manifest before accepting a new work.`,
          });
        }
        continue;
      }
      extra.push({
        title: release.title,
        category: release.category,
        reasonCode: boundary.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT"
          ? "CANONICAL_TITLE_DATE_CONFLICT"
          : "NON_CANONICAL_WORK",
        count: 1,
        note: boundary.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT"
          ? "The title or alias belongs to a canonical work, but its original date conflicts with the complete manifest."
          : baseline.kind === "exact"
            ? "A fixed catalog result was not present in the complete canonical work manifest."
            : `An active-catalog result without a date after ${baseline.asOf} was not present in the canonical historical manifest.`,
      });
    }
  }
  for (const baseline of baselineResults) {
    if (baseline.kind === "exact" && baseline.actual > baseline.expected) {
      extra.push({
        title: null,
        category: baseline.category,
        reasonCode: "EXACT_COUNT_OVERFLOW",
        count: baseline.actual - baseline.expected,
        note: "The exact work-level baseline is exceeded. Inspect classification and work/edition grouping to identify the extra row(s).",
      });
    }
  }

  const pendingEvidence = uniqueCore
    .filter((release) => !release.evidenceUrls.some((url) => isTrustedBenchmarkEvidenceUrl(fixture, url)))
    .map(({ title, category, workKey }) => ({ title, category, workKey }));
  const pendingCover = uniqueCore
    .filter((release) => !isTrustedBenchmarkCoverUrl(release.coverUrl))
    .map(({ title, category, workKey }) => ({ title, category, workKey }));
  const unexplainedRejections = rejectedRows
    .filter((release) => !release.rejectionStage || !release.rejectionReason)
    .map(({ title, category, workKey }) => ({ title, category, workKey }));

  const expectedTotal = baselineResults.reduce((sum, baseline) => sum + baseline.expected, 0);
  const recalledTotal = baselineResults.reduce(
    (sum, baseline) => sum + Math.min(baseline.actual, baseline.expected),
    0,
  );
  const metrics = {
    anchorRecall: coverage(fixture.requiredAnchors.length - missing.filter((item) => item.reasonCode === "ANCHOR_MISSING").length, fixture.requiredAnchors.length),
    coreRecall: coverage(recalledTotal, expectedTotal),
    evidenceCoverage: coverage(uniqueCore.length - pendingEvidence.length, uniqueCore.length),
    coverCoverage: coverage(uniqueCore.length - pendingCover.length, uniqueCore.length),
    duplicateRate: rate(duplicates.length, coreRows.length),
    explainedRejectionCoverage: coverage(rejectedRows.length - unexplainedRejections.length, rejectedRows.length),
  };
  const thresholds = thresholdsFor(fixture, defaultThresholds);
  const passed = baselineResults.every((baseline) => baseline.met)
    && metrics.anchorRecall >= thresholds.minimumAnchorRecall
    && metrics.coreRecall >= thresholds.minimumCoreRecall
    && metrics.evidenceCoverage >= thresholds.minimumEvidenceCoverage
    && metrics.coverCoverage >= thresholds.minimumCoverCoverage
    && metrics.duplicateRate <= thresholds.maximumDuplicateRate
    && metrics.explainedRejectionCoverage >= thresholds.minimumExplainedRejectionCoverage
    && missing.every((item) => item.reasonCode !== "CANONICAL_WORK_MISSING")
    && extra.length === 0;

  return {
    artist: fixture.artist.canonicalName,
    slug: fixture.slug,
    catalogStatus: fixture.catalogStatus,
    scope: fixture.scope,
    summary: {
      inputRows: normalizedRows.length,
      acceptedRows: acceptedRows.length,
      uniqueCoreWorks: uniqueCore.length,
      rejectedRows: rejectedRows.length,
    },
    baselines: baselineResults,
    metrics,
    thresholds,
    missing,
    extra,
    pendingEvidence,
    pendingCover,
    unexplainedRejections,
    passed,
  };
}

export function assessSourceOnlyRecall(
  report: ArtistBenchmarkReport,
  retrievalComplete = true,
): SourceOnlyAssessment {
  const missingAnchorTitles = report.missing
    .filter((item) => (
      item.reasonCode === "ANCHOR_MISSING" || item.reasonCode === "CANONICAL_WORK_MISSING"
    ) && item.title)
    .map((item) => item.title as string);
  const nonCanonicalTitles = report.extra
    .filter((item) => item.reasonCode === "NON_CANONICAL_WORK" && item.title)
    .map((item) => item.title as string);
  const countShortfalls = report.baselines
    .filter((baseline) => baseline.actual < baseline.expected)
    .map((baseline) => ({
      category: baseline.category,
      count: baseline.expected - baseline.actual,
    }));
  const anchorRecallMet = missingAnchorTitles.length === 0;
  const lowerBoundRecallMet = countShortfalls.length === 0;
  const evidenceCoverageMet = report.pendingEvidence.length === 0;
  const canonicalWorkGateMet = !report.missing.some((item) =>
    item.reasonCode === "CANONICAL_WORK_MISSING") && nonCanonicalTitles.length === 0;
  const passed = anchorRecallMet && lowerBoundRecallMet && evidenceCoverageMet &&
    canonicalWorkGateMet;
  const conclusive = retrievalComplete || passed;
  return {
    status: passed
      ? retrievalComplete
        ? "PASS"
        : "PASS_WITH_PARTIAL_SOURCE"
      : retrievalComplete
        ? "SOURCE_GAP"
        : "INCONCLUSIVE_PARTIAL_SOURCE",
    passed,
    conclusive,
    retrievalComplete,
    anchorRecallMet,
    lowerBoundRecallMet,
    evidenceCoverageMet,
    canonicalWorkGateMet,
    missingAnchorTitles,
    nonCanonicalTitles,
    countShortfalls,
    note: "Source-only recall ignores cover availability and exact-count overflow, but enforces any configured canonical-work manifest. The ignored checks remain visible in the full report; offline application-output acceptance still requires exact counts and validated covers.",
  };
}

function artistNameFromValue(value: unknown) {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  return firstString(value, ["canonicalName", "name", "artistName", "slug"]);
}

function datasetFromRecord(record: JsonRecord, artistHint?: string): ApplicationDataset | null {
  if (!Array.isArray(record.releases)) return null;
  const artist = artistNameFromValue(record.artist)
    ?? firstString(record, ["artistName", "canonicalName", "slug"]);
  const resolvedArtist = artist ?? artistHint;
  if (!resolvedArtist) return null;
  const auditRejections = Array.isArray(record.verificationCandidates)
    ? record.verificationCandidates.flatMap((value) => {
        if (!isRecord(value) || value.resolution !== "REJECTED") return [];
        const ledger = Array.isArray(value.ledger) ? value.ledger.filter(isRecord) : [];
        const last = ledger.at(-1);
        return [{
          ...value,
          status: "REJECTED",
          stage: last ? firstString(last, ["stage"]) : null,
          reasonCode: last ? firstString(last, ["reasonCode"]) : null,
        }];
      })
    : [];
  return {
    artist: resolvedArtist,
    releases: record.releases,
    rejections: Array.isArray(record.rejections) ? record.rejections : auditRejections,
  };
}

export function parseApplicationOutput(value: unknown, artistHint?: string): ApplicationDataset[] {
  if (Array.isArray(value)) {
    if (!artistHint) throw new Error("An array input requires --artist=<slug-or-name>.");
    return [{ artist: artistHint, releases: value, rejections: [] }];
  }
  if (!isRecord(value)) throw new Error("Application output must be a JSON object or release array.");

  const direct = datasetFromRecord(value, artistHint);
  if (direct) return [direct];

  if (Array.isArray(value.artists)) {
    const datasets = value.artists
      .map((item) => (isRecord(item) ? datasetFromRecord(item) : null))
      .filter((dataset): dataset is ApplicationDataset => dataset !== null);
    if (datasets.length > 0) return datasets;
  }

  const datasets: ApplicationDataset[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (Array.isArray(nested)) datasets.push({ artist: key, releases: nested, rejections: [] });
    else if (isRecord(nested)) {
      const dataset = datasetFromRecord(nested, key);
      if (dataset) datasets.push(dataset);
    }
  }
  if (datasets.length === 0) throw new Error("No artist release datasets were found in the application output.");
  return datasets;
}

export function findArtistBenchmark(manifest: DiscographyBenchmarkManifest, query: string) {
  const normalizedQuery = normalizeBenchmarkText(query);
  return manifest.artists.find((fixture) => [
    fixture.slug,
    fixture.artist.canonicalName,
    ...fixture.artist.aliases,
  ].some((name) => normalizeBenchmarkText(name) === normalizedQuery)) ?? null;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function categoryFromMusicBrainzGroup(group: JsonRecord, fixture: ArtistBenchmark) {
  const title = firstString(group, ["title"]) ?? "";
  const officialAnchor = fixture.requiredAnchors.find((anchor) => titleVariants(anchor).has(normalizeBenchmarkText(title)));
  if (officialAnchor) return officialAnchor.category;
  return canonicalCategory(
    firstString(group, ["primary-type", "primaryType"]),
    [...stringArray(group["secondary-types"]), ...stringArray(group.secondaryTypes)],
  );
}

export async function fetchMusicBrainzReleaseGroups(
  fixture: ArtistBenchmark,
  options: {
    maxPages?: number;
    requestSpacingMs?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<MusicBrainzLiveResult> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 3, 10));
  const requestSpacingMs = Math.max(options.requestSpacingMs ?? 1_100, 1_000);
  const timeoutMs = Math.max(options.timeoutMs ?? 20_000, 1_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const releases: unknown[] = [];
  const warnings: string[] = [];
  let requests = 0;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total && requests < maxPages) {
    if (requests > 0) await sleep(requestSpacingMs);
    const url = new URL("https://musicbrainz.org/ws/2/release-group");
    url.searchParams.set("artist", fixture.artist.musicbrainzArtistId);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CD-BOX-Discography-Benchmark/1.0 (local personal catalog tool)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    requests += 1;
    if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload["release-groups"])) {
      throw new Error("MusicBrainz returned an unexpected release-group payload.");
    }
    total = typeof payload["release-group-count"] === "number"
      ? payload["release-group-count"]
      : payload["release-groups"].length;
    for (const groupValue of payload["release-groups"]) {
      if (!isRecord(groupValue)) continue;
      const id = firstString(groupValue, ["id"]);
      const title = firstString(groupValue, ["title"]);
      if (!id || !title) continue;
      releases.push({
        workId: id,
        title,
        category: categoryFromMusicBrainzGroup(groupValue, fixture),
        originalReleaseDate: firstString(groupValue, ["first-release-date"]),
        coverImageUrl: null,
        sources: [{
          provider: "musicbrainz",
          url: `https://musicbrainz.org/release-group/${id}`,
        }],
      });
    }
    offset += payload["release-groups"].length;
    if (payload["release-groups"].length === 0) break;
  }

  if (offset < total) {
    warnings.push(`Stopped after ${requests} MusicBrainz page(s); fetched ${offset} of ${total} release groups. Increase --max-pages for a manual full run.`);
  }
  warnings.push("MusicBrainz release-group browsing is artist-global and may split reissues or regional configurations into additional groups. Exact-count overflow is diagnostic and must not replace the fixture's territory/work-level authority.");
  warnings.push("MusicBrainz release-group browsing does not prove that a usable cover exists. Live rows intentionally remain pendingCover; use captured application output to evaluate validated Cover Art Archive or label assets.");
  return { releases, requests, warnings };
}

type CliOptions = {
  fixturePath: string;
  inputPath: string | null;
  artist: string | null;
  live: boolean;
  all: boolean;
  maxPages: number;
  help: boolean;
};

export function parseBenchmarkCliArgs(args: string[]): CliOptions {
  const optionValue = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  const maxPagesRaw = optionValue("--max-pages");
  const maxPages = maxPagesRaw ? Number.parseInt(maxPagesRaw, 10) : 3;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
    throw new Error("--max-pages must be an integer from 1 to 10.");
  }
  return {
    fixturePath: optionValue("--fixture") ?? DEFAULT_FIXTURE_PATH,
    inputPath: optionValue("--input"),
    artist: optionValue("--artist"),
    live: args.includes("--live"),
    all: args.includes("--all"),
    maxPages,
    help: args.includes("--help") || args.includes("-h"),
  };
}

const HELP = `Discography benchmark (no paid services, AI disabled)

Offline application output:
  npx tsx scripts/benchmark-discographies.ts --input=var/discography-output.json
  npx tsx scripts/benchmark-discographies.ts --input=- --artist=miho-nakayama

Optional live MusicBrainz/Cover Art Archive snapshot:
  npx tsx scripts/benchmark-discographies.ts --live --artist=miho-nakayama
  npx tsx scripts/benchmark-discographies.ts --live --all --max-pages=3

Options:
  --fixture=<path>     Override the versioned fixture file.
  --input=<path|->     Read application JSON from a file or stdin.
  --artist=<slug|name> Select one artist; required for a bare release array.
  --live               Query free MusicBrainz metadata; never calls an AI model.
  --all                Explicitly permit a live or offline all-artist run.
  --max-pages=<1..10>  Hard cap MusicBrainz requests per artist (default 3).
`;

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonInput(inputPath: string) {
  let text: string;
  if (inputPath === "-") {
    process.stdin.setEncoding("utf8");
    text = "";
    for await (const chunk of process.stdin) text += chunk;
  } else {
    text = await readFile(inputPath, "utf8");
  }
  return JSON.parse(text) as unknown;
}

async function runCli() {
  try {
    const options = parseBenchmarkCliArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    if (options.live && options.inputPath) throw new Error("Choose either --live or --input, not both.");
    const manifest = await loadBenchmarkManifest(options.fixturePath);

    if (!options.live && !options.inputPath) {
      process.stdout.write(`${JSON.stringify({
        mode: "manifest",
        fixture: options.fixturePath,
        schemaVersion: manifest.schemaVersion,
        asOf: manifest.asOf,
        artists: manifest.artists.map((fixture) => ({
          slug: fixture.slug,
          artist: fixture.artist.canonicalName,
          catalogStatus: fixture.catalogStatus,
          baselines: fixture.baselines.map(({ category, kind, expected, asOf }) => ({ category, kind, expected, asOf })),
        })),
        next: "Pass --input=<application-output.json> for an offline evaluation, or --live --artist=<slug> for a free-source diagnostic.",
      }, null, 2)}\n`);
      return;
    }

    if (options.live) {
      if (!options.artist && !options.all) {
        throw new Error("Live mode requires --artist=<slug-or-name>; use --all explicitly for every fixture.");
      }
      const fixtures = options.artist
        ? [findArtistBenchmark(manifest, options.artist)].filter((fixture): fixture is ArtistBenchmark => fixture !== null)
        : manifest.artists;
      if (fixtures.length === 0) throw new Error(`Unknown benchmark artist: ${options.artist}`);
      const results: unknown[] = [];
      let anyRegression = false;
      for (const [index, fixture] of fixtures.entries()) {
        if (index > 0) await sleep(1_100);
        try {
          const live = await fetchMusicBrainzReleaseGroups(fixture, { maxPages: options.maxPages });
          const report = evaluateArtistBenchmark(fixture, live.releases, [], manifest.defaultMetrics);
          const retrievalComplete = !live.warnings.some((warning) => warning.startsWith("Stopped after"));
          const sourceOnlyAssessment = assessSourceOnlyRecall(report, retrievalComplete);
          anyRegression ||= sourceOnlyAssessment.status === "SOURCE_GAP";
          results.push({
            mode: "live-free-metadata",
            requests: live.requests,
            warnings: live.warnings,
            sourceOnlyAssessment,
            report,
          });
        } catch (error) {
          results.push({
            mode: "live-free-metadata",
            artist: fixture.artist.canonicalName,
            slug: fixture.slug,
            inconclusive: true,
            error: safeErrorMessage(error),
          });
        }
      }
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      if (anyRegression) process.exitCode = 1;
      return;
    }

    const parsed = await readJsonInput(options.inputPath!);
    const datasets = parseApplicationOutput(parsed, options.artist ?? undefined);
    const selectedFixtures = options.all
      ? manifest.artists
      : options.artist
        ? [findArtistBenchmark(manifest, options.artist)].filter((fixture): fixture is ArtistBenchmark => fixture !== null)
        : datasets.map((dataset) => findArtistBenchmark(manifest, dataset.artist)).filter((fixture): fixture is ArtistBenchmark => fixture !== null);
    if (selectedFixtures.length === 0) throw new Error("No application dataset matched a benchmark artist.");

    const reports = selectedFixtures.map((fixture) => {
      const dataset = datasets.find((candidate) => findArtistBenchmark(manifest, candidate.artist)?.slug === fixture.slug);
      return evaluateArtistBenchmark(
        fixture,
        dataset?.releases ?? [],
        dataset?.rejections ?? [],
        manifest.defaultMetrics,
      );
    });
    process.stdout.write(`${JSON.stringify({ mode: "offline-application-output", reports }, null, 2)}\n`);
    if (reports.some((report) => !report.passed)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) void runCli();
