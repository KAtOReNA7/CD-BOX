import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { bulkUpdateReleases, parseBulkUpdateInput } from "@/lib/releases/release-service";

export async function POST(request: Request) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;
  const userId = auth.owner.id;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await bulkUpdateReleases(userId, parseBulkUpdateInput(body));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk update failed." },
      { status: 400 },
    );
  }
}
