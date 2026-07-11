import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MUSIC_METADATA_USER_AGENT,
  MusicMetadataClient,
  isWhitelistedMusicMetadataSourceUrl,
  researchArtistReleaseEvidence,
  resolveMusicMetadataCountryCode,
  type MusicMetadataClientOptions,
  type MusicMetadataFetch,
  type MusicReleaseEvidence,
} from "@/lib/music-metadata";

const ARTIST_ID = "a1234567-89ab-4cde-8f01-23456789abcd";
const RELEASE_GROUP_ID = "b1234567-89ab-4cde-8f01-23456789abcd";
const RELEASE_ID = "c1234567-89ab-4cde-8f01-23456789abcd";

function releaseId(index: number) {
  return `${index.toString(16).padStart(8, "0")}-89ab-4cde-8f01-23456789abcd`;
}

function musicBrainzRelease(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: releaseId(index),
    title: `Release ${index}`,
    date: `2000-01-${String((index % 28) + 1).padStart(2, "0")}`,
    country: "JP",
    status: "Official",
    "release-group": {
      id: RELEASE_GROUP_ID,
      "primary-type": "Album",
      "secondary-types": [],
    },
    "artist-credit": [{ name: "中山美穂", artist: { name: "中山美穂" } }],
    "label-info": [{
      "catalog-number": `KICS-${index}`,
      label: { name: "King Records" },
    }],
    media: [{ format: "CD" }],
    ...overrides,
  };
}

function response(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    json: async () => payload,
  };
}

function testClient(fetchImpl: MusicMetadataFetch, overrides: Partial<MusicMetadataClientOptions> = {}) {
  return new MusicMetadataClient({
    fetchImpl,
    userAgent: "CD-BOX-tests/1.0 (test@example.invalid)",
    musicBrainzMinimumIntervalMs: 0,
    coverArtMinimumIntervalMs: 0,
    retryCount: 0,
    ...overrides,
  });
}

test("searches MusicBrainz artists with an escaped exact field query and explicit User-Agent", async () => {
  const requestedUrls: URL[] = [];
  const requestedInits: Array<RequestInit | undefined> = [];
  const fetchImpl: MusicMetadataFetch = async (input, init) => {
    requestedUrls.push(new URL(input));
    requestedInits.push(init);
    return response(200, {
      count: 1,
      offset: 0,
      artists: [{
        id: ARTIST_ID,
        name: "中山美穂",
        "sort-name": "Nakayama, Miho",
        country: "JP",
        type: "Person",
        score: 98,
        disambiguation: "Japanese singer and actress",
        aliases: [{
          name: "Miho Nakayama",
          "sort-name": "Miho Nakayama",
          locale: "en",
          type: "Artist name",
          primary: true,
        }],
      }],
    });
  };

  const result = await testClient(fetchImpl).searchArtists('Miho "M. C." Nakayama', {
    limit: 999,
  });

  const requestedUrl = requestedUrls[0];
  const requestedInit = requestedInits[0];
  assert.equal(requestedUrl?.origin, "https://musicbrainz.org");
  assert.equal(requestedUrl?.pathname, "/ws/2/artist/");
  assert.equal(requestedUrl?.searchParams.get("query"), 'artist:"Miho \\"M. C.\\" Nakayama"');
  assert.equal(requestedUrl?.searchParams.get("limit"), "100");
  assert.equal((requestedInit?.headers as Record<string, string>)["User-Agent"], "CD-BOX-tests/1.0 (test@example.invalid)");
  assert.equal((requestedInit?.headers as Record<string, string>).Accept, "application/json");
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.value.items[0], {
    sourceId: ARTIST_ID,
    name: "中山美穂",
    sortName: "Nakayama, Miho",
    aliases: [{
      name: "Miho Nakayama",
      sortName: "Miho Nakayama",
      locale: "en",
      type: "Artist name",
      primary: true,
    }],
    country: "JP",
    type: "Person",
    disambiguation: "Japanese singer and actress",
    score: 98,
    sourceUrl: `https://musicbrainz.org/artist/${ARTIST_ID}`,
    sources: [{
      provider: "musicbrainz",
      title: "MusicBrainz artist",
      url: `https://musicbrainz.org/artist/${ARTIST_ID}`,
    }],
  });
});

