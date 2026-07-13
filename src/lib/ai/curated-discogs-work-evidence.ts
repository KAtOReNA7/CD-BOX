import type { CuratedDiscographyWork } from "@/lib/official-music/curated-discography";
import type {
  DiscogsReleaseEvidence,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";

export type ExactDiscogsArtistInventory = {
  /** The caller must have resolved this query to one exact Discogs artist inventory. */
  exact: true;
  query: string;
  artistNames: readonly string[];
};

export type CuratedDiscogsTitleMatchKind =
  | "NFKC_EXACT"
  | "MANIFEST_ALIAS"
  | "DISCOGS_ROMANIZATION_SUFFIX"
  | "AB_COMPOSITE_COMPONENT";

export type CuratedDiscogsWorkEvidence = {
  provider: "discogs";
  evidenceRole: "corroborating-only";
  scope: "WORK";
  reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH";
  matchKind: CuratedDiscogsTitleMatchKind;
  matchedFields: readonly ["artist", "title", "category", "originalYear"];
  release: DiscogsSearchReleaseEvidence;
  sourceUrl: string;
  facts: {
    canonicalTitle: string;
    discogsTitle: string;
    category: CuratedDiscographyWork["category"];
    originalYear: string;
    catalogNumber: string | null;
    formats: string;
  };
  cover: {
    provider: "discogs";
    matchLevel: "WORK";
    imageUrl: string;
    sourceUrl: string;
    /** Search artwork is only a candidate until the normal image validator succeeds. */
    requiresAssetValidation: true;
  } | null;
};

export type CuratedDiscogsWorkBinding = {
  work: CuratedDiscographyWork;
  inventory: ExactDiscogsArtistInventory;
  evidence: CuratedDiscogsWorkEvidence;
};

type RankedMatch = {
  row: DiscogsSearchReleaseEvidence;
  discogsTitle: string;
  matchKind: CuratedDiscogsTitleMatchKind;
  promo: boolean;
  explicitCategory: boolean;
  declaredOriginalCarrier: boolean;
  normalizedCatalog: string;
  validCoverUrl: string | null;
};

const rejectedWorkKinds = new Set([
  "best",
  "best of",
  "box",
  "box set",
  "compilation",
  "dj mix",
  "dj-mix",
  "ep",
  "live",
  "mini-album",
  "mixed",
  "remix",
]);

const digitalFormats = new Set([
  "aac",
  "alac",
  "digital",
  "file",
  "flac",
  "mp3",
  "ogg vorbis",
  "wav",
]);

const physicalFormats = new Set([
  "8-track cartridge",
  "blu-ray",
  "cassette",
  "cd",
  "dat",
  "dvd",
  "flexi-disc",
  "laserdisc",
  "minidisc",
  "reel-to-reel",
  "sacd",
  "shellac",
  "vhs",
  "vinyl",
]);

function normalizedIdentity(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function normalizedFormat(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("und")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function originalYear(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})(?:-|$)/u);
  return match?.[1] ?? null;
}

function exactDiscogsReleaseUrl(value: string, releaseId: number) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "www.discogs.com" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.pathname === `/release/${releaseId}`;
  } catch {
    return false;
  }
}

function exactDiscogsApiUrl(value: string, releaseId: number) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "api.discogs.com" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.pathname === `/releases/${releaseId}`;
  } catch {
    return false;
  }
}

function allowedDiscogsCoverUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en");
    return url.protocol === "https:" &&
        (host === "i.discogs.com" || host === "img.discogs.com") &&
        !url.username && !url.password && !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function splitDiscogsSearchTitle(value: string) {
  // Preserve full-width A/B separators in the title. Individual artist/title
  // identities are normalized only after the fixed Discogs separator is cut.
  const trimmed = value.trim();
  const separator = trimmed.indexOf(" - ");
  if (separator <= 0 || separator + 3 >= trimmed.length) return null;
  return {
    artist: trimmed.slice(0, separator).trim(),
    title: trimmed.slice(separator + 3).trim(),
  };
}

