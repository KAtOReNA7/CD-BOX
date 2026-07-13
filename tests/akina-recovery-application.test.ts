import assert from "node:assert/strict";
import test from "node:test";

import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import { applyAkinaNakamoriOfficialRecovery } from "@/lib/ai/akina-recovery-application";
import {
  AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS,
  type AkinaNakamoriOfficialCarrierEvidence,
  type AkinaNakamoriOfficialRecoveryResult,
  type AkinaNakamoriOfficialWorkCoverEvidence,
} from "@/lib/official-music/akina-nakamori";
import { findCuratedArtistDiscography } from "@/lib/official-music/curated-discography";

const resolvedManifest = findCuratedArtistDiscography(null, ["中森明菜"]);
assert.ok(resolvedManifest);
const manifest = resolvedManifest;

const coverUrls = {
  "SINGLE:50": "https://content-jp.umgi.net/products/um/umck-5257_test_extralarge.jpg",
  "SINGLE:54": "https://content-jp.umgi.net/products/up/upch-5870_test_extralarge.jpg",
  "SINGLE:55": "https://wmg.jp/packages/33269/images/tujyoban_jacket.jpg",
  "ORIGINAL_ALBUM:15": "https://content-jp.umgi.net/products/up/upch-7267_test_extralarge.jpg",
} as const;

function carrier(
  key: "SINGLE:50" | "SINGLE:54" | "SINGLE:55",
): AkinaNakamoriOfficialCarrierEvidence {
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  return {
    provider: spec.provider,
    role: "CORROBORATING",
    strength: "STRONG",
    scope: "EDITION",
    matchLevel: "EDITION_EXACT",
    manifestEntryKey: key,
    artist: "中森明菜",
    canonicalTitle: spec.canonicalTitle,
    observedTitle: spec.observedTitle,
    category: "SINGLE",
    country: "JP",
    format: "CD",
    releaseDate: spec.releaseDate,
    catalogNumber: spec.catalogNumber,
    sourceUrl: spec.sourceUrl,
    cover: {
      provider: spec.provider,
      scope: "WORK",
      matchLevel: "WORK_EXACT",
      url: coverUrls[key],
      sourceUrl: spec.sourceUrl,
      observedAlt: spec.observedTitle,
      requiresAssetValidation: true,
      auditedAsset: { ...spec.auditedAsset },
    },
  };
}

function albumCover(): AkinaNakamoriOfficialWorkCoverEvidence {
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS["ORIGINAL_ALBUM:15"];
  return {
    manifestEntryKey: "ORIGINAL_ALBUM:15",
    artist: "中森明菜",
    canonicalTitle: "UNBALANCE+BALANCE",
    observedEditionTitle: "UNBALANCE+BALANCE+6 [UHQCD]",
    observedEditionDate: "2017-05-03",
    observedEditionCatalogNumber: "UPCH-7267",
    sourceUrl: spec.sourceUrl,
    cover: {
      provider: "universal-music-japan",
      scope: "WORK",
      matchLevel: "WORK_EXACT",
      url: coverUrls["ORIGINAL_ALBUM:15"],
      sourceUrl: spec.sourceUrl,
      observedAlt: spec.observedTitle,
      requiresAssetValidation: true,
      auditedAsset: { ...spec.auditedAsset },
    },
  };
}

function recovery(): AkinaNakamoriOfficialRecoveryResult {
  return {
    carriers: {
      "SINGLE:50": carrier("SINGLE:50"),
      "SINGLE:54": carrier("SINGLE:54"),
      "SINGLE:55": carrier("SINGLE:55"),
    },
    workCovers: { "ORIGINAL_ALBUM:15": albumCover() },
    warnings: [],
    stats: { requestsAttempted: 4, responsesFetched: 4, retries: 0, entitiesMatched: 4 },
  };
}

function work(key: "SINGLE:50" | "SINGLE:54" | "SINGLE:55" | "ORIGINAL_ALBUM:15") {
  const [category, rawOrdinal] = key.split(":");
  return manifest.works.find((item) =>
    item.category === category && item.ordinal === Number(rawOrdinal))!;
}

