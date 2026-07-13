import assert from "node:assert/strict";
import test from "node:test";
import {
  curatedDiscogsDetailMatchesWork,
  findCuratedDiscogsWorkEvidence,
  type ExactDiscogsArtistInventory,
} from "@/lib/ai/curated-discogs-work-evidence";
import {
  findCuratedArtistDiscography,
  type CuratedDiscographyWork,
} from "@/lib/official-music/curated-discography";
import type {
  DiscogsReleaseEvidence,
  DiscogsSearchReleaseEvidence,
} from "@/lib/discogs/types";

const inventory: ExactDiscogsArtistInventory = {
  exact: true,
  query: "中森明菜",
  artistNames: ["中森明菜", "Akina Nakamori"],
};

function work(overrides: Partial<CuratedDiscographyWork> = {}): CuratedDiscographyWork {
  return {
    ordinal: 1,
    title: "スローモーション",
    aliases: ["Slow Motion"],
    category: "SINGLE",
    originalReleaseDate: "1982-05-01",
    authorityUrls: ["https://example.com/official-discography"],
    authorityAsOf: "2026-07-12",
    mediaScope: null,
    ...overrides,
  };
}

function row(
  releaseId: number,
  overrides: Partial<DiscogsSearchReleaseEvidence> = {},
): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId,
    masterId: 100,
    title: "中森明菜 - スローモーション",
    year: 1982,
    country: "Japan",
    formats: ["Vinyl", "7\"", "45 RPM", "Single"],
    labels: ["Reprise Records"],
    catalogNumber: "L-1600",
    barcode: null,
    apiUrl: `https://api.discogs.com/releases/${releaseId}`,
    sourceUrl: `https://www.discogs.com/release/${releaseId}`,
    thumbnailUrl: null,
    coverImageUrl: null,
    ...overrides,
  };
}

function detail(
  releaseId: number,
  overrides: Partial<DiscogsReleaseEvidence> = {},
): DiscogsReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId,
    masterId: 100,
    status: "Accepted",
    dataQuality: "Correct",
    title: "スローモーション",
    artistCredit: "中森明菜",
    artists: [{ name: "中森明菜", anv: null, join: null }],
    year: 1982,
    released: "1982-05-01",
    country: "Japan",
    labels: [{ name: "Reprise Records", catalogNumber: "L-1600" }],
    formats: [{ name: "Vinyl", quantity: 1, descriptions: ["7\"", "Single"] }],
    identifiers: [],
    barcodes: [],
    tracks: [],
    images: [],
    primaryImageUrl: null,
    displayImageUrl: null,
    apiUrl: `https://api.discogs.com/releases/${releaseId}`,
    sourceUrl: `https://www.discogs.com/release/${releaseId}`,
    ...overrides,
  };
}

test("detail identity accepts only the current work's declared alternate artist credit", () => {
  const alternateWork = work({ artistCredits: ["Stage Name"] });
  const alternateRow = row(7, { title: "Stage Name - スローモーション" });
  const evidence = findCuratedDiscogsWorkEvidence({
    work: alternateWork,
    rows: [alternateRow],
    inventory,
  });
  assert.ok(evidence);

  const binding = { work: alternateWork, inventory, evidence };
  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: "Stage Name",
    artists: [{ name: "Stage Name", anv: null, join: null }],
  })), true);

  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: "Undeclared Name",
    artists: [{ name: "Undeclared Name", anv: null, join: null }],
  })), false);
  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: "Stage Name & Guest Artist",
    artists: [
      { name: "Stage Name", anv: null, join: "&" },
      { name: "Guest Artist", anv: null, join: null },
    ],
  })), false);
  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: "Stage Name",
    artists: [
      { name: "Stage Name", anv: null, join: "&" },
      { name: "Guest Artist", anv: null, join: null },
    ],
  })), false);
  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: "Stage Name",
    artists: [{ name: "Guest Artist", anv: null, join: null }],
  })), false);
  assert.equal(curatedDiscogsDetailMatchesWork(binding, detail(7, {
    artistCredit: null,
    artists: [
      { name: "Stage Name", anv: null, join: "&" },
      { name: "Guest Artist", anv: null, join: null },
    ],
  })), false);

  const collaborationWork = work({
    artistCredits: ["Stage Name & Declared Partner"],
  });
  const collaborationEvidence = findCuratedDiscogsWorkEvidence({
    work: collaborationWork,
    rows: [row(8, { title: "Stage Name & Declared Partner - スローモーション" })],
    inventory,
  });
  assert.ok(collaborationEvidence);
  assert.equal(curatedDiscogsDetailMatchesWork({
    work: collaborationWork,
    inventory,
    evidence: collaborationEvidence,
  }, detail(8, {
    artistCredit: "Stage Name & Declared Partner",
    artists: [
      { name: "Stage Name", anv: null, join: "&" },
      { name: "Declared Partner", anv: null, join: null },
    ],
  })), true);
});

