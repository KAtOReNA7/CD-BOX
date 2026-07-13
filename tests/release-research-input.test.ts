import assert from "node:assert/strict";
import {
  parseReleaseResearchImportInput,
  parseReleaseResearchRequest,
} from "@/lib/ai/release-research-input";
import { DEFAULT_RELEASE_RESEARCH_SCOPE } from "@/lib/ai/release-research-types";

assert.deepEqual(DEFAULT_RELEASE_RESEARCH_SCOPE, {
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: false,
});

const request = parseReleaseResearchRequest({
  artistName: "  Miho Nakayama  ",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
});
assert.equal(request.artistName, "Miho Nakayama");

assert.throws(() => parseReleaseResearchRequest({ ...request, unexpected: true }));
assert.throws(() => parseReleaseResearchRequest({ ...request, artistName: "" }));

const importInput = parseReleaseResearchImportInput({
  artistMode: "create",
  artistName: "Miho Nakayama",
  selectedCandidateIds: ["candidate-1"],
  excludedCandidateIds: [],
  pendingReviewCandidateIds: ["candidate-1"],
  candidateEdits: {
    "candidate-1": {
      title: "C",
      category: "ORIGINAL_ALBUM",
      artistCredit: "Miho Nakayama",
      originalReleaseDate: "1985-09-05",
      format: "CD",
      catalogNumber: "K32X-30",
      label: "King Records",
      coverImageUrl: "https://example.com/cover.jpg",
      isReissue: false,
      isRemaster: false,
      notes: null,
    },
  },
});
assert.equal(importInput.candidateEdits["candidate-1"].catalogNumber, "K32X-30");

const legacyImportInput = parseReleaseResearchImportInput({
  ...importInput,
  excludedCandidateIds: ["candidate-2", "candidate-1", "candidate-1"],
  pendingReviewCandidateIds: ["candidate-2", "candidate-1", "candidate-1"],
});
assert.deepEqual(legacyImportInput.excludedCandidateIds, ["candidate-1"]);
assert.deepEqual(legacyImportInput.pendingReviewCandidateIds, ["candidate-1"]);

assert.throws(() =>
  parseReleaseResearchImportInput({
    ...importInput,
    excludedCandidateIds: [""],
  }),
);

assert.throws(() =>
  parseReleaseResearchImportInput({
    ...importInput,
    candidateEdits: {
      ...importInput.candidateEdits,
      "candidate-2": importInput.candidateEdits["candidate-1"],
    },
  }),
);
assert.throws(() =>
  parseReleaseResearchImportInput({
    ...importInput,
    candidateEdits: {
      "candidate-1": {
        ...importInput.candidateEdits["candidate-1"],
        originalReleaseDate: "2025-02-30",
      },
    },
  }),
);
assert.throws(() =>
  parseReleaseResearchImportInput({
    ...importInput,
    candidateEdits: {
      "candidate-1": {
        ...importInput.candidateEdits["candidate-1"],
        coverImageUrl: "javascript:alert(1)",
      },
    },
  }),
);

console.log("Release research input validation test passed.");
