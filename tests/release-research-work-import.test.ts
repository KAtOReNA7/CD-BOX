import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, ReleaseWork } from "@prisma/client";
import {
  candidateExternalIds,
  upsertCandidateWork,
} from "@/lib/ai/release-research";
import type { ReleaseResearchCandidate } from "@/lib/ai/release-research-types";

const ndlUrl = "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764";
const discogsUrl = "https://www.discogs.com/release/123";
const groupId = "11111111-1111-4111-8111-111111111111";

function candidate(overrides: Partial<ReleaseResearchCandidate> = {}): ReleaseResearchCandidate {
  const sourceUrls = [ndlUrl, discogsUrl];
  return {
    id: "discogs-release-123",
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
    sources: [
      { title: "NDL", url: ndlUrl, sourceType: "database" },
      { title: "Discogs release", url: discogsUrl, sourceType: "database" },
    ],
    verification: {
      status: "VERIFIED",
      method: "multi-source-v2",
      policyVersion: "multi-source-v2",
      aiDecision: "ACCEPT",
      aiReason: "The catalog-bound NDL and Discogs edition facts agree.",
      checkedAt: "2026-07-12T00:00:00.000Z",
      matchedFields: ["artist", "title", "catalogNumber", "date"],
      sourceUrls,
      authoritySourceUrls: [ndlUrl],
      corroboratingSourceUrls: [discogsUrl],
      workId: "discogs-provisional-work:123",
      editionId: "discogs:123",
      coverProvider: "discogs",
      coverCheckedAt: "2026-07-12T00:00:00.000Z",
      coverMatchLevel: "EDITION",
      sourceReleaseDate: "1988-02-10",
    },
    ...overrides,
  };
}

