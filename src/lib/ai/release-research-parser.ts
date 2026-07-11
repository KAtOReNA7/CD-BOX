import { z } from "zod";
import { applyResearchQualityGates } from "@/lib/ai/release-research-quality";
import type { ReleaseResearchResult } from "@/lib/ai/release-research-types";

const categorySchema = z
  .enum(["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"])
  .catch("OTHER");

const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]).catch("LOW");
const httpUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//i.test(value), "URL must use HTTP or HTTPS.");

const sourceSchema = z.object({
  title: z.string().catch("Untitled source"),
  url: httpUrlSchema,
  sourceType: z.enum(["official", "retailer", "database", "news", "other"]).catch("other"),
});

const verificationSchema = z.object({
  status: z.literal("VERIFIED"),
  method: z.literal("musicbrainz-ndl-discogs-ai"),
  aiDecision: z.literal("ACCEPT"),
  aiReason: z.string().min(1).max(1_000),
  checkedAt: z.string().datetime(),
  matchedFields: z.array(z.string().min(1).max(100)).min(1).max(20),
  sourceUrls: z.array(httpUrlSchema).min(2).max(20),
  coverProvider: z.enum(["cover-art-archive", "discogs"]),
  coverCheckedAt: z.string().datetime(),
});

const verificationSummarySchema = z.object({
  rawReleases: z.number().int().nonnegative(),
  releaseGroups: z.number().int().nonnegative(),
  canonicalEditions: z.number().int().nonnegative(),
  authoritativeMatches: z.number().int().nonnegative(),
  crossSourceMatches: z.number().int().nonnegative(),
  aiAccepted: z.number().int().nonnegative(),
  rejectedByEvidence: z.number().int().nonnegative(),
  rejectedByAi: z.number().int().nonnegative(),
  rejectedWithoutCover: z.number().int().nonnegative(),
  rejectedCoverUnavailable: z.number().int().nonnegative(),
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
  coverImageUrl: httpUrlSchema.nullable().catch(null),
  coverImageSourceUrl: httpUrlSchema.nullable().catch(null),
  notes: z.string().nullable().catch(null),
  confidence: confidenceSchema,
  warnings: z.array(z.string()).catch([]),
  sources: z.array(sourceSchema).catch([]),
  verification: verificationSchema.nullable().default(null).catch(null),
});

const resultSchema = z.object({
  artist: z.object({
    name: z.string().min(1),
    nameKana: z.string().nullable().catch(null),
    nameRomaji: z.string().nullable().catch(null),
    country: z.string().min(1),
    officialSiteUrl: httpUrlSchema.nullable().catch(null),
  }),
  collectionScope: z.object({
    target: z.enum(["ORIGINAL_CD", "ALL_CD", "ALL_PHYSICAL"]),
    excludeReissues: z.boolean(),
    includeCollaborations: z.boolean(),
  }),
  releases: z.array(releaseSchema),
  globalWarnings: z.array(z.string()).catch([]),
  verificationSummary: verificationSummarySchema.nullable().optional().catch(null),
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

export function parseReleaseResearchResponse(
  text: string,
  options: { applyQualityGates?: boolean } = {},
): ReleaseResearchResult {
  const jsonText = extractFirstJsonObject(text);
  const json = JSON.parse(jsonText);
  const parsed = resultSchema.parse(json);
  const result = {
    ...parsed,
    releases: parsed.releases.map((release, index) => ({
      ...release,
      id: `candidate-${index + 1}`,
      // A model cannot attest to its own verification. This is populated only
      // after deterministic cross-source checks and the separate AI audit.
      verification: null,
    })),
    verificationSummary: null,
  };

  return options.applyQualityGates === false ? result : applyResearchQualityGates(result);
}