function candidate(
  key: "SINGLE:50" | "SINGLE:54" | "SINGLE:55" | "ORIGINAL_ALBUM:15",
  workId = `work:${key}`,
): ComprehensiveDiscographyCandidate {
  const manifestWork = work(key);
  const media = manifestWork.mediaScope!;
  return {
    candidate: {
      id: `candidate:${key}`,
      title: manifestWork.title,
      titleOriginal: null,
      category: manifestWork.category,
      artistCredit: "中森明菜",
      releaseDate: media.physicalCdReleaseDate,
      originalReleaseDate: manifestWork.originalReleaseDate,
      format: "CD (official canonical-work representation)",
      catalogNumber: media.physicalCdCatalogNumber,
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
      sources: [],
      verification: null,
    },
    workId,
    editionId: `curated-official-manifest:akina-nakamori:representation:${key}`,
    observations: [{
      id: `manifest:${key}`,
      provider: "curated-official-manifest:akina-nakamori",
      role: "AUTHORITATIVE",
      strength: "STRONG",
      stage: "AUTHORITATIVE",
      verdict: "PASS",
      reasonCode: "CURATED_OFFICIAL_WORK_MANIFEST_MATCH",
      reason: "fixture",
      sourceUrl: manifestWork.authorityUrls[0] ?? null,
      matchedFields: ["artist", "title", "category"],
      facts: { manifestEntryKey: key },
    }],
    conflicts: [],
  };
}

test("adds fixed official carrier and cover evidence for all three Akina singles", () => {
  const result = applyAkinaNakamoriOfficialRecovery({
    candidates: [candidate("SINGLE:50"), candidate("SINGLE:54"), candidate("SINGLE:55")],
    manifest,
    recovery: recovery(),
  });

  assert.equal(result.matchedWorks, 3);
  assert.equal(result.matchedCarriers, 3);
  assert.equal(result.coversByWorkId.size, 3);
  assert.equal(result.candidates.every((item) => item.observations.some((observation) =>
    observation.reasonCode === "AKINA_OFFICIAL_RECOVERY_CD_CARRIER_MATCH")), true);
});

test("uses the UNBALANCE reissue only as exact work artwork", () => {
  const result = applyAkinaNakamoriOfficialRecovery({
    candidates: [candidate("ORIGINAL_ALBUM:15")],
    manifest,
    recovery: recovery(),
  });

  assert.equal(result.matchedWorks, 1);
  assert.equal(result.matchedCarriers, 0);
  assert.equal(result.coversByWorkId.size, 1);
  assert.equal(result.candidates[0]?.observations.some((item) =>
    item.reasonCode === "AKINA_OFFICIAL_RECOVERY_WORK_VERIFIED"), true);
});

test("rejects a same-day deluxe WMG entity instead of changing the selected normal edition", () => {
  const injected = recovery();
  injected.carriers["SINGLE:55"] = {
    ...carrier("SINGLE:55"),
    catalogNumber: "WPCL-13769/70",
  };
  const result = applyAkinaNakamoriOfficialRecovery({
    candidates: [candidate("SINGLE:55")],
    manifest,
    recovery: injected,
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.coversByWorkId.size, 0);
});

test("rejects a cover copied from another fixed Akina product", () => {
  const injected = recovery();
  injected.carriers["SINGLE:50"] = {
    ...carrier("SINGLE:50"),
    cover: {
      ...carrier("SINGLE:50").cover,
      url: coverUrls["SINGLE:54"],
    },
  };
  const result = applyAkinaNakamoriOfficialRecovery({
    candidates: [candidate("SINGLE:50")],
    manifest,
    recovery: injected,
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.coversByWorkId.size, 0);
});

test("fails closed when two manifest keys share one work identity", () => {
  const result = applyAkinaNakamoriOfficialRecovery({
    candidates: [candidate("SINGLE:50", "collision"), candidate("SINGLE:54", "collision")],
    manifest,
    recovery: recovery(),
  });

  assert.equal(result.matchedWorks, 0);
  assert.equal(result.matchedCarriers, 0);
  assert.equal(result.coversByWorkId.size, 0);
});

test("does not assign a recovery cover to a candidate with the wrong title or artist", () => {
  for (const field of ["title", "artist"] as const) {
    const changed = candidate("SINGLE:50");
    if (field === "title") changed.candidate.title = "Unrelated title";
    else changed.candidate.artistCredit = "別人";
    const result = applyAkinaNakamoriOfficialRecovery({
      candidates: [changed],
      manifest,
      recovery: recovery(),
    });
    assert.equal(result.matchedWorks, 0, field);
    assert.equal(result.coversByWorkId.size, 0, field);
  }
});
