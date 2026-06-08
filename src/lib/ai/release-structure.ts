import type { AiSearchTask, Prisma } from "@prisma/client";
import { aiConfig, createTextResponse } from "@/lib/ai/client";
import { parseReleaseStructureResponse } from "@/lib/ai/release-structure-parser";
import type { ReleaseStructureRequest } from "@/lib/ai/release-structure-types";
import type { AiSearchTaskView, ReleaseResearchResult } from "@/lib/ai/release-research-types";
import { prisma } from "@/lib/db/prisma";

function toTaskView(task: AiSearchTask): AiSearchTaskView {
  return {
    id: task.id,
    status:
      task.status === "QUEUED"
        ? "pending"
        : task.status === "RUNNING"
          ? "running"
          : task.status === "SUCCEEDED"
            ? "succeeded"
            : "failed",
    query: task.query,
    model: task.model,
    errorMessage: task.errorMessage,
    rawResult: task.rawResult,
    parsedResult: task.parsedResult as ReleaseResearchResult | null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function outputTextFromResponse(response: unknown) {
  const maybe = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; output_text?: string; refusal?: string; content?: string }> }>;
  };
  if (maybe.output_text) return maybe.output_text;
  return (
    maybe.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? content.output_text ?? content.content ?? content.refusal)
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildPrompt(input: ReleaseStructureRequest) {
  return `Structure user-provided physical release data into CD-BOX candidates.

Mode: PASTED_SOURCE_STRUCTURING
Artist: ${input.artistName}
Country/region: ${input.country}
Collection scope: ${input.target}
Exclude reissues: ${input.excludeReissues}
Include collaborations: ${input.includeCollaborations}
Include Live / Remix / Best: ${input.includeLiveRemixBest}
User-provided source URL: ${input.sourceUrl ?? "none"}
User-provided cover source URL: ${input.defaultCoverSourceUrl ?? "none"}

Hard rules:
- Return one JSON object only. The first non-whitespace character must be "{" and the last must be "}".
- Do not wrap JSON in markdown. Do not add prose before or after JSON.
- Only structure facts present in the pasted text or explicit source URL fields.
- Do not browse the web. Do not claim online search.
- Do not invent source URLs.
- Do not invent coverImageUrl.
- If a field is not present, use null.
- Do not guess catalogNumber.
- Do not guess releaseDate.
- Preserve collaboration credits.
- Include every release-like row found in the pasted text, including reissues, remasters, LP, Vinyl, DVD, Blu-ray, and other non-CD rows.
- When a row is outside the collection scope, keep it as a candidate and set isExcludedByDefault=true with a warning instead of omitting it.
- If title is the same but catalogNumber differs, keep separate releases.
- If catalogNumber is the same but title differs, add a duplicate warning. Do not merge.
- artist must be an object, collectionScope must be an object, and every release must include artistCredit.
- Recognize Japanese physical CD clues: 発売日, 品番, 規格品番, CD, 8cmCD, CDシングル, 税込価格, レーベル, 初回限定盤, 通常盤, 再発, 復刻, リマスター, 廃盤.
- "廃盤" means out of print. It is not reissue/remaster by itself.
- "COLLECTION", "Best", "ベスト", "精选", and "合集" should be BEST or COLLECTION, not SINGLE.
- "8cmCD", "CDシングル", and "single" indicate SINGLE unless the title/source says COLLECTION, Best, Live, Remix, or Box.
- LP, Vinyl, レコード, Cassette, Tape, DVD, and Blu-ray are non-CD formats.

Return strict JSON matching the release research schema, plus:
{
  "mode": "PASTED_SOURCE_STRUCTURING",
  "sourceTextSummary": string,
  "sourceLimitations": string[]
}

Pasted text:
${input.sourceText}`;
}

export async function createAndRunReleaseStructureTask(input: ReleaseStructureRequest, userId: string) {
  const task = await prisma.aiSearchTask.create({
    data: {
      userId,
      query: JSON.stringify({ mode: "PASTED_SOURCE_STRUCTURING", ...input }),
      model: aiConfig.textModel,
      status: "QUEUED",
    },
  });

  await prisma.aiSearchTask.update({
    where: { id: task.id },
    data: { status: "RUNNING", errorMessage: null },
  });

  try {
    const structured = await structurePastedSourceText(input);
    const done = await prisma.aiSearchTask.update({
      where: { id: task.id },
      data: {
        status: "SUCCEEDED",
        rawResult: {
          outputText: structured.rawText,
          response: toJsonSafe(structured.response),
        } satisfies Prisma.InputJsonObject,
        parsedResult: toJsonSafe(structured.parsed),
      },
    });

    return toTaskView(done);
  } catch (error) {
    const failed = await prisma.aiSearchTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Pasted source structuring failed.",
      },
    });

    return toTaskView(failed);
  }
}

export async function structurePastedSourceText(input: ReleaseStructureRequest) {
  const response = await createTextResponse({
    systemPrompt:
      "You structure pasted release source material. You do not browse, search, or invent facts. Return strict JSON only.",
    userPrompt: buildPrompt(input),
  });
  const rawText = outputTextFromResponse(response);
  let parsed;
  try {
    parsed = parseReleaseStructureResponse(rawText, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse pasted source structuring response.";
    throw new Error(`${message} Raw output preview: ${rawText.slice(0, 500) || "<empty>"}`);
  }

  return {
    response,
    rawText,
    parsed,
  };
}
