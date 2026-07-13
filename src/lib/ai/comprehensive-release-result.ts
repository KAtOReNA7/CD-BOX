import type { ArtistReleaseEvidenceBundle } from "@/lib/music-metadata/types";
import {
  LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
  LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
  resolveComprehensiveCandidateResolution,
  type ComprehensiveCandidateResult,
  type ComprehensiveDiscographyCandidate,
  type ComprehensiveDiscographyOutput,
} from "@/lib/ai/comprehensive-discography";
import {
  isAllowedVerifiedCoverAssetUrl,
  isAllowedVerifiedCoverSourceUrl,
  type VerifiedCoverProvider,
} from "@/lib/ai/cover-asset-validation";
import type {
  ReleaseResearchCandidate,
  ReleaseResearchCandidateAudit,
  ReleaseResearchRequest,
  ReleaseResearchResult,
  ReleaseResearchSource,
  ReleaseVerification,
} from "@/lib/ai/release-research-types";

const verifiedCoverProviders = new Set([
  "cover-art-archive",
  "discogs",
  "apple-music",
  "official-label",
]);

const boundCandidateIdentityFields = [
  "id",
  "title",
  "titleOriginal",
  "category",
  "artistCredit",
  "releaseDate",
  "originalReleaseDate",
  "format",
  "catalogNumber",
  "barcode",
  "label",
  "editionType",
  "isReissue",
  "isRemaster",
  "isExcludedByDefault",
] as const;

export type LegacyVerifiedCandidateQuarantine =
  | "COVER_DATE_MISMATCH"
  | "PHYSICAL_IDENTITY_INCOMPLETE";

export type ReconciledPersistedComprehensiveCandidate = {
  result: ComprehensiveCandidateResult;
  sourceCandidate: ComprehensiveDiscographyCandidate;
  quarantine: LegacyVerifiedCandidateQuarantine | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedIdentityValue(value: unknown) {
  return value === undefined ? null : value;
}

function exactIsoDay(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? timestamp
    : null;
}

function sourceDateInterval(value: unknown) {
  if (typeof value !== "string") return null;
  const partial = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
  const timestamped = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T.+(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const match = partial ?? timestamped;
  if (!match || (timestamped && !Number.isFinite(Date.parse(value)))) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const exact = exactIsoDay(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
    return exact === null ? null : { start: exact, end: exact };
  }
  if (month !== null) {
    return {
      start: Date.UTC(year, month - 1, 1),
      end: Date.UTC(year, month, 0),
    };
  }
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year, 11, 31) };
}

function physicalCdFormat(value: unknown) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").toUpperCase()
    : "";
  return /(?:^|[^A-Z])(?:CD|BLU[ _-]?SPEC(?:[ _-]?CD)?|COMPACT[ _-]?DISC)(?:[^A-Z]|$)/u
    .test(normalized);
}

function validHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function hasCompleteLedgerEntry(value: unknown) {
  const entry = record(value);
  return Boolean(
    nonBlankString(entry?.stage) &&
    ["PASS", "UNKNOWN", "REJECT", "OUT_OF_SCOPE"].includes(String(entry?.verdict)) &&
    nonBlankString(entry?.reasonCode) &&
    typeof entry?.message === "string" &&
    Array.isArray(entry?.sourceUrls) &&
    entry.sourceUrls.every((url) => validHttpsUrl(url)) &&
    typeof entry?.retryable === "boolean" &&
    Array.isArray(entry?.conflictIds) &&
    entry.conflictIds.every((conflictId) => Boolean(nonBlankString(conflictId))) &&
    (entry.verdict !== "REJECT" || entry.conflictIds.length > 0),
  );
}

function hasCompleteCandidateSources(candidate: Record<string, unknown>) {
  if (!Array.isArray(candidate.sources)) return false;
  const urls = new Set<string>();
  for (const value of candidate.sources) {
    const source = record(value);
    const url = nonBlankString(source?.url);
    if (
      !source ||
      !nonBlankString(source.title) ||
      !url ||
      !validHttpsUrl(url) ||
      !["official", "retailer", "database", "news", "other"]
        .includes(String(source.sourceType)) ||
      urls.has(url)
    ) {
      return false;
    }
    urls.add(url);
  }
  return true;
}

function canonicalIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value
    ? null
    : parsed;
}

function assertSourceCandidateIdentityBinding(
  result: ComprehensiveCandidateResult,
  sourceCandidate: ComprehensiveDiscographyCandidate,
) {
  const candidate = record(result.candidate);
  const source = record(sourceCandidate);
  const sourceRelease = record(source?.candidate);
  if (
    !candidate ||
    !source ||
    !sourceRelease ||
    source.workId !== result.workId ||
    source.editionId !== result.editionId ||
    !Array.isArray(source.observations) ||
    !Array.isArray(source.conflicts) ||
    !hasCompleteCandidateSources(sourceRelease) ||
    JSON.stringify(candidate.sources) !== JSON.stringify(sourceRelease.sources) ||
    !boundCandidateIdentityFields.every((field) =>
      JSON.stringify(normalizedIdentityValue(candidate[field])) ===
        JSON.stringify(normalizedIdentityValue(sourceRelease[field])))
  ) {
    throw new TypeError(
      "A persisted comprehensive candidate is not identity-bound to its source release and work.",
    );
  }
}