test("binds only complete NFKC titles, manifest aliases, and fixed Discogs bilingual suffixes", () => {
  const nfkc = findCuratedDiscogsWorkEvidence({
    work: work({ title: "ＡＢＣ", aliases: [] }),
    rows: [row(1, { title: "中森明菜 - ABC" })],
    inventory,
  });
  const alias = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(2, { title: "Akina Nakamori - Slow Motion" })],
    inventory,
  });
  const bilingual = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(3, { title: "中森明菜 - スローモーション = Slow Motion" })],
    inventory,
  });

  assert.equal(nfkc?.matchKind, "NFKC_EXACT");
  assert.equal(alias?.matchKind, "MANIFEST_ALIAS");
  assert.equal(bilingual?.matchKind, "DISCOGS_ROMANIZATION_SUFFIX");
  assert.deepEqual(bilingual?.matchedFields, ["artist", "title", "category", "originalYear"]);
  assert.equal(bilingual?.evidenceRole, "corroborating-only");
  assert.equal(bilingual?.scope, "WORK");
});

test("accepts exactly one complete A/B component but never a substring", () => {
  const composite = findCuratedDiscogsWorkEvidence({
    work: work({ title: "北ウイング", aliases: [] }),
    rows: [row(10, { title: "中森明菜 - 北ウイング / リ・フ・レ・イ・ン" })],
    inventory,
  });
  const fullWidthComposite = findCuratedDiscogsWorkEvidence({
    work: work({ title: "リ・フ・レ・イ・ン", aliases: [] }),
    rows: [row(11, { title: "中森明菜 - 北ウイング／リ・フ・レ・イ・ン" })],
    inventory,
  });
  const substring = findCuratedDiscogsWorkEvidence({
    work: work({ title: "C", aliases: [] }),
    rows: [row(12, { title: "中森明菜 - CATCH ME" })],
    inventory,
  });
  const ambiguousComponents = findCuratedDiscogsWorkEvidence({
    work: work({ title: "C", aliases: [] }),
    rows: [row(13, { title: "中森明菜 - C / C" })],
    inventory,
  });

  assert.equal(composite?.matchKind, "AB_COMPOSITE_COMPONENT");
  assert.equal(fullWidthComposite?.matchKind, "AB_COMPOSITE_COMPONENT");
  assert.equal(substring, null);
  assert.equal(ambiguousComponents, null);
});

test("requires exact artist inventory identity, original year, and non-conflicting category", () => {
  const wrongQuery = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(20)],
    inventory: { exact: true, query: "中森", artistNames: inventory.artistNames },
  });
  const wrongArtist = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(21, { title: "松田聖子 - スローモーション" })],
    inventory,
  });
  const wrongYear = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(22, { year: 1983 })],
    inventory,
  });
  const wrongCategory = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(23, { formats: ["Vinyl", "Album"] })],
    inventory,
  });
  const missingOriginalYear = findCuratedDiscogsWorkEvidence({
    work: work({ originalReleaseDate: null }),
    rows: [row(24)],
    inventory,
  });

  assert.equal(wrongQuery, null);
  assert.equal(wrongArtist, null);
  assert.equal(wrongYear, null);
  assert.equal(wrongCategory, null);
  assert.equal(missingOriginalYear, null);
});

test("accepts Discogs fixed bilingual artist alternatives but not collaborations", () => {
  assert.ok(findCuratedDiscogsWorkEvidence({
    work: work(),
    inventory,
    rows: [row(25, { title: "中森明菜* = Akina Nakamori - スローモーション" })],
  }));
  assert.equal(findCuratedDiscogsWorkEvidence({
    work: work(),
    inventory,
    rows: [row(26, { title: "Akina Nakamori & Another Artist - スローモーション" })],
  }), null);
});

