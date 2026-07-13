import assert from "node:assert/strict";
import test from "node:test";
import { discoverDiscogsSupplementalCandidates } from "@/lib/ai/supplemental-release-discovery";
import type { ComprehensiveDiscographyCandidate } from "@/lib/ai/comprehensive-discography";
import type { DiscogsSearchReleaseEvidence } from "@/lib/discogs/types";

function row(overrides: Partial<DiscogsSearchReleaseEvidence> = {}): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: 123,
    masterId: 456,
    title: "Momoe Yamaguchi - 夢先案内人",
    year: 1989,
    country: "Japan",
    formats: ["CD", "Single"],
    labels: ["CBS/Sony"],
    catalogNumber: "10EH-3177",
    barcode: null,
    apiUrl: "https://api.discogs.com/releases/123",
    sourceUrl: "https://www.discogs.com/release/123",
    thumbnailUrl: null,
    coverImageUrl: "https://i.discogs.com/example.jpg",
    ...overrides,
  };
}

const request = {
  artistName: "山口百恵",
  country: "Japan",
  target: "ORIGINAL_CD" as const,
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

function musicBrainzCandidate(
  workId: string,
  editionId: string,
  overrides: Partial<ComprehensiveDiscographyCandidate["candidate"]> = {},
): ComprehensiveDiscographyCandidate {
  const base = discoverDiscogsSupplementalCandidates({
    rows: [row({ releaseId: 900, masterId: 900, catalogNumber: "MB-900", year: 1986 })],
    existingCandidates: [],
    request,
    artistCredit: "Test Artist",
  })[0]!;
  return {
    ...base,
    workId,
    editionId,
    candidate: {
      ...base.candidate,
      id: `release-${editionId}`,
      title: "Canonical Work",
      titleOriginal: null,
      category: "SINGLE",
      releaseDate: "1986-08-21",
      originalReleaseDate: "1986-08-21",
      catalogNumber: "K07S-1",
      sources: [{
        title: "MusicBrainz release",
        url: `https://musicbrainz.org/release/${editionId}`,
        sourceType: "database",
      }],
      ...overrides,
    },
    observations: [{
      id: `musicbrainz:${editionId}`,
      provider: "musicbrainz",
      role: "DISCOVERY",
      strength: "SUPPORTING",
      stage: "MUSICBRAINZ",
      verdict: "PASS",
      reasonCode: "MUSICBRAINZ_EDITION_DISCOVERED",
      reason: "MusicBrainz supplied this edition.",
      sourceUrl: `https://musicbrainz.org/release/${editionId}`,
      matchedFields: ["title", "date"],
    }],
  };
}

test("creates a non-MusicBrainz Japan CD seed with stable Discogs work and edition ids", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row()],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0]?.candidate.title, "夢先案内人");
  assert.equal(discovered[0]?.candidate.category, "SINGLE");
  assert.match(discovered[0]!.workId, /^discogs-provisional-work:[0-9a-f]{32}$/);
  assert.equal(discovered[0]?.editionId, "discogs:123");
  assert.equal(discovered[0]?.observations.some((item) =>
    item.provider === "musicbrainz"), false);
  assert.equal(discovered[0]?.observations.some((item) =>
    item.provider === "discogs" && item.role === "CORROBORATING" && item.verdict === "PASS"), true);
});

test("does not duplicate an existing exact title, catalog, and year edition", () => {
  const existing = discoverDiscogsSupplementalCandidates({
    rows: [row()],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  })[0]!;
  const represented: ComprehensiveDiscographyCandidate = {
    ...existing,
    candidate: {
      ...existing.candidate,
      id: "musicbrainz-existing",
      sources: [{
        title: "MusicBrainz release",
        url: "https://musicbrainz.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceType: "database",
      }],
    },
  };
  assert.equal(discoverDiscogsSupplementalCandidates({
    rows: [row()],
    existingCandidates: [represented],
    request,
    artistCredit: "山口百恵",
  }).length, 0);
});

