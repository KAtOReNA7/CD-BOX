import "server-only";

import type { ComprehensiveEvidenceObservation } from "@/lib/ai/comprehensive-evidence-audit";
import type {
  CuratedArtistDiscography,
  CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import {
  SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS,
  SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS,
  type SeikoMatsudaExternalEvidenceOutcome,
  type SeikoMatsudaOfficialCoverEvidence,
  type SeikoMatsudaOfficialEntity,
  type SeikoMatsudaOfficialResult,
  type SeikoMatsudaOfficialWorkKey,
} from "@/lib/official-music/seiko-matsuda";

const SEIKO_SLUG = "seiko-matsuda";
const SEIKO_NAME = "松田聖子";
const SEIKO_LATIN_NAME = "Seiko Matsuda";
const SEIKO_COUNTRY = "JP";
const SEIKO_MUSICBRAINZ_ARTIST_ID = "ef013257-e584-410e-88e8-05ea9ae9ea3a";

type FixedExpectation = {
  title: string;
  category: CuratedDiscographyWork["category"];
  sourceCategory: SeikoMatsudaOfficialEntity["observedCategory"];
  date: string;
  dateKind: SeikoMatsudaOfficialEntity["observedDateKind"];
  catalogNumbers: readonly string[];
  requiresTaxonomyConflict: boolean;
  requiresDateConflict: boolean;
};

const FIXED_EXPECTATIONS = {
  "SINGLE:22": {
    title: "DANCING SHOES (Club Mix)",
    category: "SINGLE",
    sourceCategory: "SINGLE",
    date: "1985-06-24",
    dateKind: "ORIGINAL_RELEASE",
    catalogNumbers: ["12AH-1896"],
    requiresTaxonomyConflict: false,
    requiresDateConflict: false,
  },
  "SINGLE:29": {
    title: "Who's that boy",
    category: "SINGLE",
    sourceCategory: "SINGLE",
    date: "1990-10-01",
    dateKind: "ORIGINAL_RELEASE",
    catalogNumbers: ["73523"],
    requiresTaxonomyConflict: false,
    requiresDateConflict: false,
  },
  "SINGLE:71": {
    title: "特別な恋人/声だけ聞かせて",
    category: "SINGLE",
    sourceCategory: "SINGLE",
    date: "2011-11-23",
    dateKind: "ORIGINAL_RELEASE",
    catalogNumbers: ["UMCK-5355"],
    requiresTaxonomyConflict: false,
    requiresDateConflict: false,
  },
  "ORIGINAL_ALBUM:29": {
    title: "Sweetest Time",
    category: "ORIGINAL_ALBUM",
    sourceCategory: "ALBUM",
    date: "1997-12-03",
    dateKind: "ORIGINAL_RELEASE",
    catalogNumbers: ["PHCL-12"],
    requiresTaxonomyConflict: true,
    requiresDateConflict: false,
  },
  "ORIGINAL_ALBUM:35": {
    title: "area62",
    category: "ORIGINAL_ALBUM",
    sourceCategory: "ALBUM",
    date: "2002-06-21",
    dateKind: "UNRESOLVED",
    catalogNumbers: ["VIVI-19623", "TGCS-1439"],
    requiresTaxonomyConflict: false,
    requiresDateConflict: true,
  },
} as const satisfies Record<SeikoMatsudaOfficialWorkKey, FixedExpectation>;

export type SeikoOfficialCuratedMatch = {
  manifestEntryKey: SeikoMatsudaOfficialWorkKey;
  manifestWork: CuratedDiscographyWork;
  entity: SeikoMatsudaOfficialEntity;
  authority: ComprehensiveEvidenceObservation;
  externalObservations: ComprehensiveEvidenceObservation[];
  cover: SeikoMatsudaOfficialCoverEvidence;
};

export type SeikoOfficialCuratedFailureCode =
  | "SOURCE_NOT_COMPLETE"
  | "ARTIST_IDENTITY_MISMATCH"
  | "MANIFEST_WORK_MISSING"
  | "OFFICIAL_FIXED_SET_INVALID"
  | "OFFICIAL_PROVENANCE_INVALID";

export type SeikoOfficialCuratedResult = {
  status: "COMPLETE" | "FAIL_CLOSED";
  complete: boolean;
  reasonCode: SeikoOfficialCuratedFailureCode | null;
  message: string | null;
  matches: SeikoOfficialCuratedMatch[];
  matchByManifestEntryKey: Partial<
    Record<SeikoMatsudaOfficialWorkKey, SeikoOfficialCuratedMatch>
  >;
};

function failClosed(
  reasonCode: SeikoOfficialCuratedFailureCode,
  message: string,
): SeikoOfficialCuratedResult {
  return {
    status: "FAIL_CLOSED",
    complete: false,
    reasonCode,
    message,
    matches: [],
    matchByManifestEntryKey: {},
  };
}

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function manifestKey(work: CuratedDiscographyWork) {
  return `${work.category}:${work.ordinal}`;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactArtistIdentity(manifest: CuratedArtistDiscography) {
  return manifest.slug === SEIKO_SLUG &&
    manifest.canonicalName.normalize("NFKC").trim() === SEIKO_NAME &&
    manifest.aliases.some((alias) => alias.normalize("NFKC").trim() === SEIKO_LATIN_NAME) &&
    manifest.country === SEIKO_COUNTRY &&
    manifest.musicBrainzArtistId.toLocaleLowerCase("en") === SEIKO_MUSICBRAINZ_ARTIST_ID;
}

function safeOfficialCover(
  entity: SeikoMatsudaOfficialEntity,
  expectedSourceUrl: string,
) {
  if (
    entity.cover.provider !== "seiko-matsuda-official" ||
    entity.cover.scope !== "WORK" ||
    entity.cover.matchLevel !== "WORK_EXACT" ||
    entity.cover.requiresAssetValidation !== true ||
    entity.cover.sourceUrl !== expectedSourceUrl ||
    entity.cover.observedAlt.normalize("NFKC").trim() !== entity.observedTitle
  ) return false;
  try {
    const cover = new URL(entity.cover.url);
    return cover.protocol === "https:" &&
      !cover.username &&
      !cover.password &&
      !cover.port &&
      cover.hostname === "www.seikomatsuda.co.jp" &&
      /^\/discography\/images\/upload\/[A-Za-z0-9_.-]+\.(?:gif|jpe?g|png|webp)$/iu
        .test(cover.pathname) &&
      !cover.search &&
      !cover.hash;
  } catch {
    return false;
  }
}

function validEntity(
  key: SeikoMatsudaOfficialWorkKey,
  entity: SeikoMatsudaOfficialEntity,
) {
  const expected = FIXED_EXPECTATIONS[key];
  const expectedSourceUrl = SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[key];
  const tracks = new Set(entity.tracks.map((track) => normalized(track.title)));
  return entity.manifestEntryKey === key &&
    entity.sourceUrl === expectedSourceUrl &&
    entity.provider === "seiko-matsuda-official" &&
    entity.sourceType === "official-artist-entity-page" &&
    entity.evidenceScope === "single-item-page" &&
    entity.observedArtist === SEIKO_NAME &&
    entity.observedTitle === expected.title &&
    entity.observedCategory === expected.sourceCategory &&
    entity.manifestCategory === expected.category &&
    entity.observedReleaseDate === expected.date &&
    entity.observedDateKind === expected.dateKind &&
    sameStrings(entity.observedCatalogNumbers, expected.catalogNumbers) &&
    entity.observedCatalogDisplay.trim().length > 0 &&
    entity.tracks.length > 0 &&
    entity.identityTrackTitles.length > 0 &&
    entity.identityTrackTitles.every((title) => tracks.has(normalized(title))) &&
    Boolean(entity.conflicts.taxonomy) === expected.requiresTaxonomyConflict &&
    Boolean(entity.conflicts.date) === expected.requiresDateConflict &&
    (!entity.conflicts.taxonomy || entity.conflicts.taxonomy.status === "UNRESOLVED") &&
    (!entity.conflicts.date || entity.conflicts.date.status === "UNRESOLVED") &&
    safeOfficialCover(entity, expectedSourceUrl);
}

function officialAuthority(
  work: CuratedDiscographyWork,
  entity: SeikoMatsudaOfficialEntity,
): ComprehensiveEvidenceObservation {
  const key = entity.manifestEntryKey;
  const fixedPageId = new URL(entity.sourceUrl).pathname.split("/").filter(Boolean).at(-1) ?? null;
  return {
    id: `seiko-matsuda-official:entity:${key}`,
    provider: "seiko-matsuda-official",
    role: "AUTHORITATIVE",
    strength: "STRONG",
    stage: "AUTHORITATIVE",
    verdict: "PASS",
    reasonCode: "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
    reason: "The fixed official artist entity page exactly confirms the canonical work title, category boundary, original date, catalog identity, track boundary, and work-level artwork.",
    sourceUrl: entity.sourceUrl,
    matchedFields: [
      "artist",
      "artistCredit",
      "title",
      "category",
      "date",
      "catalogNumber",
      "tracks",
    ],
    facts: {
      manifestEntryKey: key,
      verified: "true",
      unique: "true",
      provenanceSourceUrl: entity.sourceUrl,
      fixedPageId,
      artist: entity.observedArtist,
      artistCredit: work.artistCredits?.join(",") ?? entity.observedArtist,
      title: entity.observedTitle,
      canonicalTitle: work.title,
      category: work.category,
      officialCategory: entity.observedCategory,
      date: entity.observedReleaseDate,
      dateKind: entity.observedDateKind,
      originalCatalogNumber: entity.observedCatalogNumbers[0] ?? null,
      catalogNumber: entity.observedCatalogNumbers[0] ?? null,
      catalogNumbers: entity.observedCatalogNumbers.join(","),
      identityTrackTitles: entity.identityTrackTitles.join("|"),
      coverUrl: entity.cover.url,
    },
  };
}

function validVerifiedOutcome(
  outcome: SeikoMatsudaExternalEvidenceOutcome | undefined,
): outcome is Extract<SeikoMatsudaExternalEvidenceOutcome, { status: "VERIFIED" }> {
  return outcome?.status === "VERIFIED" && outcome.verified && outcome.unique &&
    outcome.warning === null && outcome.limitations.length === 0;
}

function whoExternalObservations(
  official: SeikoMatsudaOfficialResult,
): ComprehensiveEvidenceObservation[] {
  const ndl = official.externalEvidence.sources.WHOS_NDL;
  const sony = official.externalEvidence.sources.WHOS_SONY_BOX;
  const observations: ComprehensiveEvidenceObservation[] = [];
  if (
    validVerifiedOutcome(ndl) &&
    ndl.evidence.evidenceKey === "WHOS_NDL" &&
    ndl.evidence.workKey === "SINGLE:29" &&
    ndl.evidence.provenance.sourceUrl === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_NDL
  ) {
    observations.push({
      id: "national-diet-library:seiko-whos-that-boy:single-29",
      provider: "national-diet-library",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "SEIKO_NDL_WHOS_CD_VERIFIED",
      reason: "The fixed National Diet Library record uniquely identifies the Seiko CD, title, month, and catalog number.",
      sourceUrl: ndl.evidence.provenance.sourceUrl,
      matchedFields: [
        "artist",
        "artistCredit",
        "title",
        "catalogNumber",
        "date",
        "carrier",
      ],
      facts: {
        manifestEntryKey: "SINGLE:29",
        verified: "true",
        unique: "true",
        provenanceSourceUrl: ndl.evidence.provenance.sourceUrl,
        fixedRecordId: ndl.evidence.provenance.fixedRecordId,
        canonicalArtist: SEIKO_NAME,
        observedArtist: ndl.evidence.observedArtist,
        artistCredit: "SEIKO",
        title: ndl.evidence.observedTitle,
        catalogNumber: ndl.evidence.observedCatalogNumber,
        date: ndl.evidence.observedDate,
        carrier: ndl.evidence.carrier,
      },
    });
  }
  if (
    validVerifiedOutcome(sony) &&
    sony.evidence.evidenceKey === "WHOS_SONY_BOX" &&
    sony.evidence.workKey === "SINGLE:29" &&
    sony.evidence.provenance.sourceUrl === SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.WHOS_SONY_BOX
  ) {
    observations.push({
      id: "sony-music-japan:seiko-complete-singles-box:single-29",
      provider: "sony-music-japan",
      role: "CORROBORATING",
      strength: "STRONG",
      stage: "CORROBORATION",
      verdict: "PASS",
      reasonCode: "SEIKO_SONY_COMPLETE_SINGLES_CD_BOX_VERIFIED",
      reason: "Sony Music Japan's fixed complete-singles box page identifies Who's that boy as one of 73 Blu-spec CD singles and supplies the box date and catalog range.",
      sourceUrl: sony.evidence.provenance.sourceUrl,
      matchedFields: [
        "artist",
        "artistCredit",
        "title",
        "boxCompleteness",
        "date",
        "catalogRange",
        "carrier",
      ],
      facts: {
        manifestEntryKey: "SINGLE:29",
        verified: "true",
        unique: "true",
        provenanceSourceUrl: sony.evidence.provenance.sourceUrl,
        artist: sony.evidence.observedArtist,
        artistCredit: sony.evidence.observedArtistCredit,
        canonicalTitle: "Who's that boy",
        observedTitle: sony.evidence.observedWorkTitle,
        catalogDisplay: sony.evidence.observedCatalogDisplay,
        catalogStart: sony.evidence.observedCatalogRange.start,
        catalogEnd: sony.evidence.observedCatalogRange.end,
        date: sony.evidence.observedBoxReleaseDate,
        carrier: sony.evidence.carrier,
        completeSinglesCount: String(sony.evidence.completeSinglesCount),
        cdDiscCount: String(sony.evidence.cdDiscCount),
      },
    });
  }
  return observations;
}

function dancingExternalObservations(
  official: SeikoMatsudaOfficialResult,
): ComprehensiveEvidenceObservation[] {
  const ndl = official.externalEvidence.sources.DANCING_NDL;
  if (
    ndl?.status !== "PARTIAL" ||
    ndl.verified ||
    !ndl.unique ||
    ndl.evidence.evidenceKey !== "DANCING_NDL" ||
    ndl.evidence.workKey !== "SINGLE:22" ||
    ndl.evidence.provenance.sourceUrl !== SEIKO_MATSUDA_EXTERNAL_EVIDENCE_URLS.DANCING_NDL
  ) return [];
  return [{
    id: "national-diet-library:seiko-dancing-shoes:single-22",
    provider: "national-diet-library",
    role: "CORROBORATING",
    strength: "SUPPORTING",
    stage: "CORROBORATION",
    verdict: "UNKNOWN",
    reasonCode: "SEIKO_DANCING_NDL_PARTIAL_CATALOG_MATCH",
    reason: "The fixed National Diet Library record uniquely matches the title, analog carrier, and catalog number, but does not supply artist or date and therefore is not independent identity proof.",
    sourceUrl: ndl.evidence.provenance.sourceUrl,
    matchedFields: ["title", "catalogNumber", "format"],
    facts: {
      manifestEntryKey: "SINGLE:22",
      artist: null,
      title: ndl.evidence.observedTitle,
      catalogNumber: ndl.evidence.observedCatalogNumber,
      date: null,
      format: ndl.evidence.carrier,
      uniqueBinding: "true",
      limitations: ndl.limitations.join(","),
    },
  }];
}

/**
 * Converts the fail-closed fixed official source into candidate-ready facts.
 * It never creates candidates or relaxes generic title/date/category matching.
 */
export function matchSeikoOfficialEntitiesToCurated(
  manifest: CuratedArtistDiscography,
  official: SeikoMatsudaOfficialResult,
): SeikoOfficialCuratedResult {
  if (!official.complete || official.status !== "FIXED_SET_COMPLETE") {
    return failClosed(
      "SOURCE_NOT_COMPLETE",
      "The five fixed Seiko official pages were not complete, so no dynamic authority was emitted.",
    );
  }
  if (!exactArtistIdentity(manifest)) {
    return failClosed(
      "ARTIST_IDENTITY_MISMATCH",
      "The curated manifest did not have the exact Seiko Matsuda identity, country, and MusicBrainz id.",
    );
  }

  const keys = Object.keys(FIXED_EXPECTATIONS) as SeikoMatsudaOfficialWorkKey[];
  if (
    official.works.length !== keys.length ||
    official.sourceResults.length !== keys.length ||
    official.sourceResults.some((result) => result.status !== "COMPLETE") ||
    official.warnings.length !== 0 ||
    new Set(official.works.map((entity) => entity.manifestEntryKey)).size !== keys.length ||
    new Set(official.sourceResults.map((result) => result.workKey)).size !== keys.length ||
    keys.some((key) => !official.sourceResults.some((result) =>
      result.workKey === key &&
      result.url === SEIKO_MATSUDA_OFFICIAL_DETAIL_URLS[key] &&
      result.failureCode === null &&
      result.message === null))
  ) {
    return failClosed(
      "OFFICIAL_FIXED_SET_INVALID",
      "The official result was marked complete but did not contain one unique complete five-entity set.",
    );
  }

  const manifestByKey = new Map(manifest.works.map((work) => [manifestKey(work), work]));
  const matches: SeikoOfficialCuratedMatch[] = [];
  for (const key of keys) {
    const expected = FIXED_EXPECTATIONS[key];
    const work = manifestByKey.get(key);
    if (
      !work ||
      work.category !== expected.category ||
      work.title !== expected.title ||
      work.originalReleaseDate !== expected.date
    ) {
      return failClosed(
        "MANIFEST_WORK_MISSING",
        `The curated manifest was missing the exact fixed work ${key}.`,
      );
    }
    const entity = official.byManifestEntryKey[key];
    const listedEntities = official.works.filter((item) => item.manifestEntryKey === key);
    if (
      !entity ||
      listedEntities.length !== 1 ||
      listedEntities[0]!.sourceUrl !== entity.sourceUrl ||
      listedEntities[0]!.observedTitle !== entity.observedTitle ||
      listedEntities[0]!.observedReleaseDate !== entity.observedReleaseDate ||
      listedEntities[0]!.cover.url !== entity.cover.url ||
      !validEntity(key, entity)
    ) {
      return failClosed(
        "OFFICIAL_PROVENANCE_INVALID",
        `The official entity ${key} did not preserve the fixed identity and provenance boundary.`,
      );
    }
    const externalObservations = key === "SINGLE:29"
      ? whoExternalObservations(official)
      : key === "SINGLE:22"
        ? dancingExternalObservations(official)
        : [];
    matches.push({
      manifestEntryKey: key,
      manifestWork: work,
      entity,
      authority: officialAuthority(work, entity),
      externalObservations,
      cover: entity.cover,
    });
  }

  return {
    status: "COMPLETE",
    complete: true,
    reasonCode: null,
    message: null,
    matches,
    matchByManifestEntryKey: Object.fromEntries(
      matches.map((match) => [match.manifestEntryKey, match]),
    ),
  };
}
