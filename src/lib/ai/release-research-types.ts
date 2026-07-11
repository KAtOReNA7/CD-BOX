import type { ReleaseCategory } from "@prisma/client";

export type CollectionScopeTarget = "ORIGINAL_CD" | "ALL_CD" | "ALL_PHYSICAL";
export type ResearchTaskStatus = "pending" | "running" | "succeeded" | "failed";
export type ResearchConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ResearchSourceType = "official" | "retailer" | "database" | "news" | "other";

export type ReleaseVerification = {
  status: "VERIFIED";
  method: "musicbrainz-ndl-discogs-ai";
  aiDecision: "ACCEPT";
  aiReason: string;
  checkedAt: string;
  matchedFields: string[];
  sourceUrls: string[];
  coverProvider: "cover-art-archive" | "discogs";
  coverCheckedAt: string;
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
};

export type ReleaseResearchRequest = {
  artistName: string;
  country: string;
  target: CollectionScopeTarget;
  excludeReissues: boolean;
  includeCollaborations: boolean;
  includeLiveRemixBest: boolean;
};

export type ReleaseResearchSource = {
  title: string;
  url: string;
  sourceType: ResearchSourceType;
};

export type ReleaseResearchCandidate = {
  id: string;
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
  globalWarnings: string[];
  verificationSummary?: ReleaseResearchVerificationSummary | null;
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
