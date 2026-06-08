"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReleaseListItem } from "@/lib/releases/release-types";

export function ReleaseDetailClient({
  initialRelease,
  artist,
}: {
  initialRelease: ReleaseListItem;
  artist: { id: string; name: string };
}) {
  const [release, setRelease] = useState(initialRelease);
  const [coverUrl, setCoverUrl] = useState(initialRelease.coverImageUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function saveCover() {
    const response = await fetch(`/api/releases/${release.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverImageUrl: coverUrl }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "封面保存失败");
      return;
    }
    setRelease(payload.release);
    setMessage("封面已保存。");
  }

  async function addSource() {
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
    setRelease({ ...release, sources: [...release.sources, payload.source] });
    setSourceUrl("");
    setSourceLabel("");
    setMessage("来源已新增。");
  }

  async function deleteSource(sourceId: string) {
    const ok = window.confirm("删除这个来源 URL？");
    if (!ok) return;
    const response = await fetch(`/api/releases/${release.id}/sources/${sourceId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      setMessage(payload.error ?? "来源删除失败");
      return;
    }
    setRelease({ ...release, sources: release.sources.filter((source) => source.id !== sourceId) });
  }

  const excludedReason = release.isExcludedByDefault
    ? "Release 默认排除"
    : release.userStatus?.status === "EXCLUDED"
      ? "当前用户收藏状态为 EXCLUDED"
      : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <div className="grid gap-4">
        <div className="flex aspect-square items-center justify-center overflow-hidden border bg-white">
          {release.coverImageUrl ? (
            <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={240} height={240} unoptimized className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-stone-100 text-sm text-muted-foreground">No cover</div>
          )}
        </div>
        <Input value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="封面图 URL" />
        <Button onClick={saveCover}>保存封面</Button>
      </div>
      <div>
        <Link href={`/artists/${artist.id}`} className="text-sm font-medium text-muted-foreground hover:underline">
          ← {artist.name}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{release.title}</h1>
        {message ? <div className="mt-4 border bg-white p-3 text-sm text-muted-foreground">{message}</div> : null}
        <dl className="mt-6 grid gap-4 border bg-white p-6 text-sm md:grid-cols-2">
          <div><dt className="text-muted-foreground">分类</dt><dd className="mt-1">{release.category}</dd></div>
          <div><dt className="text-muted-foreground">发行日</dt><dd className="mt-1">{release.originalReleaseDate ?? "-"}</dd></div>
          <div><dt className="text-muted-foreground">格式</dt><dd className="mt-1">{release.format}</dd></div>
          <div><dt className="text-muted-foreground">品番</dt><dd className="mt-1">{release.originalCatalogNo ?? "-"}</dd></div>
          <div><dt className="text-muted-foreground">收藏状态</dt><dd className="mt-1">{release.userStatus?.status ?? "UNKNOWN"}</dd></div>
          <div><dt className="text-muted-foreground">排除原因</dt><dd className="mt-1">{excludedReason ?? "未排除"}</dd></div>
        </dl>
        <section className="mt-6 border bg-white p-6">
          <h2 className="font-semibold">来源 URL</h2>
          <div className="mt-4 grid gap-3">
            {release.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无来源 URL。</p>
            ) : (
              release.sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-4 border p-3 text-sm">
                  <a href={source.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                    <span className="truncate">{source.label ?? source.url}</span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                  <Button size="icon" variant="ghost" onClick={() => deleteSource(source.id)} aria-label="删除来源">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="新增来源 URL" />
            <Input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="来源标签" />
            <Button onClick={addSource}>新增来源</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
