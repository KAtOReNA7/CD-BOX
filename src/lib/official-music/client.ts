import {
  OFFICIAL_MUSIC_MATCHED_FIELDS,
  type OfficialMusicCandidate,
  type OfficialMusicClientOptions,
  type OfficialMusicFetch,
  type OfficialMusicPageEvidence,
  type OfficialMusicResearchInput,
  type OfficialMusicResearchResult,
  type OfficialMusicWarning,
} from "@/lib/official-music/types";
import {
  canonicalOfficialPageUrl,
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
  validateOfficialMusicUrl,
} from "@/lib/official-music/url-policy";
import { parseOfficialMusicHtml } from "@/lib/official-music/html";
import {
  hasOfficialCatalogHint,
  hasOfficialPaginationHint,
  matchOfficialPage,
  normalizeOfficialCatalogNumber,
  validOfficialCandidate,
} from "@/lib/official-music/matching";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_MINIMUM_INTERVAL_MS = 1_000;
const DEFAULT_MAX_REDIRECTS = 5;
const HARD_MAX_PAGES = 30;
const HARD_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_LINKS = 500;
const MAX_ROOTS = 10;
const MAX_CANDIDATES = 200;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
}

function warning(
  code: OfficialMusicWarning["code"],
  message: string,
  retryable: boolean,
  extra: Omit<OfficialMusicWarning, "code" | "message" | "retryable"> = {},
): OfficialMusicWarning {
  return { code, message, retryable, ...extra };
}

function addWarning(values: OfficialMusicWarning[], value: OfficialMusicWarning) {
  if (!values.some((item) =>
    item.code === value.code &&
    item.url === value.url &&
    item.candidateId === value.candidateId &&
    item.message === value.message)) values.push(value);
}

function catalogBoundSingleItemPage(url: URL, candidate: OfficialMusicCandidate) {
  const catalogNumber = normalizeOfficialCatalogNumber(candidate.catalogNumber);
  if (!catalogNumber) return false;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).normalize("NFKC");
  } catch {
    pathname = url.pathname.normalize("NFKC");
  }
  const genericListingSegments = new Set([
    "artist",
    "artists",
    "categories",
    "category",
    "discography",
    "index",
    "list",
    "search",
  ]);
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim().toLocaleLowerCase("und"))
    .filter(Boolean);
  if (segments.some((segment) => genericListingSegments.has(segment))) return false;

  // The query string is deliberately excluded: a search/list URL containing a
  // catalog query is not proof that the response is a single-release page.
  return normalizeOfficialCatalogNumber(pathname).includes(catalogNumber);
}

type ScopedPageMatch = {
  evidenceScope: OfficialMusicPageEvidence["evidenceScope"];
  match: NonNullable<ReturnType<typeof matchOfficialPage>>;
};

function scopedPageMatch(
  candidate: OfficialMusicCandidate,
  url: URL,
  parsed: ReturnType<typeof parseOfficialMusicHtml>,
): ScopedPageMatch | "ambiguous" | null {
  const tiers: Array<{
    kind: "json-ld" | "page-metadata" | "product-block";
    evidenceScope: OfficialMusicPageEvidence["evidenceScope"];
  }> = [
    { kind: "json-ld", evidenceScope: "structured-entity" },
    { kind: "page-metadata", evidenceScope: "structured-entity" },
    { kind: "product-block", evidenceScope: "product-block" },
  ];

  for (const tier of tiers) {
    const matching = parsed.records
      .filter((record) => record.kind === tier.kind)
      .map((record) => matchOfficialPage(candidate, record.facts))
      .filter((match): match is NonNullable<typeof match> => match !== null);
    if (matching.length > 1) return "ambiguous";
    if (matching.length === 1) {
      return { evidenceScope: tier.evidenceScope, match: matching[0] };
    }
  }

  if (!catalogBoundSingleItemPage(url, candidate)) return null;
  const match = matchOfficialPage(candidate, parsed.facts);
  return match ? { evidenceScope: "single-item-page", match } : null;
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort bandwidth guard only.
  }
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response, now: () => number) {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.min(30_000, Math.max(0, Math.round(Number(raw) * 1_000)));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.min(30_000, Math.max(0, timestamp - now())) : null;
}

