import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSeikoMatsudaRecoveryPage,
  SEIKO_MATSUDA_RECOVERY_ORIGIN,
  SEIKO_MATSUDA_RECOVERY_SPECS,
  SEIKO_MATSUDA_RECOVERY_WORK_KEYS,
  SeikoMatsudaRecoveryClient,
  SeikoMatsudaRecoveryFailure,
  seikoMatsudaRecoveryDetailUrl,
  type SeikoMatsudaRecoverySpec,
  type SeikoMatsudaRecoveryWorkKey,
} from "@/lib/official-music/seiko-matsuda-recovery";

type FixtureOverrides = {
  shellTitle?: string;
  artist?: string;
  categoryLabel?: string;
  categoryPath?: string;
  title?: string;
  date?: string;
  catalog?: string;
  coverAlt?: string;
  coverPath?: string;
  duplicateCover?: boolean;
};

const keyByUrl = new Map(
  SEIKO_MATSUDA_RECOVERY_WORK_KEYS.map((key) => [
    SEIKO_MATSUDA_RECOVERY_SPECS[key].sourceUrl,
    key,
  ]),
);

function fixturePage(
  key: SeikoMatsudaRecoveryWorkKey,
  overrides: FixtureOverrides = {},
) {
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
  const title = overrides.title ?? spec.pageTitle;
  const coverPath = overrides.coverPath ?? spec.coverPath;
  const coverAlt = overrides.coverAlt ?? title;
  const duplicateCover = overrides.duplicateCover
    ? `<img src="${coverPath}" alt="${coverAlt}">`
    : "";
  const [year, month, day] = (overrides.date ?? spec.releaseDate).split("-");
  return `<!doctype html>
<html lang="ja">
  <head><title>${overrides.shellTitle ?? "ディスコグラフィ｜松田聖子オフィシャルサイト"}</title></head>
  <body>
    <img src="/img/logo.png" alt="${overrides.artist ?? "松田聖子"}" title="松田聖子">
    <div id="discography" class="row">
      <p class="info-title-message">${overrides.categoryLabel ?? spec.officialCategoryLabel}</p>
      <img src="${coverPath}" alt="${coverAlt}">
      ${duplicateCover}
      <p class="info-disk-title">${title}</p>
      <p class="info-p">商品番号：${overrides.catalog ?? spec.catalogDisplay}</p>
      <p class="info-p">リリース：${year}年${month}月${day}日</p>
      <p class="sub-menu"><a href="${overrides.categoryPath ?? spec.activeCategoryPath}" class="active">active</a></p>
    </div>
  </body>
</html>`;
}

