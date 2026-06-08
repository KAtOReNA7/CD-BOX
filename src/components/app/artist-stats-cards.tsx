import type { ArtistStats } from "@/lib/releases/release-types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border bg-white p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function ArtistStatsCards({ stats }: { stats: ArtistStats }) {
  return (
    <section className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="总条目" value={stats.total} />
        <Stat label="已拥有" value={stats.owned} />
        <Stat label="未拥有" value={stats.notOwned} />
        <Stat label="想买" value={stats.wanted} />
        <Stat label="完成率" value={`${stats.completionRate}%`} />
        <Stat label="待核对" value={stats.pendingReview} />
        <Stat label="排除" value={stats.excluded} />
        <Stat label="缺封面" value={stats.missingCover} />
        <Stat label="缺来源" value={stats.missingSource} />
        <Stat label="缺品番" value={stats.missingCatalog} />
      </div>
      <div className="border bg-white p-4">
        <p className="text-xs text-muted-foreground">
          完成率口径：分母排除收藏状态为 EXCLUDED 或默认排除的条目，分子为 OWNED。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          {stats.categoryCompletion.map((item) => (
            <div key={item.key} className="border bg-stone-50 p-3">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-1 font-semibold">{item.rate}%</div>
              <div className="text-xs text-muted-foreground">
                {item.owned}/{item.total}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
