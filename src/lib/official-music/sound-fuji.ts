import "server-only";

import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
} from "@/lib/official-music/url-policy";
import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";

export const SOUND_FUJI_ORIGIN = "https://soundfuji.kingrecords.co.jp";

const SOUND_FUJI_HOSTNAME = "soundfuji.kingrecords.co.jp";
const INDEX_PAGE_SIZE = 100;
const HARD_MAX_INDEX_PAGES = 50;
const HARD_MAX_INDEX_RECORDS = 5_000;
const HARD_MAX_CANDIDATES = 200;
const HARD_MAX_ARTIST_NAMES = 20;
const HARD_MAX_LABEL_NAMES = 20;
const HARD_MAX_DETAIL_PAGES = 100;
const HARD_MAX_INDEX_PAGE_BYTES = 1024 * 1024;
const HARD_MAX_DETAIL_PAGE_BYTES = 1024 * 1024;
const HARD_MAX_DETAIL_CACHE_ENTRIES = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_MINIMUM_INTERVAL_MS = 100;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1_000;
const HARD_MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const KING_LABEL_KEYS = new Set([
  "king",
  "kingrecord",
  "kingrecords",
  "kingrecordcoltd",
  "kingrecordscoltd",
  "キングレコード",
].map(normalizedLabel));

export type SoundFujiExpectedWorkKind = "ALBUM" | "SINGLE";

export type SoundFujiWorkCandidate = {
  id: string;
  title: string;
  expectedKind?: SoundFujiExpectedWorkKind | null;
};

export type SoundFujiWorkCoverEvidence = {
  provider: "king-records-sound-fuji";
  scope: "WORK";
  matchLevel: "WORK_EXACT";
  url: string;
  sourceUrl: string;
};

export type SoundFujiWorkAuthorityEvidence = {
  provider: "king-records-sound-fuji";
  sourceType: "official-label-archive";
  role: "AUTHORITATIVE";
  strength: "STRONG";
  scope: "WORK";
  matchedFields: ["artist", "title"];
  sourceUrl: string;
  sourceUrls: string[];
  observedTitle: string;
  observedArtist: string;
  observedKind: SoundFujiExpectedWorkKind | null;
  cover: SoundFujiWorkCoverEvidence | null;
};

export type SoundFujiCandidateOutcome =
  | "PASS"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "INVALID_CANDIDATE"
  | "SOURCE_INCOMPLETE";

export type SoundFujiCandidateResult = {
  candidateId: string;
  outcome: SoundFujiCandidateOutcome;
  reasonCode:
    | "OFFICIAL_LABEL_WORK_MATCH"
    | "OFFICIAL_LABEL_WORK_NOT_FOUND"
    | "OFFICIAL_LABEL_WORK_AMBIGUOUS"
    | "INVALID_CANDIDATE"
    | "SOUND_FUJI_SOURCE_INCOMPLETE";
  evidence: SoundFujiWorkAuthorityEvidence | null;
};

export type SoundFujiArchiveStatus =
  | "COMPLETE"
  | "NOT_APPLICABLE"
  | "INVALID_INPUT"
  | "SOURCE_INCOMPLETE";

export type SoundFujiArchiveWarningCode =
  | "invalid-input"
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-index"
  | "invalid-detail"
  | "pagination-incomplete"
  | "detail-limit";

export type SoundFujiArchiveWarning = {
  code: SoundFujiArchiveWarningCode;
  message: string;
  retryable: boolean;
};

export type SoundFujiArchiveResearchInput = {
  artistNames: string[];
  labelOrPublisherNames: string[];
  candidates: SoundFujiWorkCandidate[];
};

export type SoundFujiArchiveResearchResult = {
  status: SoundFujiArchiveStatus;
  applicable: boolean;
  complete: boolean;
  candidates: SoundFujiCandidateResult[];
  warnings: SoundFujiArchiveWarning[];
  stats: {
    indexPagesFetched: number;
    indexRecords: number;
    detailPagesFetched: number;
    cacheHits: number;
    candidatesInspected: number;
    candidatesMatched: number;
    ambiguousCandidates: number;
  };
};

