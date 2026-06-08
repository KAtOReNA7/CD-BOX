import assert from "node:assert/strict";
import { parseBulkUpdateInput } from "@/lib/releases/release-service";

assert.deepEqual(parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], status: "OWNED" }), {
  artistId: "a1",
  releaseIds: ["r1"],
  status: "OWNED",
});

assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: [] }), /releaseIds/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], status: "BAD" }), /Invalid collection status/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"], priority: 9 }), /priority/);
assert.throws(() => parseBulkUpdateInput({ artistId: "a1", releaseIds: ["r1"] }), /No bulk update/);

console.log("Release bulk validation test passed.");
