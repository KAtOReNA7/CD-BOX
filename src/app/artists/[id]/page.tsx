import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { ArtistStatsCards } from "@/components/app/artist-stats-cards";
import { ReleaseFilterPanel } from "@/components/app/release-filter-panel";
import { ReleaseTable } from "@/components/app/release-table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requirePageOwner } from "@/lib/auth/current-user";
import { getArtistLibrary } from "@/lib/releases/release-service";
import type { ReleaseFilters } from "@/lib/releases/release-types";

export const dynamic = "force-dynamic";

function normalizeSearchParams(params: Record<string, string | string[] | undefined>): ReleaseFilters {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]).filter(([, value]) => value),
  ) as ReleaseFilters;
}

export default async function ArtistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await requirePageOwner();
  const { id } = await params;
  const filters = normalizeSearchParams(await searchParams);
  const library = await getArtistLibrary(id, owner.id, filters);

  if (!library) {
    notFound();
  }

  const releaseTableKey = JSON.stringify(Object.entries(filters).sort(([left], [right]) => left.localeCompare(right)));

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Artist Library</p>
          <h1 className="mt-2 text-3xl font-semibold">{library.artist.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {library.artist.description ??
              "管理实体 CD 发行、收藏状态、真实封面 URL 和来源 URL。来源 URL 保留在详情页，不作为主表最后一列。"}
          </p>
        </div>
        <Badge variant="secondary">已核验 {library.releases.length} 条</Badge>
      </div>

      <div className="grid gap-6">
        {library.quarantinedCount > 0 ? (
          <Alert>
            <AlertTitle>{library.quarantinedCount} 条旧资料正在自动隔离</AlertTitle>
            <AlertDescription>
              这些条目尚未同时通过跨源核验和有效封面检查，因此不会进入最终收藏表或导出；重新执行联网搜索后，系统会自动核验并更新可确认的条目。
            </AlertDescription>
          </Alert>
        ) : null}
        <ArtistStatsCards stats={library.stats} />
        <ReleaseFilterPanel
          artistId={library.artist.id}
          filters={filters}
          filteredCount={library.filteredReleases.length}
          totalCount={library.releases.length}
        />
        <ReleaseTable
          key={releaseTableKey}
          artistId={library.artist.id}
          releases={library.filteredReleases}
          totalCount={library.releases.length}
        />
      </div>
    </AppShell>
  );
}
