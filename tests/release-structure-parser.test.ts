import assert from "node:assert/strict";
import { parseReleaseStructureResponse } from "@/lib/ai/release-structure-parser";
import type { ReleaseStructureRequest } from "@/lib/ai/release-structure-types";

const baseRequest: ReleaseStructureRequest = {
  artistName: "Miho Nakayama",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
  sourceText:
    "Official page https://example.com/discography\n発売日 1985-09-05 品番 K32X-30 CD レーベル King Records",
  sourceUrl: null,
  defaultCoverSourceUrl: null,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    artist: {
      name: "Miho Nakayama",
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
    releases: [
      {
        title: "C",
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
        coverImageUrl: "https://invented.example.com/fake-cover.jpg",
        coverImageSourceUrl: null,
        notes: null,
        confidence: "HIGH",
        warnings: [],
        sources: [],
        ...overrides,
      },
    ],
    globalWarnings: [],
    mode: "PASTED_SOURCE_STRUCTURING",
    sourceTextSummary: "sample",
    sourceLimitations: [],
  };
}

const official = parseReleaseStructureResponse(JSON.stringify(payload()), baseRequest);
assert.equal(official.mode, "PASTED_SOURCE_STRUCTURING");
assert.equal(official.releases[0].sources[0].url, "https://example.com/discography");
assert.equal(official.releases[0].coverImageUrl, null);
assert.equal(official.releases[0].confidence, "HIGH");

const tableText = `title,catalog,releaseDate,format,url
Sample Single,K10X-1,1985/10/01,8cmCD,https://example.com/table`;
const table = parseReleaseStructureResponse(
  JSON.stringify(payload({ title: "Sample Single", category: "SINGLE", catalogNumber: "K10X-1", format: "8cmCD" })),
  { ...baseRequest, sourceText: tableText },
);
assert.equal(table.releases[0].sources[0].url, "https://example.com/table");

const providedSource = parseReleaseStructureResponse(
  JSON.stringify(payload()),
  { ...baseRequest, sourceText: "No URL here", sourceUrl: "https://example.com/manual-source" },
);
assert.equal(providedSource.releases[0].sources[0].url, "https://example.com/manual-source");

const noSource = parseReleaseStructureResponse(
  JSON.stringify(payload()),
  { ...baseRequest, sourceText: "No URL here", sourceUrl: null },
);
assert.equal(noSource.releases[0].sources.length, 0);
assert.equal(noSource.releases[0].confidence, "LOW");
assert.ok(noSource.releases[0].warnings.some((warning) => warning.includes("no explicit source url")));

const noCatalog = parseReleaseStructureResponse(
  JSON.stringify(payload({ catalogNumber: null })),
  { ...baseRequest, sourceUrl: "https://example.com/source" },
);
assert.equal(noCatalog.releases[0].confidence, "MEDIUM");
assert.ok(noCatalog.releases[0].warnings.some((warning) => warning.includes("catalogNumber")));

const missingDate = parseReleaseStructureResponse(
  JSON.stringify(payload({ releaseDate: null, originalReleaseDate: null })),
  { ...baseRequest, sourceUrl: "https://example.com/source" },
);
assert.equal(missingDate.releases[0].confidence, "MEDIUM");

const reissue = parseReleaseStructureResponse(
  JSON.stringify(payload({ isReissue: true, editionType: "reissue remaster" })),
  baseRequest,
);
assert.equal(reissue.releases[0].isExcludedByDefault, true);
assert.equal(reissue.releases[0].confidence, "MEDIUM");

const vinyl = parseReleaseStructureResponse(
  JSON.stringify(payload({ format: "LP Vinyl" })),
  baseRequest,
);
assert.equal(vinyl.releases[0].isExcludedByDefault, true);
assert.equal(vinyl.releases[0].confidence, "MEDIUM");

const highNoSource = parseReleaseStructureResponse(
  JSON.stringify(payload({ confidence: "HIGH" })),
  { ...baseRequest, sourceText: "No source URL", sourceUrl: null },
);
assert.equal(highNoSource.releases[0].confidence, "LOW");

console.log("Release structure parser test passed.");
