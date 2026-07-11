import assert from "node:assert/strict";
import {
  COVER_IMAGE_SOURCE_DESCRIPTION,
  buildImportedReleaseSourceRows,
  findCoverSource,
  findAppleCoverSource,
  isAppleMusicSourceUrl,
  releaseEvidenceSources,
} from "@/lib/releases/cover-source";

assert.equal(isAppleMusicSourceUrl("https://music.apple.com/jp/album/example/1"), true);
assert.equal(isAppleMusicSourceUrl("https://music.apple.com.evil.example/album/1"), false);
assert.equal(isAppleMusicSourceUrl("javascript:alert(1)"), false);

const releaseEvidence = {
  url: "https://music.apple.com/jp/album/example/1",
  label: "Apple Music",
  description: "retailer",
};
const coverEvidence = {
  ...releaseEvidence,
  description: COVER_IMAGE_SOURCE_DESCRIPTION,
};

assert.equal(findAppleCoverSource([releaseEvidence]), undefined);
assert.equal(findAppleCoverSource([releaseEvidence, coverEvidence]), coverEvidence);
assert.equal(findCoverSource([releaseEvidence, coverEvidence]), coverEvidence);
assert.deepEqual(releaseEvidenceSources([releaseEvidence, coverEvidence]), [releaseEvidence]);

const importedRows = buildImportedReleaseSourceRows(
  [{
    url: releaseEvidence.url,
    title: "Apple release page",
    sourceType: "retailer",
  }],
  releaseEvidence.url,
);
assert.equal(importedRows.length, 2, "release evidence and cover provenance remain separate roles");
assert.equal(releaseEvidenceSources(importedRows).length, 1);
assert.equal(findAppleCoverSource(importedRows)?.description, COVER_IMAGE_SOURCE_DESCRIPTION);

console.log("Cover source provenance test passed.");
