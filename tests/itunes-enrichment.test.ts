import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyItunesAlbumEnrichment,
  enrichReleaseResearchResultWithItunes,
  findExactItunesAlbumMatch,
  normalizeItunesTitle,
  resolveItunesCountryCode,
  searchItunesAlbums,
  selectDominantItunesArtistId,
  selectFrequentCjkArtistName,
  toItunesArtwork600,
  type ItunesAlbumResult,
  type ItunesFetch,
} from "@/lib/ai/itunes-enrichment";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";

function candidate(
  id: string,
  title: string,
  year: string | null,
  overrides: Partial<ReleaseResearchCandidate> = {},
): ReleaseResearchCandidate {
  return {
    id,
    title,
    titleOriginal: null,
    category: "ORIGINAL_ALBUM",
    artistCredit: "Miho Nakayama",
    releaseDate: year ? `${year}-01-01` : null,
    originalReleaseDate: year ? `${year}-01-01` : null,
    format: "CD",
    catalogNumber: `CAT-${id}`,
    barcode: null,
    label: "King Records",
    originalPrice: null,
    editionType: null,
    isReissue: false,
    isRemaster: false,
    isExcludedByDefault: false,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    notes: null,
    confidence: "HIGH",
    warnings: [],
    sources: [],
    ...overrides,
  };
}

function album(
  collectionId: number,
  collectionName: string,
  year: string,
  overrides: Partial<ItunesAlbumResult> = {},
): ItunesAlbumResult {
  return {
    collectionId,
    artistId: 900,
    artistName: "中山美穂",
    collectionName,
    releaseDate: `${year}-01-01T00:00:00Z`,
    artworkUrl100:
      `https://is1-ssl.mzstatic.com/image/thumb/Music/cd-box-${collectionId}/100x100bb.jpg`,
    collectionViewUrl: `https://music.apple.com/jp/album/example/${collectionId}`,
    ...overrides,
  };
}

function result(releases: ReleaseResearchCandidate[]): ReleaseResearchResult {
  return {
    artist: {
      name: "Miho Nakayama",
      nameKana: null,
      nameRomaji: null,
      country: "Japan",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: "ORIGINAL_CD",
      excludeReissues: true,
      includeCollaborations: true,
    },
    releases,
    globalWarnings: [],
  };
}

test("maps common East Asian country names to iTunes storefronts", () => {
  assert.equal(resolveItunesCountryCode("Japan"), "JP");
  assert.equal(resolveItunesCountryCode("日本"), "JP");
  assert.equal(resolveItunesCountryCode("中国"), "CN");
  assert.equal(resolveItunesCountryCode("Hong Kong"), "HK");
  assert.equal(resolveItunesCountryCode("臺灣"), "TW");
  assert.equal(resolveItunesCountryCode("South Korea"), "KR");
  assert.equal(resolveItunesCountryCode("de"), "DE");
  assert.equal(resolveItunesCountryCode("unknown place"), "US");
});

test("normalizes presentation differences without fuzzy title matching", () => {
  assert.equal(normalizeItunesTitle("  Ｃ・Ｄ  "), "cd");
  assert.equal(normalizeItunesTitle("SUMMER—BREEZE"), normalizeItunesTitle("Summer Breeze"));
  assert.notEqual(normalizeItunesTitle("C"), normalizeItunesTitle("C++"));
  assert.notEqual(normalizeItunesTitle("Collection"), normalizeItunesTitle("Collection II"));
});

test("matches one exact normalized title, year, and dominant artist", () => {
  const release = candidate("one", "SUMMER BREEZE", "1986");
  const exact = album(1, "Summer・Breeze", "1986");
  const wrongYear = album(2, "SUMMER BREEZE", "2015");
  const fuzzyTitle = album(3, "SUMMER BREEZE (Deluxe Edition)", "1986");

  assert.equal(findExactItunesAlbumMatch(release, [exact, wrongYear, fuzzyTitle], 900)?.collectionId, 1);
  assert.equal(findExactItunesAlbumMatch(release, [wrongYear, fuzzyTitle], 900), null);
  assert.equal(
    findExactItunesAlbumMatch(candidate("two", "SUMMER BREEZE", null), [exact, wrongYear], 900),
    null,
    "a title-only match without a candidate year must not choose an edition",
  );
});

test("falls back to a valid release date when originalReleaseDate is unusable", () => {
  const release = candidate("one", "C", "1985", { originalReleaseDate: "unknown" });
  assert.equal(findExactItunesAlbumMatch(release, [album(40, "C", "1985")], 900)?.collectionId, 40);
});

