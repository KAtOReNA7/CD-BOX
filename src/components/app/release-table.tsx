import Image from "next/image";
import Link from "next/link";
import type { Release, UserReleaseStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReleaseRow = Release & {
  userStatus: UserReleaseStatus[];
};

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("zh-CN").format(date) : "-";
}

export function ReleaseTable({ releases }: { releases: ReleaseRow[] }) {
  if (releases.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center border bg-white text-sm text-muted-foreground">
        还没有发行条目。可以从导入页开始，或先手动整理艺人资料。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-28">收藏状态</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead className="min-w-32">分类</TableHead>
            <TableHead className="min-w-56">标题</TableHead>
            <TableHead className="min-w-32">原版发行日</TableHead>
            <TableHead>格式</TableHead>
            <TableHead className="min-w-32">原版品番</TableHead>
            <TableHead className="min-w-36">厂牌</TableHead>
            <TableHead>是否再版</TableHead>
            <TableHead className="min-w-64">备注</TableHead>
            <TableHead className="min-w-28 text-right">封面图</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {releases.map((release) => {
            const status = release.userStatus[0];

            return (
              <TableRow key={release.id}>
                <TableCell>
                  <Badge variant="secondary">{status?.status ?? "UNKNOWN"}</Badge>
                </TableCell>
                <TableCell>{status?.priority ?? "-"}</TableCell>
                <TableCell>{release.category}</TableCell>
                <TableCell className="font-medium">
                  <Link href={`/releases/${release.id}`} className="hover:underline">
                    {release.title}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(release.originalReleaseDate)}</TableCell>
                <TableCell>{release.format}</TableCell>
                <TableCell>{release.originalCatalogNo ?? "-"}</TableCell>
                <TableCell>{release.label ?? "-"}</TableCell>
                <TableCell>{release.isReissue ? "是" : "否"}</TableCell>
                <TableCell className="text-muted-foreground">{release.notes ?? "-"}</TableCell>
                <TableCell className="text-right">
                  {release.coverImageUrl ? (
                    <div className="ml-auto size-16 overflow-hidden border bg-stone-100">
                      <Image
                        src={release.coverImageUrl}
                        alt={`${release.title} cover`}
                        width={64}
                        height={64}
                        unoptimized
                        className="size-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="ml-auto flex size-16 items-center justify-center border bg-stone-100 text-xs text-muted-foreground">
                      No cover
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
