import "server-only";

import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";
import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
} from "@/lib/official-music/url-policy";

export const MIHO_NAKAYAMA_KING_CARRIER_URL =
  "https://www.kingrecords.co.jp/cs/g/gKICS-93968/";
export const MIHO_NAKAYAMA_MELLOW_CD_URL =
  "https://www.kingrecords.co.jp/cs/g/gKICS-3274/";

const KING_HOSTNAME = "www.kingrecords.co.jp";
const KING_PATHNAME = "/cs/g/gKICS-93968/";
const MELLOW_KING_PATHNAME = "/cs/g/gKICS-3274/";
const EXPECTED_ARTIST = "中山美穂";
const EXPECTED_TITLE = "All Time Best【初回限定盤】";
const EXPECTED_PAGE_TITLE =
  `${EXPECTED_TITLE} | ${EXPECTED_ARTIST} | キングレコードオフィシャルサイト`;
const EXPECTED_RELEASE_DATE = "2020-12-23";
const EXPECTED_DISPLAY_DATE = "2020/12/23";
const EXPECTED_HIDDEN_DATE = "2020-12-23 00:00:00";
const EXPECTED_CATALOG = "KICS-93968～70";
const EXPECTED_DISC_TRACK_COUNTS = [14, 13, 13] as const;
const EXPECTED_TRACK_COUNT = 40;
const MELLOW_EXPECTED_TRACKS = [
  "Mellow",
  "あるきなさい",
  "ゆっくりMy Love",
  "Platinum Cat",
  "Silent",
  "忘れなくてもいいじゃない",
  "灼熱の心",
  "はなしをきいて",
  "Kiss Kiss Kiss",
  "Treasure",
  "Mellow(CM Version)",
] as const;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const HARD_MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const HARD_MAX_RESPONSE_BYTES = 512 * 1_024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const MIHO_NAKAYAMA_MANIFEST_CARRIER_WORKS = [
  {
    manifestTitle: "生意気",
    acceptedOfficialTitles: ["生意気"],
    disc: 1,
    position: 2,
  },
  {
    manifestTitle: "BE-BOP-HIGHSCHOOL",
    acceptedOfficialTitles: ["BE-BOP-HIGHSCHOOL"],
    disc: 1,
    position: 3,
  },
  {
    manifestTitle: "ツイてるねノッてるね",
    acceptedOfficialTitles: ["ツイてるね ノッてるね", "ツイてるねノッてるね"],
    disc: 1,
    position: 7,
  },
  {
    manifestTitle: "VIRGIN EYES",
    acceptedOfficialTitles: ["VIRGIN EYES"],
    disc: 2,
    position: 2,
  },
] as const;

export type MihoNakayamaManifestCarrierWorkTitle =
  typeof MIHO_NAKAYAMA_MANIFEST_CARRIER_WORKS[number]["manifestTitle"];

export type MihoNakayamaCarrierTrack = {
  disc: number;
  position: number;
  title: string;
};

export type MihoNakayamaManifestCarrierWork = {
  manifestTitle: MihoNakayamaManifestCarrierWorkTitle;
  observedTrackTitle: string;
  disc: number;
  position: number;
};

export type MihoNakayamaKingCarrierFacts = {
  provider: "king-records-japan";
  sourceType: "official-record-label-product-page";
  evidenceRole: "PHYSICAL_CD_CARRIER";
  scope: "CONTAINER_EDITION";
  matchLevel: "EDITION_EXACT";
  unique: true;
  artist: "中山美穂";
  title: "All Time Best【初回限定盤】";
  releaseDate: "2020-12-23";
  catalogNumber: "KICS-93968～70";
  country: "JP";
  format: "CD";
  cdDiscCount: 3;
  trackCount: 40;
  tracks: MihoNakayamaCarrierTrack[];
  manifestCarrierWorks: MihoNakayamaManifestCarrierWork[];
  matchedFields: [
    "artist",
    "title",
    "releaseDate",
    "catalogNumber",
    "discCount",
    "trackCount",
    "trackList",
  ];
  sourceUrl: typeof MIHO_NAKAYAMA_KING_CARRIER_URL;
  retrievalUrl: typeof MIHO_NAKAYAMA_KING_CARRIER_URL;
  workCover: null;
  coverInheritanceAllowed: false;
};

export type MihoNakayamaMellowCdTrack = {
  position: number;
  title: string;
};

