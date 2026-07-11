import assert from "node:assert/strict";
import test from "node:test";
import {
  OfficialMusicCatalogClient,
  matchOfficialPage,
  parseOfficialMusicHtml,
  type OfficialMusicCandidate,
  type OfficialMusicFetch,
} from "@/lib/official-music";

const origin = "https://artist.example.com";
const publicResolver = async () => ["93.184.216.34"];

const catchTheNite: OfficialMusicCandidate = {
  id: "candidate-1",
  title: "CATCH THE NITE",
  date: "1988-02-10",
  catalogNumber: "K32X-240",
};

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...init.headers },
    ...init,
  });
}

function fixtureClient(
  pages: ReadonlyMap<string, Response | (() => Response | Promise<Response>)>,
  requests: Array<{ url: string; init?: RequestInit }> = [],
  overrides: ConstructorParameters<typeof OfficialMusicCatalogClient>[0] = {},
) {
  const fetchImpl: OfficialMusicFetch = async (input, init) => {
    const url = input.toString();
    requests.push({ url, init });
    const fixture = pages.get(url);
    if (!fixture) return html("missing", { status: 404 });
    return typeof fixture === "function" ? fixture() : fixture.clone();
  };
  return new OfficialMusicCatalogClient({
    fetchImpl,
    resolveHost: publicResolver,
    sleep: async () => undefined,
    now: () => 0,
    retryCount: 0,
    minimumIntervalMs: 250,
    ...overrides,
  });
}

test("crawls only same-origin catalogue anchors and returns a unique three-field match", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const pages = new Map<string, Response>([
    [`${origin}/`, html(`
      <html><body>
        <a href="/discography">ディスコグラフィ</a>
        <a href="/news">News</a>
        <a href="https://other.example.com/music">External music</a>
        <form action="/music/form-result"><a href="/music/form-link">Hidden form link</a></form>
        <script>document.write('<a href="/music/script-link">bad</a>')</script>
      </body></html>
    `)],
    [`${origin}/discography`, html(`
      <html><head><title>Official Discography</title></head><body>
        <article>
          <h1>CATCH THE NITE</h1>
          <p>発売日 1988年2月10日</p>
          <p>品番 K32X-240</p>
        </article>
      </body></html>
    `)],
  ]);

  const result = await fixtureClient(pages, requests).research({
    officialUrls: [`${origin}/`],
    candidates: [catchTheNite],
  });

  assert.deepEqual(requests.map((request) => request.url), [
    `${origin}/`,
    `${origin}/discography`,
  ]);
  assert.equal(requests.every((request) => request.init?.method === "GET"), true);
  assert.equal(requests.every((request) => request.init?.redirect === "manual"), true);
  assert.equal(requests.every((request) => request.init?.credentials === "omit"), true);
  assert.deepEqual(result.candidates[0]?.evidence?.matchedFields, [
    "catalogNumber",
    "title",
    "date",
  ]);
  assert.equal(result.candidates[0]?.evidence?.url, `${origin}/discography`);
  assert.equal(result.candidates[0]?.evidence?.evidenceScope, "product-block");
  assert.equal(result.candidates[0]?.evidence?.datePrecision, "day");
  assert.equal(result.stats.pagesFetched, 2);
  assert.equal(result.stats.candidatesMatched, 1);
});

test("uses JSON-LD and meta facts without executing scripts and supports controlled bilingual titles", async () => {
  const page = `${origin}/music/release/mellow`;
  const body = `
    <html><head>
      <meta property="og:title" content="Mellow = メロウ">
      <script type="application/ld+json">
        {"@type":"MusicAlbum","name":"Mellow = メロウ","datePublished":"1992-07-01","sku":"KICS 210"}
      </script>
      <script>throw new Error("must never execute")</script>
    </head><body><p>Official release</p></body></html>
  `;
  const result = await fixtureClient(new Map([[page, html(body)]])).research({
    officialUrls: [page],
    candidates: [{
      id: "mellow",
      title: "Mellow",
      date: "1992",
      catalogNumber: "KICS-210",
    }],
  });

  assert.equal(result.candidates[0]?.evidence?.url, page);
  assert.equal(result.candidates[0]?.evidence?.evidenceScope, "structured-entity");
  assert.equal(result.candidates[0]?.evidence?.observedDate, "1992-07-01");
  assert.equal(result.candidates[0]?.evidence?.datePrecision, "year");
});

test("follows pagination only after entering a catalogue context", async () => {
  const pages = new Map<string, Response>([
    [`${origin}/discography`, html(`
      <a href="/discography?page=2" rel="next">次へ</a>
      <a href="/news?page=2">2</a>
    `)],
    [`${origin}/discography?page=2`, html(`
      <article><h2>CATCH THE NITE</h2><p>K32X 240</p><time>1988-02-10</time></article>
    `)],
  ]);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await fixtureClient(pages, requests).research({
    officialUrls: [`${origin}/discography`],
    candidates: [catchTheNite],
  });

  assert.deepEqual(requests.map((request) => request.url), [
    `${origin}/discography`,
    `${origin}/discography?page=2`,
  ]);
  assert.equal(result.candidates[0]?.evidence?.url, `${origin}/discography?page=2`);
});