class OriginThrottle {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly nextAllowed = new Map<string, number>();

  constructor(
    private readonly minimumIntervalMs: number,
    private readonly sleep: (milliseconds: number) => Promise<void>,
    private readonly now: () => number,
  ) {}

  async run<T>(origin: string, work: () => Promise<T>) {
    const previous = this.queues.get(origin) ?? Promise.resolve();
    let release!: () => void;
    const queued = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(origin, queued);
    await previous;
    try {
      const delay = Math.max(0, (this.nextAllowed.get(origin) ?? 0) - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowed.set(origin, this.now() + this.minimumIntervalMs);
      return await work();
    } finally {
      release();
      if (this.queues.get(origin) === queued) this.queues.delete(origin);
    }
  }
}

type PageFailure = { ok: false; warning: OfficialMusicWarning; retryAfterMs?: number };
type PageSuccess = { ok: true; url: URL; html: string };
type PageResult = PageFailure | PageSuccess;

async function readLimitedBody(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length")?.trim();
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes) {
    await cancelBody(response);
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) return null;
      chunks.push(chunk.value);
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

function decodeHtml(bytes: Uint8Array, contentType: string) {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

export class OfficialMusicCatalogClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: NonNullable<OfficialMusicClientOptions["resolveHost"]>;
  private readonly sleep: NonNullable<OfficialMusicClientOptions["sleep"]>;
  private readonly now: NonNullable<OfficialMusicClientOptions["now"]>;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxPages: number;
  private readonly maxPageBytes: number;
  private readonly maxLinksPerPage: number;
  private readonly userAgent: string;
  private readonly throttle: OriginThrottle;

  constructor(options: OfficialMusicClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 25, 30_000);
    this.retryCount = clampInteger(options.retryCount, DEFAULT_RETRY_COUNT, 0, 3);
    this.retryDelayMs = clampInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 5_000);
    this.maxRedirects = clampInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 10);
    this.maxPages = clampInteger(options.maxPages, HARD_MAX_PAGES, 1, HARD_MAX_PAGES);
    this.maxPageBytes = clampInteger(options.maxPageBytes, HARD_MAX_PAGE_BYTES, 1, HARD_MAX_PAGE_BYTES);
    this.maxLinksPerPage = clampInteger(options.maxLinksPerPage, DEFAULT_MAX_LINKS, 1, 1_000);
    this.userAgent = options.userAgent?.trim() ||
      "CD-BOX/1.0 official-catalog-verifier (+https://github.com/KAtOReNA7/CD-BOX)";
    if (this.userAgent.length < 8 || this.userAgent.length > 500) {
      throw new TypeError("Official music crawler User-Agent must contain between 8 and 500 characters.");
    }
    this.throttle = new OriginThrottle(
      clampInteger(options.minimumIntervalMs, DEFAULT_MINIMUM_INTERVAL_MS, 250, 60_000),
      this.sleep,
      this.now,
    );
  }

  private async fetchOnce(startUrl: URL, rootOrigin: string): Promise<PageResult> {
    let current = new URL(startUrl);
    const seen = new Set<string>();
    let redirects = 0;

    while (true) {
      const currentKey = canonicalOfficialPageUrl(current);
      if (seen.has(currentKey)) {
        return {
          ok: false,
          warning: warning("redirect-loop", "The official site returned a redirect loop.", false, { url: currentKey }),
        };
      }
      seen.add(currentKey);

      const validated = validateOfficialMusicUrl(current);
      if (!validated.ok || validated.url.origin !== rootOrigin) {
        return {
          ok: false,
          warning: warning(
            validated.ok ? "cross-origin-redirect" : validated.code,
            validated.ok
              ? "The official site attempted to redirect to another origin."
              : "The official page URL failed the public HTTPS policy.",
            false,
            { url: currentKey },
          ),
        };
      }

      const resolved = await resolvePublicOfficialHost(validated.url.hostname, this.resolveHost);
      if (!resolved.ok) {
        return {
          ok: false,
          warning: warning(
            resolved.reason,
            resolved.reason === "non-public-address"
              ? "The official hostname resolved to a non-public address."
              : "The official hostname could not be resolved safely.",
            resolved.reason === "dns-resolution-failed",
            { url: currentKey },
          ),
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.throttle.run(validated.url.origin, () => this.fetchImpl(validated.url, {
          method: "GET",
          headers: {
            Accept: "text/html, application/xhtml+xml;q=0.9",
            "User-Agent": this.userAgent,
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }));
      } catch {
        clearTimeout(timeout);
        return {
          ok: false,
          warning: warning(
            controller.signal.aborted ? "network-timeout" : "network-unavailable",
            controller.signal.aborted
              ? "The official page request timed out."
              : "The official page could not be reached.",
            true,
            { url: currentKey },
          ),
        };
      }
      try {
        if (redirectStatuses.has(response.status)) {
          await cancelBody(response);
          if (redirects >= this.maxRedirects) {
            return {
              ok: false,
              warning: warning("redirect-limit", "The official site exceeded the redirect limit.", false, { url: currentKey }),
            };
          }
          const location = response.headers.get("location")?.trim();
          if (!location) {
            return {
              ok: false,
              warning: warning("invalid-redirect", "The official site returned a redirect without a location.", false, { url: currentKey }),
            };
          }
          let next: URL;
          try {
            next = new URL(location, validated.url);
          } catch {
            return {
              ok: false,
              warning: warning("invalid-redirect", "The official site returned an invalid redirect URL.", false, { url: currentKey }),
            };
          }
          const nextValidation = validateOfficialMusicUrl(next);
          if (!nextValidation.ok) {
            return {
              ok: false,
              warning: warning(nextValidation.code, "A redirect target failed the public HTTPS policy.", false, { url: next.toString().slice(0, 2_048) }),
            };
          }
          if (nextValidation.url.origin !== rootOrigin) {
            return {
              ok: false,
              warning: warning("cross-origin-redirect", "The official site attempted to redirect to another origin.", false, { url: nextValidation.url.toString() }),
            };
          }
          redirects += 1;
          current = nextValidation.url;
          continue;
        }

        if (!response.ok) {
          await cancelBody(response);
          return {
            ok: false,
            retryAfterMs: retryAfterMs(response, this.now) ?? undefined,
            warning: warning(
              response.status === 429 ? "rate-limited" : "http-status",
              response.status === 429
                ? "The official site temporarily rate limited the crawler."
                : `The official site returned HTTP ${response.status}.`,
              retryableStatus(response.status),
              { url: currentKey },
            ),
          };
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
          await cancelBody(response);
          return {
            ok: false,
            warning: warning("unsupported-content-type", "The official URL did not return an HTML page.", false, { url: currentKey }),
          };
        }
        const bytes = await readLimitedBody(response, this.maxPageBytes);
        if (!bytes) {
          return {
            ok: false,
            warning: warning("page-too-large", "The official HTML page exceeded the configured safety limit.", false, { url: currentKey }),
          };
        }
        return { ok: true, url: validated.url, html: decodeHtml(bytes, contentType) };
      } catch {
        return {
          ok: false,
          warning: warning(
            controller.signal.aborted ? "network-timeout" : "network-unavailable",
            controller.signal.aborted
              ? "The official page request timed out."
              : "The official page could not be read.",
            true,
            { url: currentKey },
          ),
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async fetchPage(startUrl: URL, rootOrigin: string): Promise<PageResult> {
    let last: PageFailure | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const result = await this.fetchOnce(startUrl, rootOrigin);
      if (result.ok || !result.warning.retryable || attempt === this.retryCount) return result;
      last = result;
      const delay = result.retryAfterMs ?? this.retryDelayMs * 2 ** attempt;
      if (delay > 0) await this.sleep(delay);
    }
    return last ?? {
      ok: false,
      warning: warning("network-unavailable", "The official page could not be reached.", true, { url: startUrl.toString() }),
    };
  }

  async research(input: OfficialMusicResearchInput): Promise<OfficialMusicResearchResult> {
    const warnings: OfficialMusicWarning[] = [];
    const candidateIds = new Map<string, number>();
    input.candidates.forEach((candidate) => {
      candidateIds.set(candidate.id, (candidateIds.get(candidate.id) ?? 0) + 1);
    });
    const limitedCandidates = input.candidates.slice(0, MAX_CANDIDATES);
    if (input.candidates.length > MAX_CANDIDATES) {
      addWarning(warnings, warning(
        "candidate-limit",
        "Candidates beyond the 200-item safety limit were not inspected.",
        false,
        { count: input.candidates.length - MAX_CANDIDATES },
      ));
    }

    const validCandidates: OfficialMusicCandidate[] = [];
    const invalidCandidateIds = new Set<string>();
    for (const candidate of limitedCandidates) {
      if ((candidateIds.get(candidate.id) ?? 0) > 1) {
        invalidCandidateIds.add(candidate.id);
        addWarning(warnings, warning(
          "duplicate-candidate-id",
          "Duplicate candidate identifiers cannot receive official evidence.",
          false,
          { candidateId: candidate.id },
        ));
      } else if (!validOfficialCandidate(candidate)) {
        invalidCandidateIds.add(candidate.id);
        addWarning(warnings, warning(
          "invalid-candidate",
          "Official verification requires a non-empty title, dated release, and normalized catalog number containing a digit.",
          false,
          { candidateId: candidate.id },
        ));
      } else {
        validCandidates.push(candidate);
      }
    }

    const roots: Array<{ url: URL; rootOrigin: string; catalogContext: boolean }> = [];
    const rootUrls = new Set<string>();
    for (const raw of input.officialUrls.slice(0, MAX_ROOTS)) {
      const validated = validateOfficialMusicUrl(raw);
      if (!validated.ok) {
        addWarning(warnings, warning(
          validated.code,
          "An official URL was rejected because it was not a public HTTPS domain URL.",
          false,
          { url: raw.slice(0, 2_048) },
        ));
        continue;
      }
      const key = canonicalOfficialPageUrl(validated.url);
      if (rootUrls.has(key)) continue;
      rootUrls.add(key);
      roots.push({
        url: validated.url,
        rootOrigin: validated.url.origin,
        catalogContext: hasOfficialCatalogHint(validated.url.pathname),
      });
    }
    if (input.officialUrls.length > MAX_ROOTS) {
      addWarning(warnings, warning(
        "invalid-official-url",
        "Official URLs beyond the ten-root safety limit were ignored.",
        false,
        { count: input.officialUrls.length - MAX_ROOTS },
      ));
    }

    const queue = [...roots];
    const discovered = new Set(queue.map((entry) => canonicalOfficialPageUrl(entry.url)));
    const matches = new Map<string, Map<string, OfficialMusicPageEvidence>>();
    const locallyAmbiguousCandidates = new Set<string>();
    let pagesAttempted = 0;
    let pagesFetched = 0;

    while (queue.length > 0 && pagesAttempted < this.maxPages) {
      const entry = queue.shift()!;
      pagesAttempted += 1;
      const fetched = await this.fetchPage(entry.url, entry.rootOrigin);
      if (!fetched.ok) {
        addWarning(warnings, fetched.warning);
        continue;
      }
      pagesFetched += 1;

      let parsed: ReturnType<typeof parseOfficialMusicHtml>;
      try {
        parsed = parseOfficialMusicHtml(fetched.html, this.maxLinksPerPage);
      } catch {
        addWarning(warnings, warning("invalid-html", "The official HTML page could not be parsed safely.", false, { url: fetched.url.toString() }));
        continue;
      }
      if (parsed.linksTruncated) {
        addWarning(warnings, warning("link-limit", "An official page exceeded the per-page link safety limit.", false, { url: fetched.url.toString() }));
      }

      const evidenceUrl = canonicalOfficialPageUrl(fetched.url);
      for (const candidate of validCandidates) {
        if (invalidCandidateIds.has(candidate.id)) continue;
        const scopedMatch = scopedPageMatch(candidate, fetched.url, parsed);
        if (scopedMatch === "ambiguous") {
          locallyAmbiguousCandidates.add(candidate.id);
          continue;
        }
        if (!scopedMatch) continue;
        const byUrl = matches.get(candidate.id) ?? new Map<string, OfficialMusicPageEvidence>();
        byUrl.set(evidenceUrl, {
          candidateId: candidate.id,
          sourceType: "official",
          url: evidenceUrl,
          pageTitle: parsed.pageTitle,
          evidenceScope: scopedMatch.evidenceScope,
          matchedFields: [...OFFICIAL_MUSIC_MATCHED_FIELDS],
          observedDate: scopedMatch.match.observed.normalized,
          datePrecision: scopedMatch.match.commonPrecision,
        });
        matches.set(candidate.id, byUrl);
      }

      const currentContext = entry.catalogContext || hasOfficialCatalogHint(fetched.url.pathname);
      for (const link of parsed.links) {
        let resolved: URL;
        try {
          resolved = new URL(link.href, fetched.url);
        } catch {
          continue;
        }
        const validated = validateOfficialMusicUrl(resolved);
        if (!validated.ok || validated.url.origin !== entry.rootOrigin) continue;
        const relevant = hasOfficialCatalogHint(
          `${validated.url.pathname}${validated.url.search} ${link.anchorText}`,
        );
        const pagination = currentContext &&
          (
            validated.url.pathname === fetched.url.pathname ||
            hasOfficialCatalogHint(validated.url.pathname)
          ) &&
          hasOfficialPaginationHint(validated.url, link.anchorText, link.rel);
        if (!relevant && !pagination) continue;
        const key = canonicalOfficialPageUrl(validated.url);
        if (discovered.has(key)) continue;
        discovered.add(key);
        queue.push({
          url: validated.url,
          rootOrigin: entry.rootOrigin,
          catalogContext: relevant || currentContext,
        });
      }
    }

    if (queue.length > 0) {
      addWarning(warnings, warning(
        "page-limit",
        `The official-site crawl stopped at the ${this.maxPages}-page safety limit.`,
        false,
        { count: queue.length },
      ));
    }

    let ambiguousCandidates = 0;
    const candidates = input.candidates.map((candidate, index) => {
      if (index >= MAX_CANDIDATES || invalidCandidateIds.has(candidate.id)) {
        return { candidateId: candidate.id, evidence: null };
      }
      const evidence = [...(matches.get(candidate.id)?.values() ?? [])];
      const locallyAmbiguous = locallyAmbiguousCandidates.has(candidate.id);
      if (locallyAmbiguous || evidence.length !== 1) {
        if (locallyAmbiguous || evidence.length > 1) {
          ambiguousCandidates += 1;
          addWarning(warnings, warning(
            "ambiguous-official-match",
            locallyAmbiguous
              ? "More than one structured record on an official page matched the same release candidate; no evidence was selected."
              : "More than one official page matched the same release candidate; no page was selected.",
            false,
            { candidateId: candidate.id, count: Math.max(2, evidence.length) },
          ));
        }
        return { candidateId: candidate.id, evidence: null };
      }
      return { candidateId: candidate.id, evidence: evidence[0] };
    });

    return {
      candidates,
      warnings,
      stats: {
        rootsAccepted: roots.length,
        pagesAttempted,
        pagesFetched,
        pagesDiscovered: discovered.size,
        candidatesInspected: validCandidates.length,
        candidatesMatched: candidates.filter((candidate) => candidate.evidence !== null).length,
        ambiguousCandidates,
      },
    };
  }
}

export const officialMusicCatalogClient = new OfficialMusicCatalogClient();

export async function researchOfficialMusicCatalog(
  input: OfficialMusicResearchInput,
  options?: OfficialMusicClientOptions,
) {
  return options
    ? new OfficialMusicCatalogClient(options).research(input)
    : officialMusicCatalogClient.research(input);
}
