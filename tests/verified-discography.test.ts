import assert from "node:assert/strict";
import test from "node:test";
import type { CoverAssetValidationResult } from "@/lib/ai/cover-asset-validation";
import type {
  ReleaseCrossSourceEvidence,
  ReleaseEvidenceAuditDecision,
} from "@/lib/ai/release-evidence-audit";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchRequest,
  ReleaseResearchResult,
} from "@/lib/ai/release-research-types";
import { verifyDiscographyResult } from "@/lib/ai/verified-discography";
import type {
  DiscogsJapanCdSearchResult,
  DiscogsReleaseEvidence,
  DiscogsResult,
  DiscogsSearchReleaseEvidence,
  DiscogsWarning,
} from "@/lib/discogs/types";
import type { ArtistReleaseEvidenceBundle } from "@/lib/music-metadata/types";
import type { NdlRecord } from "@/lib/ndl/types";

const defaultCandidateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const defaultDiscogsImage = "https://i.discogs.com/verified-cover.jpeg";

const request: ReleaseResearchRequest = {
  artistName: "Miho Nakayama",
  country: "Japan",
  target: "ORIGINAL_CD",
  excludeReissues: true,
  includeCollaborations: true,
  includeLiveRemixBest: true,
};

function candidate(overrides: Partial<ReleaseResearchCandidate> = {}): ReleaseResearchCandidate {
  const id = overrides.id ?? defaultCandidateId;
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
    editionType: null,
    isReissue: null,
    isRemaster: null,
    isExcludedByDefault: false,
    coverImageUrl: null,
    coverImageSourceUrl: null,
    notes: null,
    confidence: "MEDIUM",
    warnings: ["PENDING_REVIEW: source evidence has not been cross-checked."],
    sources: [
      {
        title: "MusicBrainz release group",
        url: `https://musicbrainz.org/release-group/${id}`,
        sourceType: "database",
      },
      {
        title: "MusicBrainz release",
        url: `https://musicbrainz.org/release/${id}`,
        sourceType: "database",
      },
    ],
    verification: null,
    ...overrides,
  };
}

function researchResult(releases: ReleaseResearchCandidate[]): ReleaseResearchResult {
  return {
    artist: {
      name: "Miho Nakayama",
      nameKana: null,
      nameRomaji: "Miho Nakayama",
      country: "Japan",
      officialSiteUrl: null,
    },
    collectionScope: {
      target: request.target,
      excludeReissues: request.excludeReissues,
      includeCollaborations: request.includeCollaborations,
    },
    releases,
    globalWarnings: ["PENDING_REVIEW: candidates require verification."],
    verificationSummary: null,
  };
}

function evidenceBundle(releaseCount: number): ArtistReleaseEvidenceBundle {
  const releases = Array.from({ length: releaseCount }, (_, index) => {
    const sourceId = `${index + 1}`.padStart(8, "0") + "-0000-4000-8000-000000000000";
    return {
      evidence: {
        entityType: "release" as const,
        sourceId,
        releaseGroupId: sourceId,
        title: "CATCH THE NITE",
        artistCredit: "Miho Nakayama",
        artistNames: ["Miho Nakayama"],
        artistAliases: [],
        date: "1988-02-10",
        type: "Album",
        secondaryTypes: [],
        country: "JP",
        label: "King Records",
        catalogNumber: "K32X-240",
        format: "CD",
        labels: [{ name: "King Records", catalogNumber: "K32X-240" }],
        formats: ["CD"],
        barcode: "4988003002400",
        status: "Official",
        sourceUrl: `https://musicbrainz.org/release/${sourceId}`,
        coverUrl: null,
        coverSourceUrl: null,
        sources: [{
          provider: "musicbrainz" as const,
          title: "MusicBrainz release",
          url: `https://musicbrainz.org/release/${sourceId}`,
        }],
      },
      warnings: ["missing-cover" as const],
    };
  });

  return {
    query: {
      artistName: request.artistName,
      targetCountry: "JP",
      target: request.target,
    },
    artist: {
      sourceId: "11111111-1111-4111-8111-111111111111",
      name: "Miho Nakayama",
      sortName: "Nakayama, Miho",
      aliases: [],
      country: "JP",
      type: "Person",
      disambiguation: null,
      officialUrls: [],
      score: 100,
      sourceUrl: "https://musicbrainz.org/artist/11111111-1111-4111-8111-111111111111",
      sources: [{
        provider: "musicbrainz",
        title: "MusicBrainz artist",
        url: "https://musicbrainz.org/artist/11111111-1111-4111-8111-111111111111",
      }],
    },
    releases,
    sourceWhitelist: releases.flatMap((item) => item.evidence.sources.map((source) => source.url)),
    warnings: [],
    stats: {
      artistResultsInspected: 1,
      releaseGroupsFetched: releaseCount,
      releasesFetched: releaseCount,
      releasesAcceptedBeforeGrouping: releaseCount,
      releaseGroupsAccepted: releaseCount,
      releasesDeduplicated: 0,
      releasesAccepted: releaseCount,
      coverLookups: 0,
    },
  };
}