function discogsArtistMatches(
  value: string,
  inventoryNames: ReadonlySet<string>,
) {
  // Discogs commonly renders the same credit in two scripts as
  // "山口百恵* = Momoe Yamaguchi". Treat the fixed equals notation as
  // alternative names, never as a collaboration. Credits joined with &, x,
  // feat., or commas remain whole and therefore fail exact identity matching.
  const alternatives = value.normalize("NFKC").split(" = ")
    .map(normalizedIdentity)
    .filter(Boolean);
  return alternatives.length > 0 && alternatives.some((name) => inventoryNames.has(name));
}

function explicitMultiArtistCredit(value: string) {
  return /(?:\s(?:&|and|with|feat\.?|featuring|×)\s|[,、])/iu.test(value.normalize("NFKC"));
}

function romanizationSuffixBase(value: string) {
  const parts = value.normalize("NFKC").split(" = ");
  if (parts.length !== 2) return null;
  const base = parts[0]!.trim();
  const suffix = parts[1]!.trim();
  if (!base || !suffix || !/\p{Script=Latin}/u.test(suffix)) return null;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(suffix)) {
    return null;
  }
  return base;
}

function abComponents(value: string) {
  const original = value.trim();
  if (original.includes("／")) {
    const parts = original.split("／").map((part) => part.trim()).filter(Boolean);
    return parts.length === 2 ? parts : [];
  }
  const normalized = original.normalize("NFKC");
  const parts = normalized.split(/\s+\/\s+/u).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [];
}

function titleMatch(
  work: CuratedDiscographyWork,
  discogsTitle: string,
): CuratedDiscogsTitleMatchKind | null {
  const primaryKey = normalizedIdentity(work.title);
  const aliasKeys = new Set(work.aliases.map(normalizedIdentity).filter(Boolean));
  const exactKey = normalizedIdentity(discogsTitle);
  if (primaryKey && exactKey === primaryKey) return "NFKC_EXACT";
  if (exactKey && aliasKeys.has(exactKey)) return "MANIFEST_ALIAS";

  const bilingualBase = romanizationSuffixBase(discogsTitle);
  if (bilingualBase) {
    const key = normalizedIdentity(bilingualBase);
    if (key && (key === primaryKey || aliasKeys.has(key))) {
      return "DISCOGS_ROMANIZATION_SUFFIX";
    }
  }

  const matchingComponents = abComponents(discogsTitle).filter((component) => {
    const componentBase = romanizationSuffixBase(component) ?? component;
    const key = normalizedIdentity(componentBase);
    return Boolean(key && (key === primaryKey || aliasKeys.has(key)));
  });
  return matchingComponents.length === 1 ? "AB_COMPOSITE_COMPONENT" : null;
}

function rowCategory(
  work: CuratedDiscographyWork,
  formats: readonly string[],
) {
  const values = formats.map(normalizedFormat);
  if (values.some((value) => rejectedWorkKinds.has(value))) return null;
  if (values.some((value) => digitalFormats.has(value))) return null;
  if (!values.some((value) => physicalFormats.has(value))) return null;

  const hasSingle = values.includes("single");
  const hasAlbum = values.includes("album");
  if (hasSingle && hasAlbum) return null;
  if (work.category === "SINGLE" && hasAlbum) return null;
  if (work.category === "ORIGINAL_ALBUM" && hasSingle) return null;
  return {
    explicit: work.category === "SINGLE" ? hasSingle : hasAlbum,
    promo: values.includes("promo") || values.includes("promotional"),
  };
}

function matchesDeclaredOriginalCarrier(
  work: CuratedDiscographyWork,
  formats: readonly string[],
) {
  const declared = work.mediaScope?.originalFormats ?? [];
  if (declared.length === 0) return false;
  const values = new Set(formats.map(normalizedFormat));
  return declared.some((format) =>
    (format === "CD" && values.has("cd")) ||
    (format === "VINYL" && values.has("vinyl")) ||
    (format === "CASSETTE" && values.has("cassette")));
}

function exactArtistInventory(inventory: ExactDiscogsArtistInventory) {
  if (inventory.exact !== true) return null;
  const names = new Set(inventory.artistNames.map(normalizedIdentity).filter(Boolean));
  const query = normalizedIdentity(inventory.query);
  return query && names.has(query) ? names : null;
}

