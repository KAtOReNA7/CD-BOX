import sharp from "sharp";
import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_IMAGE_BYTES = 16 * 1_024 * 1_024;
const MAX_IMAGE_BYTES = 32 * 1_024 * 1_024;
const DEFAULT_MAX_REDIRECTS = 3;
const MIN_COVER_DIMENSION = 64;
const MAX_COVER_DIMENSION = 20_000;
const MAX_COVER_PIXELS = 100_000_000;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type CoverAssetValidationReason =
  | "valid"
  | "invalid-url"
  | "https-required"
  | "host-not-allowed"
  | "redirect-location-missing"
  | "redirect-url-invalid"
  | "redirect-https-required"
  | "redirect-host-not-allowed"
  | "too-many-redirects"
  | "timeout"
  | "network-error"
  | "http-status"
  | "not-image"
  | "empty-body"
  | "image-too-large"
  | "unsupported-image-format"
  | "invalid-image-header"
  | "invalid-image-data"
  | "image-type-mismatch"
  | "image-too-small"
  | "image-dimensions-too-large";

export type CoverAssetImageFormat = "jpeg" | "png" | "webp" | "gif" | "bmp";

export type CoverAssetValidationResult = {
  ok: boolean;
  reason: CoverAssetValidationReason;
  retryable: boolean;
  attempts: number;
  redirects: number;
  status: number | null;
  contentType: string | null;
  bytesRead: number;
  sourceHost: string | null;
  finalHost: string | null;
  imageFormat: CoverAssetImageFormat | null;
  width: number | null;
  height: number | null;
  /** Present for a successfully downloaded image; used by acceptance duplicate detection. */
  contentSha256?: string | null;
};

export type CoverAssetFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CoverAssetValidationOptions = {
  fetchImpl?: CoverAssetFetch;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  maxBytes?: number;
  /** @deprecated Use maxBytes. Kept for compatibility with older callers. */
  probeBytes?: number;
  maxRedirects?: number;
  /**
   * Allows a fully decoded image to proceed when an exact, separately audited
   * provider asset declares the wrong image MIME type. Callers must still
   * compare the detected format, dimensions, and SHA-256 before accepting it.
   */
  allowImageTypeMismatch?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
};

type AttemptResult = Omit<CoverAssetValidationResult, "attempts">;

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function parseUrl(value: string | URL) {
  try {
    return new URL(value.toString());
  } catch {
    return null;
  }
}

export function isAllowedCoverAssetHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    host === "coverartarchive.org" ||
    host.endsWith(".coverartarchive.org") ||
    host === "archive.org" ||
    host.endsWith(".archive.org") ||
    host === "i.discogs.com" ||
    host === "img.discogs.com" ||
    host === "soundfuji.kingrecords.co.jp" ||
    host === "www.110107.com" ||
    host === "www.sonymusic.co.jp" ||
    host === "www.seikomatsuda.co.jp" ||
    host === "content-jp.umgi.net" ||
    host === "wmg.jp" ||
    host === "mzstatic.com" ||
    host.endsWith(".mzstatic.com")
  );
}

export function isAllowedCoverAssetUrl(value: string | URL) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    isAllowedCoverAssetHost(url.hostname),
  );
}

export type VerifiedCoverProvider =
  | "cover-art-archive"
  | "discogs"
  | "apple-music"
  | "official-label";

export function isAllowedVerifiedCoverAssetHost(
  hostname: string,
  provider: VerifiedCoverProvider,
) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (provider === "cover-art-archive") {
    return host === "coverartarchive.org" || host.endsWith(".coverartarchive.org") ||
      host === "archive.org" || host.endsWith(".archive.org");
  }
  if (provider === "discogs") return host === "i.discogs.com" || host === "img.discogs.com";
  if (provider === "apple-music") return host === "mzstatic.com" || host.endsWith(".mzstatic.com");
  return host === "soundfuji.kingrecords.co.jp" ||
    host === "www.110107.com" ||
    host === "www.sonymusic.co.jp" ||
    host === "www.seikomatsuda.co.jp" ||
    host === "content-jp.umgi.net" ||
    host === "wmg.jp";
}

