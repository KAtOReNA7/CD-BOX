import { musicMetadataClient, type MusicMetadataClient } from "@/lib/music-metadata/client";
import type {
  ArtistReleaseEvidenceBundle,
  ArtistReleaseEvidenceItem,
  ArtistReleaseEvidenceResearchInput,
  ArtistReleaseEvidenceWarning,
  MusicArtistEvidence,
  MusicMetadataWarning,
  MusicReleaseEvidence,
  ReleaseEvidenceItemWarning,
} from "@/lib/music-metadata/types";

const DEFAULT_MAX_CANDIDATES = 120;
const DEFAULT_MAX_COVER_LOOKUPS = 0;

const COUNTRY_ALIASES: Record<string, string> = {
  jp: "JP",
  jpn: "JP",
  japan: "JP",
  日本: "JP",
  日本国: "JP",
  cn: "CN",
  chn: "CN",
  china: "CN",
  prc: "CN",
  mainlandchina: "CN",
  peoplesrepublicofchina: "CN",
  中国: "CN",
  中國: "CN",
  中国大陆: "CN",
  中國大陸: "CN",
  大陆: "CN",
  大陸: "CN",
  中华人民共和国: "CN",
  中華人民共和國: "CN",
  hk: "HK",
  hkg: "HK",
  hongkong: "HK",
  香港: "HK",
  香港特别行政区: "HK",
  香港特別行政區: "HK",
  tw: "TW",
  twn: "TW",
  taiwan: "TW",
  台湾: "TW",
  臺灣: "TW",
  kr: "KR",
  kor: "KR",
  korea: "KR",
  southkorea: "KR",
  republicofkorea: "KR",
  韩国: "KR",
  韓國: "KR",
  대한민국: "KR",
  us: "US",
  usa: "US",
  unitedstates: "US",
  unitedstatesofamerica: "US",
  美国: "US",
  美國: "US",
  gb: "GB",
  gbr: "GB",
  uk: "GB",
  unitedkingdom: "GB",
  greatbritain: "GB",
  英国: "GB",
  英國: "GB",
};

export type ResearchArtistReleaseEvidenceOptions = {
  client?: MusicMetadataClient;
  onProgress?: (input: {
    phase: "artist" | "release-groups" | "releases" | "covers";
    processed: number;
    total: number;
  }) => void | Promise<void>;
};

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
}

export function resolveMusicMetadataCountryCode(value: string | null | undefined) {
  if (!value?.trim()) return "JP";
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{Cf}]/gu, "");
  const countryCode = COUNTRY_ALIASES[normalized];
  if (countryCode) return countryCode;
  throw new TypeError(`Unsupported artist country or region: ${value.trim()}`);
}

function validateInput(input: ArtistReleaseEvidenceResearchInput) {
  const artistName = input.artistName.normalize("NFKC").trim();
  if (!artistName || artistName.length > 200) {
    throw new TypeError("artistName must contain between 1 and 200 characters.");
  }
  if (!["ORIGINAL_CD", "ALL_CD", "ALL_PHYSICAL"].includes(input.target)) {
    throw new TypeError("Unsupported release evidence target.");
  }

  const aliases = (input.aliases ?? [])
    .map((alias) => alias.normalize("NFKC").trim())
    .filter((alias) => alias && alias.length <= 200)
    .filter((alias, index, values) =>
      values.findIndex((candidate) => normalizeName(candidate) === normalizeName(alias)) === index,
    )
    .slice(0, 5);
  return { artistName, aliases, targetCountry: resolveMusicMetadataCountryCode(input.country) };
}

function artistMatchStrength(
  artist: MusicArtistEvidence,
  primaryName: string,
  aliases: readonly string[],
) {
  const primaryKey = normalizeName(primaryName);
  const aliasKeys = new Set(aliases.map(normalizeName).filter(Boolean));
  const artistName = normalizeName(artist.name);
  const sourceAliases = new Set(artist.aliases.map((alias) => normalizeName(alias.name)).filter(Boolean));
  if (artistName === primaryKey) return 4;
  if (sourceAliases.has(primaryKey)) return 3;
  if (aliasKeys.has(artistName)) return 2;
  return [...sourceAliases].some((alias) => aliasKeys.has(alias)) ? 1 : 0;
}