function rankedMatches(input: {
  work: CuratedDiscographyWork;
  rows: readonly DiscogsSearchReleaseEvidence[];
  inventory: ExactDiscogsArtistInventory;
}) {
  const inventoryNames = exactArtistInventory(input.inventory);
  const year = originalYear(input.work.originalReleaseDate);
  if (!inventoryNames || !year) return [];
  const artistNames = new Set([
    ...inventoryNames,
    ...(input.work.artistCredits ?? []).map(normalizedIdentity).filter(Boolean),
  ]);

  const matches = new Map<number, RankedMatch>();
  for (const row of input.rows) {
    if (
      row.evidenceRole !== "corroborating-only" ||
      row.country !== "Japan" ||
      !Number.isInteger(row.releaseId) || row.releaseId <= 0 ||
      row.year !== Number(year) ||
      !exactDiscogsReleaseUrl(row.sourceUrl, row.releaseId) ||
      !exactDiscogsApiUrl(row.apiUrl, row.releaseId)
    ) continue;
    const parsedTitle = splitDiscogsSearchTitle(row.title);
    if (!parsedTitle || !discogsArtistMatches(parsedTitle.artist, artistNames)) continue;
    const category = rowCategory(input.work, row.formats);
    if (!category) continue;
    const matchKind = titleMatch(input.work, parsedTitle.title);
    if (!matchKind) continue;
    matches.set(row.releaseId, {
      row,
      discogsTitle: parsedTitle.title,
      matchKind,
      promo: category.promo,
      explicitCategory: category.explicit,
      declaredOriginalCarrier: matchesDeclaredOriginalCarrier(input.work, row.formats),
      normalizedCatalog: normalizedCatalog(row.catalogNumber),
      validCoverUrl: allowedDiscogsCoverUrl(row.coverImageUrl),
    });
  }
  return [...matches.values()];
}

function selectStableMatch(matches: readonly RankedMatch[]) {
  if (matches.length === 0) return null;
  let preferred = [...matches];
  if (preferred.some((match) => !match.promo)) {
    preferred = preferred.filter((match) => !match.promo);
  }
  if (preferred.some((match) => match.explicitCategory)) {
    preferred = preferred.filter((match) => match.explicitCategory);
  }
  // When the authority manifest declares the original carrier, prefer only
  // rows on that carrier before using master/catalog tie-breaks. This keeps a
  // same-master cassette from representing an authority-declared original CD.
  if (preferred.some((match) => match.declaredOriginalCarrier)) {
    preferred = preferred.filter((match) => match.declaredOriginalCarrier);
  }
  if (preferred.length === 1) return preferred[0]!;

  // A Discogs master is the work-level identity above carrier editions. The
  // original Japanese LP and cassette often have different catalog numbers;
  // treating those as different works caused systematic false negatives for
  // prolific 1980s artists. Resolve them only when every surviving row carries
  // the same non-null master. Different or missing masters remain ambiguous.
  const masterIds = new Set(preferred.map((match) => match.row.masterId));
  const oneSharedMaster = !masterIds.has(null) && masterIds.size === 1;
  const catalogs = new Set(preferred.map((match) => match.normalizedCatalog));
  if (!oneSharedMaster && (catalogs.has("") || catalogs.size !== 1)) return null;
  return preferred.sort((left, right) => {
    if (Boolean(left.validCoverUrl) !== Boolean(right.validCoverUrl)) {
      return left.validCoverUrl ? -1 : 1;
    }
    if (Boolean(left.row.masterId) !== Boolean(right.row.masterId)) {
      return left.row.masterId ? -1 : 1;
    }
    return left.row.releaseId - right.row.releaseId;
  })[0]!;
}

/**
 * Binds one curated canonical work to one Japan ALL_PHYSICAL Discogs row.
 * Discogs remains corroborating-only: the result can support original-work
 * identity and a WORK cover candidate, but never creates authority by itself.
 */
