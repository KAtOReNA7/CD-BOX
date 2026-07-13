import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";

const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_MINIMUM_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;

let realItunesRequestQueue = Promise.resolve();
let nextRealItunesRequestAt = 0;

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

export type PersistedItunesEditionCoverBinding = {
  schemaVersion: 1;
  provider: "apple-music";
  collectionId: number;
  artistId: number;
  artistName: string;
  collectionName: string;
  /** Apple release day normalized from the provider's actual releaseDate. */
  releaseDate: string;
  imageUrl: string;
  sourceUrl: string;
  artistQuery: string;
  candidateIdentity: {
    id: string;
    title: string;
    titleOriginal: string | null;
    category: ReleaseResearchCandidate["category"];
    artistCredit: string;
    releaseDate: string;
    originalReleaseDate: string | null;
  };
};

export type ItunesFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json"> & { status?: number }>;

export type ItunesSearchOptions = {
  fetchImpl?: ItunesFetch;
  timeoutMs?: number;
  limit?: number;
  attribute?: "artistTerm" | "albumTerm";
  throwOnUnavailable?: boolean;
  retryCount?: number;
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
  const timestamp = validDateStart(value);
  return timestamp === null ? null : Number(value!.slice(0, 4));
}

function candidateYear(candidate: ReleaseResearchCandidate) {
  return releaseYear(candidate.originalReleaseDate) ?? releaseYear(candidate.releaseDate);
}

function candidateEditionYear(candidate: ReleaseResearchCandidate) {
  return releaseYear(candidate.releaseDate) ?? releaseYear(candidate.originalReleaseDate);
}

function candidateTitleKeys(candidate: ReleaseResearchCandidate) {
  return new Set(
    [candidate.title, candidate.titleOriginal]
      .map(normalizeItunesTitle)
      .filter(Boolean),
  );
}

function normalizeItunesCollectionTitle(title: string | null | undefined) {
  return normalizeItunesTitle((title ?? "").replace(/\s+-\s+(?:single|ep)\s*$/iu, ""));
}

function normalizedItunesWorkTitle(title: string | null | undefined) {
  return normalizeItunesTitle((title ?? "").replace(/\s+-\s+(?:single|ep)\s*$/iu, ""));
}

function completeScriptProjectionKeys(title: string | null | undefined) {
  const withoutStorefrontSuffix = (title ?? "").replace(/\s+-\s+(?:single|ep)\s*$/iu, "");
  const decomposed = withoutStorefrontSuffix.normalize("NFKD").replace(/\p{M}/gu, "");
  const cjk = [...decomposed.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  )].map((match) => match[0]).join("");
  const latin = decomposed.toLocaleLowerCase("und").replace(/[^a-z0-9]/gu, "");
  return [
    cjk.length >= 2 ? `cjk:${cjk}` : null,
    latin.length >= 3 ? `latin:${latin}` : null,
  ].filter((value): value is string => Boolean(value));
}

function candidateWorkTitleKeys(candidate: ReleaseResearchCandidate) {
  return new Set(
    [candidate.title, candidate.titleOriginal]
      .map(normalizedItunesWorkTitle)
      .filter(Boolean),
  );
}

function isSafeBilingualProjectionTitle(title: string | null | undefined) {
  if (!title) return false;
  const normalized = title.normalize("NFKC");
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) return false;
  if (!/[A-Za-z]/u.test(normalized)) return false;
  if (/[\/／＆&＋+]/u.test(normalized)) return false;
  if (/\b(?:remix|mix|version|ver\.?|edit|live|instrumental|karaoke|acoustic|re[- ]?record(?:ed)?|remaster(?:ed)?)\b/iu.test(normalized)) {
    return false;
  }
  return true;
}

function candidateProjectedWorkTitleKeys(candidate: ReleaseResearchCandidate) {
  return new Set(
    [candidate.title, candidate.titleOriginal]
      .filter(isSafeBilingualProjectionTitle)
      .flatMap(completeScriptProjectionKeys),
  );
}

