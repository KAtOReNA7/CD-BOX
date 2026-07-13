import assert from "node:assert/strict";
import test from "node:test";

import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import { applySeikoMatsudaRecoveryEvidence } from "@/lib/ai/seiko-recovery-application";
import { findCuratedArtistDiscography } from "@/lib/official-music/curated-discography";
import {
  SEIKO_MATSUDA_RECOVERY_SPECS,
  type SeikoMatsudaRecoveryEntity,
  type SeikoMatsudaRecoveryResult,
  type SeikoMatsudaRecoveryWorkKey,
} from "@/lib/official-music/seiko-matsuda-recovery";

const resolvedManifest = findCuratedArtistDiscography(null, ["松田聖子"]);
assert.ok(resolvedManifest);
const manifest = resolvedManifest;

function entity(key: SeikoMatsudaRecoveryWorkKey): SeikoMatsudaRecoveryEntity {
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
  const coverUrl = `https://www.seikomatsuda.co.jp${spec.coverPath}`;
  const facts = {
    manifestEntryKey: key,
    verified: "true",
    unique: "true",
    dynamicOfficialCarrier: "true",
    provenanceSourceUrl: spec.sourceUrl,
    fixedPageId: String(spec.detailId),
    artist: "松田聖子",
    artistCredit: "松田聖子",
    title: spec.pageTitle,
    canonicalTitle: spec.canonicalTitle,
    category: spec.manifestCategory,
    officialCategory: spec.officialCategory,
    date: spec.releaseDate,
    originalReleaseDate: spec.releaseDate,
    catalogNumber: spec.catalogNumbers[0] ?? null,
    catalogNumbers: spec.catalogNumbers.join(","),
    carrier: "CD",
    format: "CD",
    country: "JP",
    status: "Official",
    selectionPolicy: spec.selectionPolicy,
    coverUrl,
    auditedCoverSha256: spec.auditedAsset.sha256,
  };
  return {
    manifestEntryKey: key,
    sourceUrl: spec.sourceUrl,
    provider: "seiko-matsuda-official",
    sourceType: "official-artist-entity-page",
    evidenceScope: "single-item-page",
    observedArtist: "松田聖子",
    observedTitle: spec.pageTitle,
    canonicalTitle: spec.canonicalTitle,
    observedCategory: spec.officialCategory,
    manifestCategory: spec.manifestCategory,
    observedReleaseDate: spec.releaseDate,
    observedCatalogDisplay: spec.catalogDisplay,
    observedCatalogNumbers: [...spec.catalogNumbers],
    selectionPolicy: spec.selectionPolicy,
    carrier: {
      provider: "seiko-matsuda-official",
      sourceUrl: spec.sourceUrl,
      role: "AUTHORITATIVE",
      strength: "STRONG",
      matchedFields: ["artist", "title", "category", "date", "catalogNumber", "format"],
      facts,
    },
    cover: {
      provider: "seiko-matsuda-official",
      scope: "WORK",
      matchLevel: "WORK_EXACT",
      url: coverUrl,
      sourceUrl: spec.sourceUrl,
      observedAlt: spec.pageTitle,
      requiresAssetValidation: true,
      auditedAsset: spec.auditedAsset,
    },
  };
}

function recovery(...entities: SeikoMatsudaRecoveryEntity[]): SeikoMatsudaRecoveryResult {
  return {
    status: "COMPLETE",
    requestedKeys: entities.map((item) => item.manifestEntryKey),
    outcomes: entities.map((item) => ({
      workKey: item.manifestEntryKey,
      sourceUrl: item.sourceUrl,
      status: "VERIFIED",
      entity: item,
      failure: null,
    })),
    verified: entities,
    byManifestEntryKey: Object.fromEntries(entities.map((item) => [item.manifestEntryKey, item])),
    stats: {
      requested: entities.length,
      cacheHits: 0,
      dnsLookups: 1,
      requestsAttempted: entities.length,
      responsesFetched: entities.length,
      retries: 0,
      pagesParsed: entities.length,
      failures: 0,
    },
  };
}

function manifestWork(key: SeikoMatsudaRecoveryWorkKey) {
  const [category, rawOrdinal] = key.split(":");
  return manifest.works.find((work) =>
    work.category === category && work.ordinal === Number(rawOrdinal))!;
}

function candidate(
  key: SeikoMatsudaRecoveryWorkKey,
  workId = `work:${key}`,
): ComprehensiveDiscographyCandidate {
  const work = manifestWork(key);
  const media = work.mediaScope!;
  return {
    candidate: {
      id: `candidate:${key}`,
      title: work.title,
      titleOriginal: null,
      category: work.category,
      artistCredit: "松田聖子",
      releaseDate: media.physicalCdReleaseDate,
      originalReleaseDate: work.originalReleaseDate,
      format: "CD (official canonical-work representation)",
      catalogNumber: media.physicalCdCatalogNumber,
      barcode: null,
      label: null,
      originalPrice: null,
      editionType: "OFFICIAL_ORIGINAL_CARRIER_REPRESENTATION",
      isReissue: media.physicalCd === "LATER_OFFICIAL_EDITION",
      isRemaster: null,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [],
      verification: null,
    },
    workId,
    editionId: `curated-official-manifest:seiko-matsuda:representation:${key}`,
    observations: [{
      id: `manifest:${key}`,
      provider: "curated-official-manifest:seiko-matsuda",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "fixture",
      sourceUrl: work.authorityUrls[0] ?? null,
      matchedFields: ["artist", "title", "category"],
      facts: { manifestEntryKey: key },
    }],
    conflicts: [],
  };
}

