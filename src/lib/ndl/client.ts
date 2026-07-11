import { NDL_SEARCH_API_URL, NDL_SEARCH_ORIGIN } from "@/lib/ndl/constants";
import { canonicalNdlCatalogNumber } from "@/lib/ndl/matching";
import { NdlXmlError, parseNdlOpenSearchXml } from "@/lib/ndl/parser";
import type {
  NdlClientOptions,
  NdlClientResult,
  NdlFetch,
  NdlSearchResponse,
  NdlWarning,
} from "@/lib/ndl/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 400;
const DEFAULT_MINIMUM_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_CACHE_SIZE = 64;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const HARD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 500;

type CacheEntry = {
  expiresAt: number;
  value: NdlSearchResponse;
};

type SharedTransportState = {
  queue: Promise<void>;
  nextAllowedAt: number;
  cache: Map<string, CacheEntry>;
};

const sharedStates = new WeakMap<NdlFetch, SharedTransportState>();

function sharedState(fetchImpl: NdlFetch) {
  const existing = sharedStates.get(fetchImpl);
  if (existing) return existing;
  const created: SharedTransportState = {
    queue: Promise.resolve(),
    nextAllowedAt: 0,
    cache: new Map(),
  };
  sharedStates.set(fetchImpl, created);
  return created;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function warning(
  code: NdlWarning["code"],
  message: string,
  retryable: boolean,
  status: number | null = null,
): NdlWarning {
  return { code, message, retryable, status };
}

function validQueryText(value: string, maximumLength: number) {
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null;
  return normalized;
}

export function buildNdlInventoryUrl(artist: string, count = MAX_RECORDS) {
  const query = validQueryText(artist, 200);
  if (!query) throw new TypeError("NDL inventory search requires a safe artist name.");
  const url = new URL(NDL_SEARCH_API_URL);
  url.searchParams.set("any", query);
  url.searchParams.set("mediatype", "audio");
  url.searchParams.set("dpid", "iss-ndl-opac");
  url.searchParams.set("cnt", String(clampInteger(count, MAX_RECORDS, 1, MAX_RECORDS)));
  return url;
}

export function buildNdlCatalogUrl(catalogNumber: string, count = 20) {
  const catalog = canonicalNdlCatalogNumber(catalogNumber);
  if (!catalog) throw new TypeError("NDL catalog search requires a normalized alphanumeric catalog number.");
  const url = new URL(NDL_SEARCH_API_URL);
  url.searchParams.set("any", catalog);
  url.searchParams.set("mediatype", "audio");
  url.searchParams.set("dpid", "iss-ndl-opac");
  url.searchParams.set("cnt", String(clampInteger(count, 20, 1, MAX_RECORDS)));
  return url;
}

function cloneResponse(value: NdlSearchResponse): NdlSearchResponse {
  return structuredClone(value);
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort bandwidth guard.
  }
}

