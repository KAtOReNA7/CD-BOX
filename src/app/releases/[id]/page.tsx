import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { getReleaseDetail } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = await getReleaseDetail(id);

  if (!release) {
    notFound();
  }

  return (
    <AppShell>
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <div className="flex aspect-square items-center justify-center overflow-hidden border bg-white">
          {release.coverImageUrl ? (
            <Image
              src={release.coverImageUrl}
              alt={`${release.title} cover`}
              width={220}
              height={220}
              unoptimized
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-stone-100 text-sm text-muted-foreground">
              No cover
            </div>
          )}
        </div>
        <div>
          <Link href={`/artists/${release.artistId}`} className="text-sm font-medium text-muted-foreground">
            {release.artist.name}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold">{release.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{release.category}</Badge>
            <Badge variant="outline">{release.format}</Badge>
            {release.originalCatalogNo ? <Badge variant="outline">{release.originalCatalogNo}</Badge> : null}
          </div>
          <dl className="mt-8 grid gap-4 border bg-white p-6 text-sm md:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">原版发行日</dt>
              <dd className="mt-1">{release.originalReleaseDate?.toISOString().slice(0, 10) ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">厂牌</dt>
              <dd className="mt-1">{release.label ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">是否再版</dt>
              <dd className="mt-1">{release.isReissue ? "是" : "否"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">收藏状态</dt>
              <dd className="mt-1">{release.userStatus[0]?.status ?? "UNKNOWN"}</dd>
            </div>
          </dl>
          <section className="mt-6 border bg-white p-6">
            <h2 className="font-semibold">来源 URL</h2>
            <div className="mt-4 grid gap-3">
              {release.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无来源 URL。</p>
              ) : (
                release.sources.map((source) => (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-4 border p-3 text-sm hover:bg-stone-100"
                  >
                    <span className="truncate">{source.url}</span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