function terminalLedgerStage(
  result: ComprehensiveCandidateResult,
  stage: string,
) {
  return [...result.ledger].reverse().find((entry) => entry.stage === stage);
}

const canonicalLegacySelectionScopeMessages = new Map([
  [
    "LATER_EDITION_NOT_SELECTED",
    "The requested original-CD scope keeps the earliest AI-accepted edition for this work; this later edition remains in the audit ledger.",
  ],
  [
    "DECLARED_ORIGINAL_CD_DATE_MISMATCH",
    "The official manifest declares an original physical-CD issue, so a later reissue cannot replace that unresolved original edition.",
  ],
]);

export function hasCanonicalLegacySelectionScopeConclusion(
  result: ComprehensiveCandidateResult,
) {
  const terminal = result.ledger.at(-1);
  return Boolean(
    terminal &&
    result.ledger.filter((entry) => entry.verdict === "OUT_OF_SCOPE").length === 1 &&
    !result.ledger.some((entry) => entry.stage === "COVER") &&
    terminal.stage === "SCOPE" &&
    terminal.verdict === "OUT_OF_SCOPE" &&
    canonicalLegacySelectionScopeMessages.get(terminal.reasonCode) === terminal.message &&
    terminal.sourceUrls.length === 0 &&
    !terminal.retryable &&
    terminal.conflictIds.length === 0,
  );
}

/**
 * One pre-invariant pipeline version stored accepted-but-unselected editions
 * with PASS evidence even though its canonical terminal SCOPE entry and
 * resolution were OUT_OF_SCOPE. Normalize only those two exact historical
 * conclusions before applying the current state-machine assertion.
 */
export function normalizeLegacySelectionOutOfScopeResult(
  result: ComprehensiveCandidateResult,
): ComprehensiveCandidateResult {
  if (
    result.resolution === "OUT_OF_SCOPE" &&
    result.evidenceVerdict === "PASS" &&
    result.aiDecision?.decision === "ACCEPT" &&
    result.cover === null &&
    hasCanonicalLegacySelectionScopeConclusion(result)
  ) {
    return { ...result, evidenceVerdict: "OUT_OF_SCOPE" };
  }
  return result;
}

function assertAcceptedDecisionLedgerBinding(result: ComprehensiveCandidateResult) {
  const decision = result.aiDecision;
  if (
    decision?.decision !== "ACCEPT" ||
    !["EVIDENCE_CONSISTENT", "TITLE_TRANSLITERATION_EQUIVALENT"]
      .includes(decision.reasonCode) ||
    !Array.isArray(decision.conflictIds) ||
    decision.conflictIds.length !== 0
  ) {
    throw new TypeError("An accepted comprehensive candidate has an invalid AI decision contract.");
  }
  const aiAuditEntries = result.ledger.filter((entry) => entry.stage === "AI_AUDIT");
  const terminalAiAudit = aiAuditEntries.at(-1);
  if (terminalAiAudit) {
    if (
      terminalAiAudit.verdict !== "PASS" ||
      terminalAiAudit.reasonCode !== decision.reasonCode ||
      terminalAiAudit.message !== decision.reason ||
      terminalAiAudit.sourceUrls.length !== 0 ||
      terminalAiAudit.retryable ||
      terminalAiAudit.conflictIds.length !== 0
    ) {
      throw new TypeError("An accepted comprehensive candidate is not bound to its terminal PASS audit.");
    }
    return;
  }
  const deterministicAccepts = result.ledger.filter((entry) =>
    entry.stage === "CORROBORATION" &&
    entry.verdict === "PASS" &&
    entry.reasonCode === "DETERMINISTIC_EVIDENCE_ACCEPTED");
  if (
    decision.reasonCode !== "EVIDENCE_CONSISTENT" ||
    decision.reason !==
      "Deterministic evidence gates passed and no semantic review item requires AI resolution." ||
    deterministicAccepts.length !== 1 ||
    deterministicAccepts[0]!.message !==
      "Deterministic evidence gates passed with no semantic AI_REVIEW question, so this candidate was accepted without calling the AI provider." ||
    deterministicAccepts[0]!.sourceUrls.length !== 0 ||
    deterministicAccepts[0]!.retryable ||
    deterministicAccepts[0]!.conflictIds.length !== 0
  ) {
    throw new TypeError("An accepted comprehensive candidate has no bound deterministic acceptance record.");
  }
}