export function findCuratedDiscogsWorkEvidence(input: {
  work: CuratedDiscographyWork;
  rows: readonly DiscogsSearchReleaseEvidence[];
  inventory: ExactDiscogsArtistInventory;
}): CuratedDiscogsWorkEvidence | null {
  const match = selectStableMatch(rankedMatches(input));
  const year = originalYear(input.work.originalReleaseDate);
  if (!match || !year) return null;
  return {
    provider: "discogs",
    evidenceRole: "corroborating-only",
    scope: "WORK",
    reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
    matchKind: match.matchKind,
    matchedFields: ["artist", "title", "category", "originalYear"],
    release: match.row,
    sourceUrl: match.row.sourceUrl,
    facts: {
      canonicalTitle: input.work.title,
      discogsTitle: match.discogsTitle,
      category: input.work.category,
      originalYear: year,
      catalogNumber: match.row.catalogNumber,
      formats: match.row.formats.join(", "),
    },
    cover: match.validCoverUrl
      ? {
          provider: "discogs",
          matchLevel: "WORK",
          imageUrl: match.validCoverUrl,
          sourceUrl: match.row.sourceUrl,
          requiresAssetValidation: true,
        }
      : null,
  };
}

/**
 * Revalidates the detailed Discogs row before its artwork can become a WORK
 * cover candidate. Search identity alone is never sufficient for artwork.
 */
export function curatedDiscogsDetailMatchesWork(
  binding: CuratedDiscogsWorkBinding,
  detail: DiscogsReleaseEvidence,
) {
  const { evidence, inventory, work } = binding;
  const row = evidence.release;
  const inventoryNames = exactArtistInventory(inventory);
  // Keep detail identity identical to ranked search identity: only this
  // manifest work's explicitly declared alternate credits may extend the
  // exact Discogs artist inventory.
  const names = inventoryNames
    ? new Set([
        ...inventoryNames,
        ...(work.artistCredits ?? []).map(normalizedIdentity).filter(Boolean),
      ])
    : null;
  const declaredMultiArtistCredits = new Set((work.artistCredits ?? [])
    .filter(explicitMultiArtistCredit)
    .map(normalizedIdentity)
    .filter(Boolean));
  const expectedCatalog = normalizedCatalog(row.catalogNumber);
  const detailCatalogs = new Set(detail.labels
    .map((label) => normalizedCatalog(label.catalogNumber))
    .filter(Boolean));
  const expectedDate = work.originalReleaseDate;
  const detailArtists = [
    detail.artistCredit,
    ...detail.artists.flatMap((artist) => [artist.name, artist.anv]),
  ].filter((artist): artist is string => Boolean(artist));
  const detailArtistMatches = Boolean(names && (
    detail.artistCredit
      ? discogsArtistMatches(detail.artistCredit, names)
      : detail.artists.length === 1 && detailArtists.some((artist) =>
        discogsArtistMatches(artist, names))
  ));
  const detailArtistRowsConsistent = Boolean(names && (
    detail.artists.length === 0 ||
    (detail.artists.length === 1 && [
        detail.artists[0]!.name,
        detail.artists[0]!.anv,
      ].some((artist) => artist && discogsArtistMatches(artist, names))) ||
    (detail.artistCredit && declaredMultiArtistCredits.has(
      normalizedIdentity(detail.artistCredit),
    ))
  ));
  const detailFormats = detail.formats.flatMap((format) => [
    format.name,
    ...format.descriptions,
  ]);
  return Boolean(
    names &&
    detail.evidenceRole === "corroborating-only" &&
    detail.releaseId === row.releaseId &&
    (row.masterId === null || detail.masterId === row.masterId) &&
    detail.country === "Japan" &&
    exactDiscogsReleaseUrl(detail.sourceUrl, detail.releaseId) &&
    exactDiscogsApiUrl(detail.apiUrl, detail.releaseId) &&
    detailArtistMatches &&
    detailArtistRowsConsistent &&
    normalizedIdentity(detail.title) === normalizedIdentity(evidence.facts.discogsTitle) &&
    expectedDate && /^\d{4}-\d{2}-\d{2}$/.test(expectedDate) &&
    detail.released === expectedDate &&
    detail.year === Number(expectedDate.slice(0, 4)) &&
    expectedCatalog && detailCatalogs.has(expectedCatalog) &&
    rowCategory(work, detailFormats)
  );
}