function pageResponse(key: SeikoMatsudaRecoveryWorkKey) {
  return new Response(fixturePage(key), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

function publicResolver() {
  return Promise.resolve(["93.184.216.34"]);
}

function expectedFailure(
  key: SeikoMatsudaRecoveryWorkKey,
  overrides: FixtureOverrides,
  code: SeikoMatsudaRecoveryFailure["code"],
) {
  assert.throws(
    () => parseSeikoMatsudaRecoveryPage(key, fixturePage(key, overrides)),
    (error: unknown) => error instanceof SeikoMatsudaRecoveryFailure && error.code === code,
  );
}

test("the recovery set fixes 26 unique official pages, covers, and audited asset hashes", () => {
  assert.equal(SEIKO_MATSUDA_RECOVERY_WORK_KEYS.length, 26);
  const specs = SEIKO_MATSUDA_RECOVERY_WORK_KEYS.map((key) =>
    SEIKO_MATSUDA_RECOVERY_SPECS[key]);
  assert.equal(new Set(specs.map((spec) => spec.sourceUrl)).size, 26);
  assert.equal(new Set(specs.map((spec) => spec.coverPath)).size, 26);
  assert.equal(new Set(specs.map((spec) => spec.auditedAsset.sha256)).size, 26);
  assert.equal(specs.every((spec) =>
    spec.sourceUrl === `${SEIKO_MATSUDA_RECOVERY_ORIGIN}/discography/detail/${spec.detailId}` &&
    /^\/discography\/detail\/\d+$/u.test(new URL(spec.sourceUrl).pathname) &&
    /^\/discography\/images\/upload\//u.test(spec.coverPath) &&
    /^[a-f0-9]{64}$/u.test(spec.auditedAsset.sha256)), true);

  // These official product numbers are intentionally not treated as work keys.
  assert.equal(SEIKO_MATSUDA_RECOVERY_SPECS["SINGLE:20"].catalogDisplay,
    SEIKO_MATSUDA_RECOVERY_SPECS["SINGLE:21"].catalogDisplay);
  assert.equal(SEIKO_MATSUDA_RECOVERY_SPECS["SINGLE:23"].catalogDisplay,
    SEIKO_MATSUDA_RECOVERY_SPECS["SINGLE:24"].catalogDisplay);
});

for (const key of SEIKO_MATSUDA_RECOVERY_WORK_KEYS) {
  test(`strictly parses the fixed Seiko recovery entity ${key}`, () => {
    const spec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
    const entity = parseSeikoMatsudaRecoveryPage(key, fixturePage(key));
    assert.equal(entity.manifestEntryKey, key);
    assert.equal(entity.sourceUrl, spec.sourceUrl);
    assert.equal(entity.observedTitle, spec.pageTitle);
    assert.equal(entity.canonicalTitle, spec.canonicalTitle);
    assert.equal(entity.observedReleaseDate, spec.releaseDate);
    assert.equal(entity.observedCatalogDisplay, spec.catalogDisplay);
    assert.deepEqual(entity.observedCatalogNumbers, [...spec.catalogNumbers]);
    assert.equal(entity.carrier.role, "AUTHORITATIVE");
    assert.equal(entity.carrier.strength, "STRONG");
    assert.equal(entity.carrier.facts.carrier, "CD");
    assert.equal(entity.carrier.facts.format, "CD");
    assert.equal(entity.carrier.facts.selectionPolicy, spec.selectionPolicy);
    assert.equal(entity.cover.scope, "WORK");
    assert.equal(entity.cover.matchLevel, "WORK_EXACT");
    assert.equal(entity.cover.url, new URL(spec.coverPath, SEIKO_MATSUDA_RECOVERY_ORIGIN).toString());
    assert.equal(entity.cover.sourceUrl, spec.sourceUrl);
    assert.deepEqual(entity.cover.auditedAsset, spec.auditedAsset);
  });
}

test("the page parser fails closed on every fixed identity and cover boundary", () => {
  const key = "SINGLE:27" as const;
  const cases: Array<{
    label: string;
    overrides: FixtureOverrides;
    code: SeikoMatsudaRecoveryFailure["code"];
  }> = [
    { label: "official shell", overrides: { artist: "Not Seiko" }, code: "artist-identity-mismatch" },
    { label: "title", overrides: { title: "Precious" }, code: "title-mismatch" },
    { label: "date", overrides: { date: "1989-11-16" }, code: "date-mismatch" },
    { label: "catalog", overrides: { catalog: "CSDL-3046" }, code: "catalog-mismatch" },
    { label: "category label", overrides: { categoryLabel: "アルバム" }, code: "category-mismatch" },
    { label: "category path", overrides: { categoryPath: "/discography/album" }, code: "category-mismatch" },
    { label: "cover alt", overrides: { coverAlt: "Another work" }, code: "cover-title-mismatch" },
    {
      label: "cover path",
      overrides: { coverPath: "/discography/images/upload/not-the-fixed-cover.gif" },
      code: "cover-url-invalid",
    },
    { label: "duplicate cover", overrides: { duplicateCover: true }, code: "cover-count-mismatch" },
  ];
  for (const item of cases) {
    assert.doesNotThrow(() => {
      expectedFailure(key, item.overrides, item.code);
    }, item.label);
  }
});

test("SEIKO MATSUDA 2020 accepts only the explicit normal-edition page contract", () => {
  const key = "ORIGINAL_ALBUM:53" as const;
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
  assert.equal(spec.selectionPolicy, "NORMAL_EDITION");
  assert.equal(spec.detailId, 549);
  assert.equal(spec.pageTitle, "SEIKO MATSUDA 2020【通常盤】");
  expectedFailure(key, {
    title: "SEIKO MATSUDA 2020【初回限定盤】",
    coverAlt: "SEIKO MATSUDA 2020【初回限定盤】",
    coverPath: "/discography/images/upload/seiko matsuda2020_syokai.jpg",
  }, "title-mismatch");
  expectedFailure(key, {
    coverPath: "/discography/images/upload/seiko matsuda2020_syokai.jpg",
  }, "cover-url-invalid");
});

test("single 76 accepts only the audited normal-edition product", () => {
  const key = "SINGLE:76" as const;
  const spec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
  assert.equal(spec.selectionPolicy, "NORMAL_EDITION");
  assert.equal(spec.detailId, 364);
  assert.equal(spec.catalogDisplay, "UPCH-80414");
  assert.equal(spec.pageTitle, "「永遠のもっと果てまで/惑星になりたい」【通常盤】");
  expectedFailure(key, {
    title: "「永遠のもっと果てまで/惑星になりたい」【初回限定盤A】",
    coverAlt: "「永遠のもっと果てまで/惑星になりたい」【初回限定盤A】",
    coverPath: "/discography/images/upload/UPCH-89240.jpg",
    catalog: "UPCH-89240",
  }, "title-mismatch");
});

test("the client enforces request safety, bounded concurrency, TTL, and success-only caching", async () => {
  let now = 10_000;
  let requests = 0;
  let resolverCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const client = new SeikoMatsudaRecoveryClient({
    now: () => now,
    resolveHost: async () => {
      resolverCalls += 1;
      return publicResolver();
    },
    fetchImpl: async (input, init) => {
      requests += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      const url = input.toString();
      const key = keyByUrl.get(url);
      assert.ok(key, url);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "manual");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.referrerPolicy, "no-referrer");
      assert.equal(new Headers(init?.headers).get("accept-language"), "ja");
      assert.match(new Headers(init?.headers).get("user-agent") ?? "", /CD-BOX/u);
      return pageResponse(key);
    },
    concurrency: 2,
    minimumIntervalMs: 0,
    cacheTtlMs: 1_000,
    retryCount: 0,
  });

  const first = await client.load();
  assert.equal(first.status, "COMPLETE");
  assert.equal(first.verified.length, 26);
  assert.equal(Object.keys(first.byManifestEntryKey).length, 26);
  assert.equal(requests, 26);
  assert.equal(resolverCalls, 1);
  assert.equal(maximumActive, 2);
  assert.equal(first.stats.cacheHits, 0);
  assert.equal(first.stats.pagesParsed, 26);

  const cached = await client.load();
  assert.equal(cached.status, "COMPLETE");
  assert.equal(cached.stats.cacheHits, 26);
  assert.equal(cached.stats.dnsLookups, 0);
  assert.equal(requests, 26);
  assert.equal(resolverCalls, 1);

  now += 1_001;
  const expired = await client.load();
  assert.equal(expired.status, "COMPLETE");
  assert.equal(expired.stats.cacheHits, 0);
  assert.equal(requests, 52);
  assert.equal(resolverCalls, 2);
});

