import manifestJson from "@/data/authoritative-discography-manifests.json";
import type { CollectionScopeTarget } from "@/lib/ai/release-research-types";
import {
  evaluateCuratedHistoricalCanonBoundary,
  type CuratedCatalogStatus,
} from "@/lib/official-music/curated-canon-policy";

export type CuratedDiscographyCategory = "SINGLE" | "ORIGINAL_ALBUM";

export const curatedOriginalFormats = [
  "CD",
  "VINYL",
  "CASSETTE",
  "DIGITAL",
  "OTHER_PHYSICAL",
] as const;

export type CuratedOriginalFormat = (typeof curatedOriginalFormats)[number];
export type CuratedPhysicalCdAvailability =
  | "ORIGINAL_RELEASE"
  | "LATER_OFFICIAL_EDITION"
  | "NONE"
  | "UNKNOWN";
export type CuratedScopeExclusionReason =
  | "CASSETTE_ONLY"
  | "DIGITAL_ONLY"
  | "NO_CONFIRMED_PHYSICAL_CD";
export type CuratedPhysicalCdRepresentationKind =
  | "SAME_WORK_EDITION"
  | "CONTAINER_INCLUSION";
export type CuratedPhysicalCdDateEvidenceKind =
  | "EXACT_EDITION"
  | "AVAILABLE_BY";

export type CuratedPhysicalCdDateRelation =
  | "EXACT_EDITION_MATCH"
  | "EXACT_EDITION_MISMATCH"
  | "WITHIN_AVAILABLE_BY"
  | "AFTER_AVAILABLE_BY"
  | "UNRESOLVED";

/**
 * Work-level carrier scope is intentionally separate from the baseline work
 * count. A title can belong to an official singles count without ever having
 * had a physical-CD edition (for example, cassette-only or digital-only
 * singles).
 */
export type CuratedWorkMediaScope = {
  originalFormats: CuratedOriginalFormat[];
  physicalCd: CuratedPhysicalCdAvailability;
  /** ISO 3166-1 alpha-2 country of the declared CD carrier. Defaults to the artist manifest country. */
  physicalCdCountry?: string | null;
  physicalCdAuthorityUrls: string[];
  /**
   * Semantics of the authority date below. EXACT_EDITION identifies the
   * declared CD tuple itself. AVAILABLE_BY is an upper bound proving that an
   * official CD carrier existed by that date, normally via a box/compilation.
   * Older in-memory fixtures may omit it; the parser derives it compatibly.
   */
  physicalCdDateEvidenceKind?: CuratedPhysicalCdDateEvidenceKind | null;
  physicalCdReleaseDate: string | null;
  physicalCdCatalogNumber: string | null;
  /**
   * Defaults to SAME_WORK_EDITION for confirmed CD media. CONTAINER_INCLUSION
   * is reserved for an authority-declared compilation/box that physically
   * contains the canonical work but is not titled as that work.
   */
  physicalCdRepresentationKind?: CuratedPhysicalCdRepresentationKind | null;
  physicalCdContainerTitle?: string | null;
  exclusionReason: CuratedScopeExclusionReason | null;
};

export type CuratedWorkScopeDecision = {
  verdict: "PASS" | "UNKNOWN" | "OUT_OF_SCOPE";
  reasonCode: string;
  reason: string;
  representationFormat: string | null;
  authorityUrls: string[];
};

export type CuratedDiscographyWork = {
  ordinal: number;
  title: string;
  aliases: string[];
  /** Exact alternate/collaboration credits valid only for this work. */
  artistCredits?: string[];
  category: CuratedDiscographyCategory;
  originalReleaseDate: string | null;
  authorityUrls: string[];
  authorityAsOf: string;
  /** Null only for schema-v1 entries written before explicit carrier scope. */
  mediaScope: CuratedWorkMediaScope | null;
};

export type CuratedDiscographyBaselineKind = "exact" | "minimum";

export type CuratedDiscographyBaseline = {
  category: CuratedDiscographyCategory;
  kind: CuratedDiscographyBaselineKind;
  expected: number;
  /** Full official work count before carrier-specific scope exclusions. */
  officialCatalogTotal: number;
  asOf: string;
  /** Date on which an active catalogue was re-checked as a closed snapshot. */
  snapshotVerifiedAt?: string | null;
  /** Exact snapshots close history through snapshotVerifiedAt without closing future releases. */
  finalSnapshotKind?: "exact" | null;
  authorityUrls: string[];
  /** Runtime gates require this explicit marker as well as a count check. */
  completeWorkEnumeration: true;
};

