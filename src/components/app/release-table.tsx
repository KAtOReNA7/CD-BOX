"use client";

import { useState } from "react";
import { ReleaseBulkToolbar } from "@/components/app/release-bulk-toolbar";
import { ReleaseEditRow } from "@/components/app/release-edit-row";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReleaseListItem } from "@/lib/releases/release-types";

export function ReleaseTable({
  artistId,
  releases,
  totalCount,
}: {
  artistId: string;
  releases: ReleaseListItem[];
  totalCount: number;
}) {
  const [rows, setRows] = useState(releases);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  function toggleSelected(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function updateRow(updated: ReleaseListItem, warning?: string | null) {
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
    setMessage(warning ?? "已保存。");
  }

  function updateStatus(releaseId: string, status: NonNullable<ReleaseListItem["userStatus"]>) {
    setRows((current) => current.map((row) => (row.id === releaseId ? { ...row, userStatus: status } : row)));
    setMessage("收藏状态已保存。");
  }

  async function bulk(payload: { status?: string; priority?: number; isExcludedByDefault?: boolean }) {
    if (selectedIds.size === 0) return;
    const ok = window.confirm(`将更新 ${selectedIds.size} 条收藏记录，是否继续？`);
    if (!ok) return;

    const response = await fetch("/api/releases/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artistId, releaseIds: [...selectedIds], ...payload }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "批量操作失败。");
      return;
    }
    setRows((current) =>
      current.map((row) => {
        if (!selectedIds.has(row.id)) return row;
        return {
          ...row,
          isExcludedByDefault: payload.isExcludedByDefault ?? row.isExcludedByDefault,
          userStatus:
            payload.status || payload.priority
              ? {
                  id: row.userStatus?.id ?? `local-${row.id}`,
                  status: (payload.status as never) ?? row.userStatus?.status ?? "NOT_OWNED",
                  priority: payload.priority ?? row.userStatus?.priority ?? 3,
                  ownedCondition: row.userStatus?.ownedCondition ?? null,
                  ownedNotes: row.userStatus?.ownedNotes ?? null,
                  notes: row.userStatus?.notes ?? null,
                }
              : row.userStatus,
        };
      }),
    );
    setMessage(`已更新状态 ${result.updatedStatuses} 条，Release 字段 ${result.updatedReleases} 条。`);
  }

  if (rows.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center border bg-white p-6 text-center">
        <div>
          <p className="font-medium">还没有收藏条目</p>
          <p className="mt-2 text-sm text-muted-foreground">可以导入 Excel、粘贴资料整理，或从详情页手动补资料。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <ReleaseBulkToolbar selectedCount={selectedIds.size} onBulk={bulk} onClear={() => setSelectedIds(new Set())} />
      {message ? <div className="border bg-white p-3 text-sm text-muted-foreground">{message}</div> : null}
      <div className="overflow-x-auto border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === rows.length}
                  onChange={(event) => setSelectedIds(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
                />
              </TableHead>
              <TableHead>收藏状态</TableHead>
              <TableHead>分类</TableHead>
              <TableHead className="min-w-56">标题</TableHead>
              <TableHead>发行日</TableHead>
              <TableHead>品番</TableHead>
              <TableHead>格式</TableHead>
              <TableHead>来源</TableHead>
              <TableHead className="min-w-64">备注</TableHead>
              <TableHead className="text-right">封面</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((release) => (
              <ReleaseEditRow
                key={release.id}
                release={release}
                selected={selectedIds.has(release.id)}
                onSelect={() => toggleSelected(release.id)}
                onReleaseSaved={updateRow}
                onStatusSaved={updateStatus}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">显示 {rows.length} 条，艺人库共 {totalCount} 条。主表最后一列固定为封面，不显示来源 URL。</p>
    </div>
  );
}