function searchRow(
  overrides: Partial<DiscogsSearchReleaseEvidence> = {},
): DiscogsSearchReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: 101,
    masterId: 501,
    title: "Miho Nakayama - CATCH THE NITE",
    year: 1988,
    country: "Japan",
    formats: ["CD"],
    labels: ["King Records"],
    catalogNumber: "K32X-240",
    barcode: "4988003002400",
    apiUrl: "https://api.discogs.com/releases/101",
    sourceUrl: "https://www.discogs.com/release/101",
    thumbnailUrl: null,
    coverImageUrl: defaultDiscogsImage,
    ...overrides,
  };
}

function releaseDetail(overrides: Partial<DiscogsReleaseEvidence> = {}): DiscogsReleaseEvidence {
  return {
    evidenceRole: "corroborating-only",
    releaseId: 101,
    masterId: 501,
    status: "Accepted",
    dataQuality: "Correct",
    title: "CATCH THE NITE",
    artistCredit: "Miho Nakayama",
    artists: [{ name: "Miho Nakayama", anv: null, join: null }],
    year: 1988,
    released: "1988-02-10",
    country: "Japan",
    labels: [{ name: "King Records", catalogNumber: "K32X-240" }],
    formats: [{ name: "CD", quantity: 1, descriptions: ["Album"] }],
    identifiers: [{ type: "Barcode", value: "4988003002400", description: null }],
    barcodes: ["4988003002400"],
    tracks: [],
    images: [{
      type: "primary",
      url: defaultDiscogsImage,
      thumbnailUrl: null,
      width: 600,
      height: 600,
    }],
    primaryImageUrl: defaultDiscogsImage,
    displayImageUrl: defaultDiscogsImage,
    apiUrl: "https://api.discogs.com/releases/101",
    sourceUrl: "https://www.discogs.com/release/101",
    ...overrides,
  };
}

function tracks(titles: readonly string[]) {
  return titles.map((title, index) => ({
    position: String(index + 1),
    title,
    duration: null,
    type: "track",
  }));
}

function fakeDiscogs(input: {
  rows: DiscogsSearchReleaseEvidence[];
  details?: Map<number, DiscogsReleaseEvidence>;
  partial?: boolean;
  warnings?: DiscogsWarning[];
}) {
  const getReleaseCalls: number[] = [];
  const details = input.details ?? new Map<number, DiscogsReleaseEvidence>();
  const client = {
    async searchJapanCdReleases(artistQuery: string) {
      return {
        value: {
          evidenceRole: "corroborating-only",
          artistQuery,
          items: [...input.rows],
          sourceTotal: input.rows.length,
          pagesFetched: 1,
          partial: input.partial ?? false,
        },
        warnings: input.warnings ?? [],
        rateLimit: null,
      } satisfies DiscogsResult<DiscogsJapanCdSearchResult>;
    },
    async getRelease(releaseId: number) {
      getReleaseCalls.push(releaseId);
      return {
        value: details.get(releaseId) ?? null,
        warnings: [],
        rateLimit: null,
      } satisfies DiscogsResult<DiscogsReleaseEvidence | null>;
    },
  };
  return { client, getReleaseCalls };
}