export function isAllowedVerifiedCoverAssetUrl(
  value: string | URL,
  provider: VerifiedCoverProvider,
) {
  const url = parseUrl(value);
  if (!url || !isAllowedCoverAssetUrl(url)) return false;
  if (!isAllowedVerifiedCoverAssetHost(url.hostname, provider)) return false;
  if (provider !== "official-label") return true;
  if (url.hostname === "soundfuji.kingrecords.co.jp") {
    return /^\/shared\/img\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.(?:avif|gif|jpe?g|png|webp)$/i
      .test(url.pathname);
  }
  if (url.hostname === "www.110107.com") {
    return /^\/files\/6\/OTONANO\/originalpage\/golden_idol\/img\/momoe\/[A-Za-z0-9._~-]+\.(?:jpe?g|png|webp)$/i
      .test(url.pathname);
  }
  if (url.hostname === "www.seikomatsuda.co.jp") {
    return url.pathname ===
        "/discography/images/upload/seiko%20matsuda2020_tsujyo.jpg" ||
      /^\/discography\/images\/upload\/[A-Za-z0-9._~-]+\.(?:gif|jpe?g|png|webp)$/i
        .test(url.pathname);
  }
  if (url.hostname === "content-jp.umgi.net") {
    return /^\/products\/(?:um|up)\/(?:umck-5257|upch-5870|upch-7267)_[A-Za-z0-9]+_extralarge\.jpe?g$/i
      .test(url.pathname) && (!url.search || /^\?\d{8,20}$/u.test(url.search));
  }
  if (url.hostname === "wmg.jp") {
    return url.pathname === "/packages/33269/images/tujyoban_jacket.jpg" &&
      !url.search && !url.hash;
  }
  return url.hostname === "www.sonymusic.co.jp" &&
    /^\/adm_image\/common\/artist_image\/(?:\d+\/)+jacket_image\/\d+(?:__\d+_\d+_\d+)?\.(?:jpe?g|png|webp)$/i
      .test(url.pathname);
}

export function isAllowedVerifiedCoverSourceUrl(
  value: string | URL,
  provider: VerifiedCoverProvider,
) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (provider === "cover-art-archive") {
    return url.hostname === "coverartarchive.org" &&
      /^\/(?:release|release-group)\/[0-9a-f-]+$/i.test(url.pathname);
  }
  if (provider === "discogs") {
    return url.hostname === "www.discogs.com" && /^\/release\/\d+$/i.test(url.pathname);
  }
  if (provider === "apple-music") {
    return (url.hostname === "music.apple.com" || url.hostname === "itunes.apple.com") &&
      /^\/[a-z]{2}(?:\/[a-z]{2})?\/(?:album|music)\//i.test(url.pathname);
  }
  if (url.hostname === "soundfuji.kingrecords.co.jp") {
    return /^\/release\/\d+\/$/i.test(url.pathname);
  }
  if (url.hostname === "www.110107.com") {
    return /^\/s\/oto\/page\/golden_momoe\/?$/i.test(url.pathname);
  }
  if (url.hostname === "www.seikomatsuda.co.jp") {
    return /^\/discography\/detail\/\d+\/?$/i.test(url.pathname);
  }
  if (url.hostname === "www.universal-music.co.jp") {
    return /^\/nakamori-akina\/products\/(?:umck-5257|upch-5870|upch-7267)\/$/i
      .test(url.pathname) && !url.search && !url.hash;
  }
  if (url.hostname === "wmg.jp") {
    return url.pathname === "/akina/discography/33083/" && !url.search && !url.hash;
  }
  return url.hostname === "www.sonymusic.co.jp" &&
    /^\/artist\/MomoeYamaguchi\/discography\/buy\/MHCL-\d+\/?$/i.test(url.pathname);
}

