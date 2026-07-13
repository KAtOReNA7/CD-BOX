import assert from "node:assert/strict";
import { before, test } from "node:test";
import sharp from "sharp";
import {
  isAllowedCoverAssetHost,
  isAllowedCoverAssetUrl,
  isAllowedVerifiedCoverAssetUrl,
  isAllowedVerifiedCoverSourceUrl,
  validateCoverAsset,
  type CoverAssetFetch,
} from "@/lib/ai/cover-asset-validation";

function uint16Be(value: number) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint16Le(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint32Be(value: number) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function uint32Le(value: number) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function raster(width: number, height: number, alpha = 1) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 24, g: 96, b: 168, alpha },
    },
  });
}

async function jpeg(width = 600, height = 600, metadataBytes = 0) {
  const encoded = new Uint8Array(await raster(width, height).jpeg().toBuffer());
  if (metadataBytes === 0) return encoded;
  const result = new Uint8Array(encoded.byteLength + metadataBytes + 4);
  result.set(encoded.subarray(0, 2), 0);
  result.set([0xff, 0xe1, ...uint16Be(metadataBytes + 2)], 2);
  result.set(encoded.subarray(2), metadataBytes + 6);
  return result;
}

async function png(width = 600, height = 600) {
  return new Uint8Array(await raster(width, height).png().toBuffer());
}

function pngHeader(width = 600, height = 600) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    ...uint32Be(width),
    ...uint32Be(height),
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

async function gif(width = 600, height = 600, version: "87a" | "89a" = "89a") {
  const encoded = new Uint8Array(await raster(width, height).gif().toBuffer());
  encoded[4] = version === "87a" ? 0x37 : 0x39;
  return encoded;
}

async function webp(
  kind: "VP8" | "VP8L" | "VP8X" = "VP8X",
  width = 600,
  height = 600,
) {
  const source = kind === "VP8X" ? raster(width, height, 0.5) : raster(width, height);
  return new Uint8Array(await source.webp({ lossless: kind === "VP8L" }).toBuffer());
}

function bmp(width = 600, height = 600) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const imageBytes = rowBytes * height;
  const bytes = new Uint8Array(54 + imageBytes);
  bytes.set([0x42, 0x4d], 0);
  bytes.set(uint32Le(bytes.byteLength), 2);
  bytes.set(uint32Le(54), 10);
  bytes.set(uint32Le(40), 14);
  bytes.set(uint32Le(width), 18);
  bytes.set(uint32Le(height), 22);
  bytes.set(uint16Le(1), 26);
  bytes.set(uint16Le(24), 28);
  bytes.set(uint32Le(imageBytes), 34);
  return bytes;
}

let defaultJpeg = new Uint8Array();
before(async () => {
  defaultJpeg = await jpeg();
});

function imageResponse(
  body: BodyInit = defaultJpeg,
  init: ResponseInit = {},
) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "image/jpeg", ...init.headers },
    ...init,
  });
}

test("allows only approved HTTPS cover hosts", () => {
  assert.equal(isAllowedCoverAssetHost("coverartarchive.org"), true);
  assert.equal(isAllowedCoverAssetHost("ia801900.us.archive.org"), true);
  assert.equal(isAllowedCoverAssetHost("i.discogs.com"), true);
  assert.equal(isAllowedCoverAssetHost("img.discogs.com"), true);
  assert.equal(isAllowedCoverAssetHost("is1-ssl.mzstatic.com"), true);
  assert.equal(isAllowedCoverAssetHost("soundfuji.kingrecords.co.jp"), true);
  assert.equal(isAllowedCoverAssetHost("www.110107.com"), true);
  assert.equal(isAllowedCoverAssetHost("www.sonymusic.co.jp"), true);
  assert.equal(isAllowedCoverAssetHost("www.seikomatsuda.co.jp"), true);
  assert.equal(isAllowedCoverAssetHost("content-jp.umgi.net"), true);
  assert.equal(isAllowedCoverAssetHost("wmg.jp"), true);
  assert.equal(isAllowedCoverAssetHost("discogs.com"), false);
  assert.equal(isAllowedCoverAssetHost("evil.soundfuji.kingrecords.co.jp.example"), false);
  assert.equal(isAllowedCoverAssetHost("mzstatic.com.evil.example"), false);
  assert.equal(isAllowedCoverAssetHost("content-jp.umgi.net.example"), false);

  assert.equal(isAllowedCoverAssetUrl("https://coverartarchive.org/release/example/front"), true);
  assert.equal(isAllowedCoverAssetUrl("http://coverartarchive.org/release/example/front"), false);
  assert.equal(isAllowedCoverAssetUrl("https://example.com/cover.jpg"), false);
  assert.equal(isAllowedCoverAssetUrl("https://user:secret@archive.org/cover.jpg"), false);
  assert.equal(isAllowedCoverAssetUrl("https://archive.org:444/cover.jpg"), false);
});

