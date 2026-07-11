"use client";

import { Button } from "@/components/ui/button";

export function ReleaseBulkToolbar({
  selectedCount,
  pending,
  disabled = false,
  onBulk,
  onClear,
}: {
  selectedCount: number;
  pending: boolean;
  disabled?: boolean;
  onBulk: (payload: { status?: string; priority?: number; isExcludedByDefault?: boolean }) => void;
  onClear: () => void;
}) {
  const bulkDisabled = pending || disabled || selectedCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border bg-white p-3" aria-busy={pending}>
      <span className="text-sm text-muted-foreground">已选择 {selectedCount} 条</span>
      <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ status: "OWNED" })}>已拥有</Button>
      <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ status: "WANTED" })}>想买</Button>
      <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ status: "PENDING_REVIEW" })}>待核对</Button>
      <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ status: "EXCLUDED" })}>排除</Button>
      <details className="ml-1">
        <summary className="cursor-pointer px-2 py-1 text-sm text-muted-foreground">高级批量</summary>
        <div className="mt-2 flex flex-wrap gap-2 border bg-stone-50 p-2">
          {[1, 2, 3, 4, 5].map((priority) => (
            <Button key={priority} size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ priority })}>P{priority}</Button>
          ))}
          <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ isExcludedByDefault: true })}>默认排除</Button>
          <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ isExcludedByDefault: false })}>取消默认排除</Button>
          <Button size="sm" variant="outline" disabled={bulkDisabled} onClick={() => onBulk({ status: "NOT_OWNED" })}>未拥有</Button>
        </div>
      </details>
      <Button size="sm" variant="ghost" disabled={pending || disabled || selectedCount === 0} onClick={onClear}>清空选择</Button>
    </div>
  );
}
