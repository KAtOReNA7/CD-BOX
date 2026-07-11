import assert from "node:assert/strict";
import test from "node:test";
import { auditReleaseEvidenceWithAi, type ReleaseCrossSourceEvidence } from "@/lib/ai/release-evidence-audit";

function evidence(matchedFields = ["catalogNumber", "title", "year", "artist"]): ReleaseCrossSourceEvidence {
  return {
    candidate: {
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
      coverImageUrl: "https://coverartarchive.org/release-group/00000000-0000-4000-8000-000000000001/front-500",
      coverImageSourceUrl: "https://coverartarchive.org/release-group/00000000-0000-4000-8000-000000000001",
      notes: null,
      confidence: "HIGH",
      warnings: [],
      sources: [
        { title: "MusicBrainz", url: "https://musicbrainz.org/release-group/1", sourceType: "database" },
        { title: "Discogs", url: "https://www.discogs.com/release/1", sourceType: "database" },
      ],
      verification: null,
    },
    musicBrainz: {
      releaseGroupUrl: "https://musicbrainz.org/release-group/1",
      releaseUrl: "https://musicbrainz.org/release/1",
    },
    nationalBibliography: {
      sourceType: "national-bibliography",
      provider: "ndl-search",
      recordId: "R100000002-I000008888764",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
      observedTitle: "中山美穂/CATCH THE NITE",
      authoritativeTitle: "CATCH THE NITE",
      observedCatalogNumber: "K32X-240",
      observedIssued: "1988-02",
      observedIssuedPrecision: "month",
      publishers: ["キング"],
      matchedFields: ["artist", "catalogNumber", "title", "date"],
      titleComparison: "controlled-equivalent",
    },
    discogs: {
      releaseUrl: "https://www.discogs.com/release/1",
      title: "CATCH THE NITE",
      artistName: "Miho Nakayama",
      year: 1988,
      released: "1988-02-10",
      country: "Japan",
      catalogNumber: "K32X 240",
      barcode: null,
      formats: ["CD"],
    },
    matchedFields,
  };
}

test("accepts a complete conservative AI decision", async () => {
  const result = await auditReleaseEvidenceWithAi([evidence()], undefined, {
    createResponse: async () => ({
      output_text: JSON.stringify({ decisions: [{
        id: "release-group-1",
        decision: "ACCEPT",
        reasonCode: "EVIDENCE_CONSISTENT",
        reason: "The identifiers and edition fields agree.",
      }] }),
    }) as never,
  });
  assert.equal(result[0]?.decision, "ACCEPT");
});

test("allows AI to resolve a catalog-bound title written in another script", async () => {
  const item = evidence();
  item.nationalBibliography.observedTitle = "中山美穂/キャッチ・ザ・ナイト";
  item.nationalBibliography.matchedFields = ["artist", "catalogNumber", "date"];
  item.nationalBibliography.titleComparison = "requires-ai";
  item.candidate.barcode = "4988003002400";
  item.discogs.barcode = "4988003002400";
  item.matchedFields = ["catalogNumber", "title", "year", "artist", "barcode", "date"];
  const result = await auditReleaseEvidenceWithAi([item], undefined, {
    createResponse: async () => ({
      output_text: JSON.stringify({ decisions: [{
        id: "release-group-1",
        decision: "ACCEPT",
        reasonCode: "TITLE_TRANSLITERATION_EQUIVALENT",
        reason: "The catalog-bound Japanese and romanized titles are equivalent.",
      }] }),
    }) as never,
  });
  assert.equal(result[0]?.decision, "ACCEPT");
});

test("refuses AI acceptance without deterministic strong evidence", async () => {
  await assert.rejects(
    auditReleaseEvidenceWithAi([evidence(["title", "year"])], undefined, {
      createResponse: async () => ({
        output_text: JSON.stringify({ decisions: [{
          id: "release-group-1",
          decision: "ACCEPT",
          reasonCode: "EVIDENCE_CONSISTENT",
          reason: "Looks consistent.",
        }] }),
      }) as never,
    }),
    /without deterministic strong evidence/,
  );
});

test("rejects missing decisions", async () => {
  await assert.rejects(
    auditReleaseEvidenceWithAi([evidence()], undefined, {
      createResponse: async () => ({ output_text: "{\"decisions\":[]}" }) as never,
    }),
    /one decision for every candidate/,
  );
});
