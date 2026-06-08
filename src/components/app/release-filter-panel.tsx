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

  return (
    <section className="border bg-white p-4">
      <form className="grid gap-3 lg:grid-cols-6">
        <Input name="q" defaultValue={filters.q ?? ""} placeholder="搜索标题 / 品番 / 备注" />
        <select name="category" defaultValue={filters.category ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部分类</option>
          {["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "BOX", "EP", "OTHER"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部状态</option>
          {["OWNED", "NOT_OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select name="confidence" defaultValue={filters.confidence ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部置信度</option>
          {["HIGH", "MEDIUM", "LOW"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select name="decade" defaultValue={filters.decade ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部年代</option>
          <option value="1980s">1980s</option>
          <option value="1990s">1990s</option>
          <option value="2000s">2000s</option>
          <option value="custom">自定义</option>
        </select>
        <div className="flex gap-2">
          <Input name="yearFrom" defaultValue={filters.yearFrom ?? ""} placeholder="起年" />
          <Input name="yearTo" defaultValue={filters.yearTo ?? ""} placeholder="止年" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingCover" value="true" defaultChecked={filters.missingCover === "true"} />缺封面</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingSource" value="true" defaultChecked={filters.missingSource === "true"} />缺来源</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingCatalog" value="true" defaultChecked={filters.missingCatalog === "true"} />缺品番</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pendingReview" value="true" defaultChecked={filters.pendingReview === "true"} />待核对</label>
        <select name="excluded" defaultValue={filters.excluded ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">默认排除不限</option>
          <option value="true">已默认排除</option>
          <option value="false">未默认排除</option>
        </select>
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
        <div className="flex flex-wrap gap-2 lg:col-span-6">
          <Button type="submit">应用筛选</Button>
          <Button asChild variant="outline"><Link href={`/artists/${artistId}`}>清空筛选</Link></Button>
          <Button asChild variant="outline"><Link href={`/api/artists/${artistId}/export`}>导出全部</Link></Button>
          <Button asChild variant="outline"><Link href={`/api/artists/${artistId}/export?${query.toString()}`}>导出筛选结果</Link></Button>
          <span className="self-center text-sm text-muted-foreground">当前显示 {filteredCount} / {totalCount} 条</span>
        </div>
      </form>
    </section>
  );
}