export type MihoNakayamaMellowCdEditionFacts = {
  provider: "king-records-japan";
  sourceType: "official-record-label-product-page";
  evidenceRole: "PHYSICAL_CD_EDITION";
  scope: "SAME_WORK_EDITION";
  matchLevel: "EDITION_EXACT";
  representationKind: "SAME_WORK_EDITION";
  unique: true;
  artist: "中山美穂";
  workTitle: "Mellow";
  editionTitle: "Mellow";
  originalReleaseDate: "1992-06-10";
  editionReleaseDate: "2015-10-14";
  catalogNumber: "KICS-3274";
  country: "JP";
  format: "CD";
  isReissue: true;
  cdDiscCount: 1;
  trackCount: 11;
  tracks: MihoNakayamaMellowCdTrack[];
  matchedFields: [
    "artist",
    "title",
    "editionReleaseDate",
    "catalogNumber",
    "format",
    "trackList",
  ];
  sourceUrl: typeof MIHO_NAKAYAMA_MELLOW_CD_URL;
  retrievalUrl: typeof MIHO_NAKAYAMA_MELLOW_CD_URL;
  workCover: null;
  coverInheritanceAllowed: false;
};

export type MihoNakayamaCarrierFailureCode =
  | "invalid-source-url"
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-html"
  | "artist-identity-mismatch"
  | "title-mismatch"
  | "date-mismatch"
  | "catalog-mismatch"
  | "disc-count-mismatch"
  | "track-count-mismatch"
  | "track-list-invalid"
  | "track-title-mismatch"
  | "carrier-track-missing"
  | "carrier-track-duplicate"
  | "carrier-track-position-mismatch";

export type MihoNakayamaCarrierWarning = {
  code: MihoNakayamaCarrierFailureCode;
  message: string;
  retryable: boolean;
  url: typeof MIHO_NAKAYAMA_KING_CARRIER_URL;
};

export type MihoNakayamaCarrierStats = {
  requestsAttempted: number;
  responsesFetched: number;
  retries: number;
  sourcesParsed: number;
  cacheHits: number;
};

export type MihoNakayamaKingCarrierResult =
  | {
      status: "VERIFIED";
      complete: true;
      unique: true;
      carrier: MihoNakayamaKingCarrierFacts;
      warnings: [];
      stats: MihoNakayamaCarrierStats;
    }
  | {
      status: "SOURCE_INCOMPLETE";
      complete: false;
      unique: false;
      carrier: null;
      warnings: [MihoNakayamaCarrierWarning];
      stats: MihoNakayamaCarrierStats;
    };

export type MihoNakayamaMellowCdWarning = {
  code: MihoNakayamaCarrierFailureCode;
  message: string;
  retryable: boolean;
  url: typeof MIHO_NAKAYAMA_MELLOW_CD_URL;
};

export type MihoNakayamaMellowCdResult =
  | {
      status: "VERIFIED";
      complete: true;
      unique: true;
      edition: MihoNakayamaMellowCdEditionFacts;
      warnings: [];
      stats: MihoNakayamaCarrierStats;
    }
  | {
      status: "SOURCE_INCOMPLETE";
      complete: false;
      unique: false;
      edition: null;
      warnings: [MihoNakayamaMellowCdWarning];
      stats: MihoNakayamaCarrierStats;
    };

export type MihoNakayamaCarrierClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  cacheTtlMs?: number;
};

export class MihoNakayamaCarrierSourceFailure extends Error {
  constructor(
    readonly code: MihoNakayamaCarrierFailureCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "MihoNakayamaCarrierSourceFailure";
  }
}

function freshStats(): MihoNakayamaCarrierStats {
  return {
    requestsAttempted: 0,
    responsesFetched: 0,
    retries: 0,
    sourcesParsed: 0,
    cacheHits: 0,
  };
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
    .replace(/\s+/g, " ")
    .trim();
}

