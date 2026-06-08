import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReleaseFilters } from "@/lib/releases/release-types";

export function ReleaseFilterPanel({
  artistId,
  filters,
  filteredCount,
  totalCount,
}: {
  artistId: string;
  filters: ReleaseFilters;
  filteredCount: number;
  totalCount: number;
}) {
  const query = new URLSearchParams(filters as Record<string, string>);
  query.set("scope", "filtered");
  const gapQuery = new URLSearchParams({ gap: "true" });

  return (
    <section className="border bg-white p-4">
      <form className="grid gap-3 lg:grid-cols-[1.5fr_180px_180px_auto]">
        <Input name="q" defaultValue={filters.q ?? ""} placeholder="搜索标题 / 品番 / 备注" />
        <select name="category" defaultValue={filters.category ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部分类</option>
          {["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "OTHER"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部状态</option>
          {["OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <Button type="submit">筛选</Button>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingCover" value="true" defaultChecked={filters.missingCover === "true"} />缺封面</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pendingReview" value="true" defaultChecked={filters.pendingReview === "true"} />待核对</label>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <Button asChild variant="outline"><Link href={`/artists/${artistId}?${gapQuery.toString()}`}>查看缺口</Link></Button>
          <Button asChild variant="outline"><Link href={`/artists/${artistId}`}>清空</Link></Button>
          <Button asChild variant="outline"><Link href={`/api/artists/${artistId}/export`}>导出全部</Link></Button>
          <Button asChild variant="outline"><Link href={`/api/artists/${artistId}/export?${query.toString()}`}>导出当前结果</Link></Button>
          <span className="self-center text-sm text-muted-foreground">显示 {filteredCount} / {totalCount} 条</span>
        </div>

        <details className="lg:col-span-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">高级筛选</summary>
          <div className="mt-3 grid gap-3 border bg-stone-50 p-3 md:grid-cols-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingSource" value="true" defaultChecked={filters.missingSource === "true"} />缺来源</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingCatalog" value="true" defaultChecked={filters.missingCatalog === "true"} />缺品番</label>
            <select name="reissue" defaultValue={filters.reissue ?? ""} className="border bg-white px-3 py-2 text-sm">
              <option value="">再版不限</option>
              <option value="true">再版</option>
              <option value="false">非再版</option>
            </select>
            <select name="remaster" defaultValue={filters.remaster ?? ""} className="border bg-white px-3 py-2 text-sm">
              <option value="">Remaster 不限</option>
              <option value="true">Remaster</option>
              <option value="false">非 Remaster</option>
            </select>
            <select name="excluded" defaultValue={filters.excluded ?? ""} className="border bg-white px-3 py-2 text-sm">
              <option value="">排除项不限</option>
              <option value="true">默认排除</option>
              <option value="false">未默认排除</option>
            </select>
            <select name="confidence" defaultValue={filters.confidence ?? ""} className="border bg-white px-3 py-2 text-sm">
              <option value="">置信度不限</option>
              {["HIGH", "MEDIUM", "LOW"].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select name="decade" defaultValue={filters.decade ?? ""} className="border bg-white px-3 py-2 text-sm">
              <option value="">年代不限</option>
              <option value="1980s">1980s</option>
              <option value="1990s">1990s</option>
              <option value="2000s">2000s</option>
              <option value="custom">自定义</option>
            </select>
            <div className="flex gap-2">
              <Input name="yearFrom" defaultValue={filters.yearFrom ?? ""} placeholder="起年" />
              <Input name="yearTo" defaultValue={filters.yearTo ?? ""} placeholder="止年" />
            </div>
          </div>
        </details>
      </form>
    </section>
  );
}
