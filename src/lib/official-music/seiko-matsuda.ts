import "server-only";

import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";
import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
} from "@/lib/official-music/url-policy";

export const SEIKO_MATSUDA_OFFICIAL_ORIGIN = "https://www.seikomatsuda.co.jp";

export const SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS = {
  "SINGLE:22": "https://www.seikomatsuda.co.jp/discography/detail/43",
  "SINGLE:29": "https://www.seikomatsuda.co.jp/discography/detail/69",
  "SINGLE:71": "https://www.seikomatsuda.co.jp/discography/detail/244",
  "ORIGINAL_ALBUM:29": "https://www.seikomatsuda.co.jp/discography/detail/115",
  "ORIGINAL_ALBUM:35": "https://www.seikomatsuda.co.jp/discography/detail/152",
} as const;

export const SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS = {
  "DANCING_NDL": "https://ndlsearch.ndl.go.jp/books/R100000002-I000008815159",
  "WHOS_NDL": "https://ndlsearch.ndl.go.jp/books/R100000002-I000010906601",
  "WHOS_SONY_BOX": "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
} as const;

export type SeikoMatsudaOfficialWorkKey = keyof typeof SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS;
export type SeikoMatsudaExternalEvidenceKey = keyof typeof SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS;
export type SeikoMatsudaOfficialSourceCategory = "SINGLE" | "ALBUM";
export type SeikoMatsudaOfficialDateKind = "ORIGINAL_RELEASE" | "UNRESOLVED";

export type SeikoMatsudaOfficialTrack = {
  position: number;
  title: string;
  duration: string;
};

export type SeikoMatsudaOfficialCoverEvidence = {
  provider: "seiko-matsuda-official";
  scope: "WORK";
  matchLevel: "WORK_EXACT";
  url: string;
  sourceUrl: string;
  observedAlt: string;
  requiresAssetValidation: true;
};

export type SeikoMatsudaDeclaredConflictClaim = {
  provider: "musicbrainz" | "discogs";
  field: "category" | "date";
  value: string;
  sourceUrl: string;
  fetchedByThisAdapter: false;
  evidenceRole: "DECLARED_CONFLICT_ONLY";
};

export type SeikoMatsudaTaxonomyConflict = {
  status: "UNRESOLVED";
  manifestCategory: "ORIGINAL_ALBUM";
  officialObservedCategory: "ALBUM";
  competingClaims: SeikoMatsudaDeclaredConflictClaim[];
  resolution: null;
};

export type SeikoMatsudaDateConflict = {
  status: "UNRESOLVED";
  manifestDate: "2002-06-21";
  officialObservedDate: "2002-06-21";
  competingClaims: SeikoMatsudaDeclaredConflictClaim[];
  resolution: null;
};

export type SeikoMatsudaOptionalExternalSourceCandidate = {
  provider: "sony-music-japan" | "national-diet-library";
  sourceUrl: string;
  fetchedByThisAdapter: false;
  evidence: null;
};

export type SeikoMatsudaExternalProvenance = {
  provider: "national-diet-library" | "sony-music-japan";
  sourceType: "national-bibliography-record" | "official-record-label-box-page";
  sourceUrl: string;
  retrievalUrl: string;
  fixedRecordId: string | null;
  fetchedByThisAdapter: true;
};

export type SeikoMatsudaNdlEvidence = {
  evidenceKey: "DANCING_NDL" | "WHOS_NDL";
  workKey: "SINGLE:22" | "SINGLE:29";
  observedArtist: string | null;
  rawArtist: string;
  artistStatus: "VERIFIED" | "SOURCE_NOT_PROVIDED";
  observedTitle: string;
  observedCatalogNumber: string;
  observedDate: string | null;
  rawDate: string;
  datePrecision: "MONTH" | "UNKNOWN";
  dateStatus: "VERIFIED" | "SOURCE_NOT_PROVIDED";
  carrier: "ANALOG_LP" | "BLU_SPEC_CD";
  verifiedFields: Array<"artist" | "title" | "catalogNumber" | "date" | "carrier">;
  missingFields: Array<"artist" | "date">;
  provenance: SeikoMatsudaExternalProvenance;
};

export type SeikoMatsudaSonyBoxEvidence = {
  evidenceKey: "WHOS_SONY_BOX";
  workKey: "SINGLE:29";
  observedArtist: "松田聖子";
  observedArtistCredit: "SEIKO";
  observedWorkTitle: "WHO’S THAT BOY";
  observedBoxTitle: "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～";
  observedBoxReleaseDate: "2010-05-26";
  observedCatalogDisplay: "SRCL20061-133";
  observedCatalogRange: {
    start: "SRCL-20061";
    end: "SRCL-20133";
  };
  completeSinglesCount: 73;
  cdDiscCount: 73;
  carrier: "BLU_SPEC_CD";
  overseasSingles: [
    "ALL WAY TO THE HEAVEN",
    "WHO’S THAT BOY",
    "LET’S TALK ABOUT IT",
    "GOOD FOR YOU",
    "all to you",
    "just for tonight",
  ];
  publishedDate: "2010-04-03";
  verifiedFields: Array<
    "artist" | "artistCredit" | "title" | "boxCompleteness" | "date" | "catalogRange" | "carrier"
  >;
  provenance: SeikoMatsudaExternalProvenance;
};

export type SeikoMatsudaExternalEvidence =
  | SeikoMatsudaNdlEvidence
  | SeikoMatsudaSonyBoxEvidence;

export type SeikoMatsudaExternalEvidenceOutcome =
  | {
      status: "VERIFIED";
      verified: true;
      unique: true;
      evidence: SeikoMatsudaExternalEvidence;
      limitations: [];
      warning: null;
    }
  | {
      status: "PARTIAL";
      verified: false;
      unique: true;
      evidence: SeikoMatsudaNdlEvidence;
      limitations: ["ARTIST_NOT_PROVIDED", "DATE_UNKNOWN"];
      warning: null;
    }
  | {
      status: "FAILED";
      verified: false;
      unique: false;
      evidence: null;
      limitations: [];
      warning: SeikoMatsudaOfficialWarning;
    };

export type SeikoMatsudaExternalEvidenceResult = {
  status: "NOT_REQUESTED" | "SOURCE_SET_COMPLETE" | "SOURCE_INCOMPLETE";
  requested: boolean;
  sources: Partial<Record<SeikoMatsudaExternalEvidenceKey, SeikoMatsudaExternalEvidenceOutcome>>;
  verifiedCount: number;
  uniqueCount: number;
  warnings: SeikoMatsudaOfficialWarning[];
  stats: {
    requestsAttempted: number;
    responsesFetched: number;
    retries: number;
    sourcesParsed: number;
  };
};

export type SeikoMatsudaOfficialEntity = {
  manifestEntryKey: SeikoMatsudaOfficialWorkKey;
  sourceUrl: string;
  provider: "seiko-matsuda-official";
  sourceType: "official-artist-entity-page";
  evidenceScope: "single-item-page";
  observedArtist: "松田聖子";
  observedTitle: string;
  observedCategory: SeikoMatsudaOfficialSourceCategory;
  manifestCategory: "SINGLE" | "ORIGINAL_ALBUM";
  observedReleaseDate: string;
  observedDateKind: SeikoMatsudaOfficialDateKind;
  observedCatalogDisplay: string;
  observedCatalogNumbers: string[];
  tracks: SeikoMatsudaOfficialTrack[];
  identityTrackTitles: string[];
  cover: SeikoMatsudaOfficialCoverEvidence;
  conflicts: {
    taxonomy: SeikoMatsudaTaxonomyConflict | null;
    date: SeikoMatsudaDateConflict | null;
  };
  optionalExternalEvidence: {
    status: "NOT_FETCHED_BY_ENTITY_PAGE";
    independentlyCorroborated: false;
    verifiedEvidence: [];
    candidates: SeikoMatsudaOptionalExternalSourceCandidate[];
  } | null;
};

