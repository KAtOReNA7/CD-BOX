import "server-only";

import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
  validateOfficialMusicUrl,
} from "@/lib/official-music/url-policy";
import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";

export const SEIKO_MATSUDA_RECOVERY_ORIGIN = "https://www.seikomatsuda.co.jp";

const OFFICIAL_HOSTNAME = "www.seikomatsuda.co.jp";
const OFFICIAL_SHELL_TITLE = "ディスコグラフィ｜松田聖子オフィシャルサイト";
const OFFICIAL_ARTIST = "松田聖子";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MINIMUM_INTERVAL_MS = 100;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_PAGE_BYTES = 256 * 1_024;
const HARD_MAX_PAGE_BYTES = 512 * 1_024;
const HARD_MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const HARD_MAX_CACHE_ENTRIES = 26;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type SeikoMatsudaRecoverySelectionPolicy =
  | "EXACT_TITLE"
  | "NORMAL_EDITION";

export type SeikoMatsudaRecoverySpec = {
  workKey: string;
  detailId: number;
  sourceUrl: string;
  canonicalTitle: string;
  pageTitle: string;
  manifestCategory: "SINGLE" | "ORIGINAL_ALBUM";
  officialCategory: "SINGLE" | "ALBUM";
  officialCategoryLabel: "シングル" | "アルバム";
  activeCategoryPath: "/discography/single" | "/discography/album";
  releaseDate: string;
  catalogDisplay: string;
  catalogNumbers: readonly string[];
  coverPath: string;
  selectionPolicy: SeikoMatsudaRecoverySelectionPolicy;
  auditedAsset: {
    mime: "image/gif" | "image/jpeg";
    width: number;
    height: number;
    sha256: string;
  };
};

type RecoverySpecInput = Omit<
  SeikoMatsudaRecoverySpec,
  "sourceUrl" | "officialCategory" | "officialCategoryLabel" | "activeCategoryPath"
>;

function recoverySpec(input: RecoverySpecInput): SeikoMatsudaRecoverySpec {
  const album = input.manifestCategory === "ORIGINAL_ALBUM";
  return Object.freeze({
    ...input,
    sourceUrl: `${SEIKO_MATSUDA_RECOVERY_ORIGIN}/discography/detail/${input.detailId}`,
    officialCategory: album ? "ALBUM" : "SINGLE",
    officialCategoryLabel: album ? "アルバム" : "シングル",
    activeCategoryPath: album ? "/discography/album" : "/discography/single",
    catalogNumbers: Object.freeze([...input.catalogNumbers]),
    auditedAsset: Object.freeze({ ...input.auditedAsset }),
  });
}

