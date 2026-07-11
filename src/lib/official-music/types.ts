export const OFFICIAL_MUSIC_MATCHED_FIELDS = [
  "catalogNumber",
  "title",
  "date",
] as const;

export type OfficialMusicMatchedField = typeof OFFICIAL_MUSIC_MATCHED_FIELDS[number];

export type OfficialMusicCandidate = {
  id: string;
  title: string;
  date: string | null;
  catalogNumber: string | null;
};

export type OfficialMusicPageEvidence = {
  candidateId: string;
  sourceType: "official";
  url: string;
  pageTitle: string | null;
  evidenceScope: "structured-entity" | "product-block" | "single-item-page";
  matchedFields: OfficialMusicMatchedField[];
  observedDate: string;
  datePrecision: "year" | "month" | "day";
};

export type OfficialMusicCandidateResult = {
  candidateId: string;
  evidence: OfficialMusicPageEvidence | null;
};

export type OfficialMusicWarningCode =
  | "invalid-candidate"
  | "duplicate-candidate-id"
  | "candidate-limit"
  | "invalid-official-url"
  | "blocked-official-host"
  | "dns-resolution-failed"
  | "non-public-address"
  | "cross-origin-redirect"
  | "invalid-redirect"
  | "redirect-limit"
  | "redirect-loop"
  | "network-timeout"
  | "network-unavailable"
  | "rate-limited"
  | "http-status"
  | "unsupported-content-type"
  | "page-too-large"
  | "invalid-html"
  | "link-limit"
  | "page-limit"
  | "ambiguous-official-match";

export type OfficialMusicWarning = {
  code: OfficialMusicWarningCode;
  message: string;
  retryable: boolean;
  url?: string;
  candidateId?: string;
  count?: number;
};

export type OfficialMusicResearchInput = {
  officialUrls: string[];
  candidates: OfficialMusicCandidate[];
};

export type OfficialMusicResearchResult = {
  candidates: OfficialMusicCandidateResult[];
  warnings: OfficialMusicWarning[];
  stats: {
    rootsAccepted: number;
    pagesAttempted: number;
    pagesFetched: number;
    pagesDiscovered: number;
    candidatesInspected: number;
    candidatesMatched: number;
    ambiguousCandidates: number;
  };
};

export type OfficialMusicFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OfficialMusicHostResolver = (hostname: string) => Promise<string[]>;

export type OfficialMusicClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  minimumIntervalMs?: number;
  maxRedirects?: number;
  maxPages?: number;
  maxPageBytes?: number;
  maxLinksPerPage?: number;
  userAgent?: string;
};
