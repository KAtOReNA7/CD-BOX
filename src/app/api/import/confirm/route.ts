import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { confirmImport, normalizeDuplicateStrategy } from "@/lib/import/import-service";
import type { ImportConfirmInput } from "@/lib/import/import-types";

export async function POST(request: Request) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;
  const userId = auth.owner.id;

  try {
    const body = (await request.json()) as ImportConfirmInput;
    const result = await confirmImport(
      {
        fileName: body.fileName,
        artist: body.artist,
        rows: body.rows,
        duplicateStrategy: normalizeDuplicateStrategy(body.duplicateStrategy),
      },
      userId,
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "确认导入失败" },
      { status: 400 },
    );
  }
}