export const SEIKO_MATSUDA_RECOVERY_SPECS = Object.freeze({
  "SINGLE:1": recoverySpec({
    workKey: "SINGLE:1", detailId: 5, canonicalTitle: "裸足の季節", pageTitle: "裸足の季節",
    manifestCategory: "SINGLE", releaseDate: "1980-04-01", catalogDisplay: "10EH-3197",
    catalogNumbers: ["10EH-3197"],
    coverPath: "/discography/images/upload/1980-5_Artwork19800401-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "df822ecd216599758fd7ef81dd50483883d02103ca9335d70fc687910c37ce33" },
  }),
  "SINGLE:3": recoverySpec({
    workKey: "SINGLE:3", detailId: 3, canonicalTitle: "風は秋色", pageTitle: "風は秋色",
    manifestCategory: "SINGLE", releaseDate: "1980-10-01", catalogDisplay: "10EH-3198",
    catalogNumbers: ["10EH-3198"],
    coverPath: "/discography/images/upload/1980-3_Artwork19801001-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "673527a076a12a7560374a3188ec3f4131f356bb24db40ee1a37a22ac03fdbf0" },
  }),
  "SINGLE:5": recoverySpec({
    workKey: "SINGLE:5", detailId: 10, canonicalTitle: "夏の扉", pageTitle: "夏の扉",
    manifestCategory: "SINGLE", releaseDate: "1981-04-21", catalogDisplay: "10EH-3199",
    catalogNumbers: ["10EH-3199"],
    coverPath: "/discography/images/upload/1981-5_Artwork19810421-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "952f4c23d7a0de3b23b827d9e8e24ba039f58fd26af1acc78eedb603406882a4" },
  }),
  "SINGLE:15": recoverySpec({
    workKey: "SINGLE:15", detailId: 24, canonicalTitle: "瞳はダイアモンド", pageTitle: "瞳はダイアモンド",
    manifestCategory: "SINGLE", releaseDate: "1983-10-28", catalogDisplay: "10EH-3203",
    catalogNumbers: ["10EH-3203"],
    coverPath: "/discography/images/upload/1983-3_Artwork19831028-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "482abd851185e8c6a95bf54f06bbb39528dc0f2bc9c6a00039fd32243a52638c" },
  }),
  "SINGLE:20": recoverySpec({
    workKey: "SINGLE:20", detailId: 45, canonicalTitle: "天使のウィンク", pageTitle: "天使のウィンク",
    manifestCategory: "SINGLE", releaseDate: "1985-01-30", catalogDisplay: "10EH-3207",
    catalogNumbers: ["10EH-3207"],
    coverPath: "/discography/images/upload/1985-5_Artwork19850130-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "0b70149ca930def9abf371f617024c7297ea80faebe912783492a3e604594212" },
  }),
  "SINGLE:21": recoverySpec({
    workKey: "SINGLE:21", detailId: 44, canonicalTitle: "ボーイの季節", pageTitle: "ボーイの季節",
    manifestCategory: "SINGLE", releaseDate: "1985-05-09", catalogDisplay: "10EH-3207",
    catalogNumbers: ["10EH-3207"],
    coverPath: "/discography/images/upload/1985-4_Artwork19850509-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "8bd309737f6a55d5a05787c34c31dce367a596e2c3669b99a640a59a68a686d5" },
  }),
  "SINGLE:23": recoverySpec({
    workKey: "SINGLE:23", detailId: 55, canonicalTitle: "Strawberry Time", pageTitle: "Strawberry Time",
    manifestCategory: "SINGLE", releaseDate: "1987-04-22", catalogDisplay: "10EH-3208",
    catalogNumbers: ["10EH-3208"],
    coverPath: "/discography/images/upload/1987-3_Artwork19870422-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "13afb95836a3711bb223ccbc398775a49cd73a5681f4d295eddb404445da1615" },
  }),
  "SINGLE:24": recoverySpec({
    workKey: "SINGLE:24", detailId: 54, canonicalTitle: "Pearl-White Eve", pageTitle: "Pearl-White Eve",
    manifestCategory: "SINGLE", releaseDate: "1987-11-06", catalogDisplay: "10EH-3208",
    catalogNumbers: ["10EH-3208"],
    coverPath: "/discography/images/upload/1987-2_Artwork19871106-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "5c28ec8b7086cf945788b538ee4b7fd08a4f3738ecbf7a104d4aee5550a14bc4" },
  }),
  "SINGLE:27": recoverySpec({
    workKey: "SINGLE:27", detailId: 64, canonicalTitle: "Precious Heart", pageTitle: "Precious Heart",
    manifestCategory: "SINGLE", releaseDate: "1989-11-15", catalogDisplay: "CSDL-3045",
    catalogNumbers: ["CSDL-3045"],
    coverPath: "/discography/images/upload/1989-3_Artwork19891115-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 84, height: 150, sha256: "1a10b3d2f8797afc2326475c352211aa6bd263eafea1b56b6358b49397831be4" },
  }),
  "SINGLE:28": recoverySpec({
    workKey: "SINGLE:28", detailId: 70, canonicalTitle: "THE RIGHT COMBINATION", pageTitle: "THE RIGHT COMBINATION",
    manifestCategory: "SINGLE", releaseDate: "1990-07-15", catalogDisplay: "CDSL-3151",
    catalogNumbers: ["CDSL-3151"],
    coverPath: "/discography/images/upload/1990-5_Artwork19900715-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 84, height: 150, sha256: "e6a43d2929541ebbe7be084b3802ea13b3bfd7f4f3c2a0f11c4c0f8fef5f31f3" },
  }),
  "SINGLE:32": recoverySpec({
    workKey: "SINGLE:32", detailId: 79, canonicalTitle: "あなたのすべてになりたい", pageTitle: "あなたのすべてになりたい",
    manifestCategory: "SINGLE", releaseDate: "1992-08-01", catalogDisplay: "SRDL-3514",
    catalogNumbers: ["SRDL-3514"],
    coverPath: "/discography/images/upload/1992-3_Artwork19920801-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 84, sha256: "393648b1d0e9327276389d28cda841414015d6cd5deee269e1af6904b215a9f2" },
  }),
  "SINGLE:33": recoverySpec({
    workKey: "SINGLE:33", detailId: 87, canonicalTitle: "大切なあなた", pageTitle: "大切なあなた",
    manifestCategory: "SINGLE", releaseDate: "1993-04-21", catalogDisplay: "SRDL-3642",
    catalogNumbers: ["SRDL-3642"],
    coverPath: "/discography/images/upload/1993-5_Artwork19930421-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 84, height: 150, sha256: "e15cfde00f0f6b9931515b507a6d2e53fcc2ba525908d3fd3df8eda94b710519" },
  }),
  "SINGLE:34": recoverySpec({
    workKey: "SINGLE:34", detailId: 86, canonicalTitle: "A Touch of Destiny", pageTitle: "A Touch of Destiny",
    manifestCategory: "SINGLE", releaseDate: "1993-05-21", catalogDisplay: "SRDL-3664",
    catalogNumbers: ["SRDL-3664"],
    coverPath: "/discography/images/upload/1993-4_Artwork19930521-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 84, height: 150, sha256: "30fc9adcaf48343010d2c9ee6166b7933de7f2d8f8cae2d2d49ce15ea6bd2c32" },
  }),
  "SINGLE:35": recoverySpec({
    workKey: "SINGLE:35", detailId: 85, canonicalTitle: "かこわれて、愛jing", pageTitle: "かこわれて、愛jing",
    manifestCategory: "SINGLE", releaseDate: "1993-11-10", catalogDisplay: "SRDL-3767",
    catalogNumbers: ["SRDL-3767"],
    coverPath: "/discography/images/upload/1993-3_Artwork19931110-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 84, height: 150, sha256: "b2a243f5fc7901de70f38ed71cdff4aeae08b5a825e7cb9532418ec3e751750d" },
  }),
  "SINGLE:40": recoverySpec({
    workKey: "SINGLE:40", detailId: 106, canonicalTitle: "Let's Talk About It", pageTitle: "Let's Talk About It",
    manifestCategory: "SINGLE", releaseDate: "1996-04-24", catalogDisplay: "AMSAD-00208",
    catalogNumbers: ["AMSAD-00208"],
    coverPath: "/discography/images/upload/1996-6_Artwork19960424-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "ecd6e4a844dee7ab67fc36bb4a313f0c0c2ce375b3763bb45db300381ed036c4" },
  }),
  "SINGLE:42": recoverySpec({
    workKey: "SINGLE:42", detailId: 104, canonicalTitle: "さよならの瞬間", pageTitle: "さよならの瞬間",
    manifestCategory: "SINGLE", releaseDate: "1996-11-25", catalogDisplay: "PHDL-1076",
    catalogNumbers: ["PHDL-1076"],
    coverPath: "/discography/images/upload/1996-4_Artwork19961125-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 82, height: 150, sha256: "3b6819ea826915fdcd326d958d6de59e26db5e99cb8a167631d26aa84d727e62" },
  }),
  "SINGLE:43": recoverySpec({
    workKey: "SINGLE:43", detailId: 118, canonicalTitle: "私だけの天使 ～Angel～", pageTitle: "私だけの天使 ～Angel～",
    manifestCategory: "SINGLE", releaseDate: "1997-04-23", catalogDisplay: "PHDL-1111",
    catalogNumbers: ["PHDL-1111"],
    coverPath: "/discography/images/upload/1997-4_Artwork19970423-112-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 82, height: 150, sha256: "407ccf81658adcf57e745bb8e95ca0ec3ed7523091d4200bc5e590cfc62b62ee" },
  }),
  "SINGLE:71": recoverySpec({
    workKey: "SINGLE:71", detailId: 244, canonicalTitle: "特別な恋人/声だけ聞かせて", pageTitle: "特別な恋人/声だけ聞かせて",
    manifestCategory: "SINGLE", releaseDate: "2011-11-23", catalogDisplay: "UMCK-5355",
    catalogNumbers: ["UMCK-5355"],
    coverPath: "/discography/images/upload/2011-4_Artwork20111123-112-0001.jpg",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/jpeg", width: 150, height: 150, sha256: "7da05d9a2dc68cfc8ad181e79fa51d710c9c85e48c2c26001ae52a328780aa3f" },
  }),
  "SINGLE:76": recoverySpec({
    workKey: "SINGLE:76", detailId: 364,
    canonicalTitle: "永遠のもっと果てまで/惑星になりたい",
    pageTitle: "「永遠のもっと果てまで/惑星になりたい」【通常盤】",
    manifestCategory: "SINGLE", releaseDate: "2015-10-28", catalogDisplay: "UPCH-80414",
    catalogNumbers: ["UPCH-80414"],
    coverPath: "/discography/images/upload/UPCH-80414.jpg",
    selectionPolicy: "NORMAL_EDITION",
    auditedAsset: { mime: "image/jpeg", width: 592, height: 600, sha256: "afe326832fd0793f017fb0688f757d3efc995d062a5f45a066a69b3e2b502681" },
  }),
  "ORIGINAL_ALBUM:6": recoverySpec({
    workKey: "ORIGINAL_ALBUM:6", detailId: 14, canonicalTitle: "Candy", pageTitle: "Candy",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "1982-11-10", catalogDisplay: "CSCL-1270",
    catalogNumbers: ["CSCL-1270"],
    coverPath: "/discography/images/upload/1982-1_Artwork19821110-111-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "754a6dd53519b0fd0b0cbc6f45d10ca57073fb438a2e7a5368d837b3442c0a64" },
  }),
  "ORIGINAL_ALBUM:23": recoverySpec({
    workKey: "ORIGINAL_ALBUM:23", detailId: 83, canonicalTitle: "A Time for Love", pageTitle: "A Time for Love",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "1993-11-21", catalogDisplay: "SRCL-2803",
    catalogNumbers: ["SRCL-2803"],
    coverPath: "/discography/images/upload/1993-1_Artwork19931121-111-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "17d47cff76dddd5a01678f6cfde289e1e35c115119c6450c2cae9fda68a75a48" },
  }),
  "ORIGINAL_ALBUM:31": recoverySpec({
    workKey: "ORIGINAL_ALBUM:31", detailId: 131, canonicalTitle: "永遠の少女", pageTitle: "永遠の少女",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "1999-12-15", catalogDisplay: "PHCL-5130",
    catalogNumbers: ["PHCL-5130"],
    coverPath: "/discography/images/upload/1999-1_Artwork19991215-111-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "d2e51362ba210d81e8223c05d2674574a7366032f8e63915f8f32d6d9fc4b405" },
  }),
  "ORIGINAL_ALBUM:35": recoverySpec({
    workKey: "ORIGINAL_ALBUM:35", detailId: 152, canonicalTitle: "area62", pageTitle: "area62",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "2002-06-21", catalogDisplay: "VIVI-19623/TGCS-1439",
    catalogNumbers: ["VIVI-19623", "TGCS-1439"],
    coverPath: "/discography/images/upload/2002-1_Artwork20020621-111-0001.gif",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/gif", width: 150, height: 150, sha256: "fe82f449ae9423803fafc87e4294afbf57ae895e87f235df0777588c94d86271" },
  }),
  "ORIGINAL_ALBUM:39": recoverySpec({
    workKey: "ORIGINAL_ALBUM:39", detailId: 166, canonicalTitle: "Under the beautiful stars", pageTitle: "Under the beautiful stars",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "2005-12-07", catalogDisplay: "SRCL-6115",
    catalogNumbers: ["SRCL-6115"],
    coverPath: "/discography/images/upload/2005-2_Artwork20051207-111-0001.jpg",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/jpeg", width: 180, height: 180, sha256: "b05abeb31ca3b457026ce8a429a0a62c1aea1d2393c40d62205f5c3f51a0e71a" },
  }),
  "ORIGINAL_ALBUM:40": recoverySpec({
    workKey: "ORIGINAL_ALBUM:40", detailId: 177, canonicalTitle: "bless you", pageTitle: "bless you",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "2006-05-31", catalogDisplay: "SRCL-6286",
    catalogNumbers: ["SRCL-6286"],
    coverPath: "/discography/images/upload/2006-2_Artwork20060531-111-0001.jpg",
    selectionPolicy: "EXACT_TITLE",
    auditedAsset: { mime: "image/jpeg", width: 180, height: 178, sha256: "0526b1b64cdc726ac87ca7aabd45a971bac1c8b4acc6c2ad32ba3370e83a77d1" },
  }),
  "ORIGINAL_ALBUM:53": recoverySpec({
    workKey: "ORIGINAL_ALBUM:53", detailId: 549, canonicalTitle: "SEIKO MATSUDA 2020", pageTitle: "SEIKO MATSUDA 2020【通常盤】",
    manifestCategory: "ORIGINAL_ALBUM", releaseDate: "2020-09-30", catalogDisplay: "UPCH-20551",
    catalogNumbers: ["UPCH-20551"],
    coverPath: "/discography/images/upload/seiko%20matsuda2020_tsujyo.jpg",
    selectionPolicy: "NORMAL_EDITION",
    auditedAsset: { mime: "image/jpeg", width: 600, height: 592, sha256: "f08421032765421e787bc041e0cc8fe27a3910723d93a57130e9dc96b4b6af0d" },
  }),
} satisfies Record<string, SeikoMatsudaRecoverySpec>);