test("rejects a same-title same-year album from another artist", () => {
  const release = candidate("one", "Greatest Hits", "1988");
  const dominantArtistAlbums = [
    album(4, "Different Album", "1987"),
    album(5, "Another Album", "1989"),
  ];
  const wrongArtistMatch = album(6, "Greatest Hits", "1988", { artistId: 901 });
  const evidenceCandidates = [
    candidate("evidence-one", "Different Album", "1987"),
    candidate("evidence-two", "Another Album", "1989"),
    release,
  ];

  assert.equal(
    selectDominantItunesArtistId(evidenceCandidates, [...dominantArtistAlbums, wrongArtistMatch]),
    900,
  );
  assert.equal(
    findExactItunesAlbumMatch(release, [...dominantArtistAlbums, wrongArtistMatch], 900),
    null,
  );
});

test("requires repeated majority evidence for the searched Apple artist", () => {
  assert.equal(
    selectDominantItunesArtistId(
      [candidate("one", "Only Album", "1988")],
      [album(7, "Only Album", "1988")],
    ),
    null,
  );
  assert.equal(
    selectDominantItunesArtistId(
      [candidate("one", "One", "1988"), candidate("two", "Two", "1989")],
      [
        album(8, "One", "1988"),
        album(9, "Two", "1989", { artistId: 901 }),
      ],
    ),
    null,
  );
});

test("does not count duplicate candidates for the same Apple collection twice", () => {
  const oneAlbum = album(70, "C", "1985");
  const duplicateCandidates = [
    candidate("one", "C", "1985"),
    candidate("two", "English Display", "1985", { titleOriginal: "Ｃ" }),
  ];

  assert.equal(selectDominantItunesArtistId(duplicateCandidates, [oneAlbum]), null);
});

test("uses titleOriginal as an exact alternate but rejects multiple collection ids", () => {
  const release = candidate("one", "English Display", "1985", {
    titleOriginal: "Ｃ",
  });
  const first = album(10, "C", "1985");
  const duplicateRow = { ...first };
  const ambiguous = album(11, "Ｃ", "1985");
  const artistIdentityEvidence = album(12, "D", "1986");

  assert.equal(
    findExactItunesAlbumMatch(release, [first, duplicateRow, artistIdentityEvidence], 900)?.collectionId,
    10,
  );
  assert.equal(findExactItunesAlbumMatch(release, [first, ambiguous, artistIdentityEvidence], 900), null);
});

test("creates only Apple-hosted 600x600 artwork URLs", () => {
  assert.equal(
    toItunesArtwork600(
      "http://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
    ),
    "https://is1-ssl.mzstatic.com/image/thumb/Music/example/600x600bb.jpg",
  );
  assert.equal(
    toItunesArtwork600("https://a1.itunes.apple.com/music/example/100x100-75.jpg"),
    "https://a1.itunes.apple.com/music/example/600x600-75.jpg",
  );
  assert.equal(toItunesArtwork600("https://images.example.com/100x100.jpg"), null);
  assert.equal(toItunesArtwork600("https://is1-ssl.mzstatic.com/no-size.jpg"), null);
});

test("fills a missing cover without treating its store link as release evidence", () => {
  const missingCover = candidate("one", "C", "1985", {
    confidence: "LOW",
    warnings: ["Missing release sources: PENDING_REVIEW"],
  });
  const existingCover = candidate("two", "D", "1986", {
    coverImageUrl: "https://official.example.com/d.jpg",
    coverImageSourceUrl: "https://official.example.com/d",
  });
  const enriched = applyItunesAlbumEnrichment(
    result([missingCover, existingCover]),
    [album(20, "Ｃ", "1985"), album(21, "D", "1986")],
    { artistQuery: "Miho Nakayama" },
  );

  assert.equal(
    enriched.releases[0].coverImageUrl,
    "https://is1-ssl.mzstatic.com/image/thumb/Music/cd-box-20/600x600bb.jpg",
  );
  assert.equal(enriched.releases[0].coverImageSourceUrl, "https://music.apple.com/jp/album/example/20");
  assert.deepEqual(enriched.releases[0].sources, []);
  assert.equal(enriched.releases[0].confidence, "LOW");
  assert.deepEqual(enriched.releases[0].warnings, ["Missing release sources: PENDING_REVIEW"]);
  assert.equal(enriched.releases[1].coverImageUrl, "https://official.example.com/d.jpg");
  assert.equal(enriched.releases[1].coverImageSourceUrl, "https://official.example.com/d");
  assert.deepEqual(enriched.releases[1].sources, []);
});