export type SeikoMatsudaOfficialFailureCode =
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-source-url"
  | "invalid-html"
  | "artist-identity-mismatch"
  | "title-mismatch"
  | "category-mismatch"
  | "date-mismatch"
  | "catalog-mismatch"
  | "track-boundary-mismatch"
  | "cover-url-invalid"
  | "cover-title-mismatch"
  | "external-provenance-invalid"
  | "external-record-id-mismatch"
  | "external-artist-mismatch"
  | "external-title-mismatch"
  | "external-catalog-mismatch"
  | "external-date-mismatch"
  | "external-claim-mismatch"
  | "incomplete-fixed-set";

export type SeikoMatsudaOfficialWarning = {
  code: SeikoMatsudaOfficialFailureCode;
  message: string;
  retryable: boolean;
  workKey?: SeikoMatsudaOfficialWorkKey;
  url?: string;
};

export type SeikoMatsudaOfficialSourceResult = {
  workKey: SeikoMatsudaOfficialWorkKey;
  url: string;
  status: "COMPLETE" | "FAILED";
  failureCode: SeikoMatsudaOfficialFailureCode | null;
  message: string | null;
};

export type SeikoMatsudaOfficialResult = {
  status: "FIXED_SET_COMPLETE" | "SOURCE_INCOMPLETE";
  complete: boolean;
  works: SeikoMatsudaOfficialEntity[];
  byManifestEntryKey: Partial<Record<SeikoMatsudaOfficialWorkKey, SeikoMatsudaOfficialEntity>>;
  sourceResults: SeikoMatsudaOfficialSourceResult[];
  warnings: SeikoMatsudaOfficialWarning[];
  externalEvidence: SeikoMatsudaExternalEvidenceResult;
  stats: {
    requestsAttempted: number;
    responsesFetched: number;
    retries: number;
    pagesParsed: number;
    coverUrlsParsed: number;
  };
};

export type SeikoMatsudaOfficialClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  concurrency?: number;
  includeExternalEvidence?: boolean;
};

type FixedTrack = readonly [title: string, duration: string];

type FixedWorkSpec = {
  workKey: SeikoMatsudaOfficialWorkKey;
  sourceUrl: string;
  title: string;
  sourceCategory: SeikoMatsudaOfficialSourceCategory;
  sourceCategoryLabel: "シングル" | "アルバム";
  activeCategoryPath: "/discography/single" | "/discography/album";
  manifestCategory: "SINGLE" | "ORIGINAL_ALBUM";
  releaseDate: string;
  dateKind: SeikoMatsudaOfficialDateKind;
  catalogDisplay: string;
  catalogNumbers: readonly string[];
  tracks: readonly FixedTrack[];
  identityTrackTitles: readonly string[];
  coverPath: string;
};

type ExternalRequestSpec = {
  evidenceKey: SeikoMatsudaExternalEvidenceKey;
  url: string;
  hostname: "ndlsearch.ndl.go.jp" | "www.sonymusic.co.jp";
  maximumBytes: number;
};

const OFFICIAL_HOSTNAME = "www.seikomatsuda.co.jp";
const NDL_HOSTNAME = "ndlsearch.ndl.go.jp";
const SONY_HOSTNAME = "www.sonymusic.co.jp";
const NDL_ORIGIN = "https://ndlsearch.ndl.go.jp";
const SONY_ORIGIN = "https://www.sonymusic.co.jp";
const OFFICIAL_PAGE_TITLE = "ディスコグラフィ|松田聖子オフィシャルサイト";
const OFFICIAL_ARTIST = "松田聖子";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_CONCURRENCY = 2;
const HARD_MAX_RESPONSE_BYTES = 512 * 1024;
const HARD_MAX_NDL_RESPONSE_BYTES = 512 * 1024;
const HARD_MAX_SONY_RESPONSE_BYTES = 256 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const EXTERNAL_REQUESTS = [
  {
    evidenceKey: "DANCING_NDL",
    url: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL,
    hostname: NDL_HOSTNAME,
    maximumBytes: HARD_MAX_NDL_RESPONSE_BYTES,
  },
  {
    evidenceKey: "WHOS_NDL",
    url: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL,
    hostname: NDL_HOSTNAME,
    maximumBytes: HARD_MAX_NDL_RESPONSE_BYTES,
  },
  {
    evidenceKey: "WHOS_SONY_BOX",
    url: SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX,
    hostname: SONY_HOSTNAME,
    maximumBytes: HARD_MAX_SONY_RESPONSE_BYTES,
  },
] as const satisfies readonly ExternalRequestSpec[];

const FIXED_WORKS = [
  {
    workKey: "SINGLE:22",
    sourceUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:22"],
    title: "DANCING SHOES (Club Mix)",
    sourceCategory: "SINGLE",
    sourceCategoryLabel: "シングル",
    activeCategoryPath: "/discography/single",
    manifestCategory: "SINGLE",
    releaseDate: "1985-06-24",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "12AH-1896",
    catalogNumbers: ["12AH-1896"],
    tracks: [
      ["DANCING SHOES(Club Mix)", "5:52"],
      ["DANCING SHOES(Instrumental)", "4:03"],
      ["CRAZY ME, CRAZY FOR YOU", "4:13"],
    ],
    identityTrackTitles: ["DANCING SHOES(Club Mix)", "CRAZY ME, CRAZY FOR YOU"],
    coverPath: "/discography/images/upload/1985-3_Artwork19850624-112-0001.gif",
  },
  {
    workKey: "SINGLE:29",
    sourceUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:29"],
    title: "Who's that boy",
    sourceCategory: "SINGLE",
    sourceCategoryLabel: "シングル",
    activeCategoryPath: "/discography/single",
    manifestCategory: "SINGLE",
    releaseDate: "1990-10-01",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "73523",
    catalogNumbers: ["73523"],
    tracks: [
      ["Who's that boy", "4:42"],
      ["He's so good to me", "4:14"],
    ],
    identityTrackTitles: ["Who's that boy", "He's so good to me"],
    coverPath: "/discography/images/upload/1990-4_Artwork19901001-112-0001.gif",
  },
  {
    workKey: "SINGLE:71",
    sourceUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["SINGLE:71"],
    title: "特別な恋人/声だけ聞かせて",
    sourceCategory: "SINGLE",
    sourceCategoryLabel: "シングル",
    activeCategoryPath: "/discography/single",
    manifestCategory: "SINGLE",
    releaseDate: "2011-11-23",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "UMCK-5355",
    catalogNumbers: ["UMCK-5355"],
    tracks: [
      ["特別な恋人", "4:56"],
      ["声だけ聞かせて", "4:23"],
      ["特別な恋人 (Instrumental)", "4:55"],
      ["声だけ聞かせて (Instrumental)", "4:22"],
    ],
    identityTrackTitles: ["特別な恋人", "声だけ聞かせて"],
    coverPath: "/discography/images/upload/2011-4_Artwork20111123-112-0001.jpg",
  },
  {
    workKey: "ORIGINAL_ALBUM:29",
    sourceUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["ORIGINAL_ALBUM:29"],
    title: "Sweetest Time",
    sourceCategory: "ALBUM",
    sourceCategoryLabel: "アルバム",
    activeCategoryPath: "/discography/album",
    manifestCategory: "ORIGINAL_ALBUM",
    releaseDate: "1997-12-03",
    dateKind: "ORIGINAL_RELEASE",
    catalogDisplay: "PHCL-12",
    catalogNumbers: ["PHCL-12"],
    tracks: [
      ["Gone with the rain", "4:43"],
      ["Why say goodbye", "5:33"],
      ["KissしてX'mas", "4:58"],
      ["Gone with the rain (English Version)", "4:42"],
      ["Why say Goodbye (English Version)", "5:33"],
      ["あなたに逢いたくて ～Missing You～ (Engllish Version)", "5:33"],
    ],
    identityTrackTitles: [
      "Gone with the rain",
      "Why say goodbye",
      "KissしてX'mas",
      "Gone with the rain (English Version)",
      "Why say Goodbye (English Version)",
      "あなたに逢いたくて ～Missing You～ (Engllish Version)",
    ],
    coverPath: "/discography/images/upload/1997-1_Artwork19971203-111-0001.gif",
  },
  {
    workKey: "ORIGINAL_ALBUM:35",
    sourceUrl: SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS["ORIGINAL_ALBUM:35"],
    title: "area62",
    sourceCategory: "ALBUM",
    sourceCategoryLabel: "アルバム",
    activeCategoryPath: "/discography/album",
    manifestCategory: "ORIGINAL_ALBUM",
    releaseDate: "2002-06-21",
    dateKind: "UNRESOLVED",
    catalogDisplay: "VIVI-19623/TGCS-1439",
    catalogNumbers: ["VIVI-19623", "TGCS-1439"],
    tracks: [
      ["all to you", "4:22"],
      ["just for tonight", "3:57"],
      ["I'm right here", "4:17"],
      ["never need another", "4:12"],
      ["let's fall in love again", "4:27"],
      ["everything I am", "4:00"],
      ["chameleon", "3:40"],
      ["downtown tokyo", "4:00"],
      ["ave maria", "3:41"],
      ["downtown tokyo (Japanese)", "3:59"],
      ["all to you (Japanese)", "4:22"],
      ["all to you (remix 4-5)", "5:06"],
      ["ave maria (wavemix)", "4:06"],
    ],
    identityTrackTitles: [
      "all to you",
      "just for tonight",
      "I'm right here",
      "never need another",
      "let's fall in love again",
      "everything I am",
      "chameleon",
      "downtown tokyo",
      "ave maria",
      "downtown tokyo (Japanese)",
      "all to you (Japanese)",
      "all to you (remix 4-5)",
      "ave maria (wavemix)",
    ],
    coverPath: "/discography/images/upload/2002-1_Artwork20020621-111-0001.gif",
  },
] as const satisfies readonly FixedWorkSpec[];