export type SeikoMatsudaRecoveryWorkKey = keyof typeof SEIKO_MATSUDA_RECOVERY_SPECS;

export const SEIKO_MATSUDA_RECOVERY_WORK_KEYS = Object.freeze(
  Object.keys(SEIKO_MATSUDA_RECOVERY_SPECS) as SeikoMatsudaRecoveryWorkKey[],
);

export type SeikoMatsudaRecoveryCover = {
  provider: "seiko-matsuda-official";
  scope: "WORK";
  matchLevel: "WORK_EXACT";
  url: string;
  sourceUrl: string;
  observedAlt: string;
  requiresAssetValidation: true;
  auditedAsset: SeikoMatsudaRecoverySpec["auditedAsset"];
};

export type SeikoMatsudaRecoveryCarrierEvidence = {
  provider: "seiko-matsuda-official";
  sourceUrl: string;
  role: "AUTHORITATIVE";
  strength: "STRONG";
  matchedFields: readonly ["artist", "title", "category", "date", "catalogNumber", "format"];
  facts: Record<string, string | null>;
};

export type SeikoMatsudaRecoveryEntity = {
  manifestEntryKey: SeikoMatsudaRecoveryWorkKey;
  sourceUrl: string;
  provider: "seiko-matsuda-official";
  sourceType: "official-artist-entity-page";
  evidenceScope: "single-item-page";
  observedArtist: "松田聖子";
  observedTitle: string;
  canonicalTitle: string;
  observedCategory: "SINGLE" | "ALBUM";
  manifestCategory: "SINGLE" | "ORIGINAL_ALBUM";
  observedReleaseDate: string;
  observedCatalogDisplay: string;
  observedCatalogNumbers: string[];
  selectionPolicy: SeikoMatsudaRecoverySelectionPolicy;
  carrier: SeikoMatsudaRecoveryCarrierEvidence;
  cover: SeikoMatsudaRecoveryCover;
};