export type SoundFujiArchiveClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  minimumIntervalMs?: number;
  cacheTtlMs?: number;
  retryCount?: number;
};

type SoundFujiIndexRecord = {
  id: number;
  title: string;
  titleKey: string;
  lookupKeys: string[];
  url: string;
};

type SoundFujiIndexSnapshot = {
  records: SoundFujiIndexRecord[];
  pagesFetched: number;
};

type SoundFujiDetailRecord = {
  id: number;
  url: string;
  title: string;
  titleKey: string;
  artist: string;
  artistKey: string;
  kind: SoundFujiExpectedWorkKind | null;
  coverUrl: string | null;
};

type ResearchStats = SoundFujiArchiveResearchResult["stats"];

class SoundFujiFetchFailure extends Error {
  constructor(
    readonly code: SoundFujiArchiveWarningCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "SoundFujiFetchFailure";
  }
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    eacute: "é",
    Eacute: "É",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return named[body] ?? named[body.toLowerCase()] ?? entity;
  });
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Exact normalized identity key. Punctuation, spacing, width, case, and
 * diacritics are ignored, but no prefix, substring, or fuzzy match is used.
 */
export function normalizeSoundFujiIdentity(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

/**
 * SOUND FUJI occasionally appends a katakana reading to an otherwise numeric
 * title (for example `50/50(フィフティー・フィフティー)`).  Treat that fixed
 * presentation as an alias only when the base is numeric/punctuation-only and
 * the suffix is katakana-only.  This deliberately does not strip arbitrary
 * parenthetical qualifiers such as `Live`, `Remix`, or Japanese work subtitles.
 */
const CONTROLLED_NUMERIC_KATAKANA_READINGS = new Map<string, ReadonlySet<string>>([
  ["5050", new Set(["フィフティーフィフティー"])],
]);

function soundFujiIndexLookupKeys(value: string) {
  const decoded = decodeHtmlEntities(value).trim();
  const exact = normalizeSoundFujiIdentity(decoded);
  const keys = new Set(exact ? [exact] : []);
  const reading = decoded.match(/^([\p{N}\p{P}\p{S}\p{Z}]+?)[(（]([^()（）]+)[)）]$/u);
  if (!reading) return [...keys];
  const baseKey = normalizeSoundFujiIdentity(reading[1]!);
  const readingKey = normalizeSoundFujiIdentity(reading[2]!);
  if (readingKey && CONTROLLED_NUMERIC_KATAKANA_READINGS.get(baseKey)?.has(readingKey)) {
    keys.add(baseKey);
  }
  return [...keys];
}

function normalizedLabel(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

export function isKingRecordsLabelOrPublisher(value: string) {
  return KING_LABEL_KEYS.has(normalizedLabel(value));
}

function validString(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validCandidate(candidate: SoundFujiWorkCandidate) {
  return validString(candidate.id, 200) &&
    validString(candidate.title, 500) &&
    normalizeSoundFujiIdentity(candidate.title).length > 0 &&
    (candidate.expectedKind === undefined || candidate.expectedKind === null ||
      candidate.expectedKind === "ALBUM" || candidate.expectedKind === "SINGLE");
}

function freshStats(): ResearchStats {
  return {
    indexPagesFetched: 0,
    indexRecords: 0,
    detailPagesFetched: 0,
    cacheHits: 0,
    candidatesInspected: 0,
    candidatesMatched: 0,
    ambiguousCandidates: 0,
  };
}

function indexPageUrl(page: number) {
  const url = new URL("/wp-json/wp/v2/release", SOUND_FUJI_ORIGIN);
  url.searchParams.set("per_page", String(INDEX_PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_fields", "id,link,title");
  return url.toString();
}

function safeDetailUrl(value: string, expectedId?: number) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/release\/(\d+)\/?$/);
    if (
      url.origin !== SOUND_FUJI_ORIGIN ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !match ||
      (expectedId !== undefined && Number(match[1]) !== expectedId)
    ) return null;
    url.pathname = `/release/${match[1]}/`;
    return url.toString();
  } catch {
    return null;
  }
}

function safeCoverUrl(value: string) {
  try {
    const url = new URL(decodeHtmlEntities(value));
    if (
      url.origin !== SOUND_FUJI_ORIGIN ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function positiveHeaderInteger(response: Response, name: string) {
  const raw = response.headers.get(name)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function readLimitedText(response: Response, maximumBytes: number) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SoundFujiFetchFailure(
      "response-too-large",
      false,
      "The SOUND FUJI response exceeded the fixed byte limit.",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new SoundFujiFetchFailure(
      "response-too-large",
      false,
      "The SOUND FUJI response exceeded the fixed byte limit.",
    );
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parseIndexRecords(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SoundFujiFetchFailure("invalid-index", false, "SOUND FUJI returned invalid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length > INDEX_PAGE_SIZE) {
    throw new SoundFujiFetchFailure(
      "invalid-index",
      false,
      "SOUND FUJI returned an invalid index page shape.",
    );
  }
  return parsed.map((value): SoundFujiIndexRecord => {
    if (!value || typeof value !== "object") {
      throw new SoundFujiFetchFailure("invalid-index", false, "SOUND FUJI returned an invalid index item.");
    }
    const item = value as Record<string, unknown>;
    const titleValue = item.title;
    const rendered = titleValue && typeof titleValue === "object"
      ? (titleValue as Record<string, unknown>).rendered
      : null;
    if (
      !Number.isSafeInteger(item.id) ||
      Number(item.id) <= 0 ||
      !validString(rendered, 500) ||
      !validString(item.link, 2_000)
    ) {
      throw new SoundFujiFetchFailure("invalid-index", false, "SOUND FUJI returned an invalid index item.");
    }
    const id = Number(item.id);
    const url = safeDetailUrl(item.link as string, id);
    const title = decodeHtmlEntities((rendered as string).trim());
    const titleKey = normalizeSoundFujiIdentity(title);
    if (!url || !titleKey) {
      throw new SoundFujiFetchFailure(
        "invalid-index",
        false,
        "SOUND FUJI returned an unsafe or incomplete index item.",
      );
    }
    return { id, title, titleKey, lookupKeys: soundFujiIndexLookupKeys(title), url };
  });
}

function tagAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function detailWorkKind(html: string) {
  const buttons = html.match(/<div\b[^>]*class=["'][^"']*detail__desc__buttons[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  let hasAppleSingle = false;
  let kingCatalogPrefix: string | null = null;
  for (const match of buttons.matchAll(/<a\b([^>]*)>/gi)) {
    const href = tagAttribute(match[0], "href");
    if (!href) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      if (url.hostname === "music.apple.com" && /-(?:single|ep)\/\d+\/?$/i.test(url.pathname)) {
        hasAppleSingle = true;
      }
      if (url.hostname === "kingeshop.jp") {
        const catalog = url.pathname.match(/^\/shop\/g\/g([A-Za-z]+)[-_]?\d+[A-Za-z0-9_-]*\/?$/)?.[1];
        if (catalog) kingCatalogPrefix = catalog.toUpperCase();
      }
    } catch {
      // External listening and shop links are hints only and are never fetched.
    }
  }
  if (hasAppleSingle) return "SINGLE" as const;
  if (kingCatalogPrefix === "KICS") return "ALBUM" as const;
  if (kingCatalogPrefix === "KIDS" || kingCatalogPrefix === "KICM") return "SINGLE" as const;
  return null;
}

function parseDetailRecord(html: string, record: SoundFujiIndexRecord) {
  const matches = [...html.matchAll(
    /<div\b[^>]*class=["'][^"']*detail__desc__title[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/div>/gi,
  )];
  if (matches.length !== 1) {
    throw new SoundFujiFetchFailure(
      "invalid-detail",
      false,
      "SOUND FUJI returned an invalid release detail page.",
    );
  }
  const title = stripTags(matches[0]![1] ?? "");
  const artist = stripTags(matches[0]![2] ?? "");
  const titleKey = normalizeSoundFujiIdentity(title);
  const artistKey = normalizeSoundFujiIdentity(artist);
  if (!titleKey || !artistKey || titleKey !== record.titleKey) {
    throw new SoundFujiFetchFailure(
      "invalid-detail",
      false,
      "The SOUND FUJI detail page did not agree with its index record.",
    );
  }
  let coverUrl: string | null = null;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const property = tagAttribute(match[0], "property").toLocaleLowerCase("en");
    if (property !== "og:image") continue;
    coverUrl = safeCoverUrl(tagAttribute(match[0], "content"));
    break;
  }
  return {
    id: record.id,
    url: record.url,
    title,
    titleKey,
    artist,
    artistKey,
    kind: detailWorkKind(html),
    coverUrl,
  } satisfies SoundFujiDetailRecord;
}

function sourceIncompleteCandidates(candidates: readonly SoundFujiWorkCandidate[]) {
  return candidates.map((candidate): SoundFujiCandidateResult => ({
    candidateId: candidate.id,
    outcome: "SOURCE_INCOMPLETE",
    reasonCode: "SOUND_FUJI_SOURCE_INCOMPLETE",
    evidence: null,
  }));
}

export class SoundFujiArchiveClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly minimumIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly retryCount: number;
  private nextAllowedAt = 0;
  private indexCache: { expiresAt: number; value: SoundFujiIndexSnapshot } | null = null;
  private readonly detailCache = new Map<string, { expiresAt: number; value: SoundFujiDetailRecord }>();

  constructor(options: SoundFujiArchiveClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.minimumIntervalMs = clampInteger(
      options.minimumIntervalMs,
      DEFAULT_MINIMUM_INTERVAL_MS,
      0,
      2_000,
    );
    this.cacheTtlMs = clampInteger(
      options.cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      0,
      HARD_MAX_CACHE_TTL_MS,
    );
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
  }

  private async throttle() {
    const delay = Math.max(0, this.nextAllowedAt - this.now());
    if (delay > 0) await this.sleep(delay);
    this.nextAllowedAt = this.now() + this.minimumIntervalMs;
  }

  private async requestTextOnce(url: string, expectedContentType: string, maximumBytes: number) {
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: expectedContentType === "application/json"
            ? "application/json"
            : "text/html, application/xhtml+xml;q=0.9",
          "User-Agent": "CD-BOX/1.0 SOUND-FUJI-work-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new SoundFujiFetchFailure(
          "http-status",
          response.status === 408 || response.status === 429 || response.status >= 500,
          `SOUND FUJI returned HTTP ${response.status}.`,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith(expectedContentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SoundFujiFetchFailure(
          "unsupported-content-type",
          false,
          "SOUND FUJI returned an unsupported content type.",
        );
      }
      return { response, text: await readLimitedText(response, maximumBytes) };
    } catch (error) {
      if (error instanceof SoundFujiFetchFailure) throw error;
      if (controller.signal.aborted) {
        throw new SoundFujiFetchFailure("network-timeout", true, "The SOUND FUJI request timed out.");
      }
      throw new SoundFujiFetchFailure("network-unavailable", true, "The SOUND FUJI request failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestText(url: string, expectedContentType: string, maximumBytes: number) {
    let lastFailure: SoundFujiFetchFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestTextOnce(url, expectedContentType, maximumBytes);
      } catch (error) {
        const failure = error instanceof SoundFujiFetchFailure
          ? error
          : new SoundFujiFetchFailure(
              "network-unavailable",
              true,
              "The SOUND FUJI request failed.",
            );
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        await this.sleep(Math.min(2_000, 250 * (2 ** attempt)));
      }
    }
    throw lastFailure ?? new SoundFujiFetchFailure(
      "network-unavailable",
      true,
      "The SOUND FUJI request failed.",
    );
  }

  private async loadIndex(stats: ResearchStats) {
    if (this.indexCache && this.indexCache.expiresAt > this.now()) {
      stats.cacheHits += 1;
      return this.indexCache.value;
    }
    const first = await this.requestText(indexPageUrl(1), "application/json", HARD_MAX_INDEX_PAGE_BYTES);
    const total = positiveHeaderInteger(first.response, "x-wp-total");
    const totalPages = positiveHeaderInteger(first.response, "x-wp-totalpages");
    if (
      total === null ||
      totalPages === null ||
      total > HARD_MAX_INDEX_RECORDS ||
      totalPages > HARD_MAX_INDEX_PAGES ||
      Math.ceil(total / INDEX_PAGE_SIZE) !== totalPages
    ) {
      throw new SoundFujiFetchFailure(
        "pagination-incomplete",
        false,
        "SOUND FUJI pagination metadata exceeded or violated the fixed completeness bounds.",
      );
    }
    const records = parseIndexRecords(first.text);
    stats.indexPagesFetched += 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const next = await this.requestText(indexPageUrl(page), "application/json", HARD_MAX_INDEX_PAGE_BYTES);
      if (
        positiveHeaderInteger(next.response, "x-wp-total") !== total ||
        positiveHeaderInteger(next.response, "x-wp-totalpages") !== totalPages
      ) {
        throw new SoundFujiFetchFailure(
          "pagination-incomplete",
          true,
          "SOUND FUJI pagination changed during the bounded crawl.",
        );
      }
      records.push(...parseIndexRecords(next.text));
      stats.indexPagesFetched += 1;
    }
    const ids = new Set(records.map((record) => record.id));
    if (records.length !== total || ids.size !== records.length) {
      throw new SoundFujiFetchFailure(
        "pagination-incomplete",
        true,
        "SOUND FUJI did not return a complete, unique index snapshot.",
      );
    }
    const value = { records, pagesFetched: totalPages } satisfies SoundFujiIndexSnapshot;
    stats.indexRecords = records.length;
    if (this.cacheTtlMs > 0) {
      this.indexCache = { expiresAt: this.now() + this.cacheTtlMs, value };
    }
    return value;
  }

  private cachedDetail(url: string, stats: ResearchStats) {
    const cached = this.detailCache.get(url);
    if (!cached) return null;
    if (cached.expiresAt <= this.now()) {
      this.detailCache.delete(url);
      return null;
    }
    stats.cacheHits += 1;
    return cached.value;
  }

  private cacheDetail(value: SoundFujiDetailRecord) {
    if (this.cacheTtlMs <= 0) return;
    this.detailCache.delete(value.url);
    while (this.detailCache.size >= HARD_MAX_DETAIL_CACHE_ENTRIES) {
      const oldest = this.detailCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.detailCache.delete(oldest);
    }
    this.detailCache.set(value.url, {
      expiresAt: this.now() + this.cacheTtlMs,
      value,
    });
  }

  private async loadDetail(record: SoundFujiIndexRecord, stats: ResearchStats) {
    const cached = this.cachedDetail(record.url, stats);
    if (cached) return cached;
    const response = await this.requestText(record.url, "text/html", HARD_MAX_DETAIL_PAGE_BYTES);
    const detail = parseDetailRecord(response.text, record);
    stats.detailPagesFetched += 1;
    this.cacheDetail(detail);
    return detail;
  }

  async research(input: SoundFujiArchiveResearchInput): Promise<SoundFujiArchiveResearchResult> {
    const stats = freshStats();
    const applicable = input.labelOrPublisherNames.some(isKingRecordsLabelOrPublisher);
    if (!applicable) {
      return {
        status: "NOT_APPLICABLE",
        applicable: false,
        complete: true,
        candidates: input.candidates.map((candidate) => ({
          candidateId: candidate.id,
          outcome: "NOT_FOUND",
          reasonCode: "OFFICIAL_LABEL_WORK_NOT_FOUND",
          evidence: null,
        })),
        warnings: [],
        stats,
      };
    }
    const artistNamesValid = input.artistNames.length > 0 &&
      input.artistNames.length <= HARD_MAX_ARTIST_NAMES &&
      input.artistNames.every((value) => validString(value, 500));
    const labelsValid = input.labelOrPublisherNames.length > 0 &&
      input.labelOrPublisherNames.length <= HARD_MAX_LABEL_NAMES &&
      input.labelOrPublisherNames.every((value) => validString(value, 500));
    const candidatesValid = input.candidates.length > 0 &&
      input.candidates.length <= HARD_MAX_CANDIDATES;
    const ids = new Set(input.candidates.map((candidate) => candidate.id));
    if (!artistNamesValid || !labelsValid || !candidatesValid || ids.size !== input.candidates.length) {
      return {
        status: "INVALID_INPUT",
        applicable: true,
        complete: false,
        candidates: input.candidates.map((candidate) => ({
          candidateId: candidate.id,
          outcome: "INVALID_CANDIDATE",
          reasonCode: "INVALID_CANDIDATE",
          evidence: null,
        })),
        warnings: [{
          code: "invalid-input",
          message: "The SOUND FUJI request exceeded a fixed input bound or contained duplicate identifiers.",
          retryable: false,
        }],
        stats,
      };
    }
    const invalidIds = new Set(input.candidates.filter((candidate) => !validCandidate(candidate)).map((candidate) => candidate.id));
    const validCandidates = input.candidates.filter((candidate) => !invalidIds.has(candidate.id));
    const artistKeys = new Set(input.artistNames.map(normalizeSoundFujiIdentity).filter(Boolean));
    if (artistKeys.size === 0) {
      return {
        status: "INVALID_INPUT",
        applicable: true,
        complete: false,
        candidates: input.candidates.map((candidate) => ({
          candidateId: candidate.id,
          outcome: "INVALID_CANDIDATE",
          reasonCode: "INVALID_CANDIDATE",
          evidence: null,
        })),
        warnings: [{
          code: "invalid-input",
          message: "The SOUND FUJI request did not contain a usable complete artist name.",
          retryable: false,
        }],
        stats,
      };
    }

    let host = await resolvePublicOfficialHost(SOUND_FUJI_HOSTNAME, this.resolveHost);
    for (
      let attempt = 0;
      !host.ok && host.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      await this.sleep(Math.min(2_000, 250 * (2 ** attempt)));
      host = await resolvePublicOfficialHost(SOUND_FUJI_HOSTNAME, this.resolveHost);
    }
    if (!host.ok) {
      const code = host.reason satisfies "dns-resolution-failed" | "non-public-address";
      return {
        status: "SOURCE_INCOMPLETE",
        applicable: true,
        complete: false,
        candidates: sourceIncompleteCandidates(input.candidates),
        warnings: [{
          code,
          message: "The fixed SOUND FUJI host did not resolve exclusively to public network addresses.",
          retryable: code === "dns-resolution-failed",
        }],
        stats,
      };
    }

    try {
      const index = await this.loadIndex(stats);
      if (stats.indexRecords === 0) stats.indexRecords = index.records.length;
      const byTitle = new Map<string, SoundFujiIndexRecord[]>();
      for (const record of index.records) {
        for (const key of record.lookupKeys) {
          const values = byTitle.get(key) ?? [];
          values.push(record);
          byTitle.set(key, values);
        }
      }
      const requiredRecords = new Map<number, SoundFujiIndexRecord>();
      for (const candidate of validCandidates) {
        const key = normalizeSoundFujiIdentity(candidate.title);
        for (const record of byTitle.get(key) ?? []) requiredRecords.set(record.id, record);
      }
      if (requiredRecords.size > HARD_MAX_DETAIL_PAGES) {
        throw new SoundFujiFetchFailure(
          "detail-limit",
          false,
          "The exact-title detail set exceeded the fixed SOUND FUJI request bound.",
        );
      }
      const details = new Map<number, SoundFujiDetailRecord>();
      for (const record of requiredRecords.values()) {
        details.set(record.id, await this.loadDetail(record, stats));
      }

      stats.candidatesInspected = validCandidates.length;
      const results = input.candidates.map((candidate): SoundFujiCandidateResult => {
        if (invalidIds.has(candidate.id)) {
          return {
            candidateId: candidate.id,
            outcome: "INVALID_CANDIDATE",
            reasonCode: "INVALID_CANDIDATE",
            evidence: null,
          };
        }
        const titleKey = normalizeSoundFujiIdentity(candidate.title);
        const artistMatching = (byTitle.get(titleKey) ?? [])
          .map((record) => details.get(record.id))
          .filter((detail): detail is SoundFujiDetailRecord => Boolean(detail))
          .filter((detail) => artistKeys.has(detail.artistKey));
        let matching: SoundFujiDetailRecord[];
        let kindConflict = false;
        if (candidate.expectedKind) {
          const expectedKind = artistMatching.filter((detail) => detail.kind === candidate.expectedKind);
          const unknownKind = artistMatching.filter((detail) => detail.kind === null);
          const conflictingKnownKind = artistMatching.filter((detail) =>
            detail.kind !== null && detail.kind !== candidate.expectedKind);
          if (expectedKind.length > 0) {
            matching = expectedKind;
          } else if (unknownKind.length === 1 && conflictingKnownKind.length === 0) {
            // The official title+artist match remains valid work-level authority;
            // no release kind is inferred from an absent external link hint.
            matching = unknownKind;
          } else {
            matching = [];
            kindConflict = unknownKind.length > 0 &&
              (unknownKind.length > 1 || conflictingKnownKind.length > 0);
          }
        } else {
          matching = artistMatching;
          const kinds = new Set(matching.map((detail) => detail.kind));
          kindConflict = matching.length > 1 && (kinds.size > 1 || kinds.has(null));
        }
        if (matching.length === 0) {
          if (kindConflict) {
            stats.ambiguousCandidates += 1;
            return {
              candidateId: candidate.id,
              outcome: "AMBIGUOUS",
              reasonCode: "OFFICIAL_LABEL_WORK_AMBIGUOUS",
              evidence: null,
            };
          }
          return {
            candidateId: candidate.id,
            outcome: "NOT_FOUND",
            reasonCode: "OFFICIAL_LABEL_WORK_NOT_FOUND",
            evidence: null,
          };
        }
        if (kindConflict) {
          stats.ambiguousCandidates += 1;
          return {
            candidateId: candidate.id,
            outcome: "AMBIGUOUS",
            reasonCode: "OFFICIAL_LABEL_WORK_AMBIGUOUS",
            evidence: null,
          };
        }
        const orderedMatches = [...matching].sort((left, right) => left.id - right.id);
        const match = orderedMatches[0]!;
        const sourceUrls = orderedMatches.map((detail) => detail.url);
        // Every row here already names the same exact artist/title/kind work.
        // Different official archive images may represent different editions,
        // but either remains valid WORK-level artwork. Keep deterministic
        // provenance by selecting the lowest-id page that actually has art.
        const coverMatch = orderedMatches.find((detail) => detail.coverUrl);
        stats.candidatesMatched += 1;
        const cover = coverMatch?.coverUrl
          ? {
              provider: "king-records-sound-fuji",
              scope: "WORK",
              matchLevel: "WORK_EXACT",
              url: coverMatch.coverUrl,
              sourceUrl: coverMatch.url,
            } satisfies SoundFujiWorkCoverEvidence
          : null;
        return {
          candidateId: candidate.id,
          outcome: "PASS",
          reasonCode: "OFFICIAL_LABEL_WORK_MATCH",
          evidence: {
            provider: "king-records-sound-fuji",
            sourceType: "official-label-archive",
            role: "AUTHORITATIVE",
            strength: "STRONG",
            scope: "WORK",
            matchedFields: ["artist", "title"],
            sourceUrl: match.url,
            sourceUrls,
            observedTitle: match.title,
            observedArtist: match.artist,
            observedKind: match.kind,
            cover,
          },
        };
      });
      return {
        status: "COMPLETE",
        applicable: true,
        complete: true,
        candidates: results,
        warnings: invalidIds.size > 0
          ? [{
              code: "invalid-input",
              message: "One or more SOUND FUJI candidates were invalid and were not inspected.",
              retryable: false,
            }]
          : [],
        stats,
      };
    } catch (error) {
      const failure = error instanceof SoundFujiFetchFailure
        ? error
        : new SoundFujiFetchFailure("network-unavailable", true, "The SOUND FUJI crawl failed.");
      return {
        status: "SOURCE_INCOMPLETE",
        applicable: true,
        complete: false,
        candidates: sourceIncompleteCandidates(input.candidates),
        warnings: [{
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        }],
        stats,
      };
    }
  }
}

let defaultSoundFujiArchiveClient: SoundFujiArchiveClient | null = null;

export function getSoundFujiArchiveClient() {
  defaultSoundFujiArchiveClient ??= new SoundFujiArchiveClient();
  return defaultSoundFujiArchiveClient;
}

export async function researchSoundFujiWorkArchive(input: SoundFujiArchiveResearchInput) {
  return getSoundFujiArchiveClient().research(input);
}
