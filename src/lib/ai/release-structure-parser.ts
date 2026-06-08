import { extractFirstJsonObject, parseReleaseResearchResponse } from "@/lib/ai/release-research-parser";
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

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function rowText(row: Record<string, unknown>) {
  return [
    row.title,
    row.titleOriginal,
    row.category,
    row.format,
    row.editionType,
    row.notes,
    row.label,
  ]
    .map(textValue)
    .join(" ");
}

function inferCategory(row: Record<string, unknown>, sourceText: string) {
  const current = textValue(row.category).toUpperCase();
  const title = textValue(row.title);
  const text = `${rowText(row)} ${sourceText}`.toLowerCase();

  if (/collection|best|ベスト|精选|精選|合集/.test(`${title} ${text}`)) {
    return current === "BEST" ? "BEST" : "COLLECTION";
  }
  if (/live|ライブ|现场|現場/.test(text)) return "LIVE";
  if (/remix|リミックス|混音/.test(text)) return "REMIX";
  if (/\bbox\b|box set/.test(text)) return "BOX";
  if (/8cmcd|cdシングル|\bsingle\b|シングル/.test(text)) return "SINGLE";
  if (/original album|studio album|オリジナル.?アルバム|原创专辑|原創專輯/.test(text)) {
    return "ORIGINAL_ALBUM";
  }

  return current || "OTHER";
}

function inferReissue(row: Record<string, unknown>) {
  if (typeof row.isReissue === "boolean") return row.isReissue;
  const text = rowText(row);
  if (/再発|復刻|リマスター|reissue|remaster/i.test(text)) return true;
  return row.isReissue ?? null;
}

export function parseReleaseStructureResponse(text: string, request: ReleaseStructureRequest): ReleaseStructureResult {
  const raw = JSON.parse(extractFirstJsonObject(text)) as Record<string, unknown>;
  const rawReleases = Array.isArray(raw.releases) ? raw.releases : [];
  const rawArtist = typeof raw.artist === "object" && raw.artist ? (raw.artist as Record<string, unknown>) : {};
  const rawScope =
    typeof raw.collectionScope === "object" && raw.collectionScope
      ? (raw.collectionScope as Record<string, unknown>)
      : {};
  const normalizedInput = {
    ...raw,
    artist: {
      name: textValue(rawArtist.name) || request.artistName,
      nameKana: textValue(rawArtist.nameKana) || null,
      nameRomaji: textValue(rawArtist.nameRomaji) || null,
      country: textValue(rawArtist.country) || request.country,
      officialSiteUrl: textValue(rawArtist.officialSiteUrl) || null,
    },
    collectionScope: {
      target:
        rawScope.target === "ORIGINAL_CD" || rawScope.target === "ALL_CD" || rawScope.target === "ALL_PHYSICAL"
          ? rawScope.target
          : request.target,
      excludeReissues: typeof rawScope.excludeReissues === "boolean" ? rawScope.excludeReissues : request.excludeReissues,
      includeCollaborations:
        typeof rawScope.includeCollaborations === "boolean"
          ? rawScope.includeCollaborations
          : request.includeCollaborations,
    },
    globalWarnings: Array.isArray(raw.globalWarnings) ? raw.globalWarnings : [],
    releases: rawReleases.map((release) => {
      if (typeof release !== "object" || !release) return release;
      const row = release as Record<string, unknown>;
      return {
        ...row,
        category: inferCategory(row, request.sourceText),
        artistCredit: typeof row.artistCredit === "string" ? row.artistCredit : request.artistName,
        isReissue: inferReissue(row),
      };
    }),
  };
  const parsed = parseReleaseResearchResponse(JSON.stringify(normalizedInput), { applyQualityGates: false });
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
