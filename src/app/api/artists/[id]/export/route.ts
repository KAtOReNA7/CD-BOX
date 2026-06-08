import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { buildReleaseExportBuffer, exportFileName } from "@/lib/releases/release-export";
import { getArtistLibrary } from "@/lib/releases/release-service";
import type { ReleaseFilters } from "@/lib/releases/release-types";

function filtersFromUrl(url: string): ReleaseFilters {
  const params = new URL(url).searchParams;
  return Object.fromEntries(params.entries()) as ReleaseFilters;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await params;
  const filters = filtersFromUrl(request.url);
  const scope = new URL(request.url).searchParams.get("scope");
  const library = await getArtistLibrary(id, userId, scope === "filtered" ? filters : {});

  if (!library) {
    return NextResponse.json({ error: "Artist not found." }, { status: 404 });
  }

  const rows = scope === "filtered" ? library.filteredReleases : library.releases;
  const buffer = buildReleaseExportBuffer(rows);
  const fileName = exportFileName(library.artist.name);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
