import assert from "node:assert/strict";
import test from "node:test";

import { validateProviderCover } from "@/lib/ai/comprehensive-source-adapters";
import type { CoverAssetValidationResult } from "@/lib/ai/cover-asset-validation";
import { SEIKO_MATSUDA_RECOVERY_SPECS } from
  "@/lib/official-music/seiko-matsuda-recovery";
import { AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS } from
  "@/lib/official-music/akina-nakamori";

const spec = SEIKO_MATSUDA_RECOVERY_SPECS["ORIGINAL_ALBUM:53"];
const imageUrl = `https://www.seikomatsuda.co.jp${spec.coverPath}`;

function validation(overrides: Partial<CoverAssetValidationResult> = {}): CoverAssetValidationResult {
  return {
    ok: true,
    reason: "valid",
    retryable: false,
    attempts: 1,
    redirects: 0,
    status: 200,
    contentType: spec.auditedAsset.mime,
    bytesRead: 10_000,
    sourceHost: "www.seikomatsuda.co.jp",
    finalHost: "www.seikomatsuda.co.jp",
    imageFormat: "jpeg",
    width: spec.auditedAsset.width,
    height: spec.auditedAsset.height,
    contentSha256: spec.auditedAsset.sha256,
    ...overrides,
  };
}

test("accepts an exact audited Akina PNG even when Universal declares JPEG", async () => {
  const akinaSpec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS["ORIGINAL_ALBUM:15"];
  let observedOptions: unknown;
  const result = await validateProviderCover(
    "https://content-jp.umgi.net/products/up/upch-7267_test_extralarge.jpg",
    akinaSpec.sourceUrl,
    "official-label",
    async (_url, options) => {
      observedOptions = options;
      return {
        ...validation(),
        contentType: "image/jpeg",
        imageFormat: "png",
        width: akinaSpec.auditedAsset.width,
        height: akinaSpec.auditedAsset.height,
        contentSha256: akinaSpec.auditedAsset.sha256,
        finalHost: "content-jp.umgi.net",
      };
    },
    () => new Date("2026-07-13T00:00:00.000Z"),
    {
      coverMatchLevel: "WORK",
      sourceReleaseDate: akinaSpec.releaseDate,
      expectedAsset: akinaSpec.auditedAsset,
    },
  );

  assert.equal(result.found?.status, "FOUND");
  assert.equal(result.found?.contentSha256, akinaSpec.auditedAsset.sha256);
  assert.deepEqual(observedOptions, { allowImageTypeMismatch: true });
});

test("rejects an audited MIME mismatch when the downloaded hash changes", async () => {
  const akinaSpec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS["ORIGINAL_ALBUM:15"];
  const result = await validateProviderCover(
    "https://content-jp.umgi.net/products/up/upch-7267_test_extralarge.jpg",
    akinaSpec.sourceUrl,
    "official-label",
    async () => ({
      ...validation(),
      contentType: "image/jpeg",
      imageFormat: "png",
      width: akinaSpec.auditedAsset.width,
      height: akinaSpec.auditedAsset.height,
      contentSha256: "0".repeat(64),
      finalHost: "content-jp.umgi.net",
    }),
    () => new Date("2026-07-13T00:00:00.000Z"),
    {
      coverMatchLevel: "WORK",
      sourceReleaseDate: akinaSpec.releaseDate,
      expectedAsset: akinaSpec.auditedAsset,
    },
  );

  assert.equal(result.found, null);
  assert.equal(result.invalid, true);
});

test("accepts a recovered official cover only when downloaded bytes match its audit", async () => {
  const result = await validateProviderCover(
    imageUrl,
    spec.sourceUrl,
    "official-label",
    async () => validation(),
    () => new Date("2026-07-13T00:00:00.000Z"),
    {
      coverMatchLevel: "WORK",
      sourceReleaseDate: spec.releaseDate,
      expectedAsset: spec.auditedAsset,
    },
  );

  assert.equal(result.found?.status, "FOUND");
  assert.equal(result.found?.contentSha256, spec.auditedAsset.sha256);
  assert.equal(result.invalid, false);
});

test("rejects a newly validated cover when the downloaded bytes have no SHA-256", async () => {
  const result = await validateProviderCover(
    imageUrl,
    spec.sourceUrl,
    "official-label",
    async () => validation({ contentSha256: null }),
    () => new Date("2026-07-13T00:00:00.000Z"),
    {
      coverMatchLevel: "WORK",
      sourceReleaseDate: spec.releaseDate,
      expectedAsset: spec.auditedAsset,
    },
  );

  assert.equal(result.found, null);
  assert.equal(result.invalid, true);
});

for (const [field, changed] of [
  ["hash", { contentSha256: "0".repeat(64) }],
  ["mime", { contentType: "image/png" }],
  ["width", { width: spec.auditedAsset.width + 1 }],
  ["height", { height: spec.auditedAsset.height + 1 }],
] as const) {
  test(`rejects the same recovery URL when downloaded ${field} changes`, async () => {
    const result = await validateProviderCover(
      imageUrl,
      spec.sourceUrl,
      "official-label",
      async () => validation(changed),
      () => new Date("2026-07-13T00:00:00.000Z"),
      {
        coverMatchLevel: "WORK",
        sourceReleaseDate: spec.releaseDate,
        expectedAsset: spec.auditedAsset,
      },
    );

    assert.equal(result.found, null);
    assert.equal(result.invalid, true);
    assert.equal(result.retryable, false);
  });
}
