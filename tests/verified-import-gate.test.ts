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
    workId: groupId,
    editionId: releaseId,
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
      matchedFields: ["title", "artist", "catalogNumber", "date", "format"],
      sourceUrls,
      coverProvider: "discogs",
      coverCheckedAt: new Date().toISOString(),
    },
  };
  return { ...value, ...overrides };
}

function multiSourceCandidate(): ReleaseResearchCandidate {
  const sourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    ndlUrl,
  ];
  return candidate({
    sources: sourceUrls.map((url) => ({ title: url, url, sourceType: "database" as const })),
    verification: {
      status: "VERIFIED",
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      aiDecision: "ACCEPT",
      aiReason: "Evidence is consistent.",
      checkedAt: new Date().toISOString(),
      matchedFields: ["artist", "title", "catalogNumber", "date", "format"],
      sourceUrls,
      authoritySourceUrls: [ndlUrl],
      corroboratingSourceUrls: [`https://musicbrainz.org/release/${releaseId}`],
      workId: groupId,
      editionId: releaseId,
      coverProvider: "apple-music",
      coverCheckedAt: new Date().toISOString(),
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10T00:00:00Z",
    },
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
    coverImageSourceUrl: "https://music.apple.com/jp/album/example/123",
  });
}

test("accepts only a fresh provider-bound verified candidate", () => {
  assert.equal(isTrustedVerifiedCandidate(candidate()), true);
});

test("rejects excluded candidates and any runtime verification status other than VERIFIED", () => {
  assert.equal(isTrustedVerifiedCandidate(candidate({ isExcludedByDefault: true })), false);
  const invalidStatus = candidate();
  invalidStatus.verification = {
    ...invalidStatus.verification!,
    status: "PENDING" as "VERIFIED",
  };
  assert.equal(isTrustedVerifiedCandidate(invalidStatus), false);
});

test("accepts multi-source-v2 with one strong authority, MusicBrainz corroboration, AI, and Apple cover", () => {
  const sourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    ndlUrl,
  ];
  assert.equal(isTrustedVerifiedCandidate(candidate({
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
    coverImageSourceUrl: "https://music.apple.com/jp/album/example/123",
    sources: sourceUrls.map((url) => ({ title: url, url, sourceType: "database" as const })),
    verification: {
      status: "VERIFIED",
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      aiDecision: "ACCEPT",
      aiReason: "Evidence is consistent.",
      checkedAt: new Date().toISOString(),
      matchedFields: ["artist", "title", "catalogNumber", "date", "format"],
      sourceUrls,
      authoritySourceUrls: [ndlUrl],
      corroboratingSourceUrls: [`https://musicbrainz.org/release/${releaseId}`],
      workId: groupId,
      editionId: releaseId,
      coverProvider: "apple-music",
      coverCheckedAt: new Date().toISOString(),
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10T00:00:00Z",
    },
  })), true);
});

test("accepts multi-source-v2 with NDL plus an independent Discogs edition when MusicBrainz is missing", () => {
  const sourceUrls = [ndlUrl, discogsUrl];
  assert.equal(isTrustedVerifiedCandidate(candidate({
    id: "discogs-release-123",
    workId: "discogs-master:456",
    editionId: "discogs:123",
    sources: sourceUrls.map((url) => ({ title: url, url, sourceType: "database" as const })),
    verification: {
      status: "VERIFIED",
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      aiDecision: "ACCEPT",
      aiReason: "The catalog-bound NDL and Discogs edition facts agree.",
      checkedAt: new Date().toISOString(),
      matchedFields: ["artist", "title", "catalogNumber", "date", "format"],
      sourceUrls,
      authoritySourceUrls: [ndlUrl],
      corroboratingSourceUrls: [discogsUrl],
      workId: "discogs-master:456",
      editionId: "discogs:123",
      coverProvider: "discogs",
      coverCheckedAt: new Date().toISOString(),
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10",
    },
  })), true);
});

test("accepts an independently attested fixed official physical entity", () => {
  const officialCarrierUrl = "https://soundfuji.kingrecords.co.jp/release/1603/";
  const value = multiSourceCandidate();
  value.sources = [
    { title: "NDL", url: ndlUrl, sourceType: "database" },
    { title: "King Records physical edition", url: officialCarrierUrl, sourceType: "official" },
  ];
  value.verification = {
    ...value.verification!,
    sourceUrls: [ndlUrl, officialCarrierUrl],
    authoritySourceUrls: [ndlUrl],
    corroboratingSourceUrls: [officialCarrierUrl],
  };
  assert.equal(isTrustedVerifiedCandidate(value), true);
});

