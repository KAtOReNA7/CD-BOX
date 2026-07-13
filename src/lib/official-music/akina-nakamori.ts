import "server-only";

import { parseOfficialMusicHtml } from "@/lib/official-music/html";
import type {
  OfficialMusicFetch,
  OfficialMusicHostResolver,
} from "@/lib/official-music/types";
import {
  defaultOfficialMusicHostResolver,
  resolvePublicOfficialHost,
} from "@/lib/official-music/url-policy";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COUNT = 1;
const HARD_MAX_PAGE_BYTES = 512 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS = {
  "SINGLE:50": {
    provider: "universal-music-japan",
    sourceUrl: "https://www.universal-music.co.jp/nakamori-akina/products/umck-5257/",
    canonicalTitle: "DIVA",
    observedTitle: "DIVA Single Version",
    releaseDate: "2009-09-23",
    catalogNumber: "UMCK-5257",
    formatMarker: "CD MAXI",
    requiredWorkMarkers: ["DIVA Single Version", "Heartache", "I hope so"],
    auditedAsset: {
      mime: "image/png",
      width: 500,
      height: 500,
      sha256: "5d62fc3cf6ccf96048ed4f85c309158d487f84dbb4d34134a65150516bf0fcc5",
      allowContentTypeMismatch: true,
    },
  },
  "SINGLE:54": {
    provider: "universal-music-japan",
    sourceUrl: "https://www.universal-music.co.jp/nakamori-akina/products/upch-5870/",
    canonicalTitle: "ひらり -SAKURA-／FIXER -WHILE THE WOMEN ARE SLEEPING-",
    observedTitle: "FIXER -WHILE THE WOMEN ARE SLEEPING-",
    releaseDate: "2016-02-24",
    catalogNumber: "UPCH-5870",
    formatMarker: "CD MAXI",
    requiredWorkMarkers: [
      "ひらり -SAKURA-",
      "FIXER -WHILE THE WOMEN ARE SLEEPING-",
      "Single Version",
    ],
    auditedAsset: {
      mime: "image/png",
      width: 500,
      height: 500,
      sha256: "59827f4c173bb77680d29aa18e6bca1d35b332ac2b7c2620830f0be78a4c0f6a",
      allowContentTypeMismatch: true,
    },
  },
  "SINGLE:55": {
    provider: "warner-music-japan",
    sourceUrl: "https://wmg.jp/akina/discography/33083/",
    canonicalTitle: "ごめんと、すきと、",
    observedTitle: "ごめんと、すきと、【通常盤CD】",
    releaseDate: "2026-07-01",
    catalogNumber: "WPCL-13771",
    formatMarker: "SINGLE CD",
    requiredWorkMarkers: ["ごめんと、すきと、", "カサブランカ", "FAKE"],
    auditedAsset: {
      mime: "image/jpeg",
      width: 640,
      height: 640,
      sha256: "a9e8fb2f7d7d613925985b0631543a5031fd5e5026212893d65d03ca266abac5",
      allowContentTypeMismatch: false,
    },
  },
  "ORIGINAL_ALBUM:15": {
    provider: "universal-music-japan",
    sourceUrl: "https://www.universal-music.co.jp/nakamori-akina/products/upch-7267/",
    canonicalTitle: "UNBALANCE+BALANCE",
    observedTitle: "UNBALANCE+BALANCE+6 [UHQCD]",
    releaseDate: "2017-05-03",
    catalogNumber: "UPCH-7267",
    formatMarker: "CD",
    requiredWorkMarkers: ["永遠の扉", "愛撫", "陽炎"],
    auditedAsset: {
      mime: "image/png",
      width: 500,
      height: 500,
      sha256: "0202dbe8d0ff13a5ccbfc1ced575c7827d214d99b6a20e9017ac339672b6a11e",
      allowContentTypeMismatch: true,
    },
  },
} as const;

export type AkinaNakamoriOfficialRecoveryKey =
  keyof typeof AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS;

export type AkinaNakamoriOfficialProvider =
  typeof AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[AkinaNakamoriOfficialRecoveryKey]["provider"];

