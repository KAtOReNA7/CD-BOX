import "server-only";

import { createHash } from "node:crypto";
import type { ReleaseCategory } from "@prisma/client";
import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import type { ReleaseResearchRequest } from "@/lib/ai/release-research-types";
import type { DiscogsSearchReleaseEvidence } from "@/lib/discogs/types";

function normalizedCatalog(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("und")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function releaseYear(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function discogsTitle(value: string) {
  const separator = value.indexOf(" - ");
  return separator >= 0 ? value.slice(separator + 3).trim() : value.trim();
}

function discogsArtistCredit(value: string) {
  const separator = value.indexOf(" - ");
  return separator >= 0 ? value.slice(0, separator).trim() : "";
}

function normalizedFormats(formats: readonly string[]) {
  return formats.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase("en"));
}

function discogsCategory(formats: readonly string[]): ReleaseCategory {
  const values = normalizedFormats(formats);
  if (values.some((value) => value.includes("box"))) return "BOX";
  if (values.some((value) => value === "live")) return "LIVE";
  if (values.some((value) => value === "remix" || value === "dj mix" || value === "dj-mix")) {
    return "REMIX";
  }
  if (values.some((value) => value === "compilation" || value === "best")) return "COLLECTION";
  if (values.some((value) => value === "single")) return "SINGLE";
  if (values.some((value) => value === "ep" || value.includes("mini-album"))) return "EP";
  // A Discogs "Album" format does not distinguish an original studio album
  // from other long-form releases. Keep it unclassified until an authority
  // supplies that work-level fact.
  if (values.some((value) => value === "album")) return "OTHER";
  return "OTHER";
}

function rowAlreadyRepresented(
  row: DiscogsSearchReleaseEvidence,
  candidates: readonly ComprehensiveDiscographyCandidate[],
) {
  const catalog = normalizedCatalog(row.catalogNumber);
  if (!catalog || row.year === null) return false;
  // A normalized catalog number plus release year identifies the physical
  // edition before title-script differences are adjudicated. Requiring an
  // exact title here created duplicate works for bilingual Discogs rows.
  return candidates.some(({ candidate }) =>
    normalizedCatalog(candidate.catalogNumber) === catalog &&
    releaseYear(candidate.releaseDate ?? candidate.originalReleaseDate) === row.year);
}

function isExcludedCategory(category: ReleaseCategory) {
  return category === "BOX" || category === "COLLECTION" || category === "LIVE" ||
    category === "REMIX";
}

export function classifyDiscogsFormatScope(
  formats: readonly string[],
  request: ReleaseResearchRequest,
  category = discogsCategory(formats),
  options: {
    isEarliestJapanCdEdition?: boolean;
    sourceComplete?: boolean;
  } = {},
) {
  const values = normalizedFormats(formats);
  const isReissue = values.some((value) => value === "reissue");
  const isRemaster = values.some((value) => value === "remastered" || value === "remaster");
  const isPromo = values.some((value) => value === "promo" || value === "promotional");

  if (isPromo) {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "OUT_OF_SCOPE" as const,
      reasonCode: "DISCOGS_PROMOTIONAL_EDITION_OUT_OF_SCOPE",
      reason: "Discogs explicitly marks this edition as promotional rather than a commercial release.",
    };
  }
  if (request.excludeReissues && options.isEarliestJapanCdEdition === false) {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "OUT_OF_SCOPE" as const,
      reasonCode: "DISCOGS_LATER_MASTER_EDITION_OUT_OF_SCOPE",
      reason: "An earlier Japan CD edition exists for the same work.",
    };
  }
  if (
    request.excludeReissues &&
    (isReissue || isRemaster) &&
    options.isEarliestJapanCdEdition !== true
  ) {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "OUT_OF_SCOPE" as const,
      reasonCode: "DISCOGS_REISSUE_OUT_OF_SCOPE",
      reason: "The requested scope excludes editions explicitly marked Reissue or Remastered by Discogs.",
    };
  }
  if (
    request.excludeReissues &&
    (isReissue || isRemaster) &&
    options.sourceComplete === false
  ) {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "UNKNOWN" as const,
      reasonCode: "DISCOGS_FIRST_CD_EDITION_UNRESOLVED",
      reason: "Discogs marks this edition as a reissue, but the partial search cannot prove that it is the earliest Japan CD edition for the work.",
    };
  }
  if (isExcludedCategory(category) && (category === "BOX" || !request.includeLiveRemixBest)) {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "OUT_OF_SCOPE" as const,
      reasonCode: "DISCOGS_RELEASE_TYPE_OUT_OF_SCOPE",
      reason: "The requested scope excludes this explicit release type.",
    };
  }
  if (category === "OTHER") {
    return {
      category,
      isReissue,
      isRemaster,
      verdict: "UNKNOWN" as const,
      reasonCode: "DISCOGS_WORK_TYPE_UNRESOLVED",
      reason: "Discogs proves a Japan CD edition but does not establish whether this long-form work is an original album.",
    };
  }
  return {
    category,
    isReissue,
    isRemaster,
    verdict: "PASS" as const,
    reasonCode: isReissue || isRemaster
      ? "DISCOGS_EARLIEST_JAPAN_CD_SCOPE"
      : "DISCOGS_JAPAN_CD_SCOPE",
    reason: isReissue || isRemaster
      ? "Discogs marks this as a reissue of an older format, but it is the earliest identified Japan CD edition for the work."
      : "Discogs explicitly identifies an in-scope Japan CD edition; an independent authority is still required.",
  };
}