test("one network failure affects only its page and is never cached", async () => {
  const failedKey = "SINGLE:27" as const;
  let unavailable = true;
  let requests = 0;
  const client = new SeikoMatsudaRecoveryClient({
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      requests += 1;
      const key = keyByUrl.get(input.toString());
      assert.ok(key);
      if (key === failedKey && unavailable) throw new Error("isolated network failure");
      return pageResponse(key);
    },
    minimumIntervalMs: 0,
    retryCount: 0,
  });

  const first = await client.load();
  assert.equal(first.status, "PARTIAL");
  assert.equal(first.verified.length, 25);
  assert.equal(first.stats.failures, 1);
  assert.deepEqual(first.outcomes.filter((outcome) => outcome.status === "FAILED")
    .map((outcome) => [outcome.workKey, outcome.failure.code]), [
    [failedKey, "network-unavailable"],
  ]);
  assert.equal(requests, 26);

  unavailable = false;
  const recovered = await client.load();
  assert.equal(recovered.status, "COMPLETE");
  assert.equal(recovered.stats.cacheHits, 25);
  assert.equal(recovered.stats.requestsAttempted, 1);
  assert.equal(requests, 27);
});

test("private DNS fails before fetch and preserves a per-page outcome", async () => {
  let fetched = false;
  const client = new SeikoMatsudaRecoveryClient({
    resolveHost: async () => ["127.0.0.1"],
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
    minimumIntervalMs: 0,
  });
  const outcome = await client.loadKey("SINGLE:1");
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.status === "FAILED" ? outcome.failure.code : null, "non-public-address");
  assert.equal(fetched, false);
});

