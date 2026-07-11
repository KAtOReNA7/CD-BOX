import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { getReleaseResearchTask } from "@/lib/ai/release-research";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;
  const userId = auth.owner.id;

  const { id } = await params;
  const task = await getReleaseResearchTask(id, userId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  return NextResponse.json(task);
}
