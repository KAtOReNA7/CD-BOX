import assert from "node:assert/strict";
import test from "node:test";
import type { ReleaseResearchCandidate } from "@/lib/ai/release-research-types";
import {
  buildVerifiedReleaseUpdate,
  buildVerifiedSourceRows,
  collectionStatusAfterVerification,
  normalizeCatalogNumber,
  normalizeReleaseDate,
  normalizeReleaseTitle,
  planVerifiedLibraryBackfill,
  type ExistingReleaseForBackfill,
} from "../scripts/backfill-verified-library";

const groupId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";

function candidate(
  overrides: Partial<ReleaseResearchCandidate> = {},
): ReleaseResearchCandidate {
  const value: ReleaseResearchCandidate = {
    id: "release-group-1",
    title: "CATCH THE NITE",
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "中山美穂",
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
    format: "CD",
    catalogNumber: "K32X 240",
    barcode: null,
    label: "King Records",
    originalPrice: null,
    editionType: null,
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    coverImageUrl: `https://coverartarchive.org/release/${releaseId}/front-500`,
    coverImageSourceUrl: `https://coverartarchive.org/release/${releaseId}`,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: [
      {
        title: "MusicBrainz release group",
        url: `https://musicbrainz.org/release-group/${groupId}`,
        sourceType: "database",
      },
      {
        title: "MusicBrainz release",
        url: `https://musicbrainz.org/release/${releaseId}`,
        sourceType: "database",
      },
      {
        title: "National Diet Library bibliographic record",
        url: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
        sourceType: "official",
      },
      {
        title: "Discogs release",
        url: "https://www.discogs.com/release/1",
        sourceType: "database",
      },
    ],
    verification: {
      status: "VERIFIED",
      method: "musicbrainz-ndl-discogs-ai",
      aiDecision: "ACCEPT",
      aiReason: "The independent identifiers agree.",
      checkedAt: "2026-07-11T09:30:00.000Z",
      matchedFields: ["title", "year", "artist", "catalogNumber"],
      sourceUrls: [
        `https://musicbrainz.org/release-group/${groupId}`,
        `https://musicbrainz.org/release/${releaseId}`,
        "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
        "https://www.discogs.com/release/1",
      ],
      coverProvider: "cover-art-archive",
      coverCheckedAt: "2026-07-11T09:29:00.000Z",
    },
  };
  return { ...value, ...overrides };
}

function release(
  overrides: Partial<ExistingReleaseForBackfill> = {},
): ExistingReleaseForBackfill {
  return {
    id: "existing-1",
    title: "Catch the Nite",
    originalCatalogNo: "K32X-240",
    originalReleaseDate: new Date("1988-02-10T00:00:00.000Z"),
    coverImageUrl: null,
    ...overrides,
  };
}

test("normalizes catalog numbers, titles, and complete real dates", () => {
  assert.equal(normalizeCatalogNumber("Ｋ３２Ｘ－２４０"), "K32X240");
  assert.equal(normalizeReleaseTitle(" Catch-the Nite！ "), "catchthenite");
  assert.equal(normalizeReleaseDate("1988-02-10"), "1988-02-10");
  assert.equal(normalizeReleaseDate("1988-02-31"), "");
  assert.equal(normalizeReleaseDate("1988-02"), "");
});

test("prefers a unique normalized catalog-number match over title and date", () => {
  const byCatalog = candidate({
    id: "catalog-candidate",
    title: "Authoritative corrected title",
    catalogNumber: "K32X 240",
  });
  const byTitle = candidate({
    id: "title-candidate",
    catalogNumber: "K32X 999",
  });

  const plan = planVerifiedLibraryBackfill([release()], [byTitle, byCatalog]);
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0]?.candidate.id, "catalog-candidate");
  assert.equal(plan.matches[0]?.matchedBy, "catalog-number");
});

test("falls back to a unique normalized title and date when catalog evidence is ambiguous", () => {
  const exactTitle = candidate({ id: "exact-title" });
  const otherTitle = candidate({
    id: "other-title",
    title: "Different album",
    catalogNumber: "K32X-240",
  });

  const plan = planVerifiedLibraryBackfill([release()], [exactTitle, otherTitle]);
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0]?.candidate.id, "exact-title");
  assert.equal(plan.matches[0]?.matchedBy, "title-and-date");
});

test("matches an English legacy title through the preserved MusicBrainz title alias", () => {
  const localized = candidate({
    title: "\u30ad\u30e3\u30c3\u30c1\u30fb\u30b6\u30fb\u30ca\u30a4\u30c8",
    titleOriginal: "CATCH THE NITE",
  });
  const plan = planVerifiedLibraryBackfill([
    release({ originalCatalogNo: null }),
  ], [localized]);

  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0]?.matchedBy, "title-and-date");
  assert.equal(plan.matches[0]?.candidate.title, "\u30ad\u30e3\u30c3\u30c1\u30fb\u30b6\u30fb\u30ca\u30a4\u30c8");
});