test("adds exact Seiko work, carrier and cover evidence for an original CD", () => {
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("SINGLE:27")],
    manifest,
    recovery: recovery(entity("SINGLE:27")),
  });

  assert.equal(result.matchedWorks, 1);
  assert.equal(result.matchedCarriers, 1);
  assert.equal(result.coversByWorkId.size, 1);
  assert.equal(result.candidates[0]?.observations.some((item) =>
    item.reasonCode === "SEIKO_OFFICIAL_RECOVERY_WORK_VERIFIED"), true);
  const carrier = result.candidates[0]?.observations.find((item) =>
    item.reasonCode === "SEIKO_OFFICIAL_RECOVERY_CD_CARRIER_MATCH");
  assert.equal(carrier?.facts?.manifestEntryKey, "SINGLE:27");
  assert.equal(carrier?.facts?.uniqueCarrierEntity, "true");
});

test("uses early vinyl pages only as work artwork, never as the later box carrier", () => {
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("SINGLE:1")],
    manifest,
    recovery: recovery(entity("SINGLE:1")),
  });

  assert.equal(result.matchedWorks, 1);
  assert.equal(result.matchedCarriers, 0);
  assert.equal(result.coversByWorkId.size, 1);
  assert.equal(result.candidates[0]?.observations.some((item) =>
    item.reasonCode === "SEIKO_OFFICIAL_RECOVERY_CD_CARRIER_MATCH"), false);
});

test("uses the Candy original page only for the work cover when the manifest claims a later CD", () => {
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("ORIGINAL_ALBUM:6")],
    manifest,
    recovery: recovery(entity("ORIGINAL_ALBUM:6")),
  });

  assert.equal(result.matchedCarriers, 0);
  assert.equal(result.coversByWorkId.size, 1);
});

test("accepts the exact manifest-declared Seiko artist credits", () => {
  const cases = [
    ["SINGLE:28", "Seiko and Donnie Wahlberg"],
    ["SINGLE:35", "MATSUYAKKO"],
    ["SINGLE:40", "Seiko"],
    ["ORIGINAL_ALBUM:35", "SEIKO"],
  ] as const satisfies readonly (readonly [SeikoMatsudaRecoveryWorkKey, string])[];

  for (const [key, artistCredit] of cases) {
    const exact = candidate(key);
    exact.candidate.artistCredit = artistCredit;
    const result = applySeikoMatsudaRecoveryEvidence({
      candidates: [exact],
      manifest,
      recovery: recovery(entity(key)),
    });

    assert.equal(result.matchedWorks, 1, key);
    assert.equal(result.matchedCarriers, 1, key);
    assert.equal(result.coversByWorkId.size, 1, key);
  }
});

test("an invalid peer cannot erase an accepted Candy work cover", () => {
  const accepted = candidate("ORIGINAL_ALBUM:6", "candy-work");
  const invalidPeer = candidate("ORIGINAL_ALBUM:6", "candy-work");
  invalidPeer.candidate = {
    ...invalidPeer.candidate,
    id: "candidate:ORIGINAL_ALBUM:6:wrong-peer",
    title: "Unrelated title",
  };

  for (const candidates of [
    [accepted, invalidPeer],
    [invalidPeer, accepted],
  ]) {
    const result = applySeikoMatsudaRecoveryEvidence({
      candidates,
      manifest,
      recovery: recovery(entity("ORIGINAL_ALBUM:6")),
    });

    assert.equal(result.matchedWorks, 1);
    assert.equal(result.coversByWorkId.size, 1);
    const unchangedPeer = result.candidates.find((item) =>
      item.candidate.id === invalidPeer.candidate.id);
    assert.equal(unchangedPeer?.observations.some((item) =>
      item.reasonCode === "SEIKO_OFFICIAL_RECOVERY_WORK_VERIFIED"), false);
  }
});

test("fails closed for a duplicate official entity", () => {
  const exact = entity("SINGLE:27");
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("SINGLE:27")],
    manifest,
    recovery: recovery(exact, structuredClone(exact)),
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.matchedCarriers, 0);
  assert.equal(result.coversByWorkId.size, 0);
});

test("fails closed when two manifest works share one work id", () => {
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("SINGLE:20", "colliding"), candidate("SINGLE:21", "colliding")],
    manifest,
    recovery: recovery(entity("SINGLE:20"), entity("SINGLE:21")),
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.coversByWorkId.size, 0);
  assert.equal(result.candidates.every((item) => item.observations.length === 1), true);
});

test("rejects injected recovery facts that do not match the fixed page", () => {
  const changed = entity("ORIGINAL_ALBUM:53");
  changed.carrier.facts.selectionPolicy = "EXACT_TITLE";
  const result = applySeikoMatsudaRecoveryEvidence({
    candidates: [candidate("ORIGINAL_ALBUM:53")],
    manifest,
    recovery: recovery(changed),
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.coversByWorkId.size, 0);
});

test("does not assign a recovery cover to a candidate with the wrong title or artist", () => {
  for (const field of ["title", "artist"] as const) {
    const changed = candidate("SINGLE:27");
    if (field === "title") changed.candidate.title = "Unrelated title";
    else changed.candidate.artistCredit = "別人";
    const result = applySeikoMatsudaRecoveryEvidence({
      candidates: [changed],
      manifest,
      recovery: recovery(entity("SINGLE:27")),
    });
    assert.equal(result.matchedWorks, 0, field);
    assert.equal(result.coversByWorkId.size, 0, field);
  }
});