function ndlRecord(overrides: Partial<NdlRecord> = {}): NdlRecord {
  return {
    recordId: "R100000002-I000008888764",
    sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
    title: "Miho Nakayama / CATCH THE NITE",
    creators: ["Miho Nakayama"],
    publishers: ["King Records"],
    issued: "1988-02-10",
    issuedRaw: "1988.2.10",
    issuedPrecision: "day",
    identifiers: ["K32X-240"],
    identifierDetails: [{ value: "K32X-240", scheme: "dcndl:RIS502" }],
    catalogNumbers: ["K32X-240"],
    ...overrides,
  };
}

function fakeNdl(records: NdlRecord[] = [ndlRecord()]) {
  const value = {
    queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch?any=Miho%20Nakayama",
    sourceTotal: records.length,
    complete: true,
    records,
  };
  return {
    async searchArtistInventory() {
      return { value: structuredClone(value), warnings: [] };
    },
    async searchCatalogNumber() {
      return { value: structuredClone(value), warnings: [] };
    },
  };
}

function coverResult(ok: boolean, host = "i.discogs.com"): CoverAssetValidationResult {
  return {
    ok,
    reason: ok ? "valid" : "not-image",
    retryable: false,
    attempts: 1,
    redirects: 0,
    status: 200,
    contentType: ok ? "image/jpeg" : "text/html",
    bytesRead: ok ? 64 : 0,
    sourceHost: host,
    finalHost: host,
    imageFormat: ok ? "jpeg" : null,
    width: ok ? 600 : null,
    height: ok ? 600 : null,
  };
}

function acceptAll(
  capture?: ReleaseCrossSourceEvidence[][],
): (
  evidence: readonly ReleaseCrossSourceEvidence[],
  apiKeyOverride?: string,
) => Promise<ReleaseEvidenceAuditDecision[]> {
  return async (evidence) => {
    capture?.push([...evidence]);
    return evidence.map((item) => ({
      id: item.candidate.id,
      decision: "ACCEPT" as const,
      reasonCode: "EVIDENCE_CONSISTENT" as const,
      reason: "The independent edition evidence is consistent.",
    }));
  };
}

test("returns a strongly matched release only after its Discogs cover validates", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail()]]),
  });
  const coverCalls: string[] = [];
  const audited: ReleaseCrossSourceEvidence[][] = [];

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async (value) => {
        coverCalls.push(value.toString());
        return coverResult(true);
      },
      auditEvidence: acceptAll(audited),
      now: () => new Date("2026-07-11T08:00:00.000Z"),
    },
  );

  assert.deepEqual(coverCalls, [defaultDiscogsImage]);
  assert.equal(audited[0]?.length, 1);
  assert.equal(verified.releases.length, 1);
  assert.equal(verified.releases[0]?.coverImageUrl, defaultDiscogsImage);
  assert.equal(verified.releases[0]?.verification?.status, "VERIFIED");
  assert.equal(verified.releases[0]?.verification?.coverProvider, "discogs");
  assert.equal(verified.releases[0]?.verification?.checkedAt, "2026-07-11T08:00:00.000Z");
  assert.ok(verified.releases[0]?.verification?.matchedFields.includes("barcode"));
  assert.ok(verified.releases[0]?.sources.some((source) =>
    source.url === "https://www.discogs.com/release/101"));
  assert.deepEqual(verified.verificationSummary, {
    rawReleases: 1,
    releaseGroups: 1,
    canonicalEditions: 1,
    authoritativeMatches: 1,
    crossSourceMatches: 1,
    aiAccepted: 1,
    rejectedByEvidence: 0,
    rejectedByAi: 0,
    rejectedWithoutCover: 0,
    rejectedCoverUnavailable: 0,
  });
});