function selectArtist(
  artists: readonly MusicArtistEvidence[],
  primaryName: string,
  aliases: readonly string[],
  targetCountry: string,
) {
  const ranked = artists
    .map((artist) => ({
      artist,
      matchStrength: artistMatchStrength(artist, primaryName, aliases),
      score: artist.score ?? -1,
    }))
    .filter((candidate) => candidate.matchStrength > 0);
  if (ranked.length === 0) return { artist: null, reason: "not-found" as const };

  const strongestMatch = Math.max(...ranked.map((candidate) => candidate.matchStrength));
  let tier = ranked.filter((candidate) => candidate.matchStrength === strongestMatch);
  const matchingCountry = tier.filter((candidate) => candidate.artist.country === targetCountry);
  const unknownCountry = tier.filter((candidate) => candidate.artist.country === null);
  if (matchingCountry.length > 0) tier = matchingCountry;
  else if (unknownCountry.length > 0) tier = unknownCountry;

  tier.sort((left, right) => right.score - left.score || left.artist.sourceId.localeCompare(right.artist.sourceId));
  if (tier.length === 1) {
    const artist = tier[0].artist;
    return artist.country && artist.country !== targetCountry
      ? { artist: null, reason: "country-mismatch" as const }
      : { artist, reason: null };
  }

  const first = tier[0];
  const second = tier[1];
  if (first.score === 100 && second.score <= 80) {
    return { artist: first.artist, reason: null };
  }
  return { artist: null, reason: "ambiguous" as const };
}

function sourceWarning(value: MusicMetadataWarning): ArtistReleaseEvidenceWarning {
  return {
    code: value.code === "rate-limited"
      ? "source-rate-limited"
      : value.code === "invalid-response"
        ? "source-invalid-response"
        : "source-unavailable",
    message: value.message,
    source: value.source,
  };
}

function addWarning(
  warnings: ArtistReleaseEvidenceWarning[],
  value: ArtistReleaseEvidenceWarning,
) {
  const duplicate = warnings.some((warning) =>
    warning.code === value.code &&
    warning.source === value.source &&
    warning.message === value.message,
  );
  if (!duplicate) warnings.push(value);
}

function mergeArtistLookupEvidence(
  searchEvidence: MusicArtistEvidence,
  lookupEvidence: MusicArtistEvidence,
): MusicArtistEvidence {
  const aliases = [...searchEvidence.aliases, ...lookupEvidence.aliases].filter((alias, index, values) =>
    values.findIndex((candidate) =>
      candidate.name === alias.name &&
      candidate.sortName === alias.sortName &&
      candidate.locale === alias.locale &&
      candidate.type === alias.type &&
      candidate.primary === alias.primary,
    ) === index,
  );
  return {
    ...searchEvidence,
    aliases,
    officialUrls: [...new Set([
      ...searchEvidence.officialUrls,
      ...lookupEvidence.officialUrls,
    ])],
  };
}

function isCdFormat(format: string) {
  const normalized = format.normalize("NFKC").toLowerCase();
  return /(^|[^a-z])cd(?:[^a-z]|$)/.test(normalized);
}

function isPhysicalFormat(format: string) {
  const normalized = format.normalize("NFKC").trim().toLowerCase();
  return normalized !== "digital media" && normalized !== "download card";
}

function isOutsideTargetFormat(release: MusicReleaseEvidence, target: ArtistReleaseEvidenceResearchInput["target"]) {
  if (target === "ALL_PHYSICAL") return !release.formats.some(isPhysicalFormat);
  return !release.formats.some(isCdFormat);
}

function isExcludedReleaseType(release: MusicReleaseEvidence) {
  const values = [release.type, ...release.secondaryTypes]
    .filter((value): value is string => value !== null)
    .map((value) => value.normalize("NFKC").trim().toLowerCase());
  return values.some((value) =>
    value === "compilation" ||
    value === "live" ||
    value === "remix" ||
    value === "dj-mix",
  );
}

function isCollaboration(release: MusicReleaseEvidence) {
  const credits = new Set(release.artistNames.map(normalizeName).filter(Boolean));
  return credits.size > 1;
}