test("fails closed when more than one official page matches a candidate", async () => {
  const releaseHtml = html("<article><h1>CATCH THE NITE</h1><p>K32X-240</p><p>1988-02-10</p></article>");
  const pages = new Map<string, Response>([
    [`${origin}/discography`, html(`
      <a href="/release/one">Release one</a>
      <a href="/release/two">Release two</a>
    `)],
    [`${origin}/release/one`, releaseHtml],
    [`${origin}/release/two`, releaseHtml],
  ]);
  const result = await fixtureClient(pages).research({
    officialUrls: [`${origin}/discography`],
    candidates: [catchTheNite],
  });

  assert.equal(result.candidates[0]?.evidence, null);
  assert.equal(result.stats.ambiguousCandidates, 1);
  assert.ok(result.warnings.some((item) =>
    item.code === "ambiguous-official-match" && item.candidateId === catchTheNite.id));
});

test("never splices title, catalog number, and date across same-day product records", async () => {
  const page = `${origin}/discography`;
  const body = `
    <article>
      <ul>
        <li><h2>ALBUM A</h2><p>CAT-A1</p><time>2020-01-01</time></li>
        <li><h2>ALBUM B</h2><p>CAT-B2</p><time>2020-01-01</time></li>
      </ul>
    </article>
  `;
  const result = await fixtureClient(new Map([[page, html(body)]])).research({
    officialUrls: [page],
    candidates: [
      { id: "correct", title: "ALBUM A", catalogNumber: "CAT-A1", date: "2020-01-01" },
      { id: "cross-spliced", title: "ALBUM A", catalogNumber: "CAT-B2", date: "2020-01-01" },
    ],
  });

  assert.equal(result.candidates[0]?.evidence?.evidenceScope, "product-block");
  assert.equal(result.candidates[1]?.evidence, null);
});

test("does not treat scattered listing-page facts as one release", async () => {
  const page = `${origin}/discography`;
  const result = await fixtureClient(new Map([[page, html(`
    <h1>CATCH THE NITE</h1>
    <div>K32X-240</div>
    <footer>Released 1988-02-10</footer>
  `)]])).research({
    officialUrls: [page],
    candidates: [catchTheNite],
  });

  assert.equal(result.candidates[0]?.evidence, null);
});

test("allows whole-page facts only when the path is bound to the candidate catalog number", async () => {
  const page = `${origin}/release/K32X-240`;
  const result = await fixtureClient(new Map([[page, html(`
    <h1>CATCH THE NITE</h1><p>K32X-240</p><p>1988-02-10</p>
  `)]])).research({
    officialUrls: [page],
    candidates: [catchTheNite],
  });

  assert.equal(result.candidates[0]?.evidence?.evidenceScope, "single-item-page");
});

test("requires catalog number, controlled title, and a non-conflicting highest-precision date", () => {
  const matching = parseOfficialMusicHtml(
    "<h1>CATCH THE NITE</h1><p>K32X 240</p><p>1988-02-10</p>",
    20,
  );
  assert.ok(matchOfficialPage(catchTheNite, matching.facts));

  const wrongCatalog = parseOfficialMusicHtml(
    "<h1>CATCH THE NITE</h1><p>K32X 999</p><p>1988-02-10</p>",
    20,
  );
  assert.equal(matchOfficialPage(catchTheNite, wrongCatalog.facts), null);

  const wrongTitle = parseOfficialMusicHtml(
    "<h1>CATCH THE DAY</h1><p>K32X 240</p><p>1988-02-10</p>",
    20,
  );
  assert.equal(matchOfficialPage(catchTheNite, wrongTitle.facts), null);

  const conflictingDayWithLooseYear = parseOfficialMusicHtml(
    "<h1>CATCH THE NITE</h1><p>K32X 240</p><p>1988-03-10</p><footer>Copyright 1988</footer>",
    20,
  );
  assert.equal(matchOfficialPage(catchTheNite, conflictingDayWithLooseYear.facts), null);

  const catalogDigitsAreNotAReleaseYear = parseOfficialMusicHtml(
    "<h1>Example Album</h1><p>品番 KICS-2015</p><footer>Copyright 2015</footer>",
    20,
  );
  assert.equal(matchOfficialPage({
    id: "catalog-year",
    title: "Example Album",
    date: "2015",
    catalogNumber: "KICS-2015",
  }, catalogDigitsAreNotAReleaseYear.facts), null);
});

test("stops at the configured page ceiling and reports a structured partial-crawl warning", async () => {
  const pages = new Map<string, Response>([
    [`${origin}/discography`, html('<a href="/release/one">Release one</a>')],
    [`${origin}/release/one`, html('<a href="/release/two">Release two</a>')],
    [`${origin}/release/two`, html("unused")],
  ]);
  const result = await fixtureClient(pages, [], { maxPages: 2 }).research({
    officialUrls: [`${origin}/discography`],
    candidates: [catchTheNite],
  });

  assert.equal(result.stats.pagesAttempted, 2);
  assert.ok(result.warnings.some((item) => item.code === "page-limit"));
});
