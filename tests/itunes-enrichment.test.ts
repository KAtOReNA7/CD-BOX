import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyItunesAlbumEnrichment,
  appleCollectionIdFromStoreUrl,
  createPersistedItunesEditionCoverBinding,
  enrichReleaseResearchResultWithItunes,
  exactItunesAlbumMatchesPersistedEditionBinding,
  findExactItunesAlbumMatch,
  findUniqueItunesDatedWorkCoverMatch,
  findUniqueItunesCoverMatch,
  findUniqueItunesWorkCoverMatch,
  lookupItunesAlbumByCollectionId,
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

test("cover matching ignores a fixed Single suffix only for the same release year", () => {
  const release = candidate("one", "C", "1985");
  const matchingEdition = album(40, "C - Single", "1985");
  const laterStorefrontReissue = album(41, "C - Single", "2006", {
    releaseDate: "2006-03-01T00:00:00Z",
  });
  assert.equal(findExactItunesAlbumMatch(release, [matchingEdition], 900), null);
  assert.equal(findUniqueItunesCoverMatch(release, [matchingEdition], 900)?.collectionId, 40);
  assert.equal(
    findUniqueItunesCoverMatch(release, [laterStorefrontReissue], 900),
    null,
    "a later digital reissue must not provide the first edition cover",
  );
  assert.equal(
    findUniqueItunesCoverMatch(candidate("reissue", "C", "1985", {
      releaseDate: "2006-03-01",
    }), [laterStorefrontReissue], 900)?.collectionId,
    41,
    "cover fallback follows the physical edition date rather than the work's original date",
  );
  assert.equal(findUniqueItunesCoverMatch(release, [
    matchingEdition,
    album(42, "C - Single", "1985"),
  ], 900), null, "multiple storefront collections remain ambiguous");
  assert.equal(
    findUniqueItunesCoverMatch(candidate("undated", "C", null), [matchingEdition], 900),
    null,
    "an undated candidate cannot be bound to a storefront edition",
  );
});

test("an exact Apple edition cover cannot cross two same-title releases in one year", () => {
  const albumEdition = candidate("diva-album", "DIVA", "2009", {
    releaseDate: "2009-08-26",
    originalReleaseDate: "2009-08-26",
  });
  const singleEdition = candidate("diva-single", "DIVA", "2009", {
    category: "SINGLE",
    releaseDate: "2009-09-23",
    originalReleaseDate: "2009-09-23",
  });
  const appleAlbum = album(50, "DIVA", "2009", {
    releaseDate: "2009-08-26T00:00:00Z",
  });

  assert.equal(findUniqueItunesCoverMatch(albumEdition, [appleAlbum], 900)?.collectionId, 50);
  assert.equal(
    findUniqueItunesCoverMatch(singleEdition, [appleAlbum], 900),
    null,
    "a same-year album cover cannot masquerade as the later single edition",
  );
});

test("a unique later Apple issue is explicitly work-level artwork, never an edition match", () => {
  const release = candidate("one", "C - Single", "1985", { category: "SINGLE" });
  const laterDigitalIssue = album(41, "C - EP", "2006");

  assert.equal(findUniqueItunesCoverMatch(release, [laterDigitalIssue], 900), null);
  assert.equal(
    findUniqueItunesWorkCoverMatch(release, [laterDigitalIssue], 900)?.collectionId,
    41,
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      release,
      [laterDigitalIssue, album(42, "C - Single", "2015")],
      900,
    ),
    null,
    "multiple same-artist collections with the same work title remain ambiguous",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      release,
      [
        laterDigitalIssue,
        album(40, "[C]", "1985", { releaseDate: "1985-01-01T00:00:00Z" }),
      ],
      900,
    )?.collectionId,
    40,
    "one exact original-day collection safely disambiguates a later same-title issue",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      release,
      [album(43, "C - Single", "1984")],
      900,
    ),
    null,
    "Apple artwork cannot predate the work",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("invalid", "C", "1985", { originalReleaseDate: "not-a-date" }),
      [laterDigitalIssue],
      900,
    ),
    null,
    "work-level matching requires a structurally valid original release date",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      release,
      [{ ...laterDigitalIssue, artistId: 901 }],
      900,
    ),
    null,
    "a same-title collection from another artist is never a work match",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("bilingual", "Witches ウィッチズ", "1988", {
        category: "SINGLE",
        releaseDate: "1988-11-14",
        originalReleaseDate: "1988-11-14",
      }),
      [album(45, "Witches - EP", "1988", {
        releaseDate: "1988-11-14T08:00:00Z",
      })],
      900,
    )?.collectionId,
    45,
    "a complete Latin projection may bind an exact bilingual work title",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("album-versus-ep", "Same Title", "1988", {
        category: "ORIGINAL_ALBUM",
        releaseDate: "1988-11-14",
        originalReleaseDate: "1988-11-14",
      }),
      [album(47, "Same Title - EP", "1988", {
        releaseDate: "1988-11-14T08:00:00Z",
      })],
      900,
    ),
    null,
    "a category-incompatible storefront collection is never a work cover",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("composite", "HERO / \u4e16\u754c\u4e2d\u306e\u8ab0\u3088\u308a\u304d\u3063\u3068", "1992", {
        category: "SINGLE",
        releaseDate: "1992-10-28",
        originalReleaseDate: "1992-10-28",
      }),
      [album(48, "HERO - Single", "1992", {
        releaseDate: "1992-10-28T08:00:00Z",
      })],
      900,
    ),
    null,
    "one component of a composite title cannot supply the composite work cover",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("remix", "\u4e16\u754c\u4e2d\u306e\u8ab0\u3088\u308a\u304d\u3063\u3068 (Remix)", "1992", {
        category: "SINGLE",
        releaseDate: "1992-10-28",
        originalReleaseDate: "1992-10-28",
      }),
      [album(49, "\u4e16\u754c\u4e2d\u306e\u8ab0\u3088\u308a\u304d\u3063\u3068 - Single", "1992", {
        releaseDate: "1992-10-28T08:00:00Z",
      })],
      900,
    ),
    null,
    "a version marker cannot be discarded through a script projection",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      candidate("short-projection", "A 愛", "1988", {
        category: "SINGLE",
        releaseDate: "1988-11-14",
        originalReleaseDate: "1988-11-14",
      }),
      [album(46, "A - EP", "1988", { releaseDate: "1988-11-14T00:00:00Z" })],
      900,
    ),
    null,
    "one-character script fragments never become work aliases",
  );
});

