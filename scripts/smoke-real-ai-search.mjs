import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseProbeSummary(output) {
  const matches = [...output.matchAll(/\{\s*"baseUrlConfigured"[\s\S]*?\n\}/g)];
  if (matches.length === 0) {
    throw new Error("Could not parse probe:ai summary.");
  }
  return JSON.parse(matches[matches.length - 1][0]);
}

if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_TEXT_MODEL) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: "Missing OPENAI_API_KEY, OPENAI_BASE_URL, or OPENAI_TEXT_MODEL. Run npm run probe:ai after configuring the relay.",
        probeSummary: {
          baseUrlConfigured: Boolean(process.env.OPENAI_BASE_URL),
          textModel: process.env.OPENAI_TEXT_MODEL ?? null,
          imageModel: process.env.OPENAI_IMAGE_MODEL ?? null,
          textSupported: false,
          jsonSupported: false,
          responsesSupported: false,
          webSearchSupported: false,
          chatCompletionsSupported: false,
          imageModelConfigured: Boolean(process.env.OPENAI_IMAGE_MODEL),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

let probeSummary;
try {
  const output = execFileSync("npm", ["run", "probe:ai"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(output);
  probeSummary = parseProbeSummary(output);
} catch (error) {
  const stdout = error.stdout?.toString() ?? "";
  const stderr = error.stderr?.toString() ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  throw new Error("AI provider probe failed. Fix relay configuration before running real AI search smoke.");
}

if (!probeSummary.webSearchSupported) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: "webSearchSupported=false. The current relay cannot perform online release research.",
        probeSummary,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { createWebSearchResponse, aiConfig } = await import(pathToFileURL(path.resolve("src/lib/ai/client.ts")));
const { parseReleaseResearchResponse } = await import(pathToFileURL(path.resolve("src/lib/ai/release-research-parser.ts")));
const { summarizeResearchQuality } = await import(pathToFileURL(path.resolve("src/lib/ai/release-research-quality.ts")));

const userPrompt = `Research physical CD releases for:
Artist: Miho Nakayama / 中山美穂
Country/region: Japan
Collection scope: ORIGINAL_CD
Exclude reissues: true
Include collaborations: true
Include Live / Remix / Best: true

Use official discography and label/retailer/database sources. Do not use Wikipedia as the only source.
Return strict JSON using the CD-BOX release research schema.`;

try {
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
  const firstTen = parsed.releases.slice(0, 10).map((release) => ({
    title: release.title,
    category: release.category,
    artistCredit: release.artistCredit,
    releaseDate: release.originalReleaseDate ?? release.releaseDate,
    format: release.format,
    catalogNumber: release.catalogNumber,
    label: release.label,
    confidence: release.confidence,
    isExcludedByDefault: release.isExcludedByDefault,
    warnings: release.warnings,
    sourcesCount: release.sources.length,
  }));

  console.log(
    JSON.stringify(
      {
        aiSearchTaskCreated: false,
        taskStatus: "not-created-script-smoke",
        model: aiConfig.textModel,
        artist: parsed.artist,
        totalCandidates: parsed.releases.length,
        confidence,
        missingCatalog: summary.missingCatalog,
        missingReleaseDate: parsed.releases.filter((release) => !release.originalReleaseDate && !release.releaseDate).length,
        missingSources: summary.missingSources,
        defaultExcluded: summary.defaultExcluded,
        wikiOnly: parsed.releases.filter((release) => release.warnings.some((warning) => warning.includes("only wiki source"))).length,
        nonCdExcluded: parsed.releases.filter((release) => release.warnings.some((warning) => warning.includes("non-CD"))).length,
        reissueExcluded: parsed.releases.filter((release) => release.warnings.some((warning) => warning.includes("reissue"))).length,
        hasWandsArtistCredit: parsed.releases.some((release) => /WANDS/i.test(release.artistCredit)),
        coverImageUrlCount: parsed.releases.filter((release) => release.coverImageUrl).length,
        coverImageSourceUrlCount: parsed.releases.filter((release) => release.coverImageSourceUrl).length,
        firstTen,
        globalWarnings: parsed.globalWarnings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        errorType: error?.type ?? error?.name ?? "Error",
        errorMessage: String(error?.message ?? error),
        note: "No API key is printed. No fallback fake search was attempted.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