export type CuratedArtistDiscography = {
  slug: string;
  canonicalName: string;
  aliases: string[];
  musicBrainzArtistId: string;
  country: string;
  /** Optional only for legacy injected test fixtures; parsed manifests always set it. */
  catalogStatus?: CuratedCatalogStatus;
  /** Optional only for legacy injected test fixtures; parsed manifests always set it. */
  baselines?: CuratedDiscographyBaseline[];
  works: CuratedDiscographyWork[];
};

type RawWork = {
  title: string;
  aliases?: string[];
  artistCredits?: string[];
  category: string;
  originalReleaseDate?: string;
  mediaScope?: unknown;
};

type RawManifest = {
  artists: Array<{
    slug: string;
    catalogStatus?: string;
    artist: {
      canonicalName: string;
      aliases: string[];
      country: string;
      musicbrainzArtistId: string;
    };
    baselines: Array<{
      category: string;
      kind?: string;
      expected: number;
      officialCatalogTotal?: number;
      asOf: string;
      snapshotVerifiedAt?: string;
      finalSnapshotKind?: string;
      sources: Array<{ url: string }>;
      expectedWorks?: RawWork[];
    }>;
  }>;
};

const manifest = manifestJson as RawManifest;

function normalizedIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function safeAuthorityUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function mediaScopeError(path: string, message: string): never {
  throw new Error(`Invalid curated discography ${path}: ${message}`);
}