function result(
  sourceHost: string | null,
  finalHost: string | null,
  reason: CoverAssetValidationReason,
  overrides: Partial<AttemptResult> = {},
): AttemptResult {
  return {
    ok: reason === "valid",
    reason,
    retryable: false,
    redirects: 0,
    status: null,
    contentType: null,
    bytesRead: 0,
    sourceHost,
    finalHost,
    imageFormat: null,
    width: null,
    height: null,
    contentSha256: null,
    ...overrides,
  };
}

function normalizeContentType(value: string | null) {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function isRetryableStatus(status: number) {
  // Exact cover CDNs (notably Internet Archive's CAA backing store) can issue
  // temporary 403 responses while throttling. Treat access denial as an
  // unavailable source, never as proof that the audited image is invalid.
  return status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function cancelBody(response: Response) {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => undefined);
  } catch {
    // Cancellation is only a best-effort bandwidth guard.
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
) {
  if (!response.body) return { bytes: new Uint8Array(), exceeded: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let reads = 0;
  try {
    while (reads < 4_096) {
      reads += 1;
      const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(new DOMException("Cover probe timed out.", "AbortError"));
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        reader.read().then(resolve, reject).finally(() => {
          signal.removeEventListener("abort", abort);
        });
      });
      if (chunk.done) break;
      if (chunk.value.byteLength > 0) {
        if (bytesRead + chunk.value.byteLength > maximumBytes) {
          return { bytes: new Uint8Array(), exceeded: true };
        }
        chunks.push(chunk.value);
        bytesRead += chunk.value.byteLength;
      }
    }
    if (reads >= 4_096) return { bytes: new Uint8Array(), exceeded: true };
    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, exceeded: false };
  } finally {
    try {
      const cancellation = reader.cancel();
      void cancellation.catch(() => undefined);
    } catch {
      // The stream may already be closed or aborted.
    }
  }
}

type ImageHeader = {
  format: CoverAssetImageFormat;
  width: number;
  height: number;
};

type ImageInspection =
  | { ok: true; value: ImageHeader }
  | { ok: false; reason: "unsupported-image-format" | "invalid-image-header" };

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value);
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return offset + 2 <= bytes.length
    ? bytes[offset] * 0x100 + bytes[offset + 1]
    : null;
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return offset + 2 <= bytes.length
    ? bytes[offset] + bytes[offset + 1] * 0x100
    : null;
}

function readUint24Le(bytes: Uint8Array, offset: number) {
  return offset + 3 <= bytes.length
    ? bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000
    : null;
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return null;
  return (
    bytes[offset] * 0x1_000000 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint32Le(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return null;
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_000000
  );
}

function inspectJpeg(bytes: Uint8Array): ImageInspection {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { ok: false, reason: "invalid-image-header" };
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return { ok: false, reason: "invalid-image-header" };
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00) return { ok: false, reason: "invalid-image-header" };
    if (marker === 0xd9 || marker === 0xda) {
      return { ok: false, reason: "invalid-image-header" };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    const length = readUint16Be(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.length) {
      return { ok: false, reason: "invalid-image-header" };
    }
    if (startOfFrameMarkers.has(marker)) {
      if (length < 8) return { ok: false, reason: "invalid-image-header" };
      const height = readUint16Be(bytes, offset + 3);
      const width = readUint16Be(bytes, offset + 5);
      if (width === null || height === null || width === 0 || height === 0) {
        return { ok: false, reason: "invalid-image-header" };
      }
      return { ok: true, value: { format: "jpeg", width, height } };
    }
    offset += length;
  }
  return { ok: false, reason: "invalid-image-header" };
}