test("maps release groups into a uniform evidence shape without inventing edition fields", async () => {
  const requestedUrls: URL[] = [];
  const fetchImpl: MusicMetadataFetch = async (input) => {
    requestedUrls.push(new URL(input));
    return response(200, {
      count: 1,
      offset: 0,
      "release-groups": [{
        id: RELEASE_GROUP_ID,
        title: "C",
        "first-release-date": "1985-08",
        "primary-type": "Album",
        "secondary-types": ["Compilation"],
        "artist-credit": [{
          name: "中山美穂",
          joinphrase: " & ",
          artist: { name: "中山美穂" },
        }, {
          name: "WANDS",
          artist: { name: "WANDS" },
        }],
      }],
    });
  };

  const result = await testClient(fetchImpl).listReleaseGroups(ARTIST_ID, { limit: 25 });

  const requestedUrl = requestedUrls[0];
  assert.equal(requestedUrl?.searchParams.get("artist"), ARTIST_ID);
  assert.equal(requestedUrl?.searchParams.get("inc"), "artist-credits");
  assert.equal(result.warnings.length, 0);
  const evidence = result.value.items[0];
  assert.equal(evidence.entityType, "release-group");
  assert.equal(evidence.title, "C");
  assert.equal(evidence.artistCredit, "中山美穂 & WANDS");
  assert.deepEqual(evidence.artistNames, ["中山美穂", "WANDS"]);
  assert.equal(evidence.date, "1985-08");
  assert.equal(evidence.type, "Album");
  assert.deepEqual(evidence.secondaryTypes, ["Compilation"]);
  assert.equal(evidence.country, null);
  assert.equal(evidence.label, null);
  assert.equal(evidence.catalogNumber, null);
  assert.equal(evidence.format, null);
  assert.equal(evidence.coverUrl, null);
  assert.equal(evidence.sourceUrl, `https://musicbrainz.org/release-group/${RELEASE_GROUP_ID}`);
});

test("preserves release labels, catalog numbers, formats, aliases, and canonical source URL", async () => {
  const fetchImpl: MusicMetadataFetch = async () => response(200, {
    count: 1,
    offset: 0,
    releases: [{
      id: RELEASE_ID,
      title: "C",
      date: "1985-08-21",
      country: "JP",
      status: "Official",
      barcode: "4988003000012",
      "release-group": {
        id: RELEASE_GROUP_ID,
        "primary-type": "Album",
        "secondary-types": [],
      },
      "artist-credit": [{
        name: "中山美穂",
        artist: {
          name: "中山美穂",
          aliases: [{
            name: "Miho Nakayama",
            "sort-name": "Miho Nakayama",
            locale: "en",
            primary: true,
          }],
        },
      }],
      "label-info": [{
        "catalog-number": "KICS-123",
        label: { name: "King Records" },
      }],
      media: [{ format: "CD" }, { format: "CD" }],
    }],
  });

  const result = await testClient(fetchImpl).listReleases(RELEASE_GROUP_ID);
  const evidence = result.value.items[0];
  assert.equal(evidence.entityType, "release");
  assert.equal(evidence.releaseGroupId, RELEASE_GROUP_ID);
  assert.equal(evidence.artistCredit, "中山美穂");
  assert.equal(evidence.artistAliases[0]?.name, "Miho Nakayama");
  assert.equal(evidence.artistAliases[0]?.sortName, "Miho Nakayama");
  assert.equal(evidence.date, "1985-08-21");
  assert.equal(evidence.country, "JP");
  assert.equal(evidence.label, "King Records");
  assert.equal(evidence.catalogNumber, "KICS-123");
  assert.equal(evidence.format, "CD");
  assert.deepEqual(evidence.labels, [{ name: "King Records", catalogNumber: "KICS-123" }]);
  assert.deepEqual(evidence.formats, ["CD"]);
  assert.equal(evidence.sourceUrl, `https://musicbrainz.org/release/${RELEASE_ID}`);
  assert.deepEqual(evidence.sources, [{
    provider: "musicbrainz",
    title: "MusicBrainz release",
    url: `https://musicbrainz.org/release/${RELEASE_ID}`,
  }]);
});