type MutableStats = SeikoMatsudaOfficialResult["stats"];

export class SeikoMatsudaOfficialSourceFailure extends Error {
  constructor(
    readonly code: SeikoMatsudaOfficialFailureCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "SeikoMatsudaOfficialSourceFailure";
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
    pagesParsed: 0,
    coverUrlsParsed: 0,
  };
}

function freshExternalStats(): SeikoMatsudaExternalEvidenceResult["stats"] {
  return {
    requestsAttempted: 0,
    responsesFetched: 0,
    retries: 0,
    sourcesParsed: 0,
  };
}

function externalEvidenceNotRequested(): SeikoMatsudaExternalEvidenceResult {
  return {
    status: "NOT_REQUESTED",
    requested: false,
    sources: {},
    verifiedCount: 0,
    uniqueCount: 0,
    warnings: [],
    stats: freshExternalStats(),
  };
}

function exactText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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
  return exactText(decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")));
}

function tagAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classTexts(html: string, tagName: string, className: string) {
  const escapedTag = escapedRegExp(tagName);
  const escapedClass = escapedRegExp(className);
  return [...html.matchAll(new RegExp(
    `<${escapedTag}\\b[^>]*class=["'][^"']*\\b${escapedClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${escapedTag}>`,
    "gi",
  ))].map((match) => stripTags(match[1] ?? ""));
}

function uniqueClassText(
  html: string,
  tagName: string,
  className: string,
  failureCode: SeikoMatsudaOfficialFailureCode,
) {
  const values = classTexts(html, tagName, className);
  if (values.length !== 1 || !values[0]) {
    throw new SeikoMatsudaOfficialSourceFailure(
      failureCode,
      false,
      `The official page did not contain exactly one ${className} field.`,
    );
  }
  return values[0];
}

function fullIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseJapaneseReleaseDate(value: string) {
  const match = value.match(/^リリース:(\d{4})年(\d{2})月(\d{2})日$/u);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return fullIsoDate(date) ? date : null;
}

function safeCoverUrl(raw: string, spec: FixedWorkSpec) {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(raw), SEIKO_MATSUDA_OFFICIAL_ORIGIN);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== SEIKO_MATSUDA_OFFICIAL_ORIGIN ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== spec.coverPath
  ) return null;
  return url.toString();
}

function parseActiveCategoryPath(html: string) {
  const paths = [...html.matchAll(/<a\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /(?:^|\s)active(?:\s|$)/u.test(tagAttribute(tag, "class")))
    .map((tag) => tagAttribute(tag, "href"))
    .filter((href) => href === "/discography/single" || href === "/discography/album");
  return paths.length === 1 ? paths[0] : null;
}

function parseTracks(html: string): SeikoMatsudaOfficialTrack[] {
  const tracks: SeikoMatsudaOfficialTrack[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1] ?? "";
    const hasTrackClass = /\b(?:play-no|play-title|play-time)\b/u.test(body);
    if (!hasTrackClass) continue;
    const positionText = uniqueClassText(body, "th", "play-no", "track-boundary-mismatch");
    const title = uniqueClassText(body, "td", "play-title", "track-boundary-mismatch");
    const duration = uniqueClassText(body, "td", "play-time", "track-boundary-mismatch");
    const positionMatch = positionText.match(/^(\d+)\.$/u);
    if (!positionMatch || !/^\d{1,3}:\d{2}$/.test(duration)) {
      throw new SeikoMatsudaOfficialSourceFailure(
        "track-boundary-mismatch",
        false,
        "The official track row did not have an exact position and duration.",
      );
    }
    tracks.push({
      position: Number(positionMatch[1]),
      title,
      duration,
    });
  }
  return tracks;
}

function expectedSpec(workKey: SeikoMatsudaOfficialWorkKey) {
  const spec = FIXED_WORKS.find((item) => item.workKey === workKey);
  if (!spec) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "invalid-source-url",
      false,
      "The requested work key is not in the fixed Seiko Matsuda detail set.",
    );
  }
  return spec;
}

function declaredConflicts(
  spec: FixedWorkSpec,
  observedCategory: SeikoMatsudaOfficialSourceCategory,
  observedDate: string,
): SeikoMatsudaOfficialEntity["conflicts"] {
  if (spec.workKey === "ORIGINAL_ALBUM:29") {
    return {
      taxonomy: {
        status: "UNRESOLVED",
        manifestCategory: "ORIGINAL_ALBUM",
        officialObservedCategory: observedCategory as "ALBUM",
        competingClaims: [
          {
            provider: "musicbrainz",
            field: "category",
            value: "EP",
            sourceUrl: "https://musicbrainz.org/release-group/ca0a9735-b047-4857-8086-6926a5b5c695",
            fetchedByThisAdapter: false,
            evidenceRole: "DECLARED_CONFLICT_ONLY",
          },
          {
            provider: "discogs",
            field: "category",
            value: "Mini-Album",
            sourceUrl: "https://www.discogs.com/release/23001902",
            fetchedByThisAdapter: false,
            evidenceRole: "DECLARED_CONFLICT_ONLY",
          },
        ],
        resolution: null,
      },
      date: null,
    };
  }
  if (spec.workKey === "ORIGINAL_ALBUM:35") {
    return {
      taxonomy: null,
      date: {
        status: "UNRESOLVED",
        manifestDate: "2002-06-21",
        officialObservedDate: observedDate as "2002-06-21",
        competingClaims: [{
          provider: "musicbrainz",
          field: "date",
          value: "2002-06-11",
          sourceUrl: "https://musicbrainz.org/release-group/4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
          fetchedByThisAdapter: false,
          evidenceRole: "DECLARED_CONFLICT_ONLY",
        }],
        resolution: null,
      },
    };
  }
  return { taxonomy: null, date: null };
}

