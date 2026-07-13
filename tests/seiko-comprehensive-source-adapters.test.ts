import assert from "node:assert/strict";
import test from "node:test";

import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import {
  classifyComprehensiveEvidence,
  type ComprehensiveEvidenceObservation,
} from "@/lib/ai/comprehensive-evidence-audit";
import {
  applySeikoOfficialEvidence,
  applySeikoSonyBoxCarrierEvidence,
  prepareComprehensiveSourceEvidence,
  type ComprehensiveSourceAdapterDependencies,
  type ComprehensiveSourceStats,
} from "@/lib/ai/comprehensive-source-adapters";
import type {
  SeikoOfficialCuratedMatch,
  SeikoOfficialCuratedResult,
} from "@/lib/ai/seiko-official-curated";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import type {
  DiscogsJapanCdSearchResult,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";
import type {
  ArtistReleaseEvidenceBundle,
  MusicReleaseEvidence,
} from "@/lib/music-metadata/types";
import {
  findCuratedArtistDiscography,
  type CuratedArtistDiscography,
  type CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import type {
  SeikoMatsudaOfficialResult,
  SeikoMatsudaOfficialWorkKey,
} from "@/lib/official-music/seiko-matsuda";

const loadedManifest = findCuratedArtistDiscography(
  "ef013257-e584-410e-88e8-05ea9ae9ea3a",
  ["松田聖子", "Seiko Matsuda"],
);
assert.ok(loadedManifest);
const manifest: CuratedArtistDiscography = loadedManifest;

const cases = [
  {
    key: "SINGLE:22",
    groupId: "19eace7b-472f-4623-8c5e-f668f20d17b2",
    releaseId: "7d23b526-affb-4a6f-8783-9f06e954c4ac",
    groupTitle: "DANCING SHOES",
    groupDate: "1985-06-24",
    groupType: "Single",
    catalogNumber: "12AH-1896",
    format: "12\" Vinyl",
    country: "JP",
    conflict: "TITLE_CONFLICT",
  },
  {
    key: "SINGLE:71",
    groupId: "a7115395-0a0e-4c6a-8f3e-7e3177af923c",
    releaseId: "d8cd86c9-dbeb-4c90-901e-ca6b263f3d23",
    groupTitle: "特別な恋人",
    groupDate: "2011-11-23",
    groupType: "Single",
    catalogNumber: "UMCK-5355",
    format: "CD",
    country: "JP",
    conflict: "TITLE_CONFLICT",
  },
  {
    key: "ORIGINAL_ALBUM:29",
    groupId: "ca0a9735-b047-4857-8086-6926a5b5c695",
    releaseId: "373608a5-0310-4e6b-854a-4a9e69f5ad89",
    groupTitle: "Sweetest Time",
    groupDate: "1997-12-03",
    groupType: "EP",
    catalogNumber: "PHCL-12",
    format: "CD",
    country: "JP",
    conflict: "FORMAT_CONFLICT",
  },
  {
    key: "ORIGINAL_ALBUM:35",
    groupId: "4369f6f0-b71e-3b3f-b797-137c8f1bbe42",
    releaseId: "7468e7b1-27f3-4db7-a60c-787916e1a246",
    groupTitle: "area62",
    groupDate: "2002-06-11",
    groupType: "Album",
    catalogNumber: "HIPD 60054",
    format: "CD",
    country: "US",
    conflict: "DATE_CONFLICT",
  },
] as const;

function workFor(key: string) {
  const work = manifest.works.find((item) => `${item.category}:${item.ordinal}` === key);
  assert.ok(work);
  return work;
}

function releaseCandidate(
  id: string,
  work: CuratedDiscographyWork,
  artistCredit = work.artistCredits?.[0] ?? manifest.canonicalName,
): ReleaseResearchCandidate {
  return {
    id,
    title: work.title,
    titleOriginal: null,
    category: work.category,
    artistCredit,
    releaseDate: work.mediaScope?.physicalCdReleaseDate ?? work.originalReleaseDate,
    originalReleaseDate: work.originalReleaseDate,
    format: "CD (official canonical-work representation)",
    catalogNumber: work.mediaScope?.physicalCdCatalogNumber ?? null,
    barcode: null,
    label: null,
    originalPrice: null,
    editionType: "OFFICIAL_ORIGINAL_CARRIER_REPRESENTATION",
    isReissue: false,
    isRemaster: null,
    isExcludedByDefault: false,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: work.authorityUrls.map((url) => ({
      title: "Official canonical discography manifest",
      url,
      sourceType: "official" as const,
    })),
    verification: null,
  };
}

function canonicalCandidate(key: string) {
  const work = workFor(key);
  const id = `curated-seiko-${key.toLocaleLowerCase("en").replace(":", "-")}`;
  const provider = "curated-official-manifest:seiko-matsuda";
  const observations: ComprehensiveEvidenceObservation[] = [
    {
      id: `${provider}:work:${key}:${id}`,
      provider,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "Fixed manifest work.",
      sourceUrl: work.authorityUrls[0] ?? null,
      matchedFields: ["artist", "title", "category"],
      facts: {
        manifestEntryKey: key,
        artist: manifest.canonicalName,
        artistCredits: (work.artistCredits ?? []).join(","),
        title: work.title,
        category: work.category,
        date: work.originalReleaseDate,
      },
    },
    {
      id: `${provider}:scope:${key}:${id}`,
      provider,
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "SCOPE",
      verdict: "PASS",
      reasonCode: "CURATED_ORIGINAL_PHYSICAL_CD_CONFIRMED",
      reason: "Official CD scope.",
      sourceUrl: work.authorityUrls[0] ?? null,
      matchedFields: ["country", "format", "artist", "title"],
      facts: {
        manifestEntryKey: key,
        country: "JP",
        format: "CD",
        physicalCd: work.mediaScope?.physicalCd ?? "ORIGINAL_RELEASE",
      },
    },
  ];
  return {
    candidate: releaseCandidate(id, work),
    workId: `${provider}:${key}`,
    editionId: `${provider}:representation:${key}`,
    observations,
    conflicts: [],
  } satisfies ComprehensiveDiscographyCandidate;
}

function candidateManifestKey(candidate: ComprehensiveDiscographyCandidate) {
  return candidate.observations.find((item) =>
    item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH")?.facts?.manifestEntryKey ?? null;
}

function releaseGroup(
  sourceId: string,
  title: string,
  date: string,
  type: string,
): MusicReleaseEvidence {
  return {
    entityType: "release-group",
    sourceId,
    releaseGroupId: sourceId,
    title,
    artistCredit: "Seiko Matsuda",
    artistNames: ["Seiko Matsuda"],
    artistAliases: [],
    date,
    type,
    secondaryTypes: [],
    country: null,
    label: null,
    catalogNumber: null,
    format: null,
    labels: [],
    formats: [],
    barcode: null,
    status: null,
    sourceUrl: `https://musicbrainz.org/release-group/${sourceId}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [{
      provider: "musicbrainz",
      title: "MusicBrainz release group",
      url: `https://musicbrainz.org/release-group/${sourceId}`,
    }],
  };
}

function evidenceBundle(
  sourceId: string,
  releaseId: string,
  title: string,
  date: string,
  type: string,
  catalogNumber: string,
  format: string,
  country = "JP",
  duplicate = false,
  editionDate = date,
): ArtistReleaseEvidenceBundle {
  const edition = (workId: string, editionId: string) => {
    const evidence: MusicReleaseEvidence = {
      ...releaseGroup(workId, title, date, type),
      entityType: "release",
      sourceId: editionId,
      releaseGroupId: workId,
      date: editionDate,
      catalogNumber,
      format,
      country,
      labels: [{ name: "Fixed label", catalogNumber }],
      formats: [format],
      status: "Official",
      sourceUrl: `https://musicbrainz.org/release/${editionId}`,
      sources: [{
        provider: "musicbrainz",
        title: "MusicBrainz release",
          url: `https://musicbrainz.org/release/${editionId}`,
      }],
    };
    return { workId, evidence, scope: { verdict: "PASS" as const, reasonCodes: [] } };
  };
  const works = [{
    workId: sourceId,
    releaseGroup: releaseGroup(sourceId, title, date, type),
    editions: [edition(sourceId, releaseId)],
  }];
  if (duplicate) {
    works[0]!.editions.push(structuredClone(works[0]!.editions[0]!));
  }
  return {
    query: { artistName: "松田聖子", targetCountry: "JP", target: "ORIGINAL_CD" },
    artist: null,
    releases: [],
    works,
    discoveredEditions: [],
    sourceWhitelist: ["https://musicbrainz.org"],
    warnings: [],
    stats: {
      artistResultsInspected: 1,
      releasesFetched: 0,
      releasesAccepted: 0,
      coverLookups: 0,
    },
  };
}

function officialMatch(key: SeikoMatsudaOfficialWorkKey): SeikoOfficialCuratedMatch {
  const work = workFor(key);
  const fixture = cases.find((item) => item.key === key);
  assert.ok(fixture);
  const pageId = key === "SINGLE:22" ? "43"
    : key === "SINGLE:71" ? "244"
      : key === "ORIGINAL_ALBUM:29" ? "115" : "152";
  const sourceUrl = `https://www.seikomatsuda.co.jp/discography/detail/${pageId}`;
  const coverUrl = `https://www.seikomatsuda.co.jp/discography/images/upload/${pageId}.gif`;
  return {
    manifestEntryKey: key,
    manifestWork: work,
    entity: {
      manifestEntryKey: key,
      sourceUrl,
    } as SeikoOfficialCuratedMatch["entity"],
    authority: {
      id: `seiko-matsuda-official:entity:${key}`,
      provider: "seiko-matsuda-official",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED",
      reason: "Exact fixed official entity.",
      sourceUrl,
      matchedFields: ["artist", "artistCredit", "title", "category", "date", "catalogNumber"],
      facts: {
        manifestEntryKey: key,
        artist: "松田聖子",
        artistCredit: work.artistCredits?.[0] ?? "松田聖子",
        title: work.title,
        category: work.category,
        date: work.originalReleaseDate,
        catalogNumber: fixture.catalogNumber,
      },
    },
    externalObservations: [],
    cover: {
      provider: "seiko-matsuda-official",
      scope: "WORK",
      matchLevel: "WORK_EXACT",
      url: coverUrl,
      sourceUrl,
      observedAlt: work.title,
      requiresAssetValidation: true,
    },
  };
}

function official(matches: SeikoOfficialCuratedMatch[]): SeikoOfficialCuratedResult {
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

function stats() {
  return {
    seikoOfficialCalls: 1,
    seikoOfficialMatchedWorks: 0,
    seikoOfficialIncomplete: 0,
    seikoOfficialCoversMatched: 0,
  } as ComprehensiveSourceStats;
}

for (const fixture of cases) {
  test(`strictly bridges Seiko fixed gap ${fixture.key} without a global relaxation`, () => {
    const sourceId = fixture.groupId;
    const canonical = canonicalCandidate(fixture.key);
    const sourceCandidate: ComprehensiveDiscographyCandidate = {
      ...canonical,
      candidate: releaseCandidate(`release-${sourceId}`, workFor(fixture.key)),
      workId: sourceId,
      editionId: sourceId,
      observations: [],
      conflicts: [],
    };
    const result = applySeikoOfficialEvidence({
      candidates: [canonical, sourceCandidate],
      manifest,
      official: official([officialMatch(fixture.key)]),
      bundle: evidenceBundle(
        sourceId,
        fixture.releaseId,
        fixture.groupTitle,
        fixture.groupDate,
        fixture.groupType,
        fixture.catalogNumber,
        fixture.format,
        fixture.country,
      ),
      stats: stats(),
    });
    const enriched = result.candidates.find((candidate) =>
      candidate.candidate.id === canonical.candidate.id)!;
    assert.equal(
      enriched.observations.some((item) =>
        item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
      true,
    );
    assert.equal(enriched.conflicts[0]?.reasonCode, fixture.conflict);
    assert.equal(
      result.candidates.find((candidate) =>
        candidate.candidate.id === sourceCandidate.candidate.id)?.workId,
      canonical.workId,
    );
    assert.equal(result.coversByWorkId.has(canonical.workId), true);
    assert.equal(
      enriched.candidate.sources.some((source) =>
        /^https:\/\/musicbrainz\.org\/release\//u.test(source.url)),
      false,
    );
    const readiness = classifyComprehensiveEvidence({
      candidateId: enriched.candidate.id,
      workId: enriched.workId,
      editionId: enriched.editionId,
      title: enriched.candidate.title,
      artistCredit: enriched.candidate.artistCredit,
      observations: enriched.observations,
      conflicts: enriched.conflicts,
    });
    assert.deepEqual(
      readiness,
      fixture.key === "ORIGINAL_ALBUM:35"
        ? { verdict: "UNKNOWN", reasonCode: "MISSING_MUSICBRAINZ", eligibleForAi: false }
        : { verdict: "PASS", reasonCode: "EVIDENCE_READY", eligibleForAi: true },
    );
  });
}

test("fixed Seiko bridge planning is invariant to candidate, source, and official-match order", () => {
  const candidates = cases.map((fixture) => canonicalCandidate(fixture.key));
  const matches = cases.map((fixture) => officialMatch(fixture.key));
  const bundle = combinedSeikoBundle();
  const reversedBundle = structuredClone(bundle);
  reversedBundle.works?.reverse();
  reversedBundle.discoveredEditions?.reverse();
  const forwardStats = stats();
  const reversedStats = stats();
  const forward = applySeikoOfficialEvidence({
    candidates,
    manifest,
    official: official(matches),
    bundle,
    stats: forwardStats,
  });
  const reversed = applySeikoOfficialEvidence({
    candidates: [...candidates].reverse(),
    manifest,
    official: official([...matches].reverse()),
    bundle: reversedBundle,
    stats: reversedStats,
  });
  const projection = (result: ReturnType<typeof applySeikoOfficialEvidence>) => ({
    candidates: result.candidates.map((candidate) => ({
      key: candidateManifestKey(candidate),
      workId: candidate.workId,
      editionId: candidate.editionId,
      observations: candidate.observations.map((item) =>
        `${item.provider}:${item.reasonCode}:${item.verdict}`).sort(),
      conflicts: candidate.conflicts.map((item) =>
        `${item.reasonCode}:${item.certainty}:${item.field}`).sort(),
    })).sort((left, right) => (left.key ?? "").localeCompare(right.key ?? "")),
    covers: [...result.coversByWorkId.entries()]
      .map(([workId, cover]) => `${workId}:${cover.url}`)
      .sort(),
  });
  assert.deepEqual(projection(reversed), projection(forward));
  assert.deepEqual(reversedStats, forwardStats);
});

test("the Seiko bridge rejects a release group or edition with an extra artist", () => {
  const fixture = cases[0];
  const sourceId = fixture.groupId;
  const canonical = canonicalCandidate(fixture.key);
  const bundle = evidenceBundle(
    sourceId,
    fixture.releaseId,
    fixture.groupTitle,
    fixture.groupDate,
    fixture.groupType,
    fixture.catalogNumber,
    fixture.format,
    fixture.country,
  );
  bundle.works![0]!.releaseGroup!.artistNames.push("Wrong Artist");
  bundle.works![0]!.releaseGroup!.artistCredit = "Seiko Matsuda & Wrong Artist";
  bundle.works![0]!.editions[0]!.evidence.artistNames.push("Wrong Artist");
  bundle.works![0]!.editions[0]!.evidence.artistCredit = "Seiko Matsuda & Wrong Artist";
  const result = applySeikoOfficialEvidence({
    candidates: [canonical],
    manifest,
    official: official([officialMatch(fixture.key)]),
    bundle,
    stats: stats(),
  });
  assert.equal(
    result.candidates[0]!.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
    false,
  );
});

test("the Seiko bridge requires work, release-group, and edition ids to agree", () => {
  const fixture = cases[0];
  const sourceId = fixture.groupId;
  const canonical = canonicalCandidate(fixture.key);
  const bundle = evidenceBundle(
    sourceId,
    fixture.releaseId,
    fixture.groupTitle,
    fixture.groupDate,
    fixture.groupType,
    fixture.catalogNumber,
    fixture.format,
    fixture.country,
  );
  bundle.works![0]!.workId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const result = applySeikoOfficialEvidence({
    candidates: [canonical],
    manifest,
    official: official([officialMatch(fixture.key)]),
    bundle,
    stats: stats(),
  });
  assert.equal(
    result.candidates[0]!.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
    false,
  );
});

test("duplicate exact bridge rows remain ambiguous", () => {
  const fixture = cases[0];
  const sourceId = fixture.groupId;
  const canonical = canonicalCandidate(fixture.key);
  const bundle = evidenceBundle(
    sourceId,
    fixture.releaseId,
    fixture.groupTitle,
    fixture.groupDate,
    fixture.groupType,
    fixture.catalogNumber,
    fixture.format,
    fixture.country,
  );
  const duplicate = structuredClone(bundle.works![0]!.editions[0]!);
  bundle.works![0]!.editions.push(duplicate);
  const result = applySeikoOfficialEvidence({
    candidates: [canonical],
    manifest,
    official: official([officialMatch(fixture.key)]),
    bundle,
    stats: stats(),
  });
  assert.equal(
    result.candidates[0]!.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
    false,
  );
});

test("different Seiko manifest keys sharing one work id fail the whole dynamic application closed", () => {
  const dancing = canonicalCandidate("SINGLE:22");
  const special = canonicalCandidate("SINGLE:71");
  special.workId = dancing.workId;
  const sourceStats = stats();
  const result = applySeikoOfficialEvidence({
    candidates: [dancing, special],
    manifest,
    official: official([
      officialMatch("SINGLE:22"),
      officialMatch("SINGLE:71"),
    ]),
    bundle: evidenceBundle(
      cases[0].groupId,
      cases[0].releaseId,
      cases[0].groupTitle,
      cases[0].groupDate,
      cases[0].groupType,
      cases[0].catalogNumber,
      cases[0].format,
      cases[0].country,
    ),
    stats: sourceStats,
  });
  assert.equal(result.coversByWorkId.size, 0);
  assert.equal(sourceStats.seikoOfficialIncomplete, 1);
  assert.equal(result.candidates.some((candidate) => candidate.observations.some((item) =>
    item.reasonCode === "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED")), false);
  assert.equal(result.candidates.every((candidate) => classifyComprehensiveEvidence({
    candidateId: candidate.candidate.id,
    workId: candidate.workId,
    editionId: candidate.editionId,
    title: candidate.candidate.title,
    artistCredit: candidate.candidate.artistCredit,
    observations: candidate.observations,
    conflicts: candidate.conflicts,
  }).verdict === "REJECT"), true);
});

for (const extraArtist of [false, true]) {
  test(`existing Seiko MusicBrainz PASS ${extraArtist ? "rejects" : "accepts"} the strict artist boundary`, () => {
    const fixture = cases[0];
    const sourceId = extraArtist
      ? "34343434-3434-4434-8434-343434343434"
      : "56565656-5656-4565-8565-565656565656";
    const bundle = evidenceBundle(
      sourceId,
      `${sourceId.slice(0, -1)}7`,
      "DANCING SHOES (Club Mix)",
      fixture.groupDate,
      fixture.groupType,
      fixture.catalogNumber,
      "CD",
      "JP",
    );
    // Existing manifest matches represent an in-scope Japanese CD edition.
    const group = bundle.works![0]!.releaseGroup!;
    const edition = bundle.works![0]!.editions[0]!.evidence;
    if (extraArtist) {
      group.artistNames.push("Wrong Artist");
      group.artistCredit = "Seiko Matsuda & Wrong Artist";
      edition.artistNames.push("Wrong Artist");
      edition.artistCredit = "Seiko Matsuda & Wrong Artist";
    }
    const candidate = canonicalCandidate(fixture.key);
    candidate.workId = sourceId;
    candidate.editionId = edition.sourceId;
    candidate.candidate.artistCredit = edition.artistCredit ?? "Seiko Matsuda";
    candidate.candidate.sources.push(
      { title: "MusicBrainz release group", url: group.sourceUrl, sourceType: "database" },
      { title: "MusicBrainz release", url: edition.sourceUrl, sourceType: "database" },
    );
    candidate.observations.push({
      id: `musicbrainz:existing:${edition.sourceId}`,
      provider: "musicbrainz",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "MUSICBRAINZ",
      verdict: "PASS",
      reasonCode: "MUSICBRAINZ_EDITION_DISCOVERED",
      reason: "Existing detailed edition.",
      sourceUrl: edition.sourceUrl,
      matchedFields: ["artist", "title", "date", "catalogNumber", "format"],
      facts: {
        artist: edition.artistCredit,
        title: edition.title,
        date: edition.date,
        catalogNumber: edition.catalogNumber,
        format: edition.format,
      },
    });
    const result = applySeikoOfficialEvidence({
      candidates: [candidate],
      manifest,
      official: official([officialMatch(fixture.key)]),
      bundle,
      stats: stats(),
    });
    const enriched = result.candidates[0]!;
    const readiness = classifyComprehensiveEvidence({
      candidateId: enriched.candidate.id,
      workId: enriched.workId,
      editionId: enriched.editionId,
      title: enriched.candidate.title,
      artistCredit: enriched.candidate.artistCredit,
      observations: enriched.observations,
      conflicts: enriched.conflicts,
    });
    assert.equal(readiness.verdict, extraArtist ? "REJECT" : "PASS");
    assert.equal(
      enriched.conflicts.some((conflict) =>
        conflict.id.startsWith("seiko-existing-musicbrainz-identity:")),
      extraArtist,
    );
  });
}

test("a duplicated Seiko MusicBrainz bridge fails closed", () => {
  const fixture = cases[0];
  const sourceId = fixture.groupId;
  const canonical = canonicalCandidate(fixture.key);
  const result = applySeikoOfficialEvidence({
    candidates: [canonical],
    manifest,
    official: official([officialMatch(fixture.key)]),
    bundle: evidenceBundle(
      sourceId,
      fixture.releaseId,
      fixture.groupTitle,
      fixture.groupDate,
      fixture.groupType,
      fixture.catalogNumber,
      fixture.format,
      fixture.country,
      true,
    ),
    stats: stats(),
  });
  const enriched = result.candidates[0]!;
  assert.equal(
    enriched.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
    false,
  );
  assert.equal(classifyComprehensiveEvidence({
    candidateId: enriched.candidate.id,
    workId: enriched.workId,
    editionId: enriched.editionId,
    title: enriched.candidate.title,
    artistCredit: enriched.candidate.artistCredit,
    observations: enriched.observations,
    conflicts: enriched.conflicts,
  }).reasonCode, "MISSING_MUSICBRAINZ");
});

for (const mutation of [
  { label: "wrong catalog", title: "DANCING SHOES", date: "1985-06-24", type: "Single", catalog: "12AH-1897", format: "12\" Vinyl" },
  { label: "digital carrier", title: "DANCING SHOES", date: "1985-06-24", type: "Single", catalog: "12AH-1896", format: "Digital Media" },
  { label: "wrong full date", title: "DANCING SHOES", date: "1985-06-25", type: "Single", catalog: "12AH-1896", format: "12\" Vinyl" },
  { label: "wrong primary type", title: "DANCING SHOES", date: "1985-06-24", type: "Album", catalog: "12AH-1896", format: "12\" Vinyl" },
  { label: "partial title", title: "DANCING", date: "1985-06-24", type: "Single", catalog: "12AH-1896", format: "12\" Vinyl" },
] as const) {
  test(`the Seiko bridge rejects ${mutation.label}`, () => {
    const fixture = cases[0];
    const sourceId = fixture.groupId;
    const canonical = canonicalCandidate(fixture.key);
    const result = applySeikoOfficialEvidence({
      candidates: [canonical],
      manifest,
      official: official([officialMatch(fixture.key)]),
      bundle: evidenceBundle(
        sourceId,
        fixture.releaseId,
        mutation.title,
        mutation.date,
        mutation.type,
        mutation.catalog,
        mutation.format,
        fixture.country,
      ),
      stats: stats(),
    });
    assert.equal(
      result.candidates[0]!.observations.some((item) =>
        item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
      false,
    );
  });
}

for (const catalogNumber of ["VIVI-19623", "TGCS-1439"] as const) {
  test(`area62 accepts only the fixed Japanese ${catalogNumber} date tuple`, () => {
    const fixture = cases[3];
    const releaseId = catalogNumber === "VIVI-19623"
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222";
    const result = applySeikoOfficialEvidence({
      candidates: [canonicalCandidate(fixture.key)],
      manifest,
      official: official([officialMatch(fixture.key)]),
      bundle: evidenceBundle(
        fixture.groupId,
        releaseId,
        fixture.groupTitle,
        fixture.groupDate,
        fixture.groupType,
        catalogNumber,
        fixture.format,
        "JP",
        false,
        "2002-06-21",
      ),
      stats: stats(),
    });
    assert.equal(result.candidates[0]!.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"), true);
  });
}

for (const mutation of [
  { label: "US release id", releaseId: "33333333-3333-4333-8333-333333333333", catalog: "HIPD 60054", country: "US", editionDate: "2002-06-11" },
  { label: "US and Japanese catalog", releaseId: "44444444-4444-4444-8444-444444444444", catalog: "VIVI-19623", country: "US", editionDate: "2002-06-11" },
  { label: "Japan and US catalog", releaseId: "55555555-5555-4555-8555-555555555555", catalog: "HIPD 60054", country: "JP", editionDate: "2002-06-21" },
  { label: "Japanese catalog and global date", releaseId: "66666666-6666-4666-8666-666666666666", catalog: "VIVI-19623", country: "JP", editionDate: "2002-06-11" },
] as const) {
  test(`area62 rejects a Cartesian tuple mixing ${mutation.label}`, () => {
    const fixture = cases[3];
    const result = applySeikoOfficialEvidence({
      candidates: [canonicalCandidate(fixture.key)],
      manifest,
      official: official([officialMatch(fixture.key)]),
      bundle: evidenceBundle(
        fixture.groupId,
        mutation.releaseId,
        fixture.groupTitle,
        fixture.groupDate,
        fixture.groupType,
        mutation.catalog,
        fixture.format,
        mutation.country,
        false,
        mutation.editionDate,
      ),
      stats: stats(),
    });
    assert.equal(result.candidates[0]!.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"), false);
  });
}

test("the Seiko bridge rejects the legacy null release-group shape", () => {
  const fixture = cases[0];
  const bundle = evidenceBundle(
    fixture.groupId,
    fixture.releaseId,
    fixture.groupTitle,
    fixture.groupDate,
    fixture.groupType,
    fixture.catalogNumber,
    fixture.format,
    fixture.country,
  );
  bundle.works![0]!.releaseGroup!.releaseGroupId = null;
  const result = applySeikoOfficialEvidence({
    candidates: [canonicalCandidate(fixture.key)],
    manifest,
    official: official([officialMatch(fixture.key)]),
    bundle,
    stats: stats(),
  });
  assert.equal(result.candidates[0]!.observations.some((item) =>
    item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"), false);
});

const seikoRequest: ReleaseResearchRequest = {
  artistName: manifest.canonicalName,
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: false,
};

function seikoResearchResult(): ReleaseResearchResult {
  return {
    artist: {
      name: manifest.canonicalName,
      nameKana: null,
      nameRomaji: "Seiko Matsuda",
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: [],
    globalWarnings: [],
    verificationSummary: null,
  };
}

function combinedSeikoBundle(excludedKey?: string): ArtistReleaseEvidenceBundle {
  const bundles = cases
    .filter((fixture) => fixture.key !== excludedKey)
    .map((fixture) => evidenceBundle(
      fixture.groupId,
      fixture.releaseId,
      fixture.groupTitle,
      fixture.groupDate,
      fixture.groupType,
      fixture.catalogNumber,
      fixture.format,
      fixture.country,
    ));
  const works = bundles.flatMap((bundle) => bundle.works ?? []);
  const discoveredEditions = works.flatMap((work) => work.editions);
  return {
    query: {
      artistName: manifest.canonicalName,
      targetCountry: "JP",
      target: "ORIGINAL_CD",
    },
    artist: null,
    releases: [],
    works,
    discoveredEditions,
    sourceWhitelist: [],
    warnings: [],
    stats: {
      artistResultsInspected: 1,
      releaseGroupsFetched: works.length,
      releasesFetched: discoveredEditions.length,
      releasesAcceptedBeforeGrouping: discoveredEditions.length,
      releaseGroupsAccepted: works.length,
      releasesDeduplicated: 0,
      releasesAccepted: discoveredEditions.length,
      coverLookups: 0,
    },
  };
}

function seikoPromoRow(): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: 18_652_624,
    masterId: null,
    title: "Seiko Matsuda - \u7279\u5225\u306a\u604b\u4eba",
    year: 2011,
    country: "Japan",
    formats: ["CD", "Single", "Promo", "Sampler"],
    labels: ["UNIVERSAL SIGMA"],
    catalogNumber: "UMCK-5355",
    barcode: null,
    apiUrl: "https://api.discogs.com/releases/18652624",
    sourceUrl: "https://www.discogs.com/release/18652624",
    thumbnailUrl: null,
    coverImageUrl: null,
  };
}

function seikoDiscogsSearch(
  rows: DiscogsSearchReleaseEvidence[],
): DiscogsResult<DiscogsJapanCdSearchResult> {
  return {
    value: {
      evidenceRole: "corroborating-only",
      artistQuery: "Seiko Matsuda",
      items: rows,
      sourceTotal: rows.length,
      pagesFetched: 1,
      partial: false,
    },
    warnings: [],
    rateLimit: null,
  };
}

function seikoPrepareDependencies(): ComprehensiveSourceAdapterDependencies {
  return {
    useCuratedManifests: true,
    findCuratedDiscography: () => manifest,
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
      searchCatalogNumber: async () => ({
        value: {
          queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch",
          sourceTotal: 0,
          records: [],
          complete: true,
        },
        warnings: [],
      }),
    },
    fetchNdlSingleManifests: async () => ({ evidence: [], unavailable: false }),
    researchSeikoOfficial: async () => ({ complete: true } as SeikoMatsudaOfficialResult),
    matchSeikoOfficial: () => official(cases.map((fixture) => officialMatch(fixture.key))),
    discogs: {
      searchJapanCdReleases: async () => seikoDiscogsSearch([seikoPromoRow()]),
      getRelease: async () => ({ value: null, warnings: [], rateLimit: null }),
    },
    musicMetadata: {
      getCoverArt: async () => ({ value: null, warnings: [] }),
    },
    searchItunes: async () => [],
    searchItunesByTitle: async () => [],
    limits: {
      maxNdlCatalogLookups: 0,
      maxOfficialCandidates: 0,
      maxDiscogsQueries: 1,
      maxDiscogsPagesPerQuery: 1,
      maxDiscogsItemsPerQuery: 50,
      maxDiscogsCoverDetailsPerCandidate: 0,
      maxItunesTitleLookups: 0,
    },
  };
}

async function prepareSeikoFourKeys(excludedBundleKey?: string) {
  return prepareComprehensiveSourceEvidence({
    request: seikoRequest,
    result: seikoResearchResult(),
    bundle: combinedSeikoBundle(excludedBundleKey),
    candidates: cases.map((fixture) => canonicalCandidate(fixture.key)),
  }, seikoPrepareDependencies());
}

test("full prepare fetches fixed exact MusicBrainz editions missed by artist traversal", async () => {
  const fixtures = [
    {
      key: "ORIGINAL_ALBUM:33",
      groupId: "b29ee5b6-571e-4e2a-9050-3fc257ccfda1",
      releaseId: "7307ae91-9841-4e24-ae93-331e135be494",
      title: "SEIKO LOVE & EMOTION VOL.1",
      date: "2001-06-20",
      catalogNumber: "UMCK-4029",
    },
    {
      key: "ORIGINAL_ALBUM:34",
      groupId: "3340a12b-1514-4699-bd2d-cc402537c120",
      releaseId: "0e9021da-f8dd-40ea-9a03-9b2d2f8ab7d4",
      title: "SEIKO LOVE & EMOTION VOL.2",
      date: "2001-11-28",
      catalogNumber: "UMCK-4040",
    },
  ] as const;
  const releaseById = new Map<string, MusicReleaseEvidence>(fixtures.map((fixture) => {
    const bundle = evidenceBundle(
      fixture.groupId,
      fixture.releaseId,
      fixture.title,
      fixture.date,
      "Album",
      fixture.catalogNumber,
      "CD",
    );
    return [fixture.releaseId, bundle.works![0]!.editions[0]!.evidence] as const;
  }));
  const requested: string[] = [];
  const dependencies = seikoPrepareDependencies();
  dependencies.musicMetadata = {
    getCoverArt: async () => ({ value: null, warnings: [] }),
    getRelease: async (releaseId) => {
      requested.push(releaseId);
      return { value: releaseById.get(releaseId) ?? null, warnings: [] };
    },
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: seikoRequest,
    result: seikoResearchResult(),
    bundle: combinedSeikoBundle(),
    candidates: fixtures.map((fixture) => canonicalCandidate(fixture.key)),
  }, dependencies);

  assert.deepEqual(requested.sort(), fixtures.map((fixture) => fixture.releaseId).sort());
  for (const fixture of fixtures) {
    const candidate = prepared.candidates.find((item) =>
      candidateManifestKey(item) === fixture.key);
    assert.ok(candidate);
    assert.equal(candidate.observations.some((item) =>
      item.reasonCode === "CURATED_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH" &&
      item.sourceUrl === `https://musicbrainz.org/release/${fixture.releaseId}` &&
      item.verdict === "PASS"), true);
  }
});

test("a fixed MusicBrainz discovery seed cannot bypass the complete carrier tuple", async () => {
  const fixture = {
    key: "ORIGINAL_ALBUM:33",
    groupId: "b29ee5b6-571e-4e2a-9050-3fc257ccfda1",
    releaseId: "7307ae91-9841-4e24-ae93-331e135be494",
    title: "SEIKO LOVE & EMOTION VOL.1",
    date: "2001-06-20",
  } as const;
  const bundle = evidenceBundle(
    fixture.groupId,
    fixture.releaseId,
    fixture.title,
    fixture.date,
    "Album",
    "WRONG-4029",
    "CD",
  );
  const dependencies = seikoPrepareDependencies();
  dependencies.musicMetadata = {
    getCoverArt: async () => ({ value: null, warnings: [] }),
    getRelease: async () => ({
      value: bundle.works![0]!.editions[0]!.evidence,
      warnings: [],
    }),
  };
  const prepared = await prepareComprehensiveSourceEvidence({
    request: seikoRequest,
    result: seikoResearchResult(),
    bundle: combinedSeikoBundle(),
    candidates: [canonicalCandidate(fixture.key)],
  }, dependencies);
  const candidate = prepared.candidates.find((item) =>
    candidateManifestKey(item) === fixture.key);
  assert.ok(candidate);
  assert.equal(candidate.observations.some((item) =>
    item.reasonCode === "CURATED_MUSICBRAINZ_CANONICAL_WORK_CARRIER_MATCH" &&
    item.verdict === "PASS"), false);
});

test("full prepare bridges the four fixed Seiko gaps with real MusicBrainz shapes", async () => {
  const prepared = await prepareSeikoFourKeys();
  for (const fixture of cases) {
    const candidate = prepared.candidates.find((item) =>
      candidateManifestKey(item) === fixture.key);
    assert.ok(candidate, fixture.key);
    assert.equal(candidate.observations.some((item) =>
      item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY" &&
      item.verdict === "PASS"), true, fixture.key);
    const readiness = classifyComprehensiveEvidence({
      candidateId: candidate.candidate.id,
      workId: candidate.workId,
      editionId: candidate.editionId,
      title: candidate.candidate.title,
      artistCredit: candidate.candidate.artistCredit,
      observations: candidate.observations,
      conflicts: candidate.conflicts,
    });
    assert.deepEqual(
      readiness,
      fixture.key === "ORIGINAL_ALBUM:35"
        ? { verdict: "UNKNOWN", reasonCode: "MISSING_MUSICBRAINZ", eligibleForAi: false }
        : { verdict: "PASS", reasonCode: "EVIDENCE_READY", eligibleForAi: true },
      `${fixture.key}: ${JSON.stringify({
        workId: candidate.workId,
        editionId: candidate.editionId,
        observations: candidate.observations.filter((item) =>
          item.verdict === "OUT_OF_SCOPE" ||
          item.reasonCode === "SEIKO_FIXED_CANONICAL_DISCOGS_PROMO_IGNORED" ||
          item.reasonCode === "CURATED_OFFICIAL_WORK_MANIFEST_MATCH" ||
          item.reasonCode === "SEIKO_OFFICIAL_DETAIL_WORK_VERIFIED" ||
          item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"),
      })}`,
    );
    assert.equal(candidate.conflicts.some((conflict) =>
      conflict.certainty === "AI_REVIEW" && conflict.reasonCode === fixture.conflict), true);
  }

  const special = prepared.candidates.find((candidate) =>
    candidateManifestKey(candidate) === "SINGLE:71")!;
  const promoAudit = special.observations.filter((item) =>
    item.provider === "discogs" &&
    item.reasonCode === "SEIKO_FIXED_CANONICAL_DISCOGS_PROMO_IGNORED");
  assert.equal(promoAudit.length, 2);
  assert.equal(promoAudit.every((item) => item.verdict === "UNKNOWN"), true);
  assert.equal(special.observations.some((item) =>
    item.provider === "discogs" && item.verdict === "PASS"), false);
  assert.equal(special.observations.some((item) =>
    item.reasonCode === "DISCOGS_PROMOTIONAL_EDITION_OUT_OF_SCOPE"), false);
});

test("a promotional Discogs row stays out of scope without the fixed regular MusicBrainz CD", async () => {
  const prepared = await prepareSeikoFourKeys("SINGLE:71");
  const special = prepared.candidates.find((candidate) =>
    candidateManifestKey(candidate) === "SINGLE:71")!;
  assert.equal(special.observations.some((item) =>
    item.reasonCode === "SEIKO_TARGETED_MUSICBRAINZ_WORK_IDENTITY"), false);
  assert.equal(special.observations.some((item) =>
    item.provider === "discogs" &&
    item.reasonCode === "DISCOGS_PROMOTIONAL_EDITION_OUT_OF_SCOPE" &&
    item.verdict === "OUT_OF_SCOPE"), true);
  assert.equal(classifyComprehensiveEvidence({
    candidateId: special.candidate.id,
    workId: special.workId,
    editionId: special.editionId,
    title: special.candidate.title,
    artistCredit: special.candidate.artistCredit,
    observations: special.observations,
    conflicts: special.conflicts,
  }).verdict, "OUT_OF_SCOPE");
});

function seikoSonyBoxCandidates() {
  const ordinals = [...Array.from({ length: 26 }, (_, index) => index + 1), 29];
  return ordinals.map((ordinal): ComprehensiveDiscographyCandidate => {
    const key = `SINGLE:${ordinal}`;
    const work = workFor(key);
    const provider = "curated-official-manifest:seiko-matsuda";
    const id = `seiko-box-${ordinal}`;
    const artistCredit = work.artistCredits?.[0] ?? manifest.canonicalName;
    return {
      candidate: releaseCandidate(id, work, artistCredit),
      workId: `${provider}:${key}`,
      editionId: `${provider}:representation:${key}`,
      observations: [
        {
          id: `${provider}:authority:${key}`,
          provider,
          role: "AUTHORITATIVE",
          strength: "STRONG",
          stage: "AUTHORITATIVE",
          verdict: "PASS",
          reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
          reason: "Fixed manifest work.",
          sourceUrl: work.authorityUrls[0] ?? null,
          matchedFields: ["artist", "title", "category"],
          facts: {
            manifestEntryKey: key,
            artist: manifest.canonicalName,
            artistCredits: (work.artistCredits ?? []).join(","),
            title: work.title,
            category: work.category,
            date: work.originalReleaseDate,
          },
        },
        {
          id: `${provider}:scope:${key}`,
          provider,
          role: "DISCOVERY",
          strength: "SUPPORTING",
          stage: "SCOPE",
          verdict: "PASS",
          reasonCode: "CURATED_LATER_OFFICIAL_CD_CONFIRMED",
          reason: "Official box carrier.",
          sourceUrl: work.mediaScope!.physicalCdAuthorityUrls[0]!,
          matchedFields: ["country", "format", "artist", "title"],
          facts: {
            manifestEntryKey: key,
            country: "JP",
            format: "CD",
            physicalCd: "LATER_OFFICIAL_EDITION",
            physicalCdCountry: "JP",
            physicalCdReleaseDate: work.mediaScope!.physicalCdReleaseDate,
            physicalCdCatalogNumber: work.mediaScope!.physicalCdCatalogNumber,
            physicalCdRepresentationKind: "CONTAINER_INCLUSION",
            physicalCdContainerTitle: work.mediaScope!.physicalCdContainerTitle ?? null,
          },
        },
        {
          id: `discogs:original:${key}`,
          provider: "discogs",
          role: "CORROBORATING",
          strength: "SUPPORTING",
          stage: "CORROBORATION",
          verdict: "PASS",
          reasonCode: "CURATED_DISCOGS_ORIGINAL_WORK_MATCH",
          reason: "Unique original-work binding.",
          sourceUrl: `https://www.discogs.com/release/${20_000_000 + ordinal}`,
          matchedFields: ["artist", "title", "category", "originalYear"],
          facts: {
            artist: artistCredit,
            boundArtistCredit: artistCredit,
            canonicalArtist: manifest.canonicalName,
            canonicalTitle: work.title,
            category: work.category,
            originalYear: work.originalReleaseDate!.slice(0, 4),
            manifestEntryKey: key,
            uniqueBinding: "true",
            inventoryComplete: "true",
          },
        },
      ],
      conflicts: [],
    };
  });
}

function seikoSonyBoxOfficial(): SeikoMatsudaOfficialResult {
  return {
    complete: true,
    externalEvidence: {
      sources: {
        WHOS_SONY_BOX: {
          status: "VERIFIED",
          verified: true,
          unique: true,
          warning: null,
          limitations: [],
          evidence: {
            evidenceKey: "WHOS_SONY_BOX",
            workKey: "SINGLE:29",
            observedArtist: "\u677e\u7530\u8056\u5b50",
            observedArtistCredit: "SEIKO",
            observedWorkTitle: "WHO'S THAT BOY",
            observedBoxTitle:
              "Seiko Matsuda Single Collection 30th Anniversary Box～The Voice Of a Queen～",
            observedBoxReleaseDate: "2010-05-26",
            observedCatalogDisplay: "SRCL20061-133",
            observedCatalogRange: { start: "SRCL-20061", end: "SRCL-20133" },
            completeSinglesCount: 73,
            cdDiscCount: 73,
            carrier: "BLU_SPEC_CD",
            overseasSingles: [],
            publishedDate: "2010-04-03",
            verifiedFields: [
              "artist",
              "artistCredit",
              "title",
              "boxCompleteness",
              "date",
              "catalogRange",
              "carrier",
            ],
            provenance: {
              sourceUrl: "https://www.sonymusic.co.jp/artist/SeikoMatsuda/info/337828",
            },
          },
        },
      },
    },
  } as unknown as SeikoMatsudaOfficialResult;
}

test("one strict Sony box entity binds all 27 Seiko synthetic carrier representations", () => {
  const candidates = seikoSonyBoxCandidates();
  const output = applySeikoSonyBoxCarrierEvidence({
    candidates,
    manifest,
    official: seikoSonyBoxOfficial(),
  });
  assert.equal(output.length, 27);
  for (const candidate of output) {
    assert.equal(candidate.observations.filter((observation) =>
      observation.reasonCode === "SEIKO_SONY_COMPLETE_SINGLES_CD_BOX_CARRIER_MATCH").length, 1);
    const readiness = classifyComprehensiveEvidence({
      candidateId: candidate.candidate.id,
      workId: candidate.workId,
      editionId: candidate.editionId,
      title: candidate.candidate.title,
      artistCredit: candidate.candidate.artistCredit,
      observations: candidate.observations,
      conflicts: candidate.conflicts,
    });
    const key = candidateManifestKey(candidate);
    if (key === "SINGLE:29") {
      assert.notEqual(readiness.reasonCode, "MISSING_DECLARED_CARRIER");
    } else {
      assert.equal(
        readiness.eligibleForAi,
        true,
        `${candidate.candidate.title}: ${JSON.stringify(readiness)}`,
      );
    }
  }
});

test("the Sony box bridge fails closed on wrong date, catalog range, or completeness", () => {
  const cases = [
    (value: SeikoMatsudaOfficialResult) => {
      (value.externalEvidence.sources.WHOS_SONY_BOX as never as { evidence: { observedBoxReleaseDate: string } })
        .evidence.observedBoxReleaseDate = "2010-05-27";
    },
    (value: SeikoMatsudaOfficialResult) => {
      (value.externalEvidence.sources.WHOS_SONY_BOX as never as { evidence: { observedCatalogRange: { end: string } } })
        .evidence.observedCatalogRange.end = "SRCL-20132";
    },
    (value: SeikoMatsudaOfficialResult) => {
      (value.externalEvidence.sources.WHOS_SONY_BOX as never as { evidence: { cdDiscCount: number } })
        .evidence.cdDiscCount = 72;
    },
  ];
  for (const mutate of cases) {
    const official = structuredClone(seikoSonyBoxOfficial());
    mutate(official);
    const [candidate] = applySeikoSonyBoxCarrierEvidence({
      candidates: seikoSonyBoxCandidates(),
      manifest,
      official,
    });
    assert.ok(candidate);
    assert.equal(candidate.observations.some((observation) =>
      observation.reasonCode === "SEIKO_SONY_COMPLETE_SINGLES_CD_BOX_CARRIER_MATCH"), false);
    assert.equal(classifyComprehensiveEvidence({
      candidateId: candidate.candidate.id,
      workId: candidate.workId,
      editionId: candidate.editionId,
      title: candidate.candidate.title,
      artistCredit: candidate.candidate.artistCredit,
      observations: candidate.observations,
      conflicts: candidate.conflicts,
    }).reasonCode, "MISSING_DECLARED_CARRIER");
  }
});
