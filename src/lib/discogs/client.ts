import {
  DEFAULT_DISCOGS_USER_AGENT,
  DISCOGS_API_ORIGIN,
  discogsReleaseApiUrl,
} from "@/lib/discogs/constants";
import { parseJapanCdSearchPayload, parseReleasePayload } from "@/lib/discogs/parsers";
import {
  DISCOGS_EVIDENCE_ROLE,
  type DiscogsClientOptions,
  type DiscogsFetch,
  type DiscogsFetchResponse,
  type DiscogsJapanCdSearchOptions,
  type DiscogsJapanCdSearchResult,
  type DiscogsRateLimit,
  type DiscogsReleaseEvidence,
  type DiscogsResult,
  type DiscogsWarning,
} from "@/lib/discogs/types";

type Sleep = (milliseconds: number) => Promise<void>;

type TransportSuccess = {
  ok: true;
  value: unknown;
  rateLimit: DiscogsRateLimit | null;
};

type TransportFailure = {
  ok: false;
  status: number | null;
  notFound: boolean;
  warning: DiscogsWarning;
  rateLimit: DiscogsRateLimit | null;
};

type TransportResult = TransportSuccess | TransportFailure;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 2;
// Discogs currently advertises 25 anonymous calls per minute. Starting no more
// than one request every 2.5 seconds leaves a small safety margin.
const DEFAULT_MINIMUM_INTERVAL_MS = 2_500;
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_ITEMS = 500;

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function warning(
  code: DiscogsWarning["code"],
  message: string,
  retryable: boolean,
): DiscogsWarning {
  return { code, message, retryable };
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 ||
    status === 500 || status === 502 || status === 503 || status === 504;
}

function headerInteger(response: DiscogsFetchResponse, name: string) {
  const raw = response.headers?.get(name)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function rateLimitFrom(response: DiscogsFetchResponse): DiscogsRateLimit | null {
  const value = {
    limit: headerInteger(response, "x-discogs-ratelimit"),
    used: headerInteger(response, "x-discogs-ratelimit-used"),
    remaining: headerInteger(response, "x-discogs-ratelimit-remaining"),
  };
  return value.limit === null && value.used === null && value.remaining === null ? null : value;
}

function retryAfterMilliseconds(response: DiscogsFetchResponse, now: () => number) {
  const raw = response.headers?.get("retry-after")?.trim();
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds)
      ? Math.min(60_000, Math.max(0, Math.round(seconds * 1_000)))
      : null;
  }

  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.min(60_000, Math.max(0, timestamp - now()))
    : null;
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

class DiscogsTransport {
  private readonly fetchImpl: DiscogsFetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly throttle: RequestStartThrottle;

