import type { ArtistStats } from "@/lib/releases/release-types";

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "strong" }) {
  return (
    <div className={tone === "strong" ? "border bg-white p-4 ring-1 ring-foreground/10" : "border bg-white p-4"}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function ArtistStatsCards({ stats }: { stats: ArtistStats }) {
  const collectibleTotal = Math.max(0, stats.total - stats.excluded);
  const gapCount = Math.max(0, collectibleTotal - stats.owned);

  return (
    <section className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="总完成率" value={`${stats.completionRate}%`} tone="strong" />
        <Stat label="已拥有 / 应收" value={`${stats.owned} / ${collectibleTotal}`} />
        <Stat label="缺口数量" value={gapCount} />
        <Stat label="待核对" value={stats.pendingReview} />
        <Stat label="缺封面" value={stats.missingCover} />
      </div>
      <details className="border bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">按分类完成率</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          口径：分母排除收藏状态为 EXCLUDED 或默认排除的条目，分子为 OWNED。
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
      </details>
    </section>
  );
}
