"use client";

import { type FormEvent, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OperationProgress } from "@/components/app/operation-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReleaseFilters } from "@/lib/releases/release-types";

function downloadFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition");
  const encoded = disposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, "");
  const plainMatch = disposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  const plain = (plainMatch?.[1] ?? plainMatch?.[2])?.trim();

  let filename = plain;
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      filename = encoded;
    }
  }

  return filename?.split(/[/\\]/).at(-1)?.trim() || fallback;
}

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
  const router = useRouter();
  const [navigationPending, startNavigation] = useTransition();
  const [exporting, setExporting] = useState<"all" | "filtered" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = navigationPending || exporting !== null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  query.set("scope", "filtered");
  const gapQuery = new URLSearchParams({ gap: "true" });
  const formKey = JSON.stringify(filters);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const nextQuery = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value) nextQuery.append(key, value);
    }
    startNavigation(() => router.push(`/artists/${artistId}?${nextQuery.toString()}`));
  }

  async function downloadExport(scope: "all" | "filtered") {
    if (busy) return;
    setExporting(scope);
    setMessage(null);

    try {
      const url = scope === "all"
        ? `/api/artists/${artistId}/export`
        : `/api/artists/${artistId}/export?${query.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "导出失败。");
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = downloadFilename(response, scope === "all" ? "cd-box-all.xlsx" : "cd-box-filtered.xlsx");
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      setMessage("导出文件已生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败，请检查网络后重试。");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="grid gap-3 border bg-white p-4">
      <form key={formKey} className="grid gap-3 lg:grid-cols-[1.5fr_180px_180px_auto]" onSubmit={applyFilters}>
        <fieldset disabled={busy} className="contents">
        <Input name="q" defaultValue={filters.q ?? ""} placeholder="搜索标题 / 品番 / 备注" />
        <select name="category" defaultValue={filters.category ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部分类</option>
          {["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "LIVE", "REMIX", "OTHER"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="border bg-white px-3 py-2 text-sm">
          <option value="">全部状态</option>
          {["OWNED", "NOT_OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <Button type="submit" disabled={busy}>{navigationPending ? "筛选中…" : "筛选"}</Button>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missingCover" value="true" defaultChecked={filters.missingCover === "true"} />缺封面</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pendingReview" value="true" defaultChecked={filters.pendingReview === "true"} />待核对</label>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <Button asChild variant="outline">
            <Link
              href={`/artists/${artistId}?${gapQuery.toString()}`}
              aria-disabled={busy}
              onClick={(event) => { if (busy) event.preventDefault(); }}
            >
              查看缺口
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              href={`/artists/${artistId}`}
              aria-disabled={busy}
              onClick={(event) => { if (busy) event.preventDefault(); }}
            >
              清空
            </Link>
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => downloadExport("all")}>
            {exporting === "all" ? "导出中…" : "导出全部"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => downloadExport("filtered")}>
            {exporting === "filtered" ? "导出中…" : "导出当前结果"}
          </Button>
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
        </fieldset>
      </form>
      {navigationPending ? <OperationProgress compact label="正在应用筛选条件…" /> : null}
      {exporting ? (
        <OperationProgress
          compact
          label={exporting === "all" ? "正在生成全部收藏导出…" : "正在生成当前结果导出…"}
        />
      ) : null}
      {message ? <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{message}</p> : null}
    </section>
  );
}