function validDateStart(value: string | null | undefined) {
  if (!value) return null;
  const partial = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
  if (partial) {
    const year = Number(partial[1]);
    const month = partial[2] ? Number(partial[2]) : 1;
    const day = partial[3] ? Number(partial[3]) : 1;
    if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const timestamp = Date.UTC(year, month - 1, day);
    const checked = new Date(timestamp);
    return checked.getUTCFullYear() === year &&
      checked.getUTCMonth() === month - 1 &&
      checked.getUTCDate() === day
      ? timestamp
      : null;
  }
  const isoPrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})T/iu);
  if (!isoPrefix) return null;
  const year = Number(isoPrefix[1]);
  const month = Number(isoPrefix[2]);
  const day = Number(isoPrefix[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
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

/**
 * Cover-only fallback for Apple's fixed " - Single" / " - EP" suffix.
 * The candidate and storefront collection must still identify the same dated
 * edition; a later digital reissue must never provide artwork for an earlier
 * physical edition.
 */
export function findUniqueItunesCoverMatch(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
  artistId: number | null,
) {
  if (artistId === null) return null;
  const titleKeys = candidateTitleKeys(candidate);
  const year = candidateEditionYear(candidate);
  const editionDay = exactCalendarDay(candidate.releaseDate);
  if (titleKeys.size === 0 || year === null) return null;
  const matches = albums.filter((album) =>
    album.artistId === artistId &&
    titleKeys.has(normalizeItunesCollectionTitle(album.collectionName)) &&
    releaseYear(album.releaseDate) === year &&
    (!editionDay || album.releaseDate?.slice(0, 10) === editionDay));
  const uniqueMatches = [...new Map(matches.map((album) => [album.collectionId, album])).values()];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

/**
 * Work-level artwork fallback for a later Apple digital issue. This does not
 * attest the physical edition: the artist must already be identified, the
 * fixed Apple suffix is the only ignored title difference, exactly one
 * collection may carry that work title, and its valid date cannot predate the
 * work's original release.
 */
export function findUniqueItunesWorkCoverMatch(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
  artistId: number | null,
) {
  if (artistId === null) return null;
  const workDate = validDateStart(candidate.originalReleaseDate);
  const titleKeys = candidateWorkTitleKeys(candidate);
  if (workDate === null || titleKeys.size === 0) return null;

  const chooseExactWork = (matches: readonly ItunesAlbumResult[]) => {
    const uniqueMatches = [
      ...new Map(matches.map((album) => [album.collectionId, album])).values(),
    ];
    if (uniqueMatches.length === 0) return null;
    if (uniqueMatches.length === 1) {
      const sourceDate = validDateStart(uniqueMatches[0]!.releaseDate);
      return sourceDate !== null && sourceDate >= workDate ? uniqueMatches[0]! : null;
    }
    const originalDay = exactCalendarDay(candidate.originalReleaseDate);
    if (!originalDay) return null;
    const originalDayMatches = uniqueMatches.filter((album) =>
      album.releaseDate?.slice(0, 10) === originalDay);
    if (originalDayMatches.length !== 1) return null;
    return originalDayMatches[0]!;
  };

  const exactMatches = albums.filter((album) =>
    album.artistId === artistId &&
    compatibleAppleWorkCategory(candidate, album.collectionName) &&
    safeUnsuffixedAppleWorkDate(candidate, album) &&
    titleKeys.has(normalizedItunesWorkTitle(album.collectionName)));
  const exactWork = chooseExactWork(exactMatches);
  if (exactWork) return exactWork;

  // A script projection is deliberately much narrower than a normalized
  // title match. It exists only for storefront localization such as
  // "Witches ウィッチズ" -> "Witches - EP": the candidate itself must be a
  // safe bilingual equivalent, and artist, category and the complete original
  // calendar day must all agree. Composite titles and version markers never
  // enter this fallback.
  const projectedKeys = candidateProjectedWorkTitleKeys(candidate);
  const originalDay = exactCalendarDay(candidate.originalReleaseDate);
  if (projectedKeys.size === 0 || !originalDay) return null;
  const projectedMatches = albums.filter((album) =>
    album.artistId === artistId &&
    compatibleAppleWorkCategory(candidate, album.collectionName) &&
    album.releaseDate?.slice(0, 10) === originalDay &&
    completeScriptProjectionKeys(album.collectionName).some((key) => projectedKeys.has(key)));
  const uniqueProjectedMatches = [
    ...new Map(projectedMatches.map((album) => [album.collectionId, album])).values(),
  ];
  return uniqueProjectedMatches.length === 1 ? uniqueProjectedMatches[0]! : null;
}

function exactCalendarDay(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && validDateStart(value) !== null
    ? value
    : null;
}

function compatibleAppleWorkCategory(candidate: ReleaseResearchCandidate, collectionName: string) {
  const suffix = collectionName.normalize("NFKC").match(/\s+-\s+(single|ep)\s*$/iu)?.[1]
    ?.toLocaleLowerCase("en") ?? null;
  if (candidate.category === "SINGLE") return suffix === "single" || suffix === "ep" || suffix === null;
  if (candidate.category === "EP") return suffix === "ep" || suffix === null;
  if (candidate.category === "ORIGINAL_ALBUM") return suffix === null;
  return false;
}

function safeUnsuffixedAppleWorkDate(
  candidate: ReleaseResearchCandidate,
  album: ItunesAlbumResult,
) {
  if (candidate.category !== "SINGLE" && candidate.category !== "EP") return true;
  const hasSingleOrEpSuffix = /\s+-\s+(?:single|ep)\s*$/iu.test(
    album.collectionName.normalize("NFKC"),
  );
  if (hasSingleOrEpSuffix) return true;

  // An unsuffixed Apple collection can be an album with the same title as a
  // single. It may identify the single work only on the independently known
  // original calendar day; a merely later same-title collection is unsafe.
  const originalDay = exactCalendarDay(candidate.originalReleaseDate);
  return originalDay !== null && album.releaseDate?.slice(0, 10) === originalDay;
}

/**
 * Album-term searches sometimes localize a Japanese title into romaji. When
 * text equality is unavailable, a complete original-release day plus the
 * already dominant Apple artist and a unique category-compatible collection
 * can still bind the work. Callers must evaluate the full artist inventory as
 * well as the narrow title-search rows so ambiguity cannot be hidden.
 */
export function findUniqueItunesDatedWorkCoverMatch(
  candidate: ReleaseResearchCandidate,
  albums: readonly ItunesAlbumResult[],
  artistId: number | null,
) {
  if (artistId === null) return null;
  const originalDay = exactCalendarDay(candidate.originalReleaseDate);
  if (!originalDay) return null;
  const matches = albums.filter((album) =>
    album.artistId === artistId &&
    album.releaseDate?.slice(0, 10) === originalDay &&
    compatibleAppleWorkCategory(candidate, album.collectionName));
  const uniqueMatches = [...new Map(matches.map((album) => [album.collectionId, album])).values()];
  return uniqueMatches.length === 1 ? uniqueMatches[0]! : null;
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

export function normalizeAppleStoreUrl(value: string | null | undefined) {
  if (!value) return null;
  return isHttpUrlWithHost(value, isAppleStoreHost)?.toString() ?? null;
}

export function appleCollectionIdFromStoreUrl(value: string | null | undefined) {
  const normalized = normalizeAppleStoreUrl(value);
  if (!normalized) return null;
  const segments = new URL(normalized).pathname.split("/").filter(Boolean);
  const rawId = segments.at(-1);
  if (!rawId || !/^\d+$/u.test(rawId)) return null;
  const collectionId = Number(rawId);
  return Number.isSafeInteger(collectionId) && collectionId > 0 ? collectionId : null;
}

function exactItunesReleaseDay(value: string | null | undefined) {
  if (!value || validDateStart(value) === null) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/u);
  return match?.[1] ?? null;
}

/**
 * Seal the exact Apple album entity used for an edition cover retry.
 *
 * A work-level/later digital issue is intentionally not retry-persistable:
 * scheduled retries require the Apple entity's complete day to equal the
 * candidate's complete physical-edition day.
 */
export function createPersistedItunesEditionCoverBinding(
  candidate: ReleaseResearchCandidate,
  album: ItunesAlbumResult,
  artistQuery: string,
): PersistedItunesEditionCoverBinding | null {
  const candidateDay = exactCalendarDay(candidate.releaseDate);
  const appleDay = exactItunesReleaseDay(album.releaseDate);
  const imageUrl = toItunesArtwork600(album.artworkUrl100);
  const sourceUrl = normalizeAppleStoreUrl(album.collectionViewUrl);
  const normalizedArtistQuery = artistQuery.normalize("NFKC").trim();
  const normalizedArtistName = album.artistName.normalize("NFKC").trim();
  const normalizedCollectionName = album.collectionName.normalize("NFKC").trim();
  const normalizedArtistCredit = candidate.artistCredit.normalize("NFKC").trim();
  if (
    !candidateDay ||
    !appleDay ||
    appleDay !== candidateDay ||
    !imageUrl ||
    !sourceUrl ||
    appleCollectionIdFromStoreUrl(sourceUrl) !== album.collectionId ||
    !Number.isSafeInteger(album.collectionId) ||
    album.collectionId <= 0 ||
    !Number.isSafeInteger(album.artistId) ||
    album.artistId <= 0 ||
    !normalizedArtistQuery ||
    !normalizedArtistName ||
    !normalizedCollectionName ||
    !normalizedArtistCredit ||
    !candidateTitleKeys(candidate).has(normalizeItunesCollectionTitle(album.collectionName))
  ) return null;

  return {
    schemaVersion: 1,
    provider: "apple-music",
    collectionId: album.collectionId,
    artistId: album.artistId,
    artistName: normalizedArtistName,
    collectionName: normalizedCollectionName,
    releaseDate: appleDay,
    imageUrl,
    sourceUrl,
    artistQuery: normalizedArtistQuery,
    candidateIdentity: {
      id: candidate.id,
      title: candidate.title,
      titleOriginal: candidate.titleOriginal,
      category: candidate.category,
      artistCredit: candidate.artistCredit,
      releaseDate: candidateDay,
      originalReleaseDate: candidate.originalReleaseDate,
    },
  };
}

export function exactItunesAlbumMatchesPersistedEditionBinding(
  candidate: ReleaseResearchCandidate,
  album: ItunesAlbumResult,
  binding: PersistedItunesEditionCoverBinding,
) {
  const refreshed = createPersistedItunesEditionCoverBinding(
    candidate,
    album,
    binding.artistQuery,
  );
  if (!refreshed) return false;
  return binding.schemaVersion === 1 &&
    binding.provider === "apple-music" &&
    binding.collectionId === refreshed.collectionId &&
    binding.artistId === refreshed.artistId &&
    normalizeItunesTitle(binding.artistName) === normalizeItunesTitle(refreshed.artistName) &&
    normalizeItunesTitle(binding.collectionName) === normalizeItunesTitle(refreshed.collectionName) &&
    binding.releaseDate === refreshed.releaseDate &&
    appleCollectionIdFromStoreUrl(binding.sourceUrl) === binding.collectionId &&
    JSON.stringify(binding.candidateIdentity) === JSON.stringify(refreshed.candidateIdentity);
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

class ItunesHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ItunesHttpError";
  }
}

function readJsonBeforeAbort(response: Pick<Response, "json">, signal: AbortSignal) {
  const pending = response.json();
  if (signal.aborted) {
    return Promise.reject(new DOMException("iTunes JSON response timed out.", "AbortError"));
  }
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("iTunes JSON response timed out.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function runSerializedRealItunesRequest<T>(operation: () => Promise<T>) {
  const pending = realItunesRequestQueue.then(async () => {
    const waitForSlot = Math.max(0, nextRealItunesRequestAt - Date.now());
    if (waitForSlot > 0) await delay(waitForSlot);
    nextRealItunesRequestAt = Date.now() + DEFAULT_MINIMUM_INTERVAL_MS;
    return operation();
  });
  realItunesRequestQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function fetchItunesWithRetry(
  url: URL,
  options: ItunesSearchOptions,
) {
  const isRealRequest = options.fetchImpl === undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 4);
  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 15_000);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        redirect: "error",
      });
      if (response.ok) {
        try {
          return await readJsonBeforeAbort(response, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw new ItunesHttpError("iTunes Search returned invalid JSON.", false);
        }
      }

      const status = response.status ?? 0;
      const retryable = status === 429 || status >= 500;
      const error = new ItunesHttpError(
        `iTunes Search returned HTTP ${status || "error"}.`,
        retryable,
      );
      if (!retryable || attempt === retryCount) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error instanceof ItunesHttpError && !error.retryable) throw error;
      if (attempt === retryCount) throw error;
    } finally {
      clearTimeout(timeout);
    }

    // Custom fetch implementations are test doubles or caller-controlled
    // transports. Keep their retries immediate; only the real free endpoint
    // participates in the process-wide pacing policy.
    if (isRealRequest) {
      await delay(DEFAULT_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("iTunes Search was unavailable.");
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
  url.searchParams.set("attribute", options.attribute ?? "artistTerm");
  url.searchParams.set("limit", String(effectiveLimit));
  url.searchParams.set("lang", countryCode === "JP" ? "ja_jp" : "en_us");

  try {
    const payload = options.fetchImpl
      ? await fetchItunesWithRetry(url, options)
      : await runSerializedRealItunesRequest(() => fetchItunesWithRetry(url, options));

    const results = payload && typeof payload === "object" && "results" in payload
      ? payload.results
      : null;
    if (!Array.isArray(results)) return [];
    return results
      .slice(0, effectiveLimit)
      .map(parseItunesAlbum)
      .filter((album): album is ItunesAlbumResult => album !== null);
  } catch (error) {
    if (options.throwOnUnavailable) throw error;
    return [];
  }
}

/** Exact-entity lookup used by persisted cover retries; this is not search. */
export async function lookupItunesAlbumByCollectionId(
  collectionId: number,
  country: string | null | undefined,
  options: ItunesSearchOptions = {},
): Promise<ItunesAlbumResult | null> {
  if (!Number.isSafeInteger(collectionId) || collectionId <= 0) return null;
  const countryCode = resolveItunesCountryCode(country);
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", String(collectionId));
  url.searchParams.set("country", countryCode);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("lang", countryCode === "JP" ? "ja_jp" : "en_us");

  const payload = options.fetchImpl
    ? await fetchItunesWithRetry(url, { ...options, throwOnUnavailable: true })
    : await runSerializedRealItunesRequest(() => fetchItunesWithRetry(
        url,
        { ...options, throwOnUnavailable: true },
      ));
  const results = payload && typeof payload === "object" && "results" in payload
    ? payload.results
    : null;
  if (!Array.isArray(results)) return null;
  const albums = results
    .map(parseItunesAlbum)
    .filter((album): album is ItunesAlbumResult => album?.collectionId === collectionId);
  const unique = [...new Map(albums.map((album) => [JSON.stringify(album), album])).values()];
  return unique.length === 1 ? unique[0]! : null;
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
