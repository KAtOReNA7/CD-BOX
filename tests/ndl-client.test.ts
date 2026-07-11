import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NDL_SEARCH_ATTRIBUTION,
  NdlSearchClient,
  NdlXmlError,
  buildNdlCatalogUrl,
  buildNdlInventoryUrl,
  parseNdlOpenSearchXml,
  type NdlFetch,
} from "@/lib/ndl";

const summerBreezeItem = `
  <item>
    <title>中山美穂/サマー・ブリーズ</title>
    <link>https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764</link>
    <description><![CDATA[<p>キング,1986</p>]]></description>
    <author/>
    <guid isPermaLink="true">https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764</guid>
    <dc:title>中山美穂/サマー・ブリーズ</dc:title>
    <dc:publisher>キング</dc:publisher>
    <dc:date xsi:type="dcterms:W3CDTF">1986</dc:date>
    <dcterms:issued>1986.8</dcterms:issued>
    <dc:identifier xsi:type="dcndl:RIS502">K32X-100</dc:identifier>
    <dc:identifier xsi:type="dcndl:NDLBibID">000008888764</dc:identifier>
  </item>`;

function rss(items = summerBreezeItem, total = 1) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:openSearch="http://a9.com/-/spec/opensearchrss/1.0/"
      xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"
      xmlns:dcterms="http://purl.org/dc/terms/"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.0">
      <channel><openSearch:totalResults>${total}</openSearch:totalResults>${items}</channel>
    </rss>`;
}

function xmlResponse(body = rss(), init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/xml;charset=UTF-8" },
    ...init,
  });
}

test("parses a real NDL OpenSearch-shaped audio fixture without executing XML entities", () => {
  const result = parseNdlOpenSearchXml(rss(), "https://ndlsearch.ndl.go.jp/api/opensearch?fixture=1");
  assert.equal(result.sourceTotal, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.records[0], {
    recordId: "R100000002-I000008888764",
    sourceUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000008888764",
    title: "中山美穂/サマー・ブリーズ",
    creators: [],
    publishers: ["キング"],
    issued: "1986-08",
    issuedRaw: "1986.8",
    issuedPrecision: "month",
    identifiers: ["K32X-100", "000008888764"],
    identifierDetails: [
      { value: "K32X-100", scheme: "dcndl:RIS502" },
      { value: "000008888764", scheme: "dcndl:NDLBibID" },
    ],
    catalogNumbers: ["K32X-100"],
  });

  const ampersand = parseNdlOpenSearchXml(
    rss(summerBreezeItem.replaceAll("サマー・ブリーズ", "R&amp;B")),
    "https://ndlsearch.ndl.go.jp/api/opensearch?fixture=ampersand",
  );
  assert.equal(ampersand.records[0]?.title, "中山美穂/R&B");
});

test("builds only fixed-origin audio bibliography queries capped at 500 records", () => {
  const inventory = buildNdlInventoryUrl(" 中山美穂 ", 9999);
  assert.equal(inventory.origin, "https://ndlsearch.ndl.go.jp");
  assert.equal(inventory.pathname, "/api/opensearch");
  assert.equal(inventory.searchParams.get("any"), "中山美穂");
  assert.equal(inventory.searchParams.get("mediatype"), "audio");
  assert.equal(inventory.searchParams.get("dpid"), "iss-ndl-opac");
  assert.equal(inventory.searchParams.get("cnt"), "500");

  const catalog = buildNdlCatalogUrl(" k32x 100 ");
  assert.equal(catalog.searchParams.get("any"), "K32X-100");
  assert.equal(catalog.searchParams.get("cnt"), "20");
  assert.throws(() => buildNdlCatalogUrl("000008888764"), TypeError);
});

test("uses the 24-hour process cache and hardened request options", async () => {
  let calls = 0;
  let observedInit: RequestInit | undefined;
  const fetchImpl: NdlFetch = async (_input, init) => {
    calls += 1;
    observedInit = init;
    return xmlResponse();
  };
  const client = new NdlSearchClient({ fetchImpl, minimumIntervalMs: 0 });
  const first = await client.searchCatalogNumber("K32X-100");
  const second = await client.searchCatalogNumber("K32X-100");
  assert.equal(calls, 1);
  assert.equal(first.value?.records[0]?.recordId, "R100000002-I000008888764");
  assert.equal(second.value?.records[0]?.recordId, "R100000002-I000008888764");
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "error");
  assert.equal(observedInit?.credentials, "omit");
  assert.equal(observedInit?.referrerPolicy, "no-referrer");
  assert.match((observedInit?.headers as Record<string, string>)["User-Agent"] ?? "", /CD-BOX/);
});

test("globally serializes requests sharing a transport and waits one second between starts", async () => {
  let clock = 0;
  let active = 0;
  let maximumActive = 0;
  const sleeps: number[] = [];
  const fetchImpl: NdlFetch = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active -= 1;
    return xmlResponse();
  };
  const options = {
    fetchImpl,
    minimumIntervalMs: 1_000,
    cacheTtlMs: 0,
    retryCount: 0,
    now: () => clock,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
  };
  const first = new NdlSearchClient(options);
  const second = new NdlSearchClient(options);
  await Promise.all([
    first.searchArtistInventory("中山美穂"),
    second.searchCatalogNumber("K32X-100"),
  ]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(sleeps, [1_000]);
});

test("retries transient failures twice and fails closed on unsafe XML", async () => {
  let calls = 0;
  const client = new NdlSearchClient({
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503 });
      return xmlResponse();
    },
    minimumIntervalMs: 0,
    retryDelayMs: 0,
  });
  const recovered = await client.searchCatalogNumber("K32X-100");
  assert.equal(calls, 3);
  assert.equal(recovered.value?.records.length, 1);

  const unsafe = new NdlSearchClient({
    fetchImpl: async () => xmlResponse(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss()}`),
    minimumIntervalMs: 0,
    retryCount: 0,
  });
  const rejected = await unsafe.searchCatalogNumber("K32X-100");
  assert.equal(rejected.value, null);
  assert.equal(rejected.warnings[0]?.code, "invalid-xml");
  assert.throws(
    () => parseNdlOpenSearchXml(rss(summerBreezeItem.replace("サマー", "&unknown;")), "https://ndlsearch.ndl.go.jp/api/opensearch"),
    NdlXmlError,
  );
  assert.throws(
    () => parseNdlOpenSearchXml(rss(summerBreezeItem.repeat(501), 501), "https://ndlsearch.ndl.go.jp/api/opensearch"),
    NdlXmlError,
  );

  const oversized = new NdlSearchClient({
    fetchImpl: async () => xmlResponse(),
    maxResponseBytes: 32,
    minimumIntervalMs: 0,
    retryCount: 0,
  });
  const oversizedResult = await oversized.searchCatalogNumber("K32X-100");
  assert.equal(oversizedResult.value, null);
  assert.equal(oversizedResult.warnings[0]?.code, "response-too-large");
});

test("exports the mandatory NDL API credit and CC BY license", () => {
  assert.match(NDL_SEARCH_ATTRIBUTION.displayNotice, /NDL Search API/);
  assert.equal(NDL_SEARCH_ATTRIBUTION.provider, "National Diet Library, Japan");
  assert.equal(NDL_SEARCH_ATTRIBUTION.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
});
