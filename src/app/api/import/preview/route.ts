import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/auth/current-user";
import { parseExcelBuffer } from "@/lib/import/excel-parser";
import { buildImportPreview } from "@/lib/import/import-service";
import type { ArtistImportTarget } from "@/lib/import/import-types";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function parseArtistTarget(formData: FormData): ArtistImportTarget {
  const mode = String(formData.get("artistMode") ?? "create");

  if (mode === "existing") {
    const artistId = String(formData.get("artistId") ?? "");
    if (!artistId) {
      throw new Error("请选择已有艺人库");
    }

    return {
      mode: "existing",
      artistId,
    };
  }

  const artistName = String(formData.get("artistName") ?? "").trim();
  if (!artistName) {
    throw new Error("请输入新建艺人名称");
  }

  return {
    mode: "create",
    artistName,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiOwner();
  if (!auth.authorized) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 .xlsx 文件" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "仅支持 .xlsx 文件" }, { status: 400 });
    }

    if (file.size === 0 || file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "文件必须大于 0 且不超过 10 MB" }, { status: 400 });
    }

    const artist = parseArtistTarget(formData);
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseExcelBuffer(buffer, file.name);
    const preview = await buildImportPreview({
      fileName: file.name,
      artist,
      rows,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入预览失败" },
      { status: 400 },
    );
  }
}
