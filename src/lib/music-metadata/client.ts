import { JsonTransport } from "@/lib/music-metadata/transport";
import type {
  ArtistAliasEvidence,
  CoverArtEvidence,
  MusicArtistEvidence,
  MusicMetadataPage,
  MusicMetadataResult,
  MusicMetadataSource,
  MusicMetadataWarning,
  MusicReleaseEvidence,
  ReleaseLabelEvidence,
} from "@/lib/music-metadata/types";
import type { MusicMetadataFetch } from "@/lib/music-metadata/transport";

const MUSICBRAINZ_API_ORIGIN = "https://musicbrainz.org";
const COVER_ART_ARCHIVE_ORIGIN = "https://coverartarchive.org";
const DEFAULT_USER_AGENT = "CD-BOX/0.1.0 (https://github.com/KAtOReNA7/CD-BOX)";
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MusicMetadataClientOptions = {
  fetchImpl?: MusicMetadataFetch;
  userAgent?: string;
  timeoutMs?: number;
  retryCount?: number;
  cacheTtlMs?: number;
  cacheSize?: number;
  musicBrainzMinimumIntervalMs?: number;
  coverArtMinimumIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export type MusicMetadataPageOptions = {
  limit?: number;
  offset?: number;
};

export type ArtistReleaseBrowseOptions = {
  maxItems?: number;
  maxPages?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown, maximumLength = 1_000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function normalizeMbid(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!MBID_PATTERN.test(normalized)) throw new TypeError("Expected a valid MusicBrainz identifier.");
  return normalized;
}

function resolveUserAgent(value: string | undefined) {
  const candidate = value?.trim() || process.env.MUSICBRAINZ_USER_AGENT?.trim();
  if (!candidate || candidate.length > 200 || /[\r\n]/.test(candidate)) return DEFAULT_USER_AGENT;
  return candidate;
}

function source(title: string, url: string, provider: MusicMetadataSource["provider"]): MusicMetadataSource {
  return { provider, title, url };
}

function invalidResponseWarning(provider: MusicMetadataWarning["source"]): MusicMetadataWarning {
  return {
    source: provider,
    code: "invalid-response",
    message: `${provider} returned data in an unexpected shape; malformed rows were ignored.`,
    retryable: false,
  };
}

function uniqueStrings(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function parseDate(value: unknown) {
  const date = optionalString(value, 10);
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return date;

  const monthMatch = date.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const month = Number(monthMatch[2]);
    return month >= 1 && month <= 12 ? date : null;
  }

  const dayMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dayMatch) return null;
  const year = Number(dayMatch[1]);
  const month = Number(dayMatch[2]);
  const day = Number(dayMatch[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? date
    : null;
}

function parseAlias(value: unknown): ArtistAliasEvidence | null {
  const row = record(value);
  const name = optionalString(row?.name, 500);
  if (!row || !name) return null;
  return {
    name,
    sortName: optionalString(row["sort-name"], 500),
    locale: optionalString(row.locale, 50),
    type: optionalString(row.type, 100),
    primary: row.primary === true,
  };
}

function parseAliases(value: unknown) {
  if (!Array.isArray(value)) return [];
  const aliases = value.map(parseAlias).filter((alias): alias is ArtistAliasEvidence => alias !== null);
  return uniqueAliases(aliases);
}

function uniqueAliases(aliases: ArtistAliasEvidence[]) {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = JSON.stringify(alias);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicHttpsDomainUrl(value: unknown) {
  const raw = optionalString(value, 2_048);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) return null;

    const hostname = url.hostname.toLowerCase();
    if (
      hostname.length > 253 ||
      hostname.includes(":") ||
      /^\d+(?:\.\d+){3}$/.test(hostname) ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      hostname.endsWith(".example") ||
      hostname.endsWith(".home.arpa") ||
      hostname.endsWith(".onion")
    ) return null;

    const labels = hostname.split(".");
    if (labels.length < 2 || labels.some((label) =>
      !label ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    )) return null;
    const topLevelDomain = labels.at(-1) as string;
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(topLevelDomain)) return null;

    url.hostname = hostname;
    return url.toString();
  } catch {
    return null;
  }
}

function parseOfficialUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const urls = value.flatMap((item) => {
    const relation = record(item);
    if (
      !relation ||
      relation.type !== "official homepage" ||
      relation["target-type"] !== "url"
    ) return [];
    const officialUrl = publicHttpsDomainUrl(record(relation.url)?.resource);
    return officialUrl ? [officialUrl] : [];
  });
  return [...new Set(urls)];
}