test("accepts an exact alternate credit only on the curated work that declares it", () => {
  const alternateRow = row(27, { title: "PROJECT CREDIT - スローモーション" });
  assert.equal(findCuratedDiscogsWorkEvidence({
    work: work(),
    inventory,
    rows: [alternateRow],
  }), null);
  assert.ok(findCuratedDiscogsWorkEvidence({
    work: work({ artistCredits: ["PROJECT CREDIT"] }),
    inventory,
    rows: [alternateRow],
  }));
});

test("binds Akina's source-faithful title and artist variants without making them global", () => {
  const akina = findCuratedArtistDiscography(null, ["Akina Nakamori"]);
  assert.ok(akina);
  const single = (ordinal: number) => {
    const found = akina.works.find((candidate) =>
      candidate.category === "SINGLE" && candidate.ordinal === ordinal);
    assert.ok(found);
    return found;
  };
  const cases = [
    {
      work: single(12),
      source: row(3537736, {
        title: "Akina* - Mi Amore",
        year: 1985,
        catalogNumber: "L-1668",
      }),
    },
    {
      work: single(13),
      source: row(7930588, {
        title: "中森明菜* = Akina Nakamori - Akaitori Nigeta / Babylon",
        year: 1985,
        catalogNumber: "L-3601",
      }),
    },
    {
      work: single(16),
      source: row(9502813, {
        title: "明菜* = Akina* - Desire",
        year: 1986,
        catalogNumber: "L-1750",
      }),
    },
    {
      work: single(33),
      source: row(9842875, {
        title: "Nakamori Akina* - 月華",
        year: 1994,
        catalogNumber: "MVDD-10009",
        formats: ["CD", "Mini", "Single"],
      }),
    },
    {
      work: single(35),
      source: row(5903387, {
        title: "Akina* - Tokyo Rose",
        year: 1995,
        catalogNumber: "MVDD-10017",
        formats: ["CD", "Mini", "Single"],
      }),
    },
    {
      work: single(37),
      source: row(9842936, {
        title: "Nakamori Akina* - Appetite",
        year: 1997,
        catalogNumber: "MVDD-10027",
        formats: ["CD", "Mini", "Single"],
      }),
    },
  ];

  for (const item of cases) {
    assert.equal(findCuratedDiscogsWorkEvidence({
      work: item.work,
      inventory,
      rows: [item.source],
    })?.release.releaseId, item.source.releaseId, item.work.title);
  }

  assert.equal(findCuratedDiscogsWorkEvidence({
    work: single(1),
    inventory,
    rows: [row(999999, { title: "Akina* - スローモーション" })],
  }), null);
});

test("rejects remix, live, compilation, EP, and any digital-file row", () => {
  for (const marker of ["Remix", "Live", "Compilation", "EP"] as const) {
    assert.equal(findCuratedDiscogsWorkEvidence({
      work: work(),
      rows: [row(30, { formats: ["Vinyl", "Single", marker] })],
      inventory,
    }), null, marker);
  }
  for (const formats of [["File", "MP3", "Single"], ["Vinyl", "File", "Single"]]) {
    assert.equal(findCuratedDiscogsWorkEvidence({
      work: work(),
      rows: [row(31, { formats })],
      inventory,
    }), null, formats.join(","));
  }
});

test("prefers non-promo and explicit Single or Album format evidence", () => {
  const nonPromo = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [
      row(40, { catalogNumber: "PROMO-1", formats: ["Vinyl", "Single", "Promo"] }),
      row(41, { catalogNumber: "COMMERCIAL-1", formats: ["Vinyl"] }),
    ],
    inventory,
  });
  const explicitSingle = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [
      row(42, { catalogNumber: "UNTYPED-1", formats: ["Vinyl"] }),
      row(43, { catalogNumber: "SINGLE-1", formats: ["Vinyl", "Single"] }),
    ],
    inventory,
  });
  const explicitAlbum = findCuratedDiscogsWorkEvidence({
    work: work({
      title: "プロローグ〈序幕〉",
      aliases: [],
      category: "ORIGINAL_ALBUM",
      originalReleaseDate: "1982-07-01",
    }),
    rows: [
      row(44, {
        title: "中森明菜 - プロローグ〈序幕〉",
        year: 1982,
        catalogNumber: "UNTYPED-LP",
        formats: ["Vinyl"],
      }),
      row(45, {
        title: "中森明菜 - プロローグ〈序幕〉",
        year: 1982,
        catalogNumber: "ALBUM-LP",
        formats: ["Vinyl", "Album"],
      }),
    ],
    inventory,
  });

  assert.equal(nonPromo?.release.releaseId, 41);
  assert.equal(explicitSingle?.release.releaseId, 43);
  assert.equal(explicitAlbum?.release.releaseId, 45);
});

