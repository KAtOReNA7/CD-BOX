import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { addReleaseSource } from "@/lib/releases/release-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await params;
    const body = (await request.json()) as { url?: string; label?: string | null };
    const source = await addReleaseSource(id, { url: body.url ?? "", label: body.label });
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source creation failed." },
      { status: 400 },
    );
  }
}