  constructor(options: DiscogsClientOptions) {
    const userAgent = options.userAgent?.trim() || DEFAULT_DISCOGS_USER_AGENT;
    if (userAgent.length < 8 || userAgent.length > 500) {
      throw new TypeError("Discogs User-Agent must contain between 8 and 500 characters.");
    }
    this.userAgent = userAgent;
    this.fetchImpl = options.fetchImpl ?? (fetch as DiscogsFetch);
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 25, 30_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 3);
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.throttle = new RequestStartThrottle(
      clampInteger(
        options.minimumIntervalMs,
        DEFAULT_MINIMUM_INTERVAL_MS,
        0,
        60_000,
      ),
      this.sleep,
      this.now,
    );
  }

  async getJson(url: URL): Promise<TransportResult> {
    if (
      url.origin !== DISCOGS_API_ORIGIN ||
      url.username ||
      url.password ||
      url.protocol !== "https:"
    ) throw new TypeError("Refusing an unexpected Discogs API origin.");

    let lastFailure: TransportFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      try {
        const fetched = await this.throttle.run(() => this.fetchOnce(url));
        const response = fetched.response;
        const rateLimit = rateLimitFrom(response);
        if (response.ok) {
          if (fetched.jsonError) {
            return {
              ok: false,
              status: response.status,
              notFound: false,
              warning: warning(
                "invalid-response",
                "Discogs returned malformed JSON; its evidence was not used.",
                false,
              ),
              rateLimit,
            };
          }
          return { ok: true, value: fetched.value, rateLimit };
        }

        if (response.status === 404) {
          return {
            ok: false,
            status: 404,
            notFound: true,
            warning: warning("unavailable", "Discogs release was not found.", false),
            rateLimit,
          };
        }

        lastFailure = {
          ok: false,
          status: response.status,
          notFound: false,
          warning: response.status === 429
            ? warning("rate-limited", "Discogs temporarily rate limited the request.", true)
            : warning(
                "unavailable",
                `Discogs returned HTTP ${response.status}; its evidence was not used.`,
                isRetryableStatus(response.status),
              ),
          rateLimit,
        };
        if (!isRetryableStatus(response.status) || attempt >= this.retryCount) break;
        const delay = retryAfterMilliseconds(response, this.now) ?? 300 * 2 ** attempt;
        if (delay > 0) await this.sleep(delay);
      } catch {
        lastFailure = {
          ok: false,
          status: null,
          notFound: false,
          warning: warning(
            "unavailable",
            "Discogs could not be reached; its evidence was not used.",
            true,
          ),
          rateLimit: null,
        };
        if (attempt >= this.retryCount) break;
        await this.sleep(300 * 2 ** attempt);
      }
    }

    return lastFailure ?? {
      ok: false,
      status: null,
      notFound: false,
      warning: warning("unavailable", "Discogs is unavailable.", true),
      rateLimit: null,
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
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return { response, value: null, jsonError: false };
      try {
        return { response, value: await response.json(), jsonError: false };
      } catch {
        return { response, value: null, jsonError: true };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

function latestRateLimit(
  current: DiscogsRateLimit | null,
  candidate: DiscogsRateLimit | null,
) {
  return candidate ?? current;
}

function uniqueWarnings(values: DiscogsWarning[]) {
  return values.filter((item, index) => values.findIndex((candidate) =>
    candidate.code === item.code && candidate.message === item.message) === index);
}

export class DiscogsClient {
  private readonly transport: DiscogsTransport;

  constructor(options: DiscogsClientOptions = {}) {
    this.transport = new DiscogsTransport(options);
  }

  async searchJapanCdReleases(
    artist: string,
    options: DiscogsJapanCdSearchOptions = {},
  ): Promise<DiscogsResult<DiscogsJapanCdSearchResult>> {
    const artistQuery = artist.normalize("NFKC").trim();
    if (!artistQuery || artistQuery.length > 300) {
      throw new TypeError("Discogs artist query must contain between 1 and 300 characters.");
    }

    const perPage = clampInteger(options.perPage, DEFAULT_PER_PAGE, 1, 100);
    const maxPages = clampInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, 10);
    const maxItems = clampInteger(options.maxItems, DEFAULT_MAX_ITEMS, 1, 1_000);
    const items = new Map<number, DiscogsJapanCdSearchResult["items"][number]>();
    const warnings: DiscogsWarning[] = [];
    let pagesFetched = 0;
    let sourceTotal = 0;
    let advertisedPages = 1;
    let rateLimit: DiscogsRateLimit | null = null;
    let stoppedByFailure = false;

    for (let page = 1; page <= advertisedPages && page <= maxPages && items.size < maxItems; page += 1) {
      const url = new URL("/database/search", DISCOGS_API_ORIGIN);
      url.searchParams.set("artist", artistQuery);
      url.searchParams.set("type", "release");
      url.searchParams.set("country", "Japan");
      url.searchParams.set("format", "CD");
      // A deterministic order prevents duplicate/missing rows while crossing
      // page boundaries in Discogs' relevance-ranked default order.
      url.searchParams.set("sort", "title");
      url.searchParams.set("sort_order", "asc");
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));

      const response = await this.transport.getJson(url);
      rateLimit = latestRateLimit(rateLimit, response.rateLimit);
      if (!response.ok) {
        warnings.push(response.warning);
        stoppedByFailure = true;
        break;
      }

      const parsed = parseJapanCdSearchPayload(response.value, page, perPage);
      if (!parsed.value) {
        warnings.push(warning(
          "invalid-response",
          "Discogs returned an invalid search page; that page was not used.",
          false,
        ));
        stoppedByFailure = true;
        break;
      }
      pagesFetched += 1;
      if (parsed.invalid) warnings.push(warning(
        "invalid-response",
        "Discogs returned one or more invalid search rows; those values were not trusted.",
        false,
      ));

      if (page === 1) {
        sourceTotal = parsed.value.page.total;
        advertisedPages = parsed.value.page.pages;
      } else if (
        parsed.value.page.total !== sourceTotal ||
        parsed.value.page.pages !== advertisedPages
      ) {
        warnings.push(warning(
          "partial-results",
          "Discogs pagination changed during the search; results may be incomplete.",
          true,
        ));
      }

      for (const item of parsed.value.items) {
        if (items.size >= maxItems) break;
        items.set(item.releaseId, item);
      }
    }

    const partial = stoppedByFailure || advertisedPages > pagesFetched || sourceTotal > items.size;
    if (partial) warnings.push(warning(
      "partial-results",
      "Discogs has more matching releases than were safely retrieved; never treat this set as complete.",
      true,
    ));

    return {
      value: {
        evidenceRole: DISCOGS_EVIDENCE_ROLE,
        artistQuery,
        items: [...items.values()],
        sourceTotal,
        pagesFetched,
        partial,
      },
      warnings: uniqueWarnings(warnings),
      rateLimit,
    };
  }

  async getRelease(releaseId: number): Promise<DiscogsResult<DiscogsReleaseEvidence | null>> {
    const normalizedReleaseId = positiveReleaseId(releaseId);
    const response = await this.transport.getJson(new URL(discogsReleaseApiUrl(normalizedReleaseId)));
    if (!response.ok) {
      return {
        value: null,
        warnings: response.notFound ? [] : [response.warning],
        rateLimit: response.rateLimit,
      };
    }

    const parsed = parseReleasePayload(response.value, normalizedReleaseId);
    return {
      value: parsed.value,
      warnings: parsed.invalid
        ? [warning(
            "invalid-response",
            parsed.value
              ? "Discogs returned invalid nested release values; those values were discarded."
              : "Discogs returned an invalid release record; it was not used.",
            false,
          )]
        : [],
      rateLimit: response.rateLimit,
    };
  }
}

function positiveReleaseId(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Discogs release ID must be a positive safe integer.");
  }
  return value;
}

export const discogsClient = new DiscogsClient();
