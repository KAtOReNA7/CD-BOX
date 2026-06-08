import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { ReleaseTable } from "@/components/app/release-table";
import { Badge } from "@/components/ui/badge";
import { getArtistWithReleases } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artist = await getArtistWithReleases(id);

  if (!artist) {
    notFound();
  }

  const sources = artist.releases.flatMap((release) =>
    release.sources.map((source) => ({ ...source, releaseTitle: release.title })),
  );

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Artist Library</p>
          <h1 className="mt-2 text-3xl font-semibold">{artist.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {artist.description ?? "该艺人库已准备好管理实体 CD 发行、真实封面 URL 和用户收藏状态。"}
          </p>
        </div>
        <Badge variant="secondary">{artist.releases.length} releases</Badge>
      </div>

      <ReleaseTable releases={artist.releases} />

      <section className="mt-8 border bg-white p-6">
        <h2 className="text-lg font-semibold">来源 URL</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          来源不在主表最后一列展示，但作为 ReleaseSource 独立保存，并在详情页集中查看。
        </p>
        <div className="mt-4 grid gap-3">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无来源 URL。</p>
          ) : (
            sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-4 border p-3 text-sm hover:bg-stone-100"
              >
                <span>
                  <span className="font-medium">{source.releaseTitle}</span>
                  <span className="ml-2 text-muted-foreground">{source.label ?? source.url}</span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