test("retryable HTTP failure retries only the affected page", async () => {
  let requests = 0;
  const delays: number[] = [];
  const client = new SeikoMatsudaRecoveryClient({
    resolveHost: publicResolver,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return new Response(null, { status: 503 });
      return pageResponse("SINGLE:27");
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    retryCount: 1,
    retryDelayMs: 5,
    minimumIntervalMs: 0,
    cacheTtlMs: 0,
  });
  const result = await client.load(["SINGLE:27"]);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.stats.requestsAttempted, 2);
  assert.equal(result.stats.retries, 1);
  assert.deepEqual(delays, [5]);
});

test("response byte, MIME, redirect, and timeout limits fail closed", async (t) => {
  await t.test("content length", async () => {
    const client = new SeikoMatsudaRecoveryClient({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("short", {
        status: 200,
        headers: { "Content-Type": "text/html", "Content-Length": "2048" },
      }),
      maxPageBytes: 1_024,
      retryCount: 0,
      minimumIntervalMs: 0,
    });
    const outcome = await client.loadKey("SINGLE:1");
    assert.equal(outcome.status === "FAILED" ? outcome.failure.code : null, "response-too-large");
  });

  await t.test("MIME", async () => {
    const client = new SeikoMatsudaRecoveryClient({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      retryCount: 0,
      minimumIntervalMs: 0,
    });
    const outcome = await client.loadKey("SINGLE:1");
    assert.equal(outcome.status === "FAILED" ? outcome.failure.code : null,
      "unsupported-content-type");
  });

  await t.test("redirect", async () => {
    const client = new SeikoMatsudaRecoveryClient({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/" },
      }),
      retryCount: 0,
      minimumIntervalMs: 0,
    });
    const outcome = await client.loadKey("SINGLE:1");
    assert.equal(outcome.status === "FAILED" ? outcome.failure.code : null,
      "redirect-not-allowed");
  });

  await t.test("timeout", async () => {
    const client = new SeikoMatsudaRecoveryClient({
      resolveHost: publicResolver,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
      timeoutMs: 100,
      retryCount: 0,
      minimumIntervalMs: 0,
    });
    const outcome = await client.loadKey("SINGLE:1");
    assert.equal(outcome.status === "FAILED" ? outcome.failure.code : null, "network-timeout");
  });
});

test("detail URL lookup is restricted to the fixed allowlist", () => {
  for (const key of SEIKO_MATSUDA_RECOVERY_WORK_KEYS) {
    const spec: SeikoMatsudaRecoverySpec = SEIKO_MATSUDA_RECOVERY_SPECS[key];
    assert.equal(seikoMatsudaRecoveryDetailUrl(key), spec.sourceUrl);
    const url = new URL(spec.sourceUrl);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.seikomatsuda.co.jp");
    assert.equal(url.pathname, `/discography/detail/${spec.detailId}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
});