function exactIdentity(value: string) {
  return decodeHtmlEntities(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function tagAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function classTokens(tag: string) {
  return tagAttribute(tag, "class").split(/\s+/).filter(Boolean);
}

function elementsWithClass(html: string, tagName: string, className: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<${escapedTag}\\b[^>]*>`, "gi");
  const values: string[] = [];
  for (const match of html.matchAll(expression)) {
    if (!classTokens(match[0]).includes(className)) continue;
    const contentStart = (match.index ?? 0) + match[0].length;
    const closingExpression = new RegExp(`<\\/${escapedTag}\\s*>`, "gi");
    closingExpression.lastIndex = contentStart;
    const closing = closingExpression.exec(html);
    if (closing) values.push(html.slice(contentStart, closing.index));
  }
  return values;
}

function uniqueClassText(
  html: string,
  tagName: string,
  className: string,
  code: MihoNakayamaCarrierFailureCode,
) {
  const values = [...new Set(
    elementsWithClass(html, tagName, className).map(stripTags).filter(Boolean),
  )];
  if (values.length !== 1 || !values[0]) {
    throw new MihoNakayamaCarrierSourceFailure(
      code,
      false,
      `The fixed King Records ${className} field was missing or ambiguous.`,
    );
  }
  return values[0];
}

function uniqueInputValue(
  html: string,
  name: string,
  code: MihoNakayamaCarrierFailureCode,
) {
  const values = [...html.matchAll(/<input\b[^>]*>/gi)]
    .filter((match) => tagAttribute(match[0], "name") === name)
    .map((match) => tagAttribute(match[0], "value"));
  if (values.length !== 1 || !values[0]) {
    throw new MihoNakayamaCarrierSourceFailure(
      code,
      false,
      `The fixed King Records ${name} field was missing or ambiguous.`,
    );
  }
  return values[0];
}

function requireExactKingSourceUrl(
  sourceUrl: string,
  expectedUrl: string,
  expectedPathname: string,
) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new MihoNakayamaCarrierSourceFailure(
      "invalid-source-url",
      false,
      "The King Records carrier URL was invalid.",
    );
  }
  if (
    sourceUrl !== expectedUrl ||
    url.protocol !== "https:" ||
    url.hostname !== KING_HOSTNAME ||
    url.pathname !== expectedPathname ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "invalid-source-url",
      false,
      "The King Records carrier URL violated its fixed HTTPS host and path allowlist.",
    );
  }
}

function requireFixedSourceUrl(sourceUrl: string) {
  requireExactKingSourceUrl(
    sourceUrl,
    MIHO_NAKAYAMA_KING_CARRIER_URL,
    KING_PATHNAME,
  );
}

function requireMellowSourceUrl(sourceUrl: string) {
  requireExactKingSourceUrl(
    sourceUrl,
    MIHO_NAKAYAMA_MELLOW_CD_URL,
    MELLOW_KING_PATHNAME,
  );
}

function requireFixedCanonicalUrl(html: string, expectedUrl: string) {
  const canonicalUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => tagAttribute(match[0], "rel").toLowerCase().split(/\s+/).includes("canonical"))
    .map((match) => tagAttribute(match[0], "href"));
  const openGraphUrls = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter((match) => tagAttribute(match[0], "property").toLowerCase() === "og:url")
    .map((match) => tagAttribute(match[0], "content"));
  if (
    canonicalUrls.length !== 1 ||
    canonicalUrls[0] !== expectedUrl ||
    openGraphUrls.length !== 1 ||
    openGraphUrls[0] !== expectedUrl
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "invalid-source-url",
      false,
      "The King Records page did not declare the unique fixed canonical product URL.",
    );
  }
}

function detailLines(detailHtml: string) {
  return decodeHtmlEntities(detailHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|pre|div)>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

function parseTracks(detailHtml: string) {
  const lines = detailLines(detailHtml);
  const fullText = exactIdentity(lines.join(" "));
  const summaryMatches = [...fullText.matchAll(/全(\d+)曲を収録したCD(\d+)枚組/gu)];
  if (summaryMatches.length !== 1) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-list-invalid",
      false,
      "The King Records page did not contain one exact CD-disc and track-count statement.",
    );
  }
  if (Number(summaryMatches[0]?.[2]) !== EXPECTED_DISC_TRACK_COUNTS.length) {
    throw new MihoNakayamaCarrierSourceFailure(
      "disc-count-mismatch",
      false,
      "The King Records product statement did not identify a three-CD carrier.",
    );
  }
  if (Number(summaryMatches[0]?.[1]) !== EXPECTED_TRACK_COUNT) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-count-mismatch",
      false,
      "The King Records product statement did not identify exactly 40 tracks.",
    );
  }

  const tracks: MihoNakayamaCarrierTrack[] = [];
  const encounteredDiscs: number[] = [];
  let currentDisc: number | null = null;
  for (const line of lines) {
    if (/^\[Blu-ray\]$/u.test(line)) {
      currentDisc = null;
      break;
    }
    const disc = line.match(/^\[DISC-(\d+)\]$/u);
    if (disc) {
      currentDisc = Number(disc[1]);
      encounteredDiscs.push(currentDisc);
      continue;
    }
    if (currentDisc === null) continue;
    const track = line.match(/^(\d{2})\.(.+)$/u);
    if (!track || !track[2]?.trim()) {
      throw new MihoNakayamaCarrierSourceFailure(
        "track-list-invalid",
        false,
        "The fixed King Records DISC list contained a malformed track row.",
      );
    }
    tracks.push({
      disc: currentDisc,
      position: Number(track[1]),
      title: exactIdentity(track[2]),
    });
  }

  if (
    encounteredDiscs.length !== EXPECTED_DISC_TRACK_COUNTS.length ||
    encounteredDiscs.some((disc, index) => disc !== index + 1)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "disc-count-mismatch",
      false,
      "The King Records page did not contain exactly one ordered DISC-1 through DISC-3 list.",
    );
  }
  for (const [index, expectedCount] of EXPECTED_DISC_TRACK_COUNTS.entries()) {
    const disc = index + 1;
    const discTracks = tracks.filter((track) => track.disc === disc);
    if (discTracks.length !== expectedCount) {
      throw new MihoNakayamaCarrierSourceFailure(
        "track-count-mismatch",
        false,
        `King Records DISC-${disc} did not contain exactly ${expectedCount} tracks.`,
      );
    }
    if (discTracks.some((track, trackIndex) => track.position !== trackIndex + 1)) {
      throw new MihoNakayamaCarrierSourceFailure(
        "track-list-invalid",
        false,
        `King Records DISC-${disc} track positions were incomplete or out of order.`,
      );
    }
  }
  if (tracks.length !== EXPECTED_TRACK_COUNT) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-count-mismatch",
      false,
      "The fixed King Records DISC lists did not contain exactly 40 tracks.",
    );
  }
  const titleKeys = tracks.map((track) => exactIdentity(track.title));
  if (new Set(titleKeys).size !== titleKeys.length) {
    throw new MihoNakayamaCarrierSourceFailure(
      "carrier-track-duplicate",
      false,
      "The fixed King Records DISC lists contained a duplicate exact track identity.",
    );
  }
  return tracks;
}

function matchManifestCarrierWorks(tracks: readonly MihoNakayamaCarrierTrack[]) {
  return MIHO_NAKAYAMA_MANIFEST_CARRIER_WORKS.map((spec) => {
    const allowed = new Set(spec.acceptedOfficialTitles.map(exactIdentity));
    const matches = tracks.filter((track) => allowed.has(exactIdentity(track.title)));
    if (matches.length === 0) {
      throw new MihoNakayamaCarrierSourceFailure(
        "carrier-track-missing",
        false,
        `The King Records DISC list did not contain the exact manifest carrier work ${spec.manifestTitle}.`,
      );
    }
    if (matches.length !== 1) {
      throw new MihoNakayamaCarrierSourceFailure(
        "carrier-track-duplicate",
        false,
        `The King Records DISC list did not uniquely identify ${spec.manifestTitle}.`,
      );
    }
    const match = matches[0]!;
    if (match.disc !== spec.disc || match.position !== spec.position) {
      throw new MihoNakayamaCarrierSourceFailure(
        "carrier-track-position-mismatch",
        false,
        `The King Records DISC position for ${spec.manifestTitle} did not match the fixed product list.`,
      );
    }
    return {
      manifestTitle: spec.manifestTitle,
      observedTrackTitle: match.title,
      disc: match.disc,
      position: match.position,
    };
  });
}

export function parseMihoNakayamaKingCarrierPage(
  html: string,
  sourceUrl = MIHO_NAKAYAMA_KING_CARRIER_URL,
): MihoNakayamaKingCarrierFacts {
  requireFixedSourceUrl(sourceUrl);
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    new TextEncoder().encode(html).byteLength > HARD_MAX_RESPONSE_BYTES ||
    !/<html\b/i.test(html) ||
    !/<\/html\s*>/i.test(html)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      new TextEncoder().encode(html).byteLength > HARD_MAX_RESPONSE_BYTES
        ? "response-too-large"
        : "invalid-html",
      false,
      "The fixed King Records response was not bounded HTML.",
    );
  }
  requireFixedCanonicalUrl(html, MIHO_NAKAYAMA_KING_CARRIER_URL);

  const pageTitles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)]
    .map((match) => stripTags(match[1] ?? ""));
  const visibleTitle = uniqueClassText(html, "h3", "desc--title", "title-mismatch");
  const hiddenTitle = uniqueInputValue(html, "isrc_goods_name", "title-mismatch");
  if (
    exactIdentity(visibleTitle) !== exactIdentity(EXPECTED_TITLE) ||
    exactIdentity(hiddenTitle) !== exactIdentity(EXPECTED_TITLE)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "title-mismatch",
      false,
      "The King Records page title did not uniquely identify the fixed carrier.",
    );
  }

  const visibleArtist = uniqueClassText(html, "p", "desc--artist", "artist-identity-mismatch");
  const hiddenArtist = uniqueInputValue(html, "isrc_goods_artistname", "artist-identity-mismatch");
  if (
    exactIdentity(visibleArtist) !== exactIdentity(EXPECTED_ARTIST) ||
    exactIdentity(hiddenArtist) !== exactIdentity(EXPECTED_ARTIST)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "artist-identity-mismatch",
      false,
      "The King Records page did not uniquely identify 中山美穂 as the carrier artist.",
    );
  }
  if (
    pageTitles.length !== 1 ||
    exactIdentity(pageTitles[0] ?? "") !== exactIdentity(EXPECTED_PAGE_TITLE)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "title-mismatch",
      false,
      "The King Records document title did not identify the exact artist and carrier tuple.",
    );
  }

  const visibleDate = uniqueClassText(html, "p", "desc--date", "date-mismatch");
  const hiddenDate = uniqueInputValue(html, "isrc_goods_release_dt", "date-mismatch");
  if (visibleDate !== EXPECTED_DISPLAY_DATE || hiddenDate !== EXPECTED_HIDDEN_DATE) {
    throw new MihoNakayamaCarrierSourceFailure(
      "date-mismatch",
      false,
      "The King Records page did not identify the exact 2020-12-23 carrier date.",
    );
  }

  const visibleType = uniqueClassText(html, "p", "desc--type", "disc-count-mismatch");
  if (exactIdentity(visibleType) !== "CDアルバム | ブルーレイディスク") {
    throw new MihoNakayamaCarrierSourceFailure(
      "disc-count-mismatch",
      false,
      "The King Records product type did not identify the fixed CD/Blu-ray edition.",
    );
  }

  const formInfo = uniqueClassText(html, "p", "form--info", "catalog-mismatch");
  const catalogNumbers = [...formInfo.matchAll(/KICS-\d+(?:[～〜-]\d+)?/gu)]
    .map((match) => match[0]);
  if (catalogNumbers.length !== 1 || catalogNumbers[0] !== EXPECTED_CATALOG) {
    throw new MihoNakayamaCarrierSourceFailure(
      "catalog-mismatch",
      false,
      "The King Records page did not identify the exact KICS-93968～70 catalog range.",
    );
  }

  const details = elementsWithClass(html, "div", "text--block");
  if (details.length !== 1) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-list-invalid",
      false,
      "The King Records product detail block was missing or ambiguous.",
    );
  }
  const tracks = parseTracks(details[0]!);
  const manifestCarrierWorks = matchManifestCarrierWorks(tracks);
  return {
    provider: "king-records-japan",
    sourceType: "official-record-label-product-page",
    evidenceRole: "PHYSICAL_CD_CARRIER",
    scope: "CONTAINER_EDITION",
    matchLevel: "EDITION_EXACT",
    unique: true,
    artist: EXPECTED_ARTIST,
    title: EXPECTED_TITLE,
    releaseDate: EXPECTED_RELEASE_DATE,
    catalogNumber: EXPECTED_CATALOG,
    country: "JP",
    format: "CD",
    cdDiscCount: 3,
    trackCount: EXPECTED_TRACK_COUNT,
    tracks,
    manifestCarrierWorks,
    matchedFields: [
      "artist",
      "title",
      "releaseDate",
      "catalogNumber",
      "discCount",
      "trackCount",
      "trackList",
    ],
    sourceUrl: MIHO_NAKAYAMA_KING_CARRIER_URL,
    retrievalUrl: MIHO_NAKAYAMA_KING_CARRIER_URL,
    workCover: null,
    coverInheritanceAllowed: false,
  };
}

export function parseMihoNakayamaMellowCdPage(
  html: string,
  sourceUrl = MIHO_NAKAYAMA_MELLOW_CD_URL,
): MihoNakayamaMellowCdEditionFacts {
  requireMellowSourceUrl(sourceUrl);
  const responseBytes = typeof html === "string"
    ? new TextEncoder().encode(html).byteLength
    : 0;
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    responseBytes > HARD_MAX_RESPONSE_BYTES ||
    !/<html\b/i.test(html) ||
    !/<\/html\s*>/i.test(html)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      responseBytes > HARD_MAX_RESPONSE_BYTES ? "response-too-large" : "invalid-html",
      false,
      "The fixed King Records Mellow response was not bounded HTML.",
    );
  }
  requireFixedCanonicalUrl(html, MIHO_NAKAYAMA_MELLOW_CD_URL);

  const pageTitles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)]
    .map((match) => stripTags(match[1] ?? ""));
  const visibleTitle = uniqueClassText(html, "h3", "desc--title", "title-mismatch");
  const hiddenTitle = uniqueInputValue(html, "isrc_goods_name", "title-mismatch");
  if (visibleTitle !== "Mellow" || hiddenTitle !== "Mellow") {
    throw new MihoNakayamaCarrierSourceFailure(
      "title-mismatch",
      false,
      "The King Records page did not uniquely identify the Mellow CD edition.",
    );
  }

  const visibleArtist = uniqueClassText(html, "p", "desc--artist", "artist-identity-mismatch");
  const hiddenArtist = uniqueInputValue(html, "isrc_goods_artistname", "artist-identity-mismatch");
  if (
    exactIdentity(visibleArtist) !== exactIdentity(EXPECTED_ARTIST) ||
    exactIdentity(hiddenArtist) !== exactIdentity(EXPECTED_ARTIST)
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "artist-identity-mismatch",
      false,
      "The King Records Mellow page did not uniquely identify 中山美穂.",
    );
  }
  if (
    pageTitles.length !== 1 ||
    exactIdentity(pageTitles[0] ?? "") !==
      exactIdentity("Mellow | 中山美穂 | キングレコードオフィシャルサイト")
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "title-mismatch",
      false,
      "The King Records document title did not identify the exact Mellow artist tuple.",
    );
  }

  const visibleDate = uniqueClassText(html, "p", "desc--date", "date-mismatch");
  const hiddenDate = uniqueInputValue(html, "isrc_goods_release_dt", "date-mismatch");
  if (visibleDate !== "2015/10/14" || hiddenDate !== "2015-10-14 00:00:00") {
    throw new MihoNakayamaCarrierSourceFailure(
      "date-mismatch",
      false,
      "The King Records Mellow page did not identify the exact 2015-10-14 edition date.",
    );
  }

  const visibleType = uniqueClassText(html, "p", "desc--type", "disc-count-mismatch");
  const hiddenType = uniqueInputValue(html, "isrc_goods_disc", "disc-count-mismatch");
  if (visibleType !== "CDアルバム" || hiddenType !== "CDアルバム") {
    throw new MihoNakayamaCarrierSourceFailure(
      "disc-count-mismatch",
      false,
      "The King Records Mellow page did not identify one CD album edition.",
    );
  }

  const formInfo = uniqueClassText(html, "p", "form--info", "catalog-mismatch");
  const catalogNumbers = [...formInfo.matchAll(/KICS-\d+(?:[～〜-]\d+)?/gu)]
    .map((match) => match[0]);
  if (catalogNumbers.length !== 1 || catalogNumbers[0] !== "KICS-3274") {
    throw new MihoNakayamaCarrierSourceFailure(
      "catalog-mismatch",
      false,
      "The King Records Mellow page did not identify the exact KICS-3274 catalog number.",
    );
  }

  const trackHeading = uniqueClassText(html, "h5", "text--head", "track-list-invalid");
  if (trackHeading !== "収録内容") {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-list-invalid",
      false,
      "The King Records Mellow page did not expose its fixed track-list heading.",
    );
  }
  const discHeaders = [...decodeHtmlEntities(html).matchAll(/【DISC(\d+)\s+CDアルバム】/gu)]
    .map((match) => Number(match[1]));
  if (discHeaders.length !== 1 || discHeaders[0] !== 1) {
    throw new MihoNakayamaCarrierSourceFailure(
      "disc-count-mismatch",
      false,
      "The King Records Mellow page did not contain exactly one DISC1 CD-album list.",
    );
  }

  const rawTracks = elementsWithClass(html, "div", "track_title_").map(stripTags);
  if (rawTracks.length !== MELLOW_EXPECTED_TRACKS.length) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-count-mismatch",
      false,
      "The King Records Mellow page did not contain exactly 11 track rows.",
    );
  }
  const tracks = rawTracks.map((rawTrack, index): MihoNakayamaMellowCdTrack => {
    const parsed = rawTrack.match(/^(\d+)\.(.+)$/u);
    if (!parsed || Number(parsed[1]) !== index + 1 || !parsed[2]?.trim()) {
      throw new MihoNakayamaCarrierSourceFailure(
        "track-list-invalid",
        false,
        "The King Records Mellow track positions were incomplete or out of order.",
      );
    }
    return {
      position: index + 1,
      title: exactIdentity(parsed[2]),
    };
  });
  const observedTitles = tracks.map((track) => track.title);
  if (
    new Set(observedTitles).size !== observedTitles.length ||
    observedTitles.some((title, index) => title !== MELLOW_EXPECTED_TRACKS[index])
  ) {
    throw new MihoNakayamaCarrierSourceFailure(
      "track-title-mismatch",
      false,
      "The King Records Mellow page did not contain the unique ordered 11-track list.",
    );
  }

  return {
    provider: "king-records-japan",
    sourceType: "official-record-label-product-page",
    evidenceRole: "PHYSICAL_CD_EDITION",
    scope: "SAME_WORK_EDITION",
    matchLevel: "EDITION_EXACT",
    representationKind: "SAME_WORK_EDITION",
    unique: true,
    artist: EXPECTED_ARTIST,
    workTitle: "Mellow",
    editionTitle: "Mellow",
    originalReleaseDate: "1992-06-10",
    editionReleaseDate: "2015-10-14",
    catalogNumber: "KICS-3274",
    country: "JP",
    format: "CD",
    isReissue: true,
    cdDiscCount: 1,
    trackCount: 11,
    tracks,
    matchedFields: [
      "artist",
      "title",
      "editionReleaseDate",
      "catalogNumber",
      "format",
      "trackList",
    ],
    sourceUrl: MIHO_NAKAYAMA_MELLOW_CD_URL,
    retrievalUrl: MIHO_NAKAYAMA_MELLOW_CD_URL,
    workCover: null,
    coverInheritanceAllowed: false,
  };
}

async function readLimitedText(response: Response) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > HARD_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new MihoNakayamaCarrierSourceFailure(
      "response-too-large",
      false,
      "The King Records carrier response exceeded its fixed byte limit.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > HARD_MAX_RESPONSE_BYTES) {
        throw new MihoNakayamaCarrierSourceFailure(
          "response-too-large",
          false,
          "The King Records carrier response exceeded its fixed byte limit.",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof MihoNakayamaCarrierSourceFailure) throw error;
    throw new MihoNakayamaCarrierSourceFailure(
      "invalid-html",
      false,
      "The King Records carrier response was not valid UTF-8 HTML.",
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The response body may already be closed.
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
    return Math.min(10_000, Math.max(0, Math.round(Number(raw) * 1_000)));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.min(10_000, Math.max(0, timestamp - now()))
    : null;
}

function sourceFailure(error: unknown) {
  return error instanceof MihoNakayamaCarrierSourceFailure
    ? error
    : new MihoNakayamaCarrierSourceFailure(
        "network-unavailable",
        true,
        "The King Records carrier request failed.",
      );
}

export class MihoNakayamaKingCarrierClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly cacheTtlMs: number;
  private cachedCompleteResult: {
    expiresAt: number;
    value: MihoNakayamaKingCarrierResult & { complete: true };
  } | null = null;
  private inFlightLoad: Promise<MihoNakayamaKingCarrierResult> | null = null;

  constructor(options: MihoNakayamaCarrierClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
    this.cacheTtlMs = clampInteger(
      options.cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      0,
      HARD_MAX_CACHE_TTL_MS,
    );
  }

  private async resolveKingHost(stats: MihoNakayamaCarrierStats) {
    let resolution = await resolvePublicOfficialHost(KING_HOSTNAME, this.resolveHost);
    for (
      let attempt = 0;
      !resolution.ok && resolution.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      stats.retries += 1;
      await this.sleep(Math.min(2_000, 250 * 2 ** attempt));
      resolution = await resolvePublicOfficialHost(KING_HOSTNAME, this.resolveHost);
    }
    if (!resolution.ok) {
      throw new MihoNakayamaCarrierSourceFailure(
        resolution.reason,
        resolution.reason === "dns-resolution-failed",
        "The fixed King Records host did not resolve exclusively to public addresses.",
      );
    }
  }

  private async requestOnce(stats: MihoNakayamaCarrierStats) {
    requireFixedSourceUrl(MIHO_NAKAYAMA_KING_CARRIER_URL);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(MIHO_NAKAYAMA_KING_CARRIER_URL, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "Accept-Language": "ja",
          "User-Agent": "CD-BOX/1.0 Miho-Nakayama-King-carrier-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new MihoNakayamaCarrierSourceFailure(
          "invalid-source-url",
          false,
          "The fixed King Records carrier page attempted a redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        const failure = new MihoNakayamaCarrierSourceFailure(
          "http-status",
          retryableStatus(response.status),
          `The fixed King Records carrier page returned HTTP ${response.status}.`,
        );
        Object.assign(failure, { retryAfterMs: delay });
        throw failure;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml")
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new MihoNakayamaCarrierSourceFailure(
          "unsupported-content-type",
          false,
          "The fixed King Records carrier page returned a non-HTML content type.",
        );
      }
      const html = await readLimitedText(response);
      stats.responsesFetched += 1;
      return html;
    } catch (error) {
      if (error instanceof MihoNakayamaCarrierSourceFailure) throw error;
      if (controller.signal.aborted) {
        throw new MihoNakayamaCarrierSourceFailure(
          "network-timeout",
          true,
          "The fixed King Records carrier request timed out.",
        );
      }
      throw new MihoNakayamaCarrierSourceFailure(
        "network-unavailable",
        true,
        "The fixed King Records carrier request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(stats: MihoNakayamaCarrierStats) {
    let lastFailure: MihoNakayamaCarrierSourceFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestOnce(stats);
      } catch (error) {
        const failure = sourceFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        const retryAfter = (failure as MihoNakayamaCarrierSourceFailure & {
          retryAfterMs?: number | null;
        }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastFailure ?? new MihoNakayamaCarrierSourceFailure(
      "network-unavailable",
      true,
      "The fixed King Records carrier request failed.",
    );
  }

  private async loadUncached(): Promise<MihoNakayamaKingCarrierResult> {
    const stats = freshStats();
    try {
      await this.resolveKingHost(stats);
      const html = await this.request(stats);
      const carrier = parseMihoNakayamaKingCarrierPage(html);
      stats.sourcesParsed += 1;
      return {
        status: "VERIFIED",
        complete: true,
        unique: true,
        carrier,
        warnings: [],
        stats,
      };
    } catch (error) {
      const failure = sourceFailure(error);
      return {
        status: "SOURCE_INCOMPLETE",
        complete: false,
        unique: false,
        carrier: null,
        warnings: [{
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          url: MIHO_NAKAYAMA_KING_CARRIER_URL,
        }],
        stats,
      };
    }
  }

  load(): Promise<MihoNakayamaKingCarrierResult> {
    if (this.cachedCompleteResult) {
      if (this.cachedCompleteResult.expiresAt > this.now()) {
        const value = this.cachedCompleteResult.value;
        return Promise.resolve({
          ...value,
          stats: { ...value.stats, cacheHits: value.stats.cacheHits + 1 },
        });
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
}

export class MihoNakayamaMellowCdClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly cacheTtlMs: number;
  private cachedCompleteResult: {
    expiresAt: number;
    value: MihoNakayamaMellowCdResult & { complete: true };
  } | null = null;
  private inFlightLoad: Promise<MihoNakayamaMellowCdResult> | null = null;

  constructor(options: MihoNakayamaCarrierClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
    this.cacheTtlMs = clampInteger(
      options.cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      0,
      HARD_MAX_CACHE_TTL_MS,
    );
  }

  private async resolveKingHost(stats: MihoNakayamaCarrierStats) {
    let resolution = await resolvePublicOfficialHost(KING_HOSTNAME, this.resolveHost);
    for (
      let attempt = 0;
      !resolution.ok && resolution.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      stats.retries += 1;
      await this.sleep(Math.min(2_000, 250 * 2 ** attempt));
      resolution = await resolvePublicOfficialHost(KING_HOSTNAME, this.resolveHost);
    }
    if (!resolution.ok) {
      throw new MihoNakayamaCarrierSourceFailure(
        resolution.reason,
        resolution.reason === "dns-resolution-failed",
        "The fixed King Records Mellow host did not resolve exclusively to public addresses.",
      );
    }
  }

  private async requestOnce(stats: MihoNakayamaCarrierStats) {
    requireMellowSourceUrl(MIHO_NAKAYAMA_MELLOW_CD_URL);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(MIHO_NAKAYAMA_MELLOW_CD_URL, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "Accept-Language": "ja",
          "User-Agent": "CD-BOX/1.0 Miho-Nakayama-Mellow-CD-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new MihoNakayamaCarrierSourceFailure(
          "invalid-source-url",
          false,
          "The fixed King Records Mellow page attempted a redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        const failure = new MihoNakayamaCarrierSourceFailure(
          "http-status",
          retryableStatus(response.status),
          `The fixed King Records Mellow page returned HTTP ${response.status}.`,
        );
        Object.assign(failure, { retryAfterMs: delay });
        throw failure;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml")
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new MihoNakayamaCarrierSourceFailure(
          "unsupported-content-type",
          false,
          "The fixed King Records Mellow page returned a non-HTML content type.",
        );
      }
      const html = await readLimitedText(response);
      stats.responsesFetched += 1;
      return html;
    } catch (error) {
      if (error instanceof MihoNakayamaCarrierSourceFailure) throw error;
      if (controller.signal.aborted) {
        throw new MihoNakayamaCarrierSourceFailure(
          "network-timeout",
          true,
          "The fixed King Records Mellow request timed out.",
        );
      }
      throw new MihoNakayamaCarrierSourceFailure(
        "network-unavailable",
        true,
        "The fixed King Records Mellow request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(stats: MihoNakayamaCarrierStats) {
    let lastFailure: MihoNakayamaCarrierSourceFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestOnce(stats);
      } catch (error) {
        const failure = sourceFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        const retryAfter = (failure as MihoNakayamaCarrierSourceFailure & {
          retryAfterMs?: number | null;
        }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastFailure ?? new MihoNakayamaCarrierSourceFailure(
      "network-unavailable",
      true,
      "The fixed King Records Mellow request failed.",
    );
  }

  private async loadUncached(): Promise<MihoNakayamaMellowCdResult> {
    const stats = freshStats();
    try {
      await this.resolveKingHost(stats);
      const html = await this.request(stats);
      const edition = parseMihoNakayamaMellowCdPage(html);
      stats.sourcesParsed += 1;
      return {
        status: "VERIFIED",
        complete: true,
        unique: true,
        edition,
        warnings: [],
        stats,
      };
    } catch (error) {
      const failure = sourceFailure(error);
      return {
        status: "SOURCE_INCOMPLETE",
        complete: false,
        unique: false,
        edition: null,
        warnings: [{
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          url: MIHO_NAKAYAMA_MELLOW_CD_URL,
        }],
        stats,
      };
    }
  }

  load(): Promise<MihoNakayamaMellowCdResult> {
    if (this.cachedCompleteResult) {
      if (this.cachedCompleteResult.expiresAt > this.now()) {
        const value = this.cachedCompleteResult.value;
        return Promise.resolve({
          ...value,
          stats: { ...value.stats, cacheHits: value.stats.cacheHits + 1 },
        });
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
}
