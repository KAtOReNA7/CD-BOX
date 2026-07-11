import {
  DISCOGS_API_ORIGIN,
  discogsReleaseApiUrl,
  discogsReleaseSourceUrl,
  isAllowedDiscogsImageUrl,
} from "@/lib/discogs/constants";
import { DISCOGS_EVIDENCE_ROLE } from "@/lib/discogs/types";
import type {
  DiscogsArtistCredit,
  DiscogsFormatEvidence,
  DiscogsIdentifierEvidence,
  DiscogsImageEvidence,
  DiscogsJapanCdSearchPage,
  DiscogsLabelEvidence,
  DiscogsReleaseEvidence,
  DiscogsSearchReleaseEvidence,
  DiscogsTrackEvidence,
} from "@/lib/discogs/types";

type RecordValue = Record<string, unknown>;

type Parsed<T> = {
  value: T | null;
  invalid: boolean;
};

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown, maximumLength = 1_000) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

function optionalText(value: unknown, maximumLength = 1_000) {
  return value === null || value === undefined || value === ""
    ? null
    : text(value, maximumLength);
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) > 0
    ? value as number
    : null;
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function positiveIntegerText(value: unknown) {
  if (typeof value === "number") return positiveInteger(value);
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) return null;
  return positiveInteger(Number(value));
}