/** Runtime parser used by the application as well as focused schema tests. */
export function parseCuratedWorkMediaScope(
  input: unknown,
  path = "mediaScope",
  defaultCountry: string | null = null,
): CuratedWorkMediaScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    mediaScopeError(path, "must be an object");
  }
  const value = input as Record<string, unknown>;
  const allowedFormats = new Set<string>(curatedOriginalFormats);
  if (!Array.isArray(value.originalFormats) || value.originalFormats.length === 0) {
    mediaScopeError(`${path}.originalFormats`, "must be a non-empty array");
  }
  const originalFormats = value.originalFormats.map((format, index) => {
    if (typeof format !== "string" || !allowedFormats.has(format)) {
      mediaScopeError(`${path}.originalFormats[${index}]`, "is invalid");
    }
    return format as CuratedOriginalFormat;
  });
  if (new Set(originalFormats).size !== originalFormats.length) {
    mediaScopeError(`${path}.originalFormats`, "must be unique");
  }

  const physicalCdValues = new Set<unknown>([
    "ORIGINAL_RELEASE",
    "LATER_OFFICIAL_EDITION",
    "NONE",
    "UNKNOWN",
  ]);
  if (!physicalCdValues.has(value.physicalCd)) {
    mediaScopeError(`${path}.physicalCd`, "is invalid");
  }
  const physicalCd = value.physicalCd as CuratedPhysicalCdAvailability;
  if (physicalCd === "ORIGINAL_RELEASE" && !originalFormats.includes("CD")) {
    mediaScopeError(path, "ORIGINAL_RELEASE physicalCd requires CD in originalFormats");
  }

  const rawPhysicalCdCountry = value.physicalCdCountry ?? defaultCountry;
  const physicalCdCountry = rawPhysicalCdCountry === null
    ? null
    : typeof rawPhysicalCdCountry === "string" && /^[A-Z]{2}$/u.test(rawPhysicalCdCountry)
      ? rawPhysicalCdCountry
      : mediaScopeError(`${path}.physicalCdCountry`, "must be an ISO alpha-2 country code or null");
  if ((physicalCd === "NONE" || physicalCd === "UNKNOWN") &&
    value.physicalCdCountry !== undefined && value.physicalCdCountry !== null) {
    mediaScopeError(path, `${physicalCd} physicalCd cannot have physicalCdCountry`);
  }

  const rawUrls = value.physicalCdAuthorityUrls ?? [];
  if (!Array.isArray(rawUrls)) {
    mediaScopeError(`${path}.physicalCdAuthorityUrls`, "must be an array");
  }
  const physicalCdAuthorityUrls = rawUrls.map((url, index) => {
    const parsed = typeof url === "string" ? safeAuthorityUrl(url) : null;
    if (!parsed) mediaScopeError(`${path}.physicalCdAuthorityUrls[${index}]`, "is invalid");
    return parsed;
  });
  if (new Set(physicalCdAuthorityUrls).size !== physicalCdAuthorityUrls.length) {
    mediaScopeError(`${path}.physicalCdAuthorityUrls`, "must be unique");
  }
  if (physicalCd === "LATER_OFFICIAL_EDITION" && physicalCdAuthorityUrls.length === 0) {
    mediaScopeError(path, "LATER_OFFICIAL_EDITION requires physicalCdAuthorityUrls");
  }
  if ((physicalCd === "NONE" || physicalCd === "UNKNOWN") && physicalCdAuthorityUrls.length > 0) {
    mediaScopeError(path, `${physicalCd} physicalCd cannot have physicalCdAuthorityUrls`);
  }

  const physicalCdReleaseDate = value.physicalCdReleaseDate ?? null;
  if (physicalCdReleaseDate !== null &&
    (typeof physicalCdReleaseDate !== "string" || !isIsoDate(physicalCdReleaseDate))) {
    mediaScopeError(`${path}.physicalCdReleaseDate`, "must be a real YYYY-MM-DD date or null");
  }
  const physicalCdCatalogNumber = value.physicalCdCatalogNumber ?? null;
  if (physicalCdCatalogNumber !== null &&
    (typeof physicalCdCatalogNumber !== "string" || !physicalCdCatalogNumber.trim())) {
    mediaScopeError(`${path}.physicalCdCatalogNumber`, "must be a non-empty string or null");
  }
  if ((physicalCd === "NONE" || physicalCd === "UNKNOWN") &&
    (physicalCdReleaseDate !== null || physicalCdCatalogNumber !== null)) {
    mediaScopeError(path, `${physicalCd} physicalCd cannot have CD edition metadata`);
  }

  const rawRepresentationKind = value.physicalCdRepresentationKind ?? null;
  const representationValues = new Set<unknown>([
    "SAME_WORK_EDITION",
    "CONTAINER_INCLUSION",
  ]);
  if (rawRepresentationKind !== null && !representationValues.has(rawRepresentationKind)) {
    mediaScopeError(`${path}.physicalCdRepresentationKind`, "is invalid");
  }
  const physicalCdRepresentationKind = physicalCd === "ORIGINAL_RELEASE" ||
      physicalCd === "LATER_OFFICIAL_EDITION"
    ? (rawRepresentationKind ?? "SAME_WORK_EDITION") as CuratedPhysicalCdRepresentationKind
    : null;
  if ((physicalCd === "NONE" || physicalCd === "UNKNOWN") && rawRepresentationKind !== null) {
    mediaScopeError(path, `${physicalCd} physicalCd cannot declare a representation kind`);
  }
  const rawDateEvidenceKind = value.physicalCdDateEvidenceKind ?? null;
  const dateEvidenceValues = new Set<unknown>(["EXACT_EDITION", "AVAILABLE_BY"]);
  if (rawDateEvidenceKind !== null && !dateEvidenceValues.has(rawDateEvidenceKind)) {
    mediaScopeError(`${path}.physicalCdDateEvidenceKind`, "is invalid");
  }
  const physicalCdDateEvidenceKind = physicalCdReleaseDate === null
    ? null
    : (rawDateEvidenceKind ??
      (physicalCd === "LATER_OFFICIAL_EDITION"
        ? "AVAILABLE_BY"
        : "EXACT_EDITION")) as CuratedPhysicalCdDateEvidenceKind;
  if (physicalCdReleaseDate === null && rawDateEvidenceKind !== null) {
    mediaScopeError(path, "physicalCdDateEvidenceKind requires physicalCdReleaseDate");
  }
  if (physicalCdRepresentationKind === "CONTAINER_INCLUSION" &&
    physicalCdDateEvidenceKind !== "AVAILABLE_BY") {
    mediaScopeError(
      `${path}.physicalCdDateEvidenceKind`,
      "CONTAINER_INCLUSION can only prove AVAILABLE_BY for the canonical work",
    );
  }
  const rawContainerTitle = value.physicalCdContainerTitle ?? null;
  if (rawContainerTitle !== null &&
    (typeof rawContainerTitle !== "string" || !rawContainerTitle.trim())) {
    mediaScopeError(`${path}.physicalCdContainerTitle`, "must be a non-empty string or null");
  }
  const physicalCdContainerTitle = typeof rawContainerTitle === "string"
    ? rawContainerTitle.trim()
    : null;
  if (physicalCdRepresentationKind === "CONTAINER_INCLUSION") {
    if (
      physicalCd !== "LATER_OFFICIAL_EDITION" ||
      !physicalCdReleaseDate ||
      !physicalCdCatalogNumber ||
      !physicalCdContainerTitle
    ) {
      mediaScopeError(
        path,
        "CONTAINER_INCLUSION requires a later official CD date, catalog number, and container title",
      );
    }
  } else if (physicalCdContainerTitle !== null) {
    mediaScopeError(
      `${path}.physicalCdContainerTitle`,
      "is only valid for CONTAINER_INCLUSION",
    );
  }

  const exclusionReasons = new Set<unknown>([
    "CASSETTE_ONLY",
    "DIGITAL_ONLY",
    "NO_CONFIRMED_PHYSICAL_CD",
  ]);
  const exclusionReason = value.exclusionReason ?? null;
  if (exclusionReason !== null && !exclusionReasons.has(exclusionReason)) {
    mediaScopeError(`${path}.exclusionReason`, "is invalid");
  }
  if (physicalCd === "NONE" && exclusionReason === null) {
    mediaScopeError(path, "NONE physicalCd requires exclusionReason");
  }
  if (physicalCd !== "NONE" && exclusionReason !== null) {
    mediaScopeError(path, "exclusionReason is only valid when physicalCd is NONE");
  }
  if (exclusionReason === "CASSETTE_ONLY" &&
    (originalFormats.length !== 1 || originalFormats[0] !== "CASSETTE")) {
    mediaScopeError(path, "CASSETTE_ONLY requires originalFormats [CASSETTE]");
  }
  if (exclusionReason === "DIGITAL_ONLY" &&
    (originalFormats.length !== 1 || originalFormats[0] !== "DIGITAL")) {
    mediaScopeError(path, "DIGITAL_ONLY requires originalFormats [DIGITAL]");
  }

  return {
    originalFormats,
    physicalCd,
    ...(physicalCdCountry && (physicalCd === "ORIGINAL_RELEASE" ||
      physicalCd === "LATER_OFFICIAL_EDITION")
      ? { physicalCdCountry }
      : {}),
    physicalCdAuthorityUrls,
    physicalCdDateEvidenceKind,
    physicalCdReleaseDate: physicalCdReleaseDate as string | null,
    physicalCdCatalogNumber: typeof physicalCdCatalogNumber === "string"
      ? physicalCdCatalogNumber.trim()
      : null,
    physicalCdRepresentationKind,
    physicalCdContainerTitle,
    exclusionReason: exclusionReason as CuratedScopeExclusionReason | null,
  };
}

