"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DuplicateStrategy, ImportPreviewResult } from "@/lib/import/import-types";

type ArtistOption = {
  id: string;
  name: string;
};

export function ImportClient({ artists }: { artists: ArtistOption[] }) {
  const router = useRouter();
  const [artistMode, setArtistMode] = useState<"create" | "existing">("create");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [artistName, setArtistName] = useState("中山美穂");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("skip");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canPreview = useMemo(() => {
    if (!file) return false;
    if (artistMode === "existing") return Boolean(artistId);
    return Boolean(artistName.trim());
  }, [artistId, artistMode, artistName, file]);

  async function createPreview() {
    if (!file || !canPreview) return;

    setLoading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("artistMode", artistMode);
    formData.append("artistId", artistId);
    formData.append("artistName", artistName);

    const response = await fetch("/api/import/preview", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    setLoading(false);

    if (!response.ok) {
      setMessage(payload.error ?? "预览失败");
      return;
    }

    setPreview(payload);
  }

  async function confirmImport() {
    if (!preview) return;

    setLoading(true);
    setMessage(null);

    const response = await fetch("/api/import/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...preview,
        duplicateStrategy,
      }),
    });
    const payload = await response.json();

    setLoading(false);

    if (!response.ok) {
      setMessage(payload.error ?? "确认导入失败");
      return;
    }

    router.push(`/artists/${payload.artistId}`);
  }

  return (
    <div className="grid gap-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Excel Import</p>
        <h1 className="mt-2 text-3xl font-semibold">导入收藏清单</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          支持中山美穂原版 CD 收藏清单这类模板。来源 URL 会保存到 ReleaseSource，
          封面图会保存到 coverImageUrl，主表格最后一列只展示封面。
        </p>
      </div>

      {message ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>导入提示</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-6 border bg-white p-6 lg:grid-cols-[1fr_1fr]">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>目标艺人库</Label>
            <Select value={artistMode} onValueChange={(value) => setArtistMode(value as "create" | "existing")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">新建艺人</SelectItem>
                <SelectItem value="existing">导入到已有艺人</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {artistMode === "create" ? (
            <div className="grid gap-2">
              <Label htmlFor="artistName">艺人名称</Label>
              <Input id="artistName" value={artistName} onChange={(event) => setArtistName(event.target.value)} />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>已有艺人</Label>
              <Select value={artistId} onValueChange={setArtistId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择艺人库" />
                </SelectTrigger>
                <SelectContent>
                  {artists.map((artist) => (
                    <SelectItem key={artist.id} value={artist.id}>
                      {artist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <label
          htmlFor="file"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setFile(event.dataTransfer.files[0] ?? null);
            setPreview(null);
          }}
          className="flex min-h-48 cursor-pointer flex-col items-center justify-center border border-dashed bg-stone-50 p-6 text-center transition hover:bg-stone-100"
        >
          <FileSpreadsheet className="size-8 text-stone-500" />
          <span className="mt-3 text-sm font-medium">{file ? file.name : "拖拽 .xlsx 到这里，或点击选择"}</span>
          <span className="mt-1 text-xs text-muted-foreground">上传后先预览，不会直接写入数据库</span>
          <Input
            id="file"
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>

        <div className="lg:col-span-2">
          <Button type="button" onClick={createPreview} disabled={!canPreview || loading} className="gap-2">
            <Upload className="size-4" />
            生成预览
          </Button>
        </div>
      </section>

      {preview ? (
        <section className="grid gap-6">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="总行数" value={preview.summary.totalRows} />
            <Metric label="可导入" value={preview.summary.importableRows} />
            <Metric label="重复" value={preview.summary.duplicateRows} />
            <Metric label="错误" value={preview.summary.errorRows} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-5 text-stone-500" />
              <span className="text-sm font-medium">确认导入前选择重复条目策略</span>
            </div>
            <div className="flex items-center gap-3">
              <Select value={duplicateStrategy} onValueChange={(value) => setDuplicateStrategy(value as DuplicateStrategy)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">跳过重复</SelectItem>
                  <SelectItem value="update">更新已有</SelectItem>
                  <SelectItem value="create">作为新条目</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" onClick={confirmImport} disabled={loading}>
                确认导入
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>状态</TableHead>
                  <TableHead>Sheet</TableHead>
                  <TableHead>行号</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead className="min-w-56">标题</TableHead>
                  <TableHead>原版发行日</TableHead>
                  <TableHead>格式</TableHead>
                  <TableHead>原版品番</TableHead>
                  <TableHead>厂牌</TableHead>
                  <TableHead>封面图</TableHead>
                  <TableHead>错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.rowId}>
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <Badge variant="destructive">error</Badge>
                      ) : row.duplicate ? (
                        <Badge variant="outline">duplicate</Badge>
                      ) : (
                        <Badge variant="secondary">ready</Badge>
                      )}
                    </TableCell>
                    <TableCell>{row.sheetName}</TableCell>
                    <TableCell>{row.rowNumber}</TableCell>
                    <TableCell>{row.category}</TableCell>
                    <TableCell className="font-medium">{row.title || "-"}</TableCell>
                    <TableCell>{row.originalReleaseDate ?? "-"}</TableCell>
                    <TableCell>{row.format}</TableCell>
                    <TableCell>{row.originalCatalogNo ?? "-"}</TableCell>
                    <TableCell>{row.label ?? "-"}</TableCell>
                    <TableCell>{row.coverImageUrl ? "已填写" : "-"}</TableCell>
                    <TableCell className="text-destructive">{row.errors.join("; ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border bg-white p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
