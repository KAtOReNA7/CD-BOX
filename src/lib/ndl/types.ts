import type { NDL_EVIDENCE_ROLE } from "@/lib/ndl/constants";

export type NdlDatePrecision = "year" | "month" | "day";

export type NdlIdentifier = {
  value: string;
  scheme: string | null;
};

export type NdlRecord = {
  recordId: string;
  sourceUrl: string;
  title: string;
  creators: string[];
  publishers: string[];
  issued: string | null;
  issuedRaw: string | null;
  issuedPrecision: NdlDatePrecision | null;
  identifiers: string[];
  identifierDetails: NdlIdentifier[];
  catalogNumbers: string[];
};

export type NdlSearchResponse = {
  queryUrl: string;
  sourceTotal: number;
  records: NdlRecord[];
  complete: boolean;
};

export type NdlWarningCode =
  | "invalid-query"
  | "network-timeout"
  | "network-unavailable"
  | "rate-limited"
  | "http-status"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-xml"
  | "partial-results";

export type NdlWarning = {
  code: NdlWarningCode;
  message: string;
  retryable: boolean;
  status: number | null;
};

export type NdlClientResult = {
  value: NdlSearchResponse | null;
  warnings: NdlWarning[];
};

export type NdlFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NdlClientOptions = {
  fetchImpl?: NdlFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  minimumIntervalMs?: number;
  cacheTtlMs?: number;
  cacheSize?: number;
  maxResponseBytes?: number;
  userAgent?: string;
};

export type NdlCandidate = {
  artist: string;
  artistAliases?: readonly string[];
  title: string;
  titleAliases?: readonly string[];
  catalogNumber: string;
  date: string;
};

export type NdlEvidence = {
  sourceType: typeof NDL_EVIDENCE_ROLE;
  provider: "ndl-search";
  recordId: string;
  sourceUrl: string;
  observedTitle: string;
  authoritativeTitle: string;
  observedCatalogNumber: string;
  observedIssued: string;
  observedIssuedPrecision: NdlDatePrecision;
  publishers: string[];
  matchedFields: Array<"artist" | "catalogNumber" | "title" | "date">;
  titleComparison: "controlled-equivalent" | "requires-ai";
};

export type NdlMatchFailureReason =
  | "invalid-candidate"
  | "incomplete-results"
  | "catalog-not-found"
  | "ambiguous-catalog"
  | "artist-mismatch"
  | "title-mismatch"
  | "date-missing"
  | "date-conflict";

export type NdlMatchDecision =
  | { evidence: NdlEvidence; reason: null }
  | { evidence: null; reason: NdlMatchFailureReason };