test("an unsuffixed Apple album cannot masquerade as a same-title single work", () => {
  const twentiethParty = candidate("20th-party", "20th Party", "2000", {
    category: "SINGLE",
    releaseDate: "2000-05-17",
    originalReleaseDate: "2000-05-17",
  });
  const illFallInLove = candidate("ill-fall-in-love", "I'll fall in love", "2005", {
    category: "SINGLE",
    releaseDate: "2005-08-24",
    originalReleaseDate: "2005-08-24",
  });

  assert.equal(
    findUniqueItunesWorkCoverMatch(
      twentiethParty,
      [album(601, "20th Party", "2000", {
        releaseDate: "2000-06-28T00:00:00Z",
      })],
      900,
    ),
    null,
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      illFallInLove,
      [album(602, "I'll fall in love", "2005", {
        releaseDate: "2005-08-26T00:00:00Z",
      })],
      900,
    ),
    null,
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      twentiethParty,
      [album(603, "20th Party", "2000", {
        releaseDate: "2000-05-17T00:00:00Z",
      })],
      900,
    )?.collectionId,
    603,
    "an unsuffixed collection is safe only on the authoritative original day",
  );
  assert.equal(
    findUniqueItunesWorkCoverMatch(
      { ...twentiethParty, originalReleaseDate: "2000" },
      [album(604, "20th Party", "2000", {
        releaseDate: "2000-05-17T00:00:00Z",
      })],
      900,
    ),
    null,
    "an incomplete work date cannot authorize an unsuffixed Apple collection",
  );
});

test("binds a romanized Apple work only by dominant artist, exact original day, and category", () => {
  const release = candidate("romanized-single", "ツイてるねノッてるね", "1986", {
    category: "SINGLE",
    releaseDate: "1986-08-21",
    originalReleaseDate: "1986-08-21",
  });
  const romanized = album(501, "TSUITERUNE NOTTERUNE - EP", "1986", {
    releaseDate: "1986-08-21T00:00:00Z",
  });

  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(release, [romanized], 900)?.collectionId,
    501,
  );
  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(
      release,
      [romanized, album(502, "A DIFFERENT TITLE - Single", "1986", {
        releaseDate: "1986-08-21T00:00:00Z",
      })],
      900,
    ),
    null,
    "two category-compatible collections on the same day remain ambiguous",
  );
  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(
      { ...release, originalReleaseDate: "1986" },
      [romanized],
      900,
    ),
    null,
    "a full calendar day is mandatory",
  );
  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(
      { ...release, category: "ORIGINAL_ALBUM" },
      [romanized],
      900,
    ),
    null,
    "an EP result cannot supply an original-album cover",
  );
  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(
      release,
      [{ ...romanized, artistId: 901 }],
      900,
    ),
    null,
    "the collection must belong to the already established Apple artist",
  );
  assert.equal(
    findUniqueItunesDatedWorkCoverMatch(
      release,
      [{ ...romanized, releaseDate: "1986-08-22T00:00:00Z" }],
      900,
    ),
    null,
    "the Apple release day must equal the authoritative original day",
  );
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