export type AkinaNakamoriOfficialCoverEvidence = {
  provider: AkinaNakamoriOfficialProvider;
  scope: "WORK";
  matchLevel: "WORK_EXACT";
  url: string;
  sourceUrl: string;
  observedAlt: string;
  requiresAssetValidation: true;
  auditedAsset: {
    mime: "image/jpeg" | "image/png";
    width: number;
    height: number;
    sha256: string;
    allowContentTypeMismatch: boolean;
  };
};

export type AkinaNakamoriOfficialCarrierEvidence = {
  provider: AkinaNakamoriOfficialProvider;
  role: "CORROBORATING";
  strength: "STRONG";
  scope: "EDITION";
  matchLevel: "EDITION_EXACT";
  manifestEntryKey: "SINGLE:50" | "SINGLE:54" | "SINGLE:55";
  artist: "中森明菜";
  canonicalTitle: string;
  observedTitle: string;
  category: "SINGLE";
  country: "JP";
  format: "CD";
  releaseDate: string;
  catalogNumber: string;
  sourceUrl: string;
  cover: AkinaNakamoriOfficialCoverEvidence;
};

export type AkinaNakamoriOfficialWorkCoverEvidence = {
  manifestEntryKey: "ORIGINAL_ALBUM:15";
  artist: "中森明菜";
  canonicalTitle: "UNBALANCE+BALANCE";
  observedEditionTitle: "UNBALANCE+BALANCE+6 [UHQCD]";
  observedEditionDate: "2017-05-03";
  observedEditionCatalogNumber: "UPCH-7267";
  sourceUrl: "https://www.universal-music.co.jp/nakamori-akina/products/upch-7267/";
  cover: AkinaNakamoriOfficialCoverEvidence;
};

export type AkinaNakamoriOfficialWarningCode =
  | "dns-resolution-failed"
  | "non-public-address"
  | "network-timeout"
  | "network-unavailable"
  | "http-status"
  | "unexpected-redirect"
  | "unsupported-content-type"
  | "response-too-large"
  | "invalid-official-html";

export type AkinaNakamoriOfficialWarning = {
  key: AkinaNakamoriOfficialRecoveryKey;
  code: AkinaNakamoriOfficialWarningCode;
  retryable: boolean;
};

export type AkinaNakamoriOfficialRecoveryResult = {
  carriers: Partial<Record<
    "SINGLE:50" | "SINGLE:54" | "SINGLE:55",
    AkinaNakamoriOfficialCarrierEvidence
  >>;
  workCovers: Partial<Record<"ORIGINAL_ALBUM:15", AkinaNakamoriOfficialWorkCoverEvidence>>;
  warnings: AkinaNakamoriOfficialWarning[];
  stats: {
    requestsAttempted: number;
    responsesFetched: number;
    retries: number;
    entitiesMatched: number;
  };
};

export type AkinaNakamoriOfficialClientOptions = {
  fetchImpl?: OfficialMusicFetch;
  resolveHost?: OfficialMusicHostResolver;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  retryCount?: number;
};

function normalizedText(value: string) {
  return value.normalize("NFKC").replace(/[‐‑‒–—―−ー－]/gu, "-")
    .replace(/\s+/gu, " ").trim();
}

function normalizedCatalog(value: string) {
  return normalizedText(value).toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

function attribute(tag: string, name: string) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "iu",
  );
  const match = tag.match(pattern);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function ogImage(html: string) {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const name = attribute(tag, "property") || attribute(tag, "name");
    if (name.toLocaleLowerCase("en") !== "og:image") continue;
    const content = attribute(tag, "content");
    if (content) return content;
  }
  return null;
}

function exactCoverUrl(
  key: AkinaNakamoriOfficialRecoveryKey,
  value: string | null,
) {
  if (!value || value.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    return null;
  }
  if (key === "SINGLE:55") {
    return url.hostname === "wmg.jp" && !url.search &&
      url.pathname === "/packages/33269/images/tujyoban_jacket.jpg"
      ? url.toString()
      : null;
  }
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  const catalogKey = spec.catalogNumber.toLocaleLowerCase("en");
  const path = url.pathname.toLocaleLowerCase("en");
  return url.hostname === "content-jp.umgi.net" &&
      path.startsWith(`/products/${catalogKey.slice(0, 2)}/${catalogKey}_`) &&
      /_extralarge\.(?:jpe?g|png)$/iu.test(path) &&
      (!url.search || /^\?\d{8,20}$/u.test(url.search))
    ? url.toString()
    : null;
}

