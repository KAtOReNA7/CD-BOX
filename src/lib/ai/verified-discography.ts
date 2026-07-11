import type { ArtistReleaseEvidenceBundle } from "@/lib/music-metadata/types";
import {
  isAllowedVerifiedCoverAssetHost,
  isAllowedVerifiedCoverAssetUrl,
  validateCoverAsset,
} from "@/lib/ai/cover-asset-validation";
import {
  auditReleaseEvidenceWithAi,
  type ReleaseCrossSourceEvidence,
} from "@/lib/ai/release-evidence-audit";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
  ReleaseResearchResult,
  ReleaseResearchVerificationSummary,
} from "@/lib/ai/release-research-types";
import { discogsClient, type DiscogsClient } from "@/lib/discogs/client";
import type {
  DiscogsReleaseEvidence,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";
import {
  musicMetadataClient,
  type MusicMetadataClient,
} from "@/lib/music-metadata/client";
import {
  NdlSearchClient,
  matchNdlCandidateForAiAudit,
  type NdlCandidate,
  type NdlEvidence,
  type NdlSearchResponse,
} from "@/lib/ndl";

const ndlSearchClient = new NdlSearchClient();

type ProgressCallback = (input: {
  processed: number;
  total: number;
  stage: string;
}) => void | Promise<void>;

type VerifiedDiscographyDependencies = {
  discogs?: Pick<DiscogsClient, "searchJapanCdReleases" | "getRelease">;
  ndl?: Pick<NdlSearchClient, "searchArtistInventory" | "searchCatalogNumber">;
  musicMetadata?: Pick<MusicMetadataClient, "getCoverArt">;
  validateCover?: typeof validateCoverAsset;
  auditEvidence?: typeof auditReleaseEvidenceWithAi;
  now?: () => Date;
  onProgress?: ProgressCallback;
};

type CorroboratedCandidate = {
  evidence: ReleaseCrossSourceEvidence;
  coverProvider: "cover-art-archive" | "discogs";
  coverCheckedAt: string;
};

type EditionComparisonReference = {
  candidate: ReleaseResearchCandidate;
  detail: DiscogsReleaseEvidence;
};

type MetadataCorroboratedCandidate = EditionComparisonReference & {
  musicBrainz: { releaseGroupUrl: string; releaseUrl: string };
  nationalBibliography: NdlEvidence;
  comparison: {
    matchedFields: string[];
    formats: string[];
    resolvedDate: string;
  };
};

class CoverProviderUnavailableError extends Error {
  constructor() {
    super("Cover providers were temporarily unavailable.");
    this.name = "CoverProviderUnavailableError";
  }
}

const cdPattern = /(^|[^a-z])cd([^a-z]|$)/i;
const laterEditionPattern = /reissue|remaster(?:ed)?/i;
const laterEditionTitlePattern = /(?:^|[\s+＋(（])(?:bonus|deluxe|expanded|anniversary|remaster(?:ed)?|reissue|special\s+edition)(?:$|[\s)）])|[+＋]\s*\d+|再発|再版|復刻|完全盤|限定盤/iu;

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

function titleKeys(value: string | null | undefined) {
  const text = value?.normalize("NFKC").trim() ?? "";
  return new Set(
    [text, ...text.split(/\s*(?:=|／|\/)\s*/u)]
      .map(normalizedText)
      .filter(Boolean),
  );
}

function equivalentTitle(left: string | null | undefined, right: string | null | undefined) {
  const leftKeys = titleKeys(left);
  const rightKeys = titleKeys(right);
  if (leftKeys.size === 0 || rightKeys.size === 0) return false;
  if (leftKeys.size === 1 || rightKeys.size === 1) {
    return [...leftKeys].some((key) => rightKeys.has(key));
  }
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}

function normalizedArtist(value: string | null | undefined) {
  return normalizedText(value);
}

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizedBarcode(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function yearOf(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function searchResultTitle(value: string) {
  const separator = value.indexOf(" - ");
  return separator >= 0 ? value.slice(separator + 3) : value;
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function artistAliases(
  input: ReleaseResearchRequest,
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
) {
  return new Set(
    [
      input.artistName,
      result.artist.name,
      result.artist.nameKana,
      result.artist.nameRomaji,
      bundle.artist?.name,
      ...(bundle.artist?.aliases.map((alias) => alias.name) ?? []),
    ]
      .map(normalizedArtist)
      .filter(Boolean),
  );
}

function candidateYear(candidate: ReleaseResearchCandidate) {
  return yearOf(candidate.originalReleaseDate) ?? yearOf(candidate.releaseDate);
}

function earliestCandidateIds(
  candidates: readonly ReleaseResearchCandidate[],
  excludeReissues: boolean,
) {
  if (!excludeReissues) return new Set(candidates.map((candidate) => candidate.id));
  const groups = new Map<string, ReleaseResearchCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.category}|${normalizedText(candidate.title)}`;
    const values = groups.get(key) ?? [];
    values.push(candidate);
    groups.set(key, values);
  }
  const accepted = new Set<string>();
  for (const values of groups.values()) {
    if (values.length === 1) {
      accepted.add(values[0]!.id);
      continue;
    }
    const dated = values.map((candidate) => ({
      candidate,
      date: candidate.originalReleaseDate ?? candidate.releaseDate,
    }));
    if (dated.some((item) => !item.date || item.date.length !== 10)) continue;
    const earliest = dated.map((item) => item.date as string).sort()[0]!;
    dated.filter((item) => item.date === earliest).forEach((item) => accepted.add(item.candidate.id));
  }
  return accepted;
}

function candidateMusicBrainzUrls(candidate: ReleaseResearchCandidate) {
  let releaseGroupUrl: string | null = null;
  let releaseUrl: string | null = null;
  for (const source of candidate.sources) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.hostname !== "musicbrainz.org") continue;
      if (/^\/release-group\/[0-9a-f-]+$/i.test(url.pathname)) releaseGroupUrl = url.toString();
      if (/^\/release\/[0-9a-f-]+$/i.test(url.pathname)) releaseUrl = url.toString();
    } catch {
      // Invalid source URLs are ignored and the candidate fails closed below.
    }
  }
  return releaseGroupUrl && releaseUrl ? { releaseGroupUrl, releaseUrl } : null;
}

function toNdlCandidate(
  candidate: ReleaseResearchCandidate,
  artistName: string,
  artistNameAliases: readonly string[],
): NdlCandidate | null {
  const date = candidate.originalReleaseDate ?? candidate.releaseDate;
  if (!candidate.catalogNumber || !date) return null;
  return {
    artist: artistName,
    artistAliases: artistNameAliases,
    title: candidate.title,
    titleAliases: candidate.titleOriginal ? [candidate.titleOriginal] : [],
    catalogNumber: candidate.catalogNumber,
    date,
  };
}

async function authoritativeNdlEvidence(
  candidate: ReleaseResearchCandidate,
  artistName: string,
  artistNameAliases: readonly string[],
  inventory: NdlSearchResponse,
  ndl: Pick<NdlSearchClient, "searchCatalogNumber">,
) {
  const ndlCandidate = toNdlCandidate(candidate, artistName, artistNameAliases);
  if (!ndlCandidate) return null;

  const inventoryDecision = matchNdlCandidateForAiAudit(ndlCandidate, inventory);
  if (inventoryDecision.evidence) return inventoryDecision.evidence;
  if (!["catalog-not-found", "incomplete-results"].includes(inventoryDecision.reason)) {
    return null;
  }

  const response = await ndl.searchCatalogNumber(ndlCandidate.catalogNumber, 20);
  if (!response.value) {
    const warning = response.warnings[0];
    if (warning?.retryable) {
      throw new Error("NDL Search was temporarily unavailable during authoritative verification.");
    }
    return null;
  }
  return matchNdlCandidateForAiAudit(ndlCandidate, response.value).evidence;
}

function shortlistDiscogsRows(
  candidate: ReleaseResearchCandidate,
  rows: readonly DiscogsSearchReleaseEvidence[],
  excludeReissues: boolean,
) {
  const title = normalizedText(candidate.title);
  const catalog = normalizedCatalog(candidate.catalogNumber);
  const year = candidateYear(candidate);
  if (!title || !catalog || year === null) return [];

  const exact = rows.filter((row) =>
    equivalentTitle(searchResultTitle(row.title), candidate.title) &&
    normalizedCatalog(row.catalogNumber) === catalog &&
    row.year === year,
  );

  return exact.filter((row) => {
    if (!excludeReissues) return true;
    if (row.masterId === null) return false;
    const candidateSets = [
      rows.filter((other) => other.masterId === row.masterId && other.year !== null),
      rows.filter((other) =>
        other.year !== null && equivalentTitle(searchResultTitle(other.title), candidate.title)),
    ];
    return candidateSets.every((sameWork) => {
      const earliestYear = sameWork.reduce<number | null>((earliest, other) =>
        earliest === null || (other.year as number) < earliest ? other.year : earliest, null);
      if (earliestYear === null || row.year !== earliestYear) return false;
      const earliestCatalogs = new Set(sameWork
        .filter((other) => other.year === earliestYear)
        .map((other) => normalizedCatalog(other.catalogNumber))
        .filter(Boolean));
      return earliestCatalogs.size === 1;
    });
  });
}

function detailCatalogNumbers(detail: DiscogsReleaseEvidence) {
  return uniqueStrings(
    detail.labels.map((label) => normalizedCatalog(label.catalogNumber)).filter(Boolean),
  );
}

function detailFormats(detail: DiscogsReleaseEvidence) {
  return uniqueStrings(detail.formats.flatMap((format) => [format.name, ...format.descriptions]));
}

function compareDiscogsDetail(
  candidate: ReleaseResearchCandidate,
  expectedReleaseId: number,
  expectedMasterId: number | null,
  detail: DiscogsReleaseEvidence,
  nationalBibliography: NdlEvidence | null,
  aliases: ReadonlySet<string>,
  excludeReissues: boolean,
  includeCollaborations: boolean,
  requireResolvedDay = true,
) {
  const candidateDate = candidate.originalReleaseDate ?? candidate.releaseDate;
  const expectedYear = candidateYear(candidate);
  const expectedCatalog = normalizedCatalog(candidate.catalogNumber);
  const expectedBarcode = normalizedBarcode(candidate.barcode);
  const formats = detailFormats(detail);
  const detailArtists = detail.artists.map((artist) => normalizedArtist(artist.name)).filter(Boolean);
  const hasTargetArtist = detailArtists.some((artist) => aliases.has(artist));
  const hasOnlyTargetArtist = detailArtists.length === 1 && aliases.has(detailArtists[0]!);
  if (candidateDate && detail.released) {
    const sharedPrecision = Math.min(candidateDate.length, detail.released.length);
    if (candidateDate.slice(0, sharedPrecision) !== detail.released.slice(0, sharedPrecision)) return null;
  }
  const discogsConfirmsDay = candidateDate?.length === 10 && detail.released === candidateDate;
  const ndlConfirmsDay = candidateDate?.length === 10 &&
    nationalBibliography !== null &&
    nationalBibliography.observedIssuedPrecision === "day" &&
    nationalBibliography.observedIssued === candidateDate;
  const resolvedDate = candidateDate?.length === 10 && (discogsConfirmsDay || ndlConfirmsDay)
    ? candidateDate
    : null;

  if (
    detail.releaseId !== expectedReleaseId ||
    (expectedMasterId !== null && detail.masterId !== expectedMasterId) ||
    (excludeReissues && detail.masterId === null) ||
    detail.country?.toLocaleLowerCase("en") !== "japan" ||
    expectedYear === null ||
    detail.year !== expectedYear ||
    !equivalentTitle(detail.title, candidate.title) ||
    !detailCatalogNumbers(detail).includes(expectedCatalog) ||
    !formats.some((format) => cdPattern.test(format)) ||
    !hasTargetArtist ||
    (!includeCollaborations && !hasOnlyTargetArtist) ||
    detail.status?.toLocaleLowerCase("en") !== "accepted" ||
    !detail.dataQuality ||
    !["correct", "needs vote"].includes(detail.dataQuality.toLocaleLowerCase("en")) ||
    (excludeReissues && (
      formats.some((format) => laterEditionPattern.test(format)) ||
      laterEditionTitlePattern.test(candidate.title) ||
      laterEditionTitlePattern.test(detail.title)
    ))
  ) return null;
  if (requireResolvedDay && !resolvedDate) return null;

  const discogsBarcodes = detail.barcodes.map(normalizedBarcode).filter(Boolean);
  if (expectedBarcode && discogsBarcodes.length > 0 && !discogsBarcodes.includes(expectedBarcode)) {
    return null;
  }
  if (
    detail.dataQuality?.toLocaleLowerCase("en") === "needs vote" &&
    (!expectedBarcode || !discogsBarcodes.includes(expectedBarcode))
  ) return null;

  const matchedFields = ["title", "year", "artist", "catalogNumber", "country", "format"];
  if (discogsConfirmsDay || ndlConfirmsDay) matchedFields.push("date");
  if (expectedBarcode && discogsBarcodes.includes(expectedBarcode)) matchedFields.push("barcode");
  return { matchedFields, formats, resolvedDate: resolvedDate ?? candidateDate ?? String(expectedYear) };
}

function independentSource(
  candidate: ReleaseResearchCandidate,
  ndlEvidence: NdlEvidence,
  detail: DiscogsReleaseEvidence,
) {
  const sources = new Map(candidate.sources.map((source) => [source.url, source]));
  sources.set(ndlEvidence.sourceUrl, {
    title: "National Diet Library bibliographic record",
    url: ndlEvidence.sourceUrl,
    sourceType: "official",
  });
  sources.set(detail.sourceUrl, {
    title: "Discogs release",
    url: detail.sourceUrl,
    sourceType: "database",
  });
  return [...sources.values()];
}

async function validatedCover(
  candidate: ReleaseResearchCandidate,
  detail: DiscogsReleaseEvidence,
  dependencies: {
    validate: typeof validateCoverAsset;
    musicMetadata: Pick<MusicMetadataClient, "getCoverArt">;
  },
) {
  let transientFailure = false;
  const releaseUrl = candidateMusicBrainzUrls(candidate)?.releaseUrl;
  const releaseId = releaseUrl?.split("/").at(-1) ?? null;
  const hasEmbeddedExactReleaseCover = Boolean(
    releaseId &&
    candidate.coverImageUrl &&
    candidate.coverImageSourceUrl === `https://coverartarchive.org/release/${releaseId}`,
  );
  const tryCoverArtArchive = async () => {
    if (!releaseId) return null;
    const response = await dependencies.musicMetadata.getCoverArt("release", releaseId);
    transientFailure ||= response.warnings.some((warning) => warning.retryable);
    if (response.value?.approved === true) {
      const result = await dependencies.validate(response.value.imageUrl);
      transientFailure ||= result.retryable;
      if (
        result.ok &&
        result.finalHost &&
        isAllowedVerifiedCoverAssetUrl(response.value.imageUrl, "cover-art-archive") &&
        isAllowedVerifiedCoverAssetHost(result.finalHost, "cover-art-archive")
      ) {
        return {
          imageUrl: response.value.imageUrl,
          sourceUrl: response.value.sourceUrl,
          provider: "cover-art-archive" as const,
        };
      }
    }
    return null;
  };
  if (hasEmbeddedExactReleaseCover) {
    const cover = await tryCoverArtArchive();
    if (cover) return cover;
  }

  if (detail.primaryImageUrl) {
    const result = await dependencies.validate(detail.primaryImageUrl);
    transientFailure ||= result.retryable;
    if (
      result.ok &&
      result.finalHost &&
      isAllowedVerifiedCoverAssetUrl(detail.primaryImageUrl, "discogs") &&
      isAllowedVerifiedCoverAssetHost(result.finalHost, "discogs")
    ) {
      return {
        imageUrl: detail.primaryImageUrl,
        sourceUrl: detail.sourceUrl,
        provider: "discogs" as const,
      };
    }
  }

  if (!hasEmbeddedExactReleaseCover) {
    const cover = await tryCoverArtArchive();
    if (cover) return cover;
  }

  if (transientFailure) {
    throw new CoverProviderUnavailableError();
  }
  return null;
}

async function findDiscogsCorroboration(
  candidate: ReleaseResearchCandidate,
  nationalBibliography: NdlEvidence,
  rows: readonly DiscogsSearchReleaseEvidence[],
  aliases: ReadonlySet<string>,
  input: ReleaseResearchRequest,
  dependencies: {
    discogs: Pick<DiscogsClient, "getRelease">;
  },
) {
  const musicBrainz = candidateMusicBrainzUrls(candidate);
  if (!musicBrainz) return { metadataMatched: false, ambiguous: false, value: null };
  const shortlist = shortlistDiscogsRows(candidate, rows, input.excludeReissues)
    .sort((left, right) => left.releaseId - right.releaseId);
  const matches: Array<{
    detail: DiscogsReleaseEvidence;
    comparison: NonNullable<ReturnType<typeof compareDiscogsDetail>>;
  }> = [];

  for (const row of shortlist) {
    const response = await dependencies.discogs.getRelease(row.releaseId);
    const transientWarning = response.warnings.find((warning) => warning.retryable);
    if (transientWarning) throw new Error("Discogs release verification was temporarily unavailable.");
    const detail = response.value;
    if (!detail || response.warnings.some((warning) => warning.code === "invalid-response")) continue;
    const comparison = compareDiscogsDetail(
      candidate,
      row.releaseId,
      row.masterId,
      detail,
      nationalBibliography,
      aliases,
      input.excludeReissues,
      input.includeCollaborations,
    );
    if (!comparison) continue;
    matches.push({ detail, comparison });
  }

  if (matches.length === 0) return { metadataMatched: false, ambiguous: false, value: null };
  if (matches.length > 1) return { metadataMatched: true, ambiguous: true, value: null };
  const { detail, comparison } = matches[0]!;
  return {
    metadataMatched: true,
    ambiguous: false,
    value: {
      candidate,
      musicBrainz,
      nationalBibliography,
      detail,
      comparison,
    } satisfies MetadataCorroboratedCandidate,
  };
}

async function findDiscogsEditionReference(
  candidate: ReleaseResearchCandidate,
  rows: readonly DiscogsSearchReleaseEvidence[],
  aliases: ReadonlySet<string>,
  input: ReleaseResearchRequest,
  discogs: Pick<DiscogsClient, "getRelease">,
): Promise<EditionComparisonReference | null> {
  const shortlist = shortlistDiscogsRows(candidate, rows, input.excludeReissues)
    .sort((left, right) => left.releaseId - right.releaseId);
  const details: DiscogsReleaseEvidence[] = [];
  for (const row of shortlist) {
    const response = await discogs.getRelease(row.releaseId);
    if (response.warnings.some((warning) => warning.retryable)) {
      throw new Error("Discogs release verification was temporarily unavailable.");
    }
    const detail = response.value;
    if (!detail || response.warnings.some((warning) => warning.code === "invalid-response")) continue;
    const comparison = compareDiscogsDetail(
      candidate,
      row.releaseId,
      row.masterId,
      detail,
      null,
      aliases,
      input.excludeReissues,
      input.includeCollaborations,
      false,
    );
    if (comparison) details.push(detail);
  }
  return details.length === 1 ? { candidate, detail: details[0]! } : null;
}

async function attachValidatedCover(
  item: MetadataCorroboratedCandidate,
  input: ReleaseResearchRequest,
  dependencies: {
    validateCover: typeof validateCoverAsset;
    musicMetadata: Pick<MusicMetadataClient, "getCoverArt">;
  },
) {
  const { candidate, detail, comparison, nationalBibliography, musicBrainz } = item;
  let cover: Awaited<ReturnType<typeof validatedCover>>;
  try {
    cover = await validatedCover(candidate, detail, {
      validate: dependencies.validateCover,
      musicMetadata: dependencies.musicMetadata,
    });
  } catch (error) {
    if (error instanceof CoverProviderUnavailableError) {
      return { coverUnavailable: true, value: null };
    }
    throw error;
  }
  if (!cover) return { coverUnavailable: false, value: null };

  const verifiedCandidate: ReleaseResearchCandidate = {
    ...candidate,
    originalReleaseDate: comparison.resolvedDate,
    editionType: input.excludeReissues
      ? "Earliest verified Japanese CD edition"
      : candidate.editionType,
    isReissue: input.excludeReissues ? false : candidate.isReissue,
    isRemaster: candidate.isRemaster,
    isExcludedByDefault: false,
    coverImageUrl: cover.imageUrl,
    coverImageSourceUrl: cover.sourceUrl,
    confidence: "HIGH",
    warnings: candidate.warnings.filter((warning) =>
      !warning.includes("PENDING_REVIEW") && !warning.includes("未提供封面")),
    sources: independentSource(candidate, nationalBibliography, detail),
    verification: null,
  };
  return {
    coverUnavailable: false,
    value: {
      evidence: {
        candidate: verifiedCandidate,
        musicBrainz,
        nationalBibliography,
        discogs: {
          releaseUrl: detail.sourceUrl,
          title: detail.title,
          artistName: detail.artistCredit ?? detail.artists.map((artist) => artist.name).join(" & "),
          year: detail.year,
          released: detail.released,
          country: detail.country,
          catalogNumber: detail.labels.find((label) =>
            normalizedCatalog(label.catalogNumber) === normalizedCatalog(candidate.catalogNumber))?.catalogNumber ?? null,
          barcode: detail.barcodes.find((barcode) =>
            normalizedBarcode(barcode) === normalizedBarcode(candidate.barcode)) ?? detail.barcodes[0] ?? null,
          formats: comparison.formats,
        },
        matchedFields: comparison.matchedFields,
      },
      coverProvider: cover.provider,
      coverCheckedAt: new Date().toISOString(),
    } satisfies CorroboratedCandidate,
  };
}

function isOrderedSubsequence(needle: readonly string[], haystack: readonly string[]) {
  let index = 0;
  for (const title of haystack) {
    if (title === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function discogsTrackTitles(item: EditionComparisonReference) {
  return item.detail.tracks
    .filter((track) => !track.type || track.type.toLocaleLowerCase("en") === "track")
    .map((track) => normalizedText(track.title))
    .filter(Boolean);
}

function removeLikelyRenamedLaterEditions(
  items: readonly MetadataCorroboratedCandidate[],
  references: readonly EditionComparisonReference[],
) {
  return items.filter((item) => {
    const currentDate = item.candidate.originalReleaseDate ?? item.candidate.releaseDate;
    const currentTracks = discogsTrackTitles(item);
    if (!currentDate || currentTracks.length < 4) return true;
    return !references.some((earlier) => {
      const earlierTracks = discogsTrackTitles(earlier);
      if (earlier === item || earlierTracks.length < 4) return false;
      const earlierDate = earlier.candidate.originalReleaseDate ?? earlier.candidate.releaseDate;
      if (!earlierDate || earlierDate >= currentDate) return false;
      const maximumExpandedLength = earlierTracks.length + Math.max(
        3,
        Math.floor(earlierTracks.length / 2),
      );
      return currentTracks.length >= earlierTracks.length &&
        currentTracks.length <= maximumExpandedLength &&
        isOrderedSubsequence(earlierTracks, currentTracks);
    });
  });
}

async function searchDiscogs(
  input: ReleaseResearchRequest,
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
  discogs: Pick<DiscogsClient, "searchJapanCdReleases">,
) {
  const queries = uniqueStrings([
    bundle.artist?.name ?? "",
    result.artist.nameRomaji ?? "",
    input.artistName,
    result.artist.name,
  ]);
  const items = new Map<number, DiscogsSearchReleaseEvidence>();
  for (const query of queries) {
    const response = await discogs.searchJapanCdReleases(query, { maxItems: 1_000, maxPages: 10 });
    if (response.value.partial || response.warnings.some((warning) => warning.retryable)) {
      throw new Error("Discogs search was incomplete; no unverified partial result was returned.");
    }
    response.value.items.forEach((item) => items.set(item.releaseId, item));
  }
  return [...items.values()].sort((left, right) => left.releaseId - right.releaseId);
}

function summaryFrom(
  bundle: ArtistReleaseEvidenceBundle,
  input: {
    authoritativeMatches: number;
    crossSourceMatches: number;
    aiAccepted: number;
    rejectedByEvidence: number;
    rejectedByAi: number;
    rejectedWithoutCover: number;
    rejectedCoverUnavailable: number;
  },
): ReleaseResearchVerificationSummary {
  return {
    rawReleases: bundle.stats.releasesFetched,
    releaseGroups: bundle.stats.releaseGroupsAccepted ?? bundle.releases.length,
    canonicalEditions: bundle.releases.length,
    ...input,
  };
}

export async function verifyDiscographyResult(
  input: ReleaseResearchRequest,
  result: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
  apiKeyOverride?: string,
  dependencies: VerifiedDiscographyDependencies = {},
): Promise<ReleaseResearchResult> {
  const discogs = dependencies.discogs ?? discogsClient;
  const ndl = dependencies.ndl ?? ndlSearchClient;
  const musicMetadata = dependencies.musicMetadata ?? musicMetadataClient;
  const validateCover = dependencies.validateCover ?? validateCoverAsset;
  const auditEvidence = dependencies.auditEvidence ?? auditReleaseEvidenceWithAi;
  const onProgress = dependencies.onProgress;
  const aliases = artistAliases(input, result, bundle);
  const earliestIds = earliestCandidateIds(result.releases, input.excludeReissues);
  const ndlArtistName = bundle.artist?.name?.trim() || result.artist.name.trim() || input.artistName.trim();
  const ndlArtistAliases = uniqueStrings([
    input.artistName,
    result.artist.name,
    result.artist.nameKana ?? "",
    result.artist.nameRomaji ?? "",
    ...(bundle.artist?.aliases.map((alias) => alias.name) ?? []),
  ]).filter((name) => normalizedArtist(name) !== normalizedArtist(ndlArtistName));
  const totalWork = Math.max(1, result.releases.length * 2);

  await onProgress?.({ processed: 0, total: totalWork, stage: "正在查询日本国立国会图书馆国家书目" });
  const inventoryResponse = await ndl.searchArtistInventory(ndlArtistName, 500);
  if (!inventoryResponse.value) {
    throw new Error("NDL Search authoritative bibliography was unavailable; no unverified result was returned.");
  }
  const authoritative = new Map<string, NdlEvidence>();
  for (let index = 0; index < result.releases.length; index += 1) {
    const candidate = result.releases[index]!;
    if (!earliestIds.has(candidate.id)) {
      await onProgress?.({
        processed: index + 1,
        total: totalWork,
        stage: `正在排除无法证明为最早日本 CD 的版本（${index + 1}/${result.releases.length}）`,
      });
      continue;
    }
    const evidence = await authoritativeNdlEvidence(
      candidate,
      ndlArtistName,
      ndlArtistAliases,
      inventoryResponse.value,
      ndl,
    );
    if (evidence) authoritative.set(candidate.id, evidence);
    await onProgress?.({
      processed: index + 1,
      total: totalWork,
      stage: `正在核对国家书目（${index + 1}/${result.releases.length}）`,
    });
  }
  const ndlRecordCounts = new Map<string, number>();
  const ndlCatalogCounts = new Map<string, number>();
  for (const evidence of authoritative.values()) {
    ndlRecordCounts.set(evidence.recordId, (ndlRecordCounts.get(evidence.recordId) ?? 0) + 1);
    const catalog = normalizedCatalog(evidence.observedCatalogNumber);
    ndlCatalogCounts.set(catalog, (ndlCatalogCounts.get(catalog) ?? 0) + 1);
  }
  for (const [candidateId, evidence] of authoritative) {
    const catalog = normalizedCatalog(evidence.observedCatalogNumber);
    if (ndlRecordCounts.get(evidence.recordId) !== 1 || ndlCatalogCounts.get(catalog) !== 1) {
      authoritative.delete(candidateId);
    }
  }

  await onProgress?.({
    processed: result.releases.length,
    total: totalWork,
    stage: "正在查询 Discogs 独立发行资料",
  });
  const rows = authoritative.size > 0
    ? await searchDiscogs(input, result, bundle, discogs)
    : [];
  const latestAuthoritativeDate = result.releases
    .filter((candidate) => authoritative.has(candidate.id))
    .map((candidate) => candidate.originalReleaseDate ?? candidate.releaseDate)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1) ?? null;
  const detailCache = new Map<number, Promise<DiscogsResult<DiscogsReleaseEvidence | null>>>();
  const cachedDiscogs: Pick<DiscogsClient, "getRelease"> = {
    getRelease(releaseId: number) {
      const cached = detailCache.get(releaseId);
      if (cached) return cached;
      const request = discogs.getRelease(releaseId);
      detailCache.set(releaseId, request);
      return request;
    },
  };
  const metadataCorroborated: MetadataCorroboratedCandidate[] = [];
  const vetoReferences: EditionComparisonReference[] = [];
  let crossSourceMatches = 0;
  let rejectedWithoutCover = 0;
  let rejectedCoverUnavailable = 0;

  for (let index = 0; index < result.releases.length; index += 1) {
    const candidate = result.releases[index];
    const nationalBibliography = authoritative.get(candidate.id);
    const candidateDate = candidate.originalReleaseDate ?? candidate.releaseDate;
    const checked = nationalBibliography
      ? await findDiscogsCorroboration(candidate, nationalBibliography, rows, aliases, input, {
          discogs: cachedDiscogs,
        })
      : { metadataMatched: false, ambiguous: false, value: null };
    if (checked.metadataMatched && !checked.ambiguous) crossSourceMatches += 1;
    if (checked.value) metadataCorroborated.push(checked.value);
    else if (
      input.excludeReissues &&
      rows.length > 0 &&
      latestAuthoritativeDate &&
      candidateDate &&
      candidateDate < latestAuthoritativeDate
    ) {
      const reference = await findDiscogsEditionReference(candidate, rows, aliases, input, cachedDiscogs);
      if (reference) vetoReferences.push(reference);
    }
    await onProgress?.({
      processed: result.releases.length + index + 1,
      total: totalWork,
      stage: `正在交叉核验发行资料（${index + 1}/${result.releases.length}）`,
    });
  }

  const editionCandidates = input.excludeReissues
    ? removeLikelyRenamedLaterEditions(
        metadataCorroborated,
        [...metadataCorroborated, ...vetoReferences],
      )
    : metadataCorroborated;
  const corroborated: CorroboratedCandidate[] = [];
  for (let index = 0; index < editionCandidates.length; index += 1) {
    const checked = await attachValidatedCover(editionCandidates[index]!, input, {
      validateCover,
      musicMetadata,
    });
    if (checked.coverUnavailable) rejectedCoverUnavailable += 1;
    else if (!checked.value) rejectedWithoutCover += 1;
    if (checked.value) corroborated.push(checked.value);
    await onProgress?.({
      processed: result.releases.length + Math.round(
        ((index + 1) / Math.max(1, editionCandidates.length)) * result.releases.length,
      ),
      total: totalWork,
      stage: `正在验证实体版封面（${index + 1}/${editionCandidates.length}）`,
    });
  }

  if (editionCandidates.length === 0) {
    await onProgress?.({ processed: totalWork, total: totalWork, stage: "没有通过版本核验的封面候选" });
  }
  const editionKey = (item: CorroboratedCandidate) => {
    const candidate = item.evidence.candidate;
    return [
      normalizedText(candidate.title),
      candidate.originalReleaseDate ?? candidate.releaseDate,
      normalizedCatalog(candidate.catalogNumber),
    ].join("|");
  };
  const discogsCounts = new Map<string, number>();
  const editionCounts = new Map<string, number>();
  for (const item of corroborated) {
    discogsCounts.set(item.evidence.discogs.releaseUrl, (discogsCounts.get(item.evidence.discogs.releaseUrl) ?? 0) + 1);
    const key = editionKey(item);
    editionCounts.set(key, (editionCounts.get(key) ?? 0) + 1);
  }
  const uniqueEvidence = corroborated.filter((item) =>
    discogsCounts.get(item.evidence.discogs.releaseUrl) === 1 &&
    editionCounts.get(editionKey(item)) === 1);

  const rejectedByEvidence = result.releases.length - crossSourceMatches +
    (metadataCorroborated.length - editionCandidates.length) +
    (corroborated.length - uniqueEvidence.length);
  await onProgress?.({
    processed: totalWork,
    total: totalWork,
    stage: "正在由 GPT-5.6 终审国家书目与两套交叉证据",
  });
  const decisions = await auditEvidence(
    uniqueEvidence.map((item) => item.evidence),
    apiKeyOverride,
  );
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));
  const checkedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const releases = uniqueEvidence.flatMap((item) => {
    const decision = decisionsById.get(item.evidence.candidate.id);
    if (decision?.decision !== "ACCEPT") return [];
    const candidate = item.evidence.candidate;
    const sourceUrls = uniqueStrings([
      item.evidence.musicBrainz.releaseGroupUrl,
      item.evidence.musicBrainz.releaseUrl,
      item.evidence.nationalBibliography.sourceUrl,
      item.evidence.discogs.releaseUrl,
    ]);
    return [{
      ...candidate,
      title: item.evidence.nationalBibliography.authoritativeTitle,
      titleOriginal: normalizedText(candidate.title) === normalizedText(
        item.evidence.nationalBibliography.authoritativeTitle,
      ) ? candidate.titleOriginal : candidate.title,
      verification: {
        status: "VERIFIED" as const,
        method: "musicbrainz-ndl-discogs-ai" as const,
        aiDecision: "ACCEPT" as const,
        aiReason: decision.reason,
        checkedAt,
        matchedFields: item.evidence.matchedFields,
        sourceUrls,
        coverProvider: item.coverProvider,
        coverCheckedAt: item.coverCheckedAt,
      },
    }];
  });
  const rejectedByAi = uniqueEvidence.length - releases.length;
  const verificationSummary = summaryFrom(bundle, {
    authoritativeMatches: authoritative.size,
    crossSourceMatches,
    aiAccepted: releases.length,
    rejectedByEvidence,
    rejectedByAi,
    rejectedWithoutCover,
    rejectedCoverUnavailable,
  });

  return {
    ...result,
    releases,
    verificationSummary,
    globalWarnings: uniqueStrings([
      ...result.globalWarnings.filter((warning) => !warning.includes("PENDING_REVIEW")),
      `自动核验：${verificationSummary.rawReleases} 个原始版本归并为 ${verificationSummary.canonicalEditions} 个候选；${verificationSummary.authoritativeMatches} 个通过国家书目核对，${releases.length} 个通过跨源、AI 与封面硬门禁。`,
      "未通过证据一致性或无有效封面的条目已自动隐藏，不需要用户判断。",
      ...(verificationSummary.rejectedCoverUnavailable > 0
        ? [`${verificationSummary.rejectedCoverUnavailable} 个条目的封面来源暂时不可用，本次已安全隐藏；稍后重新搜索可重试。`]
        : []),
      "Data provided by Discogs.",
      "This application uses the NDL Search API.",
    ]),
  };
}
