import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseReleaseStructureResponse } from "@/lib/ai/release-structure-parser";
import type { ReleaseStructureRequest } from "@/lib/ai/release-structure-types";

const fixturesDir = path.resolve("sample-data", "pasted-sources");

function request(sourceText: string, sourceUrl: string | null): ReleaseStructureRequest {
  return {
    artistName: "中山美穂",
    country: "Japan",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest: true,
    sourceText,
    sourceUrl,
    defaultCoverSourceUrl: null,
  };
}

function payload(releases: Array<Record<string, unknown>>) {
  return JSON.stringify({
    artist: {
      name: "中山美穂",
      nameKana: null,
      nameRomaji: "Miho Nakayama",
      country: "Japan",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases: releases.map((release) => ({
      title: "Sample",
      titleOriginal: null,
      category: "ORIGINAL_ALBUM",
      artistCredit: "中山美穂",
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
      coverImageUrl: "https://fake.example.com/cover.jpg",
      coverImageSourceUrl: null,
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [],
      ...release,
    })),
    globalWarnings: [],
  });
}

const kingText = fs.readFileSync(path.join(fixturesDir, "king-records-miho-album.txt"), "utf8");
const king = parseReleaseStructureResponse(
  payload([{ title: "C" }, { title: "AFTER SCHOOL", catalogNumber: "K32X-77" }]),
  request(kingText, "https://www.kingrecords.co.jp/cs/artist/artist.aspx?artist=32450"),
);
assert.equal(king.releases.length, 2);
assert.equal(king.releases[0].sources.length, 1);
assert.equal(king.releases[0].confidence, "HIGH");
assert.equal(king.releases[0].coverImageUrl, null);

const noSource = parseReleaseStructureResponse(payload([{ title: "No Source" }]), request("発売日 1985-09-05 品番 K32X-30", null));
assert.equal(noSource.releases[0].confidence, "LOW");
assert.ok(noSource.releases[0].warnings.some((warning) => warning.includes("no explicit source url")));

const collectionText = fs.readFileSync(path.join(fixturesDir, "cdjournal-miho-collection.txt"), "utf8");
const collection = parseReleaseStructureResponse(
  payload([
    { title: "COLLECTION", category: "COLLECTION", notes: "廃盤" },
    { title: "COLLECTION 2015 復刻", category: "COLLECTION", isReissue: true, notes: "再発 復刻 リマスター" },
    { title: "COLLECTION LP", category: "COLLECTION", format: "LP レコード", catalogNumber: "K28A-800" },
  ]),
  request(collectionText, "https://artist.cdjournal.com/a/nakayama-miho/120195"),
);
assert.equal(collection.releases[0].category, "COLLECTION");
assert.equal(collection.releases[0].isExcludedByDefault, false);
assert.equal(collection.releases[0].confidence, "HIGH");
assert.equal(collection.releases[1].isExcludedByDefault, true);
assert.equal(collection.releases[1].confidence, "MEDIUM");
assert.equal(collection.releases[2].isExcludedByDefault, true);
assert.equal(collection.releases[2].confidence, "MEDIUM");
assert.equal(collection.releases[0].coverImageUrl, null);

const towerText = fs.readFileSync(path.join(fixturesDir, "tower-miho-single.txt"), "utf8");
const collaboration = parseReleaseStructureResponse(
  payload([
    {
      title: "世界中の誰よりきっと",
      category: "SINGLE",
      artistCredit: "中山美穂 & WANDS",
      catalogNumber: "KIDS-111",
    },
  ]),
  request(towerText, "https://tower.jp/artist/281023/%E4%B8%AD%E5%B1%B1%E7%BE%8E%E7%A9%82"),
);
assert.equal(collaboration.releases[0].artistCredit, "中山美穂 & WANDS");
assert.equal(collaboration.releases[0].confidence, "HIGH");

console.log("Release structure real fixture test passed.");