test("keeps the canonical work date separate from a later verified CD edition", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail()]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({ originalReleaseDate: "1980-07-01" })]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => coverResult(true),
      auditEvidence: acceptAll(),
    },
  );

  assert.equal(verified.releases.length, 1);
  assert.equal(verified.releases[0]?.originalReleaseDate, "1980-07-01");
  assert.equal(verified.releases[0]?.releaseDate, "1988-02-10");
});

test("uses the national bibliography title as the final display title", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow({ title: "Miho Nakayama - COMPLETELY WRONG ENGLISH TITLE" })],
    details: new Map([[101, releaseDetail({ title: "COMPLETELY WRONG ENGLISH TITLE" })]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({ title: "COMPLETELY WRONG ENGLISH TITLE" })]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl([ndlRecord({ title: "Miho Nakayama / \u6b63\u3057\u3044\u30a2\u30eb\u30d0\u30e0" })]),
      validateCover: async () => coverResult(true),
      auditEvidence: async (evidence) => evidence.map((item) => ({
        id: item.candidate.id,
        decision: "ACCEPT" as const,
        reasonCode: "TITLE_TRANSLITERATION_EQUIVALENT" as const,
        reason: "The catalog-bound title pair was accepted for this test.",
      })),
    },
  );

  assert.equal(verified.releases.length, 1);
  assert.equal(verified.releases[0]?.title, "\u6b63\u3057\u3044\u30a2\u30eb\u30d0\u30e0");
  assert.equal(verified.releases[0]?.titleOriginal, "COMPLETELY WRONG ENGLISH TITLE");
  assert.notEqual(verified.releases[0]?.title, "COMPLETELY WRONG ENGLISH TITLE");
});

test("rejects Discogs detail evidence whose master does not match its search row", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow({ masterId: 501 })],
    details: new Map([[101, releaseDetail({ masterId: 999 })]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("mismatched master evidence must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("rejects a candidate before Discogs when the NDL national bibliography has no unique record", async () => {
  const fake = fakeDiscogs({ rows: [searchRow()], details: new Map([[101, releaseDetail()]]) });
  const empty = {
    queryUrl: "https://ndlsearch.ndl.go.jp/api/opensearch?any=K32X-240",
    sourceTotal: 0,
    records: [],
    complete: true,
  };

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: {
        searchArtistInventory: async () => ({ value: empty, warnings: [] }),
        searchCatalogNumber: async () => ({ value: empty, warnings: [] }),
      },
      validateCover: async () => {
        throw new Error("a candidate absent from NDL must not reach cover validation");
      },
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.deepEqual(fake.getReleaseCalls, []);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.authoritativeMatches, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("continues to the exact Cover Art Archive release API when Discogs has no primary image", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail({ images: [], primaryImageUrl: null })]]),
  });
  const imageUrl = `https://coverartarchive.org/release/${defaultCandidateId}/front-500`;

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      musicMetadata: {
        getCoverArt: async () => ({
          value: {
            entityType: "release",
            sourceId: defaultCandidateId,
            imageUrl,
            sourceUrl: `https://coverartarchive.org/release/${defaultCandidateId}`,
            approved: true,
            types: ["Front"],
          },
          warnings: [],
        }),
      },
      validateCover: async () => coverResult(true, "coverartarchive.org"),
      auditEvidence: acceptAll(),
    },
  );

  assert.equal(verified.releases[0]?.coverImageUrl, imageUrl);
  assert.equal(verified.releases[0]?.verification?.coverProvider, "cover-art-archive");
});