test("adopts only a dominant repeated CJK artist name and preserves romanization", () => {
  const releases = [
    candidate("one", "C", "1985"),
    candidate("two", "D", "1986"),
    candidate("three", "E", "1987"),
  ];
  const albums = [
    album(30, "C", "1985"),
    album(31, "D", "1986"),
    album(32, "E", "1987", { artistName: "別の歌手" }),
  ];

  assert.equal(selectFrequentCjkArtistName(releases, albums, 900), "中山美穂");
  const enriched = applyItunesAlbumEnrichment(result(releases), albums, {
    artistQuery: "Miho Nakayama",
  });
  assert.equal(enriched.artist.name, "中山美穂");
  assert.equal(enriched.artist.nameRomaji, "Miho Nakayama");

  assert.equal(
    selectFrequentCjkArtistName([releases[0]], [albums[0]], 900),
    null,
    "one matching album is not enough localization evidence",
  );
  assert.equal(
    selectFrequentCjkArtistName(releases.slice(0, 2), [
      albums[0],
      { ...albums[1], artistName: "別の歌手" },
    ], 900),
    null,
    "a tied local-name vote must not rename the artist",
  );
});

test("does not use collaboration credits as the artist library local name", () => {
  const releases = [
    candidate("one", "C", "1985"),
    candidate("two", "D", "1986"),
    candidate("three", "E", "1987"),
    candidate("four", "F", "1988"),
    candidate("five", "G", "1989"),
  ];
  const albums = [
    album(50, "C", "1985"),
    album(51, "D", "1986"),
    album(52, "E", "1987", { artistName: "中山美穂 & WANDS" }),
    album(53, "F", "1988", { artistName: "中山美穂 & WANDS" }),
    album(54, "G", "1989", { artistName: "中山美穂 & WANDS" }),
  ];

  assert.equal(selectFrequentCjkArtistName(releases, albums, 900), "中山美穂");
  assert.equal(
    selectFrequentCjkArtistName(
      releases.slice(0, 2),
      [
        { ...albums[0], artistName: "中山美穂＆WANDS" },
        { ...albums[1], artistName: "中山美穂＆WANDS" },
      ],
      900,
    ),
    null,
  );
});

test("searches the localized album endpoint and discards malformed non-album rows", async () => {
  const requestedUrls: URL[] = [];
  const fetchImpl: ItunesFetch = async (input) => {
    requestedUrls.push(new URL(input));
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            wrapperType: "collection",
            collectionType: "Album",
            collectionId: 40,
            artistId: 900,
            artistName: "中山美穂",
            collectionName: "C",
            releaseDate: "1985-01-01T00:00:00Z",
            artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/c/100x100bb.jpg",
            collectionViewUrl: "https://music.apple.com/jp/album/c/40",
          },
          {
            wrapperType: "track",
            collectionId: 41,
            artistName: "中山美穂",
            collectionName: "C",
          },
        ],
      }),
    };
  };

  const albums = await searchItunesAlbums("Miho Nakayama", "Japan", {
    fetchImpl,
    limit: 999,
  });
  assert.equal(albums.length, 1);
  assert.equal(albums[0].collectionId, 40);
  const requestedUrl = requestedUrls[0];
  assert.ok(requestedUrl);
  assert.equal(requestedUrl.searchParams.get("country"), "JP");
  assert.equal(requestedUrl.searchParams.get("media"), "music");
  assert.equal(requestedUrl.searchParams.get("entity"), "album");
  assert.equal(requestedUrl.searchParams.get("attribute"), "artistTerm");
  assert.equal(requestedUrl.searchParams.get("lang"), "ja_jp");
  assert.equal(requestedUrl.searchParams.get("limit"), "200");
});

test("network failures and timeouts leave the research result unchanged", async () => {
  const original = result([candidate("one", "C", "1985")]);
  const rejected = await enrichReleaseResearchResultWithItunes(original, {
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.strictEqual(rejected, original);

  const hangingFetch: ItunesFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  const timedOut = await enrichReleaseResearchResultWithItunes(original, {
    fetchImpl: hangingFetch,
    timeoutMs: 5,
  });
  assert.strictEqual(timedOut, original);
});