test("seals a persisted Apple edition only with an exact entity id and full release day", () => {
  const release = candidate("one", "CATCH THE NITE", "1988", {
    releaseDate: "1988-02-10",
    originalReleaseDate: "1988-02-10",
  });
  const exact = album(44, "CATCH THE NITE", "1988", {
    releaseDate: "1988-02-10T00:00:00Z",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  });
  const binding = createPersistedItunesEditionCoverBinding(
    release,
    exact,
    "Miho Nakayama",
  );
  assert.ok(binding);
  assert.equal(binding.collectionId, 44);
  assert.equal(binding.artistId, 900);
  assert.equal(binding.releaseDate, "1988-02-10");
  assert.equal(binding.collectionName, "CATCH THE NITE");
  assert.equal(binding.candidateIdentity.releaseDate, "1988-02-10");
  assert.equal(appleCollectionIdFromStoreUrl(binding.sourceUrl), 44);
  assert.equal(exactItunesAlbumMatchesPersistedEditionBinding(release, exact, binding), true);

  assert.equal(createPersistedItunesEditionCoverBinding(release, {
    ...exact,
    releaseDate: "1988-12-10T00:00:00Z",
  }, "Miho Nakayama"), null, "same year and title are not enough");
  assert.equal(createPersistedItunesEditionCoverBinding(release, {
    ...exact,
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/45",
  }, "Miho Nakayama"), null, "the entity URL must carry the same collection id");
  assert.equal(exactItunesAlbumMatchesPersistedEditionBinding(release, {
    ...exact,
    artistId: 901,
  }, binding), false);
  assert.equal(exactItunesAlbumMatchesPersistedEditionBinding(release, {
    ...exact,
    collectionName: "Different Album",
  }, binding), false);
});

test("looks up one exact Apple collection entity without performing a search", async () => {
  const requestedUrls: URL[] = [];
  const exact = album(44, "CATCH THE NITE", "1988", {
    releaseDate: "1988-02-10T00:00:00Z",
    collectionViewUrl: "https://music.apple.com/jp/album/catch-the-nite/44",
  });
  const found = await lookupItunesAlbumByCollectionId(44, "Japan", {
    fetchImpl: async (input) => {
      requestedUrls.push(new URL(input));
      return {
        ok: true,
        json: async () => ({
          results: [
            { wrapperType: "collection", collectionType: "Album", ...exact },
            { wrapperType: "collection", collectionType: "Album", ...exact, collectionId: 45 },
          ],
        }),
      };
    },
    retryCount: 0,
  });
  assert.equal(found?.collectionId, 44);
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0]!.pathname, "/lookup");
  assert.equal(requestedUrls[0]!.searchParams.get("id"), "44");
  assert.equal(requestedUrls[0]!.searchParams.has("term"), false);

  const ambiguous = await lookupItunesAlbumByCollectionId(44, "Japan", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [
          { wrapperType: "collection", collectionType: "Album", ...exact },
          {
            wrapperType: "collection",
            collectionType: "Album",
            ...exact,
            collectionName: "Conflicting title",
          },
        ],
      }),
    }),
    retryCount: 0,
  });
  assert.equal(ambiguous, null, "conflicting rows for one collection id fail closed");
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

  await searchItunesAlbums("CATCH THE NITE", "Japan", {
    fetchImpl,
    attribute: "albumTerm",
    limit: 20,
  });
  assert.equal(requestedUrls[1]?.searchParams.get("attribute"), "albumTerm");
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

test("keeps the request deadline active while reading an iTunes JSON response body", {
  timeout: 1_000,
}, async () => {
  const albums = await searchItunesAlbums("Miho Nakayama", "Japan", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    }),
    timeoutMs: 5,
    retryCount: 0,
  });

  assert.deepEqual(albums, []);
});

test("retries only transient iTunes failures and keeps custom fetch retries immediate", async () => {
  let transientCalls = 0;
  const startedAt = Date.now();
  const recovered = await searchItunesAlbums("Miho Nakayama", "Japan", {
    retryCount: 2,
    fetchImpl: async () => {
      transientCalls += 1;
      if (transientCalls === 1) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (transientCalls === 2) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{
            wrapperType: "collection",
            collectionType: "Album",
            ...album(40, "C", "1985"),
          }],
        }),
      };
    },
  });
  assert.equal(transientCalls, 3);
  assert.equal(recovered[0]?.collectionId, 40);
  assert.ok(Date.now() - startedAt < 500, "a fake fetch must not inherit production pacing delays");

  let permanentCalls = 0;
  const rejected = await searchItunesAlbums("Miho Nakayama", "Japan", {
    retryCount: 4,
    fetchImpl: async () => {
      permanentCalls += 1;
      return { ok: false, status: 400, json: async () => ({}) };
    },
  });
  assert.deepEqual(rejected, []);
  assert.equal(permanentCalls, 1, "a permanent 4xx response is not retried");
});
