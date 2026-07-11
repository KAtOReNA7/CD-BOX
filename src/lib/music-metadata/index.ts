export {
  DEFAULT_MUSIC_METADATA_USER_AGENT,
  MusicMetadataClient,
  musicMetadataClient,
} from "@/lib/music-metadata/client";
export {
  isWhitelistedMusicMetadataSourceUrl,
  researchArtistReleaseEvidence,
  resolveMusicMetadataCountryCode,
} from "@/lib/music-metadata/research";
export type {
  ArtistReleaseBrowseOptions,
  MusicMetadataClientOptions,
  MusicMetadataPageOptions,
} from "@/lib/music-metadata/client";
export type {
  ResearchArtistReleaseEvidenceOptions,
} from "@/lib/music-metadata/research";
export type {
  MusicMetadataFetch,
  MusicMetadataFetchResponse,
} from "@/lib/music-metadata/transport";
export type {
  ArtistAliasEvidence,
  ArtistReleaseEvidenceBundle,
  ArtistReleaseEvidenceItem,
  ArtistReleaseEvidenceResearchInput,
  ArtistReleaseEvidenceWarning,
  ArtistReleaseEvidenceWarningCode,
  ArtistReleaseResearchTarget,
  CoverArtEvidence,
  MusicArtistEvidence,
  MusicMetadataPage,
  MusicMetadataProvider,
  MusicMetadataResult,
  MusicMetadataSource,
  MusicMetadataWarning,
  MusicMetadataWarningCode,
  MusicReleaseEvidence,
  ReleaseLabelEvidence,
  ReleaseEvidenceItemWarning,
} from "@/lib/music-metadata/types";