test("binds final verified artwork and source URLs to the attested provider", () => {
  assert.equal(
    isAllowedVerifiedCoverAssetUrl("https://ia801900.us.archive.org/download/id/front.jpg", "cover-art-archive"),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl("https://i.discogs.com/signed/front.jpg", "discogs"),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl("https://is1-ssl.mzstatic.com/image/front.jpg", "discogs"),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl("https://is1-ssl.mzstatic.com/image/front.jpg", "apple-music"),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl("https://i.discogs.com/signed/front.jpg", "cover-art-archive"),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://coverartarchive.org/release/00000000-0000-0000-0000-000000000000",
      "cover-art-archive",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://coverartarchive.org/release-group/00000000-0000-0000-0000-000000000000",
      "cover-art-archive",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl("https://www.discogs.com/release/123", "discogs"),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl("https://www.discogs.com/release/123", "cover-art-archive"),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl("https://music.apple.com/jp/album/example/123", "apple-music"),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl("https://example.com/jp/album/example/123", "apple-music"),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://soundfuji.kingrecords.co.jp/shared/img/2024/06/NOPA-2409.jpg",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://soundfuji.kingrecords.co.jp/release/1603/",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://soundfuji.kingrecords.co.jp/release/not-an-id/",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://soundfuji.kingrecords.co.jp/shared/img/cover.jpg",
      "apple-music",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.110107.com/files/6/OTONANO/originalpage/golden_idol/img/momoe/SOLB29.jpg",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.110107.com/s/oto/page/golden_momoe",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.sonymusic.co.jp/adm_image/common/artist_image/83250000/83250172/jacket_image/78696.jpg",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/discography/buy/MHCL-10011",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.110107.com/s/oto/page/another-artist",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.sonymusic.co.jp/artist/MomoeYamaguchi/profile.jpg",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.seikomatsuda.co.jp/discography/images/upload/1985-3_Artwork19850624-112-0001.gif",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.seikomatsuda.co.jp/discography/detail/43",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.seikomatsuda.co.jp/img/profile.jpg",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.seikomatsuda.co.jp/discography/single",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.seikomatsuda.co.jp/discography/images/upload/seiko%20matsuda2020_tsujyo.jpg",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://www.seikomatsuda.co.jp/discography/images/upload/seiko%2Fmatsuda2020_tsujyo.jpg",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://content-jp.umgi.net/products/um/umck-5257_HTh_extralarge.jpg?26122017060855",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.universal-music.co.jp/nakamori-akina/products/umck-5257/",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://content-jp.umgi.net/products/up/upch-9999_fake_extralarge.jpg",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://www.universal-music.co.jp/another-artist/products/umck-5257/",
      "official-label",
    ),
    false,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://wmg.jp/packages/33269/images/tujyoban_jacket.jpg",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverSourceUrl(
      "https://wmg.jp/akina/discography/33083/",
      "official-label",
    ),
    true,
  );
  assert.equal(
    isAllowedVerifiedCoverAssetUrl(
      "https://wmg.jp/packages/33268/images/deluxe_jacket.jpg",
      "official-label",
    ),
    false,
  );
});

test("downloads and fully decodes an allowed 2xx image", async () => {
  let observedInit: RequestInit | undefined;
  const fetchImpl: CoverAssetFetch = async (_input, init) => {
    observedInit = init;
    return imageResponse();
  };

  const result = await validateCoverAsset(
    "https://coverartarchive.org/release/00000000-0000-0000-0000-000000000000/front",
    { fetchImpl, retryCount: 0 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.reason, "valid");
  assert.equal(result.status, 200);
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.bytesRead, defaultJpeg.byteLength);
  assert.equal(result.imageFormat, "jpeg");
  assert.equal(result.width, 600);
  assert.equal(result.height, 600);
  assert.match(result.contentSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.attempts, 1);
  assert.equal(observedInit?.method, "GET");
  assert.equal(new Headers(observedInit?.headers).get("range"), null);
  assert.equal(observedInit?.redirect, "manual");
  assert.equal(observedInit?.credentials, "omit");
  assert.equal(observedInit?.referrerPolicy, "no-referrer");
});