function parseArtist(value: unknown): MusicArtistEvidence | null {
  const row = record(value);
  const sourceId = optionalString(row?.id, 50);
  const name = optionalString(row?.name, 500);
  if (!row || !sourceId || !MBID_PATTERN.test(sourceId) || !name) return null;
  const normalizedId = sourceId.toLowerCase();
  const sourceUrl = `${MUSICBRAINZ_API_ORIGIN}/artist/${normalizedId}`;
  const rawScore = integer(row.score);
  return {
    sourceId: normalizedId,
    name,
    sortName: optionalString(row["sort-name"], 500),
    aliases: parseAliases(row.aliases),
    officialUrls: parseOfficialUrls(row.relations),
    country: optionalString(row.country, 20),
    type: optionalString(row.type, 100),
    disambiguation: optionalString(row.disambiguation, 500),
    score: rawScore === null ? null : Math.max(0, Math.min(100, rawScore)),
    sourceUrl,
    sources: [source("MusicBrainz artist", sourceUrl, "musicbrainz")],
  };
}

function parseArtistCredit(value: unknown) {
  if (!Array.isArray(value)) {
    return { artistCredit: null, artistNames: [] as string[], artistAliases: [] as ArtistAliasEvidence[] };
  }

  const creditParts: string[] = [];
  const artistNames: string[] = [];
  const artistAliases: ArtistAliasEvidence[] = [];
  for (const item of value) {
    const credit = record(item);
    if (!credit) continue;
    const artist = record(credit.artist);
    const creditedName = optionalString(credit.name, 500) ?? optionalString(artist?.name, 500);
    if (!creditedName) continue;
    const joinPhrase = typeof credit.joinphrase === "string" && credit.joinphrase.length <= 100
      ? credit.joinphrase
      : "";
    creditParts.push(`${creditedName}${joinPhrase}`);
    artistNames.push(creditedName);
    artistAliases.push(...parseAliases(artist?.aliases));
  }

  return {
    artistCredit: creditParts.length > 0 ? creditParts.join("") : null,
    artistNames: uniqueStrings(artistNames),
    artistAliases: uniqueAliases(artistAliases),
  };
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  const labels: ReleaseLabelEvidence[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const row = record(item);
    if (!row) continue;
    const label = record(row.label);
    const evidence = {
      name: optionalString(label?.name, 500),
      catalogNumber: optionalString(row["catalog-number"], 200),
    };
    if (!evidence.name && !evidence.catalogNumber) continue;
    const key = JSON.stringify(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(evidence);
  }
  return labels;
}

function parseFormats(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => optionalString(record(item)?.format, 200)));
}

function embeddedCoverArt(
  entityType: "release-group" | "release",
  sourceId: string,
  value: unknown,
) {
  if (record(value)?.front !== true) {
    return {
      coverUrl: null,
      coverSourceUrl: null,
      sources: [] as MusicMetadataSource[],
    };
  }
  const sourceUrl = `${COVER_ART_ARCHIVE_ORIGIN}/${entityType}/${sourceId}`;
  return {
    coverUrl: `${sourceUrl}/front-500`,
    coverSourceUrl: sourceUrl,
    sources: [source("Cover Art Archive front cover", sourceUrl, "cover-art-archive")],
  };
}

function parseReleaseGroup(value: unknown): MusicReleaseEvidence | null {
  const row = record(value);
  const sourceId = optionalString(row?.id, 50);
  const title = optionalString(row?.title, 500);
  if (!row || !sourceId || !MBID_PATTERN.test(sourceId) || !title) return null;
  const normalizedId = sourceId.toLowerCase();
  const sourceUrl = `${MUSICBRAINZ_API_ORIGIN}/release-group/${normalizedId}`;
  const credit = parseArtistCredit(row["artist-credit"]);
  const cover = embeddedCoverArt("release-group", normalizedId, row["cover-art-archive"]);
  return {
    entityType: "release-group",
    sourceId: normalizedId,
    releaseGroupId: normalizedId,
    title,
    ...credit,
    date: parseDate(row["first-release-date"]),
    type: optionalString(row["primary-type"], 100),
    secondaryTypes: Array.isArray(row["secondary-types"])
      ? uniqueStrings(row["secondary-types"].map((item) => optionalString(item, 100)))
      : [],
    country: null,
    label: null,
    catalogNumber: null,
    format: null,
    labels: [],
    formats: [],
    barcode: null,
    status: null,
    sourceUrl,
    coverUrl: cover.coverUrl,
    coverSourceUrl: cover.coverSourceUrl,
    sources: [source("MusicBrainz release group", sourceUrl, "musicbrainz"), ...cover.sources],
  };
}