async function readLimitedBody(response: Response, maximumBytes: number) {
  const length = response.headers.get("content-length")?.trim();
  if (length && /^\d+$/.test(length) && Number(length) > maximumBytes) {
    await cancelBody(response);
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) return null;
      chunks.push(result.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream may already be closed.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response, now: () => number) {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.min(10_000, Math.max(0, Math.round(Number(raw) * 1_000)));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.min(10_000, Math.max(0, timestamp - now())) : null;
}

type FetchFailure = {
  ok: false;
  warning: NdlWarning;
  retryAfterMs?: number;
};

type FetchSuccess = {
  ok: true;
  value: NdlSearchResponse;
};

type FetchResult = FetchFailure | FetchSuccess;

export class NdlSearchClient {
  private readonly fetchImpl: NdlFetch;
  private readonly sleep: NonNullable<NdlClientOptions["sleep"]>;
  private readonly now: NonNullable<NdlClientOptions["now"]>;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;
  private readonly minimumIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly cacheSize: number;
  private readonly maxResponseBytes: number;
  private readonly userAgent: string;
  private readonly state: SharedTransportState;

  constructor(options: NdlClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, 30_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, DEFAULT_RETRY_COUNT);
    this.retryDelayMs = clampInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 5_000);
    this.minimumIntervalMs = clampInteger(
      options.minimumIntervalMs,
      DEFAULT_MINIMUM_INTERVAL_MS,
      0,
      60_000,
    );
    this.cacheTtlMs = clampInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 0, DEFAULT_CACHE_TTL_MS);
    this.cacheSize = clampInteger(options.cacheSize, DEFAULT_CACHE_SIZE, 0, 500);
    this.maxResponseBytes = clampInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1,
      HARD_MAX_RESPONSE_BYTES,
    );
    this.userAgent = options.userAgent?.trim() ||
      "CD-BOX/1.0 NDL-national-bibliography-verifier (+https://github.com/KAtOReNA7/CD-BOX)";
    if (this.userAgent.length < 8 || this.userAgent.length > 500) {
      throw new TypeError("The NDL User-Agent must contain between 8 and 500 characters.");
    }
    this.state = sharedState(this.fetchImpl);
  }

  async searchArtistInventory(artist: string, count = MAX_RECORDS): Promise<NdlClientResult> {
    try {
      return await this.search(buildNdlInventoryUrl(artist, count));
    } catch {
      return {
        value: null,
        warnings: [warning("invalid-query", "The NDL artist inventory query was invalid.", false)],
      };
    }
  }

  async searchCatalogNumber(catalogNumber: string, count = 20): Promise<NdlClientResult> {
    try {
      return await this.search(buildNdlCatalogUrl(catalogNumber, count));
    } catch {
      return {
        value: null,
        warnings: [warning("invalid-query", "The NDL catalog-number query was invalid.", false)],
      };
    }
  }

  private cacheGet(key: string) {
    const entry = this.state.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.state.cache.delete(key);
      return null;
    }
    this.state.cache.delete(key);
    this.state.cache.set(key, entry);
    return cloneResponse(entry.value);
  }

  private cacheSet(key: string, value: NdlSearchResponse) {
    if (this.cacheTtlMs <= 0 || this.cacheSize <= 0) return;
    this.state.cache.delete(key);
    this.state.cache.set(key, {
      expiresAt: this.now() + this.cacheTtlMs,
      value: cloneResponse(value),
    });
    while (this.state.cache.size > this.cacheSize) {
      const oldest = this.state.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.state.cache.delete(oldest);
    }
  }

  private async serialRequest<T>(work: () => Promise<T>) {
    const previous = this.state.queue;
    let release!: () => void;
    const queued = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.state.queue = queued;
    await previous;
    try {
      const delay = Math.max(0, this.state.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.state.nextAllowedAt = this.now() + this.minimumIntervalMs;
      return await work();
    } finally {
      release();
    }
  }

  private async fetchOnce(url: URL): Promise<FetchResult> {
    if (
      url.origin !== NDL_SEARCH_ORIGIN ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/api/opensearch"
    ) {
      throw new TypeError("Refusing an unexpected NDL Search origin or path.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.serialRequest(() => this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/xml, text/xml;q=0.9, application/rss+xml;q=0.8",
          "User-Agent": this.userAgent,
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      }));
    } catch {
      clearTimeout(timer);
      return {
        ok: false,
        warning: warning(
          controller.signal.aborted ? "network-timeout" : "network-unavailable",
          controller.signal.aborted
            ? "The NDL Search request timed out."
            : "The NDL Search request could not be completed.",
          true,
        ),
      };
    }
    try {
      if (!response.ok) {
      await cancelBody(response);
      return {
        ok: false,
        retryAfterMs: retryAfterMs(response, this.now) ?? undefined,
        warning: warning(
          response.status === 429 ? "rate-limited" : "http-status",
          response.status === 429
            ? "NDL Search temporarily rate limited the request."
            : `NDL Search returned HTTP ${response.status}.`,
          retryableStatus(response.status),
          response.status,
        ),
      };
    }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!/^(?:text|application)\/(?:xml|rss\+xml)(?:\s*;|$)/.test(contentType)) {
      await cancelBody(response);
      return {
        ok: false,
        warning: warning(
          "unsupported-content-type",
          "NDL Search returned a non-XML response.",
          false,
          response.status,
        ),
      };
    }
      const bytes = await readLimitedBody(response, this.maxResponseBytes);
    if (!bytes) {
      return {
        ok: false,
        warning: warning(
          "response-too-large",
          "The NDL Search XML response exceeded the configured size limit.",
          false,
          response.status,
        ),
      };
    }
      try {
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { ok: true, value: parseNdlOpenSearchXml(xml, url.toString()) };
      } catch (error) {
        return {
          ok: false,
          warning: warning(
            "invalid-xml",
            error instanceof NdlXmlError
              ? error.message
              : "NDL Search returned malformed UTF-8 XML.",
            false,
            response.status,
          ),
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async search(url: URL): Promise<NdlClientResult> {
    const cached = this.cacheGet(url.toString());
    if (cached) return { value: cached, warnings: [] };
    let lastFailure: FetchFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const result = await this.fetchOnce(url);
      if (result.ok) {
        this.cacheSet(url.toString(), result.value);
        const warnings = result.value.complete
          ? []
          : [warning(
              "partial-results",
              "NDL Search reported more records than the safely retrieved result set.",
              false,
              200,
            )];
        return { value: result.value, warnings };
      }
      lastFailure = result;
      if (!result.warning.retryable || attempt === this.retryCount) break;
      const delay = result.retryAfterMs ?? this.retryDelayMs * 2 ** attempt;
      if (delay > 0) await this.sleep(delay);
    }
    return {
      value: null,
      warnings: [lastFailure?.warning ?? warning(
        "network-unavailable",
        "NDL Search could not be reached.",
        true,
      )],
    };
  }
}