test("uses only explicitly marked Cover Art Archive front images and prefers approved art", async () => {
  const fetchImpl: MusicMetadataFetch = async () => response(200, {
    images: [{
      front: false,
      approved: true,
      image: `http://coverartarchive.org/release/${RELEASE_ID}/back.jpg`,
      types: ["Back"],
    }, {
      front: true,
      approved: false,
      image: `http://coverartarchive.org/release/${RELEASE_ID}/front-unapproved.jpg`,
      types: ["Front"],
    }, {
      front: true,
      approved: true,
      image: `http://coverartarchive.org/release/${RELEASE_ID}/front.jpg`,
      types: ["Front"],
    }],
  });
  const client = testClient(fetchImpl);

  const cover = await client.getCoverArt("release", RELEASE_ID);
  assert.equal(cover.warnings.length, 0);
  assert.equal(cover.value?.imageUrl, `https://coverartarchive.org/release/${RELEASE_ID}/front.jpg`);
  assert.equal(cover.value?.approved, true);
  assert.deepEqual(cover.value?.types, ["Front"]);

  const baseEvidence: MusicReleaseEvidence = {
    entityType: "release",
    sourceId: RELEASE_ID,
    releaseGroupId: RELEASE_GROUP_ID,
    title: "C",
    artistCredit: "中山美穂",
    artistNames: ["中山美穂"],
    artistAliases: [],
    date: null,
    type: null,
    secondaryTypes: [],
    country: null,
    label: null,
    catalogNumber: null,
    format: null,
    labels: [],
    formats: [],
    barcode: null,
    status: null,
    sourceUrl: `https://musicbrainz.org/release/${RELEASE_ID}`,
    coverUrl: null,
    coverSourceUrl: null,
    sources: [{
      provider: "musicbrainz",
      title: "MusicBrainz release",
      url: `https://musicbrainz.org/release/${RELEASE_ID}`,
    }],
  };
  const enriched = await client.enrichWithCoverArt(baseEvidence);
  assert.equal(enriched.value.coverUrl, `https://coverartarchive.org/release/${RELEASE_ID}/front.jpg`);
  assert.equal(enriched.value.coverSourceUrl, `https://coverartarchive.org/release/${RELEASE_ID}`);
  assert.equal(enriched.value.sources.at(-1)?.provider, "cover-art-archive");
});

test("uses a bounded retry and successful-response cache without sharing mutable results", async () => {
  let fetchCount = 0;
  const delays: number[] = [];
  const client = testClient(async () => {
    fetchCount += 1;
    if (fetchCount === 1) return response(503, {});
    return response(200, {
      count: 1,
      offset: 0,
      artists: [{ id: ARTIST_ID, name: "中山美穂" }],
    });
  }, {
    retryCount: 1,
    cacheTtlMs: 60_000,
    sleep: async (milliseconds: number) => {
      delays.push(milliseconds);
    },
  });

  const first = await client.searchArtists("Miho Nakayama");
  first.value.items[0].name = "mutated by caller";
  const second = await client.searchArtists("Miho Nakayama");

  assert.equal(fetchCount, 2, "the second public call should use the successful JSON cache");
  assert.deepEqual(delays, [250]);
  assert.equal(second.value.items[0].name, "中山美穂");
});

test("degrades to empty evidence with a warning when a public source stays unavailable", async () => {
  let fetchCount = 0;
  const client = testClient(async () => {
    fetchCount += 1;
    return response(503, {});
  }, {
    retryCount: 1,
    sleep: async () => undefined,
  });

  const artists = await client.searchArtists("Miho Nakayama");
  assert.equal(fetchCount, 2);
  assert.deepEqual(artists.value.items, []);
  assert.equal(artists.warnings[0]?.source, "musicbrainz");
  assert.equal(artists.warnings[0]?.code, "unavailable");
  assert.equal(artists.warnings[0]?.retryable, true);
});

