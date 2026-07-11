import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedVerifiedCandidate } from "@/lib/ai/release-research";
import type { ReleaseResearchCandidate } from "@/lib/ai/release-research-types";

const groupId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const ndlUrl = "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764";
const discogsUrl = "https://www.discogs.com/release/123";

function candidate(overrides: Partial<ReleaseResearchCandidate> = {}): ReleaseResearchCandidate {
  const sourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    ndlUrl,
    discogsUrl,
  ];
  const value: ReleaseResearchCandidate = {
    id: `release-group-${groupId}`,
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
    isExcludedByDefault: false,
    coverImageUrl: "https://i.discogs.com/signed/cover.jpg",
    coverImageSourceUrl: discogsUrl,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: sourceUrls.map((url) => ({ title: url, url, sourceType: "database" as const })),
    verification: {
      status: "VERIFIED",
      method: "musicbrainz-ndl-discogs-ai",
      aiDecision: "ACCEPT",
      aiReason: "Evidence is consistent.",
      checkedAt: new Date().toISOString(),
      matchedFields: ["title", "artist", "catalogNumber", "date"],
      sourceUrls,
      coverProvider: "discogs",
      coverCheckedAt: new Date().toISOString(),
    },
  };
  return { ...value, ...overrides };
}

test("accepts only a fresh provider-bound verified candidate", () => {
  assert.equal(isTrustedVerifiedCandidate(candidate()), true);
});

test("rejects Apple artwork even when a trusted Discogs source URL is attached", () => {
  assert.equal(isTrustedVerifiedCandidate(candidate({
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/1000x1000bb.jpg",
  })), false);
});

test("rejects a cover source or asset that does not match coverProvider", () => {
  assert.equal(isTrustedVerifiedCandidate(candidate({
    coverImageSourceUrl: `https://coverartarchive.org/release/${releaseId}`,
  })), false);
  assert.equal(isTrustedVerifiedCandidate(candidate({
    coverImageUrl: `https://coverartarchive.org/release/${releaseId}/front-500`,
  })), false);
});

test("rejects stale verification and cover checks", () => {
  const stale = "2020-01-01T00:00:00.000Z";
  assert.equal(isTrustedVerifiedCandidate(candidate({
    verification: {
      ...candidate().verification!,
      checkedAt: stale,
      coverCheckedAt: stale,
    },
  })), false);
});
