import type { NdlRecord } from "@/lib/ndl/types";

const NDL_RECORD_ORIGIN = "https://ndlsearch.ndl.go.jp";
const MAX_MANIFEST_PAGES = 10;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export type NdlSingleManifestEvidence = {
  provider: "ndl-search";
  recordId: string;
  sourceUrl: string;
  manifestTitle: string;
  publisher: string | null;
  trackTitles: string[];
};

export type NdlSingleManifestResult = {
  evidence: NdlSingleManifestEvidence[];
  unavailable: boolean;
};

export type NdlSingleManifestOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  minimumIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
}

function safeRecordUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === NDL_RECORD_ORIGIN &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      /^\/books\/R\d{9}-I[A-Za-z0-9._~-]+\/?$/.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function isCompleteSinglesManifest(record: NdlRecord, artistKeys: ReadonlySet<string>) {
  const creatorMatch = record.creators.some((creator) => artistKeys.has(normalizedText(creator)));
  const title = normalizedText(record.title);
  const titleArtistMatch = [...artistKeys].some((artistKey) =>
    [...artistKey].length >= 3 && title.startsWith(artistKey));
  const completeSinglesTitle = /completesingles?(?:box|collections?)/u.test(title) ||
    /(?:コンプリート|オール)シングル(?:ス|ズ)?(?:コレクション(?:ズ)?|ボックス)/u.test(title);
  return completeSinglesTitle && (creatorMatch || titleArtistMatch);
}

function stringsFromSerializedHtml(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(/"(?:\\.|[^"\\])*"/gu)) {
    if (match[0].length > 20_000) continue;
    try {
      const value: unknown = JSON.parse(match[0]);
      if (typeof value === "string") values.push(value);
    } catch {
      // Ignore malformed/non-JSON script fragments. No page script is executed.
    }
  }
  return values;
}

function primaryDiscPayloads(value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (/^DISC\s*\d{1,2}(?!\d)/iu.test(normalized)) return [normalized];
  if (!/^\[\d{1,2}\](?=\s*\(1\))/u.test(normalized)) return [];

  // Some NDL records serialize every disc into one value: [1](1)...[2](1)...
  // A disc header must be a small numeric bracket immediately followed by its
  // first track marker so unrelated bracketed metadata cannot create a section.
  const headers = [...normalized.matchAll(/\[\d{1,2}\](?=\s*\(1\))/gu)];
  return headers.map((header, index) =>
    normalized.slice(header.index, headers[index + 1]?.index ?? normalized.length));
}

function aSidePayloads(value: string) {
  const sideMarkers = [...value.matchAll(
    /(?:[〈《<【「『]\s*)?(?:SINGLE\s*([AB])[\s-]*SIDE(?:\s+COLLECTION)?|シングル\s*([AB])\s*面)/giu,
  )].map((match) => ({
    end: match.index + match[0].length,
    index: match.index,
    side: (match[1] ?? match[2])!.toUpperCase(),
  }));
  // A generic "complete singles" box frequently contains alternating A- and
  // B-sides (and some explicitly advertise complete AB-side coverage). Track
  // order alone is not enough to identify the released single work: double
  // A-sides and bonus tracks make odd/even inference unsafe. Fail closed unless
  // the NDL payload itself labels the A-side section.
  if (sideMarkers.length === 0) return [];

  return sideMarkers.flatMap((marker, index) =>
    marker.side === "A"
      ? [value.slice(marker.end, sideMarkers[index + 1]?.index ?? value.length)]
      : []);
}

function sequentialTrackTitles(value: string) {
  const markers = [...value.matchAll(/\((\d{1,2})\)/gu)];
  const first = markers.findIndex((marker) => Number(marker[1]) === 1);
  if (first < 0) return [];

  const sequence = [markers[first]!];
  let expected = 2;
  for (let index = first + 1; index < markers.length; index += 1) {
    if (Number(markers[index]![1]) !== expected) continue;
    sequence.push(markers[index]!);
    expected += 1;
  }
  // A complete-singles disc must expose at least two sequentially numbered
  // tracks. This rejects one-off dates, prices, and other numbered metadata.
  if (sequence.length < 2) return [];

  return sequence.flatMap((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = sequence[index + 1]?.index ?? value.length;
    const title = value.slice(start, end).trim();
    return title && title.length <= 500 ? [title] : [];
  });
}

export function extractNdlSingleManifestTitles(html: string) {
  if (!html || html.length > MAX_PAGE_BYTES) return [];
  const titles: string[] = [];
  for (const value of stringsFromSerializedHtml(html)) {
    for (const disc of primaryDiscPayloads(value)) {
      for (const payload of aSidePayloads(disc)) {
        titles.push(...sequentialTrackTitles(payload));
      }
    }
  }
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = normalizedText(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function limitedHtml(response: Response) {
  const rawLength = response.headers.get("content-length")?.trim();
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_PAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PAGE_BYTES) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

/**
 * Reads only NDL national-bibliography record pages already discovered by the
 * bounded artist inventory. A complete-singles collection is authority for
 * listed single works, not for edition dates or covers. When the page labels
 * Only explicitly labelled A-side sections are retained. Unlabelled complete
 * collections are deliberately ignored because they can mix A-sides, B-sides,
 * double A-sides, and bonus material.
 */
export async function fetchNdlSingleManifests(
  records: readonly NdlRecord[],
  artistNames: readonly string[],
  options: NdlSingleManifestOptions = {},
): Promise<NdlSingleManifestResult> {
  const artistKeys = new Set(artistNames.map(normalizedText).filter(Boolean));
  const selected = records
    .filter((record) => isCompleteSinglesManifest(record, artistKeys))
    .filter((record) => safeRecordUrl(record.sourceUrl))
    .slice(0, MAX_MANIFEST_PAGES);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const minimumIntervalMs = Math.max(0, Math.min(options.minimumIntervalMs ?? 1_000, 60_000));
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 10_000, 30_000));
  const evidence: NdlSingleManifestEvidence[] = [];
  let unavailable = false;
  let nextAllowedAt = 0;

  for (const record of selected) {
    const url = safeRecordUrl(record.sourceUrl)!;
    const delay = Math.max(0, nextAllowedAt - now());
    if (delay > 0) await sleep(delay);
    nextAllowedAt = now() + minimumIntervalMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml;q=0.9",
          "User-Agent": "CD-BOX/1.0 NDL-complete-singles-manifest (+https://github.com/KAtOReNA7/CD-BOX)",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.startsWith("text/html")) {
        await response.body?.cancel().catch(() => undefined);
        unavailable ||= response.status === 408 || response.status === 429 || response.status >= 500;
        continue;
      }
      const html = await limitedHtml(response);
      if (!html) continue;
      const trackTitles = extractNdlSingleManifestTitles(html);
      if (trackTitles.length === 0) continue;
      evidence.push({
        provider: "ndl-search",
        recordId: record.recordId,
        sourceUrl: record.sourceUrl,
        manifestTitle: record.title,
        publisher: record.publishers[0] ?? null,
        trackTitles,
      });
    } catch {
      unavailable = true;
    } finally {
      clearTimeout(timer);
    }
  }
  return { evidence, unavailable };
}
