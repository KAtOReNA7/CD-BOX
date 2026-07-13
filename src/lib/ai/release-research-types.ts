import type { ReleaseCategory } from "@prisma/client";

export type CollectionScopeTarget = "ORIGINAL_CD" | "ALL_CD" | "ALL_PHYSICAL";
export type ResearchTaskStatus = "pending" | "running" | "succeeded" | "failed";
export type ResearchConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ResearchSourceType = "official" | "retailer" | "database" | "news" | "other";

export type ReleaseVerification = {
  status: "VERIFIED";
  method: "musicbrainz-ndl-discogs-ai" | "multi-source-v2";
  policyVersion?: "multi-source-v2";
  aiDecision: "ACCEPT";
  aiReason: string;
  checkedAt: string;
  matchedFields: string[];
  sourceUrls: string[];
  authoritySourceUrls?: string[];
  corroboratingSourceUrls?: string[];
  workId?: string;
  editionId?: string;
  coverProvider: "cover-art-archive" | "discogs" | "apple-music" | "official-label";
  coverCheckedAt: string;
  /** SHA-256 recorded when the cover bytes were last validated. Legacy attestations may omit it. */
  coverContentSha256?: string;
  /** Legacy attestations may omit these; multi-source-v2 always records both. */
  coverMatchLevel?: "EDITION" | "WORK";
  sourceReleaseDate?: string | null;
};

export type ReleaseResearchVerificationSummary = {
  rawReleases: number;
  releaseGroups: number;
  canonicalEditions: number;
  authoritativeMatches: number;
  crossSourceMatches: number;
  aiAccepted: number;
  rejectedByEvidence: number;
  rejectedByAi: number;
  rejectedWithoutCover: number;
  rejectedCoverUnavailable: number;
  discoveredEditions?: number;
  evidenceReady?: number;
  verified?: number;
  pendingEvidence?: number;
  pendingCover?: number;
  rejected?: number;
  outOfScope?: number;
  verifiedWorks?: number;
};

export type ResearchEvidenceVerdict = "PASS" | "UNKNOWN" | "REJECT" | "OUT_OF_SCOPE";
export type ResearchCandidateResolution =
  | "VERIFIED"
  | "PENDING_EVIDENCE"
  | "PENDING_COVER"
  | "REJECTED"
  | "OUT_OF_SCOPE";

export type ReleaseResearchLedgerEntry = {
  stage: string;
  verdict: ResearchEvidenceVerdict;
  reasonCode: string;
  message: string;
  sourceUrls: string[];
  retryable: boolean;
  conflictIds?: string[];
};

export type ReleaseResearchRequest = {
  artistName: string;
  country: string;
  target: CollectionScopeTarget;
  excludeReissues: boolean;
  includeCollaborations: boolean;
  includeLiveRemixBest: boolean;
};

export const DEFAULT_RELEASE_RESEARCH_SCOPE = {
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: false,
} as const satisfies Pick<
  ReleaseResearchRequest,
  "target" | "excludeReissues" | "includeCollaborations" | "includeLiveRemixBest"
>;

export type ReleaseResearchSource = {
  title: string;
  url: string;
  sourceType: ResearchSourceType;
};

export type ReleaseResearchCandidate = {
  id: string;
  workId?: string | null;
  editionId?: string | null;
  title: string;
  titleOriginal: string | null;
  category: ReleaseCategory;
  artistCredit: string;
  releaseDate: string | null;
  originalReleaseDate: string | null;
  format: string | null;
  catalogNumber: string | null;
  barcode: string | null;
  label: string | null;
  originalPrice: string | null;
  editionType: string | null;
  isReissue: boolean | null;
  isRemaster: boolean | null;
  isExcludedByDefault: boolean;
  coverImageUrl: string | null;
  coverImageSourceUrl: string | null;
  notes: string | null;
  confidence: ResearchConfidence;
  warnings: string[];
  sources: ReleaseResearchSource[];
  verification?: ReleaseVerification | null;
};

export type ReleaseResearchCandidateAudit = {
  candidateId: string;
  workId: string;
  editionId: string;
  title: string;
  category: ReleaseCategory;
  /**
   * Stable work-level date used to bind an edition audit to the canonical
   * manifest. Optional so parsed results persisted before this field was
   * introduced remain readable; acceptance treats a missing value as an
   * incomplete canonical ledger rather than guessing from the edition date.
   */
  originalReleaseDate?: string | null;
  releaseDate: string | null;
  catalogNumber: string | null;
  resolution: ResearchCandidateResolution;
  evidenceVerdict: ResearchEvidenceVerdict;
  ledger: ReleaseResearchLedgerEntry[];
};

export type ReleaseResearchResult = {
  artist: {
    name: string;
    nameKana: string | null;
    nameRomaji: string | null;
    country: string;
    officialSiteUrl: string | null;
  };
  collectionScope: {
    target: CollectionScopeTarget;
    excludeReissues: boolean;
    includeCollaborations: boolean;
  };
  releases: ReleaseResearchCandidate[];
  pipelineVersion?: "legacy" | "multi-source-v2";
  verificationCandidates?: ReleaseResearchCandidateAudit[];
  globalWarnings: string[];
  verificationSummary?: ReleaseResearchVerificationSummary | null;
};

export type ReleaseResearchStageSummaryView = {
  stage: string;
  sequence: number;
  inputCount: number;
  passedCount: number;
  deferredCount: number;
  rejectedCount: number;
  mergedCount: number;
  retryCount: number;
  reasonCounts: Record<string, number>;
  detailsComplete: boolean;
  startedAt: string | null;
  completedAt: string | null;
};

export type AiSearchTaskView = {
  id: string;
  status: ResearchTaskStatus;
  progress?: number;
  stage?: string | null;
  query: string;
  model: string;
  errorMessage: string | null;
  rawResult: unknown;
  parsedResult: ReleaseResearchResult | null;
  /** Computed by the same server-side hard gate used immediately before import. */
  trustedFinalCandidateIds: string[];
  stageSummaries: ReleaseResearchStageSummaryView[];
  createdAt: string;
  updatedAt: string;
};

export type ReleaseResearchImportInput = {
  artistMode: "create" | "existing";
  artistId?: string;
  artistName?: string;
  selectedCandidateIds: string[];
  excludedCandidateIds: string[];
  pendingReviewCandidateIds: string[];
  candidateEdits: Record<string, ReleaseResearchCandidateEdit>;
};

export type ReleaseResearchCandidateEdit = Pick<
  ReleaseResearchCandidate,
  | "title"
  | "category"
  | "artistCredit"
  | "originalReleaseDate"
  | "format"
  | "catalogNumber"
  | "label"
  | "coverImageUrl"
  | "isReissue"
  | "isRemaster"
  | "notes"
>;