function assertPersistedResolutionBinding(result: ComprehensiveCandidateResult) {
  const expectedResolution = resolveComprehensiveCandidateResolution({
    evidenceVerdict: result.evidenceVerdict,
    aiDecision: result.aiDecision?.decision ?? null,
    coverStatus: result.cover?.status ?? null,
  });
  if (expectedResolution !== result.resolution) {
    throw new TypeError("A persisted comprehensive candidate resolution contradicts its evidence, AI, or cover state.");
  }
  if (!result.ledger.some((entry) => entry.verdict === result.evidenceVerdict)) {
    throw new TypeError("A persisted comprehensive candidate has no ledger verdict for its evidence conclusion.");
  }
  const hasReject = result.ledger.some((entry) => entry.verdict === "REJECT");
  const hasOutOfScope = result.ledger.some((entry) => entry.verdict === "OUT_OF_SCOPE");
  if (
    (hasReject && result.resolution !== "REJECTED") ||
    (hasOutOfScope && result.resolution !== "OUT_OF_SCOPE") ||
    (result.resolution === "REJECTED" && hasOutOfScope) ||
    (result.resolution === "OUT_OF_SCOPE" && hasReject)
  ) {
    throw new TypeError("A persisted comprehensive candidate ledger contradicts its terminal resolution.");
  }

  const physicalQuarantineEntries = result.ledger.filter((entry) =>
    entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON);
  const terminalLedgerEntry = result.ledger.at(-1);
  const physicalQuarantine = physicalQuarantineEntries.length === 1 &&
    terminalLedgerEntry === physicalQuarantineEntries[0] &&
    terminalLedgerEntry?.stage === "SCOPE" &&
    terminalLedgerEntry.verdict === "UNKNOWN" &&
    terminalLedgerEntry.message ===
      "The legacy VERIFIED row lacks an exact physical-CD release day or CD format and remains pending authoritative evidence without inferred values." &&
    terminalLedgerEntry.sourceUrls.length === 0 &&
    !terminalLedgerEntry.retryable &&
    terminalLedgerEntry.conflictIds.length === 0;

  if (result.aiDecision?.decision === "ACCEPT") {
    assertAcceptedDecisionLedgerBinding(result);
  } else if (result.aiDecision?.decision === "UNKNOWN") {
    if (terminalLedgerStage(result, "AI_AUDIT")?.verdict !== "UNKNOWN") {
      throw new TypeError("A pending AI decision has no terminal UNKNOWN audit entry.");
    }
  } else if (result.aiDecision?.decision === "REJECT") {
    if (terminalLedgerStage(result, "AI_AUDIT")?.verdict !== "REJECT") {
      throw new TypeError("A rejected AI decision has no terminal REJECT audit entry.");
    }
  } else {
    const terminalAiAudit = terminalLedgerStage(result, "AI_AUDIT");
    if (
      terminalAiAudit &&
      !(
        result.resolution === "PENDING_EVIDENCE" &&
        (terminalAiAudit.verdict === "UNKNOWN" ||
          (physicalQuarantine && terminalAiAudit.verdict === "PASS"))
      )
    ) {
      throw new TypeError("A candidate with no AI decision retains a contradictory terminal AI audit.");
    }
  }

  if (result.resolution === "PENDING_EVIDENCE") {
    if (
      result.aiDecision?.decision === "ACCEPT" ||
      result.aiDecision?.decision === "REJECT" ||
      (result.cover !== null && !(physicalQuarantine && result.cover.status === "FOUND"))
    ) {
      throw new TypeError("A pending-evidence candidate retains a contradictory decision or cover state.");
    }
  } else if (result.resolution === "PENDING_COVER") {
    const terminalCover = terminalLedgerStage(result, "COVER");
    if (
      result.evidenceVerdict !== "PASS" ||
      result.aiDecision?.decision !== "ACCEPT" ||
      !result.cover ||
      result.cover.status === "FOUND" ||
      terminalCover?.verdict !== "UNKNOWN" ||
      terminalCover.reasonCode !== result.cover.reasonCode ||
      terminalCover.message !== result.cover.reason ||
      terminalCover.retryable !== result.cover.retryable ||
      terminalCover.sourceUrls.length !== 0 ||
      terminalCover.conflictIds.length !== 0
    ) {
      throw new TypeError("A pending-cover candidate has no bound unresolved cover conclusion.");
    }
  } else if (result.resolution === "REJECTED") {
    if (
      result.cover !== null ||
      (result.aiDecision !== null && result.aiDecision.decision !== "REJECT")
    ) {
      throw new TypeError("A rejected candidate retains a contradictory decision or cover state.");
    }
  } else if (result.resolution === "OUT_OF_SCOPE") {
    if (
      result.cover !== null ||
      (result.aiDecision !== null && result.aiDecision.decision !== "ACCEPT")
    ) {
      throw new TypeError("An out-of-scope candidate retains a contradictory decision or cover state.");
    }
  }
}

/**
 * Structural boundary shared by offline reconciliation and the cover worker.
 * It deliberately permits incomplete dates/formats for deferred candidates,
 * but never permits a missing ledger, work/edition id, or source identity.
 */
