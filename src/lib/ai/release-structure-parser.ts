import { parseReleaseResearchResponse } from "@/lib/ai/release-research-parser";
import type { ReleaseStructureRequest, ReleaseStructureResult } from "@/lib/ai/release-structure-types";
import type { ReleaseResearchSource } from "@/lib/ai/release-research-types";

const urlPattern = /https?:\/\/[^\s"'<>),\]]+/gi;

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeUrl(url: string) {
  return url.trim().replace(/[.。]+$/, "");
}

function sourceFromUrl(url: string): ReleaseResearchSource {
  return {
    title: url,
    url,
    sourceType: "other",
  };
}

export function extractExplicitUrls(text: string) {
  return unique(text.match(urlPattern) ?? []).map(normalizeUrl);
}

export function parseReleaseStructureResponse(text: string, request: ReleaseStructureRequest): ReleaseStructureResult {
  const parsed = parseReleaseResearchResponse(text, { applyQualityGates: false });
  const explicitSourceUrls = unique([
    ...extractExplicitUrls(request.sourceText),
    request.sourceUrl ? normalizeUrl(request.sourceUrl) : "",
  ]);
  const explicitCoverUrls = unique([
    ...extractExplicitUrls(request.defaultCoverSourceUrl ?? ""),
    request.defaultCoverSourceUrl ? normalizeUrl(request.defaultCoverSourceUrl) : "",
  ]);

  const normalized = {
    ...parsed,
    releases: parsed.releases.map((release) => {
      const allowedSourceUrls = unique([
        ...release.sources.map((source) => normalizeUrl(source.url)).filter((url) => explicitSourceUrls.includes(url)),
        ...explicitSourceUrls,
      ]);
      const warnings = [...release.warnings];

      if (allowedSourceUrls.length === 0 && !warnings.some((warning) => warning.includes("no explicit source url"))) {
        warnings.push("PENDING_REVIEW: no explicit source url.");
      }

      const coverImageUrl =
        release.coverImageUrl && explicitCoverUrls.includes(normalizeUrl(release.coverImageUrl))
          ? normalizeUrl(release.coverImageUrl)
          : null;
      const coverImageSourceUrl =
        release.coverImageSourceUrl && explicitCoverUrls.includes(normalizeUrl(release.coverImageSourceUrl))
          ? normalizeUrl(release.coverImageSourceUrl)
          : (explicitCoverUrls[0] ?? null);

      return {
        ...release,
        warnings,
        coverImageUrl,
        coverImageSourceUrl,
        sources: allowedSourceUrls.map(sourceFromUrl),
      };
    }),
    mode: "PASTED_SOURCE_STRUCTURING",
    sourceTextSummary: "Structured from user-pasted source text.",
    sourceLimitations:
      explicitSourceUrls.length === 0
        ? ["No explicit source URL was provided or found in the pasted text."]
        : [],
  };

  const gated = parseReleaseResearchResponse(JSON.stringify(normalized));

  return {
    ...gated,
    mode: "PASTED_SOURCE_STRUCTURING",
    sourceTextSummary: normalized.sourceTextSummary,
    sourceLimitations: normalized.sourceLimitations,
  };
}
