"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ReleaseListItem } from "@/lib/releases/release-types";

const statuses = ["OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"];

function Cover({ release }: { release: ReleaseListItem }) {
  return release.coverImageUrl ? (
    <div className="ml-auto size-14 overflow-hidden border bg-stone-100">
      <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={56} height={56} unoptimized className="size-full object-cover" />
    </div>
  ) : (
    <div className="ml-auto flex size-14 items-center justify-center border bg-stone-100 text-xs text-muted-foreground">
      No cover
    </div>
  );
}

export function ReleaseEditRow({
  release,
  selected,
  onSelect,
  onReleaseSaved,
  onStatusSaved,
}: {
  release: ReleaseListItem;
  selected: boolean;
  onSelect: () => void;
  onReleaseSaved: (release: ReleaseListItem, warning?: string | null) => void;
  onStatusSaved: (releaseId: string, status: NonNullable<ReleaseListItem["userStatus"]>) => void;
}) {
  const [notes, setNotes] = useState(release.notes ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(release.coverImageUrl ?? "");
  const [quickEditing, setQuickEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveQuickEdit() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/releases/${release.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, coverImageUrl }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload.error ?? "保存失败");
      return;
    }
    onReleaseSaved(payload.release, payload.duplicateCatalogWarning);
    setQuickEditing(false);
  }

  async function saveStatus(status: string) {
    setError(null);
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
  }

  return (
    <TableRow>
      <TableCell><input type="checkbox" checked={selected} onChange={onSelect} /></TableCell>
      <TableCell className="min-w-36">
        <select
          className="w-full border bg-white px-2 py-1 text-xs"
          value={release.userStatus?.status ?? "WANTED"}
          onChange={(event) => saveStatus(event.target.value)}
        >
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </TableCell>
      <TableCell>{release.category}</TableCell>
      <TableCell className="min-w-56 font-medium">
        <Link href={`/releases/${release.id}`} className="hover:underline">{release.title}</Link>
      </TableCell>
      <TableCell>{release.originalReleaseDate ?? "-"}</TableCell>
      <TableCell>{release.originalCatalogNo ?? "-"}</TableCell>
      <TableCell>{release.format}</TableCell>
      <TableCell>{release.sources.length}</TableCell>
      <TableCell className="min-w-64">
        {quickEditing ? (
          <div className="grid gap-2">
            <Input value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} placeholder="封面 URL" />
            <textarea className="min-h-16 border px-3 py-2 text-sm" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="备注" />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveQuickEdit} disabled={saving}>{saving ? "保存中" : "保存"}</Button>
              <Button size="sm" variant="outline" onClick={() => { setNotes(release.notes ?? ""); setCoverImageUrl(release.coverImageUrl ?? ""); setQuickEditing(false); }}>取消</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <span className="line-clamp-2 text-sm text-muted-foreground">{release.notes ?? "-"}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setQuickEditing(true)}>快速编辑</Button>
              <Button size="sm" variant="ghost" asChild><Link href={`/releases/${release.id}`}>详情</Link></Button>
            </div>
          </div>
        )}
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </TableCell>
      <TableCell className="text-right"><Cover release={{ ...release, coverImageUrl: quickEditing ? coverImageUrl || null : release.coverImageUrl }} /></TableCell>
    </TableRow>
  );
}
