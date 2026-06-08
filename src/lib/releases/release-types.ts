import type { CollectionStatus, ReleaseCategory, ReleaseFormat } from "@prisma/client";

export const collectionStatuses = ["OWNED", "NOT_OWNED", "WANTED", "EXCLUDED", "PENDING_REVIEW"] as const;
export type EditableCollectionStatus = (typeof collectionStatuses)[number];

export const releaseCategories: ReleaseCategory[] = [
  "ORIGINAL_ALBUM",
  "SINGLE",
  "BEST",
  "COLLECTION",
  "COMPILATION",
  "LIVE",
  "REMIX",
  "BOX",
  "EP",
  "OTHER",
];

export const releaseFormats: ReleaseFormat[] = [
  "CD",
  "SHM_CD",
  "BLU_SPEC_CD",
  "SACD",
  "HYBRID_SACD",
  "CD_DVD",
  "BOX_SET",
  "OTHER",
];

export type ReleaseSourceView = {
  id: string;
  url: string;
  label: string | null;
  description: string | null;
};

export type ReleaseStatusView = {
  id: string;
  status: CollectionStatus;
  priority: number;
  ownedCondition: string | null;
  ownedNotes: string | null;
  notes: string | null;
};

export type ReleaseListItem = {
  id: string;
  artistId: string;
  category: ReleaseCategory;
  title: string;
  originalReleaseDate: string | null;
  format: ReleaseFormat;
  originalCatalogNo: string | null;
  label: string | null;
  originalPrice: string | null;
  editionType: string | null;
  isReissue: boolean;
  isRemaster: boolean;
  isExcludedByDefault: boolean;
  confidence: string | null;
  warnings: string[];
  notes: string | null;
  coverImageUrl: string | null;
  sources: ReleaseSourceView[];
  userStatus: ReleaseStatusView | null;
};

export type ReleaseFilters = {
  q?: string;
  category?: string;
  status?: string;
  confidence?: string;
  excluded?: "true" | "false";
  reissue?: "true" | "false";
  remaster?: "true" | "false";
  missingCover?: "true";
  missingSource?: "true";
  missingCatalog?: "true";
  pendingReview?: "true";
  gap?: "true";
  decade?: "1980s" | "1990s" | "2000s" | "custom" | "";
  yearFrom?: string;
  yearTo?: string;
};

export type ArtistStats = {
  total: number;
  owned: number;
  notOwned: number;
  wanted: number;
  pendingReview: number;
  excluded: number;
  missingCover: number;
  missingSource: number;
  missingCatalog: number;
  completionRate: number;
  categoryCompletion: Array<{
    key: string;
    label: string;
    owned: number;
    total: number;
    rate: number;
  }>;
};

export type ReleasePatchInput = {
  title?: string;
  category?: ReleaseCategory;
  releaseDate?: string | null;
  format?: ReleaseFormat;
  catalogNumber?: string | null;
  label?: string | null;
  originalPrice?: string | null;
  editionType?: string | null;
  isReissue?: boolean;
  isRemaster?: boolean;
  isExcludedByDefault?: boolean;
  coverImageUrl?: string | null;
  notes?: string | null;
};

export type ReleaseStatusPatchInput = {
  status?: EditableCollectionStatus;
  priority?: number;
  ownedCondition?: string | null;
  ownedNotes?: string | null;
};

export type BulkUpdateInput = {
  artistId: string;
  releaseIds: string[];
  status?: EditableCollectionStatus;
  priority?: number;
  isExcludedByDefault?: boolean;
};
