import { z } from "zod";
import type {
  ReleaseResearchImportInput,
  ReleaseResearchRequest,
} from "@/lib/ai/release-research-types";

const candidateIdSchema = z.string().trim().min(1).max(120);
const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => (typeof value === "string" && value.length === 0 ? null : value));
const nullableIsoDate = z
  .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .refine(
    (value) =>
      value === null ||
      (!Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
        new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value),
    "Date must be a real calendar date in YYYY-MM-DD format.",
  );
const nullableHttpUrl = z
  .union([z.string().trim().url().max(2_048), z.null()])
  .refine((value) => value === null || /^https?:\/\//i.test(value), "URL must use HTTP or HTTPS.");

export const releaseResearchRequestSchema = z
  .object({
    artistName: z.string().trim().min(1).max(160),
    country: z.string().trim().min(1).max(80),
    target: z.enum(["ORIGINAL_CD", "ALL_CD", "ALL_PHYSICAL"]),
    excludeReissues: z.boolean(),
    includeCollaborations: z.boolean(),
    includeLiveRemixBest: z.boolean(),
  })
  .strict();

export const releaseResearchCandidateEditSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    category: z.enum([
      "ORIGINAL_ALBUM",
      "SINGLE",
      "BEST",
      "COLLECTION",
      "LIVE",
      "REMIX",
      "BOX",
      "EP",
      "OTHER",
    ]),
    artistCredit: z.string().trim().min(1).max(300),
    originalReleaseDate: nullableIsoDate,
    format: nullableText(80),
    catalogNumber: nullableText(120),
    label: nullableText(200),
    coverImageUrl: nullableHttpUrl,
    isReissue: z.boolean().nullable(),
    isRemaster: z.boolean().nullable(),
    notes: nullableText(4_000),
  })
  .strict();

export const releaseResearchImportInputSchema = z
  .object({
    artistMode: z.enum(["create", "existing"]),
    artistId: z.string().trim().min(1).max(120).optional(),
    artistName: z.string().trim().min(1).max(160).optional(),
    selectedCandidateIds: z.array(candidateIdSchema).max(1_000),
    excludedCandidateIds: z.array(candidateIdSchema).max(1_000),
    pendingReviewCandidateIds: z.array(candidateIdSchema).max(1_000),
    candidateEdits: z.record(candidateIdSchema, releaseResearchCandidateEditSchema).default({}),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.artistMode === "existing" && !input.artistId) {
      context.addIssue({ code: "custom", path: ["artistId"], message: "artistId is required." });
    }

    if (input.artistMode === "create" && !input.artistName) {
      context.addIssue({ code: "custom", path: ["artistName"], message: "artistName is required." });
    }

    const selected = new Set(input.selectedCandidateIds);
    if (selected.size !== input.selectedCandidateIds.length) {
      context.addIssue({
        code: "custom",
        path: ["selectedCandidateIds"],
        message: "Candidate IDs must be unique.",
      });
    }

    for (const [field, candidateIds] of [
      ["excludedCandidateIds", input.excludedCandidateIds],
      ["pendingReviewCandidateIds", input.pendingReviewCandidateIds],
      ["candidateEdits", Object.keys(input.candidateEdits)],
    ] as const) {
      if (candidateIds.some((candidateId) => !selected.has(candidateId))) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Only selected candidates may be changed.",
        });
      }
    }
  });

export function parseReleaseResearchRequest(input: unknown): ReleaseResearchRequest {
  return releaseResearchRequestSchema.parse(input);
}

export function parseReleaseResearchImportInput(input: unknown): ReleaseResearchImportInput {
  return releaseResearchImportInputSchema.parse(input);
}
