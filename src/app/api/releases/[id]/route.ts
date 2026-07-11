import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { parseReleasePatchInput, updateRelease } from "@/lib/releases/release-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updateRelease(id, auth.owner.id, parseReleasePatchInput(body));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Release update failed." },
      { status: 400 },
    );
  }
}