function optionalExternalEvidence(
  spec: FixedWorkSpec,
): SeikoMatsudaOfficialEntity["optionalExternalEvidence"] {
  if (spec.workKey !== "SINGLE:29") return null;
  return {
    status: "NOT_FETCHED_BY_ENTITY_PAGE",
    independentlyCorroborated: false,
    verifiedEvidence: [],
    candidates: [
      {
        provider: "sony-music-japan",
        sourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
        fetchedByThisAdapter: false,
        evidence: null,
      },
      {
        provider: "national-diet-library",
        sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010906601",
        fetchedByThisAdapter: false,
        evidence: null,
      },
    ],
  };
}

function pageTitle(html: string) {
  const heads = [...html.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head>/gi)];
  if (heads.length !== 1) return null;
  const values = [...(heads[0]![1] ?? "").matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)]
    .map((match) => stripTags(match[1] ?? ""));
  return values.length === 1 ? values[0]! : null;
}

function ndlFieldValues(html: string) {
  const fields = new Map<string, string[]>();
  for (const match of html.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>[\s\S]{0,256}?<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    const label = stripTags(match[1] ?? "");
    const value = stripTags(match[2] ?? "");
    if (!label || !value) continue;
    const values = fields.get(label) ?? [];
    values.push(value);
    fields.set(label, values);
  }
  return fields;
}

function oneUniqueFieldValue(
  fields: ReadonlyMap<string, string[]>,
  labels: readonly string[],
  code: SeikoMatsudaOfficialFailureCode,
) {
  const values = labels.flatMap((label) => fields.get(exactText(label)) ?? []);
  const unique = [...new Set(values.map(exactText).filter(Boolean))];
  if (unique.length !== 1) {
    throw new SeikoMatsudaOfficialSourceFailure(
      code,
      false,
      `The fixed external page did not expose one unique ${labels.join("/")} value.`,
    );
  }
  return unique[0]!;
}

function ndlProvenance(
  evidenceKey: "DANCING_NDL" | "WHOS_NDL",
  recordId: string,
): SeikoMatsudaExternalProvenance {
  const sourceUrl = SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS[evidenceKey];
  return {
    provider: "national-diet-library",
    sourceType: "national-bibliography-record",
    sourceUrl,
    retrievalUrl: sourceUrl,
    fixedRecordId: recordId,
    fetchedByThisAdapter: true,
  };
}

function validateNdlShell(
  html: string,
  expectedPageTitle: string,
  expectedBibId: string,
) {
  if (pageTitle(html) !== expectedPageTitle) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-provenance-invalid",
      false,
      "The fixed NDL record did not retain its exact NDL page title and host identity.",
    );
  }
  const fields = ndlFieldValues(html);
  if (
    oneUniqueFieldValue(
      fields,
      ["国立国会図書館書誌ID"],
      "external-record-id-mismatch",
    ) !== expectedBibId ||
    oneUniqueFieldValue(fields, ["資料種別"], "external-provenance-invalid") !== "録音資料"
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-record-id-mismatch",
      false,
      "The fixed NDL page did not expose the exact expected bibliography record.",
    );
  }
  return fields;
}

/** Parses the fixed NDL record without inventing its absent artist or date. */
export function parseSeikoMatsudaDancingNdlEvidence(
  html: string,
): SeikoMatsudaExternalEvidenceOutcome {
  const expectedTitle = "Dancing shoes(Club mix)";
  const recordId = "R100000002-I000008815159";
  const fields = validateNdlShell(
    html,
    `${expectedTitle} | NDLサーチ | 国立国会図書館`,
    "000008815159",
  );
  const title = oneUniqueFieldValue(fields, ["タイトル"], "external-title-mismatch");
  const catalogNumber = oneUniqueFieldValue(
    fields,
    ["発売番号"],
    "external-catalog-mismatch",
  );
  const rawArtist = oneUniqueFieldValue(fields, ["著者"], "external-artist-mismatch");
  const rawDate = oneUniqueFieldValue(
    fields,
    ["出版年", "出版年月日等"],
    "external-date-mismatch",
  );
  const material = oneUniqueFieldValue(
    fields,
    ["形態の詳細"],
    "external-claim-mismatch",
  );
  if (title !== expectedTitle) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-title-mismatch",
      false,
      "The fixed NDL Dancing Shoes title lost the Club mix work identity.",
    );
  }
  if (catalogNumber !== "12AH-1896") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-catalog-mismatch",
      false,
      "The fixed NDL Dancing Shoes record changed catalog number.",
    );
  }
  if (rawArtist !== "-") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-artist-mismatch",
      false,
      "The fixed NDL Dancing Shoes record exposed an unexpected artist value.",
    );
  }
  if (rawDate !== "[19--]") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-date-mismatch",
      false,
      "The fixed NDL Dancing Shoes record no longer has the audited unknown date.",
    );
  }
  if (material !== "アナログ (LP) , 33 1/3rpm") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-claim-mismatch",
      false,
      "The fixed NDL Dancing Shoes record changed its physical carrier boundary.",
    );
  }
  const evidence: SeikoMatsudaNdlEvidence = {
    evidenceKey: "DANCING_NDL",
    workKey: "SINGLE:22",
    observedArtist: null,
    rawArtist,
    artistStatus: "SOURCE_NOT_PROVIDED",
    observedTitle: title,
    observedCatalogNumber: catalogNumber,
    observedDate: null,
    rawDate,
    datePrecision: "UNKNOWN",
    dateStatus: "SOURCE_NOT_PROVIDED",
    carrier: "ANALOG_LP",
    verifiedFields: ["title", "catalogNumber", "carrier"],
    missingFields: ["artist", "date"],
    provenance: ndlProvenance("DANCING_NDL", recordId),
  };
  return {
    status: "PARTIAL",
    verified: false,
    unique: true,
    evidence,
    limitations: ["ARTIST_NOT_PROVIDED", "DATE_UNKNOWN"],
    warning: null,
  };
}

