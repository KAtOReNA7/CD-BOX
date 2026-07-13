import type {
  MusicMetadataProvider,
  MusicMetadataWarning,
  MusicMetadataWarningCode,
} from "@/lib/music-metadata/types";

export type MusicMetadataFetchResponse = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type MusicMetadataFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<MusicMetadataFetchResponse>;

type Sleep = (milliseconds: number) => Promise<void>;

export type JsonTransportOptions = {
  source: MusicMetadataProvider;
  allowedOrigin: string;
  userAgent: string;
  fetchImpl?: MusicMetadataFetch;
  timeoutMs?: number;
  retryCount?: number;
  minimumIntervalMs?: number;
  cacheTtlMs?: number;
  cacheSize?: number;
  sleep?: Sleep;
  now?: () => number;
};

export type JsonTransportResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: number | null;
      warning: MusicMetadataWarning;
      notFound: boolean;
    };

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_CACHE_SIZE = 256;

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function safeClone<T>(value: T): T {
  return structuredClone(value);
}

function readJsonBeforeAbort(
  response: Pick<MusicMetadataFetchResponse, "json">,
  signal: AbortSignal,
) {
  const pending = response.json();
  if (signal.aborted) {
    return Promise.reject(new DOMException("JSON response timed out.", "AbortError"));
  }
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("JSON response timed out.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

class TimedLruCache {
  private readonly values = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maximumSize: number,
    private readonly now: () => number,
  ) {}

  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }

    this.values.delete(key);
    this.values.set(key, entry);
    return safeClone(entry.value);
  }

  set(key: string, value: unknown) {
    if (this.ttlMs <= 0 || this.maximumSize <= 0) return;
    this.values.delete(key);
    this.values.set(key, {
      expiresAt: this.now() + this.ttlMs,
      value: safeClone(value),
    });

    while (this.values.size > this.maximumSize) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.values.delete(oldestKey);
    }
  }
}

class RequestStartThrottle {
  private queue = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(
    private readonly minimumIntervalMs: number,
    private readonly sleep: Sleep,
    private readonly now: () => number,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    let releaseQueue!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previous;
    try {
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + this.minimumIntervalMs;
      return await work();
    } finally {
      releaseQueue();
    }
  }
}

function warning(
  source: MusicMetadataProvider,
  code: MusicMetadataWarningCode,
  message: string,
  retryable: boolean,
): MusicMetadataWarning {
  return { source, code, message, retryable };
}

function retryAfterMilliseconds(response: MusicMetadataFetchResponse, now: () => number) {
  const raw = response.headers?.get("retry-after")?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(5_000, Math.round(seconds * 1_000));
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(5_000, Math.max(0, timestamp - now()));
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function statusWarning(source: MusicMetadataProvider, status: number) {
  if (status === 429) {
    return warning(source, "rate-limited", `${source} temporarily rate limited the request.`, true);
  }
  return warning(
    source,
    "unavailable",
    `${source} returned HTTP ${status}; continuing without this public source.`,
    isRetryableStatus(status),
  );
}

export class JsonTransport {
  private readonly source: MusicMetadataProvider;
  private readonly allowedOrigin: string;
  private readonly userAgent: string;
  private readonly fetchImpl: MusicMetadataFetch;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly cache: TimedLruCache;
  private readonly throttle: RequestStartThrottle;

  constructor(options: JsonTransportOptions) {
    this.source = options.source;
    this.allowedOrigin = new URL(options.allowedOrigin).origin;
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl ?? (fetch as MusicMetadataFetch);
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000);
    this.retryCount = clampInteger(options.retryCount, 1, 0, 2);
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.cache = new TimedLruCache(
      clampInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 0, 24 * 60 * 60_000),
      clampInteger(options.cacheSize, DEFAULT_CACHE_SIZE, 0, 1_000),
      this.now,
    );
    this.throttle = new RequestStartThrottle(
      clampInteger(options.minimumIntervalMs, 1_100, 0, 5_000),
      this.sleep,
      this.now,
    );
  }

  async getJson(url: URL): Promise<JsonTransportResult> {
    if (url.origin !== this.allowedOrigin) {
      throw new TypeError(`Refusing an unexpected ${this.source} origin.`);
    }

    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return { ok: true, value: cached };

    let lastFailure: JsonTransportResult | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        const fetched = await this.throttle.run(() => this.fetchOnce(url));
        const response = fetched.response;
        if (response.ok) {
          if (fetched.jsonError) {
            return {
              ok: false,
              status: response.status,
              warning: warning(
                this.source,
                "invalid-response",
                `${this.source} returned malformed JSON; continuing without this public source.`,
                false,
              ),
              notFound: false,
            };
          }
          this.cache.set(cacheKey, fetched.value);
          return { ok: true, value: fetched.value };
        }

        if (response.status === 404) {
          return {
            ok: false,
            status: 404,
            warning: statusWarning(this.source, 404),
            notFound: true,
          };
        }

        lastFailure = {
          ok: false,
          status: response.status,
          warning: statusWarning(this.source, response.status),
          notFound: false,
        };
        if (!isRetryableStatus(response.status) || attempt >= this.retryCount) break;
        const delay = retryAfterMilliseconds(response, this.now) ?? 250 * 2 ** attempt;
        if (delay > 0) await this.sleep(delay);
      } catch {
        lastFailure = {
          ok: false,
          status: null,
          warning: warning(
            this.source,
            "unavailable",
            `${this.source} could not be reached; continuing without this public source.`,
            true,
          ),
          notFound: false,
        };
        if (attempt >= this.retryCount) break;
        await this.sleep(250 * 2 ** attempt);
      }
    }

    return lastFailure ?? {
      ok: false,
      status: null,
      warning: warning(
        this.source,
        "unavailable",
        `${this.source} is unavailable; continuing without this public source.`,
        true,
      ),
      notFound: false,
    };
  }

  private async fetchOnce(url: URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) return { response, value: null, jsonError: false };
      try {
        return {
          response,
          value: await readJsonBeforeAbort(response, controller.signal),
          jsonError: false,
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return { response, value: null, jsonError: true };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