function releaseSort(left: MusicReleaseEvidence, right: MusicReleaseEvidence) {
  if (left.date === null && right.date !== null) return 1;
  if (left.date !== null && right.date === null) return -1;
  const dateOrder = (left.date ?? "").localeCompare(right.date ?? "");
  return dateOrder || left.title.localeCompare(right.title, "und") || left.sourceId.localeCompare(right.sourceId);
}

function parsedReleaseDate(value: string | null) {
  const match = value?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: match[2] ? Number(match[2]) : null,
    day: match[3] ? Number(match[3]) : null,
  };
}

function hasCatalogNumber(release: MusicReleaseEvidence) {
  return Boolean(
    release.catalogNumber || release.labels.some((label) => label.catalogNumber),
  );
}

/**
 * Picks the earliest eligible edition without letting an incomplete date beat
 * a complete date from the same year/month. Remaining ties prefer stronger
 * physical-product identifiers and finally the stable MusicBrainz id.
 */
function canonicalReleaseSort(left: MusicReleaseEvidence, right: MusicReleaseEvidence) {
  const leftDate = parsedReleaseDate(left.date);
  const rightDate = parsedReleaseDate(right.date);
  if (!leftDate && rightDate) return 1;
  if (leftDate && !rightDate) return -1;
  if (leftDate && rightDate) {
    if (leftDate.year !== rightDate.year) return leftDate.year - rightDate.year;
    if (leftDate.month === null && rightDate.month !== null) return 1;
    if (leftDate.month !== null && rightDate.month === null) return -1;
    if (leftDate.month !== null && rightDate.month !== null && leftDate.month !== rightDate.month) {
      return leftDate.month - rightDate.month;
    }
    if (leftDate.day === null && rightDate.day !== null) return 1;
    if (leftDate.day !== null && rightDate.day === null) return -1;
    if (leftDate.day !== null && rightDate.day !== null && leftDate.day !== rightDate.day) {
      return leftDate.day - rightDate.day;
    }
  }

  const catalogOrder = Number(hasCatalogNumber(right)) - Number(hasCatalogNumber(left));
  if (catalogOrder) return catalogOrder;
  const barcodeOrder = Number(Boolean(right.barcode)) - Number(Boolean(left.barcode));
  if (barcodeOrder) return barcodeOrder;
  const labelOrder = Number(Boolean(right.label || right.labels.length)) - Number(Boolean(left.label || left.labels.length));
  if (labelOrder) return labelOrder;
  return left.sourceId.localeCompare(right.sourceId);
}

function uniqueSources(values: MusicReleaseEvidence["sources"]) {
  return values.filter((source, index) =>
    values.findIndex((candidate) => candidate.url === source.url) === index,
  );
}

function releaseGroupSource(releaseGroupId: string) {
  return {
    provider: "musicbrainz" as const,
    title: "MusicBrainz release group",
    url: `https://musicbrainz.org/release-group/${releaseGroupId}`,
  };
}

function mergeReleaseGroupEvidence(
  release: MusicReleaseEvidence,
  releaseGroup: MusicReleaseEvidence | undefined,
) {
  const releaseGroupId = releaseGroup?.sourceId ?? release.releaseGroupId;
  const groupSources = releaseGroup?.sources ??
    (releaseGroupId ? [releaseGroupSource(releaseGroupId)] : []);
  return {
    ...release,
    releaseGroupId,
    type: releaseGroup?.type ?? release.type,
    secondaryTypes: releaseGroup?.secondaryTypes.length
      ? releaseGroup.secondaryTypes
      : release.secondaryTypes,
    sources: uniqueSources([...groupSources, ...release.sources]),
  };
}

function applyCoverEvidence(
  release: MusicReleaseEvidence,
  coverEvidence: MusicReleaseEvidence,
) {
  return {
    ...release,
    coverUrl: coverEvidence.coverUrl,
    coverSourceUrl: coverEvidence.coverSourceUrl,
    sources: uniqueSources([...release.sources, ...coverEvidence.sources]),
  };
}