function stableWorkToken(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function canonicalPartialDate(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (/^\d{4}$/.test(normalized)) return normalized;
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(normalized)) return normalized;
  const exact = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!exact) return null;
  const year = Number(exact[1]);
  const month = Number(exact[2]);
  const day = Number(exact[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ? normalized
    : null;
}

function isMusicBrainzWorkCandidate(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.observations.some((item) =>
    item.provider === "musicbrainz" && item.stage === "MUSICBRAINZ") &&
    candidate.candidate.sources.some((source) =>
      /^https:\/\/musicbrainz\.org\/(?:release|release-group)\/[0-9a-f-]+$/i.test(source.url));
}

/**
 * Reuses work-level metadata only after the caller has bound one Discogs
 * master to exactly one MusicBrainz work through an exact physical-edition
 * identifier match. The existing MusicBrainz candidates are deliberately the
 * only metadata source here; another supplemental row must never become a
 * canonical work profile merely because it already carries the same work id.
 */
function canonicalMusicBrainzWorkMetadata(
  workId: string | null,
  candidates: readonly ComprehensiveDiscographyCandidate[],
) {
  if (!workId) return null;
  const musicBrainzCandidates = candidates
    .filter((candidate) => candidate.workId === workId && isMusicBrainzWorkCandidate(candidate));
  if (musicBrainzCandidates.length === 0) return null;

  const originalReleaseDates = [...new Set(musicBrainzCandidates
    .map((candidate) => canonicalPartialDate(candidate.candidate.originalReleaseDate))
    .filter((value): value is string => Boolean(value)))];
  const categories = [...new Set(musicBrainzCandidates.map((candidate) =>
    candidate.candidate.category))];
  const originalReleaseDate = originalReleaseDates.length === 1
    ? originalReleaseDates[0]!
    : null;
  const category = categories.length === 1 ? categories[0]! : null;
  const representative = [...musicBrainzCandidates].sort((left, right) => {
    const leftOriginalEdition = originalReleaseDate !== null &&
      canonicalPartialDate(left.candidate.releaseDate) === originalReleaseDate;
    const rightOriginalEdition = originalReleaseDate !== null &&
      canonicalPartialDate(right.candidate.releaseDate) === originalReleaseDate;
    if (leftOriginalEdition !== rightOriginalEdition) return leftOriginalEdition ? -1 : 1;
    const leftDate = canonicalPartialDate(left.candidate.releaseDate) ?? "9999";
    const rightDate = canonicalPartialDate(right.candidate.releaseDate) ?? "9999";
    return leftDate.localeCompare(rightDate) || left.editionId.localeCompare(right.editionId);
  })[0]!;

  return {
    title: representative.candidate.title.trim(),
    titleOriginal: representative.candidate.titleOriginal?.trim() || null,
    originalReleaseDate,
    category,
  };
}

/**
 * Discogs is discovery/corroboration only. These seeds can reach AI solely
 * after an independent strong authority (for example NDL or an official
 * catalogue) binds the same Japan CD edition by stable identifiers.
 */
export function discoverDiscogsSupplementalCandidates(input: {
  rows: readonly DiscogsSearchReleaseEvidence[];
  existingCandidates: readonly ComprehensiveDiscographyCandidate[];
  request: ReleaseResearchRequest;
  artistCredit: string;
  knownWorkIdsByMaster?: ReadonlyMap<number, string>;
  sourceComplete?: boolean;
  maximum?: number;
}) {
  const maximum = Math.min(300, Math.max(0, Math.trunc(input.maximum ?? 200)));
  const output: ComprehensiveDiscographyCandidate[] = [];
  const primaryReleaseByMaster = new Map<number, number>();
  for (const row of [...input.rows].sort((left, right) =>
    (left.year ?? 9999) - (right.year ?? 9999) || left.releaseId - right.releaseId)) {
    if (row.masterId !== null && row.catalogNumber && row.year !== null && !primaryReleaseByMaster.has(row.masterId)) {
      primaryReleaseByMaster.set(row.masterId, row.releaseId);
    }
  }
  for (const row of input.rows) {
    if (output.length >= maximum) break;
    if (
      !row.catalogNumber ||
      row.year === null ||
      rowAlreadyRepresented(row, [...input.existingCandidates, ...output])
    ) {
      continue;
    }
    const sourceTitle = discogsTitle(row.title);
    const suppliedArtistCredit = discogsArtistCredit(row.title);
    const mappedWorkId = row.masterId === null
      ? null
      : input.knownWorkIdsByMaster?.get(row.masterId) ?? null;
    const canonicalWork = canonicalMusicBrainzWorkMetadata(
      mappedWorkId,
      input.existingCandidates,
    );
    const title = canonicalWork?.title || sourceTitle;
    const category = canonicalWork?.category ?? discogsCategory(row.formats);
    const isPrimaryMasterEdition = row.masterId !== null &&
      primaryReleaseByMaster.get(row.masterId) === row.releaseId;
    let scope = classifyDiscogsFormatScope(row.formats, input.request, category, {
      isEarliestJapanCdEdition: row.masterId === null ? undefined : isPrimaryMasterEdition,
      sourceComplete: input.sourceComplete ?? true,
    });
    if (
      input.request.excludeReissues &&
      row.masterId !== null &&
      !isPrimaryMasterEdition
    ) {
      scope = {
        ...scope,
        verdict: "OUT_OF_SCOPE" as const,
        reasonCode: "DISCOGS_LATER_MASTER_EDITION_OUT_OF_SCOPE",
        reason: "An earlier Japan CD edition exists in the same Discogs work grouping.",
      };
    } else if (row.masterId === null && scope.verdict === "PASS") {
      scope = {
        ...scope,
        verdict: "UNKNOWN" as const,
        reasonCode: "DISCOGS_WORK_IDENTITY_UNRESOLVED",
        reason: "Discogs supplies the edition but no stable work grouping; keep it pending instead of counting an edition as a new work.",
      };
    }
    if (
      !input.request.includeCollaborations &&
      /(?:\s(?:&|and|with|feat\.?|featuring|×)\s|[,、])/iu.test(suppliedArtistCredit)
    ) {
      scope = {
        ...scope,
        verdict: "OUT_OF_SCOPE" as const,
        reasonCode: "DISCOGS_COLLABORATION_OUT_OF_SCOPE",
        reason: "The requested scope excludes an explicitly collaborative Discogs artist credit.",
      };
    }
    const candidateId = `discogs-release-${row.releaseId}`;
    const editionId = `discogs:${row.releaseId}`;
    // Discogs masters are supporting metadata, not canonical work authority.
    // Reuse a master link only when an existing exact edition already bound it
    // to one work; otherwise keep a release-specific provisional work identity.
    const workId = mappedWorkId ??
      `discogs-provisional-work:${stableWorkToken(String(row.releaseId))}`;
    output.push({
      candidate: {
        id: candidateId,
        title,
        titleOriginal: canonicalWork?.titleOriginal ?? null,
        category,
        artistCredit: suppliedArtistCredit || input.artistCredit,
        releaseDate: String(row.year),
        originalReleaseDate: canonicalWork?.originalReleaseDate ?? null,
        format: row.formats.join(", ") || "CD",
        catalogNumber: row.catalogNumber,
        barcode: row.barcode,
        label: row.labels[0] ?? null,
        originalPrice: null,
        editionType: null,
        isReissue: scope.isReissue,
        isRemaster: scope.isRemaster,
        isExcludedByDefault: scope.verdict === "OUT_OF_SCOPE",
        coverImageUrl: null,
        coverImageSourceUrl: null,
        notes: null,
        confidence: "LOW",
        warnings: [
          "Supplemental Discogs discovery requires an independent strong authority before AI review.",
        ],
        sources: [{ title: "Discogs release", url: row.sourceUrl, sourceType: "database" }],
        verification: null,
      },
      workId,
      editionId,
      observations: [
        {
          id: `scope:${editionId}`,
          provider: "discogs",
          role: "DISCOVERY",
          strength: "SUPPORTING",
          stage: "SCOPE",
          verdict: scope.verdict,
          reasonCode: scope.reasonCode,
          reason: scope.reason,
          sourceUrl: row.sourceUrl,
          matchedFields: ["country", "format"],
        },
        {
          id: `discogs:${candidateId}`,
          provider: "discogs",
          role: "CORROBORATING",
          strength: "SUPPORTING",
          stage: "CORROBORATION",
          verdict: "PASS",
          reasonCode: "DISCOGS_JAPAN_CD_DISCOVERY",
          reason: "Discogs supplies a catalog-bound Japan CD edition seed.",
          sourceUrl: row.sourceUrl,
          matchedFields: ["title", "catalogNumber", "year", "country", "format"],
          facts: {
            title: sourceTitle,
            canonicalWorkTitle: canonicalWork?.title ?? null,
            canonicalOriginalReleaseDate: canonicalWork?.originalReleaseDate ?? null,
            canonicalCategory: canonicalWork?.category ?? null,
            catalogNumber: row.catalogNumber,
            year: String(row.year),
            releaseId: String(row.releaseId),
          },
        },
      ],
      conflicts: [],
    });
  }
  return output;
}
