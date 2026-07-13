import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { buildReleaseResearchTaskView } from "@/lib/ai/release-research";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";

const groupId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const ndlUrl = "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764";
const discogsUrl = "https://www.discogs.com/release/123";

function verifiedCandidate(id: string, excluded = false): ReleaseResearchCandidate {
  const sourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    ndlUrl,
    discogsUrl,
  ];
  const checkedAt = new Date().toISOString();
  return {
    id,
    title: "CATCH THE NITE",
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "Miho Nakayama",
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
    format: "CD",
    catalogNumber: "K32X-240",
    barcode: "4988003002400",
    label: "King Records",
    originalPrice: null,
    editionType: "Earliest verified Japanese CD edition",
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: excluded,
    coverImageUrl: "https://i.discogs.com/signed/cover.jpg",
    coverImageSourceUrl: discogsUrl,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: sourceUrls.map((url) => ({
      title: url,
      url,
      sourceType: "database" as const,
    })),
    verification: {
      status: "VERIFIED",
      method: "musicbrainz-ndl-discogs-ai",
      aiDecision: "ACCEPT",
      aiReason: "All supplied evidence agrees.",
      checkedAt,
      matchedFields: ["artist", "title", "catalogNumber", "date"],
      sourceUrls,
      coverProvider: "discogs",
      coverCheckedAt: checkedAt,
    },
  };
}

test("task view preserves stage audit DTOs and exposes only server-trusted final ids", () => {
  const parsed: ReleaseResearchResult = {
    artist: {
      name: "中山美穂",
      nameKana: "なかやま みほ",
      nameRomaji: "Miho Nakayama",
      country: "JP",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: false,
    },
    releases: [verifiedCandidate("trusted"), verifiedCandidate("excluded", true)],
    globalWarnings: ["One provider was temporarily unavailable."],
    verificationSummary: null,
  };
  const startedAt = new Date("2026-07-13T00:00:00.000Z");
  const completedAt = new Date("2026-07-13T00:00:01.000Z");
  const view = buildReleaseResearchTaskView({
    id: "task-1",
    status: "SUCCEEDED",
    progress: 100,
    stage: "候选资料已准备完成",
    query: "{}",
    model: "gpt-5.5",
    errorMessage: null,
    rawResult: null,
    parsedResult: parsed as unknown as Prisma.JsonValue,
    createdAt: startedAt,
    updatedAt: completedAt,
    stageSummaries: [{
      stage: "AUTHORITATIVE",
      sequence: 103,
      inputCount: 12,
      passedCount: 8,
      deferredCount: 3,
      rejectedCount: 1,
      mergedCount: 2,
      retryCount: 1,
      reasonCounts: {
        MISSING_INDEPENDENT_CORROBORATION: 3,
        NDL_CONTROLLED_EDITION_MATCH: 8,
      },
      detailsComplete: false,
      startedAt,
      completedAt,
    }],
  });

  assert.deepEqual(view.trustedFinalCandidateIds, ["trusted"]);
  assert.deepEqual(view.stageSummaries, [{
    stage: "AUTHORITATIVE",
    sequence: 103,
    inputCount: 12,
    passedCount: 8,
    deferredCount: 3,
    rejectedCount: 1,
    mergedCount: 2,
    retryCount: 1,
    reasonCounts: {
      MISSING_INDEPENDENT_CORROBORATION: 3,
      NDL_CONTROLLED_EDITION_MATCH: 8,
    },
    detailsComplete: false,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
  }]);
});
