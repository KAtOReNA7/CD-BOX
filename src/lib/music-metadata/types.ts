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
  /**
   * HTTPS public-domain URLs explicitly related as an "official homepage" by
   * MusicBrainz. These are discovered references, not proof that page content
   * has been independently verified.
   */
  officialUrls: string[];
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

/**
 * Scope classification is deliberately separate from factual verification.
 * Missing MusicBrainz fields are UNKNOWN and must remain available to later
 * sources; only an explicit conflict with the user's requested scope may be
 * OUT_OF_SCOPE.
 */
export type MusicReleaseScopeVerdict = "PASS" | "UNKNOWN" | "OUT_OF_SCOPE";

export type MusicReleaseScopeAssessment = {
  verdict: MusicReleaseScopeVerdict;
  reasonCodes: string[];
};

export type ArtistReleaseEditionEvidence = {
  workId: string;
  evidence: MusicReleaseEvidence;
  scope: MusicReleaseScopeAssessment;
};

export type ArtistReleaseWorkEvidence = {
  workId: string;
  releaseGroup: MusicReleaseEvidence | null;
  editions: ArtistReleaseEditionEvidence[];
};

export type ArtistReleaseEvidenceBundle = {
  query: {
    artistName: string;
    targetCountry: string;
    target: ArtistReleaseResearchTarget;
  };
  artist: MusicArtistEvidence | null;
  releases: ArtistReleaseEvidenceItem[];
  /** Every detailed edition fetched from MusicBrainz, including unknown and
   * explicitly out-of-scope rows. `releases` remains the legacy canonical view
   * until all callers have migrated to the work/edition model. */
  discoveredEditions?: ArtistReleaseEditionEvidence[];
  /** Work-level grouping that never discards editions. */
  works?: ArtistReleaseWorkEvidence[];
  sourceWhitelist: string[];
  warnings: ArtistReleaseEvidenceWarning[];
  stats: {
    artistResultsInspected: number;
    /** Unique release-group rows fetched from MusicBrainz before scope filtering. */
    releaseGroupsFetched?: number;
    /** Unique detailed release rows fetched from MusicBrainz before scope filtering. */
    releasesFetched: number;
    /** Detailed release rows that passed status/country/format/scope filtering. */
    releasesAcceptedBeforeGrouping?: number;
    /** Release groups represented by one canonical detailed release. */
    releaseGroupsAccepted?: number;
    /** Later/duplicate detailed releases removed by release-group consolidation. */
    releasesDeduplicated?: number;
    releasesAccepted: number;
    coverLookups: number;
  };
};
