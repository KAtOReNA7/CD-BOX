import type { CollectionScopeTarget, ReleaseResearchResult } from "@/lib/ai/release-research-types";

export type ReleaseStructureRequest = {
  artistName: string;
  country: string;
  target: CollectionScopeTarget;
  excludeReissues: boolean;
  includeCollaborations: boolean;
  includeLiveRemixBest: boolean;
  sourceText: string;
  sourceUrl: string | null;
  defaultCoverSourceUrl: string | null;
};

export type ReleaseStructureResult = ReleaseResearchResult & {
  mode: "PASTED_SOURCE_STRUCTURING";
  sourceTextSummary: string;
  sourceLimitations: string[];
};