function year(value: unknown) {
  if (value === 0 || value === "0" || value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "string" && /^\d{4}$/.test(value)
    ? Number(value)
    : value;
  return Number.isInteger(parsed) && (parsed as number) >= 1000 && (parsed as number) <= 9999
    ? parsed as number
    : null;
}

function stringArray(value: unknown, maximumItems = 100, maximumLength = 500) {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const items: string[] = [];
  for (const item of value) {
    const parsed = text(item, maximumLength);
    if (!parsed) return null;
    if (!items.includes(parsed)) items.push(parsed);
  }
  return items;
}

function exactReleaseApiUrl(value: unknown, releaseId: number) {
  const parsed = optionalText(value, 2_000);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    if (
      url.origin !== DISCOGS_API_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/releases/${releaseId}`
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function optionalImageUrl(value: unknown) {
  const parsed = optionalText(value, 4_000);
  if (!parsed) return { value: null, invalid: value !== null && value !== undefined && value !== "" };
  return isAllowedDiscogsImageUrl(parsed)
    ? { value: new URL(parsed).toString(), invalid: false }
    : { value: null, invalid: true };
}

function parseSearchRelease(value: unknown): Parsed<DiscogsSearchReleaseEvidence> {
  const row = record(value);
  if (!row) return { value: null, invalid: true };

  const releaseId = positiveInteger(row.id);
  const title = text(row.title, 1_000);
  const formats = stringArray(row.format, 50, 200);
  const labels = stringArray(row.label, 100, 500);
  if (
    !releaseId ||
    row.type !== "release" ||
    !title ||
    row.country !== "Japan" ||
    !formats?.some((format) => format.toUpperCase() === "CD") ||
    !labels ||
    !exactReleaseApiUrl(row.resource_url, releaseId)
  ) return { value: null, invalid: true };

  const parsedYear = year(row.year);
  const yearWasInvalid = row.year !== null && row.year !== undefined && row.year !== "" &&
    row.year !== 0 && row.year !== "0" && parsedYear === null;
  const thumbnail = optionalImageUrl(row.thumb);
  const cover = optionalImageUrl(row.cover_image);
  const masterId = row.master_id === 0 || row.master_id === "0" || row.master_id === null
    ? null
    : positiveIntegerText(row.master_id);
  const masterWasInvalid = row.master_id !== undefined && row.master_id !== null &&
    row.master_id !== 0 && row.master_id !== "0" && masterId === null;
  const catalogNumber = optionalText(row.catno, 300);
  const barcodes = row.barcode === undefined ? [] : stringArray(row.barcode, 100, 300);
  if (row.barcode !== undefined && !barcodes) return { value: null, invalid: true };

  return {
    value: {
      evidenceRole: DISCOGS_EVIDENCE_ROLE,
      releaseId,
      masterId,
      title,
      year: parsedYear,
      country: "Japan",
      formats,
      labels,
      catalogNumber,
      barcode: barcodes?.[0] ?? null,
      apiUrl: discogsReleaseApiUrl(releaseId),
      sourceUrl: discogsReleaseSourceUrl(releaseId),
      thumbnailUrl: thumbnail.value,
      coverImageUrl: cover.value,
    },
    invalid: yearWasInvalid || masterWasInvalid || thumbnail.invalid || cover.invalid,
  };
}

export function parseJapanCdSearchPayload(
  payload: unknown,
  requestedPage: number,
  requestedPerPage: number,
): Parsed<{ page: DiscogsJapanCdSearchPage; items: DiscogsSearchReleaseEvidence[] }> {
  const root = record(payload);
  const pagination = record(root?.pagination);
  if (!root || !pagination || !Array.isArray(root.results) || root.results.length > 100) {
    return { value: null, invalid: true };
  }

  const page = positiveInteger(pagination.page);
  const pages = positiveInteger(pagination.pages);
  const perPage = positiveInteger(pagination.per_page);
  const total = nonNegativeInteger(pagination.items);
  if (
    page !== requestedPage ||
    !pages ||
    perPage !== requestedPerPage ||
    perPage > 100 ||
    total === null ||
    pages < page ||
    root.results.length > perPage
  ) return { value: null, invalid: true };

  const items: DiscogsSearchReleaseEvidence[] = [];
  let invalid = false;
  for (const candidate of root.results) {
    const parsed = parseSearchRelease(candidate);
    invalid ||= parsed.invalid;
    if (parsed.value) items.push(parsed.value);
  }
  return {
    value: {
      page: { page, pages, perPage, total },
      items,
    },
    invalid,
  };
}

function parseArtists(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return { items: [], invalid: true };
  const items: DiscogsArtistCredit[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const name = text(row?.name, 500);
    if (!row || !name) {
      invalid = true;
      continue;
    }
    items.push({
      name,
      anv: optionalText(row.anv, 500),
      join: optionalText(row.join, 100),
    });
  }
  return { items, invalid };
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return { items: [], invalid: true };
  const items: DiscogsLabelEvidence[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const name = text(row?.name, 500);
    if (!row || !name) {
      invalid = true;
      continue;
    }
    items.push({ name, catalogNumber: optionalText(row.catno, 300) });
  }
  return { items, invalid };
}

function parseFormats(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return { items: [], invalid: true };
  const items: DiscogsFormatEvidence[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const name = text(row?.name, 200);
    const descriptions = row?.descriptions === undefined
      ? []
      : stringArray(row.descriptions, 100, 200);
    if (!row || !name || !descriptions) {
      invalid = true;
      continue;
    }
    const quantity = row.qty === undefined || row.qty === "" ? null : positiveIntegerText(row.qty);
    if (row.qty !== undefined && row.qty !== "" && quantity === null) invalid = true;
    items.push({ name, quantity, descriptions });
  }
  return { items, invalid };
}

function parseIdentifiers(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) return { items: [], invalid: true };
  const items: DiscogsIdentifierEvidence[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const type = text(row?.type, 200);
    const identifierValue = text(row?.value, 500);
    if (!row || !type || !identifierValue) {
      invalid = true;
      continue;
    }
    items.push({
      type,
      value: identifierValue,
      description: optionalText(row.description, 500),
    });
  }
  return { items, invalid };
}

function parseTracks(value: unknown) {
  if (!Array.isArray(value) || value.length > 1_000) return { items: [], invalid: true };
  const items: DiscogsTrackEvidence[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const title = text(row?.title, 1_000);
    if (!row || !title) {
      invalid = true;
      continue;
    }
    items.push({
      position: optionalText(row.position, 100),
      title,
      duration: optionalText(row.duration, 100),
      type: optionalText(row.type_, 100),
    });
  }
  return { items, invalid };
}

function parseImages(value: unknown) {
  if (value === undefined) return { items: [], invalid: false };
  if (!Array.isArray(value) || value.length > 100) return { items: [], invalid: true };
  const items: DiscogsImageEvidence[] = [];
  let invalid = false;
  for (const entry of value) {
    const row = record(entry);
    const type = row?.type === "primary" || row?.type === "secondary" ? row.type : null;
    const image = optionalImageUrl(row?.uri);
    const thumbnail = optionalImageUrl(row?.uri150);
    const width = row?.width === undefined ? null : positiveInteger(row.width);
    const height = row?.height === undefined ? null : positiveInteger(row.height);
    if (!row || !type || !image.value) {
      invalid = true;
      continue;
    }
    if (
      image.invalid ||
      thumbnail.invalid ||
      (row.width !== undefined && width === null) ||
      (row.height !== undefined && height === null)
    ) invalid = true;
    items.push({ type, url: image.value, thumbnailUrl: thumbnail.value, width, height });
  }
  return { items, invalid };
}

function releaseDate(value: unknown) {
  const parsed = optionalText(value, 32);
  return parsed && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(parsed) ? parsed : null;
}

export function parseReleasePayload(payload: unknown, expectedReleaseId: number): Parsed<DiscogsReleaseEvidence> {
  const root = record(payload);
  const releaseId = positiveInteger(root?.id);
  const title = text(root?.title, 1_000);
  if (
    !root ||
    releaseId !== expectedReleaseId ||
    !title ||
    !exactReleaseApiUrl(root.resource_url, expectedReleaseId)
  ) return { value: null, invalid: true };

  const artists = parseArtists(root.artists);
  const labels = parseLabels(root.labels);
  const formats = parseFormats(root.formats);
  const identifiers = parseIdentifiers(root.identifiers);
  const tracks = parseTracks(root.tracklist);
  const images = parseImages(root.images);
  const parsedYear = year(root.year);
  const released = releaseDate(root.released);
  const masterId = root.master_id === 0 || root.master_id === null || root.master_id === undefined
    ? null
    : positiveIntegerText(root.master_id);
  const primaryImage = images.items.find((image) => image.type === "primary");
  const barcodes = [...new Set(identifiers.items
    .filter((identifier) => identifier.type.toLowerCase() === "barcode")
    .map((identifier) => identifier.value))];

  const invalid = artists.invalid || labels.invalid || formats.invalid || identifiers.invalid ||
    tracks.invalid || images.invalid ||
    (root.year !== null && root.year !== undefined && root.year !== 0 && parsedYear === null) ||
    (root.released !== null && root.released !== undefined && root.released !== "" && released === null) ||
    (root.master_id !== null && root.master_id !== undefined && root.master_id !== 0 && masterId === null);

  return {
    value: {
      evidenceRole: DISCOGS_EVIDENCE_ROLE,
      releaseId,
      masterId,
      status: optionalText(root.status, 100),
      dataQuality: optionalText(root.data_quality, 100),
      title,
      artistCredit: optionalText(root.artists_sort, 1_000),
      artists: artists.items,
      year: parsedYear,
      released,
      country: optionalText(root.country, 200),
      labels: labels.items,
      formats: formats.items,
      identifiers: identifiers.items,
      barcodes,
      tracks: tracks.items,
      images: images.items,
      primaryImageUrl: primaryImage?.url ?? null,
      apiUrl: discogsReleaseApiUrl(releaseId),
      sourceUrl: discogsReleaseSourceUrl(releaseId),
    },
    invalid,
  };
}
