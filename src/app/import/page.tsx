import { Upload } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ImportPage() {
  return (
    <AppShell>
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">Excel Import</p>
        <h1 className="mt-2 text-3xl font-semibold">导入收藏模板</h1>
        <div className="mt-8 border bg-white p-6">
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="artist">目标艺人库</Label>
              <Input id="artist" placeholder="选择或输入艺人名称" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="file">Excel 文件</Label>
              <Input id="file" type="file" accept=".xlsx,.xls,.csv" />
            </div>
            <Button type="button" className="w-fit gap-2">
              <Upload className="size-4" />
              创建导入批次
            </Button>
          </div>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">
            MVP 数据模型已预留 ImportBatch。导入实现会把原模板的来源 URL 写入 ReleaseSource，
            表格末列改为 coverImageUrl。
          </p>
        </div>
      </div>
    </AppShell>
  );
}