test("does not duplicate a bilingual title when catalog number and year already bind the edition", () => {
  const existing = discoverDiscogsSupplementalCandidates({
    rows: [row()],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  })[0]!;
  assert.equal(discoverDiscogsSupplementalCandidates({
    rows: [row({ title: "Momoe Yamaguchi - Dream Guide = 夢先案内人" })],
    existingCandidates: [{
      ...existing,
      candidate: { ...existing.candidate, title: "夢先案内人" },
    }],
    request,
    artistCredit: "山口百恵",
  }).length, 0);
});

test("deduplicates repeated Discogs rows for one catalog-bound edition", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ releaseId: 1 }), row({ releaseId: 2 })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.equal(discovered.length, 1);
});

test("reuses an existing work only when an exact edition established the same Discogs master", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ releaseId: 789, catalogNumber: "KIDS-999", year: 1992 })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
    knownWorkIdsByMaster: new Map([[456, "musicbrainz-work-456"]]),
  });
  assert.equal(discovered[0]?.workId, "musicbrainz-work-456");
});

test("inherits canonical MusicBrainz work metadata after a secure Discogs master binding", () => {
  const workId = "musicbrainz-work-456";
  const existing = musicBrainzCandidate(
    workId,
    "11111111-1111-4111-8111-111111111111",
    {
      title: "Canonical Japanese Single",
      titleOriginal: "Canonical Single",
      category: "SINGLE",
      releaseDate: "1986-08-21",
      originalReleaseDate: "1986-08-21",
    },
  );
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({
      releaseId: 789,
      title: "Test Artist - Discogs Romanized Title",
      catalogNumber: "K10X-999",
      year: 1989,
      formats: ["CD", "Single", "Reissue"],
    })],
    existingCandidates: [existing],
    request,
    artistCredit: "Test Artist",
    knownWorkIdsByMaster: new Map([[456, workId]]),
  });

  assert.equal(discovered[0]?.workId, workId);
  assert.equal(discovered[0]?.candidate.title, "Canonical Japanese Single");
  assert.equal(discovered[0]?.candidate.titleOriginal, "Canonical Single");
  assert.equal(discovered[0]?.candidate.originalReleaseDate, "1986-08-21");
  assert.equal(discovered[0]?.candidate.category, "SINGLE");
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "PASS");
  const facts = discovered[0]?.observations.find((item) =>
    item.reasonCode === "DISCOGS_JAPAN_CD_DISCOVERY")?.facts;
  assert.equal(facts?.title, "Discogs Romanized Title");
  assert.equal(facts?.canonicalOriginalReleaseDate, "1986-08-21");
});

test("uses the bound MusicBrainz work category to resolve an otherwise ambiguous Discogs album", () => {
  const workId = "musicbrainz-album-work-456";
  const existing = musicBrainzCandidate(
    workId,
    "22222222-2222-4222-8222-222222222222",
    { category: "ORIGINAL_ALBUM", title: "Canonical Album" },
  );
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({
      releaseId: 790,
      title: "Test Artist - Discogs Album Title",
      catalogNumber: "KICS-999",
      year: 1989,
      formats: ["CD", "Album"],
    })],
    existingCandidates: [existing],
    request,
    artistCredit: "Test Artist",
    knownWorkIdsByMaster: new Map([[456, workId]]),
  });

  assert.equal(discovered[0]?.candidate.category, "ORIGINAL_ALBUM");
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "PASS");
});

test("does not infer canonical metadata from title alone without a secure master binding", () => {
  const existing = musicBrainzCandidate(
    "musicbrainz-work-456",
    "33333333-3333-4333-8333-333333333333",
    { title: "Same Title", originalReleaseDate: "1986-08-21" },
  );
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({
      releaseId: 791,
      title: "Test Artist - Same Title",
      catalogNumber: "K10X-998",
      year: 1989,
    })],
    existingCandidates: [existing],
    request,
    artistCredit: "Test Artist",
  });

  assert.notEqual(discovered[0]?.workId, existing.workId);
  assert.equal(discovered[0]?.candidate.originalReleaseDate, null);
  assert.equal(discovered[0]?.candidate.title, "Same Title");
});