test("does not accept an unapproved Cover Art Archive front image", async () => {
  const fake = fakeDiscogs({ rows: [searchRow()], details: new Map([[101, releaseDetail()]]) });
  const embeddedImage = `https://coverartarchive.org/release/${defaultCandidateId}/front-500`;

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({
      coverImageUrl: embeddedImage,
      coverImageSourceUrl: `https://coverartarchive.org/release/${defaultCandidateId}`,
    })]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      musicMetadata: {
        getCoverArt: async () => ({
          value: {
            entityType: "release",
            sourceId: defaultCandidateId,
            imageUrl: embeddedImage,
            sourceUrl: `https://coverartarchive.org/release/${defaultCandidateId}`,
            approved: false,
            types: ["Front"],
          },
          warnings: [],
        }),
      },
      validateCover: async (url) => {
        assert.equal(url.toString(), defaultDiscogsImage);
        return coverResult(true);
      },
      auditEvidence: acceptAll(),
    },
  );

  assert.equal(verified.releases[0]?.coverImageUrl, defaultDiscogsImage);
  assert.equal(verified.releases[0]?.verification?.coverProvider, "discogs");
});

test("rejects a Discogs detail whose full release date conflicts", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail({ released: "1988-03-10" })]]),
  });
  const auditBatchSizes: number[] = [];

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("cover validation must not run for conflicting metadata");
      },
      auditEvidence: async (evidence) => {
        auditBatchSizes.push(evidence.length);
        return [];
      },
    },
  );

  assert.deepEqual(fake.getReleaseCalls, [101]);
  assert.deepEqual(auditBatchSizes, [0]);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
  assert.equal(verified.verificationSummary?.rejectedByEvidence, 1);
});

test("requires a second independent source to confirm the complete release day", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail({ released: null })]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl([ndlRecord({
        issued: "1988-02",
        issuedRaw: "1988.2",
        issuedPrecision: "month",
      })]),
      validateCover: async () => {
        throw new Error("a day supported only by MusicBrainz must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("rejects extra Discogs artists when collaborations are disabled", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail({
      artistCredit: "Miho Nakayama & Wrong Artist",
      artists: [
        { name: "Miho Nakayama", anv: null, join: " & " },
        { name: "Wrong Artist", anv: null, join: null },
      ],
    })]]),
  });
  const verified = await verifyDiscographyResult(
    { ...request, includeCollaborations: false },
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("an out-of-scope collaboration must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("does not erase a Discogs numeric artist disambiguation suffix", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail({
      artistCredit: "Miho Nakayama (2)",
      artists: [{ name: "Miho Nakayama (2)", anv: "Miho Nakayama", join: null }],
    })]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("a different Discogs artist entity must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("does not treat overlapping bilingual title fragments as transitive equality", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow({ title: "Miho Nakayama - ALPHA = BETA" })],
    details: new Map([[101, releaseDetail({ title: "BETA = GAMMA" })]]),
  });

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({ title: "ALPHA = BETA", titleOriginal: "CATCH THE NITE" })]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("a transitive title mismatch must not reach cover validation");
      },
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("rejects a later edition when the same Discogs master has an earlier Japanese CD", async () => {
  const fake = fakeDiscogs({
    rows: [
      searchRow(),
      searchRow({
        releaseId: 99,
        year: 1987,
        catalogNumber: "K32X-100",
        apiUrl: "https://api.discogs.com/releases/99",
        sourceUrl: "https://www.discogs.com/release/99",
      }),
    ],
    details: new Map([[101, releaseDetail()]]),
  });

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("a reissue shortlist must not reach cover validation");
      },
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.deepEqual(fake.getReleaseCalls, []);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.rejectedByEvidence, 1);
});