/** Strictly parses the fixed NDL Blu-spec CD entity for Who's that boy. */
export function parseSeikoMatsudaWhosNdlEvidence(
  html: string,
): SeikoMatsudaExternalEvidenceOutcome {
  const expectedTitle = "Who's that boy";
  const recordId = "R100000002-I000010906601";
  const fields = validateNdlShell(
    html,
    "Who's that boy (Thanks 30th anniversary Seiko Matsuda. Seiko Matsuda single collection 30th anniversary box~the voice of a queen~ ; 30) | NDLサーチ | 国立国会図書館",
    "000010906601",
  );
  const title = oneUniqueFieldValue(fields, ["タイトル"], "external-title-mismatch");
  const artist = oneUniqueFieldValue(
    fields,
    ["著者", "著者・編者"],
    "external-artist-mismatch",
  );
  const catalogNumber = oneUniqueFieldValue(
    fields,
    ["発売番号"],
    "external-catalog-mismatch",
  );
  const rawDate = oneUniqueFieldValue(
    fields,
    ["出版年", "出版年月日等"],
    "external-date-mismatch",
  );
  const material = oneUniqueFieldValue(
    fields,
    ["形態の詳細"],
    "external-claim-mismatch",
  );
  const editionNote = oneUniqueFieldValue(
    fields,
    ["別の媒体に関する注記"],
    "external-claim-mismatch",
  );
  if (title !== expectedTitle) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-title-mismatch",
      false,
      "The fixed NDL Who's that boy title changed.",
    );
  }
  if (artist !== "Seiko") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-artist-mismatch",
      false,
      "The fixed NDL Who's that boy record changed artist credit.",
    );
  }
  if (catalogNumber !== "SRCL-20090") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-catalog-mismatch",
      false,
      "The fixed NDL Who's that boy CD changed catalog number.",
    );
  }
  if (rawDate !== "2010.5" || material !== "CD" || editionNote !== "Blu-spec CD") {
    throw new SeikoMatsudaOfficialSourceFailure(
      rawDate === "2010.5" ? "external-claim-mismatch" : "external-date-mismatch",
      false,
      "The fixed NDL Who's that boy edition changed date or carrier boundary.",
    );
  }
  const evidence: SeikoMatsudaNdlEvidence = {
    evidenceKey: "WHOS_NDL",
    workKey: "SINGLE:29",
    observedArtist: artist,
    rawArtist: artist,
    artistStatus: "VERIFIED",
    observedTitle: title,
    observedCatalogNumber: catalogNumber,
    observedDate: "2010-05",
    rawDate,
    datePrecision: "MONTH",
    dateStatus: "VERIFIED",
    carrier: "BLU_SPEC_CD",
    verifiedFields: ["artist", "title", "catalogNumber", "date", "carrier"],
    missingFields: [],
    provenance: ndlProvenance("WHOS_NDL", recordId),
  };
  return {
    status: "VERIFIED",
    verified: true,
    unique: true,
    evidence,
    limitations: [],
    warning: null,
  };
}

function metaContent(html: string, attribute: string, attributeValue: string) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => exactText(tagAttribute(tag, attribute)) === exactText(attributeValue));
  if (tags.length !== 1) return null;
  return tagAttribute(tags[0]!, "content");
}

function sonyProvenance(): SeikoMatsudaExternalProvenance {
  const sourceUrl = SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX;
  return {
    provider: "sony-music-japan",
    sourceType: "official-record-label-box-page",
    sourceUrl,
    retrievalUrl: sourceUrl,
    fixedRecordId: null,
    fetchedByThisAdapter: true,
  };
}

/** Strictly confirms Who's that boy inside Sony's complete 73-single CD box. */
export function parseSeikoMatsudaWhosSonyBoxEvidence(
  html: string,
): SeikoMatsudaExternalEvidenceOutcome {
  const sourceUrl = SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX;
  const expectedPageTitle = exactText(
    "絶賛予約受付中!!! 5/26発売 「Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～」 | 松田聖子 | ソニーミュージックオフィシャルサイト",
  );
  const bodyTags = [...html.matchAll(/<body\b[^>]*>/gi)].map((match) => match[0]);
  const artistHeaders = [...html.matchAll(/<artist-header-component\b[^>]*>/gi)]
    .map((match) => match[0]);
  if (
    pageTitle(html) !== expectedPageTitle ||
    metaContent(html, "property", "og:url") !== sourceUrl ||
    bodyTags.length !== 1 ||
    tagAttribute(bodyTags[0]!, "data-folder") !== "SeikoMatsuda" ||
    tagAttribute(bodyTags[0]!, "data-path") !== "/artist/SeikoMatsuda/" ||
    artistHeaders.length !== 1 ||
    tagAttribute(artistHeaders[0]!, "name") !== OFFICIAL_ARTIST ||
    tagAttribute(artistHeaders[0]!, "folder") !== "SeikoMatsuda"
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-provenance-invalid",
      false,
      "The fixed Sony box page lost its exact official artist and URL provenance.",
    );
  }
  const contentBlocks = [...html.matchAll(
    /<div\b[^>]*class=["'][^"']*\bp-infoContent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
  )];
  const publishedDates = classTexts(html, "span", "p-infoHeader__date");
  if (contentBlocks.length !== 1 || publishedDates.length !== 1 || publishedDates[0] !== "2010.04.03") {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-provenance-invalid",
      false,
      "The fixed Sony box page did not have one exact news body and publication date.",
    );
  }
  const block = contentBlocks[0]![1] ?? "";
  const normalizedContent = stripTags(block);
  const requiredClaims = [
    "全シングル曲(73枚)をコンプリートした完全生産限定BOXとなります。",
    "全73シングル!これまでに国内外で発売された全シングル73枚を完全コンプリート!",
    "SONYが開発した高品質DISC「Blu-spec CD」で、デジタルリマスタリングされた音を更にクリアに!",
    "全73枚のCD盤は全てジャケット写真をデザインしたピクチャー・レーベル仕様!",
    "日本未発売「SEIKO」名義の海外のみで発売されたシングルも6タイトル収録!",
  ].map(exactText);
  if (requiredClaims.some((claim) => !normalizedContent.includes(claim))) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-claim-mismatch",
      false,
      "The fixed Sony page no longer makes every required complete-box and CD claim.",
    );
  }
  const lineValues = decodeHtmlEntities(block)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .split(/\r?\n/u)
    .map(exactText)
    .filter(Boolean);
  const oneLine = (pattern: RegExp, code: SeikoMatsudaOfficialFailureCode) => {
    const values = lineValues.filter((line) => pattern.test(line));
    if (values.length !== 1) {
      throw new SeikoMatsudaOfficialSourceFailure(
        code,
        false,
        "The fixed Sony box page did not expose one unique required line.",
      );
    }
    return values[0]!;
  };
  const boxArtist = oneLine(/^Seiko Matsuda$/u, "external-claim-mismatch");
  const boxName = oneLine(
    /^Single Collection 30th Anniversary Box$/u,
    "external-claim-mismatch",
  );
  const boxSubtitle = oneLine(/^~The Voice Of a Queen~$/u, "external-claim-mismatch");
  const dateLine = oneLine(/^発売日:2010年5月26日$/u, "external-date-mismatch");
  const catalogLine = oneLine(/^品 番:SRCL20061-133$/u, "external-catalog-mismatch");
  if (
    boxArtist !== "Seiko Matsuda" ||
    boxName !== "Single Collection 30th Anniversary Box" ||
    boxSubtitle !== "~The Voice Of a Queen~" ||
    dateLine !== "発売日:2010年5月26日" ||
    catalogLine !== "品 番:SRCL20061-133"
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-claim-mismatch",
      false,
      "The fixed Sony box identity fields changed.",
    );
  }
  const overseasBlocks = [...block.matchAll(
    /⑧日本未発売「SEIKO」名義の海外のみで発売されたシングルも６タイトル収録！<br\s*\/?>\s*（([\s\S]*?)）<br\s*\/?>\s*⑨/gu,
  )];
  if (overseasBlocks.length !== 1) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-title-mismatch",
      false,
      "The fixed Sony page did not expose one exact six-title overseas-single block.",
    );
  }
  const overseasSingles = [...(overseasBlocks[0]![1] ?? "").matchAll(/「([^」]+)」/gu)]
    .map((match) => exactText(match[1] ?? ""));
  const expectedOverseasSingles = [
    "ALL WAY TO THE HEAVEN",
    "WHO’S THAT BOY",
    "LET’S TALK ABOUT IT",
    "GOOD FOR YOU",
    "all to you",
    "just for tonight",
  ] as const;
  if (
    overseasSingles.length !== expectedOverseasSingles.length ||
    overseasSingles.some((title, index) => title !== expectedOverseasSingles[index])
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "external-title-mismatch",
      false,
      "The fixed Sony overseas-single list did not uniquely retain WHO’S THAT BOY and all six boundaries.",
    );
  }
  const evidence: SeikoMatsudaSonyBoxEvidence = {
    evidenceKey: "WHOS_SONY_BOX",
    workKey: "SINGLE:29",
    observedArtist: OFFICIAL_ARTIST,
    observedArtistCredit: "SEIKO",
    observedWorkTitle: "WHO’S THAT BOY",
    observedBoxTitle: "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～",
    observedBoxReleaseDate: "2010-05-26",
    observedCatalogDisplay: "SRCL20061-133",
    observedCatalogRange: {
      start: "SRCL-20061",
      end: "SRCL-20133",
    },
    completeSinglesCount: 73,
    cdDiscCount: 73,
    carrier: "BLU_SPEC_CD",
    overseasSingles: [...expectedOverseasSingles],
    publishedDate: "2010-04-03",
    verifiedFields: [
      "artist",
      "artistCredit",
      "title",
      "boxCompleteness",
      "date",
      "catalogRange",
      "carrier",
    ],
    provenance: sonyProvenance(),
  };
  return {
    status: "VERIFIED",
    verified: true,
    unique: true,
    evidence,
    limitations: [],
    warning: null,
  };
}