export function assertCompletePersistedComprehensiveCandidateBinding(
  result: ComprehensiveCandidateResult,
  sourceCandidate: ComprehensiveDiscographyCandidate,
) {
  const candidate = record(result.candidate);
  const aiDecision = record(result.aiDecision);
  const cover = record(result.cover);
  if (
    !candidate ||
    !nonBlankString(candidate.id) ||
    !nonBlankString(candidate.title) ||
    !nonBlankString(candidate.artistCredit) ||
    !nonBlankString(candidate.category) ||
    !nonBlankString(result.workId) ||
    !nonBlankString(result.editionId) ||
    !hasCompleteCandidateSources(candidate) ||
    !Array.isArray(candidate.warnings) ||
    !["VERIFIED", "PENDING_EVIDENCE", "PENDING_COVER", "REJECTED", "OUT_OF_SCOPE"]
      .includes(String(result.resolution)) ||
    !["PASS", "UNKNOWN", "REJECT", "OUT_OF_SCOPE"].includes(String(result.evidenceVerdict)) ||
    !Array.isArray(result.ledger) ||
    result.ledger.length === 0 ||
    !result.ledger.every(hasCompleteLedgerEntry) ||
    (candidate.workId !== undefined && candidate.workId !== null &&
      candidate.workId !== result.workId) ||
    (candidate.editionId !== undefined && candidate.editionId !== null &&
      candidate.editionId !== result.editionId)
  ) {
    throw new TypeError("A persisted comprehensive candidate is structurally incomplete.");
  }
  if (aiDecision && (
    aiDecision.candidateId !== candidate.id ||
    !["ACCEPT", "UNKNOWN", "REJECT"].includes(String(aiDecision.decision)) ||
    !nonBlankString(aiDecision.reasonCode) ||
    typeof aiDecision.reason !== "string" ||
    !Array.isArray(aiDecision.conflictIds) ||
    !aiDecision.conflictIds.every((conflictId) => Boolean(nonBlankString(conflictId)))
  )) {
    throw new TypeError("A persisted comprehensive candidate has an invalid AI decision binding.");
  }
  if (cover && !["FOUND", "MISSING", "UNAVAILABLE", "INVALID"].includes(String(cover.status))) {
    throw new TypeError("A persisted comprehensive candidate has an invalid cover state.");
  }
  if (cover && cover.status !== "FOUND" && (
    !nonBlankString(cover.reasonCode) ||
    typeof cover.reason !== "string" ||
    typeof cover.retryable !== "boolean"
  )) {
    throw new TypeError("A persisted comprehensive candidate has an incomplete deferred cover state.");
  }
  if (cover?.status === "FOUND") {
    const binding = verifiedCoverBinding(result, candidate);
    if (!binding.sourceDate) {
      throw new TypeError("A persisted comprehensive candidate has an incomplete cover date binding.");
    }
  }
  assertPersistedResolutionBinding(normalizeLegacySelectionOutOfScopeResult(result));
  assertSourceCandidateIdentityBinding(result, sourceCandidate);
}

function assertVerifiedEvidenceBinding(
  result: ComprehensiveCandidateResult,
  candidate: Record<string, unknown>,
) {
  const aiDecision = record(result.aiDecision);
  if (
    result.evidenceVerdict !== "PASS" ||
    aiDecision?.candidateId !== candidate.id ||
    aiDecision?.decision !== "ACCEPT"
  ) {
    throw new TypeError("A VERIFIED comprehensive candidate has no identity-bound ACCEPT decision.");
  }

  if (!Array.isArray(result.ledger) || result.ledger.length === 0 ||
      !result.ledger.every(hasCompleteLedgerEntry)) {
    throw new TypeError("A VERIFIED comprehensive candidate has an incomplete PASS evidence ledger.");
  }
  if (result.ledger.some((entry) =>
    entry.verdict === "REJECT" || entry.verdict === "OUT_OF_SCOPE")) {
    throw new TypeError("A VERIFIED comprehensive candidate retains rejected or out-of-scope evidence.");
  }
  const scopePass = result.ledger.some((entry) =>
    entry.stage === "SCOPE" && entry.verdict === "PASS");
  const authorityPass = result.ledger.some((entry) =>
    entry.stage === "AUTHORITATIVE" && entry.verdict === "PASS" && entry.sourceUrls.length > 0);
  const corroborationPass = result.ledger.some((entry) =>
    ["MUSICBRAINZ", "CORROBORATION"].includes(entry.stage) &&
    entry.verdict === "PASS" && entry.sourceUrls.length > 0);
  if (!scopePass || !authorityPass || !corroborationPass) {
    throw new TypeError("A VERIFIED comprehensive candidate has no complete PASS identity evidence.");
  }
  assertAcceptedDecisionLedgerBinding(result);
}

function verifiedCoverBinding(
  result: ComprehensiveCandidateResult,
  candidate: Record<string, unknown>,
) {
  const cover = record(result.cover);
  const provider = nonBlankString(cover?.provider);
  if (
    cover?.status !== "FOUND" ||
    !provider ||
    !verifiedCoverProviders.has(provider) ||
    !nonBlankString(cover.imageUrl) ||
    !nonBlankString(cover.sourceUrl) ||
    candidate.coverImageUrl !== cover.imageUrl ||
    candidate.coverImageSourceUrl !== cover.sourceUrl ||
    !isAllowedVerifiedCoverAssetUrl(cover.imageUrl as string, provider as VerifiedCoverProvider) ||
    !isAllowedVerifiedCoverSourceUrl(cover.sourceUrl as string, provider as VerifiedCoverProvider) ||
    !["EDITION", "WORK"].includes(String(cover.coverMatchLevel)) ||
    (cover.checkedAt !== undefined && canonicalIsoTimestamp(cover.checkedAt) === null) ||
    (cover.contentSha256 !== undefined &&
      (typeof cover.contentSha256 !== "string" ||
        !/^[0-9a-f]{64}$/iu.test(cover.contentSha256)))
  ) {
    throw new TypeError("A VERIFIED comprehensive candidate has no valid provider-bound cover attestation.");
  }
  const terminalCover = [...result.ledger].reverse().find((entry) => entry.stage === "COVER");
  if (
    terminalCover?.verdict !== "PASS" ||
    terminalCover.sourceUrls.length !== 1 ||
    terminalCover.sourceUrls[0] !== cover.sourceUrl
  ) {
    throw new TypeError("A VERIFIED comprehensive candidate cover is not exactly bound to a PASS ledger entry.");
  }
  return {
    cover,
    provider,
    sourceDate: sourceDateInterval(cover.sourceReleaseDate),
  };
}

