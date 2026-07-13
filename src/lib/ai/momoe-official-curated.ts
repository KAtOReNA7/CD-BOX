import "server-only";

import type { ComprehensiveEvidenceObservation } from "@/lib/ai/comprehensive-evidence-audit";
import type {
  CuratedArtistDiscography,
  CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import {
  MOMOE_YAMAGUCHI_OTONANO_ORIGIN,
  MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
  MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS,
  MOMOE_YAMAGUCHI_SONY_ORIGIN,
  momoeYamaguchiSonyAlbumJsonpUrl,
  momoeYamaguchiSonyAlbumProductUrl,
  type MomoeYamaguchiCanonicalWork,
  type MomoeYamaguchiCatalogResult,
  type MomoeYamaguchiWorkCoverEvidence,
} from "@/lib/official-music/momoe-yamaguchi";

const MOMOE_SLUG = "momoe-yamaguchi";
const MOMOE_NAME = "山口百恵";
const MOMOE_LATIN_NAME = "Momoe Yamaguchi";
const MOMOE_COUNTRY = "JP";
const MOMOE_MUSICBRAINZ_ARTIST_ID = "85c1ff8e-b819-416d-9b73-5be468f7211a";
const EXPECTED_SINGLES = 32;
const EXPECTED_ALBUMS = 22;
const EXPECTED_WORKS = EXPECTED_SINGLES + EXPECTED_ALBUMS;
const OTONANO_COVER_PATH =
  "/files/6/OTONANO/originalpage/golden_idol/img/momoe/";
const SONY_COVER_PATH = "/adm_image/common/artist_image/";

export type MomoeOfficialCuratedMatch = {
  manifestEntryKey: string;
  manifestOrdinal: number;
  canonicalTitle: string;
  observedTitle: string;
  category: CuratedDiscographyWork["category"];
  originalReleaseDate: string;
  authority: ComprehensiveEvidenceObservation;
  cover: MomoeYamaguchiWorkCoverEvidence;
};

export type MomoeOfficialCuratedFailureCode =
  | "SOURCE_NOT_COMPLETE"
  | "ARTIST_IDENTITY_MISMATCH"
  | "MANIFEST_SHAPE_INVALID"
  | "OFFICIAL_CATALOG_SHAPE_INVALID"
  | "OFFICIAL_PROVENANCE_INVALID"
  | "WORK_MAPPING_NOT_BIJECTIVE";

export type MomoeOfficialCuratedResult = {
  status: "COMPLETE" | "FAIL_CLOSED";
  complete: boolean;
  reasonCode: MomoeOfficialCuratedFailureCode | null;
  message: string | null;
  matches: MomoeOfficialCuratedMatch[];
  authorityByManifestEntryKey: Record<string, ComprehensiveEvidenceObservation>;
  coverByManifestEntryKey: Record<string, MomoeYamaguchiWorkCoverEvidence>;
};

function fail(
  reasonCode: MomoeOfficialCuratedFailureCode,
  message: string,
): MomoeOfficialCuratedResult {
  return {
    status: "FAIL_CLOSED",
    complete: false,
    reasonCode,
    message,
    matches: [],
    authorityByManifestEntryKey: {},
    coverByManifestEntryKey: {},
  };
}

function exactText(value: string) {
  return value.normalize("NFKC").trim();
}

function normalizedTitle(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function isFullIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function titleKeys(title: string, aliases: readonly string[]) {
  return new Set([title, ...aliases].map(normalizedTitle).filter(Boolean));
}

function setsIntersect(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function manifestEntryKey(work: CuratedDiscographyWork) {
  return `${work.category}:${work.ordinal}`;
}

function sourceStructuralKey(work: MomoeYamaguchiCanonicalWork) {
  return [
    work.category,
    String(work.ordinal),
    work.originalReleaseDate,
    normalizedTitle(work.title),
  ].join(":");
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function safeCoverAsset(
  work: MomoeYamaguchiCanonicalWork,
  expectedSourceUrl: string,
) {
  const url = safeHttpsUrl(work.cover.url);
  if (
    !url ||
    work.cover.provider !== "sony-music-otonano" ||
    work.cover.scope !== "WORK" ||
    work.cover.matchLevel !== "WORK_EXACT" ||
    work.cover.sourceUrl !== expectedSourceUrl
  ) return false;
  if (work.category === "SINGLE") {
    return url.origin === MOMOE_YAMAGUCHI_OTONANO_ORIGIN &&
      url.pathname.startsWith(OTONANO_COVER_PATH) &&
      /^[A-Za-z0-9]+\.jpe?g$/i.test(url.pathname.slice(OTONANO_COVER_PATH.length));
  }
  return url.origin === MOMOE_YAMAGUCHI_SONY_ORIGIN &&
    url.pathname.startsWith(SONY_COVER_PATH) &&
    /\/jacket_image\/[A-Za-z0-9_-]+\.jpe?g$/i.test(url.pathname);
}

function exactAuthorityUrls(values: readonly string[], expected: string) {
  return values.length === 1 && values[0] === expected;
}

function validOfficialProvenance(work: MomoeYamaguchiCanonicalWork) {
  if (
    !isFullIsoDate(work.originalReleaseDate) ||
    !work.title.trim() ||
    work.evidence.provider !== "sony-music-otonano" ||
    work.evidence.sourceType !== "official-record-label-catalog" ||
    work.evidence.role !== "AUTHORITATIVE" ||
    work.evidence.strength !== "STRONG" ||
    work.evidence.scope !== "WORK" ||
    work.evidence.observedArtist !== MOMOE_NAME ||
    work.evidence.observedTitle !== work.title ||
    work.evidence.observedCategory !== work.category ||
    work.evidence.observedOriginalReleaseDate !== work.originalReleaseDate ||
    work.evidence.cover.provider !== work.cover.provider ||
    work.evidence.cover.scope !== work.cover.scope ||
    work.evidence.cover.matchLevel !== work.cover.matchLevel ||
    work.evidence.cover.url !== work.cover.url ||
    work.evidence.cover.sourceUrl !== work.cover.sourceUrl
  ) return false;

  if (work.category === "SINGLE") {
    return work.sourceEdition === null &&
      typeof work.originalCatalogNumber === "string" &&
      /^(?:SOLB|0[679]SH)\s+\d+$/i.test(work.originalCatalogNumber) &&
      work.evidence.observedOriginalCatalogNumber === work.originalCatalogNumber &&
      work.evidence.observedEditionCatalogNumber === null &&
      work.evidence.observedEditionReleaseDate === null &&
      work.evidence.sourceUrl === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL &&
      work.evidence.retrievalUrl === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL &&
      exactAuthorityUrls(work.authorityUrls, MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) &&
      exactAuthorityUrls(work.evidence.sourceUrls, MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL) &&
      safeCoverAsset(work, MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL);
  }

  const catalogNumber = work.sourceEdition?.catalogNumber;
  if (!catalogNumber || !MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.includes(catalogNumber)) {
    return false;
  }
  const sourceUrl = momoeYamaguchiSonyAlbumProductUrl(catalogNumber);
  return work.originalCatalogNumber === null &&
    isFullIsoDate(work.sourceEdition?.releaseDate) &&
    work.sourceEdition!.releaseDate > work.originalReleaseDate &&
    work.evidence.observedOriginalCatalogNumber === null &&
    work.evidence.observedEditionCatalogNumber === catalogNumber &&
    work.evidence.observedEditionReleaseDate === work.sourceEdition!.releaseDate &&
    work.evidence.sourceUrl === sourceUrl &&
    work.evidence.retrievalUrl === momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber) &&
    exactAuthorityUrls(work.authorityUrls, sourceUrl) &&
    exactAuthorityUrls(work.evidence.sourceUrls, sourceUrl) &&
    safeCoverAsset(work, sourceUrl);
}

function exactArtistIdentity(
  manifest: CuratedArtistDiscography,
  catalog: MomoeYamaguchiCatalogResult,
) {
  return manifest.slug === MOMOE_SLUG &&
    exactText(manifest.canonicalName) === MOMOE_NAME &&
    manifest.aliases.some((alias) => exactText(alias) === MOMOE_LATIN_NAME) &&
    manifest.musicBrainzArtistId.toLocaleLowerCase("en") === MOMOE_MUSICBRAINZ_ARTIST_ID &&
    manifest.country === MOMOE_COUNTRY &&
    exactText(catalog.artist.canonicalName) === MOMOE_NAME &&
    catalog.artist.aliases.length === 1 &&
    exactText(catalog.artist.aliases[0]) === MOMOE_LATIN_NAME &&
    catalog.artist.country === MOMOE_COUNTRY;
}

function categoryShape<T extends {
  ordinal: number;
  category: string;
  originalReleaseDate: string | null;
}>(
  works: readonly T[],
  category: CuratedDiscographyWork["category"],
  expected: number,
) {
  const categoryWorks = works.filter((work) => work.category === category);
  if (categoryWorks.length !== expected) return false;
  const ordinals = [...categoryWorks].map((work) => work.ordinal).sort((a, b) => a - b);
  return ordinals.every((ordinal, index) => ordinal === index + 1) &&
    categoryWorks.every((work) => isFullIsoDate(work.originalReleaseDate));
}

function validManifestShape(manifest: CuratedArtistDiscography) {
  if (
    manifest.works.length !== EXPECTED_WORKS ||
    !categoryShape(manifest.works, "SINGLE", EXPECTED_SINGLES) ||
    !categoryShape(manifest.works, "ORIGINAL_ALBUM", EXPECTED_ALBUMS)
  ) return false;
  const keys = new Set<string>();
  for (const work of manifest.works) {
    const key = manifestEntryKey(work);
    if (
      keys.has(key) ||
      !work.title.trim() ||
      !isFullIsoDate(work.originalReleaseDate) ||
      titleKeys(work.title, work.aliases).size === 0
    ) return false;
    keys.add(key);
  }
  return true;
}

function validCatalogShape(catalog: MomoeYamaguchiCatalogResult) {
  if (
    catalog.status !== "COMPLETE" ||
    !catalog.complete ||
    catalog.warnings.length !== 0 ||
    catalog.works.length !== EXPECTED_WORKS ||
    catalog.singles.length !== EXPECTED_SINGLES ||
    catalog.originalAlbums.length !== EXPECTED_ALBUMS ||
    !categoryShape(catalog.singles, "SINGLE", EXPECTED_SINGLES) ||
    !categoryShape(catalog.originalAlbums, "ORIGINAL_ALBUM", EXPECTED_ALBUMS)
  ) return false;
  if (
    catalog.singles.some((work) => work.category !== "SINGLE") ||
    catalog.originalAlbums.some((work) => work.category !== "ORIGINAL_ALBUM")
  ) return false;

  const expectedUnion = [...catalog.singles, ...catalog.originalAlbums];
  const expectedKeys = expectedUnion.map(sourceStructuralKey);
  const worksKeys = catalog.works.map(sourceStructuralKey);
  if (
    new Set(expectedKeys).size !== EXPECTED_WORKS ||
    new Set(worksKeys).size !== EXPECTED_WORKS ||
    expectedKeys.some((key) => !worksKeys.includes(key)) ||
    worksKeys.some((key) => !expectedKeys.includes(key))
  ) return false;
  return expectedUnion.every(validOfficialProvenance);
}

function dynamicAuthority(
  manifestWork: CuratedDiscographyWork,
  sourceWork: MomoeYamaguchiCanonicalWork,
): ComprehensiveEvidenceObservation {
  const key = manifestEntryKey(manifestWork);
  return {
    id: `sony-music-otonano:curated:${key}`,
    provider: "sony-music-otonano",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "MOMOE_OFFICIAL_CURATED_WORK_MATCH",
    reason: "The live Sony/OTONANO fixed catalog uniquely confirms this curated canonical work, its complete original date, and official work-level artwork.",
    sourceUrl: sourceWork.evidence.sourceUrl,
    matchedFields: [
      "artist",
      "title",
      "category",
      "date",
      ...(sourceWork.originalCatalogNumber ? ["catalogNumber"] : []),
    ],
    facts: {
      manifestEntryKey: key,
      artist: MOMOE_NAME,
      title: sourceWork.title,
      date: sourceWork.originalReleaseDate,
      catalogNumber: sourceWork.originalCatalogNumber,
      canonicalTitle: manifestWork.title,
      observedTitle: sourceWork.title,
      category: manifestWork.category,
      originalReleaseDate: sourceWork.originalReleaseDate,
      originalCatalogNumber: sourceWork.originalCatalogNumber,
      editionCatalogNumber: sourceWork.sourceEdition?.catalogNumber ?? null,
      editionReleaseDate: sourceWork.sourceEdition?.releaseDate ?? null,
      authoritySourceUrl: sourceWork.evidence.sourceUrl,
      retrievalUrl: sourceWork.evidence.retrievalUrl,
      coverUrl: sourceWork.cover.url,
      workMatch: "BIJECTIVE_EXACT_CATEGORY_DATE_TITLE_OR_ALIAS",
    },
  };
}

/**
 * Produces dynamic authority facts only when the fixed official 32+22 catalog
 * is a complete bijection with the curated manifest. It never creates a
 * release candidate and never changes a curated work's carrier scope.
 */
export function matchMomoeOfficialCatalogToCurated(
  manifest: CuratedArtistDiscography,
  catalog: MomoeYamaguchiCatalogResult,
): MomoeOfficialCuratedResult {
  if (catalog.status !== "COMPLETE" || !catalog.complete) {
    return fail(
      "SOURCE_NOT_COMPLETE",
      "The live Sony/OTONANO catalog was not complete, so no dynamic authority was emitted.",
    );
  }
  if (!exactArtistIdentity(manifest, catalog)) {
    return fail(
      "ARTIST_IDENTITY_MISMATCH",
      "The curated manifest and official catalog did not have the exact Momoe Yamaguchi identity and country.",
    );
  }
  if (!validManifestShape(manifest)) {
    return fail(
      "MANIFEST_SHAPE_INVALID",
      "The curated manifest did not contain exactly 32 singles and 22 original albums with complete dates.",
    );
  }
  if (!validCatalogShape(catalog)) {
    const provenanceInvalid = [...catalog.singles, ...catalog.originalAlbums]
      .some((work) => !validOfficialProvenance(work));
    return fail(
      provenanceInvalid ? "OFFICIAL_PROVENANCE_INVALID" : "OFFICIAL_CATALOG_SHAPE_INVALID",
      provenanceInvalid
        ? "The official catalog contained an unsafe or unauditable evidence or cover source."
        : "The official catalog did not contain one internally consistent fixed 32+22 snapshot.",
    );
  }

  const sourceWorks = [...catalog.singles, ...catalog.originalAlbums];
  const edges = manifest.works.map((manifestWork) => {
    const manifestTitles = titleKeys(manifestWork.title, manifestWork.aliases);
    return sourceWorks
      .map((sourceWork, index) => ({ sourceWork, index }))
      .filter(({ sourceWork }) =>
        sourceWork.category === manifestWork.category &&
        sourceWork.originalReleaseDate === manifestWork.originalReleaseDate &&
        setsIntersect(manifestTitles, titleKeys(sourceWork.title, sourceWork.aliases)));
  });
  if (edges.some((matches) => matches.length !== 1)) {
    return fail(
      "WORK_MAPPING_NOT_BIJECTIVE",
      "At least one curated work had zero or multiple exact category/date/title-or-alias matches.",
    );
  }
  const sourceOwners = new Map<number, number>();
  for (const [manifestIndex, matches] of edges.entries()) {
    const sourceIndex = matches[0]!.index;
    if (sourceOwners.has(sourceIndex)) {
      return fail(
        "WORK_MAPPING_NOT_BIJECTIVE",
        "More than one curated work mapped to the same official catalog work.",
      );
    }
    sourceOwners.set(sourceIndex, manifestIndex);
  }
  if (sourceOwners.size !== EXPECTED_WORKS) {
    return fail(
      "WORK_MAPPING_NOT_BIJECTIVE",
      "The official catalog contained a work that was not uniquely covered by the curated manifest.",
    );
  }

  const matches = manifest.works.map((manifestWork, index): MomoeOfficialCuratedMatch => {
    const sourceWork = edges[index]![0]!.sourceWork;
    const authority = dynamicAuthority(manifestWork, sourceWork);
    return {
      manifestEntryKey: manifestEntryKey(manifestWork),
      manifestOrdinal: manifestWork.ordinal,
      canonicalTitle: manifestWork.title,
      observedTitle: sourceWork.title,
      category: manifestWork.category,
      originalReleaseDate: sourceWork.originalReleaseDate,
      authority,
      cover: sourceWork.cover,
    };
  });
  return {
    status: "COMPLETE",
    complete: true,
    reasonCode: null,
    message: null,
    matches,
    authorityByManifestEntryKey: Object.fromEntries(
      matches.map((match) => [match.manifestEntryKey, match.authority]),
    ),
    coverByManifestEntryKey: Object.fromEntries(
      matches.map((match) => [match.manifestEntryKey, match.cover]),
    ),
  };
}
