import { after, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import {
  createReleaseResearchTask,
  runReleaseResearchTask,
} from "@/lib/ai/release-research";
import { requireRuntimeAiProviderConfig } from "@/lib/ai/provider-capabilities";
import { parseReleaseResearchRequest } from "@/lib/ai/release-research-input";

export const maxDuration = 1_800;

export async function POST(request: Request) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;
  const userId = auth.owner.id;

  try {
    const input = parseReleaseResearchRequest(await request.json());
    const providerConfig = await requireRuntimeAiProviderConfig();
    const task = await createReleaseResearchTask(input, userId);

    after(async () => {
      try {
        await runReleaseResearchTask(task.id, input, providerConfig.apiKey);
      } catch {
        console.error("Background release research task failed", { taskId: task.id });
      }
    });

    return NextResponse.json(task, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 搜索失败" },
      { status: 400 },
    );
  }
}
