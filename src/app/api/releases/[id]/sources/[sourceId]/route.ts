import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { deleteReleaseSource } from "@/lib/releases/release-service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;

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