test("treats a missing Cover Art Archive entry as no cover rather than a fatal error", async () => {
  const cover = await testClient(async () => response(404, {})).getCoverArt("release-group", RELEASE_GROUP_ID);
  assert.equal(cover.value, null);
  assert.deepEqual(cover.warnings, []);
});

test("spaces request starts according to the configured public-service interval", async () => {
  let now = 0;
  const requestTimes: number[] = [];
  const client = testClient(async () => {
    requestTimes.push(now);
    return response(200, { count: 0, offset: 0, artists: [] });
  }, {
    musicBrainzMinimumIntervalMs: 1_000,
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
  });

  await client.searchArtists("first");
  await client.searchArtists("second");
  assert.deepEqual(requestTimes, [0, 1_000]);
});

test("uses the public repository URL in the default metadata User-Agent", () => {
  assert.equal(
    DEFAULT_MUSIC_METADATA_USER_AGENT,
    "CD-BOX/0.1.0 (https://github.com/KAtOReNA7/CD-BOX)",
  );
});

test("maps supported country aliases without silently treating unknown regions as Japan", () => {
  assert.equal(resolveMusicMetadataCountryCode(undefined), "JP");
  assert.equal(resolveMusicMetadataCountryCode("Japan"), "JP");
  assert.equal(resolveMusicMetadataCountryCode("China"), "CN");
  assert.equal(resolveMusicMetadataCountryCode("中国"), "CN");
  assert.equal(resolveMusicMetadataCountryCode("中国（大陆）"), "CN");
  assert.equal(resolveMusicMetadataCountryCode("Hong Kong"), "HK");
  assert.equal(resolveMusicMetadataCountryCode("臺灣"), "TW");
  assert.equal(resolveMusicMetadataCountryCode("South Korea"), "KR");
  assert.equal(resolveMusicMetadataCountryCode("United States"), "US");
  assert.equal(resolveMusicMetadataCountryCode("United Kingdom"), "GB");
  assert.throws(
    () => resolveMusicMetadataCountryCode("unknown-region"),
    /Unsupported artist country or region/,
  );
});

test("browses artist releases in no more than two MusicBrainz pages and 200 rows", async () => {
  const requestedUrls: URL[] = [];
  const client = testClient(async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);
    const offset = Number(url.searchParams.get("offset"));
    return response(200, {
      count: 250,
      offset,
      releases: Array.from({ length: 100 }, (_, index) =>
        musicBrainzRelease(offset + index + 1),
      ),
    });
  });

  const result = await client.listArtistReleases(ARTIST_ID);

  assert.equal(requestedUrls.length, 2);
  assert.deepEqual(requestedUrls.map((url) => url.searchParams.get("offset")), ["0", "100"]);
  assert.ok(requestedUrls.every((url) => url.searchParams.get("artist") === ARTIST_ID));
  assert.ok(requestedUrls.every((url) =>
    url.searchParams.get("inc") === "artist-credits+labels+media+release-groups",
  ));
  assert.equal(result.value.count, 250);
  assert.equal(result.value.items.length, 200);
  assert.equal(result.value.limit, 200);
});