export type SeikoMatsudaRecoveryFailureCode =
  | "invalid-source-url"
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "redirect-not-allowed"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-html"
  | "artist-identity-mismatch"
  | "category-mismatch"
  | "title-mismatch"
  | "date-mismatch"
  | "catalog-mismatch"
  | "cover-count-mismatch"
  | "cover-title-mismatch"
  | "cover-url-invalid";

export class SeikoMatsudaRecoveryFailure extends Error {
  constructor(
    readonly code: SeikoMatsudaRecoveryFailureCode,
    readonly retryable: boolean,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "SeikoMatsudaRecoveryFailure";
  }
}

export type SeikoMatsudaRecoveryOutcome =
  | {
      workKey: SeikoMatsudaRecoveryWorkKey;
      sourceUrl: string;
      status: "VERIFIED";
      entity: SeikoMatsudaRecoveryEntity;
      failure: null;
    }
  | {
      workKey: SeikoMatsudaRecoveryWorkKey;
      sourceUrl: string;
      status: "FAILED";
      entity: null;
      failure: {
        code: SeikoMatsudaRecoveryFailureCode;
        retryable: boolean;
        message: string;
      };
    };

export type SeikoMatsudaRecoveryResult = {
  status: "COMPLETE" | "PARTIAL" | "FAILED";
  requestedKeys: SeikoMatsudaRecoveryWorkKey[];
  outcomes: SeikoMatsudaRecoveryOutcome[];
  verified: SeikoMatsudaRecoveryEntity[];
  byManifestEntryKey: Partial<Record<SeikoMatsudaRecoveryWorkKey, SeikoMatsudaRecoveryEntity>>;
  stats: {
    requested: number;
    cacheHits: number;
    dnsLookups: number;
    requestsAttempted: number;
    responsesFetched: number;
    retries: number;
    pagesParsed: number;
    failures: number;
  };
};

export type SeikoMatsudaRecoveryClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  concurrency?: number;
  minimumIntervalMs?: number;
  cacheTtlMs?: number;
  maxPageBytes?: number;
};

type MutableStats = SeikoMatsudaRecoveryResult["stats"];

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function freshStats(requested: number): MutableStats {
  return {
    requested,
    cacheHits: 0,
    dnsLookups: 0,
    requestsAttempted: 0,
    responsesFetched: 0,
    retries: 0,
    pagesParsed: 0,
    failures: 0,
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

function exactText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/gu, " ").trim();
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
  ))].map((match) => exactText(match[1] ?? ""));
}

function uniqueClassText(
  html: string,
  tagName: string,
  className: string,
  code: SeikoMatsudaRecoveryFailureCode,
) {
  const values = classTexts(html, tagName, className);
  if (values.length !== 1 || !values[0]) {
    throw new SeikoMatsudaRecoveryFailure(
      code,
      false,
      `The official recovery page did not contain exactly one ${className} field.`,
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
  const match = value.match(/^リリース：(\d{4})年(\d{2})月(\d{2})日$/u);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return fullIsoDate(date) ? date : null;
}

function parseActiveCategoryPath(html: string) {
  const paths = [...html.matchAll(/<a\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /(?:^|\s)active(?:\s|$)/u.test(tagAttribute(tag, "class")))
    .map((tag) => tagAttribute(tag, "href"))
    .filter((href) => href === "/discography/single" || href === "/discography/album");
  return paths.length === 1 ? paths[0] : null;
}

function validSpecUrl(spec: SeikoMatsudaRecoverySpec) {
  const validated = validateOfficialMusicUrl(spec.sourceUrl);
  if (!validated.ok) return false;
  const url = validated.url;
  return url.toString() === spec.sourceUrl &&
    url.origin === SEIKO_MATSUDA_RECOVERY_ORIGIN &&
    url.hostname === OFFICIAL_HOSTNAME &&
    !url.search &&
    !url.hash &&
    url.pathname === `/discography/detail/${spec.detailId}`;
}

function safeCoverUrl(raw: string, spec: SeikoMatsudaRecoverySpec) {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(raw), SEIKO_MATSUDA_RECOVERY_ORIGIN);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== SEIKO_MATSUDA_RECOVERY_ORIGIN ||
    url.hostname !== OFFICIAL_HOSTNAME ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== spec.coverPath
  ) return null;
  return url.toString();
}

function recoverySpecFor(workKey: SeikoMatsudaRecoveryWorkKey) {
  return SEIKO_MATSUDA_RECOVERY_SPECS[workKey];
}

export function parseSeikoMatsudaRecoveryPage(
  workKey: SeikoMatsudaRecoveryWorkKey,
  html: string,
): SeikoMatsudaRecoveryEntity {
  const spec = recoverySpecFor(workKey);
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    new TextEncoder().encode(html).byteLength > HARD_MAX_PAGE_BYTES
  ) {
    throw new SeikoMatsudaRecoveryFailure(
      html.length > 0 ? "response-too-large" : "invalid-html",
      false,
      "The official recovery page was empty or exceeded its hard byte limit.",
    );
  }

  const pageTitles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)]
    .map((match) => exactText(match[1] ?? ""));
  const artistLogos = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => tagAttribute(tag, "src") === "/img/logo.png")
    .map((tag) => tagAttribute(tag, "alt"));
  const discographyContainers = [...html.matchAll(/<div\b[^>]*\bid=["']discography["'][^>]*>/gi)];
  if (
    pageTitles.length !== 1 ||
    pageTitles[0] !== OFFICIAL_SHELL_TITLE ||
    artistLogos.length !== 1 ||
    artistLogos[0] !== OFFICIAL_ARTIST ||
    discographyContainers.length !== 1
  ) {
    throw new SeikoMatsudaRecoveryFailure(
      "artist-identity-mismatch",
      false,
      "The official recovery page did not retain the exact Seiko Matsuda site shell.",
    );
  }

  const categoryLabel = uniqueClassText(
    html,
    "p",
    "info-title-message",
    "category-mismatch",
  );
  if (
    categoryLabel !== spec.officialCategoryLabel ||
    parseActiveCategoryPath(html) !== spec.activeCategoryPath
  ) {
    throw new SeikoMatsudaRecoveryFailure(
      "category-mismatch",
      false,
      "The official recovery page category did not match its fixed work category.",
    );
  }

  const observedTitle = uniqueClassText(html, "p", "info-disk-title", "title-mismatch");
  if (observedTitle !== spec.pageTitle) {
    throw new SeikoMatsudaRecoveryFailure(
      "title-mismatch",
      false,
      "The official recovery page title did not exactly match the fixed complete title.",
    );
  }
  if (
    spec.workKey === "ORIGINAL_ALBUM:53" &&
    (spec.selectionPolicy !== "NORMAL_EDITION" || observedTitle !== "SEIKO MATSUDA 2020【通常盤】")
  ) {
    throw new SeikoMatsudaRecoveryFailure(
      "title-mismatch",
      false,
      "SEIKO MATSUDA 2020 recovery is restricted to the explicitly selected normal edition.",
    );
  }

  const info = classTexts(html, "p", "info-p");
  const catalogLines = info.filter((value) => value.startsWith("商品番号："));
  const dateLines = info.filter((value) => value.startsWith("リリース："));
  if (
    catalogLines.length !== 1 ||
    catalogLines[0] !== `商品番号：${spec.catalogDisplay}`
  ) {
    throw new SeikoMatsudaRecoveryFailure(
      "catalog-mismatch",
      false,
      "The official recovery page catalog boundary did not match the fixed product.",
    );
  }
  const observedDate = dateLines.length === 1
    ? parseJapaneseReleaseDate(dateLines[0]!)
    : null;
  if (!observedDate || observedDate !== spec.releaseDate) {
    throw new SeikoMatsudaRecoveryFailure(
      "date-mismatch",
      false,
      "The official recovery page did not expose the exact fixed release date.",
    );
  }

  const coverTags = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => tagAttribute(tag, "src").includes("/discography/images/upload/"));
  if (coverTags.length !== 1) {
    throw new SeikoMatsudaRecoveryFailure(
      "cover-count-mismatch",
      false,
      "The official recovery page did not contain exactly one discography cover.",
    );
  }
  const observedAlt = tagAttribute(coverTags[0]!, "alt");
  if (observedAlt !== observedTitle) {
    throw new SeikoMatsudaRecoveryFailure(
      "cover-title-mismatch",
      false,
      "The official recovery cover alt did not bind to the complete page title.",
    );
  }
  const coverUrl = safeCoverUrl(tagAttribute(coverTags[0]!, "src"), spec);
  if (!coverUrl) {
    throw new SeikoMatsudaRecoveryFailure(
      "cover-url-invalid",
      false,
      "The official recovery cover violated the fixed HTTPS host and path allowlist.",
    );
  }

  const facts: Record<string, string | null> = {
    manifestEntryKey: workKey,
    verified: "true",
    unique: "true",
    dynamicOfficialCarrier: "true",
    provenanceSourceUrl: spec.sourceUrl,
    fixedPageId: String(spec.detailId),
    artist: OFFICIAL_ARTIST,
    artistCredit: OFFICIAL_ARTIST,
    title: observedTitle,
    canonicalTitle: spec.canonicalTitle,
    category: spec.manifestCategory,
    officialCategory: spec.officialCategory,
    date: observedDate,
    originalReleaseDate: observedDate,
    catalogNumber: spec.catalogNumbers[0] ?? null,
    catalogNumbers: spec.catalogNumbers.join(","),
    carrier: "CD",
    format: "CD",
    country: "JP",
    status: "Official",
    selectionPolicy: spec.selectionPolicy,
    coverUrl,
    auditedCoverSha256: spec.auditedAsset.sha256,
  };
  const carrier: SeikoMatsudaRecoveryCarrierEvidence = {
    provider: "seiko-matsuda-official",
    sourceUrl: spec.sourceUrl,
    role: "AUTHORITATIVE",
    strength: "STRONG",
    matchedFields: ["artist", "title", "category", "date", "catalogNumber", "format"],
    facts,
  };
  const cover: SeikoMatsudaRecoveryCover = {
    provider: "seiko-matsuda-official",
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url: coverUrl,
    sourceUrl: spec.sourceUrl,
    observedAlt,
    requiresAssetValidation: true,
    auditedAsset: spec.auditedAsset,
  };
  return {
    manifestEntryKey: workKey,
    sourceUrl: spec.sourceUrl,
    provider: "seiko-matsuda-official",
    sourceType: "official-artist-entity-page",
    evidenceScope: "single-item-page",
    observedArtist: OFFICIAL_ARTIST,
    observedTitle,
    canonicalTitle: spec.canonicalTitle,
    observedCategory: spec.officialCategory,
    manifestCategory: spec.manifestCategory,
    observedReleaseDate: observedDate,
    observedCatalogDisplay: spec.catalogDisplay,
    observedCatalogNumbers: [...spec.catalogNumbers],
    selectionPolicy: spec.selectionPolicy,
    carrier,
    cover,
  };
}

function sourceFailure(error: unknown) {
  return error instanceof SeikoMatsudaRecoveryFailure
    ? error
    : new SeikoMatsudaRecoveryFailure(
        "network-unavailable",
        true,
        "The official recovery request failed.",
      );
}

function failureOutcome(
  spec: SeikoMatsudaRecoverySpec,
  failure: SeikoMatsudaRecoveryFailure,
): SeikoMatsudaRecoveryOutcome {
  return {
    workKey: spec.workKey as SeikoMatsudaRecoveryWorkKey,
    sourceUrl: spec.sourceUrl,
    status: "FAILED",
    entity: null,
    failure: {
      code: failure.code,
      retryable: failure.retryable,
      message: failure.message,
    },
  };
}

function verifiedOutcome(entity: SeikoMatsudaRecoveryEntity): SeikoMatsudaRecoveryOutcome {
  return {
    workKey: entity.manifestEntryKey,
    sourceUrl: entity.sourceUrl,
    status: "VERIFIED",
    entity,
    failure: null,
  };
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

async function readLimitedText(response: Response, maximumBytes: number) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SeikoMatsudaRecoveryFailure(
      "response-too-large",
      false,
      "The official recovery response exceeded its configured byte limit.",
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
        throw new SeikoMatsudaRecoveryFailure(
          "response-too-large",
          false,
          "The official recovery response exceeded its configured byte limit.",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof SeikoMatsudaRecoveryFailure) throw error;
    throw new SeikoMatsudaRecoveryFailure(
      "invalid-html",
      false,
      "The official recovery response was not valid UTF-8 HTML.",
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The response body may already be closed.
    }
  }
}

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await work(values[index]!);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return output;
}

