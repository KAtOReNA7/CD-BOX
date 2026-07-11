import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";

const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 5_000;

const countryAliases: Record<string, string> = {
  china: "CN",
  chn: "CN",
  cn: "CN",
  prc: "CN",
  中国: "CN",
  中华人民共和国: "CN",
  中國: "CN",
  中華人民共和國: "CN",
  japan: "JP",
  jpn: "JP",
  jp: "JP",
  日本: "JP",
  日本国: "JP",
  日本國: "JP",
  hongkong: "HK",
  hkg: "HK",
  hk: "HK",
  香港: "HK",
  taiwan: "TW",
  twn: "TW",
  tw: "TW",
  台湾: "TW",
  臺灣: "TW",
  korea: "KR",
  kor: "KR",
  kr: "KR",
  southkorea: "KR",
  韩国: "KR",
  韓國: "KR",
  韓国: "KR",
  unitedstates: "US",
  usa: "US",
  us: "US",
  美国: "US",
  美國: "US",
  greatbritain: "GB",
  unitedkingdom: "GB",
  uk: "GB",
  gb: "GB",
  英国: "GB",
  英國: "GB",
};

export type ItunesAlbumResult = {
  collectionId: number;
  artistId: number;
  artistName: string;
  collectionName: string;
  releaseDate: string | null;
  artworkUrl100: string | null;
  collectionViewUrl: string | null;
};

export type ItunesFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

export type ItunesSearchOptions = {
  fetchImpl?: ItunesFetch;
  timeoutMs?: number;
  limit?: number;
};

export type ItunesEnrichmentOptions = ItunesSearchOptions & {
  artistQuery?: string;
};

function normalizeCountryKey(country: string) {
  return country
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{Z}]/gu, "");
}

export function resolveItunesCountryCode(country: string | null | undefined) {
  if (!country) return "US";
  const normalized = normalizeCountryKey(country);
  if (countryAliases[normalized]) return countryAliases[normalized];
  return /^[a-z]{2}$/i.test(normalized) ? normalized.toUpperCase() : "US";
}

export function normalizeItunesTitle(title: string | null | undefined) {
  return (title ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function releaseYear(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 2999 ? year : null;
}

function candidateYear(candidate: ReleaseResearchCandidate) {
  return releaseYear(candidate.originalReleaseDate) ?? releaseYear(candidate.releaseDate);
}

function candidateTitleKeys(candidate: ReleaseResearchCandidate) {
  return new Set(
    [candidate.title, candidate.titleOriginal]
      .map(normalizeItunesTitle)
      .filter(Boolean),
  );
}

function exactTitleAndYearMatches(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
) {
  const titleKeys = candidateTitleKeys(candidate);
  const year = candidateYear(candidate);
  if (titleKeys.size === 0 || year === null) return [];

  return albums.filter(
    (album) =>
      titleKeys.has(normalizeItunesTitle(album.collectionName)) &&
      releaseYear(album.releaseDate) === year,
  );
}

export function selectDominantItunesArtistId(
  candidates: readonly ReleaseResearchCandidate[],
  albums: readonly ItunesAlbumResult[],
  minimumCollections = 2,
) {
  const evidence = new Map<number, Set<number>>();

  for (const candidate of candidates) {
    const matches = [
      ...new Map(
        exactTitleAndYearMatches(candidate, albums).map((album) => [album.collectionId, album]),
      ).values(),
    ];
    if (matches.length !== 1) continue;

    const match = matches[0];
    const collectionIds = evidence.get(match.artistId) ?? new Set<number>();
    collectionIds.add(match.collectionId);
    evidence.set(match.artistId, collectionIds);
  }

  const ranked = [...evidence.entries()].sort(
    (left, right) => right[1].size - left[1].size || left[0] - right[0],
  );
  const winner = ranked[0];
  if (!winner || winner[1].size < Math.max(1, minimumCollections)) return null;
  if (ranked[1]?.[1].size === winner[1].size) return null;

  const totalEvidence = ranked.reduce((total, item) => total + item[1].size, 0);
  return winner[1].size * 2 > totalEvidence ? winner[0] : null;
}

export function findExactItunesAlbumMatch(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
  artistId: number | null,
) {
  if (artistId === null) return null;
  const matches = exactTitleAndYearMatches(candidate, albums).filter(
    (album) => album.artistId === artistId,
  );
  const uniqueMatches = [...new Map(matches.map((album) => [album.collectionId, album])).values()];

  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

function isHttpUrlWithHost(value: string, allowedHost: (hostname: string) => boolean) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!allowedHost(url.hostname.toLowerCase())) return null;
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

function isAppleArtworkHost(hostname: string) {
  return (
    hostname === "mzstatic.com" ||
    hostname.endsWith(".mzstatic.com") ||
    hostname === "itunes.apple.com" ||
    hostname.endsWith(".itunes.apple.com")
  );
}

function isAppleStoreHost(hostname: string) {
  return (
    hostname === "music.apple.com" ||
    hostname.endsWith(".music.apple.com") ||
    hostname === "itunes.apple.com" ||
    hostname.endsWith(".itunes.apple.com")
  );
}

export function toItunesArtwork600(artworkUrl100: string | null | undefined) {
  if (!artworkUrl100) return null;
  const url = isHttpUrlWithHost(artworkUrl100, isAppleArtworkHost);
  if (!url) return null;

  const resizedPath = url.pathname.replace(
    /\/\d+x\d+([a-z0-9-]*\.[a-z0-9]+)$/i,
    "/600x600$1",
  );
  if (resizedPath === url.pathname) return null;
  url.pathname = resizedPath;
  return url.toString();
}

function normalizeAppleStoreUrl(value: string | null | undefined) {
  if (!value) return null;
  return isHttpUrlWithHost(value, isAppleStoreHost)?.toString() ?? null;
}

function optionalString(value: unknown, maximumLength = 2_048) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

function parseItunesAlbum(value: unknown): ItunesAlbumResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.wrapperType !== undefined && row.wrapperType !== "collection") return null;
  if (row.collectionType !== undefined && row.collectionType !== "Album") return null;

  const collectionId = typeof row.collectionId === "number" ? row.collectionId : Number.NaN;
  const artistId = typeof row.artistId === "number" ? row.artistId : Number.NaN;
  const artistName = optionalString(row.artistName, 500);
  const collectionName = optionalString(row.collectionName, 500);
  if (
    !Number.isSafeInteger(collectionId) ||
    collectionId <= 0 ||
    !Number.isSafeInteger(artistId) ||
    artistId <= 0 ||
    !artistName ||
    !collectionName
  ) return null;

  return {
    collectionId,
    artistId,
    artistName,
    collectionName,
    releaseDate: optionalString(row.releaseDate, 100),
    artworkUrl100: optionalString(row.artworkUrl100),
    collectionViewUrl: optionalString(row.collectionViewUrl),
  };
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

export async function searchItunesAlbums(
  artistName: string,
  country: string | null | undefined,
  options: ItunesSearchOptions = {},
): Promise<ItunesAlbumResult[]> {
  const term = artistName.trim();
  if (!term) return [];

  const countryCode = resolveItunesCountryCode(country);
  const effectiveLimit = clampInteger(options.limit, DEFAULT_LIMIT, 1, 200);
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("country", countryCode);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("attribute", "artistTerm");
  url.searchParams.set("limit", String(effectiveLimit));
  url.searchParams.set("lang", countryCode === "JP" ? "ja_jp" : "en_us");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 15_000),
  );

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { results?: unknown };
    if (!Array.isArray(payload?.results)) return [];
    return payload.results
      .slice(0, effectiveLimit)
      .map(parseItunesAlbum)
      .filter((album): album is ItunesAlbumResult => album !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function hasCjk(value: string) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(value);
}