test("research aggregation resolves an exact alias to the Japanese artist and strictly filters evidence", async () => {
  const requestUrls: URL[] = [];
  const usArtistId = "e1234567-89ab-4cde-8f01-23456789abcd";
  const rows = [
    musicBrainzRelease(1, { title: "Accepted CD" }),
    musicBrainzRelease(2, { status: "Bootleg" }),
    musicBrainzRelease(3, { country: "US" }),
    musicBrainzRelease(4, { media: [{ format: "Digital Media" }] }),
    musicBrainzRelease(5, {
      "artist-credit": [
        { name: "中山美穂", joinphrase: " & ", artist: { name: "中山美穂" } },
        { name: "WANDS", artist: { name: "WANDS" } },
      ],
    }),
    musicBrainzRelease(6, {
      "release-group": {
        id: RELEASE_GROUP_ID,
        "primary-type": "Album",
        "secondary-types": ["Compilation"],
      },
    }),
    musicBrainzRelease(1, { title: "Duplicate response row" }),
  ];
  const client = testClient(async (input) => {
    const url = new URL(input);
    requestUrls.push(url);
    if (url.pathname === "/ws/2/artist/") {
      return response(200, {
        count: 2,
        offset: 0,
        artists: [{
          id: usArtistId,
          name: "中山美穂",
          country: "US",
          score: 100,
          aliases: [{ name: "Miho Nakayama", locale: "en", primary: true }],
        }, {
          id: ARTIST_ID,
          name: "中山美穂",
          country: "JP",
          score: 95,
          aliases: [{ name: "Miho Nakayama", locale: "en", primary: true }],
        }],
      });
    }
    return response(200, { count: rows.length, offset: 0, releases: rows });
  });

  const bundle = await researchArtistReleaseEvidence({
    artistName: "Miho Nakayama",
    country: "Japan",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: false,
    includeLiveRemixBest: false,
    maxCoverLookups: 0,
  }, { client });

  assert.equal(bundle.artist?.sourceId, ARTIST_ID, "JP country evidence must outrank the higher-scored US homonym");
  assert.equal(bundle.artist?.name, "中山美穂");
  assert.equal(bundle.releases.length, 1);
  assert.equal(bundle.releases[0].evidence.title, "Accepted CD");
  assert.ok(bundle.releases[0].warnings.includes("missing-cover"));
  assert.equal(bundle.stats.releasesFetched, 6, "duplicate source ids are counted only once");
  assert.equal(requestUrls.filter((url) => url.pathname === "/ws/2/release").length, 1);
  assert.equal(requestUrls.filter((url) => url.hostname === "coverartarchive.org").length, 0);
  assert.equal(bundle.warnings.find((item) => item.code === "non-official-filtered")?.count, 1);
  assert.equal(bundle.warnings.find((item) => item.code === "outside-country-filtered")?.count, 1);
  assert.equal(bundle.warnings.find((item) => item.code === "outside-format-scope")?.count, 1);
  assert.equal(bundle.warnings.find((item) => item.code === "collaboration-filtered")?.count, 1);
  assert.equal(bundle.warnings.find((item) => item.code === "release-type-filtered")?.count, 1);
  assert.ok(bundle.warnings.some((item) => item.code === "reissue-status-unavailable"));
  assert.ok(bundle.sourceWhitelist.includes(`https://musicbrainz.org/artist/${ARTIST_ID}`));
  assert.ok(bundle.sourceWhitelist.includes(`https://musicbrainz.org/release/${releaseId(1)}`));
  assert.ok(bundle.sourceWhitelist.every(isWhitelistedMusicMetadataSourceUrl));
});

test("research aggregation refuses same-country artist ambiguity before fetching releases", async () => {
  let releaseRequests = 0;
  const otherArtistId = "f1234567-89ab-4cde-8f01-23456789abcd";
  const client = testClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/ws/2/release") releaseRequests += 1;
    return response(200, {
      count: 2,
      offset: 0,
      artists: [{
        id: ARTIST_ID,
        name: "同名歌手",
        country: "JP",
        score: 100,
      }, {
        id: otherArtistId,
        name: "同名歌手",
        country: "JP",
        score: 98,
      }],
    });
  });

  const bundle = await researchArtistReleaseEvidence({
    artistName: "同名歌手",
    country: "JP",
    target: "ALL_CD",
    excludeReissues: false,
    includeCollaborations: true,
    includeLiveRemixBest: true,
  }, { client });

  assert.equal(bundle.artist, null);
  assert.deepEqual(bundle.releases, []);
  assert.equal(releaseRequests, 0);
  assert.ok(bundle.warnings.some((item) => item.code === "artist-ambiguous"));
});