test("does not assign one verified candidate to duplicate existing releases", () => {
  const plan = planVerifiedLibraryBackfill([
    release({ id: "existing-a" }),
    release({ id: "existing-b" }),
  ], [candidate()]);

  assert.equal(plan.matches.length, 0);
  assert.deepEqual(plan.unmatchedReleaseIds.sort(), ["existing-a", "existing-b"]);
});

test("skips and reports a non-empty existing cover that differs", () => {
  const plan = planVerifiedLibraryBackfill([
    release({ coverImageUrl: "https://images.example/existing.jpg" }),
  ], [candidate()]);

  assert.equal(plan.matches.length, 0);
  assert.equal(plan.coverConflicts.length, 1);
  assert.equal(plan.coverConflicts[0]?.existingCoverImageUrl, "https://images.example/existing.jpg");
  assert.equal(plan.unmatchedReleaseIds.length, 0);
});

test("ignores candidates that fail verification or the cover hard gate", () => {
  const withoutCover = candidate({ coverImageUrl: null });
  const unverified = candidate({
    id: "unverified",
    verification: null,
  });
  const plan = planVerifiedLibraryBackfill([release()], [withoutCover, unverified]);

  assert.equal(plan.eligibleCandidateCount, 0);
  assert.equal(plan.matches.length, 0);
  assert.deepEqual(plan.unmatchedReleaseIds, ["existing-1"]);
});

test("rejects Apple artwork or a cover host that does not match the attested provider", () => {
  const appleMasqueradingAsDiscogs = candidate({
    id: "apple-cover",
    coverImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/Music/example/1000x1000bb.jpg",
    coverImageSourceUrl: "https://www.discogs.com/release/1",
    verification: {
      ...candidate().verification!,
      coverProvider: "discogs",
    },
  });
  const discogsAssetMasqueradingAsCaa = candidate({
    id: "provider-mismatch",
    coverImageUrl: "https://i.discogs.com/cover.jpeg",
  });

  const plan = planVerifiedLibraryBackfill(
    [release()],
    [appleMasqueradingAsDiscogs, discogsAssetMasqueradingAsCaa],
  );
  assert.equal(plan.eligibleCandidateCount, 0);
  assert.equal(plan.matches.length, 0);
});

test("builds verified metadata without touching notes or overwriting a non-empty cover", () => {
  const current = {
    ...release({ coverImageUrl: `https://coverartarchive.org/release/${releaseId}/front-500` }),
    category: "OTHER" as const,
    format: "CD" as const,
    label: "Existing label",
    originalPrice: "3,200 yen",
    editionType: "Existing edition note",
    isReissue: true,
    isRemaster: true,
  };
  const update = buildVerifiedReleaseUpdate(current, candidate());

  assert.equal(update.verificationStatus, "VERIFIED");
  assert.equal(update.title, "CATCH THE NITE");
  assert.equal(update.label, "King Records");
  assert.equal(update.isReissue, false);
  assert.equal("notes" in update, false);
  assert.equal("coverImageUrl" in update, false);
  assert.equal("originalPrice" in update, false);
  assert.equal("editionType" in update, false);
});

test("deduplicates verified metadata, audit, and cover source rows", () => {
  const rows = buildVerifiedSourceRows(candidate());
  assert.deepEqual(rows.map((row) => row.url), [
    `https://musicbrainz.org/release-group/${groupId}`,
    `https://musicbrainz.org/release/${releaseId}`,
    "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
    "https://www.discogs.com/release/1",
    `https://coverartarchive.org/release/${releaseId}`,
  ]);
  assert.equal(rows.at(-1)?.description, "cover-image-source");
});

test("preserves separate evidence and cover roles when Discogs supplies both", () => {
  const rows = buildVerifiedSourceRows(candidate({
    coverImageUrl: "https://i.discogs.com/cover.jpeg",
    coverImageSourceUrl: "https://www.discogs.com/release/1",
    verification: {
      ...candidate().verification!,
      coverProvider: "discogs",
    },
  }));
  const discogsRows = rows.filter((row) => row.url === "https://www.discogs.com/release/1");
  assert.equal(discogsRows.length, 2);
  assert.deepEqual(new Set(discogsRows.map((row) => row.description)), new Set([
    "Verified database source",
    "cover-image-source",
  ]));
});

test("only converts pending review while preserving owned and wanted states", () => {
  assert.equal(collectionStatusAfterVerification("PENDING_REVIEW"), "NOT_OWNED");
  assert.equal(collectionStatusAfterVerification("OWNED"), "OWNED");
  assert.equal(collectionStatusAfterVerification("WANTED"), "WANTED");
  assert.equal(collectionStatusAfterVerification("EXCLUDED"), "EXCLUDED");
});