function parseRelease(value: unknown): MusicReleaseEvidence | null {
  const row = record(value);
  const sourceId = optionalString(row?.id, 50);
  const title = optionalString(row?.title, 500);
  if (!row || !sourceId || !MBID_PATTERN.test(sourceId) || !title) return null;
  const normalizedId = sourceId.toLowerCase();
  const releaseGroup = record(row["release-group"]);
  const releaseGroupId = optionalString(releaseGroup?.id, 50);
  const normalizedGroupId = releaseGroupId && MBID_PATTERN.test(releaseGroupId)
    ? releaseGroupId.toLowerCase()
    : null;
  const labels = parseLabels(row["label-info"]);
  const formats = parseFormats(row.media);
  const labelNames = uniqueStrings(labels.map((item) => item.name));
  const catalogNumbers = uniqueStrings(labels.map((item) => item.catalogNumber));
  const sourceUrl = `${MUSICBRAINZ_API_ORIGIN}/release/${normalizedId}`;
  const credit = parseArtistCredit(row["artist-credit"]);
  const cover = embeddedCoverArt("release", normalizedId, row["cover-art-archive"]);
  return {
    entityType: "release",
    sourceId: normalizedId,
    releaseGroupId: normalizedGroupId,
    title,
    ...credit,
    date: parseDate(row.date),
    type: optionalString(releaseGroup?.["primary-type"], 100),
    secondaryTypes: Array.isArray(releaseGroup?.["secondary-types"])
      ? uniqueStrings(releaseGroup["secondary-types"].map((item) => optionalString(item, 100)))
      : [],
    country: optionalString(row.country, 20),
    label: labelNames.length === 1 ? labelNames[0] : null,
    catalogNumber: catalogNumbers.length === 1 ? catalogNumbers[0] : null,
    format: formats.length === 1 ? formats[0] : null,
    labels,
    formats,
    barcode: optionalString(row.barcode, 100),
    status: optionalString(row.status, 100),
    sourceUrl,
    coverUrl: cover.coverUrl,
    coverSourceUrl: cover.coverSourceUrl,
    sources: [source("MusicBrainz release", sourceUrl, "musicbrainz"), ...cover.sources],
  };
}

function safeCoverUrl(value: unknown) {
  const raw = optionalString(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (hostname !== "coverartarchive.org" && !hostname.endsWith(".coverartarchive.org")) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

function parseCoverArt(
  value: unknown,
  entityType: CoverArtEvidence["entityType"],
  sourceId: string,
  sourceUrl: string,
) {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.images)) return { cover: null, invalid: true };
  const covers = payload.images.flatMap((item, index) => {
    const row = record(item);
    const imageUrl = safeCoverUrl(row?.image);
    if (!row || row.front !== true || !imageUrl) return [];
    const types = Array.isArray(row.types)
      ? uniqueStrings(row.types.map((type) => optionalString(type, 100)))
      : [];
    return [{
      index,
      evidence: {
        entityType,
        sourceId,
        imageUrl,
        sourceUrl,
        approved: typeof row.approved === "boolean" ? row.approved : null,
        types,
      } satisfies CoverArtEvidence,
    }];
  });

  covers.sort((left, right) =>
    Number(right.evidence.approved === true) - Number(left.evidence.approved === true) ||
    left.index - right.index,
  );
  return { cover: covers[0]?.evidence ?? null, invalid: false };
}

function emptyPage<T>(options: MusicMetadataPageOptions): MusicMetadataPage<T> {
  return {
    count: null,
    offset: clampInteger(options.offset, 0, 0, 100_000),
    limit: clampInteger(options.limit, 50, 1, 100),
    items: [],
  };
}