function releaseWork(overrides: Partial<ReleaseWork> = {}): ReleaseWork {
  return {
    id: "work-existing",
    artistId: "artist-a",
    title: "Old title",
    titleOriginal: null,
    artistCredit: null,
    category: "ORIGINAL_ALBUM",
    originalReleaseDate: null,
    originalDatePrecision: null,
    musicBrainzReleaseGroupId: null,
    verificationStatus: "DISCOVERED",
    verificationEvidence: null,
    verifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

type WorkSourceRow = {
  url: string;
  externalId: string | null;
  work?: ReleaseWork;
};

function transactionDouble(input: {
  musicBrainzWork?: ReleaseWork | null;
  discogsWorks?: ReleaseWork[];
  persistedSources?: WorkSourceRow[];
} = {}) {
  const createdWorks: Array<Record<string, unknown>> = [];
  const updatedWorks: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const createdSources: Array<Record<string, unknown>> = [];
  const repairedSources: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const persistedSources = input.persistedSources ?? [];
  const defaultWork = releaseWork();

  const tx = {
    releaseWork: {
      findUnique: async () => input.musicBrainzWork ?? null,
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updatedWorks.push(args);
        const base = input.musicBrainzWork ?? input.discogsWorks?.[0] ?? defaultWork;
        return { ...base, ...args.data };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createdWorks.push(args.data);
        return { ...defaultWork, id: "work-created", ...args.data };
      },
    },
    releaseWorkSource: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        if ("externalId" in args.where) {
          return (input.discogsWorks ?? []).map((work, index) => ({
            id: `source-link-${index}`,
            workId: work.id,
            provider: "www.discogs.com",
            externalId: "123",
            url: discogsUrl,
            work,
          }));
        }
        return persistedSources;
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        repairedSources.push(args);
        return { count: 1 };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        createdSources.push(...args.data);
        return { count: args.data.length };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, createdWorks, updatedWorks, createdSources, repairedSources };
}

test("extracts a Discogs edition identity without inventing a MusicBrainz work", () => {
  assert.deepEqual(candidateExternalIds(candidate()), {
    musicBrainzReleaseGroupId: null,
    musicBrainzReleaseId: null,
    discogsReleaseId: 123,
  });
});

test("rejects a candidate that ambiguously names more than one Discogs edition", () => {
  const value = candidate({
    sources: [
      ...candidate().sources,
      { title: "Other Discogs release", url: "https://www.discogs.com/release/456", sourceType: "database" },
    ],
  });
  assert.throws(() => candidateExternalIds(value), /多个 Discogs 版本标识/);
});

test("creates a ReleaseWork for an NDL plus Discogs candidate and persists a reusable Discogs id", async () => {
  const harness = transactionDouble();
  const result = await upsertCandidateWork(candidate(), "artist-a", harness.tx);

  assert.equal(result.work.id, "work-created");
  assert.equal(harness.createdWorks.length, 1);
  assert.equal(harness.createdWorks[0]?.artistId, "artist-a");
  assert.equal(harness.createdWorks[0]?.musicBrainzReleaseGroupId, null);
  assert.deepEqual(
    harness.createdSources.find((source) => source.url === discogsUrl),
    {
      workId: "work-created",
      provider: "www.discogs.com",
      role: "corroboration",
      externalId: "123",
      url: discogsUrl,
      label: "Discogs release",
    },
  );
});

test("reuses the ReleaseWork addressed by a persisted Discogs externalId", async () => {
  const existing = releaseWork();
  const harness = transactionDouble({
    discogsWorks: [existing],
    persistedSources: [{ url: discogsUrl, externalId: "123" }],
  });
  const result = await upsertCandidateWork(candidate(), "artist-a", harness.tx);

  assert.equal(result.work.id, existing.id);
  assert.equal(harness.createdWorks.length, 0);
  assert.equal(harness.updatedWorks.length, 1);
  assert.deepEqual(harness.updatedWorks[0]?.where, { id: existing.id });
});

test("repairs a legacy Discogs work source that is missing its reusable externalId", async () => {
  const existing = releaseWork({ musicBrainzReleaseGroupId: groupId });
  const value = candidate({
    verification: { ...candidate().verification!, workId: groupId },
  });
  const harness = transactionDouble({
    musicBrainzWork: existing,
    persistedSources: [{ url: discogsUrl, externalId: null }],
  });

  await upsertCandidateWork(value, "artist-a", harness.tx);

  assert.deepEqual(harness.repairedSources, [{
    where: { workId: existing.id, url: discogsUrl, externalId: null },
    data: { provider: "www.discogs.com", externalId: "123" },
  }]);
});

test("fails closed when a Discogs identity belongs to another artist", async () => {
  const harness = transactionDouble({
    discogsWorks: [releaseWork({ artistId: "artist-b" })],
  });

  await assert.rejects(
    upsertCandidateWork(candidate(), "artist-a", harness.tx),
    /已属于其他艺人/,
  );
  assert.equal(harness.createdWorks.length, 0);
  assert.equal(harness.updatedWorks.length, 0);
});

test("fails closed when one Discogs externalId maps to multiple works", async () => {
  const harness = transactionDouble({
    discogsWorks: [
      releaseWork({ id: "work-a" }),
      releaseWork({ id: "work-b" }),
    ],
  });

  await assert.rejects(
    upsertCandidateWork(candidate(), "artist-a", harness.tx),
    /对应多个作品/,
  );
  assert.equal(harness.createdWorks.length, 0);
  assert.equal(harness.updatedWorks.length, 0);
});

test("fails closed when MusicBrainz and Discogs resolve to different works", async () => {
  const musicBrainzWork = releaseWork({
    id: "work-mb",
    musicBrainzReleaseGroupId: groupId,
  });
  const discogsWork = releaseWork({ id: "work-discogs" });
  const harness = transactionDouble({ musicBrainzWork, discogsWorks: [discogsWork] });
  const value = candidate({
    verification: { ...candidate().verification!, workId: groupId },
  });

  await assert.rejects(
    upsertCandidateWork(value, "artist-a", harness.tx),
    /分别属于不同作品/,
  );
  assert.equal(harness.createdWorks.length, 0);
  assert.equal(harness.updatedWorks.length, 0);
});
