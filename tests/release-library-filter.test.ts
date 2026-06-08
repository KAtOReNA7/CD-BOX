import assert from "node:assert/strict";
import { filterReleases } from "@/lib/releases/release-filters";
import type { ReleaseListItem } from "@/lib/releases/release-types";

function row(overrides: Partial<ReleaseListItem> = {}): ReleaseListItem {
  return {
    id: "r1",
    artistId: "a1",
    category: "ORIGINAL_ALBUM",
    title: "C",
    originalReleaseDate: "1985-09-05",
    format: "CD",
    originalCatalogNo: "K32X-30",
    label: "King Records",
    originalPrice: null,
    editionType: null,
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    confidence: "HIGH",
    warnings: [],
    notes: null,
    coverImageUrl: "https://example.com/cover.jpg",
    sources: [{ id: "s1", url: "https://example.com", label: null, description: null }],
    userStatus: { id: "u1", status: "OWNED", priority: 1, ownedCondition: null, ownedNotes: null, notes: null },
    ...overrides,
  };
}

const rows = [
  row(),
  row({
    id: "r2",
    title: "No source pending",
    originalReleaseDate: "1994-02-09",
    originalCatalogNo: null,
    coverImageUrl: null,
    sources: [],
    warnings: ["PENDING_REVIEW: missing catalogNumber"],
    userStatus: { id: "u2", status: "PENDING_REVIEW", priority: 4, ownedCondition: null, ownedNotes: null, notes: null },
  }),
];

assert.equal(filterReleases(rows, { q: "k32x" }).length, 1);
assert.equal(filterReleases(rows, { missingSource: "true" }).length, 1);
assert.equal(filterReleases(rows, { missingCover: "true" }).length, 1);
assert.equal(filterReleases(rows, { missingCatalog: "true" }).length, 1);
assert.equal(filterReleases(rows, { pendingReview: "true" }).length, 1);
assert.equal(filterReleases(rows, { gap: "true" }).length, 1);
assert.equal(filterReleases(rows, { decade: "1980s" }).length, 1);
assert.equal(filterReleases(rows, { decade: "custom", yearFrom: "1990", yearTo: "1999" }).length, 1);

console.log("Release library filter test passed.");
