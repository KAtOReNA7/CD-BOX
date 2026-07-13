import { NDL_EVIDENCE_ROLE } from "@/lib/ndl/constants";
import { parseNdlIssuedDate } from "@/lib/ndl/parser";
import type {
  NdlCandidate,
  NdlDatePrecision,
  NdlMatchDecision,
  NdlRecord,
  NdlSearchResponse,
} from "@/lib/ndl/types";

const dashCharacters = /[\u2010-\u2015\u2212\u30fc\ufe58\ufe63\uff0d]/g;

function safeText(value: string, maximumLength: number) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

export function canonicalNdlCatalogNumber(value: string) {
  const text = safeText(value, 100);
  if (!text) return null;
  const canonical = text
    .toUpperCase()
    .replace(dashCharacters, "-")
    .replace(/[\s_/\\.]+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (
    canonical.length < 2 ||
    canonical.length > 64 ||
    !/[A-Z]/.test(canonical) ||
    !/\d/.test(canonical)
  ) return null;
  return canonical;
}

export function normalizedNdlCatalogKey(value: string) {
  return canonicalNdlCatalogNumber(value)?.replace(/-/g, "") ?? null;
}

function foldText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\p{P}\p{S}\s]/gu, "");
}

function titleWithoutArtist(record: NdlRecord, artist: string) {
  const artistText = safeText(artist, 200);
  if (!artistText) return record.title;
  const escaped = artistText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return record.title
    .replace(new RegExp(`^\\s*${escaped}\\s*[\\/／:：,，|｜・~\\-]+\\s*`, "iu"), "")
    .trim();
}

function titleWithoutCandidateArtist(record: NdlRecord, candidate: NdlCandidate) {
  for (const name of [candidate.artist, ...(candidate.artistAliases ?? [])]) {
    const stripped = titleWithoutArtist(record, name);
    if (stripped !== record.title) return stripped;
  }
  return record.title;
}

function authoritativeRecordTitle(record: NdlRecord, candidate: NdlCandidate) {
  return safeText(titleWithoutCandidateArtist(record, candidate), 500) ?? record.title;
}

function artistAppears(record: NdlRecord, candidate: NdlCandidate) {
  const names = [candidate.artist, ...(candidate.artistAliases ?? [])]
    .map((value) => safeText(value, 200))
    .filter((value): value is string => Boolean(value));
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const titleHasExactCredit = new RegExp(
      `^\\s*${escaped}\\s*(?:[\\/／:：,，]|$)`,
      "iu",
    ).test(record.title.normalize("NFKC"));
    if (titleHasExactCredit) return true;
    const foldedName = foldText(name);
    return foldedName.length >= 2 && record.creators.some((creator) => foldText(creator) === foldedName);
  });
}

function titleMatches(candidate: NdlCandidate, record: NdlRecord) {
  const observed = foldText(titleWithoutCandidateArtist(record, candidate));
  if (!observed) return false;
  return [candidate.title, ...(candidate.titleAliases ?? [])]
    .map((value) => safeText(value, 500))
    .filter((value): value is string => Boolean(value))
    .some((value) => foldText(value) === observed);
}

function isDifferentScriptTitle(candidate: NdlCandidate, record: NdlRecord) {
  const candidateTitle = safeText(candidate.title, 500) ?? "";
  const observedTitle = titleWithoutCandidateArtist(record, candidate);
  const hasLatin = (value: string) => /\p{Script=Latin}/u.test(value);
  const hasJapanese = (value: string) =>
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(value);
  return (hasLatin(candidateTitle) && hasJapanese(observedTitle)) ||
    (hasJapanese(candidateTitle) && hasLatin(observedTitle));
}

function commonDatePrecision(
  candidateValue: string,
  record: NdlRecord,
): { ok: boolean; precision: NdlDatePrecision | null } {
  const candidate = parseNdlIssuedDate(candidateValue);
  const observed = record.issued && record.issuedPrecision
    ? { value: record.issued, precision: record.issuedPrecision }
    : null;
  if (!candidate || !observed) return { ok: false, precision: null };
  const candidateParts = candidate.value.split("-");
  const observedParts = observed.value.split("-");
  const commonLength = Math.min(candidateParts.length, observedParts.length);
  if (candidateParts.slice(0, commonLength).join("-") !== observedParts.slice(0, commonLength).join("-")) {
    return { ok: false, precision: null };
  }
  return {
    ok: true,
    precision: commonLength === 3 ? "day" : commonLength === 2 ? "month" : "year",
  };
}

function invalidCandidate(candidate: NdlCandidate) {
  return !safeText(candidate.artist, 200) ||
    !safeText(candidate.title, 500) ||
    !canonicalNdlCatalogNumber(candidate.catalogNumber) ||
    !parseNdlIssuedDate(candidate.date) ||
    (candidate.titleAliases?.length ?? 0) > 20;
}

