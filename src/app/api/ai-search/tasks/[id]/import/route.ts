import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { importReleaseResearchCandidates } from "@/lib/ai/release-research";
import type { ReleaseResearchImportInput } from "@/lib/ai/release-research-types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;
  const userId = auth.owner.id;

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
