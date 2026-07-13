import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNdlSingleManifestTitles,
  fetchNdlSingleManifests,
} from "@/lib/ndl/single-manifest";
import type { NdlRecord } from "@/lib/ndl/types";

function record(overrides: Partial<NdlRecord> = {}): NdlRecord {
  return {
    recordId: "R100000002-I000008350485",
    sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008350485",
    title: "中山美穂complete singles box",
    creators: ["中山美穂"],
    publishers: ["King Records"],
    issued: "2006-03",
    issuedRaw: "2006.3",
    issuedPrecision: "month",
    identifiers: ["KICS-91228"],
    identifierDetails: [{ value: "KICS-91228", scheme: null }],
    catalogNumbers: ["KICS-91228"],
    ...overrides,
  };
}

function manifestHtml() {
  return `<html><script type="application/json">${JSON.stringify([
    "DISC7〈SINGLE A-SIDE COLLECTION 4〉(1)CHEERS FOR YOU(2)Hurt to Heart-痛みの行方(3)Adore",
    "DISC8〈SINGLE B-SIDE COLLECTION 4〉(1)I LOVE YOU(2)Adore(for movie)",
  ])}</script></html>`;
}

function serializedHtml(values: readonly string[]) {
  return `<html><script type="application/json">${JSON.stringify(values)}</script></html>`;
}

test("extracts only explicitly labelled complete-single A-side works", () => {
  assert.deepEqual(extractNdlSingleManifestTitles(manifestHtml()), [
    "CHEERS FOR YOU",
    "Hurt to Heart-痛みの行方",
    "Adore",
  ]);
});

test("rejects unlabelled complete-collection discs because A/B semantics are unresolved", () => {
  const html = serializedHtml([
    "DISC1(1)としごろ(2)青い果実(3)禁じられた遊び",
    "DISC2(1)十戒(1984)(2)飾りじゃないのよ涙は",
    "[1](1)裸足の季節(2)レインボウ[2](1)青い珊瑚礁(2)トゥルー・ラヴ",
  ]);
  assert.deepEqual(extractNdlSingleManifestTitles(html), []);
});

test("keeps only A-side tracks when a primary payload labels both sides", () => {
  const html = serializedHtml([
    "DISC7〈SINGLE A-SIDE COLLECTION〉(1)CHEERS FOR YOU(2)Adore〈SINGLE B-SIDE COLLECTION〉(1)I LOVE YOU(2)Adore(for movie)",
    "DISC8〈シングル B 面〉(1)B面曲1(2)B面曲2",
  ]);
  assert.deepEqual(extractNdlSingleManifestTitles(html), ["CHEERS FOR YOU", "Adore"]);
});

test("rejects numbered metadata that is not an anchored multi-track disc payload", () => {
  const html = serializedHtml([
    "release metadata (1)not a track(2)also not a track",
    "[2024](1)year metadata(2)not a disc",
    "[1] bibliography (1)not adjacent(2)not a disc",
    "DISCOGRAPHY(1)not a disc(2)not a disc",
    "DISC1(1)only one track",
    "DISC2(2)sequence does not begin at one(3)still invalid",
  ]);
  assert.deepEqual(extractNdlSingleManifestTitles(html), []);
});

test("fetches only fixed-origin NDL records already bound to the artist", async () => {
  let calls = 0;
  const result = await fetchNdlSingleManifests([
    record(),
    record({
      recordId: "unsafe",
      sourceUrl: "https://example.com/books/R100000002-Iunsafe",
    }),
    record({
      recordId: "other-artist",
      title: "Other Artist complete singles box",
      creators: ["Other Artist"],
    }),
  ], ["中山美穂", "Miho Nakayama"], {
    minimumIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(manifestHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.unavailable, false);
  assert.deepEqual(result.evidence[0]?.trackTitles, [
    "CHEERS FOR YOU",
    "Hurt to Heart-痛みの行方",
    "Adore",
  ]);
});

test("accepts Japanese complete-single collection titles with reliable artist identity", async () => {
  let calls = 0;
  const records = [
    record({
      recordId: "R100000002-I000010570788",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010570788",
      title: "山口百恵ゴールデン・ベスト コンプリート・シングルコレクション",
      creators: [],
    }),
    record({
      recordId: "R100000002-I000010335819",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000010335819",
      title: "中森明菜コンプリート・シングル・コレクションズ",
      creators: ["中森明菜"],
    }),
    record({
      recordId: "R100000002-I000009056163",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000009056163",
      title: "松田聖子/コンプリート・バイブル～オール・シングルズ・コレクション",
      creators: [],
    }),
    record({
      recordId: "R100000002-I000000001111",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000000001111",
      title: "Various artists コンプリート・シングル・コレクション",
      creators: [],
    }),
    record({
      recordId: "R100000002-I000000001112",
      sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000000001112",
      title: "松田聖子コンプリート・アルバム・コレクション",
      creators: ["松田聖子"],
    }),
  ];
  const result = await fetchNdlSingleManifests(
    records,
    ["山口百恵", "中森明菜", "松田聖子"],
    {
      minimumIntervalMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(serializedHtml([
          "DISC1 SINGLE A-SIDE COLLECTION (1)First(2)Second",
        ]), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(result.evidence.map((entry) => entry.recordId), [
    "R100000002-I000010570788",
    "R100000002-I000010335819",
    "R100000002-I000009056163",
  ]);
});

test("does not bind a title to an unrelated short artist alias", async () => {
  let calls = 0;
  const result = await fetchNdlSingleManifests([
    record({
      title: "A complete singles collection",
      creators: [],
    }),
  ], ["A"], {
    minimumIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(serializedHtml(["DISC1(1)First(2)Second"]), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.evidence, []);
});

test("fails closed on non-HTML, oversized, or unavailable manifest pages", async () => {
  const nonHtml = await fetchNdlSingleManifests([record()], ["中山美穂"], {
    minimumIntervalMs: 0,
    fetchImpl: async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(nonHtml.evidence, []);

  const unavailable = await fetchNdlSingleManifests([record()], ["中山美穂"], {
    minimumIntervalMs: 0,
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(unavailable.unavailable, true);
});
