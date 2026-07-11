import {
  canonicalCollectionStatus,
  releaseCategories,
  releaseFormats,
  type BulkUpdateInput,
  type ReleasePatchInput,
  type ReleaseStatusPatchInput,
} from "@/lib/releases/release-types";

export function toReleaseDate(value: string | null | undefined) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("releaseDate must be YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("releaseDate is invalid.");
  }
  return date;
}

export function textOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function boolValue(value: unknown) {
  return value === true || value === "true";
}

function priorityValue(value: unknown) {
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw new Error("priority must be an integer from 1 to 5.");
  }
  return priority;
}

export function normalizeStatus(value: unknown) {
  const status = canonicalCollectionStatus(value);
  if (status) return status;
  throw new Error("Invalid collection status.");
}

export function parseReleasePatchInput(body: Record<string, unknown>): ReleasePatchInput {
  const input: ReleasePatchInput = {};

  if ("title" in body) {
    const title = textOrNull(body.title);
    if (!title) throw new Error("title is required.");
    input.title = title;
  }
  if ("category" in body) {
    if (!releaseCategories.includes(body.category as never)) throw new Error("Invalid category.");
    input.category = body.category as ReleasePatchInput["category"];
  }
  if ("releaseDate" in body) {
    const releaseDate = textOrNull(body.releaseDate);
    toReleaseDate(releaseDate);
    input.releaseDate = releaseDate;
  }
  if ("format" in body) {
    if (!releaseFormats.includes(body.format as never)) throw new Error("Invalid format.");
    input.format = body.format as ReleasePatchInput["format"];
  }
  if ("catalogNumber" in body) input.catalogNumber = textOrNull(body.catalogNumber);
  if ("label" in body) input.label = textOrNull(body.label);
  if ("originalPrice" in body) input.originalPrice = textOrNull(body.originalPrice);
  if ("editionType" in body) input.editionType = textOrNull(body.editionType);
  if ("isReissue" in body) input.isReissue = boolValue(body.isReissue);
  if ("isRemaster" in body) input.isRemaster = boolValue(body.isRemaster);
  if ("isExcludedByDefault" in body) input.isExcludedByDefault = boolValue(body.isExcludedByDefault);
  if ("coverImageUrl" in body) input.coverImageUrl = textOrNull(body.coverImageUrl);
  if ("notes" in body) input.notes = textOrNull(body.notes);

  return input;
}

export function parseStatusPatchInput(body: Record<string, unknown>): ReleaseStatusPatchInput {
  const input: ReleaseStatusPatchInput = {};
  if ("status" in body) input.status = normalizeStatus(body.status);
  if ("priority" in body) input.priority = priorityValue(body.priority);
  if ("ownedCondition" in body) input.ownedCondition = textOrNull(body.ownedCondition);
  if ("ownedNotes" in body) input.ownedNotes = textOrNull(body.ownedNotes);
  return input;
}

export function parseBulkUpdateInput(body: Record<string, unknown>): BulkUpdateInput {
  const releaseIds = Array.isArray(body.releaseIds) ? body.releaseIds.map(String).filter(Boolean) : [];
  if (releaseIds.length === 0) throw new Error("releaseIds is required.");

  const artistId = textOrNull(body.artistId);
  if (!artistId) throw new Error("artistId is required.");

  const input: BulkUpdateInput = {
    artistId,
    releaseIds,
  };

  if ("status" in body && body.status) input.status = normalizeStatus(body.status);
  if ("priority" in body && body.priority !== null && body.priority !== "") {
    input.priority = priorityValue(body.priority);
  }
  if ("isExcludedByDefault" in body && body.isExcludedByDefault !== null) {
    input.isExcludedByDefault = boolValue(body.isExcludedByDefault);
  }

  if (!input.status && input.priority === undefined && input.isExcludedByDefault === undefined) {
    throw new Error("No bulk update operation was provided.");
  }

  return input;
}
