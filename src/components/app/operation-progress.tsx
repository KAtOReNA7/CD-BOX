import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function OperationProgress({
  label,
  detail,
  value,
  max,
  compact = false,
}: {
  label: string;
  detail?: string;
  value?: number;
  max?: number;
  compact?: boolean;
}) {
  const determinate = value !== undefined && max !== undefined && max > 0;
  const safeValue = determinate ? Math.min(Math.max(value, 0), max) : undefined;
  const percentage = determinate && safeValue !== undefined ? (safeValue / max) * 100 : 50;

  return (
    <div
      className={cn(
        "flex items-start gap-3 border bg-white text-sm text-muted-foreground",
        compact ? "px-3 py-2" : "p-4",
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-foreground">{label}</p>
          {determinate ? (
            <span className="shrink-0 text-xs tabular-nums" aria-hidden="true">
              {Math.round(percentage)}%
            </span>
          ) : null}
        </div>
        {detail ? <p className="mt-1 leading-5">{detail}</p> : null}
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200"
          role="progressbar"
          aria-label={label}
          aria-valuemin={determinate ? 0 : undefined}
          aria-valuemax={determinate ? max : undefined}
          aria-valuenow={safeValue}
        >
          <div
            className={cn(
              "h-full rounded-full bg-stone-700 transition-[width]",
              determinate ? "" : "animate-pulse",
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