function isCompositeArtistName(value: string) {
  const normalized = value.normalize("NFKC");
  return /[&+×/,，、]|\s[xX]\s|\bfeat(?:uring)?\.?\s|\bwith\b/i.test(normalized);
}

export function selectFrequentCjkArtistName(
  candidates: readonly ReleaseResearchCandidate[],
  albums: readonly ItunesAlbumResult[],
  artistId: number | null,
  minimumOccurrences = 2,
) {
  const evidence = new Map<
    string,
    { displayName: string; collectionIds: Set<number> }
  >();

  for (const candidate of candidates) {
    const album = findExactItunesAlbumMatch(candidate, albums, artistId);
    if (!album || !hasCjk(album.artistName) || isCompositeArtistName(album.artistName)) continue;
    const key = album.artistName.normalize("NFKC").trim();
    const current = evidence.get(key) ?? {
      displayName: key,
      collectionIds: new Set<number>(),
    };
    current.collectionIds.add(album.collectionId);
    evidence.set(key, current);
  }

  const ranked = [...evidence.values()].sort(
    (left, right) =>
      right.collectionIds.size - left.collectionIds.size ||
      left.displayName.localeCompare(right.displayName),
  );
  const winner = ranked[0];
  if (!winner || winner.collectionIds.size < Math.max(1, minimumOccurrences)) return null;
  if (ranked[1]?.collectionIds.size === winner.collectionIds.size) return null;

  const totalEvidence = ranked.reduce((total, item) => total + item.collectionIds.size, 0);
  if (winner.collectionIds.size * 2 <= totalEvidence) return null;
  return winner.displayName;
}

function enrichCandidateCover(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
  artistId: number,
) {
  if (candidate.coverImageUrl) return candidate;
  const album = findExactItunesAlbumMatch(candidate, albums, artistId);
  if (!album) return candidate;

  const artworkUrl = toItunesArtwork600(album.artworkUrl100);
  const sourceUrl = normalizeAppleStoreUrl(album.collectionViewUrl);
  if (!artworkUrl || !sourceUrl) return candidate;

  return {
    ...candidate,
    coverImageUrl: artworkUrl,
    coverImageSourceUrl: sourceUrl,
  };
}

export function applyItunesAlbumEnrichment(
  result: ReleaseResearchResult,
  albums: readonly ItunesAlbumResult[],
  options: { artistQuery?: string } = {},
): ReleaseResearchResult {
  if (albums.length === 0) return result;
  const artistId = selectDominantItunesArtistId(result.releases, albums);
  if (artistId === null) return result;

  const localName = hasCjk(result.artist.name)
    ? null
    : selectFrequentCjkArtistName(result.releases, albums, artistId);
  const romanizedFallback = options.artistQuery?.trim() || result.artist.name;
  const artist = localName
    ? {
        ...result.artist,
        name: localName,
        nameRomaji:
          result.artist.nameRomaji ??
          (hasCjk(romanizedFallback) ? null : romanizedFallback),
      }
    : result.artist;

  return {
    ...result,
    artist,
    releases: result.releases.map((candidate) =>
      enrichCandidateCover(candidate, albums, artistId),
    ),
  };
}

export async function enrichReleaseResearchResultWithItunes(
  result: ReleaseResearchResult,
  options: ItunesEnrichmentOptions = {},
): Promise<ReleaseResearchResult> {
  const artistQuery =
    options.artistQuery?.trim() ||
    result.artist.nameRomaji?.trim() ||
    result.artist.name.trim();
  const albums = await searchItunesAlbums(artistQuery, result.artist.country, options);
  return albums.length > 0
    ? applyItunesAlbumEnrichment(result, albums, { artistQuery })
    : result;
}