test("uses an earlier Discogs edition as a veto even when NDL does not contain it", async () => {
  const laterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const earlierTracks = ["One", "Two", "Three", "Four"];
  const coverCalls: string[] = [];
  const fake = fakeDiscogs({
    rows: [
      searchRow(),
      searchRow({
        releaseId: 202,
        masterId: 502,
        title: "Miho Nakayama - NIGHT AGAIN",
        year: 1992,
        catalogNumber: "KICS-240",
        barcode: "4988003009999",
        apiUrl: "https://api.discogs.com/releases/202",
        sourceUrl: "https://www.discogs.com/release/202",
        coverImageUrl: "https://i.discogs.com/verified-cover-202.jpeg",
      }),
    ],
    details: new Map([
      [101, releaseDetail({ tracks: tracks(earlierTracks) })],
      [202, releaseDetail({
        releaseId: 202,
        masterId: 502,
        title: "NIGHT AGAIN",
        year: 1992,
        released: "1992-02-10",
        labels: [{ name: "King Records", catalogNumber: "KICS-240" }],
        identifiers: [{ type: "Barcode", value: "4988003009999", description: null }],
        barcodes: ["4988003009999"],
        tracks: tracks([...earlierTracks, "Bonus Track"]),
        primaryImageUrl: "https://i.discogs.com/verified-cover-202.jpeg",
        sourceUrl: "https://www.discogs.com/release/202",
        apiUrl: "https://api.discogs.com/releases/202",
      })],
    ]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([
      candidate(),
      candidate({
        id: laterId,
        title: "NIGHT AGAIN",
        releaseDate: "1992-02-10",
        originalReleaseDate: "1992-02-10",
        catalogNumber: "KICS-240",
        barcode: "4988003009999",
        sources: [
          { title: "MusicBrainz release group", url: `https://musicbrainz.org/release-group/${laterId}`, sourceType: "database" },
          { title: "MusicBrainz release", url: `https://musicbrainz.org/release/${laterId}`, sourceType: "database" },
        ],
      }),
    ]),
    evidenceBundle(2),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl([
        ndlRecord({
          recordId: "R100000002-I000008888765",
          sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888765",
          title: "Miho Nakayama / NIGHT AGAIN",
          issued: "1992-02-10",
          issuedRaw: "1992.2.10",
          identifiers: ["KICS-240"],
          identifierDetails: [{ value: "KICS-240", scheme: "dcndl:RIS502" }],
          catalogNumbers: ["KICS-240"],
        }),
      ]),
      musicMetadata: {
        getCoverArt: async () => ({ value: null, warnings: [] }),
      },
      validateCover: async (url) => {
        coverCalls.push(url.toString());
        return coverResult(false);
      },
      auditEvidence: acceptAll(),
    },
  );

  assert.deepEqual(verified.releases, []);
  assert.deepEqual(coverCalls, []);
  assert.equal(verified.verificationSummary?.rejectedByEvidence, 2);
  assert.equal(verified.verificationSummary?.rejectedWithoutCover, 0);
});

test("rejects a numeric +1 expanded-edition title even without a usable tracklist", async () => {
  const expandedTitle = "CATCH THE NITE +1";
  const fake = fakeDiscogs({
    rows: [searchRow({ title: `Miho Nakayama - ${expandedTitle}` })],
    details: new Map([[101, releaseDetail({ title: expandedTitle, tracks: [] })]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({ title: expandedTitle })]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl([ndlRecord({ title: `Miho Nakayama / ${expandedTitle}` })]),
      validateCover: async () => {
        throw new Error("a +1 expanded edition must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("rejects same-year title peers when the earliest Japanese CD catalog is ambiguous", async () => {
  const fake = fakeDiscogs({
    rows: [
      searchRow(),
      searchRow({
        releaseId: 99,
        masterId: 999,
        catalogNumber: "K32X-100",
        apiUrl: "https://api.discogs.com/releases/99",
        sourceUrl: "https://www.discogs.com/release/99",
      }),
    ],
    details: new Map([[101, releaseDetail()]]),
  });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("an ambiguous earliest catalog must not reach cover validation");
      },
      auditEvidence: async () => [],
    },
  );
  assert.deepEqual(fake.getReleaseCalls, []);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
});

test("does not return a metadata match when no candidate cover validates", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail()]]),
  });
  let coverCalls = 0;

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      musicMetadata: {
        getCoverArt: async () => ({ value: null, warnings: [] }),
      },
      validateCover: async () => {
        coverCalls += 1;
        return coverResult(false);
      },
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.equal(coverCalls, 1);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 1);
  assert.equal(verified.verificationSummary?.rejectedWithoutCover, 1);
  assert.equal(verified.verificationSummary?.aiAccepted, 0);
});