function pageFromPayload<T>(
  payload: unknown,
  arrayKey: string,
  options: MusicMetadataPageOptions,
  parse: (value: unknown) => T | null,
) {
  const row = record(payload);
  const rawItems = row?.[arrayKey];
  if (!row || !Array.isArray(rawItems)) {
    return { page: emptyPage<T>(options), invalid: true, received: 0 };
  }

  const items = rawItems.map(parse).filter((item): item is T => item !== null);
  return {
    page: {
      count: integer(row.count),
      offset: integer(row.offset) ?? clampInteger(options.offset, 0, 0, 100_000),
      limit: clampInteger(options.limit, 50, 1, 100),
      items,
    },
    invalid: items.length !== rawItems.length,
    received: rawItems.length,
  };
}

function appendInvalidWarning(warnings: MusicMetadataWarning[], invalid: boolean) {
  return invalid ? [...warnings, invalidResponseWarning("musicbrainz")] : warnings;
}

export class MusicMetadataClient {
  private readonly musicBrainz: JsonTransport;
  private readonly coverArtArchive: JsonTransport;

  constructor(options: MusicMetadataClientOptions = {}) {
    const shared = {
      userAgent: resolveUserAgent(options.userAgent),
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      retryCount: options.retryCount,
      cacheTtlMs: options.cacheTtlMs,
      cacheSize: options.cacheSize,
      sleep: options.sleep,
      now: options.now,
    };
    this.musicBrainz = new JsonTransport({
      ...shared,
      source: "musicbrainz",
      allowedOrigin: MUSICBRAINZ_API_ORIGIN,
      minimumIntervalMs: options.musicBrainzMinimumIntervalMs ?? 1_100,
    });
    this.coverArtArchive = new JsonTransport({
      ...shared,
      source: "cover-art-archive",
      allowedOrigin: COVER_ART_ARCHIVE_ORIGIN,
      minimumIntervalMs: options.coverArtMinimumIntervalMs ?? 350,
    });
  }

  async searchArtists(
    query: string,
    options: MusicMetadataPageOptions = {},
  ): Promise<MusicMetadataResult<MusicMetadataPage<MusicArtistEvidence>>> {
    const normalizedQuery = query.normalize("NFKC").trim();
    if (!normalizedQuery || normalizedQuery.length > 200) {
      throw new TypeError("Artist search query must contain between 1 and 200 characters.");
    }
    const escapedQuery = normalizedQuery.replace(/[\\"]/g, "\\$&");
    const url = new URL("/ws/2/artist/", MUSICBRAINZ_API_ORIGIN);
    url.searchParams.set("query", `artist:\"${escapedQuery}\"`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(clampInteger(options.limit, 20, 1, 100)));
    url.searchParams.set("offset", String(clampInteger(options.offset, 0, 0, 100_000)));

    const response = await this.musicBrainz.getJson(url);
    if (!response.ok) {
      return { value: emptyPage({ ...options, limit: options.limit ?? 20 }), warnings: [response.warning] };
    }
    const parsed = pageFromPayload(response.value, "artists", { ...options, limit: options.limit ?? 20 }, parseArtist);
    return { value: parsed.page, warnings: appendInvalidWarning([], parsed.invalid) };
  }

  async getArtist(
    artistId: string,
  ): Promise<MusicMetadataResult<MusicArtistEvidence | null>> {
    const normalizedArtistId = normalizeMbid(artistId);
    const url = new URL(`/ws/2/artist/${normalizedArtistId}`, MUSICBRAINZ_API_ORIGIN);
    url.searchParams.set("inc", "aliases+url-rels");
    url.searchParams.set("fmt", "json");

    const response = await this.musicBrainz.getJson(url);
    if (!response.ok) return { value: null, warnings: [response.warning] };

    const artist = parseArtist(response.value);
    if (!artist || artist.sourceId !== normalizedArtistId) {
      return { value: null, warnings: [invalidResponseWarning("musicbrainz")] };
    }
    return { value: artist, warnings: [] };
  }

  async listReleaseGroups(
    artistId: string,
    options: MusicMetadataPageOptions = {},
  ): Promise<MusicMetadataResult<MusicMetadataPage<MusicReleaseEvidence>>> {
    const normalizedArtistId = normalizeMbid(artistId);
    const url = new URL("/ws/2/release-group", MUSICBRAINZ_API_ORIGIN);
    url.searchParams.set("artist", normalizedArtistId);
    url.searchParams.set("inc", "artist-credits");
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(clampInteger(options.limit, 50, 1, 100)));
    url.searchParams.set("offset", String(clampInteger(options.offset, 0, 0, 100_000)));

    const response = await this.musicBrainz.getJson(url);
    if (!response.ok) {
      return { value: emptyPage(options), warnings: [response.warning] };
    }
    const parsed = pageFromPayload(response.value, "release-groups", options, parseReleaseGroup);
    return { value: parsed.page, warnings: appendInvalidWarning([], parsed.invalid) };
  }

  async listReleases(
    releaseGroupId: string,
    options: MusicMetadataPageOptions = {},
  ): Promise<MusicMetadataResult<MusicMetadataPage<MusicReleaseEvidence>>> {
    const normalizedGroupId = normalizeMbid(releaseGroupId);
    const url = new URL("/ws/2/release", MUSICBRAINZ_API_ORIGIN);
    url.searchParams.set("release-group", normalizedGroupId);
    url.searchParams.set("inc", "artist-credits+labels+media+release-groups");
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(clampInteger(options.limit, 50, 1, 100)));
    url.searchParams.set("offset", String(clampInteger(options.offset, 0, 0, 100_000)));

    const response = await this.musicBrainz.getJson(url);
    if (!response.ok) {
      return { value: emptyPage(options), warnings: [response.warning] };
    }
    const parsed = pageFromPayload(response.value, "releases", options, parseRelease);
    return { value: parsed.page, warnings: appendInvalidWarning([], parsed.invalid) };
  }

