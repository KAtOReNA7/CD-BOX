import assert from "node:assert/strict";
import { parseReleaseResearchResponse } from "@/lib/ai/release-research-parser";

const baseJson = {
  artist: {
    name: "中山美穂",
    nameKana: null,
    nameRomaji: "Miho Nakayama",
    country: "Japan",
    officialSiteUrl: "https://example.com/official",
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
      artistCredit: "中山美穂",
      releaseDate: "1985-09-05",
      originalReleaseDate: "1985-09-05",
      format: "CD",
      catalogNumber: "K32X-30",
      barcode: null,
      label: "King Records",
      originalPrice: null,
      editionType: "original",
      isReissue: false,
      isRemaster: false,
      isExcludedByDefault: false,
      coverImageUrl: null,
      coverImageSourceUrl: null,
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [
        {
          title: "Official",
          url: "https://example.com/c",
          sourceType: "official",
        },
      ],
    },
  ],
  globalWarnings: [],
};

const normal = parseReleaseResearchResponse(JSON.stringify(baseJson));
assert.equal(normal.artist.name, "中山美穂");
assert.equal(normal.releases[0].id, "candidate-1");
assert.equal(normal.releases[0].catalogNumber, "K32X-30");

const codeBlock = parseReleaseResearchResponse(`\`\`\`json\n${JSON.stringify(baseJson)}\n\`\`\``);
assert.equal(codeBlock.releases[0].confidence, "HIGH");

const wrapped = parseReleaseResearchResponse(`Here is the result:\n${JSON.stringify(baseJson)}\nPlease verify.`);
assert.equal(wrapped.releases[0].sources.length, 1);

const missingCatalog = {
  ...structuredClone(baseJson),
  releases: [
    {
      ...structuredClone(baseJson.releases[0]),
      catalogNumber: null,
    },
  ],
};
missingCatalog.releases[0].confidence = "HIGH";
const missingCatalogParsed = parseReleaseResearchResponse(JSON.stringify(missingCatalog));
assert.equal(missingCatalogParsed.releases[0].confidence, "MEDIUM");
assert.ok(missingCatalogParsed.releases[0].warnings.some((warning) => warning.includes("catalogNumber")));

const noSource = structuredClone(baseJson);
noSource.releases[0].sources = [];
const noSourceParsed = parseReleaseResearchResponse(JSON.stringify(noSource));
assert.ok(noSourceParsed.releases[0].warnings.some((warning) => warning.includes("source")));

const reissue = structuredClone(baseJson);
reissue.releases[0].isReissue = true;
reissue.releases[0].isExcludedByDefault = false;
const reissueParsed = parseReleaseResearchResponse(JSON.stringify(reissue));
assert.equal(reissueParsed.releases[0].isExcludedByDefault, true);

console.log("Release research parser test passed.");
