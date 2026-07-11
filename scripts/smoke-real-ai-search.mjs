import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

const envDebug = loadLocalEnv();
const apiKey = process.env.OPENAI_API_KEY;

function sanitize(message) {
  const text = String(message);
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}

if (!apiKey || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_TEXT_MODEL) {
  console.log(JSON.stringify({
    ok: false,
    reason: "Missing OPENAI_API_KEY, OPENAI_BASE_URL, or OPENAI_TEXT_MODEL.",
    debug: envDebug,
  }, null, 2));
  process.exit(1);
}

if (process.env.AI_CHAT_COMPLETIONS_SUPPORTED === "false") {
  throw new Error("The configured relay is explicitly marked as not supporting Chat Completions.");
}

const { researchPublicMetadataReleases } = await import(
  pathToFileURL(path.resolve("src/lib/ai/public-metadata-research.ts"))
);
const { enrichReleaseResearchResultWithItunes } = await import(
  pathToFileURL(path.resolve("src/lib/ai/itunes-enrichment.ts"))
);
const { summarizeResearchQuality } = await import(
  pathToFileURL(path.resolve("src/lib/ai/release-research-quality.ts"))
);

try {
  const research = await researchPublicMetadataReleases({
    artistName: "中山美穂",
    country: "Japan",
    target: "ORIGINAL_CD",
    excludeReissues: true,
    includeCollaborations: true,
    includeLiveRemixBest: true,
  });
  const result = await enrichReleaseResearchResultWithItunes(research.result, {
    artistQuery: "中山美穂",
  });
  const quality = summarizeResearchQuality(result.releases);

  console.log(JSON.stringify({
    ok: result.releases.length > 0,
    mode: research.mode,
    model: process.env.OPENAI_TEXT_MODEL,
    organizerStatus: research.organizer.status,
    artist: result.artist,
    evidenceStats: research.evidence.stats,
    totalCandidates: result.releases.length,
    quality,
    coverCount: result.releases.filter((release) => release.coverImageUrl).length,
    sourceCount: result.releases.reduce((count, release) => count + release.sources.length, 0),
    globalWarnings: result.globalWarnings,
    firstTen: result.releases.slice(0, 10).map((release) => ({
      title: release.title,
      category: release.category,
      artistCredit: release.artistCredit,
      releaseDate: release.releaseDate,
      originalReleaseDate: release.originalReleaseDate,
      format: release.format,
      catalogNumber: release.catalogNumber,
      label: release.label,
      confidence: release.confidence,
      sources: release.sources.map((source) => source.url),
      coverImageUrl: release.coverImageUrl,
    })),
  }, null, 2));

  if (result.releases.length === 0) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    errorType: error?.name ?? "Error",
    errorMessage: sanitize(error?.message ?? error).slice(0, 1_000),
    note: "No credential was printed and no unsupported chat-only result was presented as web evidence.",
  }, null, 2));
  process.exitCode = 1;
}
