import { z } from "zod";
import type { ReleaseResearchResult } from "@/lib/ai/release-research-types";

const categorySchema = z
  .enum(["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"])
  .catch("OTHER");

const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]).catch("LOW");

const sourceSchema = z.object({
  title: z.string().catch("Untitled source"),
  url: z.string().url(),
  sourceType: z.enum(["official", "retailer", "database", "news", "other"]).catch("other"),
});

const releaseSchema = z.object({
  title: z.string().min(1),
  titleOriginal: z.string().nullable().catch(null),
  category: categorySchema,
  artistCredit: z.string().min(1),
  releaseDate: z.string().nullable().catch(null),
  originalReleaseDate: z.string().nullable().catch(null),
  format: z.string().nullable().catch(null),
  catalogNumber: z.string().nullable().catch(null),
  barcode: z.string().nullable().catch(null),
  label: z.string().nullable().catch(null),
  originalPrice: z.string().nullable().catch(null),
  editionType: z.string().nullable().catch(null),
  isReissue: z.boolean().nullable().catch(null),
  isRemaster: z.boolean().nullable().catch(null),
  isExcludedByDefault: z.boolean().catch(false),
  coverImageUrl: z.string().url().nullable().catch(null),
  coverImageSourceUrl: z.string().url().nullable().catch(null),
  notes: z.string().nullable().catch(null),
  confidence: confidenceSchema,
  warnings: z.array(z.string()).catch([]),
  sources: z.array(sourceSchema).catch([]),
});

const resultSchema = z.object({
  artist: z.object({
    name: z.string().min(1),
    nameKana: z.string().nullable().catch(null),
    nameRomaji: z.string().nullable().catch(null),
    country: z.string().min(1),
    officialSiteUrl: z.string().url().nullable().catch(null),
  }),
  collectionScope: z.object({
    target: z.enum(["ORIGINAL_CD", "ALL_CD", "ALL_PHYSICAL"]),
    excludeReissues: z.boolean(),
    includeCollaborations: z.boolean(),
  }),
  releases: z.array(releaseSchema),
  globalWarnings: z.array(z.string()).catch([]),
});

export function extractFirstJsonObject(text: string) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = codeBlock?.[1] ?? text;
  const start = source.indexOf("{");

  if (start < 0) {
    throw new Error("No JSON object found in model output.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unclosed JSON object in model output.");
}

export function parseReleaseResearchResponse(text: string): ReleaseResearchResult {
  const jsonText = extractFirstJsonObject(text);
  const json = JSON.parse(jsonText);
  const parsed = resultSchema.parse(json);

  return {
    ...parsed,
    releases: parsed.releases.map((release, index) => {
      const warnings = [...release.warnings];
      let confidence = release.confidence;

      if (!release.catalogNumber) {
        confidence = "LOW";
        if (!warnings.some((warning) => warning.includes("catalogNumber"))) {
          warnings.push("PENDING_REVIEW: missing catalogNumber.");
        }
      }

      if (release.sources.length === 0) {
        if (!warnings.some((warning) => warning.includes("source"))) {
          warnings.push("PENDING_REVIEW: no source URL provided.");
        }
      }

      if (release.isReissue === true && parsed.collectionScope.excludeReissues) {
        return {
          ...release,
          id: `candidate-${index + 1}`,
          confidence,
          warnings,
          isExcludedByDefault: true,
        };
      }

      return {
        ...release,
        id: `candidate-${index + 1}`,
        confidence,
        warnings,
      };
    }),
  };
}