function requestedKeys(keys: readonly SeikoMatsudaRecoveryWorkKey[]) {
  if (keys.length === 0 || keys.length > HARD_MAX_CACHE_ENTRIES) {
    throw new TypeError("Seiko recovery requires between 1 and 26 fixed work keys.");
  }
  const unique = new Set<SeikoMatsudaRecoveryWorkKey>();
  for (const key of keys) {
    if (!(key in SEIKO_MATSUDA_RECOVERY_SPECS)) {
      throw new TypeError(`Unknown Seiko recovery work key: ${String(key)}`);
    }
    if (unique.has(key)) {
      throw new TypeError(`Duplicate Seiko recovery work key: ${key}`);
    }
    unique.add(key);
  }
  return [...unique];
}

export class SeikoMatsudaRecoveryClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;
  private readonly concurrency: number;
  private readonly minimumIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxPageBytes: number;
  private readonly cache = new Map<
    SeikoMatsudaRecoveryWorkKey,
    { expiresAt: number; entity: SeikoMatsudaRecoveryEntity }
  >();
  private nextAllowedAt = 0;
  private throttleQueue = Promise.resolve();

  constructor(options: SeikoMatsudaRecoveryClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 20_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
    this.retryDelayMs = clampInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 2_000);
    this.concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 3);
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
    this.maxPageBytes = clampInteger(
      options.maxPageBytes,
      DEFAULT_MAX_PAGE_BYTES,
      1_024,
      HARD_MAX_PAGE_BYTES,
    );
  }

  clearCache() {
    this.cache.clear();
  }

  private cached(workKey: SeikoMatsudaRecoveryWorkKey) {
    const cached = this.cache.get(workKey);
    if (!cached) return null;
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(workKey);
      return null;
    }
    return cached.entity;
  }

  private store(entity: SeikoMatsudaRecoveryEntity) {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(entity.manifestEntryKey, {
      expiresAt: this.now() + this.cacheTtlMs,
      entity,
    });
    if (this.cache.size > HARD_MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as SeikoMatsudaRecoveryWorkKey | undefined;
      if (oldest) this.cache.delete(oldest);
    }
  }

  private async throttle() {
    let release!: () => void;
    const previous = this.throttleQueue;
    this.throttleQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + this.minimumIntervalMs;
    } finally {
      release();
    }
  }

  private async requestOnce(spec: SeikoMatsudaRecoverySpec, stats: MutableStats) {
    if (!validSpecUrl(spec)) {
      throw new SeikoMatsudaRecoveryFailure(
        "invalid-source-url",
        false,
        "A Seiko recovery request violated the fixed HTTPS host and detail-path allowlist.",
      );
    }
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    stats.requestsAttempted += 1;
    try {
      const response = await this.fetchImpl(spec.sourceUrl, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "Accept-Language": "ja",
          "User-Agent": "CD-BOX/1.0 Seiko-Matsuda-recovery-audit (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SeikoMatsudaRecoveryFailure(
          "redirect-not-allowed",
          false,
          "The fixed Seiko recovery page attempted a redirect.",
        );
      }
      if (!response.ok) {
        const delay = retryAfterMs(response, this.now);
        await response.body?.cancel().catch(() => undefined);
        throw new SeikoMatsudaRecoveryFailure(
          "http-status",
          retryableStatus(response.status),
          `The fixed Seiko recovery page returned HTTP ${response.status}.`,
          delay,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !contentType.startsWith("text/html") &&
        !contentType.startsWith("application/xhtml+xml")
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new SeikoMatsudaRecoveryFailure(
          "unsupported-content-type",
          false,
          "The fixed Seiko recovery page returned a non-HTML content type.",
        );
      }
      const html = await readLimitedText(response, this.maxPageBytes);
      stats.responsesFetched += 1;
      return html;
    } catch (error) {
      if (error instanceof SeikoMatsudaRecoveryFailure) throw error;
      if (controller.signal.aborted) {
        throw new SeikoMatsudaRecoveryFailure(
          "network-timeout",
          true,
          "The fixed Seiko recovery request timed out.",
        );
      }
      throw new SeikoMatsudaRecoveryFailure(
        "network-unavailable",
        true,
        "The fixed Seiko recovery request failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(spec: SeikoMatsudaRecoverySpec, stats: MutableStats) {
    let lastFailure: SeikoMatsudaRecoveryFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        return await this.requestOnce(spec, stats);
      } catch (error) {
        const failure = sourceFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.retryCount) throw failure;
        stats.retries += 1;
        await this.sleep(
          failure.retryAfterMs ?? Math.min(2_000, this.retryDelayMs * 2 ** attempt),
        );
      }
    }
    throw lastFailure ?? new SeikoMatsudaRecoveryFailure(
      "network-unavailable",
      true,
      "The fixed Seiko recovery request failed.",
    );
  }

  private async fetchEntity(
    workKey: SeikoMatsudaRecoveryWorkKey,
    stats: MutableStats,
  ): Promise<SeikoMatsudaRecoveryOutcome> {
    const spec = recoverySpecFor(workKey);
    try {
      const html = await this.request(spec, stats);
      const entity = parseSeikoMatsudaRecoveryPage(workKey, html);
      stats.pagesParsed += 1;
      this.store(entity);
      return verifiedOutcome(entity);
    } catch (error) {
      return failureOutcome(spec, sourceFailure(error));
    }
  }

  async load(
    keys: readonly SeikoMatsudaRecoveryWorkKey[] = SEIKO_MATSUDA_RECOVERY_WORK_KEYS,
  ): Promise<SeikoMatsudaRecoveryResult> {
    const normalizedKeys = requestedKeys(keys);
    const stats = freshStats(normalizedKeys.length);
    const outcomesByKey = new Map<SeikoMatsudaRecoveryWorkKey, SeikoMatsudaRecoveryOutcome>();
    const missing: SeikoMatsudaRecoveryWorkKey[] = [];
    for (const key of normalizedKeys) {
      const entity = this.cached(key);
      if (entity) {
        stats.cacheHits += 1;
        outcomesByKey.set(key, verifiedOutcome(entity));
      } else {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      stats.dnsLookups += 1;
      const resolved = await resolvePublicOfficialHost(OFFICIAL_HOSTNAME, this.resolveHost);
      if (!resolved.ok) {
        const failure = new SeikoMatsudaRecoveryFailure(
          resolved.reason,
          true,
          resolved.reason === "non-public-address"
            ? "The Seiko recovery host resolved to a non-public address."
            : "The Seiko recovery host could not be resolved.",
        );
        for (const key of missing) {
          outcomesByKey.set(key, failureOutcome(recoverySpecFor(key), failure));
        }
      } else {
        const fetched = await boundedMap(
          missing,
          this.concurrency,
          (key) => this.fetchEntity(key, stats),
        );
        fetched.forEach((outcome) => outcomesByKey.set(outcome.workKey, outcome));
      }
    }

    const outcomes = normalizedKeys.map((key) => outcomesByKey.get(key)!);
    const verified = outcomes
      .filter((outcome): outcome is Extract<SeikoMatsudaRecoveryOutcome, { status: "VERIFIED" }> =>
        outcome.status === "VERIFIED")
      .map((outcome) => outcome.entity);
    stats.failures = outcomes.length - verified.length;
    return {
      status: verified.length === outcomes.length
        ? "COMPLETE"
        : verified.length === 0 ? "FAILED" : "PARTIAL",
      requestedKeys: normalizedKeys,
      outcomes,
      verified,
      byManifestEntryKey: Object.fromEntries(
        verified.map((entity) => [entity.manifestEntryKey, entity]),
      ),
      stats,
    };
  }

  async loadKey(workKey: SeikoMatsudaRecoveryWorkKey) {
    const result = await this.load([workKey]);
    return result.outcomes[0]!;
  }
}

export function seikoMatsudaRecoveryDetailUrl(workKey: SeikoMatsudaRecoveryWorkKey) {
  return recoverySpecFor(workKey).sourceUrl;
}

export async function fetchSeikoMatsudaRecovery(
  options: SeikoMatsudaRecoveryClientOptions = {},
  keys: readonly SeikoMatsudaRecoveryWorkKey[] = SEIKO_MATSUDA_RECOVERY_WORK_KEYS,
) {
  return new SeikoMatsudaRecoveryClient(options).load(keys);
}
