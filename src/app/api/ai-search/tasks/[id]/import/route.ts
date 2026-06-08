import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { importReleaseResearchCandidates } from "@/lib/ai/release-research";
import type { ReleaseResearchImportInput } from "@/lib/ai/release-research-types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return NextResponse.json({ error: "请先登录后再导入候选条目" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as ReleaseResearchImportInput;
    const result = await importReleaseResearchCandidates(id, userId, body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "候选导入失败" },
      { status: 400 },
    );
  }
}