export function matchNdlCandidate(
  candidate: NdlCandidate,
  result: NdlSearchResponse,
): NdlMatchDecision {
  if (invalidCandidate(candidate)) return { evidence: null, reason: "invalid-candidate" };
  if (!result.complete) return { evidence: null, reason: "incomplete-results" };
  const catalogKey = normalizedNdlCatalogKey(candidate.catalogNumber)!;
  const catalogMatches = result.records.filter((record) => record.catalogNumbers.some(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  ));
  if (catalogMatches.length === 0) return { evidence: null, reason: "catalog-not-found" };
  if (catalogMatches.length !== 1) return { evidence: null, reason: "ambiguous-catalog" };
  const record = catalogMatches[0]!;
  if (!artistAppears(record, candidate)) return { evidence: null, reason: "artist-mismatch" };
  if (!titleMatches(candidate, record)) return { evidence: null, reason: "title-mismatch" };
  if (!record.issued || !record.issuedPrecision) return { evidence: null, reason: "date-missing" };
  const date = commonDatePrecision(candidate.date, record);
  if (!date.ok || !date.precision) return { evidence: null, reason: "date-conflict" };
  const observedCatalogNumber = record.catalogNumbers.find(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  )!;
  return {
    reason: null,
    evidence: {
      sourceType: NDL_EVIDENCE_ROLE,
      provider: "ndl-search",
      recordId: record.recordId,
      sourceUrl: record.sourceUrl,
      observedTitle: record.title,
      authoritativeTitle: authoritativeRecordTitle(record, candidate),
      observedCatalogNumber,
      observedIssued: record.issued,
      observedIssuedPrecision: record.issuedPrecision,
      publishers: [...record.publishers],
      matchedFields: ["artist", "catalogNumber", "title", "date"],
      titleComparison: "controlled-equivalent",
    },
  };
}

/**
 * Returns a catalog-bound national-bibliography record for the final AI audit.
 * Unlike the strict matcher, this permits a title written in another script to
 * proceed only when catalog number, artist, and date already bind one unique
 * record. The model may reject that supplied title pair but cannot create or
 * substitute bibliography facts.
 */
export function matchNdlCandidateForAiAudit(
  candidate: NdlCandidate,
  result: NdlSearchResponse,
): NdlMatchDecision {
  if (invalidCandidate(candidate)) return { evidence: null, reason: "invalid-candidate" };
  if (!result.complete) return { evidence: null, reason: "incomplete-results" };
  const catalogKey = normalizedNdlCatalogKey(candidate.catalogNumber)!;
  const catalogMatches = result.records.filter((record) => record.catalogNumbers.some(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  ));
  if (catalogMatches.length === 0) return { evidence: null, reason: "catalog-not-found" };
  if (catalogMatches.length !== 1) return { evidence: null, reason: "ambiguous-catalog" };
  const record = catalogMatches[0]!;
  if (!artistAppears(record, candidate)) return { evidence: null, reason: "artist-mismatch" };
  if (!record.issued || !record.issuedPrecision) return { evidence: null, reason: "date-missing" };
  const date = commonDatePrecision(candidate.date, record);
  if (!date.ok || !date.precision) return { evidence: null, reason: "date-conflict" };
  const observedCatalogNumber = record.catalogNumbers.find(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  )!;
  const controlledTitleMatch = titleMatches(candidate, record);
  if (!controlledTitleMatch && !isDifferentScriptTitle(candidate, record)) {
    return { evidence: null, reason: "title-mismatch" };
  }
  return {
    reason: null,
    evidence: {
      sourceType: NDL_EVIDENCE_ROLE,
      provider: "ndl-search",
      recordId: record.recordId,
      sourceUrl: record.sourceUrl,
      observedTitle: record.title,
      authoritativeTitle: authoritativeRecordTitle(record, candidate),
      observedCatalogNumber,
      observedIssued: record.issued,
      observedIssuedPrecision: record.issuedPrecision,
      publishers: [...record.publishers],
      matchedFields: controlledTitleMatch
        ? ["artist", "catalogNumber", "title", "date"]
        : ["artist", "catalogNumber", "date"],
      titleComparison: controlledTitleMatch ? "controlled-equivalent" : "requires-ai",
    },
  };
}

/**
 * Comprehensive verification keeps a unique catalog-bound record even when
 * its title cannot be compared deterministically. Catalog number, artist and
 * date still have to agree; the supplied title pair is then explicitly marked
 * for the evidence-only AI audit instead of being silently discarded.
 */
export function matchNdlCandidateForComprehensiveAudit(
  candidate: NdlCandidate,
  result: NdlSearchResponse,
): NdlMatchDecision {
  if (invalidCandidate(candidate)) return { evidence: null, reason: "invalid-candidate" };
  if (!result.complete) return { evidence: null, reason: "incomplete-results" };
  const catalogKey = normalizedNdlCatalogKey(candidate.catalogNumber)!;
  const catalogMatches = result.records.filter((record) => record.catalogNumbers.some(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  ));
  if (catalogMatches.length === 0) return { evidence: null, reason: "catalog-not-found" };
  if (catalogMatches.length !== 1) return { evidence: null, reason: "ambiguous-catalog" };
  const record = catalogMatches[0]!;
  if (!artistAppears(record, candidate)) return { evidence: null, reason: "artist-mismatch" };
  if (!record.issued || !record.issuedPrecision) return { evidence: null, reason: "date-missing" };
  const date = commonDatePrecision(candidate.date, record);
  if (!date.ok || !date.precision) return { evidence: null, reason: "date-conflict" };
  const observedCatalogNumber = record.catalogNumbers.find(
    (catalogNumber) => normalizedNdlCatalogKey(catalogNumber) === catalogKey,
  )!;
  const controlledTitleMatch = titleMatches(candidate, record);
  return {
    reason: null,
    evidence: {
      sourceType: NDL_EVIDENCE_ROLE,
      provider: "ndl-search",
      recordId: record.recordId,
      sourceUrl: record.sourceUrl,
      observedTitle: record.title,
      authoritativeTitle: authoritativeRecordTitle(record, candidate),
      observedCatalogNumber,
      observedIssued: record.issued,
      observedIssuedPrecision: record.issuedPrecision,
      publishers: [...record.publishers],
      matchedFields: controlledTitleMatch
        ? ["artist", "catalogNumber", "title", "date"]
        : ["artist", "catalogNumber", "date"],
      titleComparison: controlledTitleMatch ? "controlled-equivalent" : "requires-ai",
    },
  };
}