test("selects a stable same-catalog version and exposes only a WORK cover candidate", () => {
  const withoutCover = row(51, {
    masterId: null,
    catalogNumber: "L-1600",
  });
  const withCover = row(52, {
    masterId: 100,
    catalogNumber: "L1600",
    coverImageUrl: "https://i.discogs.com/example-cover.jpg",
  });
  const first = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [withoutCover, withCover],
    inventory,
  });
  const reversed = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [withCover, withoutCover],
    inventory,
  });

  assert.equal(first?.release.releaseId, 52);
  assert.equal(reversed?.release.releaseId, 52);
  assert.deepEqual(first?.cover, {
    provider: "discogs",
    matchLevel: "WORK",
    imageUrl: "https://i.discogs.com/example-cover.jpg",
    sourceUrl: "https://www.discogs.com/release/52",
    requiresAssetValidation: true,
  });
});

test("accepts different carrier catalogs only when one non-null master proves one work", () => {
  const sharedMaster = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [
      row(55, { masterId: 500, catalogNumber: "LP-500", formats: ["Vinyl", "Single"] }),
      row(56, {
        masterId: 500,
        catalogNumber: "CT-500",
        formats: ["Cassette", "Single"],
        coverImageUrl: "https://i.discogs.com/shared-master-cover.jpg",
      }),
    ],
    inventory,
  });

  assert.equal(sharedMaster?.release.releaseId, 56);
  assert.equal(sharedMaster?.release.masterId, 500);
});

test("an authority-declared original CD binds Mellow's CD instead of its same-master cassette", () => {
  const miho = findCuratedArtistDiscography(null, ["中山美穂"]);
  const mellow = miho?.works.find((candidate) =>
    candidate.category === "ORIGINAL_ALBUM" && candidate.title === "Mellow");
  assert.ok(mellow);
  const mihoInventory: ExactDiscogsArtistInventory = {
    exact: true,
    query: "Miho Nakayama",
    artistNames: ["中山美穂", "Miho Nakayama"],
  };
  const cd = row(8_822_822, {
    masterId: 9200,
    title: "Miho Nakayama - Mellow",
    year: 1992,
    formats: ["CD", "Album"],
    catalogNumber: "KICS210",
  });
  const cassette = row(22_022_713, {
    masterId: 9200,
    title: "Miho Nakayama - Mellow",
    year: 1992,
    formats: ["Cassette", "Album"],
    catalogNumber: "KITX-140",
    coverImageUrl: "https://i.discogs.com/mellow-cassette.jpg",
  });

  for (const rows of [[cassette, cd], [cd, cassette]]) {
    const evidence = findCuratedDiscogsWorkEvidence({
      work: mellow,
      rows,
      inventory: mihoInventory,
    });
    assert.equal(evidence?.release.releaseId, 8_822_822);
    assert.equal(evidence?.facts.catalogNumber, "KICS210");
    assert.equal(evidence?.facts.formats, "CD, Album");
  }
});

test("returns null for equal-strength different catalogs or malformed source identity", () => {
  const ambiguous = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [
      row(60, { masterId: 600, catalogNumber: "L-1600" }),
      row(61, { masterId: 601, catalogNumber: "L-1601" }),
    ],
    inventory,
  });
  const malformedSource = findCuratedDiscogsWorkEvidence({
    work: work(),
    rows: [row(62, { sourceUrl: "https://example.com/release/62" })],
    inventory,
  });

  assert.equal(ambiguous, null);
  assert.equal(malformedSource, null);
});
