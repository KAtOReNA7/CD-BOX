import assert from "node:assert/strict";
import { applyReleaseQualityGate } from "@/lib/ai/release-research-quality";
import type { ReleaseResearchCandidate } from "@/lib/ai/release-research-types";

function candidate(overrides: Partial<ReleaseResearchCandidate> = {}): ReleaseResearchCandidate {
  return {
    id: "candidate-1",
    title: "Sample",
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "Miho Nakayama",
    releaseDate: "1985-09-05",
    originalReleaseDate: "1985-09-05",
    format: "CD",
    catalogNumber: "K32X-30",
    barcode: null,
    label: "King Records",
    originalPrice: null,
    editionType: null,
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: [{ title: "Official", url: "https://example.com/release", sourceType: "official" }],
    ...overrides,
  };
}

const options = { target: "ORIGINAL_CD" as const, excludeReissues: true };

const completeCd = applyReleaseQualityGate(candidate({ confidence: "LOW" }), options);
assert.equal(completeCd.confidence, "HIGH");

const missingReleaseDate = applyReleaseQualityGate(
  candidate({ confidence: "LOW", releaseDate: null, originalReleaseDate: null }),
  options,
);
assert.equal(missingReleaseDate.confidence, "MEDIUM");

const missingCatalog = applyReleaseQualityGate(candidate({ catalogNumber: null }), options);
assert.equal(missingCatalog.confidence, "MEDIUM");
assert.ok(missingCatalog.warnings.some((warning) => warning.includes("catalogNumber")));

const correctedCatalog = applyReleaseQualityGate(
  candidate({ warnings: missingCatalog.warnings, catalogNumber: "K32X-30" }),
  options,
);
assert.equal(correctedCatalog.confidence, "HIGH");
assert.equal(correctedCatalog.warnings.some((warning) => warning.includes("catalogNumber")), false);

const missingSources = applyReleaseQualityGate(candidate({ sources: [] }), options);
assert.equal(missingSources.confidence, "LOW");
assert.ok(missingSources.warnings.some((warning) => warning.includes("source")));

const wikiOnly = applyReleaseQualityGate(
  candidate({ sources: [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Sample", sourceType: "database" }] }),
  options,
);
assert.equal(wikiOnly.confidence, "MEDIUM");
assert.ok(wikiOnly.warnings.some((warning) => warning.includes("only wiki source")));

const vinyl = applyReleaseQualityGate(candidate({ format: "LP Vinyl" }), options);
assert.equal(vinyl.isExcludedByDefault, true);
assert.equal(vinyl.confidence, "MEDIUM");
assert.ok(vinyl.warnings.some((warning) => warning.includes("non-CD")));

const reissue = applyReleaseQualityGate(candidate({ isReissue: true }), options);
assert.equal(reissue.isExcludedByDefault, true);
assert.equal(reissue.confidence, "MEDIUM");
assert.ok(reissue.warnings.some((warning) => warning.includes("reissue excluded by scope")));

const highNoSource = applyReleaseQualityGate(candidate({ confidence: "HIGH", sources: [] }), options);
assert.equal(highNoSource.confidence, "LOW");
assert.ok(highNoSource.warnings.some((warning) => warning.includes("source")));

const suspectedHallucination = applyReleaseQualityGate(
  candidate({ warnings: ["suspected hallucination: catalog not found"] }),
  options,
);
assert.equal(suspectedHallucination.confidence, "LOW");

const explicitlyPending = applyReleaseQualityGate(
  candidate({ warnings: ["PENDING_REVIEW: source cannot verify this edition."] }),
  options,
);
assert.equal(explicitlyPending.confidence, "MEDIUM");
assert.equal(explicitlyPending.quality.pendingReview, true);
assert.equal(explicitlyPending.quality.safeToImportByDefault, false);

console.log("Release research quality test passed.");