  /**
   * Browses release groups for one artist. MusicBrainz allows at most 100 rows
   * per page; the default five-page ceiling covers large personal
   * discographies while retaining a finite safety bound.
   */
  async listArtistReleaseGroups(
    artistId: string,
    options: ArtistReleaseBrowseOptions = {},
  ): Promise<MusicMetadataResult<MusicMetadataPage<MusicReleaseEvidence>>> {
    const normalizedArtistId = normalizeMbid(artistId);
    const maxItems = clampInteger(options.maxItems, 1_000, 1, 1_000);
    const maxPages = clampInteger(options.maxPages, 10, 1, 10);
    const items: MusicReleaseEvidence[] = [];
    const seenIds = new Set<string>();
    const warnings: MusicMetadataWarning[] = [];
    let count: number | null = null;
    let offset = 0;

    for (let pageIndex = 0; pageIndex < maxPages && items.length < maxItems; pageIndex += 1) {
      const requestedLimit = Math.min(100, maxItems - items.length);
      const url = new URL("/ws/2/release-group", MUSICBRAINZ_API_ORIGIN);
      url.searchParams.set("artist", normalizedArtistId);
      url.searchParams.set("inc", "artist-credits");
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", String(requestedLimit));
      url.searchParams.set("offset", String(offset));

      const response = await this.musicBrainz.getJson(url);
      if (!response.ok) {
        warnings.push(response.warning);
        break;
      }

      const parsed = pageFromPayload(
        response.value,
        "release-groups",
        { limit: requestedLimit, offset },
        parseReleaseGroup,
      );
      if (parsed.invalid) warnings.push(invalidResponseWarning("musicbrainz"));
      count ??= parsed.page.count;
      for (const releaseGroup of parsed.page.items) {
        if (seenIds.has(releaseGroup.sourceId)) continue;
        seenIds.add(releaseGroup.sourceId);
        items.push(releaseGroup);
        if (items.length >= maxItems) break;
      }

      offset += requestedLimit;
      if (
        parsed.received < requestedLimit ||
        (parsed.page.count !== null && offset >= parsed.page.count)
      ) break;
    }

    return {
      value: {
        count,
        offset: 0,
        limit: maxItems,
        items,
      },
      warnings: warnings.filter((item, index) =>
        warnings.findIndex((candidate) =>
          candidate.source === item.source &&
          candidate.code === item.code &&
          candidate.message === item.message,
        ) === index,
      ),
    };
  }

