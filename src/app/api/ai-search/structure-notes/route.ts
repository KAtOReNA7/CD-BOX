import { NextResponse } from "next/server";
import { createAndRunReleaseStructureTask } from "@/lib/ai/release-structure";
import type { ReleaseStructureRequest } from "@/lib/ai/release-structure-types";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function POST(request: Request) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return NextResponse.json({ error: "Please sign in before structuring pasted source material." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ReleaseStructureRequest;

    if (!body.sourceText?.trim()) {
      return NextResponse.json({ error: "Pasted source text is required." }, { status: 400 });
    }

    const task = await createAndRunReleaseStructureTask(body, userId);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pasted source structuring failed." },
      { status: 400 },
    );
  }
}
