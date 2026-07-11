import assert from "node:assert/strict";
import type { ReleaseCategory, ReleaseFormat } from "@prisma/client";
import { parseExcelBuffer } from "@/lib/import/excel-parser";
import {
  importedReleaseSourceRows,
  importedReleaseStatusData,
  releaseData,
} from "@/lib/import/import-service";
import { COVER_IMAGE_SOURCE_DESCRIPTION } from "@/lib/releases/cover-source";
import { buildReleaseExportBuffer } from "@/lib/releases/release-export";
import type { EditableCollectionStatus, ReleaseListItem } from "@/lib/releases/release-types";

const categories: ReleaseCategory[] = [
  "ORIGINAL_ALBUM",
  "SINGLE",
  "BEST",
  "COLLECTION",
  "COMPILATION",
  "LIVE",
  "REMIX",
  "BOX",
  "EP",
  "OTHER",
];
const formats: ReleaseFormat[] = [
  "SACD",
  "CD",
  "SHM_CD",
  "BLU_SPEC_CD",
  "HYBRID_SACD",
  "CD_DVD",
  "BOX_SET",
  "OTHER",
];
const statuses: EditableCollectionStatus[] = [
  "PENDING_REVIEW",
  "OWNED",
  "NOT_OWNED",
  "WANTED",
  "EXCLUDED",
];

const releases: ReleaseListItem[] = categories.map((category, index) => ({
  id: `release-${index}`,
  artistId: "artist-1",
  category,
  title: `Round trip ${index}`,
  originalReleaseDate: `2000-01-${String(index + 1).padStart(2, "0")}`,
  format: formats[index % formats.length],
  originalCatalogNo: `CAT-${index}`,
  label: `Label ${index}`,
  originalPrice: index === 0 ? "3,059円" : null,
  editionType: index === 0 ? "初回限定盤" : null,
  isReissue: index % 2 === 0,
  isRemaster: index % 3 === 0,
  isExcludedByDefault: index % 4 === 0,
  confidence: "HIGH",
  warnings: [],
  notes: index === 0 ? "云端备注" : null,
  coverImageUrl: index === 0 ? "https://images.example/cover.jpg" : null,
  sources: index === 0
    ? [
        {
          id: "evidence-1",
          url: "https://label.example/releases/0",
          label: "Label",
          description: "official",
        },
        {
          id: "evidence-2",
          url: "https://catalog.example/releases/0",
          label: "Catalog",
          description: "database",
        },
        {
          id: "cover-1",
          url: "https://music.apple.com/jp/album/example/1",
          label: "Apple Music",
          description: COVER_IMAGE_SOURCE_DESCRIPTION,
        },
      ]
    : [],
  userStatus: {
    id: `status-${index}`,
    status: statuses[index % statuses.length],
    priority: (index % 5) + 1,
    ownedCondition: null,
    ownedNotes: index === 0 ? "带侧标，品相良好" : null,
    notes: null,
  },
}));

const rows = parseExcelBuffer(buildReleaseExportBuffer(releases), "cloud-export.xlsx");

assert.equal(rows.length, releases.length);
assert.ok(rows.every((row) => row.sheetName === "CD-BOX"));
assert.deepEqual(rows.map((row) => row.category), categories);
assert.deepEqual(rows.map((row) => row.format), categories.map((_, index) => formats[index % formats.length]));
assert.deepEqual(rows.map((row) => row.status), categories.map((_, index) => statuses[index % statuses.length]));

const first = rows[0];
assert.equal(first.originalReleaseDate, "2000-01-01");
assert.equal(first.originalCatalogNo, "CAT-0");
assert.equal(first.label, "Label 0");
assert.equal(first.originalPrice, "3,059円");
assert.equal(first.editionType, "初回限定盤");
assert.equal(first.isReissue, true);
assert.equal(first.isRemaster, true);
assert.equal(first.isExcludedByDefault, true);
assert.equal(first.notes, "云端备注");
assert.equal(first.coverImageUrl, "https://images.example/cover.jpg");
assert.equal(first.coverImageSourceUrl, "https://music.apple.com/jp/album/example/1");
assert.equal(first.sourceUrl, "https://label.example/releases/0");
assert.deepEqual(first.sourceUrls, [
  "https://label.example/releases/0",
  "https://catalog.example/releases/0",
]);
assert.equal(first.priority, 1);
assert.equal(first.ownedNotes, "带侧标，品相良好");

assert.deepEqual(importedReleaseStatusData(first), {
  status: "PENDING_REVIEW",
  priority: 1,
  ownedNotes: "带侧标，品相良好",
});
assert.deepEqual(importedReleaseSourceRows(first), [
  {
    url: "https://label.example/releases/0",
    label: "Imported source URL",
    description: null,
  },
  {
    url: "https://catalog.example/releases/0",
    label: "Imported source URL",
    description: null,
  },
  {
    url: "https://music.apple.com/jp/album/example/1",
    label: "Apple Music",
    description: COVER_IMAGE_SOURCE_DESCRIPTION,
  },
]);
assert.deepEqual(releaseData(first, "artist-1", "batch-1"), {
  artistId: "artist-1",
  importBatchId: "batch-1",
  category: "ORIGINAL_ALBUM",
  title: "Round trip 0",
  originalReleaseDate: new Date("2000-01-01T00:00:00.000Z"),
  format: "SACD",
  originalCatalogNo: "CAT-0",
  label: "Label 0",
  originalPrice: "3,059円",
  editionType: "初回限定盤",
  isReissue: true,
  isRemaster: true,
  isExcludedByDefault: true,
  notes: "云端备注",
  coverImageUrl: "https://images.example/cover.jpg",
});

console.log("Release export/import round-trip test passed.");