test("does not propagate a disputed MusicBrainz original release date", () => {
  const workId = "musicbrainz-conflicting-date-work";
  const first = musicBrainzCandidate(
    workId,
    "44444444-4444-4444-8444-444444444444",
    { originalReleaseDate: "1986-08-21" },
  );
  const second = musicBrainzCandidate(
    workId,
    "55555555-5555-4555-8555-555555555555",
    { originalReleaseDate: "1986-09-01", releaseDate: "1989-01-01" },
  );
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ releaseId: 792, catalogNumber: "K10X-997", year: 1989 })],
    existingCandidates: [first, second],
    request,
    artistCredit: "Test Artist",
    knownWorkIdsByMaster: new Map([[456, workId]]),
  });

  assert.equal(discovered[0]?.workId, workId);
  assert.equal(discovered[0]?.candidate.originalReleaseDate, null);
});

test("keeps compilations out of scope when the request excludes them", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ formats: ["CD", "Compilation"] })],
    existingCandidates: [],
    request: { ...request, includeLiveRemixBest: false },
    artistCredit: "山口百恵",
  });
  assert.equal(discovered[0]?.candidate.category, "COLLECTION");
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "OUT_OF_SCOPE");
});

test("keeps later reissues and remasters out when an earlier Japan CD edition exists", () => {
  for (const marker of ["Reissue", "Remastered"]) {
    const discovered = discoverDiscogsSupplementalCandidates({
      rows: [
        row({ releaseId: 1, year: 1985, catalogNumber: "K32X-1" }),
        row({ releaseId: 2, year: 1989, catalogNumber: "K10X-2", formats: ["CD", "Single", marker] }),
      ],
      existingCandidates: [],
      request,
      artistCredit: "山口百恵",
    });
    const later = discovered.find((item) => item.candidate.id === "discogs-release-2");
    assert.equal(later?.observations.find((item) => item.stage === "SCOPE")?.verdict, "OUT_OF_SCOPE");
  }
});

test("allows the earliest identified Japan CD to represent an older-format work", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ formats: ["CD", "Single", "Reissue"] })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "PASS");
});

test("keeps promos, boxes, and rows without a work identity out or pending", () => {
  for (const formats of [["CD", "Single", "Promo"], ["CD", "Box Set"]]) {
    const discovered = discoverDiscogsSupplementalCandidates({
      rows: [row({ formats })],
      existingCandidates: [],
      request,
      artistCredit: "山口百恵",
    });
    assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "OUT_OF_SCOPE");
  }
  const pending = discoverDiscogsSupplementalCandidates({
    rows: [row({ masterId: null })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.equal(pending[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "UNKNOWN");
});

test("keeps an unclassified album pending until a work-level authority proves it is original", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ formats: ["CD", "Album"] })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.equal(discovered[0]?.candidate.category, "OTHER");
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "UNKNOWN");
});

test("preserves and excludes an explicit collaboration when collaborations are disabled", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ title: "Momoe Yamaguchi & Guest - 夢先案内人" })],
    existingCandidates: [],
    request: { ...request, includeCollaborations: false },
    artistCredit: "山口百恵",
  });
  assert.equal(discovered[0]?.candidate.artistCredit, "Momoe Yamaguchi & Guest");
  assert.equal(discovered[0]?.observations.find((item) => item.stage === "SCOPE")?.verdict, "OUT_OF_SCOPE");
});

test("refuses seeds without a catalog number or release year", () => {
  const discovered = discoverDiscogsSupplementalCandidates({
    rows: [row({ releaseId: 1, catalogNumber: null }), row({ releaseId: 2, year: null })],
    existingCandidates: [],
    request,
    artistCredit: "山口百恵",
  });
  assert.deepEqual(discovered, []);
});