function verifiedCoverDateMatches(
  cover: Record<string, unknown>,
  provider: string,
  sourceDate: ReturnType<typeof sourceDateInterval>,
  releaseDate: number,
  originalReleaseDate: number,
) {
  return cover.coverMatchLevel === "EDITION"
    ? Boolean(sourceDate && releaseDate >= sourceDate.start && releaseDate <= sourceDate.end)
    : Boolean(
        sourceDate &&
        (provider === "apple-music" || provider === "official-label") &&
        sourceDate.end >= originalReleaseDate,
      );
}

/**
 * Runtime publication boundary for decoded/persisted comprehensive results.
 * Type assertions are not evidence: every VERIFIED row must still carry its
 * exact physical identity, provider-bound cover, and PASS ledger bindings.
 */
export function assertCompleteVerifiedComprehensiveCandidate(
  result: ComprehensiveCandidateResult,
  sourceCandidate?: ComprehensiveDiscographyCandidate,
) {
  if (result.resolution !== "VERIFIED") return;

  const candidate = record(result.candidate);
  const releaseDate = exactIsoDay(candidate?.releaseDate);
  const originalReleaseDate = exactIsoDay(candidate?.originalReleaseDate);
  if (
    !candidate ||
    !nonBlankString(candidate.id) ||
    !nonBlankString(candidate.title) ||
    !nonBlankString(candidate.artistCredit) ||
    !nonBlankString(candidate.category) ||
    !nonBlankString(result.workId) ||
    !nonBlankString(result.editionId) ||
    releaseDate === null ||
    originalReleaseDate === null ||
    !nonBlankString(candidate.catalogNumber) ||
    !physicalCdFormat(candidate.format) ||
    candidate.isExcludedByDefault !== false ||
    !hasCompleteCandidateSources(candidate) ||
    !Array.isArray(candidate.warnings) ||
    (candidate.workId !== undefined && candidate.workId !== null &&
      candidate.workId !== result.workId) ||
    (candidate.editionId !== undefined && candidate.editionId !== null &&
      candidate.editionId !== result.editionId)
  ) {
    throw new TypeError("A VERIFIED comprehensive candidate has an incomplete physical-CD identity.");
  }
  assertVerifiedEvidenceBinding(result, candidate);
  const coverBinding = verifiedCoverBinding(result, candidate);
  if (!verifiedCoverDateMatches(
    coverBinding.cover,
    coverBinding.provider,
    coverBinding.sourceDate,
    releaseDate,
    originalReleaseDate,
  )) {
    throw new TypeError("A VERIFIED comprehensive candidate has a cover date inconsistent with its full candidate identity.");
  }

  if (sourceCandidate) {
    assertSourceCandidateIdentityBinding(result, sourceCandidate);
  }
}

function appendUniqueQuarantineLedgerEntry(
  result: ComprehensiveCandidateResult,
  entry: ComprehensiveCandidateResult["ledger"][number],
) {
  const existing = result.ledger.filter((candidate) =>
    candidate.reasonCode === entry.reasonCode);
  if (existing.length > 0) {
    throw new TypeError("A legacy VERIFIED candidate already contains a quarantine ledger marker.");
  }
  return [...result.ledger, entry];
}

/**
 * Quarantine only the two legacy publication defects that can be classified
 * without network access or invented metadata. Every other malformed
 * VERIFIED state still throws and therefore aborts the whole selected task.
 */
