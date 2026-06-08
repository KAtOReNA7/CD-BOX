import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const { structurePastedSourceText } = await import(pathToFileURL(path.resolve("src/lib/ai/release-structure.ts")));
const { summarizeResearchQuality } = await import(pathToFileURL(path.resolve("src/lib/ai/release-research-quality.ts")));

const fixturesDir = path.resolve("sample-data", "pasted-sources");
const fixtureFiles = fs.readdirSync(fixturesDir).filter((file) => file.endsWith(".txt")).sort();

if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_TEXT_MODEL) {
  throw new Error("Missing AI relay configuration. Configure .env.local before running smoke:pasted-structure.");
}

function sourceUrlFromText(text) {
  return text.match(/Source URL:\s*(https?:\/\/\S+)/)?.[1] ?? null;
}

function confidenceCounts(releases) {
  return releases.reduce(
    (acc, release) => {
      acc[release.confidence] += 1;
      return acc;
    },
    { HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
}

const aggregate = {
  fixtures: fixtureFiles.length,
  candidates: 0,
  confidence: { HIGH: 0, MEDIUM: 0, LOW: 0 },
  missingCatalog: 0,
  missingReleaseDate: 0,
  missingSources: 0,
  defaultExcluded: 0,
  generatedCoverImageUrl: false,
  inventedCoverImageUrl: false,
  noExplicitSourceWarning: false,
  claimedOnlineSearch: false,
};

for (const file of fixtureFiles) {
  const sourceText = fs.readFileSync(path.join(fixturesDir, file), "utf8");
  const sourceUrl = sourceUrlFromText(sourceText);
  let structured;
  let lastError;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        structured = await structurePastedSourceText({
          artistName: "中山美穂",
          country: "Japan",
          target: "ORIGINAL_CD",
          excludeReissues: true,
          includeCollaborations: true,
          includeLiveRemixBest: true,
          sourceText,
          sourceUrl,
          defaultCoverSourceUrl: null,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!structured) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          fixture: file,
          ok: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    continue;
  }

  const releases = structured.parsed.releases;
  const summary = summarizeResearchQuality(releases);
  const confidence = confidenceCounts(releases);
  const claimedOnlineSearch = structured.rawText.toLowerCase().includes("web search") ||
    structured.rawText.toLowerCase().includes("searched online");
  const explicitUrls = new Set([...sourceText.matchAll(/https?:\/\/[^\s"'<>),\]]+/g)].map((match) => match[0]));
  if (sourceUrl) explicitUrls.add(sourceUrl);
  const inventedCover = releases.some((release) => release.coverImageUrl && !explicitUrls.has(release.coverImageUrl));

  aggregate.candidates += releases.length;
  aggregate.confidence.HIGH += confidence.HIGH;
  aggregate.confidence.MEDIUM += confidence.MEDIUM;
  aggregate.confidence.LOW += confidence.LOW;
  aggregate.missingCatalog += summary.missingCatalog;
  aggregate.missingReleaseDate += releases.filter((release) => !release.originalReleaseDate && !release.releaseDate).length;
  aggregate.missingSources += summary.missingSources;
  aggregate.defaultExcluded += summary.defaultExcluded;
  aggregate.generatedCoverImageUrl ||= releases.some((release) => release.coverImageUrl);
  aggregate.inventedCoverImageUrl ||= inventedCover;
  aggregate.noExplicitSourceWarning ||= releases.some((release) =>
    release.warnings.some((warning) => warning.includes("no explicit source url")),
  );
  aggregate.claimedOnlineSearch ||= claimedOnlineSearch;

  console.log(
    JSON.stringify(
      {
        fixture: file,
        candidates: releases.length,
        confidence,
        missingCatalog: summary.missingCatalog,
        missingReleaseDate: releases.filter((release) => !release.originalReleaseDate && !release.releaseDate).length,
        missingSources: summary.missingSources,
        defaultExcluded: summary.defaultExcluded,
        hasCoverImageUrl: releases.some((release) => release.coverImageUrl),
        inventedCoverImageUrl: inventedCover,
        noExplicitSourceWarning: releases.some((release) =>
          release.warnings.some((warning) => warning.includes("no explicit source url")),
        ),
        claimedOnlineSearch,
        firstFive: releases.slice(0, 5).map((release) => ({
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
          coverImageUrl: release.coverImageUrl,
        })),
      },
      null,
      2,
    ),
  );
}

console.log(JSON.stringify({ aggregate }, null, 2));