function itemWarnings(release: MusicReleaseEvidence): ReleaseEvidenceItemWarning[] {
  const warnings: ReleaseEvidenceItemWarning[] = [];
  if (!release.date) warnings.push("missing-date");
  if (!release.label) warnings.push("missing-label");
  if (!release.catalogNumber) warnings.push("missing-catalog-number");
  if (!release.coverUrl) warnings.push("missing-cover");
  return warnings;
}

export function isWhitelistedMusicMetadataSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "musicbrainz.org" || url.hostname === "coverartarchive.org");
  } catch {
    return false;
  }
}

function sourceWhitelist(artist: MusicArtistEvidence, releases: readonly ArtistReleaseEvidenceItem[]) {
  const urls = new Set<string>();
  for (const item of artist.sources) {
    if (isWhitelistedMusicMetadataSourceUrl(item.url)) urls.add(item.url);
  }
  for (const release of releases) {
    for (const item of release.evidence.sources) {
      if (isWhitelistedMusicMetadataSourceUrl(item.url)) urls.add(item.url);
    }
    if (
      release.evidence.coverSourceUrl &&
      isWhitelistedMusicMetadataSourceUrl(release.evidence.coverSourceUrl)
    ) urls.add(release.evidence.coverSourceUrl);
  }
  return [...urls];
}