/**
 * Strictly parses one of the five fixed official artist detail pages. The
 * constants are integrity constraints only: every returned fact is first
 * observed in the supplied page and must match the complete fixed entity.
 */
export function parseSeikoMatsudaOfficialEntityPage(
  workKey: SeikoMatsudaOfficialWorkKey,
  html: string,
): SeikoMatsudaOfficialEntity {
  const spec = expectedSpec(workKey);
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    new TextEncoder().encode(html).byteLength > HARD_MAX_RESPONSE_BYTES
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      html.length > 0 ? "response-too-large" : "invalid-html",
      false,
      "The official detail page was empty or exceeded its fixed byte limit.",
    );
  }
  const pageTitles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)]
    .map((match) => stripTags(match[1] ?? ""));
  const artistLogos = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => tagAttribute(tag, "src") === "/img/logo.png")
    .map((tag) => exactText(tagAttribute(tag, "alt")));
  const discographyContainers = [...html.matchAll(/<div\b[^>]*\bid=["']discography["'][^>]*>/gi)];
  if (
    pageTitles.length !== 1 ||
    pageTitles[0] !== OFFICIAL_PAGE_TITLE ||
    artistLogos.length !== 1 ||
    artistLogos[0] !== OFFICIAL_ARTIST ||
    discographyContainers.length !== 1
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "artist-identity-mismatch",
      false,
      "The fixed detail page did not retain the exact official artist identity shell.",
    );
  }

  const observedCategoryLabel = uniqueClassText(
    html,
    "p",
    "info-title-message",
    "category-mismatch",
  );
  const observedCategory = observedCategoryLabel === "シングル"
    ? "SINGLE"
    : observedCategoryLabel === "アルバム"
      ? "ALBUM"
      : null;
  if (
    observedCategory !== spec.sourceCategory ||
    observedCategoryLabel !== spec.sourceCategoryLabel ||
    parseActiveCategoryPath(html) !== spec.activeCategoryPath
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "category-mismatch",
      false,
      "The official page category did not exactly match the fixed entity category.",
    );
  }

  const observedTitle = uniqueClassText(html, "p", "info-disk-title", "title-mismatch");
  if (observedTitle !== exactText(spec.title)) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "title-mismatch",
      false,
      "The official page title lost or changed part of the complete fixed work title.",
    );
  }

  const info = classTexts(html, "p", "info-p");
  const catalogLines = info.filter((value) => value.startsWith("商品番号:"));
  const dateLines = info.filter((value) => value.startsWith("リリース:"));
  if (catalogLines.length !== 1 || catalogLines[0] !== `商品番号:${spec.catalogDisplay}`) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "catalog-mismatch",
      false,
      "The official page did not expose the exact fixed catalog-number boundary.",
    );
  }
  const observedDate = dateLines.length === 1 ? parseJapaneseReleaseDate(dateLines[0]!) : null;
  if (!observedDate || observedDate !== spec.releaseDate) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "date-mismatch",
      false,
      "The official page did not expose the exact complete fixed release date.",
    );
  }

  const tracks = parseTracks(html);
  if (
    tracks.length !== spec.tracks.length ||
    tracks.some((track, index) =>
      track.position !== index + 1 ||
      track.title !== exactText(spec.tracks[index]![0]) ||
      track.duration !== spec.tracks[index]![1])
  ) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "track-boundary-mismatch",
      false,
      "The official page track list did not preserve the complete fixed work boundary.",
    );
  }
  const identityTrackTitles = spec.identityTrackTitles.map(exactText);
  if (identityTrackTitles.some((title) => !tracks.some((track) => track.title === title))) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "track-boundary-mismatch",
      false,
      "The official page was missing a required identity-bearing track.",
    );
  }

  const coverTags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => tagAttribute(tag, "src").includes("/discography/images/upload/"));
  if (coverTags.length !== 1) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "cover-url-invalid",
      false,
      "The official page did not contain exactly one fixed discography cover.",
    );
  }
  const observedCoverAlt = exactText(tagAttribute(coverTags[0]!, "alt"));
  if (observedCoverAlt !== observedTitle) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "cover-title-mismatch",
      false,
      "The official cover alt text did not exactly bind the image to the work title.",
    );
  }
  const coverUrl = safeCoverUrl(tagAttribute(coverTags[0]!, "src"), spec);
  if (!coverUrl) {
    throw new SeikoMatsudaOfficialSourceFailure(
      "cover-url-invalid",
      false,
      "The official cover URL violated the fixed HTTPS host and path allowlist.",
    );
  }
  const cover: SeikoMatsudaOfficialCoverEvidence = {
    provider: "seiko-matsuda-official",
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url: coverUrl,
    sourceUrl: spec.sourceUrl,
    observedAlt: observedCoverAlt,
    requiresAssetValidation: true,
  };
  return {
    manifestEntryKey: spec.workKey,
    sourceUrl: spec.sourceUrl,
    provider: "seiko-matsuda-official",
    sourceType: "official-artist-entity-page",
    evidenceScope: "single-item-page",
    observedArtist: OFFICIAL_ARTIST,
    observedTitle,
    observedCategory,
    manifestCategory: spec.manifestCategory,
    observedReleaseDate: observedDate,
    observedDateKind: spec.dateKind,
    observedCatalogDisplay: spec.catalogDisplay,
    observedCatalogNumbers: [...spec.catalogNumbers],
    tracks,
    identityTrackTitles,
    cover,
    conflicts: declaredConflicts(spec, observedCategory, observedDate),
    optionalExternalEvidence: optionalExternalEvidence(spec),
  };
}

function validFixedDetailUrl(value: string, spec: FixedWorkSpec) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return value === spec.sourceUrl &&
    url.protocol === "https:" &&
    url.origin === SEIKO_MATSUDA_OFFICIAL_ORIGIN &&
    url.hostname === OFFICIAL_HOSTNAME &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    url.pathname === `/discography/detail/${url.pathname.split("/").at(-1)}` &&
    /^\/discography\/detail\/(?:43|69|115|152|244)$/u.test(url.pathname);
}

