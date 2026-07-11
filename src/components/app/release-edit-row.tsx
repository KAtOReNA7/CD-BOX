"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { findCoverSource, releaseEvidenceSources } from "@/lib/releases/cover-source";
import type { ReleaseListItem } from "@/lib/releases/release-types";

const statuses = ["OWNED", "NOT_OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"];

type ReleaseRowOperation = "quick-edit" | "status" | null;

function Cover({ release, showSource }: { release: ReleaseListItem; showSource: boolean }) {
  if (!release.coverImageUrl) {
    return (
      <div className="ml-auto flex size-14 items-center justify-center border bg-stone-100 text-xs text-muted-foreground">
        No cover
      </div>
    );
  }

  const coverSource = showSource ? findCoverSource(release.sources) : undefined;
  const cover = (
    <div className="size-14 overflow-hidden border bg-stone-100">
      <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={56} height={56} unoptimized className="size-full object-cover" />
    </div>
  );

  return coverSource ? (
    <a href={coverSource.url} target="_blank" rel="noreferrer" className="ml-auto block" aria-label={`查看 ${release.title} 的封面来源`}>
      {cover}
    </a>
  ) : (
    <div className="ml-auto">{cover}</div>
  );
}

export function ReleaseEditRow({
  release,
  selected,
  onSelect,
  onReleaseSaved,
  onStatusSaved,
  onMutationStart,
  onMutationEnd,
  disabled = false,
}: {
  release: ReleaseListItem;
  selected: boolean;
  onSelect: () => void;
  onReleaseSaved: (release: ReleaseListItem, warning?: string | null) => void;
  onStatusSaved: (releaseId: string, status: NonNullable<ReleaseListItem["userStatus"]>) => void;
  onMutationStart: () => boolean;
  onMutationEnd: () => void;
  disabled?: boolean;
}) {
  const [notes, setNotes] = useState(release.notes ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(release.coverImageUrl ?? "");
  const [quickEditing, setQuickEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<ReleaseRowOperation>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const busy = disabled || operation !== null;

  async function saveQuickEdit() {
    if (busy || !onMutationStart()) return;
    setOperation("quick-edit");
    setError(null);

    try {
      const response = await fetch(`/api/releases/${release.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, coverImageUrl }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "保存失败");
        return;
      }
      onReleaseSaved(payload.release, payload.duplicateCatalogWarning);
      setQuickEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请检查网络后重试。");
    } finally {
      setOperation(null);
      onMutationEnd();
    }
  }

  async function saveStatus(status: string) {
    if (busy || !onMutationStart()) return;
    setOperation("status");
    setPendingStatus(status);
    setError(null);

    try {
      const response = await fetch(`/api/releases/${release.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "状态保存失败");
        return;
      }
      onStatusSaved(release.id, payload.status);
    } catch (error) {
      setError(error instanceof Error ? error.message : "状态保存失败，请检查网络后重试。");
    } finally {
      setPendingStatus(null);
      setOperation(null);
      onMutationEnd();
    }
  }

  return (
    <TableRow>
      <TableCell>
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
          aria-label={`选择发行：${release.title}`}
        />
      </TableCell>
      <TableCell className="min-w-36">
        <select
          className="w-full border bg-white px-2 py-1 text-xs"
          value={pendingStatus ?? release.userStatus?.status ?? "NOT_OWNED"}
          disabled={busy}
          onChange={(event) => saveStatus(event.target.value)}
        >
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {operation === "status" ? <RowProgress label="正在保存状态…" /> : null}
      </TableCell>
      <TableCell>{release.category}</TableCell>
      <TableCell className="min-w-56 font-medium">
        <Link href={`/releases/${release.id}`} className="hover:underline">{release.title}</Link>
      </TableCell>
      <TableCell>{release.originalReleaseDate ?? "-"}</TableCell>
      <TableCell>{release.originalCatalogNo ?? "-"}</TableCell>
      <TableCell>{release.format}</TableCell>
      <TableCell>{releaseEvidenceSources(release.sources).length}</TableCell>
      <TableCell className="min-w-64">
        {quickEditing ? (
          <div className="grid gap-2">
            <Input value={coverImageUrl} disabled={busy} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="封面 URL" />
            <textarea className="min-h-16 border px-3 py-2 text-sm" value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="备注" />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveQuickEdit} disabled={busy}>{operation === "quick-edit" ? "保存中…" : "保存"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setNotes(release.notes ?? ""); setCoverImageUrl(release.coverImageUrl ?? ""); setQuickEditing(false); }}>取消</Button>
            </div>
            {operation === "quick-edit" ? <RowProgress label="正在保存快速编辑…" /> : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <span className="line-clamp-2 text-sm text-muted-foreground">{release.notes ?? "-"}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuickEditing(true)}>快速编辑</Button>
              <Button size="sm" variant="ghost" asChild><Link href={`/releases/${release.id}`}>详情</Link></Button>
            </div>
          </div>
        )}
        {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
      </TableCell>
      <TableCell className="text-right">
        <Cover
          release={{ ...release, coverImageUrl: quickEditing ? coverImageUrl || null : release.coverImageUrl }}
          showSource={!quickEditing || (coverImageUrl || null) === release.coverImageUrl}
        />
      </TableCell>
    </TableRow>
  );
}

function RowProgress({ label }: { label: string }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground" role="status" aria-live="polite">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}
