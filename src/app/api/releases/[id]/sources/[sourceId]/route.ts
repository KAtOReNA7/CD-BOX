import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteReleaseSource } from "@/lib/releases/release-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const { id, sourceId } = await params;
    await deleteReleaseSource(id, sourceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source deletion failed." },
      { status: 400 },
    );
  }
}