export function reconcileLegacyVerifiedCandidateForOfflineRematerialization(
  result: ComprehensiveCandidateResult,
  sourceCandidate: ComprehensiveDiscographyCandidate,
): ReconciledPersistedComprehensiveCandidate {
  assertCompletePersistedComprehensiveCandidateBinding(result, sourceCandidate);
  const normalizedSelectionResult = normalizeLegacySelectionOutOfScopeResult(result);
  if (normalizedSelectionResult !== result) {
    return {
      result: normalizedSelectionResult,
      sourceCandidate,
      quarantine: null,
    };
  }
  if (result.resolution !== "VERIFIED") {
    return { result, sourceCandidate, quarantine: null };
  }
  if (result.ledger.some((entry) =>
    entry.reasonCode === LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON ||
    entry.reasonCode === LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON)) {
    throw new TypeError("A legacy VERIFIED candidate already contains a quarantine ledger marker.");
  }

  try {
    assertCompleteVerifiedComprehensiveCandidate(result, sourceCandidate);
    return { result, sourceCandidate, quarantine: null };
  } catch {
    // Continue only long enough to classify one of the two explicit legacy
    // defects below. The shared assertions are repeated for all other gates.
  }

  const candidate = record(result.candidate)!;
  const exactReleaseDate = exactIsoDay(candidate.releaseDate);
  const originalReleaseDate = exactIsoDay(candidate.originalReleaseDate);
  const releaseYear = typeof candidate.releaseDate === "string" &&
    /^\d{4}$/u.test(candidate.releaseDate)
    ? Number(candidate.releaseDate)
    : null;
  const yearOnlyReleaseDate = releaseYear !== null && releaseYear >= 1000
    ? {
        start: Date.UTC(releaseYear, 0, 1),
        end: Date.UTC(releaseYear, 11, 31),
      }
    : null;
  const missingFormat = candidate.format === null;
  const formatComplete = physicalCdFormat(candidate.format);
  const hasSupportedPhysicalDefect = missingFormat || yearOnlyReleaseDate !== null;
  if (
    (!hasSupportedPhysicalDefect && exactReleaseDate === null) ||
    originalReleaseDate === null ||
    !nonBlankString(candidate.catalogNumber) ||
    (!missingFormat && !formatComplete) ||
    candidate.format === undefined ||
    candidate.isExcludedByDefault !== false
  ) {
    throw new TypeError("A VERIFIED comprehensive candidate has an incomplete physical-CD identity.");
  }

  assertVerifiedEvidenceBinding(result, candidate);
  const coverBinding = verifiedCoverBinding(result, candidate);
  const exactDateMatches = exactReleaseDate !== null && verifiedCoverDateMatches(
    coverBinding.cover,
    coverBinding.provider,
    coverBinding.sourceDate,
    exactReleaseDate,
    originalReleaseDate,
  );
  const partialDateMatches = yearOnlyReleaseDate !== null &&
    coverBinding.cover.coverMatchLevel === "EDITION"
    ? Boolean(
        coverBinding.sourceDate &&
        coverBinding.sourceDate.end >= yearOnlyReleaseDate.start &&
        coverBinding.sourceDate.start <= yearOnlyReleaseDate.end,
      )
    : yearOnlyReleaseDate !== null &&
        verifiedCoverDateMatches(
          coverBinding.cover,
          coverBinding.provider,
          coverBinding.sourceDate,
          yearOnlyReleaseDate.start,
          originalReleaseDate,
        );

  if (hasSupportedPhysicalDefect) {
    if (!(exactDateMatches || partialDateMatches)) {
      throw new TypeError(
        "A VERIFIED comprehensive candidate has a cover date inconsistent with its incomplete candidate identity.",
      );
    }
    const nextResult: ComprehensiveCandidateResult = {
      ...result,
      resolution: "PENDING_EVIDENCE",
      evidenceVerdict: "UNKNOWN",
      // Do not manufacture a new AI decision: this is a deterministic local
      // publication gate over the old ACCEPT conclusion.
      aiDecision: null,
      ledger: appendUniqueQuarantineLedgerEntry(result, {
        stage: "SCOPE",
        verdict: "UNKNOWN",
        reasonCode: LEGACY_VERIFIED_PHYSICAL_IDENTITY_QUARANTINE_REASON,
        message:
          "The legacy VERIFIED row lacks an exact physical-CD release day or CD format and remains pending authoritative evidence without inferred values.",
        sourceUrls: [],
        retryable: false,
        conflictIds: [],
      }),
    };
    assertCompletePersistedComprehensiveCandidateBinding(nextResult, sourceCandidate);
    return {
      result: nextResult,
      sourceCandidate,
      quarantine: "PHYSICAL_IDENTITY_INCOMPLETE",
    };
  }

  if (!exactDateMatches) {
    if (
      coverBinding.cover.coverMatchLevel !== "EDITION" ||
      !coverBinding.sourceDate
    ) {
      throw new TypeError(
        "A VERIFIED comprehensive candidate has an unsupported or incomplete cover-date inconsistency.",
      );
    }
    const nextCandidate = {
      ...result.candidate,
      coverImageUrl: null,
      coverImageSourceUrl: null,
    };
    const nextSourceCandidate: ComprehensiveDiscographyCandidate = {
      ...sourceCandidate,
      candidate: {
        ...sourceCandidate.candidate,
        coverImageUrl: null,
        coverImageSourceUrl: null,
      },
    };
    const nextResult: ComprehensiveCandidateResult = {
      ...result,
      candidate: nextCandidate,
      resolution: "PENDING_COVER",
      cover: {
        status: "MISSING",
        reasonCode: LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
        reason:
          "The persisted edition cover date does not match the candidate's exact release day; the stale cover was removed and only exact-source retry is allowed.",
        retryable: true,
      },
      ledger: appendUniqueQuarantineLedgerEntry(result, {
        stage: "COVER",
        verdict: "UNKNOWN",
        reasonCode: LEGACY_VERIFIED_COVER_DATE_QUARANTINE_REASON,
        message:
          "The persisted edition cover date does not match the candidate's exact release day; the stale cover was removed and only exact-source retry is allowed.",
        sourceUrls: [],
        retryable: true,
        conflictIds: [],
      }),
    };
    assertCompletePersistedComprehensiveCandidateBinding(nextResult, nextSourceCandidate);
    return {
      result: nextResult,
      sourceCandidate: nextSourceCandidate,
      quarantine: "COVER_DATE_MISMATCH",
    };
  }

  // A supposedly invalid VERIFIED row that matches neither supported legacy
  // pattern is not safe to rewrite. Re-run the publication assertion so the
  // caller receives the precise fail-closed reason.
  assertCompleteVerifiedComprehensiveCandidate(result, sourceCandidate);
  return { result, sourceCandidate, quarantine: null };
}

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function isGeneratedPipelineWarning(value: string) {
  return /^\d+ 个版本仍在等待权威证据，未作为错误删除。$/u.test(value) ||
    /^\d+ 个已确认版本仍在自动补封面，暂未进入最终结果。$/u.test(value) ||
    value === "最终列表仅包含 AI 证据裁决通过且封面已验证的条目；所有其他版本保留在审计账本。";
}

