import "server-only";

import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";
import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
} from "@/lib/official-music/url-policy";

export const MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL =
  "https://www.110107.com/s/oto/page/golden_momoe";
export const MOMOE_YAMAGUCHI_OTONANO_ORIGIN = "https://www.110107.com";
export const MOMOE_YAMAGUCHI_SONY_ORIGIN = "https://www.sonymusic.co.jp";
export const MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER = "SRCL-2622";
export const MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL =
  `${MOMOE_YAMAGUCHI_SONY_ORIGIN}/artist/MomoeYamaguchi/discography/SRCL-2622`;
export const MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL =
  `${MOMOE_YAMAGUCHI_SONY_ORIGIN}/json/v2/artist/MomoeYamaguchi/discography/SRCL-2622/callback/cdbox_srcl2622`;

const OTONANO_HOSTNAME = "www.110107.com";
const SONY_HOSTNAME = "www.sonymusic.co.jp";
const OTONANO_COVER_PATH =
  "/files/6/OTONANO/originalpage/golden_idol/img/momoe/";
const SONY_COVER_PATH = "/adm_image/common/artist_image/";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const HARD_MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const HARD_MAX_OTONANO_BYTES = 512 * 1024;
const HARD_MAX_SONY_JSONP_BYTES = 1024 * 1024;
const EXPECTED_SINGLE_ROWS = 33;
const EXPECTED_SINGLES = 32;
const EXPECTED_ALBUMS = 22;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS = Object.freeze(
  Array.from({ length: EXPECTED_ALBUMS }, (_, index) => `MHCL-${10011 + index * 2}`),
);

export type MomoeYamaguchiWorkCategory = "SINGLE" | "ORIGINAL_ALBUM";

export type MomoeYamaguchiWorkCoverEvidence = {
  provider: "sony-music-otonano";
  scope: "WORK";
  matchLevel: "WORK_EXACT";
  url: string;
  sourceUrl: string;
};

export type MomoeYamaguchiWorkAuthorityEvidence = {
  provider: "sony-music-otonano";
  sourceType: "official-record-label-catalog";
  role: "AUTHORITATIVE";
  strength: "STRONG";
  scope: "WORK";
  matchedFields: Array<"artist" | "title" | "category" | "date" | "catalogNumber">;
  sourceUrl: string;
  sourceUrls: string[];
  retrievalUrl: string;
  observedArtist: "山口百恵";
  observedTitle: string;
  observedCategory: MomoeYamaguchiWorkCategory;
  observedOriginalReleaseDate: string;
  observedOriginalCatalogNumber: string | null;
  observedEditionReleaseDate: string | null;
  observedEditionCatalogNumber: string | null;
  cover: MomoeYamaguchiWorkCoverEvidence;
};

export type MomoeYamaguchiSourceEdition = {
  catalogNumber: string;
  releaseDate: string;
};

export type MomoeYamaguchiPhysicalCdCarrierEvidence = {
  provider: "sony-music-japan";
  scope: "EDITION";
  matchLevel: "EDITION_EXACT";
  artist: "山口百恵";
  title: "COSMOS宇宙";
  country: "JP";
  format: "CD";
  releaseDate: "1993-06-21";
  catalogNumber: "SRCL-2622";
  sourceUrl: typeof MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL;
  retrievalUrl: typeof MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL;
  coverUrl: string;
};

export type MomoeYamaguchiCanonicalWork = {
  ordinal: number;
  title: string;
  aliases: string[];
  category: MomoeYamaguchiWorkCategory;
  originalReleaseDate: string;
  originalCatalogNumber: string | null;
  sourceEdition: MomoeYamaguchiSourceEdition | null;
  authorityUrls: string[];
  evidence: MomoeYamaguchiWorkAuthorityEvidence;
  cover: MomoeYamaguchiWorkCoverEvidence;
};

export type MomoeYamaguchiCatalogWarningCode =
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-otonano-html"
  | "invalid-sony-jsonp"
  | "invalid-source-url"
  | "incomplete-catalog";

export type MomoeYamaguchiCatalogWarning = {
  code: MomoeYamaguchiCatalogWarningCode;
  message: string;
  retryable: boolean;
};