/** Backward-compatible semantic projection for older manifests and fixtures. */
export function curatedPhysicalCdDateEvidenceKind(
  media: CuratedWorkMediaScope | null,
): CuratedPhysicalCdDateEvidenceKind | null {
  if (!media?.physicalCdReleaseDate) return null;
  return media.physicalCdDateEvidenceKind ??
    (media.physicalCd === "LATER_OFFICIAL_EDITION"
      ? "AVAILABLE_BY"
      : "EXACT_EDITION");
}

/**
 * Classifies an independently verified CD edition date against the manifest
 * anchor. WITHIN_AVAILABLE_BY does not verify the candidate by itself; it only
 * prevents a later container date from rejecting an independently proven,
 * legitimate earlier edition.
 */
export function curatedPhysicalCdDateRelation(
  media: CuratedWorkMediaScope | null,
  independentlyVerifiedEditionDate: string | null | undefined,
): CuratedPhysicalCdDateRelation {
  const anchor = media?.physicalCdReleaseDate ?? null;
  if (!anchor || !independentlyVerifiedEditionDate ||
    !isIsoDate(independentlyVerifiedEditionDate)) return "UNRESOLVED";
  if (curatedPhysicalCdDateEvidenceKind(media) === "EXACT_EDITION") {
    return independentlyVerifiedEditionDate === anchor
      ? "EXACT_EDITION_MATCH"
      : "EXACT_EDITION_MISMATCH";
  }
  return independentlyVerifiedEditionDate <= anchor
    ? "WITHIN_AVAILABLE_BY"
    : "AFTER_AVAILABLE_BY";
}

function curatedManifestError(path: string, message: string): never {
  throw new Error(`Invalid curated discography ${path}: ${message}`);
}

