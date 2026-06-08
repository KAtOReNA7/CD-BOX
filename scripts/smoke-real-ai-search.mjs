import { pathToFileURL } from "node:url";
import path from "node:path";

const { createWebSearchResponse, aiConfig } = await import(pathToFileURL(path.resolve("src/lib/ai/client.ts")));
const { parseReleaseResearchResponse } = await import(pathToFileURL(path.resolve("src/lib/ai/release-research-parser.ts")));
const { summarizeResearchQuality } = await import(pathToFileURL(path.resolve("src/lib/ai/release-research-quality.ts")));

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing. Set it before running the real AI smoke test.");
}

const userPrompt = `Research physical CD releases for:
Artist: Miho Nakayama / 中山美穂
Country/region: Japan
Collection scope: ORIGINAL_CD
Exclude reissues: true
Include collaborations: true
Include Live / Remix / Best: true

Use official discography and label/retailer/database sources. Do not use Wikipedia as the only source.
Return strict JSON using the CD-BOX release research schema.`;

const response = await createWebSearchResponse({
  forceSearch: true,
  systemPrompt:
    "You are a meticulous discography researcher for physical CD collectors. Use web_search and return strict JSON only.",
  userPrompt,
});

const text =
  response.output_text ??
  response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n") ??
  "";
const parsed = parseReleaseResearchResponse(text);
const summary = summarizeResearchQuality(parsed.releases);
const confidence = parsed.releases.reduce(
  (acc, release) => {
    acc[release.confidence] += 1;
    return acc;
  },
  { HIGH: 0, MEDIUM: 0, LOW: 0 },
);

console.log(
  JSON.stringify(
    {
      model: aiConfig.textModel,
      artist: parsed.artist,
      totalCandidates: parsed.releases.length,
      confidence,
      missingCatalog: summary.missingCatalog,
      missingReleaseDate: parsed.releases.filter((release) => !release.originalReleaseDate && !release.releaseDate).length,
      missingSources: summary.missingSources,
      defaultExcluded: summary.defaultExcluded,
      collaborationCredits: parsed.releases
        .filter((release) => /&|and|WANDS/i.test(release.artistCredit))
        .map((release) => release.artistCredit),
      coverImageUrlCount: parsed.releases.filter((release) => release.coverImageUrl).length,
      coverImageSourceUrlCount: parsed.releases.filter((release) => release.coverImageSourceUrl).length,
      globalWarnings: parsed.globalWarnings,
    },
    null,
    2,
  ),
);
