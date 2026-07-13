export {
  NDL_EVIDENCE_ROLE,
  NDL_SEARCH_API_URL,
  NDL_SEARCH_ATTRIBUTION,
  NDL_SEARCH_ORIGIN,
} from "@/lib/ndl/constants";
export {
  NdlSearchClient,
  buildNdlCatalogUrl,
  buildNdlInventoryUrl,
} from "@/lib/ndl/client";
export {
  canonicalNdlCatalogNumber,
  matchNdlCandidate,
  matchNdlCandidateForAiAudit,
  matchNdlCandidateForComprehensiveAudit,
  normalizedNdlCatalogKey,
} from "@/lib/ndl/matching";
export {
  NdlXmlError,
  parseNdlIssuedDate,
  parseNdlOpenSearchXml,
} from "@/lib/ndl/parser";
export {
  extractNdlSingleManifestTitles,
  fetchNdlSingleManifests,
} from "@/lib/ndl/single-manifest";
export type {
  NdlSingleManifestEvidence,
  NdlSingleManifestOptions,
  NdlSingleManifestResult,
} from "@/lib/ndl/single-manifest";
export type {
  NdlCandidate,
  NdlClientOptions,
  NdlClientResult,
  NdlDatePrecision,
  NdlEvidence,
  NdlFetch,
  NdlIdentifier,
  NdlMatchDecision,
  NdlMatchFailureReason,
  NdlRecord,
  NdlSearchResponse,
  NdlWarning,
  NdlWarningCode,
} from "@/lib/ndl/types";