function inspectPng(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 33 || readUint32Be(bytes, 8) !== 13 ||
    !startsWith(bytes.subarray(12), [0x49, 0x48, 0x44, 0x52])) {
    return { ok: false, reason: "invalid-image-header" };
  }
  const width = readUint32Be(bytes, 16);
  const height = readUint32Be(bytes, 20);
  if (width === null || height === null || width === 0 || height === 0) {
    return { ok: false, reason: "invalid-image-header" };
  }
  return { ok: true, value: { format: "png", width, height } };
}

function inspectGif(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 13) return { ok: false, reason: "invalid-image-header" };
  const width = readUint16Le(bytes, 6);
  const height = readUint16Le(bytes, 8);
  if (width === null || height === null || width === 0 || height === 0) {
    return { ok: false, reason: "invalid-image-header" };
  }
  return { ok: true, value: { format: "gif", width, height } };
}

function inspectWebp(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 20 || !startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return { ok: false, reason: "invalid-image-header" };
  }
  const riffSize = readUint32Le(bytes, 4);
  const chunkSize = readUint32Le(bytes, 16);
  if (riffSize === null || riffSize < 12 || chunkSize === null) {
    return { ok: false, reason: "invalid-image-header" };
  }
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    const width = readUint24Le(bytes, 24);
    const height = readUint24Le(bytes, 27);
    if (chunkSize < 10 || width === null || height === null) {
      return { ok: false, reason: "invalid-image-header" };
    }
    return { ok: true, value: { format: "webp", width: width + 1, height: height + 1 } };
  }
  if (chunk === "VP8L") {
    if (chunkSize < 5 || bytes.length < 25 || bytes[20] !== 0x2f) {
      return { ok: false, reason: "invalid-image-header" };
    }
    const bits = readUint32Le(bytes, 21)!;
    return {
      ok: true,
      value: {
        format: "webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      },
    };
  }
  if (chunk === "VP8 ") {
    if (
      chunkSize < 10 ||
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) return { ok: false, reason: "invalid-image-header" };
    const width = readUint16Le(bytes, 26)! & 0x3fff;
    const height = readUint16Le(bytes, 28)! & 0x3fff;
    if (width === 0 || height === 0) return { ok: false, reason: "invalid-image-header" };
    return { ok: true, value: { format: "webp", width, height } };
  }
  return { ok: false, reason: "invalid-image-header" };
}

function inspectBmp(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 26) return { ok: false, reason: "invalid-image-header" };
  const dibSize = readUint32Le(bytes, 14);
  let width: number | null = null;
  let height: number | null = null;
  if (dibSize === 12) {
    width = readUint16Le(bytes, 18);
    height = readUint16Le(bytes, 20);
  } else if (dibSize !== null && dibSize >= 40 && bytes.length >= 26) {
    const rawWidth = readUint32Le(bytes, 18);
    const rawHeight = readUint32Le(bytes, 22);
    width = rawWidth === null ? null : Math.abs(rawWidth | 0);
    height = rawHeight === null ? null : Math.abs(rawHeight | 0);
  }
  if (!width || !height) return { ok: false, reason: "invalid-image-header" };
  return { ok: true, value: { format: "bmp", width, height } };
}

function inspectImageHeader(bytes: Uint8Array): ImageInspection {
  if (startsWith(bytes, [0xff, 0xd8])) return inspectJpeg(bytes);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return inspectPng(bytes);
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return inspectGif(bytes);
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return inspectWebp(bytes);
  if (startsWith(bytes, [0x42, 0x4d])) return inspectBmp(bytes);
  return { ok: false, reason: "unsupported-image-format" };
}

function contentTypeMatches(format: CoverAssetImageFormat, contentType: string) {
  const values: Record<CoverAssetImageFormat, readonly string[]> = {
    jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
    png: ["image/png", "image/x-png"],
    webp: ["image/webp"],
    gif: ["image/gif"],
    bmp: ["image/bmp", "image/x-bmp", "image/x-ms-bmp"],
  };
  return values[format].includes(contentType);
}

