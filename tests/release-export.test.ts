import assert from "node:assert/strict";
import { releaseExportRows, exportFileName } from "@/lib/releases/release-export";
import { COVER_IMAGE_SOURCE_DESCRIPTION } from "@/lib/releases/cover-source";

const rows = releaseExportRows([
  {
    id: "r1",
    artistId: "a1",
    category: "SINGLE",
    title: "世界中の誰よりきっと",
    originalReleaseDate: "1992-10-28",
    format: "CD",
    originalCatalogNo: "KIDS-111",
    label: "King Records",
    originalPrice: "971円",
    editionType: "8cmCD",
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    confidence: "HIGH",
    warnings: [],
    notes: "Artist credit: 中山美穂 & WANDS",
    coverImageUrl: null,
    sources: [
      { id: "s1", url: "https://tower.example/release", label: null, description: null },
      { id: "s2", url: "https://label.example/release", label: null, description: null },
      {
        id: "cover-source",
        url: "https://music.apple.com/jp/album/example/1",
        label: "Apple Music",
        description: COVER_IMAGE_SOURCE_DESCRIPTION,
      },
    ],
    userStatus: { id: "u1", status: "OWNED", priority: 1, ownedCondition: "VG+", ownedNotes: "obi", notes: null },
  },
  {
    id: "r2",
    artistId: "a1",
    category: "SINGLE",
    title: "No status",
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
    warnings: [],
    notes: null,
    coverImageUrl: null,
    sources: [],
    userStatus: null,
  },
]);

assert.equal(rows[0]["收藏状态"], "OWNED");
assert.equal(rows[0]["原版品番"], "KIDS-111");
assert.equal(rows[0]["来源 URL"], "https://tower.example/release\nhttps://label.example/release");
assert.equal(rows[0]["封面来源 URL"], "https://music.apple.com/jp/album/example/1");
assert.equal(rows[0]["拥有状态备注"], "obi");
assert.equal(rows[1]["收藏状态"], "NOT_OWNED");
assert.equal(exportFileName("A/B", new Date("2026-06-08T00:00:00.000Z")), "CD-BOX_A_B_20260608.xlsx");

console.log("Release export test passed.");