function validExternalRequestUrl(spec: ExternalRequestSpec) {
  let url: URL;
  try {
    url = new URL(spec.url);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== spec.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    spec.url !== SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS[spec.evidenceKey]
  ) return false;
  if (spec.hostname === NDL_HOSTNAME) {
    return url.origin === NDL_ORIGIN &&
      /^(?:\/books\/R100000002-I000008815159|\/books\/R100000002-I000010906601)$/u
        .test(url.pathname);
  }
  return url.origin === SONY_ORIGIN &&
    url.pathname === "/artist/SeikoMatsuda/info/337828";
}

function externalWorkKey(evidenceKey: SeikoMatsudaExternalEvidenceKey) {
  return evidenceKey === "DANCING_NDL" ? "SINGLE:22" as const : "SINGLE:29" as const;
}

function parseExternalEvidence(
  evidenceKey: SeikoMatsudaExternalEvidenceKey,
  html: string,
) {
  if (evidenceKey === "DANCING_NDL") return parseSeikoMatsudaDancingNdlEvidence(html);
  if (evidenceKey === "WHOS_NDL") return parseSeikoMatsudaWhosNdlEvidence(html);
  return parseSeikoMatsudaWhosSonyBoxEvidence(html);
}

async function readLimitedText(response: Response, maximumBytes = HARD_MAX_RESPONSE_BYTES) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SeikoMatsudaOfficialSourceFailure(
      "response-too-large",
      false,
      "The official detail response exceeded its fixed byte limit.",
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
      if (total > maximumBytes) {
        throw new SeikoMatsudaOfficialSourceFailure(
          "response-too-large",
          false,
          "The official detail response exceeded its fixed byte limit.",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof SeikoMatsudaOfficialSourceFailure) throw error;
    throw new SeikoMatsudaOfficialSourceFailure(
      "invalid-html",
      false,
      "The official detail response was not valid UTF-8 HTML.",
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

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await work(values[index]!, index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return output;
}

function sourceFailure(error: unknown) {
  return error instanceof SeikoMatsudaOfficialSourceFailure
    ? error
    : new SeikoMatsudaOfficialSourceFailure(
        "network-unavailable",
        true,
        "The official detail request failed.",
      );
}

function warning(
  failure: SeikoMatsudaOfficialSourceFailure,
  spec?: FixedWorkSpec,
): SeikoMatsudaOfficialWarning {
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    ...(spec ? { workKey: spec.workKey, url: spec.sourceUrl } : {}),
  };
}

function failedSourceResult(
  spec: FixedWorkSpec,
  failure: SeikoMatsudaOfficialSourceFailure,
): SeikoMatsudaOfficialSourceResult {
  return {
    workKey: spec.workKey,
    url: spec.sourceUrl,
    status: "FAILED",
    failureCode: failure.code,
    message: failure.message,
  };
}

function incompleteResult(
  sourceResults: SeikoMatsudaOfficialSourceResult[],
  warnings: SeikoMatsudaOfficialWarning[],
  stats: MutableStats,
  externalEvidence: SeikoMatsudaExternalEvidenceResult,
): SeikoMatsudaOfficialResult {
  return {
    status: "SOURCE_INCOMPLETE",
    complete: false,
    works: [],
    byManifestEntryKey: {},
    sourceResults,
    warnings,
    externalEvidence,
    stats,
  };
}

function validateFixedSet(works: readonly SeikoMatsudaOfficialEntity[]) {
  if (works.length !== FIXED_WORKS.length) return false;
  const keys = new Set(works.map((work) => work.manifestEntryKey));
  const urls = new Set(works.map((work) => work.sourceUrl));
  const titles = new Set(works.map((work) => work.observedTitle));
  const covers = new Set(works.map((work) => work.cover.url));
  const catalogs = new Set(works.flatMap((work) => work.observedCatalogNumbers));
  return keys.size === FIXED_WORKS.length &&
    urls.size === FIXED_WORKS.length &&
    titles.size === FIXED_WORKS.length &&
    covers.size === FIXED_WORKS.length &&
    catalogs.size === works.reduce((count, work) => count + work.observedCatalogNumbers.length, 0) &&
    FIXED_WORKS.every((spec, index) => works[index]?.manifestEntryKey === spec.workKey);
}

export class SeikoMatsudaOfficialEntityClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly concurrency: number;
  private readonly includeExternalEvidence: boolean;

  constructor(options: SeikoMatsudaOfficialClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
    this.concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 3);
    this.includeExternalEvidence = options.includeExternalEvidence !== false;
  }

  private async resolveOfficialHost(stats: MutableStats) {
    let resolution = await resolvePublicOfficialHost(OFFICIAL_HOSTNAME, this.resolveHost);
    for (
      let attempt = 0;
      !resolution.ok && resolution.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      stats.retries += 1;
      await this.sleep(Math.min(2_000, 250 * 2 ** attempt));
      resolution = await resolvePublicOfficialHost(OFFICIAL_HOSTNAME, this.resolveHost);
    }
    if (!resolution.ok) {
      throw new SeikoMatsudaOfficialSourceFailure(
        resolution.reason,
        resolution.reason === "dns-resolution-failed",
        "The fixed Seiko Matsuda official host did not resolve exclusively to public addresses.",
      );
    }
  }

  private async resolveExternalHost(
    hostname: ExternalRequestSpec["hostname"],
    stats: SeikoMatsudaExternalEvidenceResult["stats"],
  ) {
    let resolution = await resolvePublicOfficialHost(hostname, this.resolveHost);
    for (
      let attempt = 0;
      !resolution.ok && resolution.reason === "dns-resolution-failed" && attempt < this.retryCount;
      attempt += 1
    ) {
      stats.retries += 1;
      await this.sleep(Math.min(2_000, 250 * 2 ** attempt));
      resolution = await resolvePublicOfficialHost(hostname, this.resolveHost);
    }
    if (!resolution.ok) {
      throw new SeikoMatsudaOfficialSourceFailure(
        resolution.reason,
        resolution.reason === "dns-resolution-failed",
        `The fixed external host ${hostname} did not resolve exclusively to public addresses.`,
      );
    }
  }

  private async requestExternalOnce(
    spec: ExternalRequestSpec,
    stats: SeikoMatsudaExternalEvidenceResult["stats"],
  ) {
    if (!validExternalRequestUrl(spec)) {
      throw new SeikoMatsudaOfficialSourceFailure(
        "invalid-source-url",
        false,
        "An external evidence request violated its fixed HTTPS host and path allowlist.",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(spec.url, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "Accept-Language": "ja",
          "User-Agent": "CD-BOX/1.0 Seiko-Matsuda-fixed-evidence-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SeikoMatsudaOfficialSourceFailure(
          "invalid-source-url",
          false,
          "A fixed external evidence page attempted a redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        const failure = new SeikoMatsudaOfficialSourceFailure(
          "http-status",
          retryableStatus(response.status),
          `The fixed external evidence page returned HTTP ${response.status}.`,
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
        throw new SeikoMatsudaOfficialSourceFailure(
          "unsupported-content-type",
          false,
          "The fixed external evidence page returned a non-HTML content type.",
        );
      }
      const html = await readLimitedText(response, spec.maximumBytes);
      stats.responsesFetched += 1;
      return html;
    } catch (error) {
      if (error instanceof SeikoMatsudaOfficialSourceFailure) throw error;
      if (controller.signal.aborted) {
        throw new SeikoMatsudaOfficialSourceFailure(
          "network-timeout",
          true,
          "The fixed external evidence request timed out.",
        );
      }
      throw new SeikoMatsudaOfficialSourceFailure(
        "network-unavailable",
        true,
        "The fixed external evidence request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestExternal(
    spec: ExternalRequestSpec,
    stats: SeikoMatsudaExternalEvidenceResult["stats"],
  ) {
    let lastFailure: SeikoMatsudaOfficialSourceFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestExternalOnce(spec, stats);
      } catch (error) {
        const failure = sourceFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        const retryAfter = (failure as SeikoMatsudaOfficialSourceFailure & {
          retryAfterMs?: number | null;
        }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastFailure ?? new SeikoMatsudaOfficialSourceFailure(
      "network-unavailable",
      true,
      "The fixed external evidence request failed.",
    );
  }

  private async loadExternalEvidence(): Promise<SeikoMatsudaExternalEvidenceResult> {
    if (!this.includeExternalEvidence) return externalEvidenceNotRequested();
    const stats = freshExternalStats();
    const hostFailures = new Map<ExternalRequestSpec["hostname"], SeikoMatsudaOfficialSourceFailure>();
    await Promise.all(([NDL_HOSTNAME, SONY_HOSTNAME] as const).map(async (hostname) => {
      try {
        await this.resolveExternalHost(hostname, stats);
      } catch (error) {
        hostFailures.set(hostname, sourceFailure(error));
      }
    }));
    const outcomes = await boundedMap(
      EXTERNAL_REQUESTS,
      Math.min(this.concurrency, EXTERNAL_REQUESTS.length),
      async (spec) => {
        const hostFailure = hostFailures.get(spec.hostname);
        if (hostFailure) return { spec, outcome: null, failure: hostFailure };
        try {
          const html = await this.requestExternal(spec, stats);
          const outcome = parseExternalEvidence(spec.evidenceKey, html);
          stats.sourcesParsed += 1;
          return { spec, outcome, failure: null };
        } catch (error) {
          return { spec, outcome: null, failure: sourceFailure(error) };
        }
      },
    );
    const sources: SeikoMatsudaExternalEvidenceResult["sources"] = {};
    const warnings: SeikoMatsudaOfficialWarning[] = [];
    for (const { spec, outcome, failure } of outcomes) {
      if (outcome) {
        sources[spec.evidenceKey] = outcome;
        continue;
      }
      const externalWarning: SeikoMatsudaOfficialWarning = {
        code: failure!.code,
        message: failure!.message,
        retryable: failure!.retryable,
        workKey: externalWorkKey(spec.evidenceKey),
        url: spec.url,
      };
      warnings.push(externalWarning);
      sources[spec.evidenceKey] = {
        status: "FAILED",
        verified: false,
        unique: false,
        evidence: null,
        limitations: [],
        warning: externalWarning,
      };
    }
    const values = Object.values(sources);
    return {
      status: warnings.length === 0 ? "SOURCE_SET_COMPLETE" : "SOURCE_INCOMPLETE",
      requested: true,
      sources,
      verifiedCount: values.filter((outcome) => outcome.verified).length,
      uniqueCount: values.filter((outcome) => outcome.unique).length,
      warnings,
      stats,
    };
  }

  private async requestOnce(spec: FixedWorkSpec, stats: MutableStats) {
    if (!validFixedDetailUrl(spec.sourceUrl, spec)) {
      throw new SeikoMatsudaOfficialSourceFailure(
        "invalid-source-url",
        false,
        "A detail request violated the fixed HTTPS host and path allowlist.",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(spec.sourceUrl, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "Accept-Language": "ja",
          "User-Agent": "CD-BOX/1.0 Seiko-Matsuda-official-entity-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SeikoMatsudaOfficialSourceFailure(
          "invalid-source-url",
          false,
          "The fixed official detail page attempted a redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        const failure = new SeikoMatsudaOfficialSourceFailure(
          "http-status",
          retryableStatus(response.status),
          `The fixed official detail page returned HTTP ${response.status}.`,
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
        throw new SeikoMatsudaOfficialSourceFailure(
          "unsupported-content-type",
          false,
          "The fixed official detail page returned a non-HTML content type.",
        );
      }
      const html = await readLimitedText(response);
      stats.responsesFetched += 1;
      return html;
    } catch (error) {
      if (error instanceof SeikoMatsudaOfficialSourceFailure) throw error;
      if (controller.signal.aborted) {
        throw new SeikoMatsudaOfficialSourceFailure(
          "network-timeout",
          true,
          "The fixed official detail request timed out.",
        );
      }
      throw new SeikoMatsudaOfficialSourceFailure(
        "network-unavailable",
        true,
        "The fixed official detail request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(spec: FixedWorkSpec, stats: MutableStats) {
    let lastFailure: SeikoMatsudaOfficialSourceFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestOnce(spec, stats);
      } catch (error) {
        const failure = sourceFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        const retryAfter = (failure as SeikoMatsudaOfficialSourceFailure & {
          retryAfterMs?: number | null;
        }).retryAfterMs;
        await this.sleep(retryAfter ?? Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw lastFailure ?? new SeikoMatsudaOfficialSourceFailure(
      "network-unavailable",
      true,
      "The fixed official detail request failed.",
    );
  }

  async load(): Promise<SeikoMatsudaOfficialResult> {
    const stats = freshStats();
    const externalEvidencePromise = this.loadExternalEvidence();
    try {
      await this.resolveOfficialHost(stats);
    } catch (error) {
      const failure = sourceFailure(error);
      return incompleteResult(
        FIXED_WORKS.map((spec) => failedSourceResult(spec, failure)),
        [warning(failure)],
        stats,
        await externalEvidencePromise,
      );
    }

    const outcomes = await boundedMap(
      FIXED_WORKS,
      this.concurrency,
      async (spec) => {
        try {
          const html = await this.request(spec, stats);
          const entity = parseSeikoMatsudaOfficialEntityPage(spec.workKey, html);
          stats.pagesParsed += 1;
          stats.coverUrlsParsed += 1;
          return { spec, entity, failure: null };
        } catch (error) {
          return { spec, entity: null, failure: sourceFailure(error) };
        }
      },
    );
    const sourceResults = outcomes.map(({ spec, failure }) => failure
      ? failedSourceResult(spec, failure)
      : {
          workKey: spec.workKey,
          url: spec.sourceUrl,
          status: "COMPLETE" as const,
          failureCode: null,
          message: null,
        });
    const failures = outcomes.filter((outcome) => outcome.failure !== null);
    if (failures.length > 0) {
      return incompleteResult(
        sourceResults,
        failures.map(({ spec, failure }) => warning(failure!, spec)),
        stats,
        await externalEvidencePromise,
      );
    }
    const works = outcomes.map((outcome) => outcome.entity!);
    if (!validateFixedSet(works)) {
      const failure = new SeikoMatsudaOfficialSourceFailure(
        "incomplete-fixed-set",
        false,
        "The five official detail pages did not form one unique complete fixed set.",
      );
      return incompleteResult(
        sourceResults,
        [warning(failure)],
        stats,
        await externalEvidencePromise,
      );
    }
    const externalEvidence = await externalEvidencePromise;
    return {
      status: "FIXED_SET_COMPLETE",
      complete: true,
      works,
      byManifestEntryKey: Object.fromEntries(
        works.map((work) => [work.manifestEntryKey, work]),
      ),
      sourceResults,
      warnings: [],
      externalEvidence,
      stats,
    };
  }
}

export function seikoMatsudaOfficialDetailUrl(workKey: SeikoMatsudaOfficialWorkKey) {
  return expectedSpec(workKey).sourceUrl;
}

export async function fetchSeikoMatsudaOfficialEntities(
  options: SeikoMatsudaOfficialClientOptions = {},
) {
  return new SeikoMatsudaOfficialEntityClient(options).load();
}
