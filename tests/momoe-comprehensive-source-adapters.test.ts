import assert from "node:assert/strict";
import test from "node:test";
import type { CoverAssetValidationResult } from "@/lib/ai/cover-asset-validation";
import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import { classifyComprehensiveEvidence } from "@/lib/ai/comprehensive-evidence-audit";
import {
  prepareComprehensiveSourceEvidence,
  type ComprehensiveSourceAdapterDependencies,
} from "@/lib/ai/comprehensive-source-adapters";
import type {
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import type {
  DiscogsJapanCdSearchResult,
  DiscogsJapanPhysicalSearchResult,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";
import type {
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";
import type {
  CuratedArtistDiscography,
  CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import {
  MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
  MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
  MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL,
  MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS,
  momoeYamaguchiSonyAlbumJsonpUrl,
  momoeYamaguchiSonyAlbumProductUrl,
  type MomoeYamaguchiCanonicalWork,
  type MomoeYamaguchiCatalogResult,
  type MomoeYamaguchiPhysicalCdCarrierEvidence,
  type MomoeYamaguchiWorkCoverEvidence,
} from "@/lib/official-music/momoe-yamaguchi";

const MOMOE_NAME = "\u5c71\u53e3\u767e\u6075";
const MOMOE_ALIAS = "Momoe Yamaguchi";
const MOMOE_MBID = "85c1ff8e-b819-416d-9b73-5be468f7211a";

const request: ReleaseResearchRequest = {
  artistName: MOMOE_NAME,
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: false,
  includeLiveRemixBest: false,
};

function isoDate(year: number, offset: number) {
  return new Date(Date.UTC(year, 0, offset + 1)).toISOString().slice(0, 10);
}

function manifestWork(
  category: CuratedDiscographyWork["category"],
  ordinal: number,
): CuratedDiscographyWork {
  const single = category === "SINGLE";
  const prefix = single ? "Single" : "Album";
  const catalogNumber = single
    ? null
    : MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS[ordinal - 1]!;
  return {
    ordinal,
    title: `${prefix} ${ordinal}`,
    aliases: [`Official ${prefix} ${ordinal}`],
    category,
    originalReleaseDate: isoDate(single ? 1973 : 1975, ordinal - 1),
    authorityUrls: [single
      ? MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL
      : momoeYamaguchiSonyAlbumProductUrl(catalogNumber!)],
    authorityAsOf: "2026-07-12",
    mediaScope: null,
  };
}

function momoeManifest(): CuratedArtistDiscography {
  return {
    slug: "momoe-yamaguchi",
    canonicalName: MOMOE_NAME,
    aliases: [MOMOE_ALIAS],
    musicBrainzArtistId: MOMOE_MBID,
    country: "JP",
    works: [
      ...Array.from({ length: 32 }, (_, index) => manifestWork("SINGLE", index + 1)),
      ...Array.from({ length: 22 }, (_, index) => manifestWork("ORIGINAL_ALBUM", index + 1)),
    ],
  };
}

function momoeCarrierManifest(): CuratedArtistDiscography {
  const manifest = momoeManifest();
  return {
    ...manifest,
    works: manifest.works.map((work): CuratedDiscographyWork => work.category === "SINGLE"
      ? {
          ...work,
          authorityUrls: [
            "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-30295",
          ],
          authorityAsOf: "2015-02-11",
          mediaScope: {
            originalFormats: ["VINYL"],
            physicalCd: "LATER_OFFICIAL_EDITION",
            physicalCdAuthorityUrls: [
              "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-30295",
            ],
            physicalCdReleaseDate: "2015-02-11",
            physicalCdCatalogNumber: "MHCL-30295～30298",
            physicalCdRepresentationKind: "CONTAINER_INCLUSION",
            physicalCdContainerTitle: "ゴールデン☆アイドル 山口百恵",
            exclusionReason: null,
          },
        }
      : work),
  };
}

function momoeCosmosCarrierManifest(): CuratedArtistDiscography {
  const manifest = momoeManifest();
  return {
    ...manifest,
    works: manifest.works.map((work): CuratedDiscographyWork =>
      work.category === "ORIGINAL_ALBUM" && work.ordinal === 14
        ? {
            ...work,
            title: "COSMOS（宇宙）",
            aliases: ["COSMOS宇宙", "COSMOS 宇宙"],
            originalReleaseDate: "1978-05-01",
            mediaScope: {
              originalFormats: ["VINYL"],
              physicalCd: "LATER_OFFICIAL_EDITION",
              physicalCdCountry: "JP",
              physicalCdAuthorityUrls: [MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL],
              physicalCdReleaseDate: "1993-06-21",
              physicalCdCatalogNumber: "SRCL-2622",
              physicalCdRepresentationKind: "SAME_WORK_EDITION",
              physicalCdContainerTitle: null,
              exclusionReason: null,
            },
          }
        : work),
  };
}

function cosmosPhysicalCdCarrier(
  overrides: Partial<MomoeYamaguchiPhysicalCdCarrierEvidence> = {},
): MomoeYamaguchiPhysicalCdCarrierEvidence {
  return {
    provider: "sony-music-japan",
    scope: "EDITION",
    matchLevel: "EDITION_EXACT",
    artist: MOMOE_NAME,
    title: "COSMOS宇宙",
    country: "JP",
    format: "CD",
    releaseDate: "1993-06-21",
    catalogNumber: "SRCL-2622",
    sourceUrl: MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL,
    retrievalUrl: MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL,
    coverUrl:
      "https://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/94245.jpg",
    ...overrides,
  };
}

function officialWork(work: CuratedDiscographyWork): MomoeYamaguchiCanonicalWork {
  const single = work.category === "SINGLE";
  const catalogNumber = single
    ? `SOLB ${100 + work.ordinal}`
    : MOMOE_YAMAGUCHI_SONY_ALBUM_CATALOG_NUMBERS[work.ordinal - 1]!;
  const sourceUrl = single
    ? MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL
    : momoeYamaguchiSonyAlbumProductUrl(catalogNumber);
  const retrievalUrl = single
    ? sourceUrl
    : momoeYamaguchiSonyAlbumJsonpUrl(catalogNumber);
  const cover: MomoeYamaguchiWorkCoverEvidence = {
    provider: "sony-music-otonano",
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url: single
      ? `https://www.110107.com/files/6/OTONANO/originalpage/golden_idol/img/momoe/S${work.ordinal}.jpg`
      : `https://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/${83250172 + work.ordinal}.jpg`,
    sourceUrl,
  };
  const sourceEdition = single
    ? null
    : { catalogNumber, releaseDate: "2004-05-19" };
  const observedTitle = work.aliases[0]!;
  return {
    ordinal: work.ordinal,
    title: observedTitle,
    aliases: [],
    category: work.category,
    originalReleaseDate: work.originalReleaseDate!,
    originalCatalogNumber: single ? catalogNumber : null,
    sourceEdition,
    authorityUrls: [sourceUrl],
    evidence: {
      provider: "sony-music-otonano",
      sourceType: "official-record-label-catalog",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      scope: "WORK",
      matchedFields: ["artist", "title", "category", "date", "catalogNumber"],
      sourceUrl,
      sourceUrls: [sourceUrl],
      retrievalUrl,
      observedArtist: MOMOE_NAME,
      observedTitle,
      observedCategory: work.category,
      observedOriginalReleaseDate: work.originalReleaseDate!,
      observedOriginalCatalogNumber: single ? catalogNumber : null,
      observedEditionReleaseDate: sourceEdition?.releaseDate ?? null,
      observedEditionCatalogNumber: sourceEdition?.catalogNumber ?? null,
      cover,
    },
    cover,
  };
}

function completeOfficialCatalog(
  manifest: CuratedArtistDiscography,
): MomoeYamaguchiCatalogResult {
  const singles = manifest.works
    .filter((work) => work.category === "SINGLE")
    .map(officialWork);
  const originalAlbums = manifest.works
    .filter((work) => work.category === "ORIGINAL_ALBUM")
    .map(officialWork);
  const works = [...singles, ...originalAlbums];
  return {
    status: "COMPLETE",
    complete: true,
    artist: {
      canonicalName: MOMOE_NAME,
      aliases: [MOMOE_ALIAS],
      country: "JP",
    },
    works,
    singles,
    originalAlbums,
    coverByWorkKey: Object.fromEntries(
      works.map((work) => [`${work.category}:${work.ordinal}`, work.cover]),
    ),
    warnings: [],
    stats: {
      requestsAttempted: 23,
      responsesFetched: 23,
      retries: 0,
      singleRowsParsed: 33,
      promotionalRowsExcluded: 1,
      singlesParsed: 32,
      albumsParsed: 22,
    },
  };
}

function researchResult(): ReleaseResearchResult {
  return {
    artist: {
      name: MOMOE_NAME,
      nameKana: null,
      nameRomaji: MOMOE_ALIAS,
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: request.target,
      excludeReissues: request.excludeReissues,
      includeCollaborations: request.includeCollaborations,
    },
    releases: [],
    globalWarnings: [],
    verificationSummary: null,
  };
}

function evidenceBundle(): ArtistReleaseEvidenceBundle {
  return {
    query: {
      artistName: MOMOE_NAME,
      targetCountry: "JP",
      target: "ORIGINAL_CD",
    },
    artist: null,
    releases: [],
    works: [],
    sourceWhitelist: [],
    warnings: [],
    stats: {
      artistResultsInspected: 0,
      releasesFetched: 0,
      releasesAccepted: 0,
      coverLookups: 0,
    },
  };
}

const MOMOE_CARRIER_RELEASE_ID = "364781a0-6717-49e6-a0e6-9d3cf72712ab";

function momoeCarrierRelease(
  overrides: Partial<MusicReleaseEvidence> = {},
): MusicReleaseEvidence {
  const sourceId = overrides.sourceId ?? MOMOE_CARRIER_RELEASE_ID;
  return {
    entityType: "release",
    sourceId,
    releaseGroupId: "20000000-0000-4000-8000-000000000200",
    title: "ゴールデン☆アイドル 山口百恵",
    artistCredit: MOMOE_NAME,
    artistNames: [MOMOE_NAME],
    artistAliases: [],
    date: "2015-02-11",
    type: "Album",
    secondaryTypes: ["Compilation"],
    country: "JP",
    label: "GT music",
    catalogNumber: null,
    format: "Blu-spec CD",
    labels: [
      { name: "GT music", catalogNumber: "MHCL 30295" },
      { name: "GT music", catalogNumber: "MHCL-30295" },
      { name: "GT music", catalogNumber: "MHCL 30296" },
      { name: "GT music", catalogNumber: "MHCL-30296" },
      { name: "GT music", catalogNumber: "MHCL 30297" },
      { name: "GT music", catalogNumber: "MHCL-30297" },
      { name: "GT music", catalogNumber: "MHCL 30298" },
      { name: "GT music", catalogNumber: "MHCL-30298" },
    ],
    formats: ["Blu-spec CD"],
    barcode: "4582290405537",
    status: "Official",
    sourceUrl: `https://musicbrainz.org/release/${sourceId}`,
    coverUrl: "https://coverartarchive.org/release/364781a0-6717-49e6-a0e6-9d3cf72712ab/front-500",
    coverSourceUrl: "https://coverartarchive.org/release/364781a0-6717-49e6-a0e6-9d3cf72712ab",
    sources: [],
    ...overrides,
  };
}

function carrierBundle(
  carriers: MusicReleaseEvidence[],
  existingWork?: CuratedDiscographyWork,
) {
  const bundle = evidenceBundle();
  bundle.discoveredEditions = carriers.map((evidence, index) => ({
    workId: evidence.releaseGroupId ?? `carrier-work-${index}`,
    evidence,
    scope: {
      verdict: "OUT_OF_SCOPE",
      reasonCodes: ["MB_RELEASE_TYPE_EXCLUDED"],
    },
  }));
  if (existingWork) {
    const workId = "10000000-0000-4000-8000-000000000100";
    bundle.works = [{
      workId,
      editions: [],
      releaseGroup: {
        entityType: "release-group",
        sourceId: workId,
        releaseGroupId: null,
        title: existingWork.title,
        artistCredit: MOMOE_NAME,
        artistNames: [MOMOE_NAME],
        artistAliases: [],
        date: existingWork.originalReleaseDate,
        type: "Single",
        secondaryTypes: [],
        country: null,
        label: null,
        catalogNumber: null,
        format: null,
        labels: [],
        formats: [],
        barcode: null,
        status: null,
        sourceUrl: `https://musicbrainz.org/release-group/${workId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [],
      },
    }];
  }
  return bundle;
}

function existingMomoeSingleCandidate(
  work: CuratedDiscographyWork,
): ComprehensiveDiscographyCandidate {
  const workId = "10000000-0000-4000-8000-000000000100";
  return {
    candidate: {
      id: "momoe-existing-single-1",
      title: work.title,
      titleOriginal: null,
      category: "SINGLE",
      artistCredit: MOMOE_NAME,
      releaseDate: work.originalReleaseDate,
      originalReleaseDate: work.originalReleaseDate,
      format: "Vinyl",
      catalogNumber: "SOLB-101",
      barcode: null,
      label: "CBS/Sony",
      originalPrice: null,
      editionType: null,
      isReissue: false,
      isRemaster: null,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "MEDIUM",
      warnings: [],
      sources: [{
        title: "MusicBrainz release group",
        url: `https://musicbrainz.org/release-group/${workId}`,
        sourceType: "database",
      }],
      verification: null,
    },
    workId,
    editionId: "10000000-0000-4000-8000-000000000101",
    observations: [{
      id: "musicbrainz:momoe-existing-single-1",
      provider: "musicbrainz",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "MUSICBRAINZ",
      verdict: "PASS",
      reasonCode: "MUSICBRAINZ_WORK_GROUP_CORROBORATION",
      reason: "MusicBrainz supplied the original work group.",
      sourceUrl: `https://musicbrainz.org/release-group/${workId}`,
      matchedFields: ["artist", "title", "date"],
      facts: {
        artist: MOMOE_NAME,
        title: work.title,
        date: work.originalReleaseDate,
      },
    }, {
      id: "scope:momoe-existing-single-1",
      provider: "musicbrainz",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: "SCOPE_PASS",
      reason: "The work remains researchable.",
      sourceUrl: null,
      matchedFields: [],
    }],
    conflicts: [],
  };
}

function validCover(url: string): CoverAssetValidationResult {
  const host = new URL(url).hostname;
  return {
    ok: true,
    reason: "valid",
    retryable: false,
    attempts: 1,
    redirects: 0,
    status: 200,
    contentType: "image/jpeg",
    bytesRead: 10_000,
    sourceHost: host,
    finalHost: host,
    imageFormat: "jpeg",
    width: 600,
    height: 600,
    contentSha256: "a".repeat(64),
  };
}

function emptyDiscogsSearch(): DiscogsResult<DiscogsJapanCdSearchResult> {
  return {
    value: {
      evidenceRole: "corroborating-only",
      artistQuery: MOMOE_NAME,
      items: [],
      sourceTotal: 0,
      pagesFetched: 0,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  };
}

async function prepareFixture(input: {
  manifest: CuratedArtistDiscography;
  catalog: MomoeYamaguchiCatalogResult;
  cosmosCarrier?: MomoeYamaguchiPhysicalCdCarrierEvidence | null;
  physicalRows?: DiscogsSearchReleaseEvidence[];
  bundle?: ArtistReleaseEvidenceBundle;
  candidates?: ComprehensiveDiscographyCandidate[];
}) {
  const validatedCoverUrls: string[] = [];
  const physicalRows = input.physicalRows ?? [];
  const dependencies: ComprehensiveSourceAdapterDependencies = {
    useCuratedManifests: true,
    findCuratedDiscography: () => input.manifest,
    ndl: {
      searchArtistInventory: async () => ({
        value: {
          queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch",
          sourceTotal: 0,
          records: [],
          complete: true,
        },
        warnings: [],
      }),
      searchCatalogNumber: async () => ({ value: null, warnings: [] }),
    },
    fetchNdlSingleManifests: async () => ({ evidence: [], unavailable: false }),
    researchOfficial: async () => {
      throw new Error("generic official research must remain disabled in this fixture");
    },
    researchMomoeOfficial: async () => input.catalog,
    ...(input.cosmosCarrier === undefined ? {} : {
      researchMomoeCosmosCarrier: async () => {
        if (!input.cosmosCarrier) throw new Error("COSMOS carrier unavailable");
        return input.cosmosCarrier;
      },
    }),
    discogs: {
      searchJapanCdReleases: async () => emptyDiscogsSearch(),
      getRelease: async () => {
        throw new Error("Discogs detail must not run in this fixture");
      },
    },
    searchJapanPhysicalReleases: async (query) => ({
      value: {
        evidenceRole: "corroborating-only",
        artistQuery: query,
        items: physicalRows,
        sourceTotal: physicalRows.length,
        pagesFetched: 1,
        partial: false,
      } satisfies DiscogsJapanPhysicalSearchResult,
      warnings: [],
      rateLimit: null,
    }),
    musicMetadata: {
      getCoverArt: async () => ({ value: null, warnings: [] }),
    },
    validateCover: async (url) => {
      validatedCoverUrls.push(url.toString());
      return validCover(url.toString());
    },
    searchItunes: async () => [],
    searchItunesByTitle: async () => [],
    now: () => new Date("2026-07-12T12:00:00.000Z"),
    limits: {
      maxScopeCandidates: 60,
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: 0,
      maxCuratedPhysicalQueries: physicalRows.length > 0 ? 1 : 0,
      maxCuratedPhysicalPagesPerQuery: 1,
      maxCuratedPhysicalItemsPerQuery: 100,
      maxDiscogsRowsPerCandidate: 1,
      maxDiscogsCoverDetailsPerCandidate: 0,
      maxItunesTitleLookups: 0,
    },
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request,
    result: researchResult(),
    bundle: input.bundle ?? evidenceBundle(),
    candidates: input.candidates ?? [],
  }, dependencies);
  return { prepared, validatedCoverUrls };
}

function readiness(candidate: ComprehensiveDiscographyCandidate) {
  return classifyComprehensiveEvidence({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  });
}

function updateOfficialWork(
  catalog: MomoeYamaguchiCatalogResult,
  category: CuratedDiscographyWork["category"],
  ordinal: number,
  update: (work: MomoeYamaguchiCanonicalWork) => void,
) {
  const seen = new Set<MomoeYamaguchiCanonicalWork>();
  for (const work of [
    ...catalog.works,
    ...catalog.singles,
    ...catalog.originalAlbums,
  ]) {
    if (work.category !== category || work.ordinal !== ordinal || seen.has(work)) continue;
    seen.add(work);
    update(work);
  }
}

function physicalOriginalSingle(work: CuratedDiscographyWork): DiscogsSearchReleaseEvidence {
  const releaseId = 7300 + work.ordinal;
  return {
    evidenceRole: "corroborating-only",
    releaseId,
    masterId: 8300 + work.ordinal,
    title: `${MOMOE_NAME} - ${work.title}`,
    year: Number(work.originalReleaseDate!.slice(0, 4)),
    country: "Japan",
    formats: ["Vinyl", "7\"", "45 RPM", "Single"],
    labels: ["CBS/Sony"],
    catalogNumber: "SOLB-101",
    barcode: null,
    apiUrl: `https://api.discogs.com/releases/${releaseId}`,
    sourceUrl: `https://www.discogs.com/release/${releaseId}`,
    thumbnailUrl: null,
    coverImageUrl: null,
  };
}

function physicalOriginalCosmos(work: CuratedDiscographyWork): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: 7_814,
    masterId: 1_500_000,
    title: `${MOMOE_NAME} - ${work.title}`,
    year: 1978,
    country: "Japan",
    formats: ["Vinyl", "LP", "Album"],
    labels: ["CBS/Sony"],
    catalogNumber: "25AH-424",
    barcode: null,
    apiUrl: "https://api.discogs.com/releases/7814",
    sourceUrl: "https://www.discogs.com/release/7814",
    thumbnailUrl: null,
    coverImageUrl: null,
  };
}

test("a COMPLETE 32+22 official snapshot injects 54 dynamic authorities and validated WORK covers", async () => {
  const manifest = momoeManifest();
  const { prepared, validatedCoverUrls } = await prepareFixture({
    manifest,
    catalog: completeOfficialCatalog(manifest),
  });

  assert.equal(prepared.candidates.length, 54);
  const authorities = prepared.candidates.flatMap((candidate) =>
    candidate.observations.filter((observation) =>
      observation.reasonCode === "MOMOE_OFFICIAL_CURATED_WORK_MATCH"));
  assert.equal(authorities.length, 54);
  assert.equal(new Set(authorities.map((authority) =>
    authority.facts?.manifestEntryKey)).size, 54);
  assert.equal(authorities.every((authority) =>
    authority.provider === "sony-music-otonano" &&
    authority.role === "AUTHORITATIVE" &&
    authority.strength === "STRONG" &&
    authority.verdict === "PASS"), true);
  assert.equal(prepared.sourceStats.momoeOfficialCalls, 1);
  assert.equal(prepared.sourceStats.momoeOfficialMatchedWorks, 54);
  assert.equal(prepared.sourceStats.momoeOfficialIncomplete, 0);

  const covers = await Promise.all(prepared.candidates.map((candidate) =>
    prepared.lookupValidatedCover(candidate)));
  assert.equal(covers.every((cover) =>
    cover.status === "FOUND" &&
    cover.provider === "official-label" &&
    cover.coverMatchLevel === "WORK"), true);
  assert.equal(validatedCoverUrls.length, 54);
  assert.equal(prepared.sourceStats.momoeOfficialCoversMatched, 54);
});

test("an incomplete snapshot or one wrong work mapping fails closed for the whole batch", async (t) => {
  const manifest = momoeManifest();
  const incomplete = structuredClone(completeOfficialCatalog(manifest));
  incomplete.status = "SOURCE_INCOMPLETE";
  incomplete.complete = false;
  incomplete.warnings = [{
    code: "network-unavailable",
    message: "The fixed official snapshot was incomplete.",
    retryable: true,
  }];

  const wrongMapping = structuredClone(completeOfficialCatalog(manifest));
  updateOfficialWork(wrongMapping, "SINGLE", 1, (work) => {
    work.title = "Wrong Official Work";
    work.evidence.observedTitle = "Wrong Official Work";
  });

  for (const [name, catalog] of [
    ["incomplete source", incomplete],
    ["wrong one-to-one mapping", wrongMapping],
  ] as const) {
    await t.test(name, async () => {
      const { prepared, validatedCoverUrls } = await prepareFixture({ manifest, catalog });
      assert.equal(prepared.candidates.length, 54);
      assert.equal(prepared.candidates.some((candidate) =>
        candidate.observations.some((observation) =>
          observation.reasonCode === "MOMOE_OFFICIAL_CURATED_WORK_MATCH")), false);
      assert.equal(prepared.sourceStats.momoeOfficialMatchedWorks, 0);
      assert.equal(prepared.sourceStats.momoeOfficialIncomplete, 1);

      const cover = await prepared.lookupValidatedCover(prepared.candidates[0]!);
      assert.equal(cover.status, "MISSING");
      assert.deepEqual(validatedCoverUrls, []);
      assert.equal(prepared.sourceStats.momoeOfficialCoversMatched, 0);
    });
  }
});

test("a no-MusicBrainz synthetic single stays pending with only a Discogs original-work binding", async () => {
  const manifest = momoeManifest();
  const firstSingle = manifest.works.find((work) =>
    work.category === "SINGLE" && work.ordinal === 1)!;
  const { prepared } = await prepareFixture({
    manifest,
    catalog: completeOfficialCatalog(manifest),
    physicalRows: [physicalOriginalSingle(firstSingle)],
  });
  const candidate = prepared.candidates.find((item) =>
    item.candidate.id === "curated-momoe-yamaguchi-single-1");
  assert.ok(candidate);
  assert.equal(candidate.observations.some((observation) =>
    observation.provider === "musicbrainz"), false);

  const official = candidate.observations.find((observation) =>
    observation.reasonCode === "MOMOE_OFFICIAL_CURATED_WORK_MATCH");
  const discogs = candidate.observations.find((observation) =>
    observation.reasonCode === "CURATED_DISCOGS_ORIGINAL_WORK_MATCH");
  assert.ok(official && discogs);
  assert.equal(official.facts?.date, firstSingle.originalReleaseDate);
  assert.equal(official.facts?.catalogNumber, "SOLB 101");
  assert.equal(official.matchedFields.includes("date"), true);
  assert.equal(official.matchedFields.includes("catalogNumber"), true);
  assert.equal(discogs.facts?.year, firstSingle.originalReleaseDate!.slice(0, 4));
  assert.equal(discogs.facts?.catalogNumber, "SOLB-101");
  assert.equal(discogs.facts?.uniqueBinding, "true");
  assert.equal(discogs.facts?.inventoryComplete, "true");
  assert.deepEqual(readiness(candidate), {
    verdict: "UNKNOWN",
    reasonCode: "MISSING_INDEPENDENT_CORROBORATION",
    eligibleForAi: false,
  });

  assert.equal(readiness({
    ...candidate,
    observations: candidate.observations.filter((observation) =>
      observation.reasonCode !== "MOMOE_OFFICIAL_CURATED_WORK_MATCH"),
  }).eligibleForAi, false, "the Discogs binding cannot replace the missing official date/catalog");
  assert.equal(prepared.sourceStats.curatedPhysicalMatchedWorks, 1);
});

test("one exact MusicBrainz four-disc carrier completes all 32 Momoe singles on synthetic and existing paths", async (t) => {
  for (const existing of [false, true]) {
    await t.test(existing ? "existing MusicBrainz work" : "synthetic work", async () => {
      const manifest = momoeCarrierManifest();
      const singles = manifest.works.filter((work) => work.category === "SINGLE");
      const first = singles[0]!;
      const candidate = existing ? existingMomoeSingleCandidate(first) : null;
      const { prepared, validatedCoverUrls } = await prepareFixture({
        manifest,
        catalog: completeOfficialCatalog(manifest),
        physicalRows: singles.map(physicalOriginalSingle),
        bundle: carrierBundle([momoeCarrierRelease()], existing ? first : undefined),
        candidates: candidate ? [candidate] : [],
      });
      const preparedSingles = prepared.candidates.filter((item) =>
        item.candidate.category === "SINGLE" &&
        /^curated-official-manifest:momoe-yamaguchi:representation:SINGLE:\d+$/u.test(
          item.editionId,
        ) &&
        item.observations.some((observation) =>
          observation.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH"));
      assert.equal(preparedSingles.length, 32);
      assert.equal(prepared.sourceStats.momoeMusicBrainzCarrierMatchedWorks, 32);
      assert.equal(prepared.sourceStats.momoeMusicBrainzCarrierFailures, 0);
      for (const item of preparedSingles) {
        assert.equal(item.candidate.releaseDate, "2015-02-11", item.candidate.title);
        assert.equal(item.candidate.catalogNumber, "MHCL-30295～30298", item.candidate.title);
        assert.equal(item.candidate.format, "CD (official canonical-work representation)");
        assert.equal(item.candidate.editionType, "LATER_OFFICIAL_CD_REPRESENTATION");
        assert.equal(item.candidate.isReissue, true);
        assert.match(
          item.editionId,
          /^curated-official-manifest:momoe-yamaguchi:representation:SINGLE:\d+$/u,
        );
        const carrier = item.observations.find((observation) =>
          observation.reasonCode === "MOMOE_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH");
        assert.ok(carrier, item.candidate.title);
        assert.deepEqual(carrier.matchedFields, [
          "artist",
          "title",
          "date",
          "catalogNumber",
          "country",
          "format",
          "barcode",
          "uniqueCarrier",
        ]);
        assert.equal(carrier.facts?.carrierTitle, "ゴールデン☆アイドル 山口百恵");
        assert.equal(carrier.facts?.catalogNumbers,
          "MHCL 30295,MHCL 30296,MHCL 30297,MHCL 30298");
        assert.equal(carrier.facts?.uniqueCarrierEntity, "true");
        assert.deepEqual(readiness(item), {
          verdict: "PASS",
          reasonCode: "EVIDENCE_READY",
          eligibleForAi: true,
        }, item.candidate.title);
      }
      if (candidate) {
        const original = prepared.candidates.find((item) =>
          item.candidate.id === candidate.candidate.id);
        assert.ok(original);
        assert.equal(original.editionId, candidate.editionId);
        assert.equal(original.candidate.releaseDate, candidate.candidate.releaseDate);
      }

      const cover = await prepared.lookupValidatedCover(preparedSingles[0]!);
      assert.equal(cover.status, "FOUND");
      assert.equal(cover.status === "FOUND" ? cover.provider : null, "official-label");
      assert.equal(cover.status === "FOUND" ? cover.coverMatchLevel : null, "WORK");
      assert.equal(cover.status === "FOUND" ? cover.sourceUrl : null,
        MOMOE_YAMAGUCHI_OTONANO_SINGLES_URL);
      assert.equal(validatedCoverUrls.some((url) =>
        url.includes("coverartarchive.org/release/364781a0")), false,
      "the four-disc container cover must never become single artwork");
    });
  }
});

test("the fixed Sony SRCL-2622 entity completes only the COSMOS 1993 CD representation", async () => {
  const manifest = momoeCosmosCarrierManifest();
  const work = manifest.works.find((item) =>
    item.category === "ORIGINAL_ALBUM" && item.ordinal === 14)!;
  const { prepared } = await prepareFixture({
    manifest,
    catalog: completeOfficialCatalog(manifest),
    cosmosCarrier: cosmosPhysicalCdCarrier(),
    physicalRows: [physicalOriginalCosmos(work)],
  });
  const candidate = prepared.candidates.find((item) => item.editionId ===
    "curated-official-manifest:momoe-yamaguchi:representation:ORIGINAL_ALBUM:14");
  assert.ok(candidate);
  assert.equal(candidate.candidate.releaseDate, "1993-06-21");
  assert.equal(candidate.candidate.catalogNumber, "SRCL-2622");
  const carrier = candidate.observations.find((observation) =>
    observation.reasonCode === "MOMOE_SONY_COSMOS_CD_CARRIER_MATCH");
  assert.ok(carrier);
  assert.equal(carrier.sourceUrl, MOMOE_YAMAGUCHI_COSMOS_CD_PRODUCT_URL);
  assert.equal(carrier.facts?.retrievalUrl, MOMOE_YAMAGUCHI_COSMOS_CD_JSONP_URL);
  assert.equal(carrier.facts?.manifestEntryKey, "ORIGINAL_ALBUM:14");
  assert.deepEqual(readiness(candidate), {
    verdict: "PASS",
    reasonCode: "EVIDENCE_READY",
    eligibleForAi: true,
  });
  assert.equal(prepared.candidates.filter((item) => item.observations.some((observation) =>
    observation.reasonCode === "MOMOE_SONY_COSMOS_CD_CARRIER_MATCH")).length, 1);
});

test("the COSMOS Sony carrier bridge fails closed on every tuple or provenance mismatch", async (t) => {
  const manifest = momoeCosmosCarrierManifest();
  const work = manifest.works.find((item) =>
    item.category === "ORIGINAL_ALBUM" && item.ordinal === 14)!;
  const exact = cosmosPhysicalCdCarrier();
  const cases: Array<[string, MomoeYamaguchiPhysicalCdCarrierEvidence | null]> = [
    ["unavailable", null],
    ["wrong artist", { ...exact, artist: "Other Artist" } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong title", { ...exact, title: "COSMOS" } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong date", { ...exact, releaseDate: "1993-06-22" } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong catalog", { ...exact, catalogNumber: "SRCL-2623" } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong format", { ...exact, format: "SACD" } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong source URL", {
      ...exact,
      sourceUrl: "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/SRCL-2623",
    } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
    ["wrong retrieval URL", {
      ...exact,
      retrievalUrl: "https://www.sonymusic.co.jp/json/v2/artist/MomoeYamaguchi/discography/SRCL-2623/callback/cdbox_srcl2623",
    } as unknown as MomoeYamaguchiPhysicalCdCarrierEvidence],
  ];
  for (const [name, cosmosCarrier] of cases) {
    await t.test(name, async () => {
      const { prepared } = await prepareFixture({
        manifest,
        catalog: completeOfficialCatalog(manifest),
        cosmosCarrier,
        physicalRows: [physicalOriginalCosmos(work)],
      });
      const candidate = prepared.candidates.find((item) => item.editionId ===
        "curated-official-manifest:momoe-yamaguchi:representation:ORIGINAL_ALBUM:14");
      assert.ok(candidate);
      assert.equal(candidate.observations.some((observation) =>
        observation.reasonCode === "MOMOE_SONY_COSMOS_CD_CARRIER_MATCH"), false);
      assert.equal(readiness(candidate).eligibleForAi, false);
    });
  }
});

test("Momoe carrier matching rejects every incomplete, conflicting, ordinary, or duplicate tuple", async (t) => {
  const exact = momoeCarrierRelease();
  const cases: Array<[string, MusicReleaseEvidence[]]> = [
    ["wrong date", [{ ...exact, date: "2015-02-12" }]],
    ["wrong country", [{ ...exact, country: "US" }]],
    ["wrong artist", [{ ...exact, artistCredit: "Other Artist", artistNames: ["Other Artist"] }]],
    ["ordinary compilation title", [{ ...exact, title: "Golden Best" }]],
    ["ordinary CD format", [{ ...exact, format: "CD", formats: ["CD"] }]],
    ["wrong barcode", [{ ...exact, barcode: "4582290405538" }]],
    ["collapsed scalar catalog", [{ ...exact, catalogNumber: "MHCL 30295" }]],
    ["missing catalog", [{ ...exact, labels: exact.labels.slice(0, 3) }]],
    ["extra catalog", [{
      ...exact,
      labels: [...exact.labels, { name: "GT music", catalogNumber: "MHCL 30299" }],
    }]],
    ["conflicting label identity", [{
      ...exact,
      labels: exact.labels.map((label, index) => index === 0
        ? { ...label, name: "Other Label" }
        : label),
    }]],
    ["missing label identity", [{
      ...exact,
      labels: exact.labels.map((label, index) => index === 0
        ? { ...label, name: null }
        : label),
    }]],
    ["duplicated catalog", [{
      ...exact,
      labels: [exact.labels[0]!, exact.labels[1]!, exact.labels[2]!, exact.labels[2]!],
    }]],
    ["duplicate exact entity tuple", [
      exact,
      momoeCarrierRelease({
        sourceId: "464781a0-6717-49e6-a0e6-9d3cf72712ab",
      }),
    ]],
  ];

  for (const [name, carriers] of cases) {
    await t.test(name, async () => {
      const manifest = momoeCarrierManifest();
      const first = manifest.works.find((work) =>
        work.category === "SINGLE" && work.ordinal === 1)!;
      const { prepared } = await prepareFixture({
        manifest,
        catalog: completeOfficialCatalog(manifest),
        physicalRows: [physicalOriginalSingle(first)],
        bundle: carrierBundle(carriers),
      });
      const singles = prepared.candidates.filter((item) =>
        item.candidate.category === "SINGLE" &&
        item.editionId.startsWith(
          "curated-official-manifest:momoe-yamaguchi:representation:SINGLE:",
        ));
      assert.equal(singles.length, 32);
      assert.equal(singles.some((item) => item.observations.some((observation) =>
        observation.reasonCode === "MOMOE_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH")), false);
      assert.equal(singles.every((item) => item.observations.some((observation) =>
        observation.reasonCode === "MOMOE_MUSICBRAINZ_CARRIER_NOT_FOUND")), true);
      assert.equal(prepared.sourceStats.momoeMusicBrainzCarrierMatchedWorks, 0);
      assert.equal(prepared.sourceStats.momoeMusicBrainzCarrierFailures, 1);
      assert.equal(readiness(singles[0]!).eligibleForAi, false);
    });
  }
});