test("research aggregation caps candidates and release-specific cover lookups", async () => {
  let coverRequests = 0;
  const releases = [
    musicBrainzRelease(11, { date: "2000-01-01" }),
    musicBrainzRelease(12, { date: "2001-01-01" }),
    musicBrainzRelease(13, { date: "2002-01-01" }),
  ];
  const client = testClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/ws/2/artist/") {
      return response(200, {
        count: 1,
        offset: 0,
        artists: [{
          id: ARTIST_ID,
          name: "中山美穂",
          country: "JP",
          score: 100,
          aliases: [{ name: "Miho Nakayama" }],
        }],
      });
    }
    if (url.hostname === "coverartarchive.org") {
      coverRequests += 1;
      const id = url.pathname.split("/").at(-1);
      return response(200, {
        images: [{
          front: true,
          approved: true,
          image: `https://coverartarchive.org/release/${id}/front.jpg`,
          types: ["Front"],
        }],
      });
    }
    return response(200, { count: releases.length, offset: 0, releases });
  });

  const bundle = await researchArtistReleaseEvidence({
    artistName: "Miho Nakayama",
    country: "JP",
    target: "ALL_CD",
    excludeReissues: false,
    includeCollaborations: true,
    includeLiveRemixBest: true,
    maxCandidates: 2,
    maxCoverLookups: 1,
  }, { client });

  assert.equal(bundle.releases.length, 2);
  assert.equal(bundle.stats.coverLookups, 1);
  assert.equal(coverRequests, 1);
  assert.ok(bundle.releases[0].evidence.coverUrl);
  assert.equal(bundle.releases[1].evidence.coverUrl, null);
  assert.equal(bundle.warnings.find((item) => item.code === "candidate-limit")?.count, 1);
  assert.equal(bundle.warnings.find((item) => item.code === "cover-lookup-limit")?.count, 1);
  assert.ok(bundle.sourceWhitelist.includes(
    `https://coverartarchive.org/release/${releaseId(11)}`,
  ));
});

test("research aggregation keeps Chinese artist and release evidence in the CN country scope", async () => {
  const chineseArtistId = "d1234567-89ab-4cde-8f01-23456789abcd";
  const releases = [
    musicBrainzRelease(21, {
      title: "中国大陆版",
      country: "CN",
      "artist-credit": [{ name: "王菲", artist: { name: "王菲" } }],
    }),
    musicBrainzRelease(22, {
      title: "日本版",
      country: "JP",
      "artist-credit": [{ name: "王菲", artist: { name: "王菲" } }],
    }),
  ];
  const client = testClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/ws/2/artist/") {
      return response(200, {
        count: 1,
        offset: 0,
        artists: [{
          id: chineseArtistId,
          name: "王菲",
          country: "CN",
          score: 100,
          aliases: [{ name: "Faye Wong" }],
        }],
      });
    }
    return response(200, { count: releases.length, offset: 0, releases });
  });

  const bundle = await researchArtistReleaseEvidence({
    artistName: "Faye Wong",
    country: "China",
    target: "ALL_CD",
    excludeReissues: false,
    includeCollaborations: true,
    includeLiveRemixBest: true,
    maxCoverLookups: 0,
  }, { client });

  assert.equal(bundle.query.targetCountry, "CN");
  assert.equal(bundle.artist?.sourceId, chineseArtistId);
  assert.deepEqual(bundle.releases.map((item) => item.evidence.title), ["中国大陆版"]);
  assert.equal(bundle.warnings.find((item) => item.code === "outside-country-filtered")?.count, 1);
});

test("research aggregation performs at most four cover lookups by default", async () => {
  let coverRequests = 0;
  const releases = Array.from({ length: 5 }, (_, index) =>
    musicBrainzRelease(30 + index, { date: `200${index}-01-01` }),
  );
  const client = testClient(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/ws/2/artist/") {
      return response(200, {
        count: 1,
        offset: 0,
        artists: [{ id: ARTIST_ID, name: "中山美穂", country: "JP", score: 100 }],
      });
    }
    if (url.hostname === "coverartarchive.org") {
      coverRequests += 1;
      return response(404, {});
    }
    return response(200, { count: releases.length, offset: 0, releases });
  });

  const bundle = await researchArtistReleaseEvidence({
    artistName: "中山美穂",
    country: "Japan",
    target: "ALL_CD",
    excludeReissues: false,
    includeCollaborations: true,
    includeLiveRemixBest: true,
  }, { client });

  assert.equal(coverRequests, 4);
  assert.equal(bundle.stats.coverLookups, 4);
  assert.equal(bundle.warnings.find((item) => item.code === "cover-lookup-limit")?.count, 1);
});