test("recognizes valid JPEG, PNG, GIF, BMP, and all WebP dimension headers", async () => {
  const fixtures = [
    { format: "jpeg", type: "image/jpeg", body: await jpeg() },
    { format: "png", type: "image/png", body: await png() },
    { format: "gif", type: "image/gif", body: await gif(600, 600, "87a") },
    { format: "gif", type: "image/gif", body: await gif(600, 600, "89a") },
    { format: "webp", type: "image/webp", body: await webp("VP8") },
    { format: "webp", type: "image/webp", body: await webp("VP8L") },
    { format: "webp", type: "image/webp", body: await webp("VP8X") },
    { format: "bmp", type: "image/bmp", body: bmp() },
  ] as const;

  for (const fixture of fixtures) {
    const result = await validateCoverAsset("https://archive.org/download/example/cover", {
      fetchImpl: async () => imageResponse(fixture.body, {
        headers: { "Content-Type": fixture.type },
      }),
      retryCount: 0,
    });
    assert.equal(result.ok, true, `${fixture.format} should pass (${result.reason})`);
    assert.equal(result.imageFormat, fixture.format);
    assert.equal(result.width, 600);
    assert.equal(result.height, 600);
  }
});

test("rejects MIME spoofing, format mismatches, unsupported data, and truncated headers", async () => {
  const validateBody = (body: BodyInit, contentType = "image/jpeg") =>
    validateCoverAsset("https://archive.org/download/example/cover", {
      fetchImpl: async () => imageResponse(body, {
        headers: { "Content-Type": contentType },
      }),
      retryCount: 0,
    });

  assert.equal((await validateBody("<html>not a cover</html>")).reason, "unsupported-image-format");
  assert.equal((await validateBody(await png())).reason, "image-type-mismatch");
  assert.equal((await validateBody(await jpeg(), "image/png")).reason, "image-type-mismatch");
  assert.equal((await validateBody(new Uint8Array([0xff, 0xd8]))).reason, "invalid-image-header");
  assert.equal((await validateBody(pngHeader().subarray(0, 24), "image/png")).reason, "invalid-image-header");
  assert.equal((await validateBody((await webp()).subarray(0, 20), "image/webp")).reason, "invalid-image-header");
  assert.equal((await validateBody((await gif()).subarray(0, 10), "image/gif")).reason, "invalid-image-header");
  assert.equal((await validateBody(pngHeader(), "image/png")).reason, "invalid-image-data");
  assert.equal((await validateBody((await jpeg()).subarray(0, 200), "image/jpeg")).reason, "invalid-image-data");
});

test("allows a fully decoded MIME mismatch only when an audited caller opts in", async () => {
  const result = await validateCoverAsset("https://content-jp.umgi.net/products/up/upch-7267_test_extralarge.jpg", {
    fetchImpl: async () => imageResponse(await png(500, 500), {
      headers: { "Content-Type": "image/jpeg" },
    }),
    retryCount: 0,
    allowImageTypeMismatch: true,
  });

  assert.equal(result.reason, "valid");
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.imageFormat, "png");
  assert.equal(result.width, 500);
  assert.equal(result.height, 500);
  assert.match(result.contentSha256 ?? "", /^[a-f0-9]{64}$/u);
});

test("rejects tiny placeholders and implausible dimensions at hard boundaries", async () => {
  const validatePng = async (width: number, height: number) =>
    validateCoverAsset("https://archive.org/download/example/cover.png", {
      fetchImpl: async () => imageResponse(
        width >= 64 && height >= 64 && width <= 2_000 && height <= 2_000
          ? await png(width, height)
          : pngHeader(width, height), {
        headers: { "Content-Type": "image/png" },
      }),
      retryCount: 0,
    });

  assert.equal((await validatePng(1, 1)).reason, "image-too-small");
  assert.equal((await validatePng(63, 600)).reason, "image-too-small");
  assert.equal((await validatePng(64, 64)).reason, "valid");
  assert.equal((await validatePng(20_001, 600)).reason, "image-dimensions-too-large");
  assert.equal((await validatePng(20_000, 6_000)).reason, "image-dimensions-too-large");
});

test("fully decodes metadata-heavy images and rejects bodies above maxBytes", async () => {
  const metadataResult = await validateCoverAsset("https://archive.org/download/example/metadata.jpg", {
    fetchImpl: async () => imageResponse(await jpeg(600, 600, 5_000)),
    retryCount: 0,
  });
  assert.equal(metadataResult.reason, "valid");
  assert.equal(metadataResult.width, 600);

  const largeBody = await png(600, 600);
  let observedInit: RequestInit | undefined;
  const boundedResult = await validateCoverAsset("https://archive.org/download/example/large.png", {
    fetchImpl: async (_input, init) => {
      observedInit = init;
      return imageResponse(largeBody, { headers: { "Content-Type": "image/png" } });
    },
    maxBytes: 64,
    retryCount: 0,
  });
  assert.equal(boundedResult.reason, "image-too-large");
  assert.equal(boundedResult.bytesRead, 0);
  assert.equal(new Headers(observedInit?.headers).get("range"), null);
});