function buildCuratedArtist(
  artist: RawManifest["artists"][number],
): CuratedArtistDiscography | null {
  const hasEnumeratedBaseline = artist.baselines.some((baseline) =>
    Boolean(baseline.expectedWorks?.length));
  if (!hasEnumeratedBaseline) return null;
  if (artist.catalogStatus !== "active" && artist.catalogStatus !== "fixed") {
    curatedManifestError(`${artist.slug}.catalogStatus`, "must be active or fixed");
  }
  const catalogStatus = artist.catalogStatus;
  const works: CuratedDiscographyWork[] = [];
  const baselines: CuratedDiscographyBaseline[] = [];
  const populatedCategories = new Set<CuratedDiscographyCategory>();
  for (const baseline of artist.baselines) {
    if (!baseline.expectedWorks?.length) continue;
    if (baseline.category !== "SINGLE" && baseline.category !== "ORIGINAL_ALBUM") {
      curatedManifestError(`${artist.slug}.${baseline.category}`, "has an unsupported category");
    }
    if (populatedCategories.has(baseline.category)) {
      curatedManifestError(`${artist.slug}.${baseline.category}`, "is declared more than once");
    }
    populatedCategories.add(baseline.category);
    const expectedKind = catalogStatus === "fixed" ? "exact" : "minimum";
    if (baseline.kind !== expectedKind) {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.kind`,
        `must be ${expectedKind} for a ${catalogStatus} catalog`,
      );
    }
    if (!Number.isSafeInteger(baseline.expected) || baseline.expected <= 0) {
      curatedManifestError(`${artist.slug}.${baseline.category}.expected`, "must be a positive integer");
    }
    const declaredWorkCount = baseline.officialCatalogTotal ?? baseline.expected;
    if (baseline.expectedWorks.length !== declaredWorkCount) {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.expectedWorks`,
        `contains ${baseline.expectedWorks.length} works but the declared catalog count is ${declaredWorkCount}`,
      );
    }
    if (baseline.officialCatalogTotal !== undefined &&
      (!Number.isSafeInteger(baseline.officialCatalogTotal) ||
        baseline.officialCatalogTotal < baseline.expected)) {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.officialCatalogTotal`,
        "must be an integer greater than or equal to expected",
      );
    }
    if (!isIsoDate(baseline.asOf)) {
      curatedManifestError(`${artist.slug}.${baseline.category}.asOf`, "must be a real YYYY-MM-DD date");
    }
    const snapshotVerifiedAt = baseline.snapshotVerifiedAt ?? null;
    const finalSnapshotKind = baseline.finalSnapshotKind ?? null;
    if ((snapshotVerifiedAt === null) !== (finalSnapshotKind === null)) {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.snapshotVerifiedAt`,
        "and finalSnapshotKind must either both be present or both be absent",
      );
    }
    if (snapshotVerifiedAt !== null &&
      (!isIsoDate(snapshotVerifiedAt) || snapshotVerifiedAt < baseline.asOf)) {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.snapshotVerifiedAt`,
        "must be a real date on or after asOf",
      );
    }
    if (finalSnapshotKind !== null && finalSnapshotKind !== "exact") {
      curatedManifestError(
        `${artist.slug}.${baseline.category}.finalSnapshotKind`,
        "must be exact when supplied",
      );
    }
    if (baseline.sources.length === 0) {
      curatedManifestError(`${artist.slug}.${baseline.category}.sources`, "must not be empty");
    }
    const authorityUrls = baseline.sources.map((source, sourceIndex) => {
      const url = safeAuthorityUrl(source.url);
      if (!url) {
        curatedManifestError(
          `${artist.slug}.${baseline.category}.sources[${sourceIndex}].url`,
          "must be a credential-free HTTPS URL without an explicit port",
        );
      }
      return url;
    });
    const claimedTitleKeys = new Map<string, number>();
    const baselineStart = works.length;
    for (const [index, work] of baseline.expectedWorks.entries()) {
      const workPath = `${artist.slug}.${baseline.category}.expectedWorks[${index}]`;
      if (work.category !== baseline.category) {
        curatedManifestError(`${workPath}.category`, "must match its baseline category");
      }
      if (typeof work.title !== "string" || !work.title.trim()) {
        curatedManifestError(`${workPath}.title`, "must be a non-empty string");
      }
      if (work.originalReleaseDate !== undefined && !isIsoDate(work.originalReleaseDate)) {
        curatedManifestError(
          `${workPath}.originalReleaseDate`,
          "must be a real YYYY-MM-DD date when supplied",
        );
      }
      if (work.aliases !== undefined && !Array.isArray(work.aliases)) {
        curatedManifestError(`${workPath}.aliases`, "must be an array when supplied");
      }
      if (work.artistCredits !== undefined && !Array.isArray(work.artistCredits)) {
        curatedManifestError(`${workPath}.artistCredits`, "must be an array when supplied");
      }
      const variants = [work.title, ...(work.aliases ?? [])];
      const aliases: string[] = [];
      const ownTitleKeys = new Set<string>();
      for (const [variantIndex, variant] of variants.entries()) {
        if (typeof variant !== "string" || !variant.trim()) {
          curatedManifestError(
            `${workPath}.${variantIndex === 0 ? "title" : `aliases[${variantIndex - 1}]`}`,
            "must be a non-empty string",
          );
        }
        const key = normalizedIdentity(variant);
        if (!key) {
          curatedManifestError(
            `${workPath}.${variantIndex === 0 ? "title" : `aliases[${variantIndex - 1}]`}`,
            "must contain searchable characters",
          );
        }
        const priorWork = claimedTitleKeys.get(key);
        if (priorWork !== undefined && priorWork !== index) {
          curatedManifestError(
            workPath,
            `shares a normalized title or alias with expectedWorks[${priorWork}]`,
          );
        }
        claimedTitleKeys.set(key, index);
        if (ownTitleKeys.has(key)) continue;
        ownTitleKeys.add(key);
        if (variantIndex > 0) aliases.push(variant.trim());
      }
      const artistCredits: string[] = [];
      const artistCreditKeys = new Set<string>();
      for (const [creditIndex, credit] of (work.artistCredits ?? []).entries()) {
        if (typeof credit !== "string" || !credit.trim()) {
          curatedManifestError(
            `${workPath}.artistCredits[${creditIndex}]`,
            "must be a non-empty complete artist credit",
          );
        }
        const key = normalizedIdentity(credit);
        if (!key) {
          curatedManifestError(
            `${workPath}.artistCredits[${creditIndex}]`,
            "must contain searchable characters",
          );
        }
        if (artistCreditKeys.has(key)) {
          curatedManifestError(`${workPath}.artistCredits`, "must be unique");
        }
        artistCreditKeys.add(key);
        artistCredits.push(credit.trim());
      }
      works.push({
        ordinal: index + 1,
        title: work.title.trim(),
        aliases,
        artistCredits,
        category: baseline.category,
        originalReleaseDate: work.originalReleaseDate ?? null,
        authorityUrls,
        authorityAsOf: baseline.asOf,
        mediaScope: work.mediaScope === undefined
          ? null
          : parseCuratedWorkMediaScope(
              work.mediaScope,
              `${artist.slug}.${baseline.category}.expectedWorks[${index}].mediaScope`,
              artist.artist.country,
            ),
      });
    }
    if (baseline.officialCatalogTotal !== undefined) {
      const baselineWorks = works.slice(baselineStart);
      if (baselineWorks.some((work) => work.mediaScope === null)) {
        curatedManifestError(
          `${artist.slug}.${baseline.category}.officialCatalogTotal`,
          "requires mediaScope on every expected work",
        );
      }
      const originalCdCount = baselineWorks.filter((work) => {
        const availability = work.mediaScope?.physicalCd;
        return availability === "ORIGINAL_RELEASE" ||
          availability === "LATER_OFFICIAL_EDITION";
      }).length;
      if (originalCdCount !== baseline.expected) {
        curatedManifestError(
          `${artist.slug}.${baseline.category}.expected`,
          `must equal the ${originalCdCount} ORIGINAL_CD-scope works in expectedWorks`,
        );
      }
    }
    baselines.push({
      category: baseline.category,
      kind: baseline.kind,
      expected: baseline.expected,
      officialCatalogTotal: declaredWorkCount,
      asOf: baseline.asOf,
      snapshotVerifiedAt,
      finalSnapshotKind: finalSnapshotKind as "exact" | null,
      authorityUrls,
      completeWorkEnumeration: true,
    });
  }
  return works.length > 0
    ? {
        slug: artist.slug,
        canonicalName: artist.artist.canonicalName,
        aliases: [...artist.artist.aliases],
        musicBrainzArtistId: artist.artist.musicbrainzArtistId,
        country: artist.artist.country,
        catalogStatus,
        baselines,
        works,
      }
    : null;
}

const curatedArtists: CuratedArtistDiscography[] = manifest.artists
  .map(buildCuratedArtist)
  .filter((artist): artist is CuratedArtistDiscography => artist !== null);

/**
 * Returns only versioned, source-backed work manifests. Identity is bound by
 * MusicBrainz artist id when available; exact normalized names are a fallback
 * for source outages and never use substring or fuzzy matching.
 */
export function findCuratedArtistDiscography(
  musicBrainzArtistId: string | null | undefined,
  artistNames: readonly string[],
) {
  const normalizedId = musicBrainzArtistId?.normalize("NFKC").trim().toLowerCase() ?? null;
  if (normalizedId) {
    return curatedArtists.find((artist) =>
      artist.musicBrainzArtistId.toLowerCase() === normalizedId) ?? null;
  }
  const names = new Set(artistNames.map(normalizedIdentity).filter(Boolean));
  const matches = curatedArtists.filter((artist) =>
    [artist.canonicalName, ...artist.aliases].some((name) => names.has(normalizedIdentity(name))));
  return matches.length === 1 ? matches[0]! : null;
}

export function normalizedCuratedWorkTitle(value: string | null | undefined) {
  return normalizedIdentity(value);
}

export function curatedWorkTitleKeys(work: CuratedDiscographyWork) {
  return new Set([work.title, ...work.aliases].map(normalizedCuratedWorkTitle).filter(Boolean));
}

export function findCuratedCanonicalWork(
  manifest: CuratedArtistDiscography,
  candidate: {
    title: string;
    category: string;
    originalReleaseDate: string | null | undefined;
  },
) {
  if (candidate.category !== "SINGLE" && candidate.category !== "ORIGINAL_ALBUM") {
    return null;
  }
  const title = normalizedCuratedWorkTitle(candidate.title);
  return manifest.works.find((work) =>
    work.category === candidate.category &&
    curatedWorkTitleKeys(work).has(title) &&
    (!work.originalReleaseDate || work.originalReleaseDate === candidate.originalReleaseDate)) ?? null;
}

export type CuratedHistoricalCanonDecision =
  | {
      outcome: "NOT_APPLICABLE";
      baseline: null;
      work: null;
      reasonCode: null;
    }
  | {
      outcome: "CANONICAL_MEMBER";
      baseline: CuratedDiscographyBaseline;
      work: CuratedDiscographyWork;
      reasonCode: null;
    }
  | {
      outcome: "POST_CUTOFF_NEW_WORK";
      baseline: CuratedDiscographyBaseline;
      work: null;
      reasonCode: null;
    }
  | {
      outcome: "OUT_OF_SCOPE";
      baseline: CuratedDiscographyBaseline;
      work: null;
      reasonCode: "CURATED_HISTORICAL_NON_CANONICAL_WORK";
    }
  | {
      outcome: "OUT_OF_SCOPE";
      baseline: CuratedDiscographyBaseline;
      work: CuratedDiscographyWork;
      reasonCode: "CURATED_CANONICAL_TITLE_DATE_CONFLICT";
    };

/**
 * Applies a closed historical canon only when production metadata proves that
 * this artist/category has a complete work enumeration and an unambiguous
 * fixed/active cutoff policy.
 */
export function curatedHistoricalCanonDecision(
  manifest: CuratedArtistDiscography,
  candidate: {
    title: string;
    category: string;
    originalReleaseDate: string | null | undefined;
  },
): CuratedHistoricalCanonDecision {
  if (candidate.category !== "SINGLE" && candidate.category !== "ORIGINAL_ALBUM") {
    return { outcome: "NOT_APPLICABLE", baseline: null, work: null, reasonCode: null };
  }
  const status = manifest.catalogStatus;
  if (status !== "active" && status !== "fixed") {
    return { outcome: "NOT_APPLICABLE", baseline: null, work: null, reasonCode: null };
  }
  const baseline = manifest.baselines?.find((item) => item.category === candidate.category);
  const expectedKind = status === "fixed" ? "exact" : "minimum";
  const categoryWorkCount = manifest.works.filter((work) =>
    work.category === candidate.category).length;
  if (!baseline || baseline.kind !== expectedKind ||
    baseline.completeWorkEnumeration !== true || !isIsoDate(baseline.asOf) ||
    baseline.authorityUrls.length === 0 ||
    categoryWorkCount !== baseline.officialCatalogTotal) {
    return { outcome: "NOT_APPLICABLE", baseline: null, work: null, reasonCode: null };
  }

  const work = findCuratedCanonicalWork(manifest, candidate);
  const title = normalizedCuratedWorkTitle(candidate.title);
  const titleMatchedWork = manifest.works.find((item) =>
    item.category === candidate.category && curatedWorkTitleKeys(item).has(title)) ?? null;
  const boundary = evaluateCuratedHistoricalCanonBoundary({
    catalogStatus: status,
    isCanonicalMember: work !== null,
    hasCanonicalTitleDateConflict: work === null && titleMatchedWork !== null,
    originalReleaseDate: candidate.originalReleaseDate,
    asOf: curatedCanonBoundaryAsOf(baseline),
  });
  if (boundary.outcome === "CANONICAL_MEMBER") {
    return { outcome: boundary.outcome, baseline, work: work!, reasonCode: null };
  }
  if (boundary.outcome === "POST_CUTOFF_NEW_WORK") {
    return { outcome: boundary.outcome, baseline, work: null, reasonCode: null };
  }
  if (boundary.reasonCode === "CURATED_CANONICAL_TITLE_DATE_CONFLICT") {
    return {
      outcome: boundary.outcome,
      baseline,
      work: titleMatchedWork!,
      reasonCode: boundary.reasonCode,
    };
  }
  return {
    outcome: boundary.outcome,
    baseline,
    work: null,
    reasonCode: boundary.reasonCode,
  };
}

export function curatedCanonBoundaryAsOf(
  baseline: CuratedDiscographyBaseline,
) {
  return baseline.finalSnapshotKind === "exact" && baseline.snapshotVerifiedAt
    ? baseline.snapshotVerifiedAt
    : baseline.asOf;
}

function physicalFormatLabel(formats: readonly CuratedOriginalFormat[]) {
  const first = formats.find((format) => format !== "DIGITAL");
  if (first === "VINYL") return "Vinyl";
  if (first === "CASSETTE") return "Cassette";
  if (first === "OTHER_PHYSICAL") return "Physical media";
  return first === "CD" ? "CD" : null;
}

/**
 * Resolves work membership against the user's requested carrier target. The
 * decision never infers CD availability merely from membership in an official
 * singles/albums count.
 */
export function curatedWorkScopeDecision(
  work: CuratedDiscographyWork,
  target: CollectionScopeTarget,
): CuratedWorkScopeDecision {
  const media = work.mediaScope;
  if (!media) {
    // Schema-v1 compatibility: existing curated manifests were authored as
    // complete-CD catalogues. New manifests must write mediaScope explicitly.
    return {
      verdict: "PASS",
      reasonCode: "OFFICIAL_CD_MANIFEST_WORK_SCOPE",
      reason: "This legacy schema-v1 entry belongs to an established official complete-CD catalogue.",
      representationFormat: "CD",
      authorityUrls: work.authorityUrls,
    };
  }

  const cdConfirmed = media.physicalCd === "ORIGINAL_RELEASE" ||
    media.physicalCd === "LATER_OFFICIAL_EDITION";
  const cdTarget = target === "ORIGINAL_CD" || target === "ALL_CD";
  if (cdTarget) {
    if (cdConfirmed) {
      return {
        verdict: "PASS",
        reasonCode: media.physicalCd === "ORIGINAL_RELEASE"
          ? "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED"
          : "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
        reason: media.physicalCd === "ORIGINAL_RELEASE"
          ? "The authority manifest confirms an original physical-CD issue for this work."
          : "The authority manifest confirms a later official physical-CD edition for this canonical work.",
        representationFormat: "CD",
        authorityUrls: media.physicalCdAuthorityUrls.length > 0
          ? media.physicalCdAuthorityUrls
          : work.authorityUrls,
      };
    }
    if (media.physicalCd === "UNKNOWN") {
      return {
        verdict: "UNKNOWN",
        reasonCode: "CURATED_PHYSICAL_CD_UNCONFIRMED",
        reason: "The canonical work is authoritative, but no physical-CD edition has yet been confirmed.",
        representationFormat: null,
        authorityUrls: work.authorityUrls,
      };
    }
    const reasonCode = media.exclusionReason === "CASSETTE_ONLY"
      ? "CURATED_CASSETTE_ONLY_OUT_OF_CD_SCOPE"
      : media.exclusionReason === "DIGITAL_ONLY"
        ? "CURATED_DIGITAL_ONLY_OUT_OF_CD_SCOPE"
        : "CURATED_NO_PHYSICAL_CD_OUT_OF_CD_SCOPE";
    return {
      verdict: "OUT_OF_SCOPE",
      reasonCode,
      reason: media.exclusionReason === "CASSETTE_ONLY"
        ? "The authority manifest identifies this as a cassette-only work with no physical-CD edition."
        : media.exclusionReason === "DIGITAL_ONLY"
          ? "The authority manifest identifies this as a digital-only work with no physical-CD edition."
          : "The authority manifest confirms that this work has no physical-CD edition.",
      representationFormat: null,
      authorityUrls: work.authorityUrls,
    };
  }

  const physicalFormat = physicalFormatLabel(media.originalFormats);
  if (physicalFormat || cdConfirmed) {
    return {
      verdict: "PASS",
      reasonCode: "CURATED_PHYSICAL_CARRIER_CONFIRMED",
      reason: "The authority manifest confirms a physical carrier for this canonical work.",
      representationFormat: physicalFormat ?? "CD",
      authorityUrls: cdConfirmed && media.physicalCdAuthorityUrls.length > 0
        ? media.physicalCdAuthorityUrls
        : work.authorityUrls,
    };
  }
  if (media.exclusionReason === "DIGITAL_ONLY") {
    return {
      verdict: "OUT_OF_SCOPE",
      reasonCode: "CURATED_DIGITAL_ONLY_OUT_OF_PHYSICAL_SCOPE",
      reason: "The authority manifest identifies this as a digital-only work with no physical carrier.",
      representationFormat: null,
      authorityUrls: work.authorityUrls,
    };
  }
  return {
    verdict: "UNKNOWN",
    reasonCode: "CURATED_PHYSICAL_CARRIER_UNCONFIRMED",
    reason: "The canonical work is authoritative, but its physical-carrier availability is unresolved.",
    representationFormat: null,
    authorityUrls: work.authorityUrls,
  };
}

export const curatedDiscographyManifestCount = curatedArtists.length;
