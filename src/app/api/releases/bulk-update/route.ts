import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { bulkUpdateReleases, parseBulkUpdateInput } from "@/lib/releases/release-service";

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

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
