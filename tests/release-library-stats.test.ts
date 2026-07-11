import assert from "node:assert/strict";
import { computeArtistStats } from "@/lib/releases/release-stats";
import { serializeRelease, type SerializableRelease } from "@/lib/releases/release-serialization";
import type { ReleaseListItem } from "@/lib/releases/release-types";

function row(id: string, status: "OWNED" | "WANTED" | "NOT_OWNED" | "EXCLUDED", excluded = false): ReleaseListItem {
  return {
    id,
    artistId: "a1",
    category: id === "single" ? "SINGLE" : "ORIGINAL_ALBUM",
    title: id,
    originalReleaseDate: "1985-09-05",
    format: "CD",
    originalCatalogNo: id,
    label: null,
    originalPrice: null,
    editionType: null,
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: excluded,
    confidence: null,
    warnings: [],
    notes: null,
    coverImageUrl: null,
    sources: [],
    userStatus: { id: `u-${id}`, status, priority: 3, ownedCondition: null, ownedNotes: null, notes: null },
  };
}

const stats = computeArtistStats([
  row("owned", "OWNED"),
  row("wanted", "WANTED"),
  row("single", "NOT_OWNED"),
  row("excluded", "EXCLUDED"),
  row("default-excluded", "OWNED", true),
]);

assert.equal(stats.total, 5);
assert.equal(stats.owned, 2);
assert.equal(stats.wanted, 1);
assert.equal(stats.excluded, 2);
assert.equal(stats.completionRate, 33);
assert.equal(stats.missingCover, 5);
assert.equal(stats.missingSource, 5);

const serializedRelease = {
  id: "private-status",
  artistId: "a1",
  category: "ORIGINAL_ALBUM",
  title: "Private status",
  originalReleaseDate: null,
  format: "CD",
  originalCatalogNo: null,
  label: null,
  originalPrice: null,
  editionType: null,
  isReissue: false,
  isRemaster: false,
  isExcludedByDefault: false,
  confidence: null,
  warnings: null,
  notes: null,
  coverImageUrl: null,
  importBatchId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  sources: [],
  userStatus: [
    {
      id: "status-u1",
      userId: "u1",
      releaseId: "private-status",
      status: "OWNED",
      priority: 1,
      ownedCondition: null,
      ownedNotes: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "status-u2",
      userId: "u2",
      releaseId: "private-status",
      status: "WANTED",
      priority: 5,
      ownedCondition: null,
      ownedNotes: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
} satisfies SerializableRelease;

assert.equal(serializeRelease(serializedRelease).userStatus, null);
assert.equal(serializeRelease(serializedRelease, "missing-user").userStatus, null);
assert.equal(serializeRelease(serializedRelease, "u2").userStatus?.status, "WANTED");

console.log("Release library stats test passed.");