test("safely hides a candidate instead of failing the task when all cover providers are transiently unavailable", async () => {
  const fake = fakeDiscogs({ rows: [searchRow()], details: new Map([[101, releaseDetail()]]) });
  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      musicMetadata: { getCoverArt: async () => ({ value: null, warnings: [] }) },
      validateCover: async () => ({
        ...coverResult(false),
        reason: "network-error",
        retryable: true,
        status: null,
      }),
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 1);
  assert.equal(verified.verificationSummary?.rejectedWithoutCover, 0);
  assert.equal(verified.verificationSummary?.rejectedCoverUnavailable, 1);
  assert.match(verified.globalWarnings.join("\n"), /封面来源暂时不可用/);
});

test("hides a strongly matched covered release when the AI auditor rejects it", async () => {
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail()]]),
  });

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => coverResult(true),
      auditEvidence: async (evidence) => evidence.map((item) => ({
        id: item.candidate.id,
        decision: "REJECT" as const,
        reasonCode: "EDITION_CONFLICT" as const,
        reason: "The supplied evidence does not prove the same original edition.",
      })),
    },
  );

  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 1);
  assert.equal(verified.verificationSummary?.rejectedByAi, 1);
  assert.equal(verified.verificationSummary?.aiAccepted, 0);
});

test("rejects an ambiguous one-to-many mapping to the same Discogs release", async () => {
  const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fake = fakeDiscogs({
    rows: [searchRow()],
    details: new Map([[101, releaseDetail()]]),
  });
  const audited: ReleaseCrossSourceEvidence[][] = [];

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate({ id: secondId }), candidate({ id: firstId })]),
    evidenceBundle(2),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => coverResult(true),
      auditEvidence: acceptAll(audited),
    },
  );

  assert.deepEqual(fake.getReleaseCalls, []);
  assert.equal(audited[0]?.length, 0);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.authoritativeMatches, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
  assert.equal(verified.verificationSummary?.rejectedByEvidence, 2);
  assert.equal(verified.verificationSummary?.aiAccepted, 0);
});

test("rejects one candidate that maps to multiple equally matching Discogs releases", async () => {
  const secondRow = searchRow({
    releaseId: 102,
    masterId: 502,
    apiUrl: "https://api.discogs.com/releases/102",
    sourceUrl: "https://www.discogs.com/release/102",
  });
  const fake = fakeDiscogs({
    rows: [searchRow(), secondRow],
    details: new Map([
      [101, releaseDetail()],
      [102, releaseDetail({
        releaseId: 102,
        masterId: 502,
        apiUrl: "https://api.discogs.com/releases/102",
        sourceUrl: "https://www.discogs.com/release/102",
      })],
    ]),
  });

  const verified = await verifyDiscographyResult(
    request,
    researchResult([candidate()]),
    evidenceBundle(1),
    undefined,
    {
      discogs: fake.client,
      ndl: fakeNdl(),
      validateCover: async () => {
        throw new Error("an ambiguous Discogs edition must not reach cover validation");
      },
      auditEvidence: async (evidence) => {
        assert.equal(evidence.length, 0);
        return [];
      },
    },
  );

  assert.deepEqual(fake.getReleaseCalls, [101, 102]);
  assert.equal(verified.releases.length, 0);
  assert.equal(verified.verificationSummary?.crossSourceMatches, 0);
  assert.equal(verified.verificationSummary?.rejectedWithoutCover, 0);
  assert.equal(verified.verificationSummary?.rejectedByEvidence, 1);
});

test("fails closed when the Discogs search reports partial results", async () => {
  const fake = fakeDiscogs({ rows: [searchRow()], partial: true });

  await assert.rejects(
    verifyDiscographyResult(
      request,
      researchResult([candidate()]),
      evidenceBundle(1),
      undefined,
      {
        discogs: fake.client,
        ndl: fakeNdl(),
        validateCover: async () => {
          throw new Error("partial search must not reach cover validation");
        },
        auditEvidence: async () => {
          throw new Error("partial search must not reach AI audit");
        },
      },
    ),
    /Discogs search was incomplete/,
  );
  assert.deepEqual(fake.getReleaseCalls, []);
});
