import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { parseReleasePatchInput, updateRelease } from "@/lib/releases/release-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updateRelease(id, parseReleasePatchInput(body));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Release update failed." },
      { status: 400 },
    );
  }
}
