export const DISCOGS_EVIDENCE_ROLE = "corroborating-only" as const;

export type DiscogsEvidenceRole = typeof DISCOGS_EVIDENCE_ROLE;

export type DiscogsWarningCode =
  | "invalid-response"
  | "partial-results"
  | "rate-limited"
  | "unavailable";

export type DiscogsWarning = {
  code: DiscogsWarningCode;
  message: string;
  retryable: boolean;
};

export type DiscogsRateLimit = {
  limit: number | null;
  used: number | null;
  remaining: number | null;
};

export type DiscogsResult<T> = {
  value: T;
  warnings: DiscogsWarning[];
  rateLimit: DiscogsRateLimit | null;
};

export type DiscogsSearchReleaseEvidence = {
  evidenceRole: DiscogsEvidenceRole;
  releaseId: number;
  masterId: number | null;
  title: string;
  year: number | null;
  country: "Japan";
  formats: string[];
  labels: string[];
  catalogNumber: string | null;
  barcode: string | null;
  apiUrl: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  coverImageUrl: string | null;
};

export type DiscogsJapanCdSearchPage = {
  page: number;
  pages: number;
  perPage: number;
  total: number;
};

export type DiscogsJapanCdSearchResult = {
  evidenceRole: DiscogsEvidenceRole;
  artistQuery: string;
  items: DiscogsSearchReleaseEvidence[];
  sourceTotal: number;
  pagesFetched: number;
  partial: boolean;
};

export type DiscogsArtistCredit = {
  name: string;
  anv: string | null;
  join: string | null;
};

export type DiscogsLabelEvidence = {
  name: string;
  catalogNumber: string | null;
};

export type DiscogsFormatEvidence = {
  name: string;
  quantity: number | null;
  descriptions: string[];
};

export type DiscogsIdentifierEvidence = {
  type: string;
  value: string;
  description: string | null;
};

export type DiscogsTrackEvidence = {
  position: string | null;
  title: string;
  duration: string | null;
  type: string | null;
};

export type DiscogsImageEvidence = {
  type: "primary" | "secondary";
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Source-faithful Discogs evidence. It is deliberately marked as
 * corroborating-only: callers must compare it with an independent catalogue
 * and must never treat this object alone as proof that a release is correct.
 */
export type DiscogsReleaseEvidence = {
  evidenceRole: DiscogsEvidenceRole;
  releaseId: number;
  masterId: number | null;
  status: string | null;
  dataQuality: string | null;
  title: string;
  artistCredit: string | null;
  artists: DiscogsArtistCredit[];
  year: number | null;
  released: string | null;
  country: string | null;
  labels: DiscogsLabelEvidence[];
  formats: DiscogsFormatEvidence[];
  identifiers: DiscogsIdentifierEvidence[];
  barcodes: string[];
  tracks: DiscogsTrackEvidence[];
  images: DiscogsImageEvidence[];
  primaryImageUrl: string | null;
  apiUrl: string;
  sourceUrl: string;
};

export type DiscogsFetchResponse = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type DiscogsFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<DiscogsFetchResponse>;

export type DiscogsClientOptions = {
  userAgent?: string;
  fetchImpl?: DiscogsFetch;
  timeoutMs?: number;
  retryCount?: number;
  minimumIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export type DiscogsJapanCdSearchOptions = {
  perPage?: number;
  maxPages?: number;
  maxItems?: number;
};
