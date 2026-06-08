import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { createAndRunReleaseResearchTask } from "@/lib/ai/release-research";
import type { ReleaseResearchRequest } from "@/lib/ai/release-research-types";

export async function POST(request: Request) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return NextResponse.json({ error: "请先登录后再搜索发行资料" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ReleaseResearchRequest;
    const task = await createAndRunReleaseResearchTask(body, userId);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 搜索失败" },
      { status: 400 },
    );
  }
}
