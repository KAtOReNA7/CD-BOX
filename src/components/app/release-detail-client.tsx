"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { OperationProgress } from "@/components/app/operation-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReleaseCategory, ReleaseFormat } from "@prisma/client";
import { findCoverSource, releaseEvidenceSources } from "@/lib/releases/cover-source";
import type { ReleaseListItem } from "@/lib/releases/release-types";

const categories = ["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "COMPILATION", "LIVE", "REMIX", "BOX", "EP", "OTHER"];
const formats = ["CD", "SHM_CD", "BLU_SPEC_CD", "SACD", "HYBRID_SACD", "CD_DVD", "BOX_SET", "OTHER"];

type DetailOperation = "save-release" | "add-source" | `delete-source:${string}` | null;

function detailDraft(release: ReleaseListItem) {
  return {
    title: release.title,
    category: release.category,
    releaseDate: release.originalReleaseDate ?? "",
    format: release.format,
    catalogNumber: release.originalCatalogNo ?? "",
    label: release.label ?? "",
    originalPrice: release.originalPrice ?? "",
    editionType: release.editionType ?? "",
    isReissue: release.isReissue,
    isRemaster: release.isRemaster,
    isExcludedByDefault: release.isExcludedByDefault,
    coverImageUrl: release.coverImageUrl ?? "",
    notes: release.notes ?? "",
  };
}

export function ReleaseDetailClient({
  initialRelease,
  artist,
}: {
  initialRelease: ReleaseListItem;
  artist: { id: string; name: string };
}) {
  const [release, setRelease] = useState(initialRelease);
  const [draft, setDraft] = useState(() => detailDraft(initialRelease));
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [operation, setOperation] = useState<DetailOperation>(null);
  const busy = operation !== null;

  async function saveRelease() {
    if (busy) return;
    setOperation("save-release");
    setMessage(null);

    try {
      const response = await fetch(`/api/releases/${release.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "保存失败");
        return;
      }
      setRelease(payload.release);
      setDraft(detailDraft(payload.release));
      setMessage(payload.duplicateCatalogWarning ?? "已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请检查网络后重试。");
    } finally {
      setOperation(null);
    }
  }

  async function addSource() {
    if (busy) return;
    setOperation("add-source");
    setMessage(null);

    try {
      const response = await fetch(`/api/releases/${release.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, label: sourceLabel }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "来源新增失败");
        return;
      }
      setRelease((current) => ({ ...current, sources: [...current.sources, payload.source] }));
      setSourceUrl("");
      setSourceLabel("");
      setMessage("来源已新增。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "来源新增失败，请检查网络后重试。");
    } finally {
      setOperation(null);
    }
  }

  async function deleteSource(sourceId: string) {
    if (busy) return;
    const ok = window.confirm("删除这个来源 URL？");
    if (!ok) return;
    setOperation(`delete-source:${sourceId}`);
    setMessage(null);

    try {
      const response = await fetch(`/api/releases/${release.id}/sources/${sourceId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        setMessage(payload.error ?? "来源删除失败");
        return;
      }
      setRelease((current) => ({
        ...current,
        sources: current.sources.filter((source) => source.id !== sourceId),
      }));
      setMessage("来源已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "来源删除失败，请检查网络后重试。");
    } finally {
      setOperation(null);
    }
  }

  const operationLabel =
    operation === "save-release"
      ? "正在保存发行资料…"
      : operation === "add-source"
        ? "正在新增来源…"
        : operation?.startsWith("delete-source:")
          ? "正在删除来源…"
          : null;
  const coverSource = findCoverSource(release.sources);
  const evidenceSources = releaseEvidenceSources(release.sources);

  const excludedReason = release.isExcludedByDefault
    ? "Release 默认排除"
    : release.userStatus?.status === "EXCLUDED"
      ? "当前收藏状态为 EXCLUDED"
      : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <div className="grid content-start gap-4">
        <div className="flex aspect-square items-center justify-center overflow-hidden border bg-white">
          {release.coverImageUrl ? (
            coverSource ? (
              <a href={coverSource.url} target="_blank" rel="noreferrer" className="size-full" aria-label="查看封面来源">
                <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={240} height={240} unoptimized className="size-full object-cover" />
              </a>
            ) : (
              <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={240} height={240} unoptimized className="size-full object-cover" />
            )
          ) : (
            <div className="flex size-full items-center justify-center bg-stone-100 text-sm text-muted-foreground">No cover</div>
          )}
        </div>
        {coverSource ? (
          <a href={coverSource.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
            封面来源：{coverSource.label ?? "原始页面"}
          </a>
        ) : null}
        <Input value={draft.coverImageUrl} disabled={busy} onChange={(event) => setDraft({ ...draft, coverImageUrl: event.target.value })} placeholder="封面图 URL" />
        <Button onClick={saveRelease} disabled={busy}>{operation === "save-release" ? "保存中…" : "保存封面"}</Button>
      </div>
      <div>
        <Link href={`/artists/${artist.id}`} className="text-sm font-medium text-muted-foreground hover:underline">
          返回 {artist.name}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{release.title}</h1>
        {operationLabel ? <div className="mt-4"><OperationProgress compact label={operationLabel} /></div> : null}
        {message ? <div className="mt-4 border bg-white p-3 text-sm text-muted-foreground" role="status" aria-live="polite">{message}</div> : null}
        <dl className="mt-6 grid gap-4 border bg-white p-6 text-sm md:grid-cols-2">
          <div><dt className="text-muted-foreground">收藏状态</dt><dd className="mt-1">{release.userStatus?.status ?? "NOT_OWNED"}</dd></div>
          <div><dt className="text-muted-foreground">排除原因</dt><dd className="mt-1">{excludedReason ?? "未排除"}</dd></div>
          <div><dt className="text-muted-foreground">发行来源数量</dt><dd className="mt-1">{evidenceSources.length}</dd></div>
          <div><dt className="text-muted-foreground">当前品番</dt><dd className="mt-1">{release.originalCatalogNo ?? "-"}</dd></div>
        </dl>

        <section className="mt-6 border bg-white p-6">
          <h2 className="font-semibold">发行资料</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Input value={draft.title} disabled={busy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="标题" />
            <select className="border bg-white px-3 py-2 text-sm" value={draft.category} disabled={busy} onChange={(event) => setDraft({ ...draft, category: event.target.value as ReleaseCategory })}>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <Input type="date" value={draft.releaseDate} disabled={busy} onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })} />
            <select className="border bg-white px-3 py-2 text-sm" value={draft.format} disabled={busy} onChange={(event) => setDraft({ ...draft, format: event.target.value as ReleaseFormat })}>
              {formats.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <Input value={draft.catalogNumber} disabled={busy} onChange={(event) => setDraft({ ...draft, catalogNumber: event.target.value })} placeholder="品番" />
            <Input value={draft.label} disabled={busy} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="厂牌" />
            <Input value={draft.originalPrice} disabled={busy} onChange={(event) => setDraft({ ...draft, originalPrice: event.target.value })} placeholder="原价" />
            <Input value={draft.editionType} disabled={busy} onChange={(event) => setDraft({ ...draft, editionType: event.target.value })} placeholder="版本类型" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isReissue} disabled={busy} onChange={(event) => setDraft({ ...draft, isReissue: event.target.checked })} />再版</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isRemaster} disabled={busy} onChange={(event) => setDraft({ ...draft, isRemaster: event.target.checked })} />Remaster</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isExcludedByDefault} disabled={busy} onChange={(event) => setDraft({ ...draft, isExcludedByDefault: event.target.checked })} />默认排除</label>
            <textarea className="min-h-24 border px-3 py-2 text-sm md:col-span-3" value={draft.notes} disabled={busy} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="备注" />
          </div>
          <Button className="mt-4" onClick={saveRelease} disabled={busy}>{operation === "save-release" ? "保存中…" : "保存发行资料"}</Button>
        </section>

        <section className="mt-6 border bg-white p-6">
          <h2 className="font-semibold">来源 URL</h2>
          <div className="mt-4 grid gap-3">
            {evidenceSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无来源 URL。</p>
            ) : (
              evidenceSources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-4 border p-3 text-sm">
                  <a href={source.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                    <span className="truncate">{source.label ?? source.url}</span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                  <Button size="icon" variant="ghost" disabled={busy} onClick={() => deleteSource(source.id)} aria-label={operation === `delete-source:${source.id}` ? "正在删除来源" : "删除来源"}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <Input value={sourceUrl} disabled={busy} onChange={(event) => setSourceUrl(event.target.value)} placeholder="新增来源 URL" />
            <Input value={sourceLabel} disabled={busy} onChange={(event) => setSourceLabel(event.target.value)} placeholder="来源标签" />
            <Button onClick={addSource} disabled={busy}>{operation === "add-source" ? "新增中…" : "新增来源"}</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