function parsedPageText(html: string) {
  const parsed = parseOfficialMusicHtml(html, 0);
  return normalizedText([
    parsed.pageTitle ?? "",
    ...parsed.facts,
    ...parsed.records.flatMap((record) => record.facts),
  ].join("\n"));
}

function containsExactMarker(haystack: string, marker: string) {
  return haystack.includes(normalizedText(marker));
}

function exactPageEvidence(
  key: AkinaNakamoriOfficialRecoveryKey,
  html: string,
) {
  const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
  const text = parsedPageText(html);
  const coverUrl = exactCoverUrl(key, ogImage(html));
  const dateMarkers = [spec.releaseDate, spec.releaseDate.replaceAll("-", ".")];
  const exact = text.length > 0 && text.length <= 1_000_000 &&
    containsExactMarker(text, "中森明菜") &&
    containsExactMarker(text, spec.observedTitle) &&
    dateMarkers.some((date) => containsExactMarker(text, date)) &&
    normalizedCatalog(text).includes(normalizedCatalog(spec.catalogNumber)) &&
    containsExactMarker(text, spec.formatMarker) &&
    spec.requiredWorkMarkers.every((marker) => containsExactMarker(text, marker)) &&
    Boolean(coverUrl);
  if (!exact || !coverUrl) return null;
  const cover: AkinaNakamoriOfficialCoverEvidence = {
    provider: spec.provider,
    scope: "WORK",
    matchLevel: "WORK_EXACT",
    url: coverUrl,
    sourceUrl: spec.sourceUrl,
    observedAlt: spec.observedTitle,
    requiresAssetValidation: true,
    auditedAsset: { ...spec.auditedAsset },
  };
  if (key === "ORIGINAL_ALBUM:15") {
    const albumSpec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS["ORIGINAL_ALBUM:15"];
    return {
      kind: "work-cover" as const,
      value: {
        manifestEntryKey: key,
        artist: "中森明菜" as const,
        canonicalTitle: albumSpec.canonicalTitle,
        observedEditionTitle: albumSpec.observedTitle,
        observedEditionDate: albumSpec.releaseDate,
        observedEditionCatalogNumber: albumSpec.catalogNumber,
        sourceUrl: albumSpec.sourceUrl,
        cover,
      } satisfies AkinaNakamoriOfficialWorkCoverEvidence,
    };
  }
  return {
    kind: "carrier" as const,
    value: {
      provider: spec.provider,
      role: "CORROBORATING",
      strength: "STRONG",
      scope: "EDITION",
      matchLevel: "EDITION_EXACT",
      manifestEntryKey: key,
      artist: "中森明菜",
      canonicalTitle: spec.canonicalTitle,
      observedTitle: spec.observedTitle,
      category: "SINGLE",
      country: "JP",
      format: "CD",
      releaseDate: spec.releaseDate,
      catalogNumber: spec.catalogNumber,
      sourceUrl: spec.sourceUrl,
      cover,
    } satisfies AkinaNakamoriOfficialCarrierEvidence,
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function readLimitedHtml(response: Response): Promise<
  | { ok: true; html: string }
  | { ok: false; code: "response-too-large" | "invalid-official-html" }
> {
  if (!response.body) return { ok: false, code: "invalid-official-html" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let html = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > HARD_MAX_PAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "response-too-large" };
      }
      try {
        html += decoder.decode(chunk.value, { stream: true });
      } catch {
        return { ok: false, code: "invalid-official-html" };
      }
    }
    try {
      html += decoder.decode();
    } catch {
      return { ok: false, code: "invalid-official-html" };
    }
    return total > 0
      ? { ok: true, html }
      : { ok: false, code: "invalid-official-html" };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or canceled.
    }
  }
}

