import assert from "node:assert/strict";
import {
  normalizeStatus,
  parseBulkUpdateInput,
  parseReleasePatchInput,
  parseStatusPatchInput,
} from "@/lib/releases/release-validation";

assert.deepEqual(parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], status: "OWNED" }), {
  artistId: "a1",
  releaseIds: ["r1"],
  status: "OWNED",
});

assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: [] }), /releaseIds/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], status: "BAD" }), /Invalid collection status/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], priority: 9 }), /priority/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"] }), /No bulk update/);

assert.equal(normalizeStatus("WANT"), "WANTED");
assert.equal(normalizeStatus("SKIP"), "NOT_OWNED");
assert.equal(normalizeStatus("UNKNOWN"), "NOT_OWNED");
assert.equal(normalizeStatus("ORDERED"), "WANTED");
assert.deepEqual(parseStatusPatchInput({ status: "WANT", priority: 5 }), { status: "WANTED", priority: 5 });
assert.throws(() => parseStatusPatchInput({ priority: 0 }), /priority/);
assert.throws(() => parseStatusPatchInput({ priority: 6 }), /priority/);
assert.throws(() => parseReleasePatchInput({ releaseDate: "2025-02-30" }), /releaseDate/);
assert.equal(
  parseReleasePatchInput({ coverImageUrl: "https://example.com/cover.jpg" }).coverImageUrl,
  "https://example.com/cover.jpg",
);
assert.throws(() => parseReleasePatchInput({ coverImageUrl: "javascript:alert(1)" }), /HTTP or HTTPS/);

console.log("Release bulk validation test passed.");