export type MomoeYamaguchiCatalogResult = {
  status: "COMPLETE" | "SOURCE_INCOMPLETE";
  complete: boolean;
  artist: {
    canonicalName: "山口百恵";
    aliases: ["Momoe Yamaguchi"];
    country: "JP";
  };
  works: MomoeYamaguchiCanonicalWork[];
  singles: MomoeYamaguchiCanonicalWork[];
  originalAlbums: MomoeYamaguchiCanonicalWork[];
  coverByWorkKey: Record<string, MomoeYamaguchiWorkCoverEvidence>;
  warnings: MomoeYamaguchiCatalogWarning[];
  stats: {
    requestsAttempted: number;
    responsesFetched: number;
    retries: number;
    singleRowsParsed: number;
    promotionalRowsExcluded: number;
    singlesParsed: number;
    albumsParsed: number;
  };
};

export type MomoeYamaguchiCatalogClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  concurrency?: number;
  cacheTtlMs?: number;
};

type MutableStats = MomoeYamaguchiCatalogResult["stats"];

type RequestSpec = {
  url: string;
  contentKind: "otonano-html" | "sony-jsonp";
  maximumBytes: number;
};

class MomoeYamaguchiSourceFailure extends Error {
  constructor(
    readonly code: MomoeYamaguchiCatalogWarningCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "MomoeYamaguchiSourceFailure";
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

function freshStats(): MutableStats {
  return {
    requestsAttempted: 0,
    responsesFetched: 0,
    retries: 0,
    singleRowsParsed: 0,
    promotionalRowsExcluded: 0,
    singlesParsed: 0,
    albumsParsed: 0,
  };
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    if (/^#x/i.test(body)) {
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
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedIdentity(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function tagAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function validPlainText(value: unknown, maximum: number) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function isoDate(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) || year < 1 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > 31
  ) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseOtonanoDate(value: string) {
  const match = value.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function parseSonyDate(value: string) {
  const match = value.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function safeOtonanoCoverUrl(value: string) {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(value), MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL);
  } catch {
    return null;
  }
  if (
    url.origin !== MOMOE_YAMAGUCHI_OTONANO_ORIGIN ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(OTONANO_COVER_PATH) ||
    !/^[A-Za-z0-9]+\.jpe?g$/i.test(url.pathname.slice(OTONANO_COVER_PATH.length))
  ) return null;
  return url.toString();
}

function safeSonyCoverUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "http:" && url.hostname === SONY_HOSTNAME && !url.port) {
    url.protocol = "https:";
  }
  if (
    url.origin !== MOMOE_YAMAGUCHI_SONY_ORIGIN ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(SONY_COVER_PATH) ||
    !/\/jacket_image\/[A-Za-z0-9_-]+\.jpe?g$/i.test(url.pathname)
  ) return null;
  return url.toString();
}

function sourceCover(
  url: string,
  sourceUrl: string,
): MomoeYamaguchiWorkCoverEvidence {
  return {
    provider: "sony-music-otonano",
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url,
    sourceUrl,
  };
}

function sourceEvidence(input: {
  title: string;
  category: MomoeYamaguchiWorkCategory;
  originalReleaseDate: string;
  originalCatalogNumber: string | null;
  editionReleaseDate: string | null;
  editionCatalogNumber: string | null;
  sourceUrl: string;
  retrievalUrl?: string;
  cover: MomoeYamaguchiWorkCoverEvidence;
}): MomoeYamaguchiWorkAuthorityEvidence {
  return {
    provider: "sony-music-otonano",
    sourceType: "official-record-label-catalog",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    scope: "WORK",
    matchedFields: [
      "artist",
      "title",
      "category",
      "date",
      ...(input.originalCatalogNumber || input.editionCatalogNumber ? ["catalogNumber" as const] : []),
    ],
    sourceUrl: input.sourceUrl,
    sourceUrls: [input.sourceUrl],
    retrievalUrl: input.retrievalUrl ?? input.sourceUrl,
    observedArtist: "山口百恵",
    observedTitle: input.title,
    observedCategory: input.category,
    observedOriginalReleaseDate: input.originalReleaseDate,
    observedOriginalCatalogNumber: input.originalCatalogNumber,
    observedEditionReleaseDate: input.editionReleaseDate,
    observedEditionCatalogNumber: input.editionCatalogNumber,
    cover: input.cover,
  };
}

function classBody(block: string, tagName: string, className: string) {
  const matches = [...block.matchAll(new RegExp(
    `<${tagName}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "gi",
  ))];
  return matches.length === 1 ? matches[0]?.[1] ?? null : null;
}

function ddValues(block: string) {
  return [...block.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)]
    .map((match) => stripTags(match[1] ?? ""));
}

/**
 * Parses the one official OTONANO page that publishes all 32 original
 * singles with dates, catalog numbers, and their directly linked jackets.
 * The separate promotion-only row is required and deliberately excluded.
 */
export function parseMomoeYamaguchiOtonanoSingles(html: string) {
  if (typeof html !== "string" || html.length === 0 || html.length > HARD_MAX_OTONANO_BYTES) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-otonano-html",
      false,
      "OTONANO returned an invalid bounded singles document.",
    );
  }
  const rows: Array<{
    title: string;
    trackTitle: string;
    date: string | null;
    catalogNumber: string | null;
    coverUrl: string;
    promotionOnly: boolean;
  }> = [];
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1] ?? "";
    const imageTags = [...block.matchAll(/<img\b[^>]*>/gi)]
      .map((image) => image[0])
      .filter((tag) => tagAttribute(tag, "src").includes(OTONANO_COVER_PATH));
    if (imageTags.length === 0) continue;
    if (imageTags.length !== 1) {
      throw new MomoeYamaguchiSourceFailure(
        "invalid-otonano-html",
        false,
        "An OTONANO single row contained an ambiguous jacket image.",
      );
    }
    const imageTag = imageTags[0]!;
    const rawImageUrl = tagAttribute(imageTag, "src");
    const coverUrl = safeOtonanoCoverUrl(rawImageUrl);
    const title = tagAttribute(imageTag, "alt").normalize("NFKC").trim();
    const anchors = [...block.matchAll(/<a\b[^>]*>/gi)]
      .map((anchor) => anchor[0])
      .filter((tag) => tagAttribute(tag, "href").includes(OTONANO_COVER_PATH));
    const anchorUrl = anchors.length === 1
      ? safeOtonanoCoverUrl(tagAttribute(anchors[0]!, "href"))
      : null;
    const numberBody = classBody(block, "dl", "number");
    const infoBody = classBody(block, "dl", "info");
    const tracks = numberBody ? ddValues(numberBody) : [];
    const info = infoBody ? ddValues(infoBody) : [];
    const date = info.map(parseOtonanoDate).find((value) => value !== null) ?? null;
    const catalogNumber = info.find((value) => /^(?:SOLB|0[679]SH)\s+\d+$/i.test(value)) ?? null;
    const promotionOnly = normalizedIdentity(stripTags(block)).includes("promotiononly");
    if (
      !coverUrl ||
      !anchorUrl ||
      anchorUrl !== coverUrl ||
      !validPlainText(title, 300) ||
      !numberBody ||
      tracks.length === 0 ||
      !(
        normalizedIdentity(tracks[0] ?? "").startsWith(normalizedIdentity(title)) ||
        normalizedIdentity(tracks[0] ?? "").endsWith(normalizedIdentity(title))
      )
    ) {
      throw new MomoeYamaguchiSourceFailure(
        "invalid-otonano-html",
        false,
        "An OTONANO single row was unsafe or structurally incomplete.",
      );
    }
    if (promotionOnly) {
      if (
        normalizedIdentity(title) !== normalizedIdentity("あなたへの子守唄") ||
        date !== null ||
        catalogNumber !== null
      ) {
        throw new MomoeYamaguchiSourceFailure(
          "invalid-otonano-html",
          false,
          "The OTONANO promotion-only row did not match its fixed exclusion shape.",
        );
      }
    } else if (!date || !catalogNumber || tracks.length < 2) {
      throw new MomoeYamaguchiSourceFailure(
        "invalid-otonano-html",
        false,
        "An official OTONANO single row was missing its date, catalog, or B-side.",
      );
    }
    rows.push({
      title,
      trackTitle: tracks[0]!,
      date,
      catalogNumber,
      coverUrl,
      promotionOnly,
    });
  }
  const officialRows = rows.filter((row) => !row.promotionOnly);
  const promotionRows = rows.filter((row) => row.promotionOnly);
  if (
    rows.length !== EXPECTED_SINGLE_ROWS ||
    officialRows.length !== EXPECTED_SINGLES ||
    promotionRows.length !== 1
  ) {
    throw new MomoeYamaguchiSourceFailure(
      "incomplete-catalog",
      false,
      "OTONANO did not return exactly 32 singles plus one promotion-only row.",
    );
  }
  const titleKeys = new Set<string>();
  const catalogs = new Set<string>();
  const covers = new Set<string>();
  return officialRows.map((row, index): MomoeYamaguchiCanonicalWork => {
    const titleKey = normalizedIdentity(row.title);
    const catalogKey = normalizedIdentity(row.catalogNumber!);
    if (
      !titleKey ||
      titleKeys.has(titleKey) ||
      catalogs.has(catalogKey) ||
      covers.has(row.coverUrl)
    ) {
      throw new MomoeYamaguchiSourceFailure(
        "incomplete-catalog",
        false,
        "The OTONANO singles manifest contained a duplicate work identity.",
      );
    }
    titleKeys.add(titleKey);
    catalogs.add(catalogKey);
    covers.add(row.coverUrl);
    const cover = sourceCover(row.coverUrl, MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL);
    const aliases = normalizedIdentity(row.trackTitle) === titleKey ? [] : [row.trackTitle];
    const evidence = sourceEvidence({
      title: row.title,
      category: "SINGLE",
      originalReleaseDate: row.date!,
      originalCatalogNumber: row.catalogNumber!,
      editionReleaseDate: null,
      editionCatalogNumber: null,
      sourceUrl: MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
      cover,
    });
    return {
      ordinal: index + 1,
      title: row.title,
      aliases,
      category: "SINGLE",
      originalReleaseDate: row.date!,
      originalCatalogNumber: row.catalogNumber!,
      sourceEdition: null,
      authorityUrls: [MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL],
      evidence,
      cover,
    };
  });
}

export function momoeYamaguchiSonyAlbumCallbackName(catalogNumber: string) {
  if (!MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.includes(catalogNumber)) {
    throw new TypeError("Unknown fixed Momoe Yamaguchi Sony album catalog number.");
  }
  return `cdbox_${catalogNumber.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`;
}

export function momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber: string) {
  const callback = momoeYamaguchiSonyAlbumCallbackName(catalogNumber);
  return `${MOMOE_YAMAGUCHI_SONY_ORIGIN}/json/v2/artist/MomoeYamaguchi/discography/${catalogNumber}/callback/${callback}`;
}

export function momoeYamaguchiSonyAlbumProductUrl(catalogNumber: string) {
  momoeYamaguchiSonyAlbumCallbackName(catalogNumber);
  return `${MOMOE_YAMAGUCHI_SONY_ORIGIN}/artist/MomoeYamaguchi/discography/buy/${catalogNumber}`;
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalAlbumTitle(rawTitle: string, catalogNumber: string) {
  let title = rawTitle
    .normalize("NFKC")
    .replace(/\s*\((?:初回生産限定盤|初回盤)\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (catalogNumber === "MHCL-10011") {
    title = title.replace(/^山口百恵ファースト・アルバム\s*/u, "");
  } else if (catalogNumber === "MHCL-10013") {
    title = title.replace(/^百恵セカンド・アルバム\s*/u, "");
  } else if (catalogNumber === "MHCL-10041") {
    title = title.replace(/^二十才の記念碑\s*/u, "");
  }
  return title.trim();
}

/** Strictly removes only the expected callback wrapper before JSON.parse. */
export function parseMomoeYamaguchiSonyAlbumJsonp(
  payload: string,
  catalogNumber: string,
) {
  const ordinal = MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.indexOf(catalogNumber) + 1;
  if (ordinal === 0 || typeof payload !== "string" || payload.length > HARD_MAX_SONY_JSONP_BYTES) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid bounded album payload.",
    );
  }
  const callback = momoeYamaguchiSonyAlbumCallbackName(catalogNumber);
  const wrapper = payload.trim().match(new RegExp(
    `^${escapedRegExp(callback)}\\s*\\(([\\s\\S]*)\\)\\s*;?$`,
  ));
  if (!wrapper) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid JSONP callback wrapper.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(wrapper[1] ?? "");
  } catch {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned invalid JSON inside its callback wrapper.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid album response object.",
    );
  }
  const items = (parsed as Record<string, unknown>).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid album item.",
    );
  }
  const item = items as Record<string, unknown>;
  if (
    item.artistName !== "山口百恵" ||
    item.artistFolder !== "MomoeYamaguchi" ||
    item.representative_goods_number !== catalogNumber ||
    !validPlainText(item.title, 500) ||
    !validPlainText(item.image_original, 2_000) ||
    !validPlainText(item.release_date, 20) ||
    !Array.isArray(item.comments) ||
    item.comments.length === 0 ||
    item.comments.length > 10 ||
    !item.comments.every((comment) => typeof comment === "string" && comment.length <= 20_000)
  ) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an incomplete album item.",
    );
  }
  const rawTitle = (item.title as string).normalize("NFKC").trim();
  const title = canonicalAlbumTitle(rawTitle, catalogNumber);
  const coverUrl = safeSonyCoverUrl(item.image_original as string);
  const editionReleaseDate = parseSonyDate(item.release_date as string);
  const comments = stripTags((item.comments as string[]).join(" "));
  const originalDateValues = [...comments.matchAll(
    /(19\d{2})年(\d{1,2})月(\d{1,2})日発売/gu,
  )].map((match) => isoDate(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter((value): value is string => value !== null);
  const originalDates = [...new Set(originalDateValues)];
  const observedOrdinal = Number(comments.match(/(\d{1,2})枚目(?:のアルバム)?/u)?.[1]);
  if (
    !title ||
    !normalizedIdentity(title) ||
    !coverUrl ||
    !editionReleaseDate ||
    originalDates.length !== 1 ||
    observedOrdinal !== ordinal ||
    originalDates[0]! >= editionReleaseDate
  ) {
    throw new MomoeYamaguchiSourceFailure(
      coverUrl ? "invalid-sony-jsonp" : "invalid-source-url",
      false,
      "Sony returned unsafe or conflicting album identity metadata.",
    );
  }
  const retrievalUrl = momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber);
  const sourceUrl = momoeYamaguchiSonyAlbumProductUrl(catalogNumber);
  const cover = sourceCover(coverUrl, sourceUrl);
  const evidence = sourceEvidence({
    title,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: originalDates[0]!,
    originalCatalogNumber: null,
    editionReleaseDate,
    editionCatalogNumber: catalogNumber,
    sourceUrl,
    retrievalUrl,
    cover,
  });
  const cleanedRawTitle = rawTitle
    .replace(/\s*\((?:初回生産限定盤|初回盤)\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ordinal,
    title,
    aliases: normalizedIdentity(cleanedRawTitle) === normalizedIdentity(title)
      ? []
      : [cleanedRawTitle],
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: originalDates[0]!,
    originalCatalogNumber: null,
    sourceEdition: {
      catalogNumber,
      releaseDate: editionReleaseDate,
    },
    authorityUrls: [sourceUrl],
    evidence,
    cover,
  } satisfies MomoeYamaguchiCanonicalWork;
}

const COSMOS_CD_TRACKS = [
  "OPENING（TAKE OFF）",
  "SPACE OPERA",
  "銀河カフェテラス",
  "宇宙旅行のパンフレット",
  "銀色のジプシー",
  "ただよいの中で",
  "COSMOS（宇宙）",
  "軌道修正",
  "乙女座 宮",
  "TIME TRAVEL",
  "OPENING（TAKE OFF）",
  "宇宙旅行のパンフレット",
] as const;

function exactCosmosCdTracks(value: unknown) {
  if (!Array.isArray(value) || value.length !== COSMOS_CD_TRACKS.length) return false;
  const titles = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (row.disc_number !== 1 || !Array.isArray(row.contents) || row.contents.length !== 1) {
      return null;
    }
    const content = row.contents[0];
    if (!content || typeof content !== "object" || Array.isArray(content)) return null;
    const title = (content as Record<string, unknown>).title;
    return validPlainText(title, 500) ? (title as string).normalize("NFKC").trim() : null;
  });
  return titles.every((title, index) =>
    title === COSMOS_CD_TRACKS[index]!.normalize("NFKC"));
}

/** Parses the one fixed Sony product entity for the 1993 physical-CD edition. */
export function parseMomoeYamaguchiCosmosCdJsonp(
  payload: string,
): MomoeYamaguchiPhysicalCdCarrierEvidence {
  if (typeof payload !== "string" || payload.length > HARD_MAX_SONY_JSONP_BYTES) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid bounded COSMOS CD payload.",
    );
  }
  const wrapper = payload.trim().match(/^cdbox_srcl2622\s*\(([\s\S]*)\)\s*;?$/u);
  if (!wrapper) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid COSMOS CD JSONP callback wrapper.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(wrapper[1] ?? "");
  } catch {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned invalid JSON inside the COSMOS CD callback.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid COSMOS CD response object.",
    );
  }
  const items = (parsed as Record<string, unknown>).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    throw new MomoeYamaguchiSourceFailure(
      "invalid-sony-jsonp",
      false,
      "Sony returned an invalid COSMOS CD item.",
    );
  }
  const item = items as Record<string, unknown>;
  const coverUrl = validPlainText(item.image_original, 2_000)
    ? safeSonyCoverUrl(item.image_original as string)
    : null;
  if (
    item.artistName !== "山口百恵" ||
    item.artistFolder !== "MomoeYamaguchi" ||
    item.title !== "COSMOS宇宙" ||
    item.representative_goods_number !== MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER ||
    item.display_goods_number !== MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER ||
    item.type !== "アルバム" ||
    item.release_date !== "1993.06.21" ||
    item.display_release_date !== "1993.06.21" ||
    !coverUrl ||
    !exactCosmosCdTracks(item.discs)
  ) {
    throw new MomoeYamaguchiSourceFailure(
      coverUrl ? "invalid-sony-jsonp" : "invalid-source-url",
      false,
      "Sony returned an incomplete or conflicting COSMOS physical-CD tuple.",
    );
  }
  return {
    provider: "sony-music-japan",
    scope: "EDITION",
    matchLevel: "EDITION_EXACT",
    artist: "山口百恵",
    title: "COSMOS宇宙",
    country: "JP",
    format: "CD",
    releaseDate: "1993-06-21",
    catalogNumber: MOMOE_YAMAGUCHI_COSMOS_CD_CATALOG_NUMBER,
    sourceUrl: MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
    retrievalUrl: MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
    coverUrl,
  };
}

function canonicalWorkKey(work: MomoeYamaguchiCanonicalWork) {
  return `${work.category}:${normalizedIdentity(work.title)}`;
}

function validateCompleteCatalog(
  singles: MomoeYamaguchiCanonicalWork[],
  albums: MomoeYamaguchiCanonicalWork[],
) {
  if (singles.length !== EXPECTED_SINGLES || albums.length !== EXPECTED_ALBUMS) {
    throw new MomoeYamaguchiSourceFailure(
      "incomplete-catalog",
      false,
      "The Sony/OTONANO snapshot did not contain the fixed 32+22 works.",
    );
  }
  const keys = new Set<string>();
  const sourceEditionCatalogs = new Set<string>();
  const covers = new Set<string>();
  for (const work of [...singles, ...albums]) {
    const key = canonicalWorkKey(work);
    if (
      keys.has(key) ||
      covers.has(work.cover.url) ||
      work.evidence.cover.url !== work.cover.url ||
      work.evidence.observedOriginalReleaseDate !== work.originalReleaseDate
    ) {
      throw new MomoeYamaguchiSourceFailure(
        "incomplete-catalog",
        false,
        "The Sony/OTONANO snapshot contained duplicate or conflicting work evidence.",
      );
    }
    keys.add(key);
    covers.add(work.cover.url);
    if (work.sourceEdition) {
      if (sourceEditionCatalogs.has(work.sourceEdition.catalogNumber)) {
        throw new MomoeYamaguchiSourceFailure(
          "incomplete-catalog",
          false,
          "The Sony album snapshot reused a source edition catalog number.",
        );
      }
      sourceEditionCatalogs.add(work.sourceEdition.catalogNumber);
    }
  }
  if (
    sourceEditionCatalogs.size !== EXPECTED_ALBUMS ||
    albums.some((work, index) =>
      work.ordinal !== index + 1 ||
      work.sourceEdition?.catalogNumber !== MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS[index]) ||
    singles.some((work, index) => work.ordinal !== index + 1)
  ) {
    throw new MomoeYamaguchiSourceFailure(
      "incomplete-catalog",
      false,
      "The Sony/OTONANO snapshot was not a complete ordered catalog.",
    );
  }
}

async function readLimitedText(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length")?.trim();
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new MomoeYamaguchiSourceFailure(
      "response-too-large",
      false,
      "The official catalog response exceeded its fixed byte limit.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        throw new MomoeYamaguchiSourceFailure(
          "response-too-large",
          false,
          "The official catalog response exceeded its fixed byte limit.",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body may already be closed.
    }
  }
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response, now: () => number) {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.min(30_000, Math.max(0, Math.round(Number(raw) * 1_000)));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.min(30_000, Math.max(0, timestamp - now()))
    : null;
}

function validFixedRequestUrl(spec: RequestSpec) {
  let url: URL;
  try {
    url = new URL(spec.url);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) return false;
  if (spec.contentKind === "otonano-html") {
    return url.toString() === MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL;
  }
  if (url.toString() === MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL) return true;
  return url.origin === MOMOE_YAMAGUCHI_SONY_ORIGIN &&
    /^\/json\/v2\/artist\/MomoeYamaguchi\/discography\/MHCL-\d+\/callback\/cdbox_mhcl\d+$/u.test(url.pathname);
}

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (failure === null) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      try {
        output[index] = await work(values[index]!, index);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  if (failure !== null) throw failure;
  return output;
}

export class MomoeYamaguchiOfficialCatalogClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly concurrency: number;
  private readonly cacheTtlMs: number;
  private cachedCompleteResult: {
    expiresAt: number;
    value: MomoeYamaguchiCatalogResult;
  } | null = null;
  private inFlightLoad: Promise<MomoeYamaguchiCatalogResult> | null = null;

  constructor(options: MomoeYamaguchiCatalogClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
    this.concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 2, 4);
    this.cacheTtlMs = clampInteger(
      options.cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      0,
      HARD_MAX_CACHE_TTL_MS,
    );
  }

  private async resolveFixedHost(hostname: string) {
    let resolved = await resolvePublicOfficialHost(hostname, this.resolveHost);
    for (
      let attempt = 0;
      !resolved.ok && resolved.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      await this.sleep(Math.min(2_000, 250 * 2 ** attempt));
      resolved = await resolvePublicOfficialHost(hostname, this.resolveHost);
    }
    if (!resolved.ok) {
      throw new MomoeYamaguchiSourceFailure(
        resolved.reason,
        resolved.reason === "dns-resolution-failed",
        "A fixed Sony/OTONANO host did not resolve exclusively to public addresses.",
      );
    }
  }

  private async requestOnce(spec: RequestSpec, stats: MutableStats) {
    if (!validFixedRequestUrl(spec)) {
      throw new MomoeYamaguchiSourceFailure(
        "invalid-source-url",
        false,
        "A Sony/OTONANO request URL violated the fixed HTTPS allowlist.",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(spec.url, {
        method: "GET",
        headers: {
          Accept: spec.contentKind === "otonano-html"
            ? "text/html, application/xhtml+xml;q=0.9"
            : "text/javascript, application/javascript;q=0.9",
          "User-Agent": "CD-BOX/1.0 Sony-OTONANO-catalog-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new MomoeYamaguchiSourceFailure(
          "invalid-source-url",
          false,
          "Sony/OTONANO attempted an untrusted redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        const failure = new MomoeYamaguchiSourceFailure(
          "http-status",
          retryableStatus(response.status),
          `Sony/OTONANO returned HTTP ${response.status}.`,
        );
        Object.assign(failure, { retryAfterMs: delay });
        throw failure;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const contentTypeValid = spec.contentKind === "otonano-html"
        ? contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml")
        : contentType.startsWith("text/javascript") || contentType.startsWith("application/javascript");
      if (!contentTypeValid) {
        await response.body?.cancel().catch(() => undefined);
        throw new MomoeYamaguchiSourceFailure(
          "unsupported-content-type",
          false,
          "Sony/OTONANO returned an unsupported content type.",
        );
      }
      const text = await readLimitedText(response, spec.maximumBytes);
      stats.responsesFetched += 1;
      return text;
    } catch (error) {
      if (error instanceof MomoeYamaguchiSourceFailure) throw error;
      if (controller.signal.aborted) {
        throw new MomoeYamaguchiSourceFailure(
          "network-timeout",
          true,
          "The Sony/OTONANO request timed out.",
        );
      }
      throw new MomoeYamaguchiSourceFailure(
        "network-unavailable",
        true,
        "The Sony/OTONANO request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(spec: RequestSpec, stats: MutableStats) {
    let lastFailure: MomoeYamaguchiSourceFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestOnce(spec, stats);
      } catch (error) {
        const failure = error instanceof MomoeYamaguchiSourceFailure
          ? error
          : new MomoeYamaguchiSourceFailure(
              "network-unavailable",
              true,
              "The Sony/OTONANO request failed.",
            );
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        const retryAfter = (failure as MomoeYamaguchiSourceFailure & {
          retryAfterMs?: number | null;
        }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastFailure ?? new MomoeYamaguchiSourceFailure(
      "network-unavailable",
      true,
      "The Sony/OTONANO request failed.",
    );
  }

  private async loadUncached(): Promise<MomoeYamaguchiCatalogResult> {
    const stats = freshStats();
    try {
      await Promise.all([
        this.resolveFixedHost(OTONANO_HOSTNAME),
        this.resolveFixedHost(SONY_HOSTNAME),
      ]);
      const tasks: RequestSpec[] = [
        {
          url: MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
          contentKind: "otonano-html",
          maximumBytes: HARD_MAX_OTONANO_BYTES,
        },
        ...MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.map((catalogNumber) => ({
          url: momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber),
          contentKind: "sony-jsonp" as const,
          maximumBytes: HARD_MAX_SONY_JSONP_BYTES,
        })),
      ];
      const payloads = await boundedMap(
        tasks,
        this.concurrency,
        (task) => this.request(task, stats),
      );
      const singles = parseMomoeYamaguchiOtonanoSingles(payloads[0]!);
      const originalAlbums = MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS.map(
        (catalogNumber, index) =>
          parseMomoeYamaguchiSonyAlbumJsonp(payloads[index + 1]!, catalogNumber),
      );
      stats.singleRowsParsed = EXPECTED_SINGLE_ROWS;
      stats.promotionalRowsExcluded = 1;
      stats.singlesParsed = singles.length;
      stats.albumsParsed = originalAlbums.length;
      validateCompleteCatalog(singles, originalAlbums);
      const works = [...singles, ...originalAlbums];
      const coverByWorkKey = Object.fromEntries(
        works.map((work) => [canonicalWorkKey(work), work.cover]),
      );
      return {
        status: "COMPLETE",
        complete: true,
        artist: {
          canonicalName: "山口百恵",
          aliases: ["Momoe Yamaguchi"],
          country: "JP",
        },
        works,
        singles,
        originalAlbums,
        coverByWorkKey,
        warnings: [],
        stats,
      };
    } catch (error) {
      const failure = error instanceof MomoeYamaguchiSourceFailure
        ? error
        : new MomoeYamaguchiSourceFailure(
            "network-unavailable",
            true,
            "The Sony/OTONANO catalog load failed.",
          );
      return {
        status: "SOURCE_INCOMPLETE",
        complete: false,
        artist: {
          canonicalName: "山口百恵",
          aliases: ["Momoe Yamaguchi"],
          country: "JP",
        },
        works: [],
        singles: [],
        originalAlbums: [],
        coverByWorkKey: {},
        warnings: [{
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        }],
        stats,
      };
    }
  }

  load(): Promise<MomoeYamaguchiCatalogResult> {
    if (this.cachedCompleteResult) {
      if (this.cachedCompleteResult.expiresAt > this.now()) {
        return Promise.resolve(this.cachedCompleteResult.value);
      }
      this.cachedCompleteResult = null;
    }
    if (this.inFlightLoad) return this.inFlightLoad;

    const operation = this.loadUncached().then((result) => {
      if (result.complete && this.cacheTtlMs > 0) {
        this.cachedCompleteResult = {
          expiresAt: this.now() + this.cacheTtlMs,
          value: result,
        };
      }
      return result;
    });
    const tracked = operation.finally(() => {
      if (this.inFlightLoad === tracked) this.inFlightLoad = null;
    });
    this.inFlightLoad = tracked;
    return tracked;
  }

  async loadCosmosPhysicalCdCarrier() {
    const stats = freshStats();
    await this.resolveFixedHost(SONY_HOSTNAME);
    const payload = await this.request({
      url: MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
      contentKind: "sony-jsonp",
      maximumBytes: HARD_MAX_SONY_JSONP_BYTES,
    }, stats);
    return parseMomoeYamaguchiCosmosCdJsonp(payload);
  }
}

let defaultMomoeYamaguchiOfficialCatalogClient: MomoeYamaguchiOfficialCatalogClient | null = null;

export function getMomoeYamaguchiOfficialCatalogClient() {
  defaultMomoeYamaguchiOfficialCatalogClient ??=
    new MomoeYamaguchiOfficialCatalogClient();
  return defaultMomoeYamaguchiOfficialCatalogClient;
}

export async function fetchMomoeYamaguchiOfficialCatalog() {
  return getMomoeYamaguchiOfficialCatalogClient().load();
}

export async function fetchMomoeYamaguchiCosmosPhysicalCdCarrier() {
  return getMomoeYamaguchiOfficialCatalogClient().loadCosmosPhysicalCdCarrier();
}