export async function researchArtistReleaseEvidence(
  input: ArtistReleaseEvidenceResearchInput,
  options: ResearchArtistReleaseEvidenceOptions = {},
): Promise<ArtistReleaseEvidenceBundle> {
  const validated = validateInput(input);
  const client = options.client ?? musicMetadataClient;
  const warnings: ArtistReleaseEvidenceWarning[] = [];
  const artistsById = new Map<string, MusicArtistEvidence>();
  const queries = [validated.artistName, ...validated.aliases]
    .filter((query, index, values) =>
      values.findIndex((candidate) => normalizeName(candidate) === normalizeName(query)) === index,
    )
    .slice(0, 3);

  for (const query of queries) {
    const search = await client.searchArtists(query, { limit: 25 });
    search.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
    search.value.items.forEach((artist) => artistsById.set(artist.sourceId, artist));
    if (
      [...artistsById.values()].some((artist) =>
        artistMatchStrength(artist, validated.artistName, validated.aliases) > 0,
      )
    ) break;
  }

  const selection = selectArtist(
    [...artistsById.values()],
    validated.artistName,
    validated.aliases,
    validated.targetCountry,
  );
  if (!selection.artist) {
    addWarning(warnings, selection.reason === "ambiguous"
      ? {
          code: "artist-ambiguous",
          message: "More than one exact MusicBrainz artist match remains; no release evidence was fetched.",
        }
      : selection.reason === "country-mismatch"
        ? {
            code: "artist-country-mismatch",
            message: `The exact artist match conflicts with target country ${validated.targetCountry}; no release evidence was fetched.`,
          }
        : {
            code: "artist-not-found",
            message: "MusicBrainz returned no exact artist-name or exact-alias match.",
          });
    return {
      query: {
        artistName: validated.artistName,
        targetCountry: validated.targetCountry,
        target: input.target,
      },
      artist: null,
      releases: [],
      sourceWhitelist: [],
      warnings,
      stats: {
        artistResultsInspected: artistsById.size,
        releaseGroupsFetched: 0,
        releasesFetched: 0,
        releasesAcceptedBeforeGrouping: 0,
        releaseGroupsAccepted: 0,
        releasesDeduplicated: 0,
        releasesAccepted: 0,
        coverLookups: 0,
      },
    };
  }

  let artist = selection.artist;
  const artistLookup = await client.getArtist(artist.sourceId);
  artistLookup.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
  if (artistLookup.value) artist = mergeArtistLookupEvidence(artist, artistLookup.value);
  if (artist.country === null) {
    addWarning(warnings, {
      code: "artist-country-unverified",
      message: `The selected MusicBrainz artist has no country value; releases are still restricted to ${validated.targetCountry}.`,
    });
  }

  await options.onProgress?.({ phase: "release-groups", processed: 0, total: 1 });
  const releaseGroupResult = await client.listArtistReleaseGroups(artist.sourceId, {
    maxItems: 500,
    maxPages: 5,
  });
  releaseGroupResult.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
  await options.onProgress?.({ phase: "release-groups", processed: 1, total: 1 });
  if (
    releaseGroupResult.value.count !== null &&
    releaseGroupResult.value.count > releaseGroupResult.value.items.length
  ) {
    addWarning(warnings, {
      code: "source-partial",
      message: "MusicBrainz has more release groups than the five-page safety limit; release-group evidence is partial.",
      count: releaseGroupResult.value.count - releaseGroupResult.value.items.length,
      source: "musicbrainz",
    });
  }

  await options.onProgress?.({ phase: "releases", processed: 0, total: 1 });
  const releaseResult = await client.listArtistReleases(artist.sourceId, {
    maxItems: 500,
    maxPages: 5,
  });
  releaseResult.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
  await options.onProgress?.({ phase: "releases", processed: 1, total: 1 });
  if (
    releaseResult.value.count !== null &&
    releaseResult.value.count > releaseResult.value.items.length
  ) {
    addWarning(warnings, {
      code: "source-partial",
      message: "MusicBrainz has more releases than the five-page safety limit; detailed release evidence is partial.",
      count: releaseResult.value.count - releaseResult.value.items.length,
      source: "musicbrainz",
    });
  }

  const uniqueReleases = [...new Map(
    releaseResult.value.items.map((release) => [release.sourceId, release]),
  ).values()];
  const uniqueReleaseGroups = [...new Map(
    releaseGroupResult.value.items.map((releaseGroup) => [releaseGroup.sourceId, releaseGroup]),
  ).values()];
  const releaseGroupsById = new Map(
    uniqueReleaseGroups.map((releaseGroup) => [releaseGroup.sourceId, releaseGroup]),
  );
  const filteredCounts = {
    nonOfficial: 0,
    nonJapan: 0,
    outsideFormat: 0,
    collaboration: 0,
    releaseType: 0,
  };
  const acceptedBeforeGrouping = uniqueReleases.filter((release) => {
    if (release.status?.toLowerCase() !== "official") {
      filteredCounts.nonOfficial += 1;
      return false;
    }
    if (release.country !== validated.targetCountry) {
      filteredCounts.nonJapan += 1;
      return false;
    }
    if (isOutsideTargetFormat(release, input.target)) {
      filteredCounts.outsideFormat += 1;
      return false;
    }
    if (!input.includeCollaborations && isCollaboration(release)) {
      filteredCounts.collaboration += 1;
      return false;
    }
    if (!input.includeLiveRemixBest && isExcludedReleaseType(release)) {
      filteredCounts.releaseType += 1;
      return false;
    }
    return true;
  });
  const acceptedByReleaseGroup = new Map<string, MusicReleaseEvidence[]>();
  for (const release of acceptedBeforeGrouping) {
    const key = release.releaseGroupId ?? `release:${release.sourceId}`;
    const group = acceptedByReleaseGroup.get(key) ?? [];
    group.push(release);
    acceptedByReleaseGroup.set(key, group);
  }
  const accepted = [...acceptedByReleaseGroup.values()]
    .map((releases) => {
      const canonical = [...releases].sort(canonicalReleaseSort)[0];
      return mergeReleaseGroupEvidence(
        canonical,
        canonical.releaseGroupId
          ? releaseGroupsById.get(canonical.releaseGroupId)
          : undefined,
      );
    })
    .sort(releaseSort);
  const releasesDeduplicated = acceptedBeforeGrouping.length - accepted.length;

  const filterWarnings: Array<[number, ArtistReleaseEvidenceWarning]> = [
    [filteredCounts.nonOfficial, {
      code: "non-official-filtered",
      message: "Non-official or status-unknown MusicBrainz releases were excluded.",
    }],
    [filteredCounts.nonJapan, {
      code: "outside-country-filtered",
      message: `Releases not explicitly identified as ${validated.targetCountry} editions were excluded.`,
    }],
    [filteredCounts.outsideFormat, {
      code: "outside-format-scope",
      message: input.target === "ALL_PHYSICAL"
        ? "Digital-only or format-unknown releases were excluded from the physical-media target."
        : "Releases without an explicitly identified CD medium were excluded.",
    }],
    [filteredCounts.collaboration, {
      code: "collaboration-filtered",
      message: "Multi-artist credited releases were excluded by the collaboration setting.",
    }],
    [filteredCounts.releaseType, {
      code: "release-type-filtered",
      message: "Compilation, live, remix, and DJ-mix releases were excluded by the release-type setting.",
    }],
  ];
  filterWarnings.forEach(([count, value]) => {
    if (count > 0) addWarning(warnings, { ...value, count });
  });

  if (input.excludeReissues) {
    addWarning(warnings, {
      code: "reissue-status-unavailable",
      message: "Later editions in the same MusicBrainz release group were consolidated to its earliest eligible edition; MusicBrainz still cannot explicitly identify every reissue represented by a separate release group.",
      ...(releasesDeduplicated > 0 ? { count: releasesDeduplicated } : {}),
    });
  }

  const maxCandidates = clampInteger(input.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, 120);
  const limited = accepted.slice(0, maxCandidates);
  if (accepted.length > limited.length) {
    addWarning(warnings, {
      code: "candidate-limit",
      message: "Verified candidates exceeded the evidence-bundle safety limit.",
      count: accepted.length - limited.length,
    });
  }

  const maxCoverLookups = clampInteger(input.maxCoverLookups, DEFAULT_MAX_COVER_LOOKUPS, 0, 240);
  const enriched: MusicReleaseEvidence[] = [];
  let coverLookups = 0;
  let coverLookupLimitedCandidates = 0;
  for (let releaseIndex = 0; releaseIndex < limited.length; releaseIndex += 1) {
    const release = limited[releaseIndex];
    if (release.coverUrl) {
      enriched.push(release);
      if ((releaseIndex + 1) % 5 === 0 || releaseIndex + 1 === limited.length) {
        await options.onProgress?.({ phase: "covers", processed: releaseIndex + 1, total: limited.length });
      }
      continue;
    }

    let candidate = release;
    let fullyChecked = true;
    if (coverLookups < maxCoverLookups) {
      coverLookups += 1;
      const releaseCover = await client.enrichWithCoverArt(release);
      releaseCover.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
      candidate = applyCoverEvidence(candidate, releaseCover.value);
    } else {
      fullyChecked = false;
    }

    const releaseGroup = release.releaseGroupId
      ? releaseGroupsById.get(release.releaseGroupId)
      : undefined;
    if (!candidate.coverUrl && releaseGroup) {
      if (coverLookups < maxCoverLookups) {
        coverLookups += 1;
        const groupCover = await client.enrichWithCoverArt(releaseGroup);
        groupCover.warnings.forEach((item) => addWarning(warnings, sourceWarning(item)));
        candidate = applyCoverEvidence(candidate, groupCover.value);
      } else {
        fullyChecked = false;
      }
    }

    if (!candidate.coverUrl && !fullyChecked) coverLookupLimitedCandidates += 1;
    enriched.push(candidate);
    if ((releaseIndex + 1) % 5 === 0 || releaseIndex + 1 === limited.length) {
      await options.onProgress?.({ phase: "covers", processed: releaseIndex + 1, total: limited.length });
    }
  }
  if (coverLookupLimitedCandidates > 0 && maxCoverLookups > 0) {
    addWarning(warnings, {
      code: "cover-lookup-limit",
      message: "Cover Art Archive lookups were capped to prevent a request storm; remaining covers stay unresolved.",
      count: coverLookupLimitedCandidates,
      source: "cover-art-archive",
    });
  }

  const releases = enriched.map((evidence): ArtistReleaseEvidenceItem => ({
    evidence,
    warnings: itemWarnings(evidence),
  }));
  return {
    query: {
      artistName: validated.artistName,
      targetCountry: validated.targetCountry,
      target: input.target,
    },
    artist,
    releases,
    sourceWhitelist: sourceWhitelist(artist, releases),
    warnings,
    stats: {
      artistResultsInspected: artistsById.size,
      releaseGroupsFetched: uniqueReleaseGroups.length,
      releasesFetched: uniqueReleases.length,
      releasesAcceptedBeforeGrouping: acceptedBeforeGrouping.length,
      releaseGroupsAccepted: accepted.length,
      releasesDeduplicated,
      releasesAccepted: releases.length,
      coverLookups,
    },
  };
}
