import assert from "node:assert/strict";
import {
  addCandidateIds,
  intersectCandidateIds,
  removeCandidateIds,
  toggleCandidateId,
} from "@/lib/ai/release-research-selection";

const selected = new Set(["hidden-selected", "visible-a"]);
const visible = ["visible-a", "visible-b"];

assert.deepEqual([...addCandidateIds(selected, visible)], ["hidden-selected", "visible-a", "visible-b"]);
assert.deepEqual([...removeCandidateIds(selected, visible)], ["hidden-selected"]);
assert.deepEqual(intersectCandidateIds(["pending-unselected", "visible-a", "visible-a"], selected), [
  "visible-a",
]);
assert.deepEqual([...toggleCandidateId(selected, "visible-a")], ["hidden-selected"]);
assert.deepEqual([...toggleCandidateId(selected, "visible-b")], ["hidden-selected", "visible-a", "visible-b"]);

console.log("Release research selection test passed.");