function warning(
  key: AkinaNakamoriOfficialRecoveryKey,
  code: AkinaNakamoriOfficialWarningCode,
  retryable: boolean,
): AkinaNakamoriOfficialWarning {
  return { key, code, retryable };
}

export class AkinaNakamoriOfficialClient {
  private readonly fetchImpl: OfficialMusicFetch;
  private readonly resolveHost: OfficialMusicHostResolver;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly retryCount: number;

  constructor(options: AkinaNakamoriOfficialClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultOfficialMusicHostResolver;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) =>
      setTimeout(resolve, milliseconds)));
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100), 30_000);
    this.retryCount = Math.min(Math.max(options.retryCount ?? DEFAULT_RETRY_COUNT, 0), 2);
  }

  private async fetchPage(
    key: AkinaNakamoriOfficialRecoveryKey,
    stats: AkinaNakamoriOfficialRecoveryResult["stats"],
  ): Promise<{ html: string | null; warning: AkinaNakamoriOfficialWarning | null }> {
    const spec = AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS[key];
    const url = new URL(spec.sourceUrl);
    const resolved = await resolvePublicOfficialHost(url.hostname, this.resolveHost);
    if (!resolved.ok) return {
      html: null,
      warning: warning(key, resolved.reason, resolved.reason === "dns-resolution-failed"),
    };

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      if (attempt > 0) {
        stats.retries += 1;
        await this.sleep(Math.min(250 * 2 ** (attempt - 1), 1_000));
      }
      stats.requestsAttempted += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "CD-BOX/1.0 (personal discography verifier)",
          },
        });
        if (redirectStatuses.has(response.status)) {
          return { html: null, warning: warning(key, "unexpected-redirect", false) };
        }
        if (!response.ok) {
          const retryable = retryableStatus(response.status);
          if (retryable && attempt < this.retryCount) continue;
          return { html: null, warning: warning(key, "http-status", retryable) };
        }
        const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
        if (!contentType.startsWith("text/html") &&
          !contentType.startsWith("application/xhtml+xml")) {
          return { html: null, warning: warning(key, "unsupported-content-type", false) };
        }
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > HARD_MAX_PAGE_BYTES) {
          return { html: null, warning: warning(key, "response-too-large", false) };
        }
        const body = await readLimitedHtml(response);
        if (!body.ok) return { html: null, warning: warning(key, body.code, false) };
        stats.responsesFetched += 1;
        return { html: body.html, warning: null };
      } catch (error) {
        const timedOut = controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        if (attempt < this.retryCount) continue;
        return {
          html: null,
          warning: warning(key, timedOut ? "network-timeout" : "network-unavailable", true),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    return { html: null, warning: warning(key, "network-unavailable", true) };
  }

  async fetchRecovery(): Promise<AkinaNakamoriOfficialRecoveryResult> {
    const result: AkinaNakamoriOfficialRecoveryResult = {
      carriers: {},
      workCovers: {},
      warnings: [],
      stats: { requestsAttempted: 0, responsesFetched: 0, retries: 0, entitiesMatched: 0 },
    };
    const keys = Object.keys(AKINA_NAKAMORI_OFFICIAL_RECOVERY_SPECS) as
      AkinaNakamoriOfficialRecoveryKey[];
    const pages = await Promise.all(keys.map(async (key) => ({
      key,
      page: await this.fetchPage(key, result.stats),
    })));
    for (const { key, page } of pages) {
      if (page.warning) {
        result.warnings.push(page.warning);
        continue;
      }
      const entity = page.html ? exactPageEvidence(key, page.html) : null;
      if (!entity) {
        result.warnings.push(warning(key, "invalid-official-html", false));
        continue;
      }
      result.stats.entitiesMatched += 1;
      if (entity.kind === "carrier") {
        result.carriers[entity.value.manifestEntryKey] = entity.value;
      } else {
        result.workCovers[entity.value.manifestEntryKey] = entity.value;
      }
    }
    return result;
  }
}

export async function fetchAkinaNakamoriOfficialRecovery() {
  return new AkinaNakamoriOfficialClient().fetchRecovery();
}