function sourceType(url: string): ReleaseResearchSource["sourceType"] {
  const host = new URL(url).hostname.toLowerCase();
  return host === "musicbrainz.org" || host.endsWith(".discogs.com") ||
    host === "ndlsearch.ndl.go.jp" || host === "coverartarchive.org"
    ? "database"
    : "official";
}

function sourceTitle(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "ndlsearch.ndl.go.jp") return "日本国立国会图书馆书目";
  if (host.endsWith(".discogs.com")) return "Discogs release";
  if (host === "musicbrainz.org") return "MusicBrainz";
  return "官方发行目录";
}

export function mergeComprehensiveEvidenceSources(
  candidate: ReleaseResearchCandidate,
  result: ComprehensiveCandidateResult,
) {
  const ledgerUrls = result.ledger.flatMap((entry) => entry.sourceUrls);
  const existing = new Map(candidate.sources.map((source) => [source.url, source]));
  for (const url of uniqueStrings(ledgerUrls)) {
    if (existing.has(url)) continue;
    try {
      existing.set(url, { title: sourceTitle(url), url, sourceType: sourceType(url) });
    } catch {
      // The source adapters already reject malformed URLs. A malformed value in
      // a persisted legacy result is not copied into a new attestation.
    }
  }
  return [...existing.values()];
}

function partialDateRange(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  const start = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  const end = day !== null
    ? start
    : month !== null
      ? Date.UTC(year, month, 0)
      : Date.UTC(year, 11, 31);
  return { start, end, precision: day !== null ? 3 : month !== null ? 2 : 1 };
}

function selectedEditionSort(left: ComprehensiveCandidateResult, right: ComprehensiveCandidateResult) {
  const leftDate = partialDateRange(left.candidate.releaseDate);
  const rightDate = partialDateRange(right.candidate.releaseDate);
  if (leftDate && rightDate) {
    if (leftDate.end < rightDate.start) return -1;
    if (rightDate.end < leftDate.start) return 1;
    const precisionOrder = rightDate.precision - leftDate.precision;
    if (precisionOrder) return precisionOrder;
  } else if (leftDate || rightDate) {
    return leftDate ? -1 : 1;
  }
  const catalogOrder = Number(Boolean(right.candidate.catalogNumber)) - Number(Boolean(left.candidate.catalogNumber));
  if (catalogOrder) return catalogOrder;
  return left.editionId.localeCompare(right.editionId);
}

export function selectVerifiedComprehensiveEditions(
  request: ReleaseResearchRequest,
  results: readonly ComprehensiveCandidateResult[],
) {
  const verified = results.filter((result) => result.resolution === "VERIFIED");
  if (!request.excludeReissues && request.target !== "ORIGINAL_CD") {
    return new Set(verified.map((result) => result.candidate.id));
  }
  const byWork = new Map<string, ComprehensiveCandidateResult[]>();
  // Selection must only rank editions that are actually eligible for the
  // final list. Ranking every evidence-approved edition first can choose a
  // PENDING_COVER row and then drop the whole work even though a later,
  // fully verified CD edition is available for the same canonical work.
  for (const result of verified) {
    const values = byWork.get(result.workId) ?? [];
    values.push(result);
    byWork.set(result.workId, values);
  }
  return new Set([...byWork.values()]
    .map((values) => [...values].sort(selectedEditionSort)[0]!)
    .map((result) => result.candidate.id));
}