async function isFullyDecodableImage(bytes: Uint8Array, expected: ImageHeader) {
  if (expected.format === "bmp") {
    const fileSize = readUint32Le(bytes, 2);
    const pixelOffset = readUint32Le(bytes, 10);
    const planes = readUint16Le(bytes, 26);
    const bitsPerPixel = readUint16Le(bytes, 28);
    const compression = readUint32Le(bytes, 30);
    if (
      fileSize !== bytes.byteLength ||
      pixelOffset === null ||
      pixelOffset < 54 ||
      planes !== 1 ||
      (bitsPerPixel !== 24 && bitsPerPixel !== 32) ||
      compression !== 0
    ) return false;
    const rowBytes = Math.ceil((expected.width * bitsPerPixel) / 32) * 4;
    return pixelOffset + rowBytes * expected.height === bytes.byteLength;
  }

  try {
    const image = sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: MAX_COVER_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== expected.format ||
      metadata.width !== expected.width ||
      metadata.height !== expected.height
    ) return false;

    // metadata() alone may accept an intact header followed by truncated pixel
    // data. Force libvips to decode the complete source while keeping the
    // output allocation tiny.
    const decoded = await image
      .resize({
        width: MIN_COVER_DIMENSION,
        height: MIN_COVER_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return decoded.info.width > 0 && decoded.info.height > 0 && decoded.data.byteLength > 0;
  } catch {
    return false;
  }
}

async function validateOnce(
  startUrl: URL,
  options: Required<Pick<
    CoverAssetValidationOptions,
    "fetchImpl" | "timeoutMs" | "maxBytes" | "maxRedirects" | "allowImageTypeMismatch"
  >>,
): Promise<AttemptResult> {
  const sourceHost = startUrl.hostname.toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let currentUrl = startUrl;
  let redirects = 0;

  try {
    while (true) {
      const response = await options.fetchImpl(currentUrl, {
        method: "GET",
        headers: {
          Accept: "image/jpeg, image/png, image/webp, image/gif, image/bmp;q=0.8",
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "manual",
        signal: controller.signal,
      });

      if (redirectStatuses.has(response.status)) {
        await cancelBody(response);
        if (redirects >= options.maxRedirects) {
          return result(sourceHost, currentUrl.hostname, "too-many-redirects", {
            redirects,
            status: response.status,
          });
        }

        const location = response.headers.get("location")?.trim();
        if (!location) {
          return result(sourceHost, currentUrl.hostname, "redirect-location-missing", {
            redirects,
            status: response.status,
          });
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return result(sourceHost, currentUrl.hostname, "redirect-url-invalid", {
            redirects,
            status: response.status,
          });
        }

        if (nextUrl.protocol !== "https:") {
          return result(sourceHost, currentUrl.hostname, "redirect-https-required", {
            redirects,
            status: response.status,
          });
        }
        if (!isAllowedCoverAssetUrl(nextUrl)) {
          return result(sourceHost, currentUrl.hostname, "redirect-host-not-allowed", {
            redirects,
            status: response.status,
          });
        }

        redirects += 1;
        currentUrl = nextUrl;
        continue;
      }

      const finalHost = currentUrl.hostname.toLowerCase();
      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response);
        return result(sourceHost, finalHost, "http-status", {
          redirects,
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      if (response.status === 206) {
        const contentRange = response.headers.get("content-range")?.match(/^bytes\s+0-(\d+)\/(\d+)$/i);
        if (!contentRange || Number(contentRange[1]) + 1 !== Number(contentRange[2])) {
          await cancelBody(response);
          return result(sourceHost, finalHost, "invalid-image-data", {
            redirects,
            status: response.status,
          });
        }
      }

      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (!contentType?.startsWith("image/")) {
        await cancelBody(response);
        return result(sourceHost, finalHost, "not-image", {
          redirects,
          status: response.status,
          contentType,
        });
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        await cancelBody(response);
        return result(sourceHost, finalHost, "image-too-large", {
          redirects,
          status: response.status,
          contentType,
        });
      }

      const body = await readBoundedBody(response, options.maxBytes, controller.signal);
      if (body.exceeded) {
        return result(sourceHost, finalHost, "image-too-large", {
          redirects,
          status: response.status,
          contentType,
        });
      }
      const bytes = body.bytes;
      const bytesRead = bytes.byteLength;
      if (bytesRead === 0) {
        return result(sourceHost, finalHost, "empty-body", {
          redirects,
          status: response.status,
          contentType,
          retryable: true,
        });
      }

      const inspection = inspectImageHeader(bytes);
      if (!inspection.ok) {
        return result(sourceHost, finalHost, inspection.reason, {
          redirects,
          status: response.status,
          contentType,
          bytesRead,
        });
      }
      const { format, width, height } = inspection.value;
      const imageDetails = {
        imageFormat: format,
        width,
        height,
      };
      if (!contentTypeMatches(format, contentType) && !options.allowImageTypeMismatch) {
        return result(sourceHost, finalHost, "image-type-mismatch", {
          redirects,
          status: response.status,
          contentType,
          bytesRead,
          ...imageDetails,
        });
      }
      if (width < MIN_COVER_DIMENSION || height < MIN_COVER_DIMENSION) {
        return result(sourceHost, finalHost, "image-too-small", {
          redirects,
          status: response.status,
          contentType,
          bytesRead,
          ...imageDetails,
        });
      }
      if (
        width > MAX_COVER_DIMENSION ||
        height > MAX_COVER_DIMENSION ||
        width > Math.floor(MAX_COVER_PIXELS / height)
      ) {
        return result(sourceHost, finalHost, "image-dimensions-too-large", {
          redirects,
          status: response.status,
          contentType,
          bytesRead,
          ...imageDetails,
        });
      }
      if (!(await isFullyDecodableImage(bytes, inspection.value))) {
        return result(sourceHost, finalHost, "invalid-image-data", {
          redirects,
          status: response.status,
          contentType,
          bytesRead,
          ...imageDetails,
        });
      }

      return result(sourceHost, finalHost, "valid", {
        redirects,
        status: response.status,
        contentType,
        bytesRead,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        ...imageDetails,
      });
    }
  } catch {
    return result(
      sourceHost,
      currentUrl.hostname.toLowerCase(),
      controller.signal.aborted ? "timeout" : "network-error",
      {
        redirects,
        retryable: true,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateCoverAsset(
  value: string | URL,
  options: CoverAssetValidationOptions = {},
): Promise<CoverAssetValidationResult> {
  const url = parseUrl(value);
  if (!url) {
    return { ...result(null, null, "invalid-url"), attempts: 0 };
  }

  const sourceHost = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    return { ...result(sourceHost || null, null, "https-required"), attempts: 0 };
  }
  if (!isAllowedCoverAssetUrl(url)) {
    return { ...result(sourceHost || null, null, "host-not-allowed"), attempts: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 15_000);
  const retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 2);
  const retryDelayMs = clampInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 1_000);
  const maxBytes = clampInteger(
    options.maxBytes ?? options.probeBytes,
    DEFAULT_MAX_IMAGE_BYTES,
    64,
    MAX_IMAGE_BYTES,
  );
  const maxRedirects = clampInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 5);
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  let lastResult = result(sourceHost, sourceHost, "network-error", { retryable: true });
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    lastResult = await validateOnce(url, {
      fetchImpl,
      timeoutMs,
      maxBytes,
      maxRedirects,
      allowImageTypeMismatch: options.allowImageTypeMismatch === true,
    });
    if (lastResult.ok || !lastResult.retryable || attempt === retryCount) {
      return { ...lastResult, attempts: attempt + 1 };
    }

    try {
      await sleep(retryDelayMs * 2 ** attempt);
    } catch {
      return { ...lastResult, attempts: attempt + 1 };
    }
  }

  return { ...lastResult, attempts: retryCount + 1 };
}
