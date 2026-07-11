import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageOwner } from "@/lib/auth/current-user";
import { getDashboardStats, listDashboardArtists } from "@/lib/services/artists";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePageOwner();
  const [artists, stats] = await Promise.all([listDashboardArtists(), getDashboardStats()]);

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Collection Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold">收藏库总览</h1>
        </div>
        <Button asChild>
          <Link href="/artists/new" className="gap-2">
            <Plus className="size-4" />
            新建艺人库
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">艺人库</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.artistCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">发行条目</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.releaseCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">关注关系</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.followCount}</CardContent>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">最近艺人库</h2>
        <div className="grid gap-3">
          {artists.length === 0 ? (
            <div className="border bg-white p-8 text-sm text-muted-foreground">
              还没有艺人库。先创建一个艺人，再导入 Excel 模板中的发行数据。
            </div>
          ) : (
            artists.map((artist) => (
              <Link
                key={artist.id}
                href={`/artists/${artist.id}`}
                className="flex items-center justify-between border bg-white p-4 transition hover:bg-stone-100"
              >
                <div>
                  <h3 className="font-medium">{artist.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{artist.country ?? "国家/地区未填写"}</p>
                </div>
                <span className="text-sm text-muted-foreground">{artist._count.releases} 条已核验发行</span>
              </Link>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