  /**
   * Browses detailed release rows for one artist without issuing a request per
   * release. MusicBrainz allows at most 100 rows per page; the default
   * five-page ceiling covers large personal discographies while retaining a
   * finite safety bound.
   */
  async listArtistReleases(
    artistId: string,
    options: ArtistReleaseBrowseOptions = {},
  ): Promise<MusicMetadataResult<MusicMetadataPage<MusicReleaseEvidence>>> {
    const normalizedArtistId = normalizeMbid(artistId);
    const maxItems = clampInteger(options.maxItems, 1_000, 1, 1_000);
    const maxPages = clampInteger(options.maxPages, 10, 1, 10);
    const items: MusicReleaseEvidence[] = [];
    const seenIds = new Set<string>();
    const warnings: MusicMetadataWarning[] = [];
    let count: number | null = null;
    let offset = 0;

    for (let pageIndex = 0; pageIndex < maxPages && items.length < maxItems; pageIndex += 1) {
      const requestedLimit = Math.min(100, maxItems - items.length);
      const url = new URL("/ws/2/release", MUSICBRAINZ_API_ORIGIN);
      url.searchParams.set("artist", normalizedArtistId);
      url.searchParams.set("inc", "artist-credits+labels+media+release-groups");
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", String(requestedLimit));
      url.searchParams.set("offset", String(offset));

      const response = await this.musicBrainz.getJson(url);
      if (!response.ok) {
        warnings.push(response.warning);
        break;
      }

      const parsed = pageFromPayload(
        response.value,
        "releases",
        { limit: requestedLimit, offset },
        parseRelease,
      );
      if (parsed.invalid) warnings.push(invalidResponseWarning("musicbrainz"));
      count ??= parsed.page.count;
      for (const release of parsed.page.items) {
        if (seenIds.has(release.sourceId)) continue;
        seenIds.add(release.sourceId);
        items.push(release);
        if (items.length >= maxItems) break;
      }

      offset += requestedLimit;
      if (
        parsed.received < requestedLimit ||
        (parsed.page.count !== null && offset >= parsed.page.count)
      ) break;
    }

    return {
      value: {
        count,
        offset: 0,
        limit: maxItems,
        items,
      },
      warnings: warnings.filter((item, index) =>
        warnings.findIndex((candidate) =>
          candidate.source === item.source &&
          candidate.code === item.code &&
          candidate.message === item.message,
        ) === index,
      ),
    };
  }

  async getRelease(releaseId: string): Promise<MusicMetadataResult<MusicReleaseEvidence | null>> {
    const normalizedReleaseId = normalizeMbid(releaseId);
    const url = new URL(`/ws/2/release/${normalizedReleaseId}`, MUSICBRAINZ_API_ORIGIN);
    url.searchParams.set("inc", "artist-credits+labels+media+release-groups");
    url.searchParams.set("fmt", "json");

    const response = await this.musicBrainz.getJson(url);
    if (!response.ok) {
      return response.notFound
        ? { value: null, warnings: [] }
        : { value: null, warnings: [response.warning] };
    }
    const release = parseRelease(response.value);
    return {
      value: release,
      warnings: release ? [] : [invalidResponseWarning("musicbrainz")],
    };
  }

  async getCoverArt(
    entityType: CoverArtEvidence["entityType"],
    id: string,
  ): Promise<MusicMetadataResult<CoverArtEvidence | null>> {
    const sourceId = normalizeMbid(id);
    const pathEntity = entityType === "release" ? "release" : "release-group";
    const sourceUrl = `${COVER_ART_ARCHIVE_ORIGIN}/${pathEntity}/${sourceId}`;
    const response = await this.coverArtArchive.getJson(new URL(sourceUrl));
    if (!response.ok) {
      return response.notFound
        ? { value: null, warnings: [] }
        : { value: null, warnings: [response.warning] };
    }
    const parsed = parseCoverArt(response.value, entityType, sourceId, sourceUrl);
    return {
      value: parsed.cover,
      warnings: parsed.invalid ? [invalidResponseWarning("cover-art-archive")] : [],
    };
  }

  async enrichWithCoverArt(
    evidence: MusicReleaseEvidence,
  ): Promise<MusicMetadataResult<MusicReleaseEvidence>> {
    if (evidence.coverUrl) return { value: evidence, warnings: [] };
    const cover = await this.getCoverArt(evidence.entityType, evidence.sourceId);
    if (!cover.value) return { value: evidence, warnings: cover.warnings };
    const coverSource = source("Cover Art Archive front cover", cover.value.sourceUrl, "cover-art-archive");
    return {
      value: {
        ...evidence,
        coverUrl: cover.value.imageUrl,
        coverSourceUrl: cover.value.sourceUrl,
        sources: evidence.sources.some((item) => item.url === coverSource.url)
          ? evidence.sources
          : [...evidence.sources, coverSource],
      },
      warnings: cover.warnings,
    };
  }
}

export const musicMetadataClient = new MusicMetadataClient();

export { DEFAULT_USER_AGENT as DEFAULT_MUSIC_METADATA_USER_AGENT };