function attestedCandidate(
  result: ComprehensiveCandidateResult,
  now: Date,
): ReleaseResearchCandidate {
  assertCompleteVerifiedComprehensiveCandidate(result);
  if (result.cover?.status !== "FOUND") {
    throw new TypeError("A verified comprehensive candidate requires a supported validated cover provider.");
  }
  const sources = mergeComprehensiveEvidenceSources(result.candidate, result);
  const authoritySourceUrls = uniqueStrings(result.ledger
    .filter((entry) => entry.stage === "AUTHORITATIVE" && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const corroboratingSourceUrls = uniqueStrings(result.ledger
    .filter((entry) => ["MUSICBRAINZ", "CORROBORATION"].includes(entry.stage) && entry.verdict === "PASS")
    .flatMap((entry) => entry.sourceUrls));
  const sourceUrls = uniqueStrings([...authoritySourceUrls, ...corroboratingSourceUrls]);
  const verification: ReleaseVerification = {
    status: "VERIFIED",
    method: "multi-source-v2",
    policyVersion: "multi-source-v2",
    aiDecision: "ACCEPT",
    aiReason: result.aiDecision?.reason ?? "Independent source evidence is consistent.",
    checkedAt: now.toISOString(),
    matchedFields: uniqueStrings([
      "artist",
      "title",
      result.candidate.releaseDate ? "date" : null,
      result.candidate.catalogNumber ? "catalogNumber" : null,
      result.candidate.barcode ? "barcode" : null,
      result.candidate.format ? "format" : null,
    ]),
    sourceUrls,
    authoritySourceUrls,
    corroboratingSourceUrls,
    workId: result.workId,
    editionId: result.editionId,
    coverProvider: result.cover.provider as ReleaseVerification["coverProvider"],
    coverCheckedAt: result.cover.checkedAt ?? now.toISOString(),
    ...(result.cover.contentSha256
      ? { coverContentSha256: result.cover.contentSha256 }
      : {}),
    coverMatchLevel: result.cover.coverMatchLevel,
    sourceReleaseDate: result.cover.sourceReleaseDate,
  };
  return {
    ...result.candidate,
    workId: result.workId,
    editionId: result.editionId,
    confidence: "HIGH",
    sources,
    verification,
  };
}

function auditView(
  result: ComprehensiveCandidateResult,
  selectedIds: ReadonlySet<string>,
): ReleaseResearchCandidateAudit {
  const superseded = result.resolution === "VERIFIED" && !selectedIds.has(result.candidate.id);
  return {
    candidateId: result.candidate.id,
    workId: result.workId,
    editionId: result.editionId,
    title: result.candidate.title,
    category: result.candidate.category,
    originalReleaseDate: result.candidate.originalReleaseDate,
    releaseDate: result.candidate.releaseDate,
    catalogNumber: result.candidate.catalogNumber,
    resolution: superseded ? "OUT_OF_SCOPE" : result.resolution,
    evidenceVerdict: superseded ? "OUT_OF_SCOPE" : result.evidenceVerdict,
    ledger: superseded
      ? [...result.ledger, {
          stage: "SELECTION",
          verdict: "OUT_OF_SCOPE",
          reasonCode: "LATER_EDITION_NOT_SELECTED",
          message: "The edition remains in the audit ledger but the requested scope keeps one verified edition per work.",
          sourceUrls: [],
          retryable: false,
          conflictIds: [],
        }]
      : result.ledger,
  };
}

export type ComprehensiveAttestationDate =
  | Date
  | ((result: ComprehensiveCandidateResult) => Date);

function attestationDateForResult(
  value: ComprehensiveAttestationDate,
  result: ComprehensiveCandidateResult,
) {
  const date = typeof value === "function" ? value(result) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("A verified comprehensive candidate requires a valid attestation timestamp.");
  }
  return date;
}

export function buildComprehensiveReleaseResearchResult(
  request: ReleaseResearchRequest,
  base: ReleaseResearchResult,
  bundle: ArtistReleaseEvidenceBundle,
  output: ComprehensiveDiscographyOutput,
  now: ComprehensiveAttestationDate = new Date(),
): ReleaseResearchResult {
  output.results.forEach((result) => assertCompleteVerifiedComprehensiveCandidate(result));
  const selectedIds = selectVerifiedComprehensiveEditions(request, output.results);
  const releases = output.results
    .filter((result) => selectedIds.has(result.candidate.id))
    .map((result) => attestedCandidate(
      result,
      attestationDateForResult(now, result),
    ))
    .sort((left, right) =>
      (left.originalReleaseDate ?? left.releaseDate ?? "9999").localeCompare(
        right.originalReleaseDate ?? right.releaseDate ?? "9999",
      ) || left.title.localeCompare(right.title, "und"));
  const verificationCandidates = output.results.map((result) => auditView(result, selectedIds));
  const selectedWorks = new Set(releases.map((release) => release.workId).filter(Boolean));
  const pendingEvidence = verificationCandidates.filter((item) => item.resolution === "PENDING_EVIDENCE").length;
  const pendingCover = verificationCandidates.filter((item) => item.resolution === "PENDING_COVER").length;
  return {
    ...base,
    releases,
    pipelineVersion: "multi-source-v2",
    verificationCandidates,
    globalWarnings: uniqueStrings([
      ...base.globalWarnings.filter((warning) => !isGeneratedPipelineWarning(warning)),
      pendingEvidence > 0 ? `${pendingEvidence} 个版本仍在等待权威证据，未作为错误删除。` : null,
      pendingCover > 0 ? `${pendingCover} 个已确认版本仍在自动补封面，暂未进入最终结果。` : null,
      "最终列表仅包含 AI 证据裁决通过且封面已验证的条目；所有其他版本保留在审计账本。",
    ]),
    verificationSummary: {
      rawReleases: bundle.stats.releasesFetched,
      releaseGroups: new Set(output.results.map((result) => result.workId)).size,
      canonicalEditions: bundle.stats.releasesAcceptedBeforeGrouping ?? base.releases.length,
      authoritativeMatches: output.results.filter((result) => result.ledger.some((entry) =>
        entry.stage === "AUTHORITATIVE" && entry.verdict === "PASS")).length,
      crossSourceMatches: output.summary.evidenceReadyForAi,
      aiAccepted: output.summary.aiAccepted,
      rejectedByEvidence: output.summary.rejected,
      rejectedByAi: output.results.filter((result) => result.aiDecision?.decision === "REJECT").length,
      rejectedWithoutCover: output.summary.pendingCover,
      rejectedCoverUnavailable: output.results.filter((result) =>
        result.resolution === "PENDING_COVER" && result.cover?.status === "UNAVAILABLE").length,
      discoveredEditions: output.summary.totalCandidates,
      evidenceReady: output.summary.evidenceReadyForAi,
      verified: releases.length,
      pendingEvidence,
      pendingCover,
      rejected: output.summary.rejected,
      outOfScope: verificationCandidates.filter((item) => item.resolution === "OUT_OF_SCOPE").length,
      verifiedWorks: selectedWorks.size,
    },
  };
}