test("multi-source-v2 rejects missing authority attestation", () => {
  const value = candidate();
  assert.equal(isTrustedVerifiedCandidate({
    ...value,
    verification: {
      ...value.verification!,
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      authoritySourceUrls: [],
      corroboratingSourceUrls: [`https://musicbrainz.org/release/${releaseId}`],
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10",
    },
  }), false);
});

test("multi-source-v2 rejects incomplete physical identities before import normalization", () => {
  const cases: Array<[string, (value: ReleaseResearchCandidate) => void]> = [
    ["missing format", (value) => { value.format = null; }],
    ["non-CD format", (value) => { value.format = "Vinyl"; }],
    ["missing catalog", (value) => { value.catalogNumber = null; }],
    ["partial edition date", (value) => { value.releaseDate = "1988"; }],
    ["partial work date", (value) => { value.originalReleaseDate = "1988-02"; }],
    ["missing work id", (value) => { value.workId = undefined; }],
    ["missing edition id", (value) => { value.editionId = undefined; }],
    ["unattested format", (value) => {
      value.verification!.matchedFields = value.verification!.matchedFields
        .filter((field) => field !== "format");
    }],
  ];
  for (const [label, mutate] of cases) {
    const value = multiSourceCandidate();
    mutate(value);
    assert.equal(isTrustedVerifiedCandidate(value), false, label);
  }
});

test("a release-group ledger cannot borrow an unrelated release URL from candidate sources", () => {
  const value = multiSourceCandidate();
  value.verification!.corroboratingSourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
  ];
  assert.equal(isTrustedVerifiedCandidate(value), false);
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

test("accepts a structurally valid later WORK cover but rejects invalid or earlier dates", () => {
  const sourceUrls = [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    ndlUrl,
  ];
  const workCover = candidate({
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
    coverImageSourceUrl: "https://music.apple.com/jp/album/example/123",
    sources: sourceUrls.map((url) => ({ title: url, url, sourceType: "database" as const })),
    verification: {
      status: "VERIFIED",
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      aiDecision: "ACCEPT",
      aiReason: "Evidence is consistent.",
      checkedAt: new Date().toISOString(),
      matchedFields: ["artist", "title", "catalogNumber", "date", "format"],
      sourceUrls,
      authoritySourceUrls: [ndlUrl],
      corroboratingSourceUrls: [`https://musicbrainz.org/release/${releaseId}`],
      workId: groupId,
      editionId: releaseId,
      coverProvider: "apple-music",
      coverCheckedAt: new Date().toISOString(),
      coverMatchLevel: "WORK",
      sourceReleaseDate: "2015-09-16T00:00:00Z",
    },
  });
  assert.equal(isTrustedVerifiedCandidate(workCover), true);
  const officialWorkCoverSource = "https://soundfuji.kingrecords.co.jp/release/1603/";
  const officialWorkCover = candidate({
    ...workCover,
    coverImageUrl: "https://soundfuji.kingrecords.co.jp/shared/img/2024/06/NOPA-2409.jpg",
    coverImageSourceUrl: officialWorkCoverSource,
    sources: [
      ...sourceUrls.slice(0, 2).map((url) => ({
        title: url,
        url,
        sourceType: "database" as const,
      })),
      { title: "King Records archive", url: officialWorkCoverSource, sourceType: "official" },
    ],
    verification: {
      ...workCover.verification!,
      sourceUrls: [...sourceUrls.slice(0, 2), officialWorkCoverSource],
      authoritySourceUrls: [officialWorkCoverSource],
      corroboratingSourceUrls: [sourceUrls[1]!],
      coverProvider: "official-label",
      coverMatchLevel: "WORK",
      sourceReleaseDate: workCover.originalReleaseDate,
    },
  });
  assert.equal(
    isTrustedVerifiedCandidate(officialWorkCover),
    true,
    "an exact official-label work page may attest its own archived artwork",
  );
  assert.equal(isTrustedVerifiedCandidate({
    ...workCover,
    verification: {
      ...workCover.verification!,
      sourceReleaseDate: "1980-01-01T00:00:00Z",
    },
  }), false, "a work cover cannot predate the work");
  assert.equal(isTrustedVerifiedCandidate({
    ...workCover,
    originalReleaseDate: "not-a-date",
  }), false, "the work date must be structurally valid");
  assert.equal(isTrustedVerifiedCandidate({
    ...workCover,
    verification: {
      ...workCover.verification!,
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "2015-09-16T00:00:00Z",
    },
  }), false, "a later digital issue cannot be relabeled as an edition match");
});
