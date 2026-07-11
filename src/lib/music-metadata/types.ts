export type MusicMetadataProvider = "musicbrainz" | "cover-art-archive";

export type MusicMetadataWarningCode =
  | "invalid-response"
  | "rate-limited"
  | "unavailable";

export type MusicMetadataWarning = {
  source: MusicMetadataProvider;
  code: MusicMetadataWarningCode;
  message: string;
  retryable: boolean;
};

export type MusicMetadataResult<T> = {
  value: T;
  warnings: MusicMetadataWarning[];
};

export type MusicMetadataSource = {
  provider: MusicMetadataProvider;
  title: string;
  url: string;
};

export type ArtistAliasEvidence = {
  name: string;
  sortName: string | null;
  locale: string | null;
  type: string | null;
  primary: boolean;
};

export type MusicArtistEvidence = {
  sourceId: string;
  name: string;
  sortName: string | null;
  aliases: ArtistAliasEvidence[];
  country: string | null;
  type: string | null;
  disambiguation: string | null;
  score: number | null;
  sourceUrl: string;
  sources: MusicMetadataSource[];
};

export type ReleaseLabelEvidence = {
  name: string | null;
  catalogNumber: string | null;
};

/**
 * A source-faithful view shared by MusicBrainz release groups and releases.
 *
 * A scalar label/catalog number/format is present only when the source has one
 * unambiguous value. The arrays preserve every source value when there are
 * multiple editions or media; callers must not silently choose one.
 */
export type MusicReleaseEvidence = {
  entityType: "release-group" | "release";
  sourceId: string;
  releaseGroupId: string | null;
  title: string;
  artistCredit: string | null;
  artistNames: string[];
  artistAliases: ArtistAliasEvidence[];
  date: string | null;
  type: string | null;
  secondaryTypes: string[];
  country: string | null;
  label: string | null;
  catalogNumber: string | null;
  format: string | null;
  labels: ReleaseLabelEvidence[];
  formats: string[];
  barcode: string | null;
  status: string | null;
  sourceUrl: string;
  coverUrl: string | null;
  coverSourceUrl: string | null;
  sources: MusicMetadataSource[];
};

export type CoverArtEvidence = {
  entityType: "release-group" | "release";
  sourceId: string;
  imageUrl: string;
  sourceUrl: string;
  approved: boolean | null;
  types: string[];
};

export type MusicMetadataPage<T> = {
  count: number | null;
  offset: number;
  limit: number;
  items: T[];
};

export type ArtistReleaseResearchTarget = "ORIGINAL_CD" | "ALL_CD" | "ALL_PHYSICAL";

export type ArtistReleaseEvidenceResearchInput = {
  artistName: string;
  aliases?: string[];
  country?: string | null;
  target: ArtistReleaseResearchTarget;
  excludeReissues: boolean;
  includeCollaborations: boolean;
  includeLiveRemixBest: boolean;
  maxCandidates?: number;
  maxCoverLookups?: number;
};

export type ArtistReleaseEvidenceWarningCode =
  | "artist-ambiguous"
  | "artist-country-mismatch"
  | "artist-country-unverified"
  | "artist-not-found"
  | "candidate-limit"
  | "collaboration-filtered"
  | "cover-lookup-limit"
  | "non-official-filtered"
  | "outside-country-filtered"
  | "outside-format-scope"
  | "release-type-filtered"
  | "reissue-status-unavailable"
  | "source-invalid-response"
  | "source-partial"
  | "source-rate-limited"
  | "source-unavailable";

export type ArtistReleaseEvidenceWarning = {
  code: ArtistReleaseEvidenceWarningCode;
  message: string;
  count?: number;
  source?: MusicMetadataProvider;
};

export type ReleaseEvidenceItemWarning =
  | "missing-catalog-number"
  | "missing-cover"
  | "missing-date"
  | "missing-label";

export type ArtistReleaseEvidenceItem = {
  evidence: MusicReleaseEvidence;
  warnings: ReleaseEvidenceItemWarning[];
};

export type ArtistReleaseEvidenceBundle = {
  query: {
    artistName: string;
    targetCountry: string;
    target: ArtistReleaseResearchTarget;
  };
  artist: MusicArtistEvidence | null;
  releases: ArtistReleaseEvidenceItem[];
  sourceWhitelist: string[];
  warnings: ArtistReleaseEvidenceWarning[];
  stats: {
    artistResultsInspected: number;
    releasesFetched: number;
    releasesAccepted: number;
    coverLookups: number;
  };
};