test("follows only validated HTTPS redirects to Internet Archive", async () => {
  const calls: string[] = [];
  const fetchImpl: CoverAssetFetch = async (input) => {
    const url = input.toString();
    calls.push(url);
    if (calls.length === 1) {
      return new Response(null, {
        status: 307,
        headers: { Location: "https://ia801900.us.archive.org/download/mbid/cover.jpg" },
      });
    }
    return imageResponse();
  };

  const result = await validateCoverAsset("https://coverartarchive.org/release/example/front", {
    fetchImpl,
    retryCount: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.redirects, 1);
  assert.equal(result.finalHost, "ia801900.us.archive.org");
  assert.equal(calls.length, 2);
});

test("refuses an unapproved redirect before requesting its target", async () => {
  let calls = 0;
  const fetchImpl: CoverAssetFetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: "https://127.0.0.1/private-cover" },
    });
  };

  const result = await validateCoverAsset("https://coverartarchive.org/release/example/front", {
    fetchImpl,
    retryCount: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "redirect-host-not-allowed");
  assert.equal(result.retryable, false);
  assert.equal(calls, 1);
});

test("accepts legacy Discogs and Apple artwork CDNs", async () => {
  const fetchImpl: CoverAssetFetch = async () => imageResponse();
  for (const url of [
    "https://i.discogs.com/signed/image.jpg",
    "https://img.discogs.com/legacy/image.jpg",
    "https://is1-ssl.mzstatic.com/image/thumb/Music/example/100x100bb.jpg",
  ]) {
    const result = await validateCoverAsset(url, { fetchImpl, retryCount: 0 });
    assert.equal(result.ok, true, url);
  }
});

test("returns structured failures for non-images, empty images, and HTTP errors", async () => {
  const notImage = await validateCoverAsset("https://archive.org/download/example/file", {
    fetchImpl: async () => new Response("not an image", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
    retryCount: 0,
  });
  assert.equal(notImage.reason, "not-image");
  assert.equal(notImage.contentType, "text/html");

  const empty = await validateCoverAsset("https://archive.org/download/example/empty.jpg", {
    fetchImpl: async () => new Response(null, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    }),
    retryCount: 0,
  });
  assert.equal(empty.reason, "empty-body");
  assert.equal(empty.bytesRead, 0);

  const missing = await validateCoverAsset("https://archive.org/download/example/missing.jpg", {
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.equal(missing.reason, "http-status");
  assert.equal(missing.status, 404);
  assert.equal(missing.attempts, 1);
});

test("retries transient responses at most twice", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await validateCoverAsset("https://archive.org/download/example/cover.jpg", {
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? new Response(null, { status: 503 })
        : imageResponse();
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("treats a cover CDN 403 as retryable instead of permanently invalid", async () => {
  let calls = 0;
  const result = await validateCoverAsset("https://coverartarchive.org/release/example/front", {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 403 }) : imageResponse();
    },
    retryCount: 1,
    retryDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("turns timeout and network exceptions into sanitized results", async () => {
  const timedOut = await validateCoverAsset("https://archive.org/download/example/slow.jpg", {
    timeoutMs: 5,
    retryCount: 0,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("secret upstream detail", "AbortError"));
      }, { once: true });
    }),
  });
  assert.equal(timedOut.reason, "timeout");
  assert.equal(timedOut.attempts, 1);

  const stalledBody = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
  });
  const bodyTimedOut = await validateCoverAsset("https://archive.org/download/example/stalled.jpg", {
    timeoutMs: 5,
    retryCount: 0,
    fetchImpl: async () => new Response(stalledBody, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    }),
  });
  assert.equal(bodyTimedOut.reason, "timeout");
  assert.equal(bodyTimedOut.attempts, 1);

  let calls = 0;
  const network = await validateCoverAsset("https://archive.org/download/example/error.jpg", {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("secret-token-must-not-leak");
    },
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(network.reason, "network-error");
  assert.equal(network.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(JSON.stringify(network).includes("secret-token-must-not-leak"), false);
});

test("rejects invalid, non-HTTPS, and unapproved inputs without fetching", async () => {
  let calls = 0;
  const fetchImpl: CoverAssetFetch = async () => {
    calls += 1;
    return imageResponse();
  };

  assert.equal((await validateCoverAsset("not a url", { fetchImpl })).reason, "invalid-url");
  assert.equal((await validateCoverAsset("http://archive.org/cover.jpg", { fetchImpl })).reason, "https-required");
  assert.equal((await validateCoverAsset("https://example.com/cover.jpg", { fetchImpl })).reason, "host-not-allowed");
  assert.equal(calls, 0);
});
