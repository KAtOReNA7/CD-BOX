"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ReleaseListItem } from "@/lib/releases/release-types";

const categories = ["ORIGINAL_ALBUM", "SINGLE", "BEST", "COLLECTION", "COMPILATION", "LIVE", "REMIX", "BOX", "EP", "OTHER"];
const formats = ["CD", "SHM_CD", "BLU_SPEC_CD", "SACD", "HYBRID_SACD", "CD_DVD", "BOX_SET", "OTHER"];
const statuses = ["OWNED", "NOT_OWNED", "WANTED", "PENDING_REVIEW", "EXCLUDED"];

type Draft = {
  title: string;
  category: string;
  releaseDate: string;
  format: string;
  catalogNumber: string;
  label: string;
  originalPrice: string;
  editionType: string;
  isReissue: boolean;
  isRemaster: boolean;
  isExcludedByDefault: boolean;
  coverImageUrl: string;
  notes: string;
};

function draftFromRelease(release: ReleaseListItem): Draft {
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

function Cover({ release }: { release: ReleaseListItem }) {
  return release.coverImageUrl ? (
    <div className="ml-auto size-16 overflow-hidden border bg-stone-100">
      <Image src={release.coverImageUrl} alt={`${release.title} cover`} width={64} height={64} unoptimized className="size-full object-cover" />
    </div>
  ) : (
    <div className="ml-auto flex size-16 items-center justify-center border bg-stone-100 text-xs text-muted-foreground">
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromRelease(release));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveRelease() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/releases/${release.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(payload.error ?? "保存失败");
      return;
    }
    onReleaseSaved(payload.release, payload.duplicateCatalogWarning);
    setEditing(false);
  }

  async function saveStatus(patch: Record<string, unknown>) {
    setError(null);
    const response = await fetch(`/api/releases/${release.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "状态保存失败");
      return;
    }
    onStatusSaved(release.id, payload.status);
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell><input type="checkbox" checked={selected} onChange={onSelect} /></TableCell>
        <TableCell colSpan={11}>
          <div className="grid gap-3 md:grid-cols-4">
            <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="标题" />
            <select className="border px-3 py-2 text-sm" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <Input type="date" value={draft.releaseDate} onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })} />
            <select className="border px-3 py-2 text-sm" value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value })}>
              {formats.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <Input value={draft.catalogNumber} onChange={(event) => setDraft({ ...draft, catalogNumber: event.target.value })} placeholder="品番" />
            <Input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="厂牌" />
            <Input value={draft.originalPrice} onChange={(event) => setDraft({ ...draft, originalPrice: event.target.value })} placeholder="原价" />
            <Input value={draft.editionType} onChange={(event) => setDraft({ ...draft, editionType: event.target.value })} placeholder="版本类型" />
            <Input value={draft.coverImageUrl} onChange={(event) => setDraft({ ...draft, coverImageUrl: event.target.value })} placeholder="封面图 URL" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isReissue} onChange={(event) => setDraft({ ...draft, isReissue: event.target.checked })} />再版</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isRemaster} onChange={(event) => setDraft({ ...draft, isRemaster: event.target.checked })} />Remaster</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isExcludedByDefault} onChange={(event) => setDraft({ ...draft, isExcludedByDefault: event.target.checked })} />默认排除</label>
            <textarea className="min-h-20 border px-3 py-2 text-sm md:col-span-4" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="备注" />
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={saveRelease} disabled={saving}>{saving ? "保存中" : "保存"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraft(draftFromRelease(release)); setEditing(false); }}>取消</Button>
          </div>
        </TableCell>
        <TableCell className="text-right"><Cover release={{ ...release, coverImageUrl: draft.coverImageUrl || null }} /></TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell><input type="checkbox" checked={selected} onChange={onSelect} /></TableCell>
      <TableCell className="min-w-44">
        <select className="w-full border bg-white px-2 py-1 text-xs" value={release.userStatus?.status ?? "NOT_OWNED"} onChange={(event) => saveStatus({ status: event.target.value })}>
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <Input className="mt-2 h-8" type="number" min={1} max={5} value={release.userStatus?.priority ?? 3} onChange={(event) => saveStatus({ priority: Number(event.target.value) })} />
        <Input className="mt-2 h-8" value={release.userStatus?.ownedCondition ?? ""} onChange={(event) => saveStatus({ ownedCondition: event.target.value })} placeholder="品相" />
      </TableCell>
      <TableCell>{release.category}</TableCell>
      <TableCell className="font-medium"><Link href={`/releases/${release.id}`} className="hover:underline">{release.title}</Link></TableCell>
      <TableCell>{release.originalReleaseDate ?? "-"}</TableCell>
      <TableCell>{release.format}</TableCell>
      <TableCell>{release.originalCatalogNo ?? "-"}</TableCell>
      <TableCell>{release.label ?? "-"}</TableCell>
      <TableCell>{release.isReissue ? "是" : "否"}</TableCell>
      <TableCell>{release.isRemaster ? "是" : "否"}</TableCell>
      <TableCell className="max-w-64 text-muted-foreground">{release.notes ?? "-"}</TableCell>
      <TableCell><Button size="sm" variant="outline" onClick={() => setEditing(true)}>编辑</Button>{error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}</TableCell>
      <TableCell className="text-right"><Cover release={release} /></TableCell>
    </TableRow>
  );
}
